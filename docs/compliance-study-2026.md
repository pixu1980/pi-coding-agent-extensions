# Studio di conformità — Sicurezza release npm 2026 + jsDelivr ESM

> Studio **read-only**: nessun file di codice, dipendenza, script o comando
> `package.json` è stato modificato. Documenta lo stato attuale del repo
> rispetto a tre riferimenti e propone un piano di evoluzione.

Data: 2026-08-12 · Repo: `pixu1980/pi-coding-agent-extensions`

Riferimenti analizzati:

1. **Evil Martians — "The secure way to release an npm package in 2026"** (Andrey Sitnik)
2. **Skill `secure-npm-package`** (versione integrale)
3. **jsDelivr — "Making More npm Packages Work with jsDelivr ESM mode"** (Martin Kolárik)

---

## 1. Contesto del repo (fatti rilevati)

| Fatto | Valore |
|---|---|
| Struttura | Monorepo di 7 pacchetti pubblici in `packages/` (NON workspace pnpm: `pnpm-workspace.yaml` root ha `packages: []`, ogni pacchetto ha lockfile + workspace file propri) |
| Pacchetti npm | `@pixu1980/pi-ask` 0.1.11 · `pi-mcp` 0.1.11 · `pi-path-picker` 0.1.21 · `pi-reasoning` 0.2.11 · `pi-sessions` 0.1.11 · `pi-statusline` 0.1.10 · `pi-web` 0.1.5 — tutti pubblicati su npm, versioni allineate ai tag git |
| Root package | `pi-coding-agent-extensions` v0.0.0, `private: false`, **E404 su npm** (mai pubblicato) |
| Package manager | `pnpm@11.18.0` (campo `packageManager` + installato); Node 26.6.0, npm 11.18.0 locali |
| Distribuzione | **Nessun build step**: si pubblicano i sorgenti TypeScript (`index.ts`, `lib/**/*.ts`) con import specifier `./x.ts` espliciti (`tsconfig` `noEmit`) |
| Release attuale | `scripts/release.mjs` → `commit-and-tag-version` (bump+CHANGELOG+tag `<name>@<version>`) → `git push --follow-tags` → **`npm publish` locale** con credenziali del maintainer (`npm login`, 2FA) |
| CI | `ci.yaml` (test su main + PR) e `check-workflows.yaml` (zizmor). Tutte le action pinnate per SHA. `persist-credentials: false`. `--ignore-scripts` + `--frozen-lockfile`. Nessuna `id-token`, nessun secret `NPM_TOKEN` |
| `.npmrc` | `registry=…`, `access=public`, `minimumReleaseAge=4320` (cooldown 3 giorni, chiave pnpm) |
| Config locali | `pnpm-workspace.yaml` per-package con `overrides` di sicurezza (`brace-expansion`, `protobufjs`) e `allowBuilds` (esbuild, @google/genai, protobufjs — build bloccate di default da pnpm 11) |
| Docs esistenti | `docs/security.md` — checklist manuale già scritta (tag ruleset, immutable releases, 2FA) + **decisione esplicita di NON usare Trusted/Staged Publishing** |
| Git | Branch principale `main` + branch stantio `backup/pre-rewrite` (locale); nessun workflow di release |
| Vita dei pacchetti | Niente script lifecycle (`preinstall/postinstall/prepare`) propri nei pacchetti; `pi-mcp` e `pi-web` dichiarano `contentPolicy: "dual-use"` + `DISCLOSURE` |

---

## 2. Matrice di conformità vs articolo Evil Martians + skill `secure-npm-package`

### ✅ Già conforme (lato repo, verificato)

| Requisito (articolo/skill) | Stato | Dove |
|---|---|---|
| Actions CI pinnate per SHA commit (`actions-up`/`pinact` modello) | ✅ | `ci.yaml`, `check-workflows.yaml` — `actions/checkout@9c091bb2…`, `actions/setup-node@48b55a01…`, `pnpm/action-setup@6e00c0ce…`, `zizmorcore/zizmor-action@6599ee8b…` |
| CI security linting con **zizmor** (`check-workflows.yaml`) | ✅ | Presente, identico al workflow consigliato nell'articolo |
| **Cooldown dipendenze 3 giorni** | ✅ | `.npmrc` → `minimumReleaseAge=4320` (blocca ~94% dei pacchetti malevoli; median takedown 14h) |
| **Postinstall script disabilitati** | ✅ | pnpm 11 (default) + `--ignore-scripts` in CI + `allowBuilds` come allowlist esplicita (pattern "allowlist the one package" dell'articolo) |
| Nessun `NPM_TOKEN` in CI / nessun secret | ✅ | Non esiste alcun workflow di publish; i job hanno solo `contents: read` |
| **Nessun build step** ("best case" Nano ID-style dell'articolo) | ✅ | Sorgenti TS pubblicati as-is: niente compilatore, niente artifact da avvelenare, niente `--omit=dev` necessario |
| `persist-credentials: false` su ogni checkout | ✅ | Entrambi i workflow |
| Lockfile frozen in CI | ✅ | `pnpm install --frozen-lockfile --ignore-scripts` |
| Override sicurezza su dipendenze vulnerabili | ✅ | `brace-expansion`, `protobufjs` nei `pnpm-workspace.yaml` per-package |
| Least-privilege CI | ✅ | `contents: read` ovunque; nessuna `id-token: write` in giro (niente da rubare in CI) |
| Checklist manuale GitHub/npm (tag ruleset, immutable releases, 2FA) | ✅ (documentata) | `docs/security.md` — **da completare a mano**, non verificabile da qui |
| `contentPolicy: "dual-use"` + `DISCLOSURE` | ✅ (oltre l'articolo) | `pi-web`, `pi-mcp` |
| 2FA sul profilo npm (richiesta dal flow dual-use) | ✅ (documentata) | `docs/security.md` §5 |

### ❌ Non conforme / divergenza deliberata

| Requisito | Stato | Impatto |
|---|---|---|
| **Trusted Publishing** (nessun token: "The best token is no token") | ❌ **no** — scelta documentata in `docs/security.md` | Il token npm vive in `~/.npmrc` del maintainer. Un malware sul laptop (scenario **Axios/fake Zoom**, il vettore #1 dell'articolo) può pubblicare al posto vostro. Nessun **badge provenance** sui pacchetti (check verde su npmjs.com = vantaggio competitivo perso) |
| **Staged Publishing** (`npm stage publish` + approvazione manuale 2FA) | ❌ **no** | Il gate 2FA c'è (publish interattivo), ma è il *laptop* a essere il gate, non npm. Se la macchina è compromessa il gate salta |
| Workflow `publish.yaml` (tag → test → stage publish, `id-token: write` solo nel job publish) | ❌ assente | Coerente con la scelta locale, ma nessuna release transita da CI |
| **Provenance** npm (firma OIDC da CI) | ❌ assente | Nessuna verifica "published from CI on this commit" per gli utenti |
| Immutable releases / tag ruleset / 2FA org | ⚠️ **manuale, non verificato** | `docs/security.md` li elenca; stato attuale su GitHub sconosciuto (gh non disponibile da qui) |
| Branch stantii rimossi ("attacker exploits old branches" — caso Nx) | ⚠️ | Esiste `backup/pre-rewrite`: se contiene workflow vecchi/vulnerabili è un vettore residuo |

### ⚠️ Note minori

- **`npm` 11.18.0** (non npm 12): npm non disabilita i postinstall di default come pnpm 11; ma npm qui è usato **solo per `publish`** (che non esegue script di installazione), quindi il rischio è nullo. L'install in CI è pnpm.
- **`npm view`/`npm publish` mostrano warning**: `Unknown project config "minimumReleaseAge"` — la chiave del cooldown è pnpm-only e il `.npmrc` root è condiviso con npm. Cosmetico; non interrompe nulla.
- **Root `package.json` con `private: false`**: `release.mjs` itera solo `packages/`, quindi il rischio di publish accidentale è basso, ma `private: true` eliminerebbe il rischio (vedi §4, riga 6).
- **Nessun Harden Runner / egress policy**, **nessun `.devcontainer`**: hardening opzionali suggeriti dall'articolo.
- **`actions-up`** solo documentato come comando manuale; le SHA attuali sono già pinnate.
- Tag di release non firmati (`git tag -s`): l'articolo lo consiglia ma non lo richiede.
- Niente **drydock**/diff del tarball prima della pubblicazione (consiglio per lo staged publishing).

### Giudizio sintetico vs articolo/skill

Il repo ha **l'80% delle quick win** (cooldown, pnpm 11, zizmor, SHA pinning, no-build, no token in CI, `--ignore-scripts`).
Il gap strutturale è uno solo, ma è il cuore dell'articolo: **la release avviene dal laptop con un token reale**.
`docs/security.md` motiva la scelta con "smaller attack surface: no CI workflow with publish permissions", ma l'articolo
valuterebbe esattamente l'opposto: il CI senza `id-token` non è più sicuro se il token equivalente vive sulla
macchina del maintainer — il vettore di attacco più sfruttato del 2025-2026. La mitigazione "staged" dell'articolo
(CI pubblica *staged*, l'umano approva con 2FA hardware) copre entrambi i mondi.

---

## 3. Conformità vs jsDelivr ESM mode

### Analisi

L'articolo jsDelivr descrive come far funzionare i pacchetti npm nel browser via `/+esm`
(risoluzione exports, CJS→ESM, polyfill Node, tree-shaking, `import.meta.url`, asset relativi…).
Il punto di partenza è sempre **JavaScript/CommonJS compilato pubblicato su npm**.

Fatti rilevati nei 7 pacchetti:

| Fattore | Rilevato | Conseguenza su `/+esm` |
|---|---|---|
| Sorgenti distribuiti come **`.ts`** con import `./x.ts` | ✅ tutti | jsDelivr **non esegue un compilatore TS**: fallisce al parse esattamente come il caso JSX di `@expo/vector-icons` citato nell'articolo ("packages whose published files require an application-specific compilation step") |
| Campi di entrata assenti | 6/7 senza `exports`/`main`/`module`/`browser` (solo `pi-mcp` ha `exports`) | Il resolver jsDelivr non trova un entry point risolvibile (fallback su `main`→`index.js` che non esiste) |
| Import `node:*` estesi | `fs`, `fs/promises`, `os`, `path`, `child_process`, `readline`, `net`, `dns/promises` | API **server-only non implementabili** dal polyfill layer di jsDelivr (`child_process`, `readline`), anche dopo il tree-shaking |
| Dipendenza dal runtime pi | peer `@earendil-works/pi-*`, API estensioni/TUI, `pi` field | Nel browser non resta nulla di semanticamente utilizzabile |
| `import.meta.url` / asset | `banner.svg` ecc. (pi-ask) | Gestibile da jsDelivr, ma irrilevante se il modulo non parsa |

### Verdetto

**Non compatibile con jsDelivr ESM per design — e va bene così.** Questi pacchetti sono estensioni
server/CLI per un agent Node (pi), non librerie browser. Rientrano esattamente nell'ultima categoria
dell'articolo: "packages that still require Node.js … or an application-specific build step".

Renderli compatibili richiederebbe:
1. un **build step** (TS → ESM JS + `.d.ts` + `exports` map con condizioni `browser`), e
2. la **rimozione/astrazione dei built-in Node** (o `browser` field con stub),

cioè esattamente ciò che l'articolo Evil Martians sconsiglia per la sicurezza (build step = superficie
d'attacco in più) e che viola il vincolo "non toccare script/dipendenze".

**Raccomandazione**: dichiarare i pacchetti come "Node-only" (campo `engines` già presente in `pi-mcp`/`pi-web`,
estensibile a tutti) e, se un giorno si vuole una porzione consumabile in browser (es. la logica di
readability di `pi-web`), estrarre un **pacchetto separato puro** con build dedicata — fuori da questo repo o in
un workspace a parte. Nessuna azione richiesta ora.

---

## 4. Studio: come il repo potrebbe/dovrebbe evolvere

Vincolo rispettato: **nessuna modifica applicata** a dipendenze, comandi o script `package.json`.
Di seguito le opzioni, ordinate per rapporto impatto/sforzo, divise in "senza toccare script" e "con impatto su script".

### 4.A — Interventi che NON toccano script né package.json (fattibili subito)

1. **Completare la checklist manuale di `docs/security.md`** (solo click su GitHub/npm):
   - Tag ruleset "Tags only by admins" → <https://github.com/pixu1980/pi-coding-agent-extensions/settings/rules/new?target=tag>
   - Immutable releases → settings del repo
   - 2FA account personale (il repo è su account personale `pixu1980`, non org — da verificare)
   - npm: "Require two-factor authentication" per ognuno dei 7 pacchetti (link già in `docs/security.md`)
2. **Cancellare/proteggere `backup/pre-rewrite`** (branch stantio con possibili workflow vecchi — raccomandazione esplicita dell'articolo, caso Nx).
3. **Aggiungere `.devcontainer/`** — isola laptop/IDE/dipendenze; l'articolo lo consiglia come riduzione del rischio #1.
4. **Aggiungere Harden Runner** (egress allow-list) ai job CI esistenti — hardening opzionale, un solo step.
5. **`private: true` nel root `package.json`** (elimina il rischio publish accidentale; è un campo di metadati, non un comando — ma tocca `package.json`, quindi *solo su conferma*).
6. (Opzionale) **`.npmrc` dedicato**: spostare `minimumReleaseAge` in un file usato solo da pnpm, o passare alla chiave npm (`min-release-age`) per silenziare il warning su `npm view`/`npm publish`.

### 4.B — Migrazione completa a Trusted + Staged Publishing (allineamento pieno ad articolo+skill)

Questa è la strada che l'articolo e la skill raccomandano. Impatto: **richiede la modifica di `scripts/release.mjs`** (vincolo utente → resta uno studio, non si applica).

1. **GitHub — nuovo `.github/workflows/publish.yaml`** (file nuovo, non uno script esistente):
   - trigger su tag `@pixu1980/*@v*` (o `*@*`, mantenendo il formato tag attuale `<name>@<version>`),
   - job `test` (come `ci.yaml`), job `publish` con `permissions: contents: read, id-token: write`,
   - nel job `publish` **nessuna installazione di dipendenze**: checkout + setup-node + `npm stage publish --ignore-scripts` — reso banale dal fatto che **non c'è build step** (niente job build, niente artifact, niente `--omit=dev`; è il "Nano ID workflow" dell'articolo),
   - `package-manager-cache: false` nel job critico.
2. **npmjs.com — per ognuno dei 7 pacchetti** (stessa repo, stesso workflow):
   - Trusted Publisher: GitHub Actions → `pixu1980` / `pi-coding-agent-extensions` / workflow `publish.yaml` / **solo `npm stage publish`** (nega `npm publish`),
   - Publishing access: "Require two-factor authentication **and disallow tokens**" (revoca i token attuali),
   - eliminare il secret `NPM_TOKEN` se esiste (non risulta) e revocare token in <https://www.npmjs.com/settings/pixu1980/tokens>.
3. **`scripts/release.mjs`** si ridurrebbe a: bump + CHANGELOG + tag + push (**senza** `npm publish` locale, senza `npm login`). La pubblicazione avviene in CI *staged*; l'umano approva da "Staged Packages" (menu utente npm) con 2FA hardware.
4. **Provenance**: ogni release successiva ottiene il badge e la firma OIDC ("generated by this workflow on this commit").
5. **drydock** (opzionale): account read-only per il diff del tarball prima dell'approvazione.

**Risultato**: nessun token da rubare, laptop compromesso ≠ package compromesso, gate manuale 2FA mantenuto
(staged approval), badge di fiducia su npmjs.com, processo "tag → approva" identico a quello descritto nella skill.

**Costi/contro**: la release non è più "un comando locale"; serve approvazione manuale per ogni release (da
vedere come feature, è il gate 2FA); primo setup manuale una tantum su npm (già documentato in `docs/security.md`).

### 4.C — Alternativa minima (mantenere release locali, ridurre il rischio laptop)

Se si vuole restare sul flow locale attuale, il minimo per avvicinarsi all'articolo è:
- 4.A per intero (in particolare `.devcontainer` + 2FA hardware),
- firma dei tag (`git tag -s`),
- non salvare mai il token in `~/.npmrc` persistente (usare `npm publish` interattivo con OTP),
- rendere la release un'operazione cosciente e isolata (macchina dedicata/container),
- accettare il gap **provenance/badge** come costo esplicito.

---

## 5. Riepilogo esecutivo

| Area | Stato |
|---|---|
| Quick win articolo (cooldown, pnpm 11, zizmor, SHA, no-build, no token CI, `--ignore-scripts`) | ✅ **fatto** |
| Checklist manuale GitHub/npm | ⚠️ **documentata, da completare** (unica azione davvero urgente, zero modifiche al repo) |
| Trusted + Staged Publishing, provenance | ❌ **assente per scelta** — il gap principale vs articolo/skill; migrazione in §4.B (richiede tocco a `scripts/release.mjs`) |
| jsDelivr ESM | ➖ **non applicabile per design** (pacchetti Node-only, sorgenti TS); nessuna azione |
| Vincolo utente (niente modifiche a deps/script/package.json) | ✅ **rispettato** — questo documento è l'unico file nuovo |

**Prossimo passo consigliato (zero codice)**: completare la checklist manuale di `docs/security.md` (punto 4.A.1),
eliminare `backup/pre-rewrite`, e — quando il vincolo sui script si allenta — valutare la migrazione 4.B,
che con questo repo (niente build step) è la più economica possibile: un solo workflow, nessun artifact,
`npm stage publish` con `id-token: write`.
