# Changelog

All notable changes to this project will be documented in this file. See [commit-and-tag-version](https://github.com/absolute-version/commit-and-tag-version) for commit guidelines.

## [0.1.8](https://github.com/pixu1980/pi-coding-agent-extensions/compare/@pixu1980/pi-web@0.1.7...@pixu1980/pi-web@0.1.8) (2026-09-16)

### Bug Fixes

* **lint:** clear the correctness rules and the small style rules ([b49a599](https://github.com/pixu1980/pi-coding-agent-extensions/commit/b49a5997bddeedc7879897518423909011f9757a))
* **lint:** take the mechanical style rules and re-enable what is clean ([b5b11da](https://github.com/pixu1980/pi-coding-agent-extensions/commit/b5b11da60b9f5fcee8b0e86773bce8c98b0174b3))
* **packages:** describe the root package as what it is ([ea4f6bc](https://github.com/pixu1980/pi-coding-agent-extensions/commit/ea4f6bc8f50f0c872c0b3fd559966e0cd1bef947))
* **packages:** require the node version pi itself requires ([99ff790](https://github.com/pixu1980/pi-coding-agent-extensions/commit/99ff790ea910ac1c6499f5a99bae5aaa419dc577))
* **packaging:** ship the license text in every published package ([8a40274](https://github.com/pixu1980/pi-coding-agent-extensions/commit/8a40274fc51bb42b53df167655ef3fc0c4712100))
* **pi-web:** typecheck the entry point instead of a stale file list ([751751b](https://github.com/pixu1980/pi-coding-agent-extensions/commit/751751b65edef8dfaa05158e4a472a3f3b0c0542))
* **pnpm:** declare allowBuilds so every package script runs again ([a051440](https://github.com/pixu1980/pi-coding-agent-extensions/commit/a0514406ea21bf2f45535784e9388154879c1eb8))
* **release:** report what a dry run would release ([a7700e5](https://github.com/pixu1980/pi-coding-agent-extensions/commit/a7700e5d1e9f2245e702b6c14ee11092a83f864c))

## [0.1.7](https://github.com/pixu1980/pi-coding-agent-extensions/compare/@pixu1980/pi-web@0.1.6...@pixu1980/pi-web@0.1.7) (2026-09-15)

### Features

* **path-picker:** fix suggestions list ([34ebdca](https://github.com/pixu1980/pi-coding-agent-extensions/commit/34ebdca83b18a349f083e3a26ff61dc221f8bb58))
* **pi-ask:** complete paths in the ask and interview editors ([98b2264](https://github.com/pixu1980/pi-coding-agent-extensions/commit/98b226437a9f5f2d951f6f2f063bcd94374093ee))
* **pi-cursor:** add Cursor API key provider extension ([74e9d5e](https://github.com/pixu1980/pi-coding-agent-extensions/commit/74e9d5ef12ba335fad4cd4853d8c2e0db8f16736))
* **pi-cursor:** keep local agents working on a Free Cursor plan ([2202763](https://github.com/pixu1980/pi-coding-agent-extensions/commit/2202763d399ff26d0523fe495f9eb44e21070127))
* **pi-path-picker:** publish the autocomplete provider over the event bus ([c0ea384](https://github.com/pixu1980/pi-coding-agent-extensions/commit/c0ea384b4afc52bcf0e53a4502fd18ca32683286))
* **pi-reasoning:** share the /effort menu and derive level labels from one rule ([c66dfc0](https://github.com/pixu1980/pi-coding-agent-extensions/commit/c66dfc093afa9ee73ce95ec46a8aeecca0483464))

### Bug Fixes

* **pi-statusline:** match pi-reasoning's effort emoji and measure width by grapheme ([763ef16](https://github.com/pixu1980/pi-coding-agent-extensions/commit/763ef169381641ad336237167bbf4085f45215d9))
* **release:** release only packages with real changes since last tag ([6a6e21c](https://github.com/pixu1980/pi-coding-agent-extensions/commit/6a6e21c1cc89977be027cb9bd65d3720e5f9837c))
## [0.1.6](https://github.com/pixu1980/pi-coding-agent-extensions/compare/@pixu1980/pi-web@0.1.5...@pixu1980/pi-web@0.1.6) (2026-08-25)

### Features

* **pi-ask:** localize interview progress labels to the chat language ([b320cbd](https://github.com/pixu1980/pi-coding-agent-extensions/commit/b320cbd8d6f1b6f2e5569453131a7356ae57ab89))
* **pi-path-picker:** detailed mode lists every file and directory on second Tab ([26eb0a6](https://github.com/pixu1980/pi-coding-agent-extensions/commit/26eb0a66a9efd9a1fd1962cb26c837d6fb902524))
## [0.1.5](https://github.com/pixu1980/pi-coding-agent-extensions/compare/@pixu1980/pi-web@0.1.4...@pixu1980/pi-web@0.1.5) (2026-08-07)

### Features

* **pi-mcp:** display instant help for MCP prompt commands ([1bde004](https://github.com/pixu1980/pi-coding-agent-extensions/commit/1bde004c862be9224f7b10968e0752c54adb034b))
## [0.1.4](https://github.com/pixu1980/pi-coding-agent-extensions/compare/@pixu1980/pi-web@0.1.3...@pixu1980/pi-web@0.1.4) (2026-08-02)

### Bug Fixes

* **release:** prompt for npm login ([f7ee4b1](https://github.com/pixu1980/pi-coding-agent-extensions/commit/f7ee4b10c89df35158fb2c3e9bfbbf57a5340efe))
* **release:** publish packages locally ([31a922e](https://github.com/pixu1980/pi-coding-agent-extensions/commit/31a922e9c1e04b584f66544cab1a00edbb8b4c61))
## [0.1.3](https://github.com/pixu1980/pi-coding-agent-extensions/compare/@pixu1980/pi-web@0.1.2...@pixu1980/pi-web@0.1.3) (2026-08-02)
## [0.1.2](https://github.com/pixu1980/pi-coding-agent-extensions/compare/@pixu1980/pi-web@0.1.1...@pixu1980/pi-web@0.1.2) (2026-08-02)

### Features

* **pi-ask:** merge grill into ask/interview with natural-language keywords ([505ceea](https://github.com/pixu1980/pi-coding-agent-extensions/commit/505ceea505b0197cbdcb10bf4820623536de8c4c))
* **pi-ask:** rename ask flow to interview with sequential waves, grill mode and guardrails ([6163152](https://github.com/pixu1980/pi-coding-agent-extensions/commit/61631523a549cc639600dcdbe02c62e5dc7efa87))
## [0.1.1](https://github.com/pixu1980/pi-coding-agent-extensions/compare/@pixu1980/pi-web@0.1.0...@pixu1980/pi-web@0.1.1) (2026-08-01)

### Features

* **pi-ask:** add interactive ask and interview tools ([8988b1e](https://github.com/pixu1980/pi-coding-agent-extensions/commit/8988b1e4ff2de0bb313165049f50f730873df02d))
* **pi-mcp:** bare dash-separated slash commands with toolPrefix none ([3b3eb57](https://github.com/pixu1980/pi-coding-agent-extensions/commit/3b3eb57d3abb1a50b20749a99e8e23c0b9523533))
* **pi-statusline:** add full-label responsive level for wide terminals ([dda2fdb](https://github.com/pixu1980/pi-coding-agent-extensions/commit/dda2fdb0ce57974bb42f1dd560cc7df6c59b15e6))
* **pi-statusline:** add responsive auto format ([714350f](https://github.com/pixu1980/pi-coding-agent-extensions/commit/714350fbc3f855752ab6ea6aed64530de3c19bbe))

### Bug Fixes

* **pi-mcp:** skip load-time init when extension runtime is not bound ([e0d6137](https://github.com/pixu1980/pi-coding-agent-extensions/commit/e0d61378b68b35476b50aa26c51f180063d49c55))
* **pi-statusline:** truncate widget and footer lines to terminal width ([2bf4424](https://github.com/pixu1980/pi-coding-agent-extensions/commit/2bf4424d9600eed7eec56ace0e6ddecb3c6c54e0))
## 0.1.0 (2026-08-01)

### Features

* **extensions:** add pi-sessions, fix release script ([5b00e69](https://github.com/pixu1980/pi-coding-agent-extensions/commit/5b00e697c9582881a07c514ef2407a97870e6c26))
* **path-picker:** add pi-path-picker extension ([a4e6dec](https://github.com/pixu1980/pi-coding-agent-extensions/commit/a4e6dec7e5623fd059d399aa257c13abbb9b266a))
* **path-picker:** remove path_pick tool ([6701c52](https://github.com/pixu1980/pi-coding-agent-extensions/commit/6701c52bc8e272d5720bd00c5b05e01438e4c1cf))
* **path-picker:** update package.json ([4cab5dd](https://github.com/pixu1980/pi-coding-agent-extensions/commit/4cab5dd539603f80d98cb937f45293ecdb1cb987))
* **pi-mcp:** add MCP adapter extension ([eb1e2ed](https://github.com/pixu1980/pi-coding-agent-extensions/commit/eb1e2ed5dc7cdc3326816115402f33acf578474b))
* **pi-path-picker:** remove /pick command, fix autocomplete close on quote delete ([fb123d4](https://github.com/pixu1980/pi-coding-agent-extensions/commit/fb123d406537a1617303893ee7ff273dfdd0f79d))
* **pi-reasoning:** add extension for automatic reasoning level management ([7fad40e](https://github.com/pixu1980/pi-coding-agent-extensions/commit/7fad40eae4927702b1907c4fb2e22c3c0abbfe38))
* **pi-reasoning:** add model-aware argument autocomplete to /reasoning command ([50faea8](https://github.com/pixu1980/pi-coding-agent-extensions/commit/50faea8184a689f5742d868d67746be0e1da52a1))
* **pi-reasoning:** update reasoning menu based on real available reasoning levels per model ([29beea7](https://github.com/pixu1980/pi-coding-agent-extensions/commit/29beea7b3a71c8efddbd9b305e3107df6f899a21))
* **pi-sessions:** add session history overlay extension ([a33e8d0](https://github.com/pixu1980/pi-coding-agent-extensions/commit/a33e8d04983a2c35a358ad7dbf8b5f77df30ed87))
* **pi-sessions:** move session browser into a centered modal ([07cd24b](https://github.com/pixu1980/pi-coding-agent-extensions/commit/07cd24b08e6861e499494bf2617995aec96ea5ce))
* **pi-sessions:** rename /sessions-folders to /projects ([19a578f](https://github.com/pixu1980/pi-coding-agent-extensions/commit/19a578fd73bbcac2fce335fd69fc6c8da3386742))
* **pi-statusline:** add statusline extension ([ab895ec](https://github.com/pixu1980/pi-coding-agent-extensions/commit/ab895ec95df9554b916352e1e9c75bd0736a5460))
* **pi-web:** add URL-to-Markdown scraper extension ([6018991](https://github.com/pixu1980/pi-coding-agent-extensions/commit/6018991702d8492d3adb62a76b7d68c1f9e57776))
* remove pi-sessions package ([98def63](https://github.com/pixu1980/pi-coding-agent-extensions/commit/98def63a513f89220a1fc29c0083efa9e79d9126))

### Bug Fixes

* **deps:** drop deprecated standard-version and patch vulnerable transitive deps ([eb29054](https://github.com/pixu1980/pi-coding-agent-extensions/commit/eb290548ede0f710fcfb7908569734162772500a))
* **npmrc:** fix npmrc config file ([42ce0f9](https://github.com/pixu1980/pi-coding-agent-extensions/commit/42ce0f9d46e54ca819837ab6196ae9f8fd926b15))
* **path-picker:** fix paths with spaces autocomplete ([1eb3335](https://github.com/pixu1980/pi-coding-agent-extensions/commit/1eb3335c112eec488ec487f90777cab1fe45ae0b))
* **path-picker:** update README.md ([0184aba](https://github.com/pixu1980/pi-coding-agent-extensions/commit/0184aba8f1d1ba7441a1fd12cf5aa832f215ea92))
* **pi-mcp:** export default extension factory from entry points ([91ee444](https://github.com/pixu1980/pi-coding-agent-extensions/commit/91ee44427d78bf92eafe590f13aaa9ef03da4b48))
* **pi-mcp:** restore pi 0.83 peer deps, fix type regressions and add tests ([4f26256](https://github.com/pixu1980/pi-coding-agent-extensions/commit/4f2625610ca0c18b00b39a9b0ebf1f6db7ef8b77))
* **pi-mcp:** surface skipped invalid host configs in discovery ([9ced5d8](https://github.com/pixu1980/pi-coding-agent-extensions/commit/9ced5d8e04a64ebad99aa38f6968491c7e414e87))
* **pi-path-picker:** delega al provider nativo fuori apici + /reasoning autocomplete ([4dc418f](https://github.com/pixu1980/pi-coding-agent-extensions/commit/4dc418f6d7d937b6770bea40bb5288898b2647db))
* **pi-path-picker:** import autocomplete types from pi-tui and port tests to tsx ([1429eac](https://github.com/pixu1980/pi-coding-agent-extensions/commit/1429eac2a71701da634a72b2d5064a77d8e86126))
* **pi-path-picker:** isolate tab completion ([2412c56](https://github.com/pixu1980/pi-coding-agent-extensions/commit/2412c5693aa200547856df8f7ca1c2533a98062b))
* **pi-path-picker:** prevent autocomplete interference with pi.dev commands ([9013840](https://github.com/pixu1980/pi-coding-agent-extensions/commit/9013840dc157e11309fab97437c380759a09118a))
* **pi-path-picker:** prevent path autocomplete outside quoted strings ([c181680](https://github.com/pixu1980/pi-coding-agent-extensions/commit/c18168018357d1f92665a49145415a4a523572de))
* **pi-reasoning:** align notify typing, export internals and add test suite ([4da7523](https://github.com/pixu1980/pi-coding-agent-extensions/commit/4da75234562cf12bddf7c99a8c1c3288718c9e0e))
* **pi-reasoning:** unify model-aware menus ([ed5fa62](https://github.com/pixu1980/pi-coding-agent-extensions/commit/ed5fa62972a2f1390787d5387c42f30912ccd8b2))
* **pi-sessions:** export internals for testing and add unit/e2e test suite ([c20f2d1](https://github.com/pixu1980/pi-coding-agent-extensions/commit/c20f2d128e07ac4a4f602b67328ba186e3e72d92))
* **pi-statusline:** restore gallery metadata, fix typing and add test suite ([21c6044](https://github.com/pixu1980/pi-coding-agent-extensions/commit/21c60444b56205211dee56d74029cad3947b3596))
* **pi-web:** repair session cache restore and add extension e2e tests ([657f82c](https://github.com/pixu1980/pi-coding-agent-extensions/commit/657f82c89606e92964d81493df01f419598731e4))
* **release:** preserve first package version ([d3b6c81](https://github.com/pixu1980/pi-coding-agent-extensions/commit/d3b6c81661867e1d9ada1272a30644f9a814f005))
* **release:** use local standard-version ([1934fff](https://github.com/pixu1980/pi-coding-agent-extensions/commit/1934fff0a2973c4f441304be4d28f9f633d64db5))
