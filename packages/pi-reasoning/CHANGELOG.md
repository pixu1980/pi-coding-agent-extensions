# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

### [0.2.2](https://github.com/pixu1980/pi-coding-agent-extensions/compare/@pixu1980/pi-reasoning@0.2.1...@pixu1980/pi-reasoning@0.2.2) (2026-07-15)


### Bug Fixes

* **pi-path-picker:** isolate tab completion ([2412c56](https://github.com/pixu1980/pi-coding-agent-extensions/commit/2412c5693aa200547856df8f7ca1c2533a98062b))
* **pi-reasoning:** unify model-aware menus ([ed5fa62](https://github.com/pixu1980/pi-coding-agent-extensions/commit/ed5fa62972a2f1390787d5387c42f30912ccd8b2))

### [0.2.1](https://github.com/pixu1980/pi-coding-agent-extensions/compare/@pixu1980/pi-reasoning@0.1.1...@pixu1980/pi-reasoning@0.2.1) (2026-07-11)


### Features

* **pi-reasoning:** add model-aware argument autocomplete to /reasoning command ([50faea8](https://github.com/pixu1980/pi-coding-agent-extensions/commit/50faea8184a689f5742d868d67746be0e1da52a1))
* **pi-reasoning:** update reasoning menu based on real available reasoning levels per model ([29beea7](https://github.com/pixu1980/pi-coding-agent-extensions/commit/29beea7b3a71c8efddbd9b305e3107df6f899a21))
* remove pi-sessions package ([98def63](https://github.com/pixu1980/pi-coding-agent-extensions/commit/98def63a513f89220a1fc29c0083efa9e79d9126))


### Bug Fixes

* **pi-path-picker:** delega al provider nativo fuori apici + /reasoning autocomplete ([4dc418f](https://github.com/pixu1980/pi-coding-agent-extensions/commit/4dc418f6d7d937b6770bea40bb5288898b2647db))

### 0.2.0 (2026-07-11)


### Bug Fixes

* **pi-reasoning:** fix `xhigh` appearing for models that don't support it ([#1](https://github.com/pixu1980/pi-coding-agent-extensions/issues/1))
- `getAvailableLevels()` ora rispetta il native `thinkingLevelMap` di pi.dev
- Quando `thinkingLevelMap` è assente, non offre più `xhigh`/`max` di default
- Auto-apply verifica il livello contro le capacità reali del modello


### 0.1.1 (2026-07-11)


### Features

* **extensions:** add pi-sessions, fix release script ([5b00e69](https://github.com/pixu1980/pi-coding-agent-extensions/commit/5b00e697c9582881a07c514ef2407a97870e6c26))
* **path-picker:** add pi-path-picker extension ([a4e6dec](https://github.com/pixu1980/pi-coding-agent-extensions/commit/a4e6dec7e5623fd059d399aa257c13abbb9b266a))
* **path-picker:** remove path_pick tool ([6701c52](https://github.com/pixu1980/pi-coding-agent-extensions/commit/6701c52bc8e272d5720bd00c5b05e01438e4c1cf))
* **path-picker:** update package.json ([4cab5dd](https://github.com/pixu1980/pi-coding-agent-extensions/commit/4cab5dd539603f80d98cb937f45293ecdb1cb987))
* **pi-path-picker:** remove /pick command, fix autocomplete close on quote delete ([fb123d4](https://github.com/pixu1980/pi-coding-agent-extensions/commit/fb123d406537a1617303893ee7ff273dfdd0f79d))
* **pi-reasoning:** add extension for automatic reasoning level management ([7fad40e](https://github.com/pixu1980/pi-coding-agent-extensions/commit/7fad40eae4927702b1907c4fb2e22c3c0abbfe38))
* **pi-sessions:** add session history overlay extension ([a33e8d0](https://github.com/pixu1980/pi-coding-agent-extensions/commit/a33e8d04983a2c35a358ad7dbf8b5f77df30ed87))
* **pi-sessions:** rename /sessions-folders to /projects ([19a578f](https://github.com/pixu1980/pi-coding-agent-extensions/commit/19a578fd73bbcac2fce335fd69fc6c8da3386742))


### Bug Fixes

* **npmrc:** fix npmrc config file ([42ce0f9](https://github.com/pixu1980/pi-coding-agent-extensions/commit/42ce0f9d46e54ca819837ab6196ae9f8fd926b15))
* **path-picker:** fix paths with spaces autocomplete ([1eb3335](https://github.com/pixu1980/pi-coding-agent-extensions/commit/1eb3335c112eec488ec487f90777cab1fe45ae0b))
* **path-picker:** update README.md ([0184aba](https://github.com/pixu1980/pi-coding-agent-extensions/commit/0184aba8f1d1ba7441a1fd12cf5aa832f215ea92))
* **pi-path-picker:** prevent autocomplete interference with pi.dev commands ([9013840](https://github.com/pixu1980/pi-coding-agent-extensions/commit/9013840dc157e11309fab97437c380759a09118a))
* **pi-path-picker:** prevent path autocomplete outside quoted strings ([c181680](https://github.com/pixu1980/pi-coding-agent-extensions/commit/c18168018357d1f92665a49145415a4a523572de))
