/**
 * pi-remote - device identity (Ed25519, zero dependencies)
 *
 * Mirrors remote_pi's Pi-key role: a per-machine Ed25519 keypair that
 * authenticates the WebSocket handshake (challenge-response) and provides
 * the canonical technical identity routed by the relay.
 *
 * remote_pi keeps the Pi-key in the OS keyring with a file fallback; pi-remote
 * stays dependency-free and uses a file only (`identity.json`, mode 0600).
 * The wire format is identical (raw 32-byte pubkey, standard base64 with
 * padding; raw 64-byte signature over the raw nonce), so the public relay
 * accepts us without changes. Node 22 ships Ed25519 in `node:crypto` — no
 * `@noble/ed25519` needed on the extension side.
 */

import { createPublicKey, createPrivateKey, generateKeyPairSync, sign, verify, type KeyObject } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface Identity {
  privateKey: KeyObject;
  publicKey: KeyObject;
  /** Raw 32-byte public key. */
  publicKeyRaw: Buffer;
  /** Canonical wire form: standard base64 WITH padding (matches relay B64). */
  publicKeyB64: string;
}

/** Base directory for pi-remote state. Overridable for tests via env. */
export function piRemoteDir(): string {
  return process.env.PI_REMOTE_HOME ?? join(homedir(), '.pi', 'pi-remote');
}

export function identityPath(dir: string = piRemoteDir()): string {
  return join(dir, 'identity.json');
}

function fromPrivateKey(privateKey: KeyObject): Identity {
  const publicKey = createPublicKey(privateKey);
  const spki: Buffer = publicKey.export({ format: 'der', type: 'spki' }) as Buffer;
  const publicKeyRaw = spki.subarray(spki.length - 32);
  return {
    privateKey,
    publicKey,
    publicKeyRaw: Buffer.from(publicKeyRaw),
    publicKeyB64: Buffer.from(publicKeyRaw).toString('base64'),
  };
}

/** Loads the machine identity, generating and persisting it on first run. */
export function loadOrCreateIdentity(dir: string = piRemoteDir()): Identity {
  mkdirSync(dir, { recursive: true });
  const path = identityPath(dir);

  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { privateKeyPkcs8B64?: string };
    if (typeof raw.privateKeyPkcs8B64 === 'string') {
      const privateKey = createPrivateKey({
        key: Buffer.from(raw.privateKeyPkcs8B64, 'base64'),
        format: 'der',
        type: 'pkcs8',
      });
      return fromPrivateKey(privateKey);
    }
  } catch {
    /* missing or corrupt — generate fresh below */
  }

  const { privateKey } = generateKeyPairSync('ed25519');
  const pkcs8: Buffer = privateKey.export({ format: 'der', type: 'pkcs8' }) as Buffer;
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ version: 1, privateKeyPkcs8B64: pkcs8.toString('base64') }));
  chmodSync(tmp, 0o600);
  renameSync(tmp, path);
  try {
    chmodSync(path, 0o600);
  } catch {
    /* non-POSIX fs — best effort */
  }
  return fromPrivateKey(privateKey);
}

/** Ed25519 signature (64 bytes) over arbitrary bytes. */
export function ed25519Sign(identity: Identity, message: Uint8Array): Buffer {
  return sign(null, message, identity.privateKey);
}

/** Verifies an Ed25519 signature against a raw 32-byte public key. */
export function ed25519Verify(publicKeyRaw: Uint8Array, message: Uint8Array, sig: Uint8Array): boolean {
  const publicKey = createPublicKey({
    key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(publicKeyRaw)]),
    format: 'der',
    type: 'spki',
  });
  return verify(null, message, publicKey, sig);
}
