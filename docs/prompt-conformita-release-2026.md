# Prompt utente — Verifica conformità (2026-08-12)

> Prompt originale dell'utente, salvato su richiesta. Il documento correlato con
> l'analisi è `docs/compliance-study-2026.md`.

---

Vorrei controllare se questa libreria è compliant con [tre documenti]:

### 1. The secure way to release an npm package in 2026 (Evil Martians — Andrey Sitnik)

> Testo integrale dell'articolo: "The secure way to release an npm package in 2026",
> 28 luglio 2026. Copre: supply chain attacks sui pacchetti npm, Trusted Publishing,
> Staged Publishing (`npm stage publish`), 2FA, tag ruleset, pinning delle action per
> SHA (`actions-up`), CI linting con zizmor (`check-workflows.yaml`), dependency
> cooldown (`min-release-age` 3 giorni / pnpm `minimumReleaseAge=4320`), migrazione a
> npm 12 / pnpm 10 / yarn 4.14 / bun, workflow `publish.yaml` (test → build → publish
> con `id-token: write` solo nel job publish, `--ignore-scripts`, `package-manager-cache: false`),
> best practice "nessun build step" (Nano ID), GitHub protection rules (immutable releases),
> Harden Runner, Dev Container, riduzione dipendenze (e18e).

### 2. Skill `secure-npm-package`

> Testo integrale della skill: setup di un processo di release sicuro senza token da rubare,
> release solo da un unico workflow CI, approvazione manuale con 2FA. Ordine rigoroso:
> Step 1 raccolta fatti (read-only) → domande tutte insieme → Step 2 impostazioni manuali
> su npmjs.com e github.com con link risolti (Trusted Publisher stage-only, disallow tokens,
> 2FA, tag ruleset "Tags only by admins", Immutable Releases) → attesa conferma utente →
> Step 3 modifiche repo (`publish.yaml`, zizmor, `check-workflows.yaml`, cooldown,
> postinstall disabilitati). Include: pacchetti non ancora pubblicati, specifiche monorepo
> (`npm stage publish --workspaces`, hack `--omit=dev`), flusso di release finale
> (tag → CI staged → approvazione) e checklist finale.

### 3. Making More npm Packages Work with jsDelivr ESM mode (Martin Kolárik, 08 ago 2026)

> Testo integrale dell'articolo jsDelivr `/ +esm`: upgrade a Rollup 4 e backend ESM,
> JSON import attributes, top-level await con `"type": "module"`, sostituzione
> `NODE_ENV` in più forme, shebang `#!`, self-mapping del campo `browser`, long tail
> CommonJS exports (`__exportStar`, conditional exports, cjs-module-lexer combinati,
> string-literal re-exports, esterni ESM), asset relativi con `import.meta.url` (QuickJS,
> Box2D-WASM), source map (pixi-filters), tree-shaking dei built-in Node non supportati,
> polyfill layer Node.js (16 fix), minificazione esbuild, JSX non supportato, conclusione
> su pacchetti che richiedono ancora Node/React Native/build step applicativo.

---

### Vincolo

Il tutto **senza cambiare dipendenze e/o comandi package.json e/o scripts** che devono
rimanere inalterati. Al massimo fai uno studio di come potrebbe o dovrebbe essere
modificata la libreria, per capire come siamo messi.
