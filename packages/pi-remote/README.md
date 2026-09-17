# pi-remote

Drive the [pi coding agent](https://pi.dev) from your phone browser. No App
Store, no native app, no extra costs: an install-free PWA with notifications,
inspired by [remote_pi](https://github.com/jacobaraujo7/remote_pi).

```bash
pi install npm:@pixu1980/pi-remote
```

Then in any Pi terminal:

```text
/pi-remote start
/pi-remote pair
```

Open the printed URL on your phone (or type the manual token), then add the
page to your home screen to enable background notifications.

```text
/pi-remote status          # state, relay, room, peer count
/pi-remote devices         # list paired phones with short ids
/pi-remote revoke <id>     # drop a phone (peers + push sub + live channel)
/pi-remote stop
```

## How it works

State machine `idle → started → paired`, mirroring remote_pi so its docs stay
familiar — but the QR payload is an HTTPS PWA URL instead of a `remotepi://`
deep link, and pairing always offers a manual-token fallback.

- `lib/_identity.ts` — per-machine Ed25519 keypair via `node:crypto` (no
  `@noble/ed25519` needed), persisted at `~/.pi/pi-remote/identity.json`
  (mode 0600). Wire format matches the relay exactly (std-base64 pubkey,
  signature over the raw nonce).
- `lib/_relay.ts` — dependency-free WebSocket client (Node 22 global
  `WebSocket`): hello → challenge → auth, liveness watchdog, auto-reconnect
  with backoff, `RoomAlreadyOpenError` mapping.
- `lib/_peers.ts` — atomic `peers.json` store (`{name, remote_epk,
  paired_at}`, same shape as remote_pi).
- `lib/_pairing.ts` — single-use ephemeral tokens (default 60 s TTL, clamped
  10–600 s), PWA pair-URL builder, per-directory 12-char room ids.
- `lib/_protocol.ts` — wire types (chat, history, ask envelopes).
- `lib/_chat.ts` — prompt echo + live streaming + normalized history +
  `session_sync`, `ping`, `cancel`.
- `lib/_ask.ts` — pi-ask clarification flows as native phone modals.
- `lib/_push.ts` — VAPID keypair persistence, per-peer subscription store
  (`push.json`), content-free wake-up fan-out with dead-subscription drop.
- `lib/_webpush.ts` — RFC 8291 `aes128gcm` encryption + RFC 8292 VAPID
  signing, zero dependencies, pinned to the RFC's official test vector.
- `lib/_audit.ts` — append-only `audit.jsonl` (0600, one rotated generation)
  recording pairing, revoke, relay and push lifecycle events. Peer ids are
  truncated to 8 chars; tokens and message text are never written.
- `web/` — dependency-free PWA (pair page, relay client with WebCrypto
  Ed25519 auth, chat, history sync, ask modals, notifications). Host the
  directory on any static HTTPS host (GitHub Pages, Cloudflare Pages) at
  zero cost. **Phone flow**: open the pair URL → token → chat; "Add to Home
  Screen" enables background notifications (iOS 16.4+). A `bye` from the Pi
  (revoke) clears the local pairing so a stale token cannot silently reconnect.

Configuration via environment:

| Variable | Default | Meaning |
|---|---|---|
| `PI_REMOTE_RELAY_URL` | `wss://relay-rp1.jacobmoura.work` | Relay WebSocket (public third-party by default; self-host for full trust) |
| `PI_REMOTE_PWA_URL` | `https://pixu1980.github.io/pi-remote` | Public origin of `web/` |
| `PI_REMOTE_VAPID_SUBJECT` | `mailto:pi-remote@localhost` | Contact for the VAPID JWT `sub` claim (use your real address in production) |
| `PI_REMOTE_HOME` | `~/.pi/pi-remote` | State dir (identity, peers, VAPID keys, subscriptions) |

Full analysis (in Italian): [`docs/plans/pi-remote-analisi.md`](../../docs/plans/pi-remote-analisi.md).
Self-hosting the relay: [`docs/self-hosting-relay.md`](./docs/self-hosting-relay.md).
Security/trust notes: [`DISCLOSURE`](./DISCLOSURE).

## Roadmap

1. **Phase 0** — package skeleton, PWA shell, analysis. ✅ done
2. **Phase 1** — relay WebSocket with Ed25519 challenge-response + peer store. ✅ done
3. **Phase 2** — chat/streaming, `session_sync`, ask_user bridge (pi-ask). ✅ done
4. **Phase 3** — VAPID push delivery + Service Worker wake-ups. ✅ done
5. **Phase 4** — peer revoke, device listing, audit log, self-host docs. ✅ done

## Security operations

- Pairing tokens are single-use with a clamped 10–600 s TTL (default 60 s) and
  are invalidated on use, on `/pi-remote pair` again, and on `/pi-remote stop`.
- A **paired device is a lasting grant** until revoked; use
  `/pi-remote devices` to audit and `/pi-remote revoke <id-or-name>` to drop
  one. Revoke removes the peer, its push subscription and any live channel.
- `devices` and `revoke` are terminal-only: security bookkeeping is never fed
  to the LLM as a user message.
- `~/.pi/pi-remote/audit.jsonl` is the tamper-evident-ish trail; back up
  `identity.json`, `peers.json` and `vapid.json` together (see self-host doc).

## Push policy

Wake-ups are content-free (`{kind:'wake-up', rm}` — open the PWA to read).
Sent on turn end (`normal` urgency, 1 h TTL), clarification requests and
provider errors (`high` urgency, 10 min TTL). Dead subscriptions (push
service 404/410) are dropped automatically. No subscription → no traffic.

## Development

```bash
cd packages/pi-remote
pnpm install
node --import tsx --test __tests__/index.test.mjs
pi -e .
```
