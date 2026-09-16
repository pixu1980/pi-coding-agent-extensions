import { isServerDisabled, type ServerDefinition } from './_types.ts';
import type { McpServerManager } from './_server-manager.ts';
import { hasPendingAuth } from './_mcp-auth-flow.ts';
import { logger } from './_logger.ts';
import { formatTerminalError, parallelLimit, sanitizeTerminalText } from './_utils.ts';

export type ReconnectCallback = (serverName: string) => void;
export type ReconnectFailureCallback = (serverName: string, error: unknown) => void;

export interface LifecycleOptions {
  /** Per-attempt connect timeout; the connection attempt is aborted after this. */
  connectTimeoutMs?: number;
  /** Exponential backoff base after a failed attempt. */
  backoffBaseMs?: number;
  /** Backoff cap (the base doubles with jitter up to here). */
  backoffMaxMs?: number;
  /** Max concurrent reconnect attempts per health pass. */
  reconnectLimit?: number;
}

const DEFAULT_LIFECYCLE_OPTIONS: Required<LifecycleOptions> = {
  connectTimeoutMs: 20_000,
  backoffBaseMs: 1_000,
  backoffMaxMs: 60_000,
  reconnectLimit: 4,
};

export class McpLifecycleManager {
  private keepAliveServers = new Map<string, ServerDefinition>();
  private allServers = new Map<string, ServerDefinition>();
  private serverSettings = new Map<string, { idleTimeout?: number }>();
  private globalIdleTimeout = 10 * 60 * 1000;
  private healthCheckInterval?: NodeJS.Timeout;
  private onReconnect?: ReconnectCallback;
  private onReconnectFailure?: ReconnectFailureCallback;
  private onIdleShutdown?: (serverName: string) => void;
  private activeHealthCheck?: Promise<void>;
  private shutdownPromise?: Promise<void>;
  private stopped = false;
  private removeHealthAbortListener?: () => void;

  constructor(
    private readonly manager: McpServerManager,
    private readonly hasPendingAuthForServer = hasPendingAuth,
    private readonly options: LifecycleOptions = {}
  ) {}

  private get opt(): Required<LifecycleOptions> {
    return { ...DEFAULT_LIFECYCLE_OPTIONS, ...this.options };
  }

  // Reconnect backpressure: per-server next-allowed attempt and failure
  // count for jittered exponential backoff.
  private nextAttemptByName = new Map<string, number>();
  private failCountByName = new Map<string, number>();

  setReconnectCallback(callback: ReconnectCallback): void {
    this.onReconnect = callback;
  }

  setReconnectFailureCallback(callback: ReconnectFailureCallback): void {
    this.onReconnectFailure = callback;
  }

  markKeepAlive(name: string, definition: ServerDefinition): void {
    if (isServerDisabled(definition)) {
      return;
    }

    this.keepAliveServers.set(name, definition);
  }

  registerServer(name: string, definition: ServerDefinition, settings?: { idleTimeout?: number }): void {
    if (isServerDisabled(definition)) {
      return;
    }

    this.allServers.set(name, definition);

    if (settings?.idleTimeout !== undefined) {
      this.serverSettings.set(name, settings);
    }
  }

  setGlobalIdleTimeout(minutes: number): void {
    this.globalIdleTimeout = minutes * 60 * 1000;
  }

  setIdleShutdownCallback(callback: (serverName: string) => void): void {
    this.onIdleShutdown = callback;
  }

  startHealthChecks(signalOrInterval?: AbortSignal | number, maybeIntervalMs = 30000): void {
    const signal = typeof signalOrInterval === 'number' ? undefined : signalOrInterval;
    const intervalMs = typeof signalOrInterval === 'number' ? signalOrInterval : maybeIntervalMs;

    this.stopped = false;

    if (signal?.aborted) {
      this.stopped = true;

      return;
    }

    const stop = () => {
      this.stopped = true;

      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
      }

      this.healthCheckInterval = undefined;
    };

    signal?.addEventListener('abort', stop, { once: true });
    this.removeHealthAbortListener = () => signal?.removeEventListener('abort', stop);
    this.healthCheckInterval = setInterval(() => {
      if (this.stopped || signal?.aborted || this.activeHealthCheck) {
        return;
      }

      const check = this.checkConnections(signal)
        .catch((error) => {
          console.error(`MCP: Health check failed: ${formatTerminalError(error)}`);
        })
        .finally(() => {
          if (this.activeHealthCheck === check) {
            this.activeHealthCheck = undefined;
          }
        });

      this.activeHealthCheck = check;
    }, intervalMs);
    this.healthCheckInterval.unref();
  }

  /**
   * Run one health pass now: reconnect every keep-alive server that is
   * disconnected. Reconnects run concurrently (bounded by reconnectLimit),
   * each attempt has its own timeout, and failures back off with jitter so
   * one hung server never delays the others. Public so a pass can be
   * triggered on demand (and tested); the interval also calls it.
   */
  async checkConnections(signal?: AbortSignal): Promise<void> {
    if (this.stopped || signal?.aborted) {
      return;
    }

    const options = this.opt;
    const now = Date.now();
    const candidates = [...this.keepAliveServers.entries()].filter(([name, definition]) => {
      if (isServerDisabled(definition)) {
        return false;
      }

      if ((this.nextAttemptByName.get(name) ?? 0) > now) {
        return false;
      } // backing off

      const connection = this.manager.getConnection(name);

      return connection?.status !== 'connected';
    });

    await parallelLimit(candidates, options.reconnectLimit, async ([name, definition]) => {
      if (this.stopped || signal?.aborted) {
        return;
      }

      if (this.hasPendingAuthForServer(name)) {
        logger.debug(`Skipping reconnect for ${name} while OAuth authorization is pending`);

        return;
      }

      try {
        await this.connectWithTimeout(name, definition, signal, options.connectTimeoutMs);

        if (this.stopped || signal?.aborted) {
          return;
        }

        logger.debug(`Reconnected to ${name}`);
        this.nextAttemptByName.delete(name);
        this.failCountByName.delete(name);
        this.onReconnect?.(name);
      } catch (error) {
        if (this.stopped || signal?.aborted) {
          return;
        }

        const failures = (this.failCountByName.get(name) ?? 0) + 1;

        this.failCountByName.set(name, failures);
        // Exponential backoff with jitter: base * 2^(failures-1), capped,
        // scaled by 0.5..1 to avoid thundering herds.
        const capped = Math.min(options.backoffBaseMs * 2 ** (failures - 1), options.backoffMaxMs);
        const jittered = capped * (0.5 + Math.random() * 0.5);

        this.nextAttemptByName.set(name, Date.now() + jittered);
        this.onReconnectFailure?.(name, error);
        const message = error instanceof Error ? error.message : String(error);

        console.error(`MCP: Failed to reconnect to ${name}: ${sanitizeTerminalText(message)}`);
      }
    });

    for (const [name] of this.allServers) {
      if (this.keepAliveServers.has(name)) {
        continue;
      }

      const timeout = this.getIdleTimeout(name);

      if (timeout > 0 && this.manager.isIdle(name, timeout)) {
        await this.manager.close(name);

        if (this.stopped || signal?.aborted) {
          return;
        }

        this.onIdleShutdown?.(name);
      }
    }
  }

  /**
   * Connect with a per-attempt timeout; the attempt is aborted via a child
   * controller when it times out, and the health signal cancels it too.
   */
  private connectWithTimeout(
    name: string,
    definition: ServerDefinition,
    signal: AbortSignal | undefined,
    timeoutMs: number
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      const onAbort = () => controller.abort();

      signal?.addEventListener('abort', onAbort, { once: true });
      const timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`MCP: reconnect to ${name} timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      timer.unref();
      this.manager
        .connect(name, definition, controller.signal)
        .then(() => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          resolve();
        })
        .catch((error) => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          reject(error);
        });
    });
  }

  private getIdleTimeout(name: string): number {
    const perServer = this.serverSettings.get(name)?.idleTimeout;

    if (perServer !== undefined) {
      return perServer * 60 * 1000;
    }

    return this.globalIdleTimeout;
  }

  async gracefulShutdown(): Promise<void> {
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }

    this.shutdownPromise = this.shutdownOnce();

    return this.shutdownPromise;
  }

  private async shutdownOnce(): Promise<void> {
    this.stopped = true;

    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = undefined;
    this.removeHealthAbortListener?.();
    this.removeHealthAbortListener = undefined;
    await this.activeHealthCheck;
    this.activeHealthCheck = undefined;
    this.onReconnect = undefined;
    this.onReconnectFailure = undefined;
    this.onIdleShutdown = undefined;

    if (typeof this.manager.closeAll === 'function') {
      await this.manager.closeAll();
    }
  }
}
