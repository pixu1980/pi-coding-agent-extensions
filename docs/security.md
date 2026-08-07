# npm Supply-Chain Security Checklist

Based on _[The secure way to release an npm package in 2026](https://evilmartians.com/chronicles/the-secure-way-to-release-an-npm-package-in-2026)_ by Evil Martians.

## Already active

- **Dependency cooldown**: `.npmrc` has `minimumReleaseAge=4320` (3 days) — requires pnpm ≥ 11.
- **Test CI**: `.github/workflows/ci.yaml` runs tests on every push to `main` and PRs.
- **CI workflow linting**: `.github/workflows/check-workflows.yaml` runs zizmor on all workflows.
- **Actions pinned by SHA commit**: all actions in workflows use SHA hashes, not tags.
- **`persist-credentials: false`**: every checkout step disables Git token persistence.
- **`--ignore-scripts`**: dependency `postinstall` scripts are not executed in CI.
- **pnpm 11**: `postinstall` scripts are disabled by default.

## ⚠️ Remaining manual actions (for you to do)

These operations require owner/admin permissions and must be done **manually**
once. The order is the recommended one.

---

### 1. GitHub: protect tag creation

→ <https://github.com/pixu1980/pi-coding-agent-extensions/settings/rules>

Click **New ruleset** → **New tag ruleset** and set:

| Field | Value |
|---|---|
| Ruleset Name | `Tags only by admins` |
| Enforcement status | `Active` |
| Bypass list | `Repository admins` |
| Target tags | `Include all tags` |

Then enable the only rule:

- ☑ **Restrict creations**

This prevents anyone except admins from creating tags. Since the release
starts from a `git tag` (see `scripts/release.mjs`), blocking tags
blocks the attack vector.

---

### 2. GitHub: enable Immutable Releases

→ <https://github.com/pixu1980/pi-coding-agent-extensions/settings>

Scroll to the **Releases** section and enable:

- ☑ **Immutable Releases**

Prevents an already-published release from being modified or deleted.

---

### 3. GitHub Organization: require 2FA for everyone

→ <https://github.com/organizations/pixu1980/settings/security>

Under **Authentication security**:

- ☑ **Require two-factor authentication for everyone in the organization**

If the `pixu1980` organization doesn't exist yet (personal repo), this step
applies to the individual GitHub account: verify 2FA is active at
<https://github.com/settings/security>.

---

### 4. npm: require 2FA on every public package

Open these pages in order and enable the flag on each:

- ☑ **Require two-factor authentication or automation tokens**

| Package | Settings link |
|---|---|
| `@pixu1980/pi-web` | <https://www.npmjs.com/package/@pixu1980/pi-web/access> |
| `@pixu1980/pi-mcp` | <https://www.npmjs.com/package/@pixu1980/pi-mcp/access> |
| `@pixu1980/pi-ask` | <https://www.npmjs.com/package/@pixu1980/pi-ask/access> |
| `@pixu1980/pi-path-picker` | <https://www.npmjs.com/package/@pixu1980/pi-path-picker/access> |
| `@pixu1980/pi-reasoning` | <https://www.npmjs.com/package/@pixu1980/pi-reasoning/access> |
| `@pixu1980/pi-sessions` | <https://www.npmjs.com/package/@pixu1980/pi-sessions/access> |
| `@pixu1980/pi-statusline` | <https://www.npmjs.com/package/@pixu1980/pi-statusline/access> |

---

### 5. npm account: enable personal 2FA

→ <https://www.npmjs.com/settings/pixu1980/tfa>

Enable **Two-Factor Authentication** on your personal npm account.
Prefer a **hardware key** (YubiKey) if available, otherwise a
TOTP app. 2FA is required to publish dual-use packages.

> ℹ️ **Do NOT disable tokens** ("disallow tokens" in publishing access
settings). This repo publishes locally via `npm login` +
`npm publish` — the token is needed. Disabling it would break releases.

---

### 6. Final check

After completing the 5 steps above, verify:

```bash
# Check that npm 2FA is active
npm whoami
# Should return your username without errors (means you logged in with 2FA)

# Simulate a release to verify everything works
node scripts/release.mjs --dry-run
```

## Dual-Use Content Policy

Packages with security-relevant capabilities must declare them via the `contentPolicy` field in `package.json` and include a `DISCLOSURE` file.

| Package | Dual-Use | Reason |
|---|---|---|
| `@pixu1980/pi-web` | ✅ | Arbitrary URL fetching, configurable SSRF bypass |
| `@pixu1980/pi-mcp` | ✅ | Process spawning, OAuth, network connections, keyring |
| `@pixu1980/pi-ask` | ❌ | Interactive UI only |
| `@pixu1980/pi-path-picker` | ❌ | Interactive UI only |
| `@pixu1980/pi-reasoning` | ❌ | Config management only |
| `@pixu1980/pi-sessions` | ❌ | UI overlay only |
| `@pixu1980/pi-statusline` | ❌ | UI display only |

### Requirements for dual-use packages

- **`contentPolicy: "dual-use"`** in `package.json` — required, persistent (cannot be removed in future versions)
- **`DISCLOSURE` file** in the package root — describes the dual-use capabilities and their legitimate use
- **2FA-enforced publishing** — our `npm login` + `npm publish` interactive flow satisfies this requirement (requires 2FA on the npm account)

The `scripts/release.mjs` script automatically validates the DISCLOSURE file presence for dual-use packages.

## Why we don't use Trusted Publishing / Staged Publishing

Trusted Publishing and `npm stage publish` require publishing from CI with `id-token: write`. This would require:

- Moving the entire release process to CI
- Configuring Trusted Publishing on npm for each package
- Disabling authentication tokens

We currently prefer to keep local releases (`scripts/release.mjs`) because:
- More control over the versioning and changelog process
- The maintainer has a YubiKey/npm 2FA for authentication
- Smaller attack surface: no CI workflow with publish permissions

## Updating actions

Run periodically to update action SHAs to the latest commits:

```bash
npx actions-up
```
