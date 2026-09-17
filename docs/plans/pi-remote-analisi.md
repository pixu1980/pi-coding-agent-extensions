# Analisi pi-remote — controllo remoto di pi senza app store, a costo zero

Data: 2026-09-17. Origine: fork ispirato a `jacobaraujo7/remote_pi`
(`pi-extension` + `relay` Rust + app `cockpit` Flutter, `PROTOCOL.md` canonico).
Obiettivo: nuova estensione `@pixu1980/pi-remote` + webapp installabile dal
browser, con notifiche, senza passare da App Store / Play Store, senza costi
aggiuntivi.

## 1. Cosa fa remote_pi oggi (sintesi verificata sul clone)

Due layer indipendenti sotto un solo comando `/remote-pi`:

1. **Agent mesh locale** — più istanze pi nella stessa macchina si scoprono via
   broker su Unix Domain Socket (`~/.pi/remote/sessions/<nome>/broker.sock`),
   con leader election e failover. Tool LLM: `list_peers`, `agent_send`
   (unicast con ACK `received | denied | timeout`, broadcast fire-and-forget).
   Il vecchio `agent_request` bloccante è deprecato.
2. **Controllo da telefono via relay** — telefono e processo pi si ritrovano
   tramite relay WebSocket. Pairing una tantum via QR `remotepi://pair`
   con token effimero (default 60 s, monouso, `qrSession.consumeToken`),
   chiave Ed25519 per parte (Pi-key nel keyring OS via `@napi-rs/keyring`,
   Owner-key nel keychain del telefono), challenge-response sul WS,
   `roomId` a 12 char derivato dal cwd per multiplexare N pi con stessa chiave.

Pezzi esistenti riutilizzabili: formato envelope `{from,to,id,re,body}`,
contratto `extension_ui_request/response` (il bridge `extension_ui_bridge.ts`
porta già i flow `pi-ask` sul client remoto), relay Rust con Dockerfile,
`cockpit/web/manifest.json` già `display: standalone` (la PWA era a metà strada,
ma il client resta Flutter da compilare, firmare e pubblicare).

## 2. Perché oggi servono gli store (e quanto costano)

- App nativa = account Apple Developer (~99 $/anno) + Play (~25 $ una tantum),
  build/firma per iOS-Android-macOS-Windows-Linux, review Apple/Google a ogni
  release, push via APNs/FCM con credenziali e servizi da mantenere.
- Il QR `remotepi://` apre comunque un'app: senza app installata non succede
  nulla. Questo è il collo di bottiglia da eliminare.

## 3. Strategia proposta: PWA + Web Push, niente nativo

Sostituire il client Flutter con una **Progressive Web App** statica:

- Si apre da link HTTPS, si installa con "Aggiungi a schermata Home" dal
  browser: nessuna review, nessun account developer, aggiornamenti immediati.
- Trasporto identico a oggi: **WebSocket su TLS** verso il relay. Il browser
  lo sa fare nativamente (`WebSocket` + `crypto.subtle` per Ed25519, niente
  dipendenza `@noble/ed25519` sul client).
- **Notifiche senza server a pagamento**: Web Notifications API per client in
  primo piano + **Web Push con chiavi VAPID autogenerate** (costo zero, nessun
  servizio esterno) per risvegliare il telefono quando la PWA è chiusa.
  Il payload push resta opaco/minimo ("hai un messaggio, vieni a leggerlo"):
  il contenuto vero viaggia sul WS già autenticato, così il push provider
  (Apple/Google/Mozilla) non vede il contenuto.
- Pairing senza app: il QR punta a `https://<nostra-pwa>/pair?t=...&epk=...&rm=...`
  invece di `remotepi://pair`, con fallback **token manuale da digitare**
  (fondamentale su iOS dove la scansione da fotocamera apre Safari e non
  un'app dedicata).

### Limiti onesti da dichiarare (soprattutto iOS)

- iOS supporta Web Push solo da 16.4+ **e solo se la PWA è installata** da
  Safari con "Aggiungi a schermata Home". Senza installazione, niente push in
  background: valgono solo notifiche locali a PWA aperta + suono/vibrazione.
- Nessun browser mobile tiene un WS affidabile in background per ore: la push
  serve da "sveglia", la sessione vera si ricostruisce all'apertura
  (`session_sync` + replay delle `pendingRequests`, pattern già previsto dal
  bridge extension_ui).
- Il relay vede metadati e instradamento TLS come oggi (`PROTOCOL.md` è chiaro:
  `ct` non è garanzia E2E system-wide, l'operatore del relay è trusted): la
  PWA non peggiora né migliora questo punto, va solo documentato uguale.

## 4. Architettura pi-remote (v1 volutamente ridotta)

```text
pi locale ── @pixu1980/pi-remote (fork ridotto di pi-extension)
   │  WS+TLS, challenge Ed25519, roomId per cwd, token pairing 60 s
   ▼
relay (riuso: default pubblico remote_pi per iniziare,
       poi self-host con il Dockerfile esistente — costo zero su macchina propria)
   ▲
PWA statica (GitHub/Cloudflare Pages, costo zero):
  pair via QR https + token manuale → chat/streaming → Web Push VAPID
```

- **Estensione** (`packages/pi-remote`): solo remote control. Nella v1 restano
  fuori mesh UDS multi-Pi, supervisord/daemon, MCP mesh e cockpit desktop
  (`pi --mode rpc`): sono i pezzi più grossi di remote_pi e non servono a
  "comandare pi dal telefono". Si reintroducono in v2 se richiesti.
- **PWA** (`packages/pi-remote/web`): `index.html`, `manifest.webmanifest`,
  `sw.js`, `app.js` vanilla, icone. Niente framework: deve restare
  manutenibile e pubblicabile come file statici.
- **Push**: chiavi VAPID generate in locale al primo `/pi-remote start`,
  chiave pubblica esposta alla PWA in pairing, sottoscrizioni salvate
  accanto a `peers.json`. Invio push dall'estensione con `fetch` verso
  l'endpoint della sottoscrizione (firmato VAPID): nessuna dipendenza a
  pagamento, solo `fetch` nativo Node 22.
- **Comandi**: `/pi-remote start|pair|stop` (stessa macchina a stati
  `idle → started → paired` di remote_pi, così la documentazione resta
  familiare).

## 5. Parità funzionale: cosa la PWA deve saper fare

| Funzione remote_pi | Come in PWA |
|---|---|
| Invio prompt, streaming risposte/eventi | WS come oggi, rendering chat |
| History + `session_sync` all'apertura | replay + `pendingRequests` del bridge |
| Cambio modello / thinking level | stessi messaggi `set_model`, `set_thinking_level` |
| `ask_user` (pi-ask) nativo | riuso `extension_ui_request/response` esistente |
| Notifica "turno finito / serve input" | Notification API + push "sveglia" |
| Multi-sessione per cwd | stesso `roomId`, selettore stanze |
| Pairing QR 60 s monouso | QR https + token manuale, stessa `qrSession` |

## 6. Hosting a costo zero (concreto)

- PWA: GitHub Pages o Cloudflare Pages (statici, HTTPS incluso, zero costi).
- Relay per partire: default pubblico `relay-rp1.jacobmoura.work` (comodo ma
  terzo, con i trust boundary di §3). Poi self-host con Dockerfile esistente
  su macchina propria / VPS già pagato / tunnel: nessun nuovo abbonamento.
- Push: VAPID self-hosted, nessun Firebase a pagamento (il piano gratuito
  esiste ma introduce un vendor e credenziali cloud: evitarlo è parte del
  requisito "senza costi aggiuntivi").

## 7. Piano di lavoro

1. **Fase 0** — scheletro `@pixu1980/pi-remote` nel monorepo (questa analisi
   + manifest, barrel, QR/token, PWA scheletro, 10 test verdi). ✅ completata
2. **Fase 1** — pairing web reale: QR https + `consumeToken`, `roomId`,
   persistenza peer, comandi start/pair/stop. ✅ completata (relay WS con
   challenge-response Ed25519 via `node:crypto`, `peers.json` atomico,
   `pair_request` → `pair_ok`/`pair_error` sul relay, 21 test verdi, zero
   dipendenze runtime)
3. **Fase 2** — chat/streaming + `session_sync` + ask_user via bridge pi-ask.
   ✅ completata (protocollo `user_message` con echo, `agent_chunk/done`,
   `tool_request/result`, history normalizzata + `session_sync` con limit,
   `ping/pong`, `cancel` via abort, bridge ask con modali single/multi/input
   + replay per-peer, PWA con client relay WebCrypto + chat + notifiche,
   38 test verdi, sempre zero dipendenze runtime)
4. **Fase 3** — VAPID + Service Worker + notifiche. ✅ completata (cifratura
   `aes128gcm` RFC 8291 + firma VAPID RFC 8292 in puro `node:crypto`, output
   byte-identico al vettore ufficiale ("watermelon"), chiave VAPID in
   `pair_ok`, `push_subscribe/unsubscribe`, wake-up senza contenuto su fine
   turno/richieste/errori con drop 404/410, PWA con subscribe + resubscribe,
   51 test verdi, sempre zero dipendenze runtime)
5. **Fase 4** — relay self-host documentato (compose + backup `peers.json`),
5. **Fase 4** — relay self-host documentato, revoke peer, audit log.
   ✅ completata (`/pi-remote devices|revoke` con `bye` al device revocato,
   audit JSONL append-only con rotazione e peer troncati, hardening
   documentato, guida self-host con Caddy + cosa backuppare; 63 test verdi,
   sempre zero dipendenze runtime)

## 8. Domande aperte per te

1. Relay: partiamo sul relay pubblico di remote_pi o andiamo subito di
   self-hosted?
2. Mesh multi-Pi locale (UDS) serve nella v1 o basta il controllo remoto?
3. URL della PWA: sottopercorso di un dominio esistente o nuovo host Pages?
4. Manteniamo compatibilità wire con le app remote_pi esistenti o protocollo
   nuovo libero di divergere?
