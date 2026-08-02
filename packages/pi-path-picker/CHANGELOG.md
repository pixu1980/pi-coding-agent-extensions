# Changelog

All notable changes to this project will be documented in this file. See [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for commit guidelines.

## [0.1.18](https://github.com/pixu1980/pi-coding-agent-extensions/compare/@pixu1980/pi-path-picker@0.1.17...@pixu1980/pi-path-picker@0.1.18) (2026-08-02)
## [0.1.17](https://github.com/pixu1980/pi-coding-agent-extensions/compare/@pixu1980/pi-path-picker@0.1.16...@pixu1980/pi-path-picker@0.1.17) (2026-08-02)

### Features

* **pi-ask:** merge grill into ask/interview with natural-language keywords ([505ceea](https://github.com/pixu1980/pi-coding-agent-extensions/commit/505ceea505b0197cbdcb10bf4820623536de8c4c))
* **pi-ask:** rename questionnaire to interview with sequential waves, grill mode and guardrails ([6163152](https://github.com/pixu1980/pi-coding-agent-extensions/commit/61631523a549cc639600dcdbe02c62e5dc7efa87))
## [0.1.16](https://github.com/pixu1980/pi-coding-agent-extensions/compare/@pixu1980/pi-path-picker@0.1.15...@pixu1980/pi-path-picker@0.1.16) (2026-08-01)

### Features

* **pi-ask:** add interactive ask and questionnaire tools ([8988b1e](https://github.com/pixu1980/pi-coding-agent-extensions/commit/8988b1e4ff2de0bb313165049f50f730873df02d))
* **pi-mcp:** bare dash-separated slash commands with toolPrefix none ([3b3eb57](https://github.com/pixu1980/pi-coding-agent-extensions/commit/3b3eb57d3abb1a50b20749a99e8e23c0b9523533))
* **pi-statusline:** add full-label responsive level for wide terminals ([dda2fdb](https://github.com/pixu1980/pi-coding-agent-extensions/commit/dda2fdb0ce57974bb42f1dd560cc7df6c59b15e6))
* **pi-statusline:** add responsive auto format ([714350f](https://github.com/pixu1980/pi-coding-agent-extensions/commit/714350fbc3f855752ab6ea6aed64530de3c19bbe))

### Bug Fixes

* **pi-mcp:** skip load-time init when extension runtime is not bound ([e0d6137](https://github.com/pixu1980/pi-coding-agent-extensions/commit/e0d61378b68b35476b50aa26c51f180063d49c55))
* **pi-statusline:** truncate widget and footer lines to terminal width ([2bf4424](https://github.com/pixu1980/pi-coding-agent-extensions/commit/2bf4424d9600eed7eec56ace0e6ddecb3c6c54e0))
## [0.1.15](https://github.com/pixu1980/pi-coding-agent-extensions/compare/@pixu1980/pi-path-picker@0.1.14...@pixu1980/pi-path-picker@0.1.15) (2026-08-01)

### Features

* **pi-sessions:** move session browser into a centered modal ([07cd24b](https://github.com/pixu1980/pi-coding-agent-extensions/commit/07cd24b08e6861e499494bf2617995aec96ea5ce))
* **pi-web:** add URL-to-Markdown scraper extension ([6018991](https://github.com/pixu1980/pi-coding-agent-extensions/commit/6018991702d8492d3adb62a76b7d68c1f9e57776))

### Bug Fixes

* **deps:** drop deprecated standard-version and patch vulnerable transitive deps ([eb29054](https://github.com/pixu1980/pi-coding-agent-extensions/commit/eb290548ede0f710fcfb7908569734162772500a))
* **pi-mcp:** export default extension factory from entry points ([91ee444](https://github.com/pixu1980/pi-coding-agent-extensions/commit/91ee44427d78bf92eafe590f13aaa9ef03da4b48))
* **pi-mcp:** restore pi 0.83 peer deps, fix type regressions and add tests ([4f26256](https://github.com/pixu1980/pi-coding-agent-extensions/commit/4f2625610ca0c18b00b39a9b0ebf1f6db7ef8b77))
* **pi-mcp:** surface skipped invalid host configs in discovery ([9ced5d8](https://github.com/pixu1980/pi-coding-agent-extensions/commit/9ced5d8e04a64ebad99aa38f6968491c7e414e87))
* **pi-path-picker:** import autocomplete types from pi-tui and port tests to tsx ([1429eac](https://github.com/pixu1980/pi-coding-agent-extensions/commit/1429eac2a71701da634a72b2d5064a77d8e86126))
* **pi-reasoning:** align notify typing, export internals and add test suite ([4da7523](https://github.com/pixu1980/pi-coding-agent-extensions/commit/4da75234562cf12bddf7c99a8c1c3288718c9e0e))
* **pi-sessions:** export internals for testing and add unit/e2e test suite ([c20f2d1](https://github.com/pixu1980/pi-coding-agent-extensions/commit/c20f2d128e07ac4a4f602b67328ba186e3e72d92))
* **pi-statusline:** restore gallery metadata, fix typing and add test suite ([21c6044](https://github.com/pixu1980/pi-coding-agent-extensions/commit/21c60444b56205211dee56d74029cad3947b3596))
* **pi-web:** repair session cache restore and add extension e2e tests ([657f82c](https://github.com/pixu1980/pi-coding-agent-extensions/commit/657f82c89606e92964d81493df01f419598731e4))
### [0.1.14](https://github.com/pixu1980/pi-coding-agent-extensions/compare/@pixu1980/pi-path-picker@0.1.13...@pixu1980/pi-path-picker@0.1.14) (2026-08-01)

### [0.1.13](https://github.com/pixu1980/pi-coding-agent-extensions/compare/@pixu1980/pi-path-picker@0.1.12...@pixu1980/pi-path-picker@0.1.13) (2026-08-01)


### Features

* **pi-mcp:** add MCP adapter extension ([eb1e2ed](https://github.com/pixu1980/pi-coding-agent-extensions/commit/eb1e2ed5dc7cdc3326816115402f33acf578474b))
* **pi-statusline:** add statusline extension ([ab895ec](https://github.com/pixu1980/pi-coding-agent-extensions/commit/ab895ec95df9554b916352e1e9c75bd0736a5460))


### Bug Fixes

* **release:** preserve first package version ([d3b6c81](https://github.com/pixu1980/pi-coding-agent-extensions/commit/d3b6c81661867e1d9ada1272a30644f9a814f005))
* **release:** use local standard-version ([1934fff](https://github.com/pixu1980/pi-coding-agent-extensions/commit/1934fff0a2973c4f441304be4d28f9f633d64db5))

### [0.1.12](https://github.com/pixu1980/pi-coding-agent-extensions/compare/@pixu1980/pi-path-picker@0.1.11...@pixu1980/pi-path-picker@0.1.12) (2026-07-15)

### [0.1.11](https://github.com/pixu1980/pi-coding-agent-extensions/compare/@pixu1980/pi-path-picker@0.1.10...@pixu1980/pi-path-picker@0.1.11) (2026-07-15)


### Features

* **pi-reasoning:** add model-aware argument autocomplete to /reasoning command ([50faea8](https://github.com/pixu1980/pi-coding-agent-extensions/commit/50faea8184a689f5742d868d67746be0e1da52a1))
* **pi-reasoning:** update reasoning menu based on real available reasoning levels per model ([29beea7](https://github.com/pixu1980/pi-coding-agent-extensions/commit/29beea7b3a71c8efddbd9b305e3107df6f899a21))


### Bug Fixes

* **pi-path-picker:** isolate tab completion ([2412c56](https://github.com/pixu1980/pi-coding-agent-extensions/commit/2412c5693aa200547856df8f7ca1c2533a98062b))
* **pi-reasoning:** unify model-aware menus ([ed5fa62](https://github.com/pixu1980/pi-coding-agent-extensions/commit/ed5fa62972a2f1390787d5387c42f30912ccd8b2))

### [0.1.10](https://github.com/pixu1980/pi-coding-agent-extensions/compare/@pixu1980/pi-path-picker@0.1.9...@pixu1980/pi-path-picker@0.1.10) (2026-07-11)


### Features

* remove pi-sessions package ([98def63](https://github.com/pixu1980/pi-coding-agent-extensions/commit/98def63a513f89220a1fc29c0083efa9e79d9126))


### Bug Fixes

* **pi-path-picker:** delega al provider nativo fuori apici + /reasoning autocomplete ([4dc418f](https://github.com/pixu1980/pi-coding-agent-extensions/commit/4dc418f6d7d937b6770bea40bb5288898b2647db))

### [0.1.9](https://github.com/pixu1980/pi-coding-agent-extensions/compare/@pixu1980/pi-path-picker@0.1.8...@pixu1980/pi-path-picker@0.1.9) (2026-07-11)

### [0.1.8](https://github.com/pixu1980/pi-coding-agent-extensions/compare/@pixu1980/pi-path-picker@0.1.7...@pixu1980/pi-path-picker@0.1.8) (2026-07-11)


### Features

* **pi-reasoning:** add extension for automatic reasoning level management ([7fad40e](https://github.com/pixu1980/pi-coding-agent-extensions/commit/7fad40eae4927702b1907c4fb2e22c3c0abbfe38))


### Bug Fixes

* **pi-path-picker:** prevent autocomplete interference with pi.dev commands ([9013840](https://github.com/pixu1980/pi-coding-agent-extensions/commit/9013840dc157e11309fab97437c380759a09118a))

### [0.1.7](https://github.com/pixu1980/pi-coding-agent-extensions/compare/@pixu1980/pi-path-picker@0.1.6...@pixu1980/pi-path-picker@0.1.7) (2026-07-07)


### Bug Fixes

* **path-picker:** update README.md ([0184aba](https://github.com/pixu1980/pi-coding-agent-extensions/commit/0184aba8f1d1ba7441a1fd12cf5aa832f215ea92))

### [0.1.6](https://github.com/pixu1980/pi-coding-agent-extensions/compare/@pixu1980/pi-path-picker@0.1.5...@pixu1980/pi-path-picker@0.1.6) (2026-07-07)


### Bug Fixes

* **npmrc:** fix npmrc config file ([42ce0f9](https://github.com/pixu1980/pi-coding-agent-extensions/commit/42ce0f9d46e54ca819837ab6196ae9f8fd926b15))

### 0.1.5 (2026-07-07)


### Features

* **extensions:** add pi-sessions, fix release script ([5b00e69](https://github.com/pixu1980/pi-coding-agent-extensions/commit/5b00e697c9582881a07c514ef2407a97870e6c26))
* **path-picker:** add pi-path-picker extension ([a4e6dec](https://github.com/pixu1980/pi-coding-agent-extensions/commit/a4e6dec7e5623fd059d399aa257c13abbb9b266a))
* **path-picker:** remove path_pick tool ([6701c52](https://github.com/pixu1980/pi-coding-agent-extensions/commit/6701c52bc8e272d5720bd00c5b05e01438e4c1cf))
* **path-picker:** update package.json ([4cab5dd](https://github.com/pixu1980/pi-coding-agent-extensions/commit/4cab5dd539603f80d98cb937f45293ecdb1cb987))
* **pi-path-picker:** remove /pick command, fix autocomplete close on quote delete ([fb123d4](https://github.com/pixu1980/pi-coding-agent-extensions/commit/fb123d406537a1617303893ee7ff273dfdd0f79d))
* **pi-sessions:** add session history overlay extension ([a33e8d0](https://github.com/pixu1980/pi-coding-agent-extensions/commit/a33e8d04983a2c35a358ad7dbf8b5f77df30ed87))
* **pi-sessions:** rename /sessions-folders to /projects ([19a578f](https://github.com/pixu1980/pi-coding-agent-extensions/commit/19a578fd73bbcac2fce335fd69fc6c8da3386742))


### Bug Fixes

* **path-picker:** fix paths with spaces autocomplete ([1eb3335](https://github.com/pixu1980/pi-coding-agent-extensions/commit/1eb3335c112eec488ec487f90777cab1fe45ae0b))
* **pi-path-picker:** prevent path autocomplete outside quoted strings ([c181680](https://github.com/pixu1980/pi-coding-agent-extensions/commit/c18168018357d1f92665a49145415a4a523572de))

### [0.1.4](https://github.com/pixu1980/pi-coding-agent-extensions/compare/v0.1.3...v0.1.4) (2026-07-02)

### [0.1.3](https://github.com/pixu1980/pi-coding-agent-extensions/compare/v0.1.1...v0.1.3) (2026-07-02)


### Features

* **path-picker:** remove path_pick tool ([6701c52](https://github.com/pixu1980/pi-coding-agent-extensions/commit/6701c52bc8e272d5720bd00c5b05e01438e4c1cf))

### [0.1.2](https://github.com/pixu1980/pi-coding-agent-extensions/compare/v0.1.1...v0.1.2) (2026-07-02)


### Features

* **path-picker:** remove path_pick tool ([6701c52](https://github.com/pixu1980/pi-coding-agent-extensions/commit/6701c52bc8e272d5720bd00c5b05e01438e4c1cf))

### 0.1.1 (2026-06-28)


### Features

* **path-picker:** add pi-path-picker extension ([a4e6dec](https://github.com/pixu1980/pi-coding-agent-extensions/commit/a4e6dec7e5623fd059d399aa257c13abbb9b266a))
* **path-picker:** update package.json ([4cab5dd](https://github.com/pixu1980/pi-coding-agent-extensions/commit/4cab5dd539603f80d98cb937f45293ecdb1cb987))


### Bug Fixes

* **path-picker:** fix paths with spaces autocomplete ([1eb3335](https://github.com/pixu1980/pi-coding-agent-extensions/commit/1eb3335c112eec488ec487f90777cab1fe45ae0b))
