# npm Supply-Chain Security Checklist

Basato su _[The secure way to release an npm package in 2026](https://evilmartians.com/chronicles/the-secure-way-to-release-an-npm-package-in-2026)_ di Evil Martians.

## Cosa è già attivo

- **Dependency cooldown**: `.npmrc` ha `minimumReleaseAge=4320` (3 giorni) — richiede pnpm ≥ 11.
- **CI di test**: `.github/workflows/ci.yaml` esegue test su ogni push a `main` e PR.
- **CI workflow linting**: `.github/workflows/check-workflows.yaml` esegue zizmor su tutti i workflow.
- **Action pinnate via SHA commit**: tutte le action nei workflow usano hash SHA, non tag.
- **`persist-credentials: false`**: ogni step di checkout disabilita la persistenza del token Git.
- **`--ignore-scripts`**: gli script `postinstall` delle dipendenze non vengono eseguiti in CI.
- **pnpm 11**: i `postinstall` scripts sono disabilitati di default.

## ⚠️ Azioni manuali rimanenti (da fare tu)

Queste operazioni richiedono i permessi owner/admin e vanno fatte **manualmente**
una volta sola. L'ordine è quello consigliato.

---

### 1. GitHub: proteggere la creazione dei tag

→ <https://github.com/pixu1980/pi-coding-agent-extensions/settings/rules>

Premi **New ruleset** → **New tag ruleset** e imposta:

| Campo | Valore |
|---|---|
| Ruleset Name | `Tags only by admins` |
| Enforcement status | `Active` |
| Bypass list | `Repository admins` |
| Target tags | `Include all tags` |

Poi attiva l'unica regola:

- ☑ **Restrict creations**

Questo impedisce a chiunque tranne gli admin di creare tag. Dato che la release
parte proprio da un `git tag` (vedi `scripts/release.mjs`), bloccare i tag
blocca il vettore d'attacco.

---

### 2. GitHub: abilitare Immutable Releases

→ <https://github.com/pixu1980/pi-coding-agent-extensions/settings>

Scorri fino alla sezione **Releases** e attiva:

- ☑ **Immutable Releases**

Impedisce che un release già pubblicato venga modificato o cancellato.

---

### 3. GitHub Organization: richiedere 2FA per tutti

→ <https://github.com/organizations/pixu1980/settings/security>

Nella sezione **Authentication security**:

- ☑ **Require two-factor authentication for everyone in the organization**

Se l'organizzazione `pixu1980` non esiste ancora (repo personale), questo passo
si applica al singolo account GitHub: verifica che la 2FA sia attiva su
<https://github.com/settings/security>.

---

### 4. npm: richiedere 2FA su ogni pacchetto pubblico

Apri in successione queste pagine e per ognuna attiva il flag:

- ☑ **Require two-factor authentication or automation tokens**

| Pacchetto | Link impostazioni |
|---|---|
| `@pixu1980/pi-web` | <https://www.npmjs.com/package/@pixu1980/pi-web/access> |
| `@pixu1980/pi-mcp` | <https://www.npmjs.com/package/@pixu1980/pi-mcp/access> |
| `@pixu1980/pi-ask` | <https://www.npmjs.com/package/@pixu1980/pi-ask/access> |
| `@pixu1980/pi-path-picker` | <https://www.npmjs.com/package/@pixu1980/pi-path-picker/access> |
| `@pixu1980/pi-reasoning` | <https://www.npmjs.com/package/@pixu1980/pi-reasoning/access> |
| `@pixu1980/pi-sessions` | <https://www.npmjs.com/package/@pixu1980/pi-sessions/access> |
| `@pixu1980/pi-statusline` | <https://www.npmjs.com/package/@pixu1980/pi-statusline/access> |

---

### 5. npm account: attivare 2FA personale

→ <https://www.npmjs.com/settings/pixu1980/tfa>

Attiva la **Two-Factor Authentication** sul tuo account npm personale.
Preferisci una **hardware key** (YubiKey) se disponibile, altrimenti
un'app TOTP. La 2FA è obbligatoria per pubblicare pacchetti dual-use.

> ℹ️ **NON disabilitare i token** ("disallow tokens" nelle impostazioni
di publishing access). Questa repo pubblica da locale con `npm login` +
`npm publish` — il token è necessario. Disabilitarlo bloccherebbe le release.

---

### 6. Verifica finale

Dopo aver completato i 5 passi sopra, verifica:

```bash
# Controlla che la 2FA npm sia attiva
npm whoami
# Deve restituire il tuo username senza errori (vuol dire che hai fatto login con 2FA)

# Simula una release per verificare che tutto funzioni
node scripts/release.mjs --dry-run
```

## Dual-Use Content Policy

I pacchetti con capacità security-relevant devono dichiararlo tramite il campo `contentPolicy` in `package.json` e includere un file `DISCLOSURE`.

| Pacchetto | Dual-Use | Motivazione |
|---|---|---|
| `@pixu1980/pi-web` | ✅ | Fetch arbitrario di URL, bypass SSRF configurabile |
| `@pixu1980/pi-mcp` | ✅ | Process spawning, OAuth, connessioni di rete, keyring |
| `@pixu1980/pi-ask` | ❌ | Solo UI interattiva |
| `@pixu1980/pi-path-picker` | ❌ | Solo UI interattiva |
| `@pixu1980/pi-reasoning` | ❌ | Solo config management |
| `@pixu1980/pi-sessions` | ❌ | Solo UI overlay |
| `@pixu1980/pi-statusline` | ❌ | Solo UI display |

### Requisiti per pacchetti dual-use

- **`contentPolicy: "dual-use"`** in `package.json` — obbligatorio, persistente (non rimuovibile nelle versioni future)
- **File `DISCLOSURE`** nella root del package — descrive le capability dual-use e il loro uso legittimo
- **Pubblicazione con 2FA obbligatoria** — il nostro `npm login` + `npm publish` interattivo soddisfa questo requisito (richiede 2FA sull'account npm)

Lo script `scripts/release.mjs` valida automaticamente la presenza del file DISCLOSURE per i pacchetti dual-use.

## Perché non usiamo Trusted Publishing / Staged Publishing

Trusted Publishing e `npm stage publish` richiedono che la pubblicazione avvenga da CI con `id-token: write`. Questo richiederebbe di:

- Spostare tutto il processo di release in CI
- Configurare Trusted Publishing su npm per ogni package
- Disabilitare i token di autenticazione

Al momento preferiamo mantenere il rilascio locale (`scripts/release.mjs`) perché:
- Maggior controllo sul processo di versioning e changelog
- Il maintainer ha una YubiKey/npm 2FA per l'autenticazione
- Meno superficie d'attacco: nessun workflow CI con permessi di pubblicazione

## Aggiornare le action

Ogni tanto esegui per aggiornare gli SHA delle action ai commit più recenti:

```bash
npx actions-up
```
