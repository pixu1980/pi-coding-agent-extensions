# Session Handoff: pi-remote Phase 4 Complete

**Date:** 2026-09-17  
**Branch:** main  
**Commit Range:** b355b0b..c56830b (2 commits)

---

## Summary

Completed all four phases of the **pi-remote** extension — drive the pi coding agent from a phone browser via an install-free PWA with notifications, wire-compatible with remote_pi relay.

**Zero runtime dependencies** throughout. All crypto via Node `node:crypto` and browser `WebCrypto`.

---

## Commits Created

| Commit | Scope | Message |
|--------|-------|---------|
| b355b0b | `feat(pi-remote)` | add pi-remote extension (phases 0-4) |
| c56830b | `docs(pi-remote)` | update analysis with phase 4 completion |

---

## Phase Overview

| Phase | Description | Status |
|-------|-------------|--------|
| 0 | Package skeleton, PWA shell, analysis | ✅ |
| 1 | Relay WebSocket, Ed25519 challenge-response, peer store | ✅ |
| 2 | Chat/streaming, `session_sync`, ask_user bridge (pi-ask) | ✅ |
| 3 | VAPID push delivery, Service Worker wake-ups | ✅ |
| 4 | Peer revoke, device listing, audit log, self-host docs | ✅ |

---

## Phase 4 Details (This Session)

### Security Hardening
- **Device revocation** (`/pi-remote revoke <id-or-name>`): removes peer + push subscription + live channel, sends `bye {reason:'revoked'}` to phone, demotes state, writes audit.
- **Device listing** (`/pi-remote devices`): shows paired peers with short IDs.
- **Terminal-only enforcement**: `devices` and `revoke` never fed to LLM as user messages.
- **Audit log** (`lib/_audit.ts`): append-only `audit.jsonl` (mode 0600), one rotated generation (`audit.1.jsonl`). Events: `start`, `stop`, `relay_connect/disconnect`, `pair`, `pair_reject`, `revoke`, `push_subscribe/unsubscribe`, `wake_push`. Peer IDs truncated to 8 chars; **never** tokens or message text. Corrupt-safe reads (never throws).

### PWA Updates
- **`web/app.js`**: handles `bye` message — clears local session, returns to pairing screen so stale tokens cannot silently reconnect.
- **`web/sw.js`**: push event handling (unchanged from Phase 3).

### Self-Hosting Documentation
- **`docs/self-hosting-relay.md`**: Docker relay (wire-compatible with remote_pi), Caddy TLS termination, `PI_REMOTE_RELAY_URL`, backup table for `identity.json`/`peers.json`/`vapid.json` (loss = re-pair required).

### Documentation Updates
- **README**: commands cheatsheet, roadmap (all 4 phases ✅), security operations section.
- **DISCLOSURE**: updated threat model (revoke, audit, key storage).
- **`docs/plans/pi-remote-analisi.md`**: Phase 4 marked complete in Italian.

---

## Gates Verified

| Gate | Result |
|------|--------|
| `pnpm test` (pi-remote) | 63/63 pass |
| `pnpm typecheck` | clean |
| `prettier --check` | clean |
| `pnpm lint` (biome) | clean (fixed 97 errors via safe/unsafe fixes) |
| `pnpm test:all` (9 packages) | 9 ok, 0 failed |

---

## Relevant Files

### Core Implementation
- `packages/pi-remote/lib/_audit.ts` — audit log with rotation & corrupt-safe reads
- `packages/pi-remote/lib/_extension.ts` — devices/revoke commands, bye sending, audit integration
- `packages/pi-remote/web/app.js` — PWA bye handler
- `packages/pi-remote/web/sw.js` — push event handling

### Documentation
- `packages/pi-remote/docs/self-hosting-relay.md` — self-host guide
- `packages/pi-remote/README.md` — commands, roadmap, security ops
- `packages/pi-remote/DISCLOSURE` — threat model
- `docs/plans/pi-remote-analisi.md` — Italian analysis

### Tests
- `packages/pi-remote/__tests__/_phase4.test.mjs` — 63 tests covering audit, revoke, devices, ambiguous/unknown targets, corrupt-safe, rotation

---

## Next Steps

None — all four phases complete. Ready for next feature or release.

---

## Commit Convention Reminder

All commits follow **Conventional Commits with mandatory scope**: `type(scope): subject`

Examples:
- `feat(pi-remote): add peer revocation`
- `docs(pi-remote): update self-host guide`
- `chore(handoff): add session handoff 05-pi-remote-phase4-complete`

Scope must match a package or cross-cutting concern (e.g., `pi-remote`, `pi-web`, `lint`, `handoff`, `adr`).
