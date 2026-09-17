# Self-hosting the relay

pi-remote speaks the same wire protocol as
[remote_pi's relay](https://github.com/jacobaraujo7/remote_pi/tree/main/relay)
(`hello`/`challenge`/`auth`, opaque `{peer, ct}` envelopes), so the relay is a
drop-in: point `PI_REMOTE_RELAY_URL` at one you control and the public
third-party operator leaves the trust path.

Running your own relay means you own the TLS endpoint, the executable and the
SQLite store. It does **not** add end-to-end encryption — the relay still sees
routing metadata and plaintext `ct` frames, exactly as documented in
[`../DISCLOSURE`](../DISCLOSURE).

## 1. Run the relay

```bash
docker run -d \
  --name pi-remote-relay \
  -p 3000:3000 \
  -v remote-pi-data:/data \
  --restart unless-stopped \
  jacobmoura7/remote-pi-relay
```

One port serves the WebSocket upgrade (`/`), a health check (`/health`) and the
mesh endpoint (`/mesh/*`). Environment:

| Variable | Default | Meaning |
|---|---|---|
| `REMOTEPI_RELAY_PORT` | `3000` | Port for WS + `/health` + `/mesh/*` |
| `REMOTEPI_MESH_DB_PATH` | `/data/mesh.db` | SQLite for signed membership versions |
| `RUST_LOG` | _(none)_ | Log filter, e.g. `info` |

> The mesh endpoint and `mesh.db` serve remote_pi's cross-PC membership; a
> phone-only pi-remote setup does not use them, but keep the volume so the
> container behaves predictably.

## 2. Terminate TLS (required)

Browsers only open `wss://` from an HTTPS page. Put a TLS-terminating proxy in
front — Caddy is the shortest path:

```caddyfile
relay.example.com {
  reverse_proxy 127.0.0.1:3000
}
```

Caddy provisions the certificate automatically. nginx works too; the only
requirement is the WebSocket upgrade headers on `/`.

## 3. Point pi-remote at it

On the Pi machine:

```bash
export PI_REMOTE_RELAY_URL=wss://relay.example.com
```

Then in pi:

```text
/pi-remote stop
/pi-remote start
```

`/pi-remote status` prints the effective relay URL. The PWA needs no change: the
pair URL carries the room, and the phone dials the same relay the Pi is on.

> If you host the PWA yourself too, also set `PI_REMOTE_PWA_URL` to its origin
> and serve `web/` (any static HTTPS host works). Keep the relay host and the
> PWA host reachable from the phone; they may differ.

## 4. What to back up

Two kinds of state exist; only one is server-side.

**Relay (server)** — the Docker volume:

- `${REMOTEPI_MESH_DB_PATH}` (`/data/mesh.db`) — membership metadata only, no
  message traffic. Losing it is recoverable (clients re-publish at their next
  mutation), but back it up with the rest of your server state.

**Pi machine (client)** — `$PI_REMOTE_HOME` (default `~/.pi/pi-remote`):

| File | Contents | If lost |
|---|---|---|
| `identity.json` | Machine Ed25519 key (mode 0600) | New identity: every phone must re-pair |
| `peers.json` | Paired phones (`name`, `remote_epk`, `paired_at`) | Phones must re-pair |
| `vapid.json` | VAPID P-256 keypair (mode 0600) | Existing push subscriptions stop decrypting; phones re-subscribe on next open |
| `push.json` | Per-peer push subscriptions | Wake-ups stop until phones re-subscribe (they do it automatically after pairing) |
| `audit.jsonl` (+ `audit.1.jsonl`) | Security event log | History only; no functional impact |

Back up `identity.json`, `peers.json` and `vapid.json` together: losing any of
them forces re-pairing. All are plain files (no keyring), so treat the backup
like any secret.

## 5. Operating it

```text
/pi-remote status      # state, relay, room, peer count
/pi-remote devices     # list paired phones with short ids
/pi-remote revoke <id> # drop a phone: peers + push sub + live channel
```

`revoke` sends the phone a `bye` so its PWA clears the stale session locally.
Devices that were lost or sold should be revoked; the pairing token is
single-use and short-lived, so a stolen token alone is not a lasting grant —
but a *paired* device is, until revoked.

The audit log answers "which phone paired, when, and is it still allowed?":

```bash
tail -f ~/.pi/pi-remote/audit.jsonl
```

Events: `start`, `stop`, `relay_connect`, `relay_disconnect`, `pair`,
`pair_reject`, `revoke`, `push_subscribe`, `push_unsubscribe`, `wake_push`.
Peer ids are truncated to 8 characters and no tokens or message text are ever
written.
