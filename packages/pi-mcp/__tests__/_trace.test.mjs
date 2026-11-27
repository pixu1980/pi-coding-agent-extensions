/**
 * pi-mcp - trace writer: location, permissions and metadata-only content
 *
 * The trace is durable metadata, so it must not leak tool arguments and it
 * must not land in the user's project with default permissions.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

import {
  createMcpTraceEvent,
  createMcpTraceWriter,
  McpTraceWriter,
  MCP_TRACE_FILE_MODE,
  redactTraceText,
} from '../lib/_mcp-trace.ts';

/** Records the calls the writer makes into its injected filesystem. */
function makeFsSpy() {
  const calls = { write: [], append: [], chmod: [], mkdir: [] };

  return {
    calls,
    writeFile: async (path, data, options) => {
      calls.write.push({ path, data, options });
    },
    appendFile: async (path, data, options) => {
      calls.append.push({ path, data, options });
    },
    chmod: async (path, mode) => {
      calls.chmod.push({ path, mode });
    },
    mkdir: async (path) => {
      calls.mkdir.push(path);

      return undefined;
    },
  };
}

test('default trace path lives under the agent directory', () => {
  const previous = process.env.PI_CODING_AGENT_DIR;
  const agentDir = mkdtempSync(join(tmpdir(), 'pi-mcp-trace-'));

  process.env.PI_CODING_AGENT_DIR = agentDir;

  try {
    const writer = createMcpTraceWriter('/home/dev/my-project', { enabled: true }, 'fixed');

    assert.ok(
      writer.filePath.startsWith(join(agentDir, 'mcp-traces')),
      `expected the agent directory, got ${writer.filePath}`
    );
    assert.ok(!writer.filePath.includes('my-project'), 'the project directory must not hold traces');
  } finally {
    if (previous === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = previous;
    }
  }
});

test('an absolute configured path still wins', () => {
  const configured = join(tmpdir(), 'explicit-trace.jsonl');
  const writer = createMcpTraceWriter('/home/dev/my-project', { enabled: true, file: configured });

  assert.equal(writer.filePath, configured);
});

test('the writer creates the file owner-only and fixes an older mode', async () => {
  const fs = makeFsSpy();
  const writer = new McpTraceWriter({
    filePath: '/tmp/dir/trace.jsonl',
    writeFile: fs.writeFile,
    appendFile: fs.appendFile,
    chmod: fs.chmod,
    mkdir: fs.mkdir,
  });

  writer.write(
    createMcpTraceEvent('client-to-server', 'fs', 'stdio', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, 'sent')
  );
  await writer.flush();

  assert.equal(fs.calls.write.length, 1, 'the file is reset once');
  assert.equal(fs.calls.write[0].options.mode, MCP_TRACE_FILE_MODE, 'created with 0o600');
  assert.deepEqual(fs.calls.chmod, [{ path: '/tmp/dir/trace.jsonl', mode: MCP_TRACE_FILE_MODE }]);
  assert.equal(fs.calls.append.length, 1);
  assert.equal(fs.calls.append[0].options.mode, MCP_TRACE_FILE_MODE, 'appended with 0o600');
});

test('a trace event never carries tool arguments', () => {
  const event = createMcpTraceEvent(
    'client-to-server',
    'server-token-abcd',
    'stdio',
    {
      jsonrpc: '2.0',
      id: 'call-1',
      method: 'tools/call',
      params: { name: 'deploy', arguments: { apiKey: 'sk-live-1234567890' } },
    },
    'sent'
  );

  const serialized = JSON.stringify(event);

  assert.ok(!serialized.includes('sk-live-1234567890'), 'no argument value reaches the trace');
  assert.ok(!serialized.includes('deploy'), 'no argument name reaches the trace');
  assert.equal(event.server, '[REDACTED]', 'a secret-looking server name is redacted');
  assert.equal(event.id, '[REDACTED_ID]', 'a string id is not kept verbatim');
  assert.equal(event.method, 'tools/call', 'the method name stays readable');
});

test('redactTraceText strips urls and credentials', () => {
  assert.equal(redactTraceText('connect https://relay.test/room/abc failed'), 'connect [REDACTED_URL] failed');
  assert.equal(redactTraceText('a', 1).length, 1);
  assert.ok(redactTraceText('x'.repeat(400)).length <= 160);
});
