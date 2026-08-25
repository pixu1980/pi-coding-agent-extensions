# Prompt utente originale — Verifica conformità (verbatim)

> Riproduzione **integrale e verbatim** del prompt inviato dall'utente il 2026-08-12.
> Nessuna modifica al testo. L'analisi risultante è in `docs/compliance-study-2026.md`.

---

vorrei controllare se questa libreria è compliant con:

```
The secure way to release an npm package in 2026
July 28, 2026
SKILL available

Cover for The secure way to release an npm package in 2026
Topics
Open Source
Developer Community
DX
Performance & scale
JavaScript

Andrey Sitnik
Andrey Sitnik
Author of PostCSS and Autoprefixer, Principal Frontend Engineer

Travis Turner
Travis Turner
Tech Editor
Here's why you should care about how you release your npm package:
Supply chain attacks that steal npm packages are now a real threat, with new attacks every month. If the TanStack, Axios, or ESLint teams were hacked, you can be hacked. These days, attackers steal packages automatically with LLMs, using previously stolen dependencies to reach the next ones.
Taking care of ecosystem security is also a marketing tool. The right publishing method gives you a nice green check icon on npmjs.com and a better security score. You can use this as an advantage over competitors.
In the future, when coding skill can be replaced by LLMs, safeguards and security will become new core responsibilities. That means it's time to go deeper into security now.
At Evil Martians, we have more than 100 open source projects. That creates a risk: somebody could use one open project to steal an npm token, then steal all the others. So for us, supply chain security has been an everyday practice since 2024.

Book a call
Irina Nazarova
CEO at Evil Martians
Hire us to make your devtools more secure!
Book a call
The extremely short version
PostCSS creator shares how to make your open source popular
PostCSS creator shares how to make your open source popular

February 17, 2026

Cover for PostCSS creator shares how to make your open source popular
Read also
Here are the essentials. See below for extra tricks that need more context beyond copy-paste instructions.
Open the Settings tab of your npm package on npmjs.com.
Create a Trusted Publisher: select GitHub, enter your repository organization and name, and set publish.yaml as the Workflow filename. Enable only Allow npm stage publish.
Enable … and disallow tokens in Publishing access.
Enable 2FA for everyone: on GitHub, go to organization settings → Authentication security.
Allow only admins to create tags: on GitHub, go to repository settings → Rules → Rulesets, press New ruleset → New tag ruleset. Put Tags only by admins in Ruleset Name; Active in Enforcement status; add Repository admins to the Bypass list and Include all tags to Target tags. Enable Restrict creations in Tag rules.
Pin third-party CI actions by SHA commit with actions-up:
npx actions-up
Add CI security linting with .github/workflows/check-workflows.yaml:
name: Lint CI workflows
on:
  push:
    branches: ["main"]
  pull_request:
    branches: ["**"]
jobs:
  zizmor:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      actions: read
    steps:
    - name: Checkout the repository
      uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
      with:
        persist-credentials: false
    - name: Run zizmor
      uses: zizmorcore/zizmor-action@6599ee8b7a49aef6a770f63d261d214911a7ce02 # v0.6.0
      with:
        advanced-security: false
Set a 3-day cooldown before using new versions:
npm config set --location=project min-release-age 3
# pnpm config set --location=project minimumReleaseAge 4320
# yarn config set npmMinimalAgeGate 3d
# printf '\n[install]\nminimumReleaseAge = 259200\n' >> bunfig.toml
Migrate to npm 12, pnpm 10, yarn 4.14, or bun so that the postinstall scripts of your npm dependencies aren't called during install.
Create .github/workflows/publish.yaml
name: Release
on:
  push:
    tags:
      - 'v*'
jobs:

  test: # Standard tests to make sure we don't publish a broken package
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
    - name: Checkout the repository
      uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
      with:
        persist-credentials: false
    - name: Install Node.js
      uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6.4.0
      with:
        node-version: 26
        cache: npm
    - name: Install dependencies
      run: npm ci --ignore-scripts
    - name: Run tests
      run: npm test

  build: # Build in a separate job to reduce risks
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
    - name: Checkout the repository
      uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
      with:
        persist-credentials: false
    - name: Install Node.js
      uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6.4.0
      with:
        node-version: 26
        package-manager-cache: false # Slower, but without cache poisoning risk
    - name: Install dependencies
      run: npm ci --ignore-scripts
      # For monorepo put your build tools to production dependencies
      # run: npm ci --ignore-scripts --omit=dev
    - name: Build package
      run: npm run build
    - name: Upload build artifacts
      uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
      with:
        name: build-artifacts
        path: dist/
        retention-days: 1

  publish: # The critical job, without installing any dependencies
    runs-on: ubuntu-latest
    needs:
      - test
      - build
    permissions:
      contents: read
      id-token: write
    steps:
      - name: Checkout the repository
        uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
        with:
          persist-credentials: false
      - name: Download build artifacts
        uses: actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8.0.1
        with:
          name: build-artifacts
          path: dist/
      - name: Install Node.js
        uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6.4.0
        with:
          node-version: 26
          package-manager-cache: false
      - name: Publish npm package
        run: npm stage publish --ignore-scripts
The most secure way is to avoid the build step entirely. See the workflow without a build step. If you need build only for changesets, consider using pnpm version -r. Monorepo example.
Then you can publish a new release by creating and pushing a tag:
# Bump version in package.json and write CHANGELOG.md.
git add .
git commit -m 'Release 1.0.1 version'
git tag v1.0.1
# `git tag -s v1.0.1` is better, but you need to add key for tag/commit signing
git push origin v1.0.1
Wait a few seconds for CI to run, open Staged Packages from the npm user menu, and click Approve new release.
You can use drydock to check the npm package diff before approving the staged package.

Staged Packages page with card of new Nano Stores release with Approve / Reject / Inspect buttons
Nano Stores release in Staged Packages
Want your agent to apply all of this? We've packaged the rules below into a skill.
INSTALL THIS SKILL IN YOUR AGENT

SKILL.md
---
name: secure-npm-package
description: 'Set up a secure release process for an npm package to protect it from supply chain attacks. Use for any request to create and publish a new npm package, secure npm publishing or releasing, set up npm Trusted Publishing, provenance, or Staged Publishing, harden a release workflow.'
---

# Release an npm package securely

Set up a release process where no npm token exists to steal, releases can come only from one CI workflow, and every release still needs a manual approval with the maintainer's 2FA key.

## How to run this skill

The setup is half repo files, half settings on npmjs.com and github.com that **only the user can change**. The settings are the part that needs the user, and if you do the repo changes first the instructions scroll past and get missed — so the user acts before you do. For the settings, produce click-by-click instructions with **direct links resolved from the repo's real data** — package names from `package.json`, owner/repo from the `repository` field — and the exact values to enter. Never say "go to your package settings"; always give the resolved URL.

The order is strict — **questions, then manual settings, then CLI and files**:

Show full SKILL.md
Claude Code
Cursor
Codex
GitHub Copilot
Gemini CLI
npx skills
claude plugin
gh skill
curl
npx skills add https://evilmartians.com/agent-skills --skill secure-npm-package -a claude-code -g


Download
More Evil Martians skills →
How your npm package can be stolen
What we learned from creating PostCSS
What we learned from creating PostCSS

August 5, 2025

Cover for What we learned from creating PostCSS
Read also
In terms of security, it's always important to protect yourself from security theater. I recommend against adding tools just because "it's safer." That motivation makes processes slower and often creates a false sense of security without actually reducing risks.
Instead, I suggest thinking about real attacks (and potential attacks, if you enjoy this topic) and building a solution against those specific points.
Right now, the main risks for an npm package maintainer are as follows:
You or an LLM run npm install … for some dependency needed by your current task. But, as it turns out, this dependency was hacked and contains malware. The malware now has full access to your laptop or CI. It steals your npm tokens, and the attacker's LLM quickly injects malware into your package, releasing it to reach even more people. For instance, OpenAI was compromised through a compromised TanStack package during the Mini Shai-Hulud campaign.
A third-party CI action was hacked. The attacker injects malware and re-releases old tags like v3. On your next publish job, this action has full access to your CI and injects malware into your package before release. Read more about the tj-actions/changed-files case.
Your CI pipeline was hacked because of some mistake (like misusing pull_request_target or having a shell injection). Through cache poisoning, the attacker infects other CI workflows and, with access to the publish workflow, releases your package with malware. This is how TanStack was hacked.
A maintainer is invited to a fake job interview, then attackers use the high-stress situation to pressure them into installing fake Zoom plugins that steal every token from their machine. Axios's maintainer was hacked this way.
So, the main sources of risk during npm publish are:
Packages in node_modules.
Third-party actions in .github/workflows.
All the tools on your laptop.
Security issues in complex CI workflows.
Security misconceptions
Nobody will hack our small package.
These days, to be hacked, you don't need an attacker who specifically wants to hack your package.
Modern npm package hacks happen semi-automatically. For instance, during the Shai-Hulud v2 campaign, more than 500 different packages were hacked in a single day. It works like a worm: one package is used to hack the next, maximizing the number of companies it can reach.
With more advanced LLMs, we expect even more autonomous agents hacking whatever package they can reach.
Everyone can be hacked! We can ignore this.
It's true that there's no 100% protection against a supply chain attack, or against any other way to steal your package. But real risk management is more nuanced:
The cost of the attack should exceed the value of the information.
Of course, LLMs deflate the cost of a personal attack a lot. But your task still isn't to reach impossible, perfect protection. It's to increase the price of an attack.
I'm not a security specialist, so this isn't my concern, right?
There are advanced security topics for specialists, but basic security should be expected of every developer.
It's simply impossible to have good security if every worker (except the security specialist) tries to work around the protections. A chain is only as strong as its weakest link. A company can have good security only if every worker helps.
The industry is changing very rapidly right now, and people expect more fullstack developers. Basic security is part of that expectation, at least until a package grows big enough to have dedicated specialists.
Since coding is shifting to LLMs, the human work of every developer is shifting toward security and safeguards.
Breaking down each security step
npm Provenance

Check mark near version number on project's npmjs.com page
npm Provenance mark on Nano Stores page
npm Provenance mostly protects your users, not you. (That said, it also gives you a nice "check" badge on the package's npmjs.com page.) It solves cases where an npm package can't easily be connected to its GitHub sources. The GitHub sources can look safe on review, while the npm package content is something very different.

Big table with details that npm-provenance was generated by GitHub CI on project's npmjs.com page
npm Provenance source block at the bottom of the Nano Stores page
With npm Provenance, the package is published from CI, and the CI provider (like GitHub itself) signs the package to confirm it was generated by this workflow on a specific commit.
Unfortunately, in practice, it can't 100% guarantee that the npm package has no extra injections.
Provenance guarantees the origin of an npm package. It answers "did this come from the right pipeline." It does not answer "was the pipeline honest", and it doesn't tell you the package is safe.
But as we said above, we're trying to reduce risks, not find a 100% perfect solution. At least we can show where the npm package came from. And if CI wasn't hacked, we can assume the package is connected to its source code and workflow.
Staged Publishing
Initially, I personally disliked npm Provenance, because a CI release is less secure than a manual release when I use a hardware 2FA key like a YubiKey and protect my laptop with a Dev Container.
CI can always be hacked and release an npm package while you're sleeping.
But Staged Publishing brought us the best of both worlds: CI publishing with good DX and npm Provenance, and a manual check with a hardware 2FA token.
In the first step, CI releases the package using npm stage publish instead of npm publish.
In the second step, you manually approve the publish with your hardware 2FA token.
    steps:
      …
      - name: Publish npm package
-       run: npm publish
+       run: npm stage publish
To approve the package, open Staged Packages from the npm user menu and click Approve new release. Or you can use npm stage approve CLI.

Staged Packages page with card of new Nano Stores release with Approve / Reject / Inspect buttons
Nano Stores release in Staged Packages
Unfortunately, npmjs.com doesn't show the package diff in the Staged Packages UI, so you risk missing code that the build step injected.
We recommend creating an account at drydock with a read-only npm token. It will email you about every new staged package and let you review the diff, then send you to npmjs.com to approve the package manually with your 2FA.
It's a good idea to configure Trusted Publishing (see below) to allow only npm stage publish. That way, even if your CI is hacked, the attacker can't release the npm package right now without your approval (though they can still quietly wait for your own release).
Make your CI secure
If we move the release process to CI (to get the npm Provenance check mark, or for better DX in big teams), we need to take CI security seriously. Everyone who has access to CI or the workflow files can release anything to our npm package.
Many recent supply chain attacks started from a mistake in a popular CI workflow.
This is why having a CI workflow linter is critical for npm package security.
I know 2 good CI linters, but both have a small issue:
CodeQL is a security linter for many languages, including GitHub workflows. It's built into GitHub. Enable it in repository settings → Advanced Security → Code scanning → CodeQL analysis, press Set up, and select Default. The problem is DX: to check warnings, you have to manually open the Security and quality tab and go to the Code scanning page.
zizmor is a linter only for GitHub Actions. It has more rules, but since it's a Rust tool, it's a little harder to install into an npm project. Still, you can use an action to lint workflows on CI.
name: Lint CI workflows
on:
  push:
    branches: ["main"]
  pull_request:
    branches: ["**"]
jobs:
  zizmor:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      actions: read
    steps:
      - name: Checkout the repository
        uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
        with:
          persist-credentials: false
      - name: Run zizmor
        uses: zizmorcore/zizmor-action@6599ee8b7a49aef6a770f63d261d214911a7ce02 # v0.6.0
        with:
          advanced-security: false
But even if you fix all the security issues in your workflows, an attacker can still hack you "in the past." For instance, the Nx team fixed a pull_request_target issue in their CI but still had an old branch with the old workflow. The attacker opened a PR against this old branch instead of the main branch, exploiting the old version of the workflow.
Remove all old branches after fixing a security issue in your CI workflows.
What are these long @9c091bb2… hashes in our workflow examples? Why don't we just use @v7 tags?
We can't just use those because someone can steal the CI actions you use (many open source maintainers are burned out, so it's cheap to compromise their accounts). Tags like @v7 aren't immutable by default, and an attacker can update all previous tags, forcing you to use an infected third-party action on your next CI run.
This means it's better to use a SHA commit hash like @9c091bb2… instead of a tag like @v7. It's like a lockfile for CI.
There are 3 tools to manage these commit hashes: Dependabot, pinact, and actions-up. We recommend actions-up, because it has a default cooldown and integrates more cleanly into an npm project.
npx actions-up
Trusted Publishing
If you keep a secret like NPM_TOKEN on CI, that token can be stolen and used later. It's a popular technique, used, for instance, during the Shai-Hulud supply chain attack campaigns.
The best token is no token.
And there's a solution for releasing from CI without any token: Trusted Publishing.
GitHub and other CI providers tell npm that npm publish is coming from a specific repository and workflow. So instead of using a token, you can tell npm to allow packages only from a specific workflow in your repository. You can find this option on the package's page on npmjs.com → Settings tab.
We also recommend enabling Require two-factor authentication and disallow tokens on the Settings page to revoke all previously issued tokens.

Package's settings on npmjs.com with the block of Trusted Publishing enabled
Settings with Trusted Publishing enabled
We recommend allowing only npm stage publish and denying npm publish. This will make it so there's a manual step with a 2FA token before releasing an npm package (see the Staged Publishing section above).
To send this signed package, your CI job needs the id-token: write permission:
publish:
  runs-on: ubuntu-latest
  needs:
    - test
    - build
  permissions:
    contents: read
+   id-token: write
  steps:
Remember that any third-party action in this job, or any installed npm dependency, could also release your npm package. It's important to use as few third-party actions as possible and to avoid installing npm packages in this job.
Minimal dependencies in the publish job
Everything you install or use in a CI job with id-token: write can release the npm package instead of you.
Installed npm dependencies, third-party CI actions, the Docker image, even a cache: every third-party tool is a supply chain risk in this critical step.
Evil Martians used almost every JS compiler for PostCSS, and ended up with no build step at all.
We actaully found that this is better for maintainability. You can quickly check a fix by installing the unreleased version from a git commit via npm. Or you can debug and fix a bug in a local copy inside node_modules, then copy-paste the fix back into your repo.
The best approach is to not use any build tool or third-party CI action at all (see our Nano ID workflow). It may sound radical, but think again. For instance, the Svelte team moved from .ts sources to .js files with TSDoc type comments, and they kept the same type checking.
If you are using build step only for changeset (ChangeLog.md generator) you can replace it with pnpm.
pnpm change # Generate .changeset/x.md
pnpm version -r # Bump version and generate ChangeLog.md changes
If you still need a build step, separate the build and publish steps into different jobs that pass artifacts between them (see our Multiocular workflow as an example). Give the id-token permission only to the publish job, so malware in the build step can't publish the package. An attacker can still inject something into your build files, but that requires a more complex attack.
  build:
    permissions:
      contents: read
    steps:
    …
    - name: Install dependencies
      run: npm ci --ignore-scripts

    - name: Build packages
      run: npm run build

    - name: Upload build artifacts
      uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
      with:
        name: build-artifacts
        path: dist/
        retention-days: 1

  publish:
    needs:
      - build
    permissions:
      contents: read
      id-token: write
    steps:
      …
      - name: Download build artifacts
        uses: actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8.0.1
        with:
          name: build-artifacts
          path: dist/

      - name: Publish npm package
        run: npm stage publish --ignore-scripts
You don't need to compile TS to JS before deploying your web server. Modern Node.js can run .ts files ignoring types.
Unfortunately, it doesn't work yet for npm packages from node_modules.
Another way to make the build step more secure is to install only a limited set of dependencies (install the TS compiler, but not linters and test tools). For instance, in a monorepo you can keep build tools in dependencies and test tools in devDependencies in the root package.json. Then you can use the --omit=dev argument to skip test tools:
  - name: Install dependencies
-   run: npm ci --ignore-scripts
+   run: npm ci --omit=dev --ignore-scripts

  - name: Build packages
    run: npm run build
We also recommend a smaller compiler. For instance, ts-blank-space just replaces types with spaces. It also makes npm packages smaller, since it doesn't need source maps.
It's also better to avoid any caches in critical steps like publishing or deploying. Through a cache, an attacker can infect a CI workflow from another, less secure workflow.
  - name: Install Node.js
    uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6.4.0
    with:
      node-version: 26
+     package-manager-cache: false
It's also better to move changelog or GitHub Releases generators into a separate step.
GitHub protection rules
With CI publishing, everyone with write access to the GitHub repository can publish a new version. In our example, creating a tag starts the publish, and tag creation is enabled by default for everyone.
Staged Publishing helps a little, but it's better to set rules for who can create tags.
Here's how to create a ruleset that blocks everyone except repo admins from creating tags: GitHub repository settings → Rules → Rulesets, press New ruleset → New tag ruleset. Put Tags only by admins in Ruleset Name; Active in Enforcement status; add Repository admins to the Bypass list and Include all tags to Target tags. Enable Restrict creations in Tag rules.
We also recommend enabling GitHub Immutable Releases at main GitHub repository's settings.
Dependency cooldown
Another way to hack your package is through another npm package that you use as a dependency.
Malware code from an npm package can execute:
In postinstall/preinstall/etc. scripts in that package's package.json.
When you import the package in your app, your ESLint config, etc.
When you or an IDE extension call the package's CLI.
I personally recommend switching to the latest pnpm, since this package manager has the best protection against supply chain attacks out of the box, and adds new security features very quickly.
Again, there's no way to protect yourself from this 100%. But there are ways to reduce the risks:
Disable postinstall and similar scripts. npm 12, pnpm 10, yarn 4.14, and bun disable them by default, so update to the latest version.
Cooldown: wait 1-3 days before using a new version. The median takedown time was 14 hours, and a 3-day cooldown would have blocked about 94% of malicious packages. pnpm 11 and yarn 4.15 moved to a default 1-day cooldown. Now every package manager has cooldown options:
npm config set --location=project min-release-age 3
pnpm config set --location=project minimumReleaseAge 4320
yarn config set npmMinimalAgeGate 3d
For bun add to bunfig.toml:
[install]
minimumReleaseAge = 259200
Add a "firewall" that scans dependency contents before using them. For instance, npq, Socket Firewall or SafeDep PMG. It's a good defense against typosquatting, when you or an LLM makes a mistake in a package name.
Extra steps
The steps above are quick wins that can be added in a day. The ones below take more planning, and the right solution depends on your case. We split them out so you could start with the quick ones above, but don't skip these next ones either.
Reducing dependencies
From React to native web with nanotags: a migration that saved 100 KB
From React to native web with nanotags: a migration that saved 100 KB

May 6, 2026

Cover for From React to native web with nanotags: a migration that saved 100 KB
Read also
I know that changing habits is hard. But we have these huge supply chain attacks because of a culture that solves every problem by adding hundreds of dependencies. Thus, it's important to minimize the attack surface by reducing the number of dependencies.
Nested dependencies (the dependencies of your dependencies) are often the biggest part of this. The good news: this can often be fixed quickly by moving to an alternative tool with fewer dependencies.
The e18e community does a lot to make the JS ecosystem faster, smaller, and safer. They have a manual list, a CLI tool, and a CI action to help you find and replace dependencies that pull in a lot of nested dependencies.
 npx @e18e/cli analyze
Check your dependencies with npmgraph to see the number of nested dependencies, and use npmx.dev to find alternatives.
Small helpers that don't need updates are better rewritten with an LLM and stored as local JS files in the project. Many third-party CI actions can be rewritten as a short shell script by an LLM.
Where to focus your effort, by priority:
Your direct dependencies and their nested dependencies. Your clients can be hacked not only by malware in your package, but by malware in any of your dependencies. Check your package on npmgraph and start thinking about replacements for the bigger branches.
Then move to your devDependencies. Every nested dependency can be hacked and try to steal your CI tokens. Ask maintainers to move to the smallest alternatives or native modules in their direct dependencies. If you have a huge, powerful tool but use only a single feature, rewrite it with an LLM.
Then check third-party actions. Ask an LLM to rewrite the smallest ones.
Dev Container
If you run your dev projects without any isolation, any dependency or IDE extension can read almost any file on your laptop. There are many ways to steal all the cookies from your browser, and with a GitHub cookie, an attacker can change files via the web UI.
A Dev Container reduces this risk a lot. It runs the shell, debugger, LLM, and most IDE extensions of your project inside a container, so they have very limited access to your system. VS Code / Cursor, JetBrains IDEs, Zed, Emacs, and Neovim all have very good Dev Container support.
Ask your LLM to create a .devcontainer/ folder based on your project's unique needs.
We recommend configuring dotfiles: create a GitHub repo with your zsh/bash and CLI tool configs plus an install script. You can pass it to the Dev Container dotfiles option and get the same experience inside the container. See the example of my dotfiles.
If you use VS Code, we also recommend disabling the Docker socket for better security.
With a Dev Container, you get more than just better security:
Your LLM runs inside the container too, so it can't break your system because of a hallucination.
You get an almost one-line onboarding process for new developers. No need to install databases and tools on the system manually; everything is set up for you.
Your whole team runs the project in the same environment.
The project can be started in web IDEs like GitHub Codespaces.
Harden Runner
Harden Runner is free for public GitHub repositories and has a few nice features to improve CI security. My favorite one is an allow-list of domains for network requests:
      - name: Harden the runner
        uses: step-security/harden-runner@bf7454d06d71f1098171f2acdf0cd4708d7b5920 # v2.20.0
        with:
          egress-policy: block
          allowed-endpoints: >
            registry.npmjs.org:443
            api.github.com:443
            github.com:443
            nodejs.org:443
Start with egress-policy: audit, collect the domains your CI normally calls, then move to egress-policy: block. It can prevent some malware from sending your tokens to their servers (though other malware creates a public GitHub repository instead of making a network request, which is harder to prevent).
Review all your environments
This supply chain attack crisis isn't because of npm or JS (pnpm has a lot of security features; many other package managers have fewer). Rather, the problem is developer culture:
We started adding dependencies without thinking about risk management, only because "what everyone is doing should be safe."
The 4 most common security risks when vibe coding your app
The 4 most common security risks when vibe coding your app

February 11, 2026

Cover for The 4 most common security risks when vibe coding your app
Read also
To stop this, we need to start managing the risk. And that applies not only to npm/JS, but to any environment:
Docker base images (including Dev Container images and features).
IDE extensions.
Other package managers, like those used for backends or Python for AI tools.
Third-party CI actions.
Skills for LLMs.
And so on.
For each of your environments, think about these points:
Stop writing rules in AGENTS.md: use agent hooks and nano-staged instead
Stop writing rules in AGENTS.md: use agent hooks and nano-staged instead

May 26, 2026

Cover for Stop writing rules in AGENTS.md: use agent hooks and nano-staged instead
Read also
How to reduce the number of dependencies or the attack surface. Don't grab an unknown thing from a viral social post. Try to use a minimal solution instead of a big "everything together" one.
How to isolate or limit access. Wrap more things in a container, limit API access to only what's necessary, and so on.
Do you have control over updates? A lockfile, an update cooldown (cooldowns.dev has instructions for different environments).
How can you review them when adding or updating? Define how to check the quality of a new tool (don't use popularity or star count for that). Consider getting diffs for updates (like in our Multiocular). Maybe add a service with LLMs reviewing changes (just don't treat it as the only option; there are ways to blind LLMs).
For instance, IDE extensions are one of the least protected areas right now. There's no cooldown, no lockfile, and no user-controlled update process. GitHub itself was hacked by a poisoned VS Code extension.
Radio wave representing wind sounds on Mars
Security and supply chain risks are very hot topics right now, for a reason. We're starting to see a huge hack every month. There will be no silver bullet. We all need to start making the ecosystem more secure and to think more about security and risks (especially because of the LLM revolution). The quickest steps from this article can be applied to your project in less than 24 hours. Make sure to set aside time for it on your next working day.
Finally, let's note that at Evil Martians, we've spent years building the OSS that powers devtools behind the scenes: PostCSS, Lefthook, Nano Stores, plus dozens more. So, if you're in need, contact us to make your devtools more secure!
```

e con

```
name    secure-npm-package
description    Set up a secure release process for an npm package to protect it from supply chain attacks. Use for any request to create and publish a new npm package, secure npm publishing or releasing, set up npm Trusted Publishing, provenance, or Staged Publishing, harden a release workflow.
Release an npm package securely

Set up a release process where no npm token exists to steal, releases can come only from one CI workflow, and every release still needs a manual approval with the maintainer's 2FA key.

How to run this skill

The setup is half repo files, half settings on npmjs.com and github.com that only the user can change. The settings are the part that needs the user, and if you do the repo changes first the instructions scroll past and get missed — so the user acts before you do. For the settings, produce click-by-click instructions with direct links resolved from the repo's real data — package names from package.json, owner/repo from the repository field — and the exact values to enter. Never say "go to your package settings"; always give the resolved URL.

The order is strict — questions, then manual settings, then CLI and files:

Gather facts (Step 1), read-only and silent, to learn the project's shape.
Ask all questions together. Gather every decision you need from the user — cooldown length (1 or 3 days), whether to move build tools into dependencies for the --omit=dev hack in a monorepo, the repository field if it's missing, and anything else the project raises — and ask them all in one message. Do not drip questions out one at a time. Wait for the answers.
Hand off the manual settings (Step 2) on npmjs.com and github.com and ask the user to make every change.
Wait for the user to confirm they have changed everything — do not run any repo-changing command or touch any files until they say so.
Run the CLI and change files (Step 3).
The only commands allowed before the user answers the questions and confirms the settings are the read-only fact-gathering ones in Step 1 (npm view, git tag, reading package.json). Every mutating command — npm config set, writing workflow files, editing package.json — waits for Step 3.

Step 1: Gather facts

Collect before changing anything:

Packages. Read the root package.json. If it has workspaces (or pnpm-workspace.yaml exists), it's a monorepo: enumerate every workspace package.json. Only packages without "private": true need npm settings.
GitHub owner/repo. From the repository field (normalize git+https://github.com/owner/repo.git, github:owner/repo, owner/repo), falling back to git remote get-url origin. If neither exists, ask the user, then add the repository field.
Org or personal. Whether the owner is a GitHub organization or a user account (changes the 2FA instructions).
Package manager and version. From the packageManager field and lockfiles.
Published or not. npm view <name> version for each public package. An E404 means not yet published — see Not yet published packages.
Tag format. Check existing version tags with git tag --sort=-creatordate | head — some repos use v1.0.0, others 1.0.0, monorepos often <name>@1.0.0. Keep the existing format in the workflow trigger and release instructions; only if there are no tags yet, default to v1.0.0.
Build step. Is there a build script, and what directory does it emit?
Existing workflows in .github/workflows/, especially any current release workflow and any use of secrets.NPM_TOKEN.
Step 2: Manual settings (ask the user first)

Present these before changing any repo files, so the user doesn't miss them. Give a numbered checklist with resolved links and exact values, grouped by website. The workflow filename you reference below (publish.yaml) is fixed — you'll create the file in Step 3, but the user can enter the name now without waiting for it. Ask the user to work through the whole checklist and then confirm back that everything is done. After they confirm, verify what you can (npm view <name>, gh api repos/<owner>/<repo>/rulesets if gh is authenticated) and re-ask about anything still not set. Only once the settings are confirmed do you move on to the repo changes.

On npmjs.com — for every public package

Repeat this block per package in a monorepo, each with its own link:

Open https://www.npmjs.com/package/<name>/access (you must be logged in as a maintainer).

In Trusted Publisher select GitHub Actions and enter:
Organization or user: <owner>
Repository: <repo>
Workflow filename: publish.yaml
Environment: leave empty
Enable only Allow npm stage publish — deny plain npm publish, so even hacked CI can't release without your approval.
In Publishing access select Require two-factor authentication and disallow tokens. This revokes all existing tokens — warn me first if any other automation publishes this package with a token.
If the old setup used an NPM_TOKEN secret, also:

Delete the NPM_TOKEN secret at https://github.com/<owner>/<repo>/settings/secrets/actions and revoke the token itself at https://www.npmjs.com/settings/~/tokens.
On github.com

2FA for everyone. If the repo belongs to an organization:

Open https://github.com/organizations/<org>/settings/security and enable Require two-factor authentication under Authentication security.
For a personal account, ask the user to confirm 2FA is on at https://github.com/settings/security — prefer a hardware key or passkey.

Tag ruleset — with CI publishing, whoever can push a v* tag can trigger a release, so restrict tag creation:

Open https://github.com/<owner>/<repo>/settings/rules/new?target=tag and create:

Ruleset Name: Tags only by admins
Enforcement status: Active
Bypass list: add Repository admins
Target tags: Include all tags
Tag rules: enable Restrict creations
Immutable releases — once a release is published, its tag and assets can never be changed or deleted, so an attacker can't silently swap artifacts under an existing version:

Open https://github.com/<owner>/<repo>/settings and in the Releases section enable Immutable releases.
Step 3: Repo changes (do these yourself)

Do not start until the user confirms they have changed everything in Step 2. Ask them to confirm the npm and github settings are all done, and wait for their explicit yes. Only then make the repo changes. Ask before overwriting an existing release workflow; carry over intentional extras (changelog generation, GitHub Releases) into separate jobs without id-token.

3a. .github/workflows/publish.yaml

The core rules, whatever the project's shape:

Trigger on version tags, matching the repo's existing tag format (v*, [0-9]*, …).
The publish job installs no dependencies, uses no cache, and no third-party actions beyond checkout/setup-node/download-artifact. Anything running in a job with id-token: write can publish the package.
Build in a separate job, pass output via artifacts. Only the publish job gets id-token: write; every job gets contents: read and persist-credentials: false on checkout.
--ignore-scripts on every install and on publish.
npm stage publish, not npm publish — CI stages the release, a human approves it with 2FA.
Use npm for the publish command even when the project uses pnpm, yarn, or bun. . The only exception is a project that genuinely needs its own package manager's staged-publish command (e.g. workspace: or beforePacking); there, use that tool's command instead.
If there is no build script, drop the build job and the artifact steps entirely (best case — see Nano ID's workflow).
Template (adapt Node version, build output path, and install commands to the project's package manager, update versions to latest keeping SHA-commits pinning):

name: Release
on:
  push:
    tags:
      - 'v*'
jobs:
  test:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - name: Checkout the repository
        uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
        with:
          persist-credentials: false
      - name: Install Node.js
        uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6.4.0
        with:
          node-version: 26
          cache: npm
      - name: Install dependencies
        run: npm ci --ignore-scripts
      - name: Run tests
        run: npm test

  build: # Separate job so build-time dependencies can't publish
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - name: Checkout the repository
        uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
        with:
          persist-credentials: false
      - name: Install Node.js
        uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6.4.0
        with:
          node-version: 26
          package-manager-cache: false # Slower, but no cache poisoning risk
      - name: Install dependencies
        run: npm ci --ignore-scripts
        # For a monorepo with build tools in root `dependencies`:
        # run: npm ci --omit=dev --ignore-scripts
      - name: Build package
        run: npm run build
      - name: Upload build artifacts
        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
        with:
          name: build-artifacts
          path: dist/
          retention-days: 1

  publish: # The critical job: no dependencies installed at all
    runs-on: ubuntu-latest
    needs:
      - test
      - build
    permissions:
      contents: read
      id-token: write
    steps:
      - name: Checkout the repository
        uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
        with:
          persist-credentials: false
      - name: Download build artifacts
        uses: actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8.0.1
        with:
          name: build-artifacts
          path: dist/
      - name: Install Node.js
        uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e # v6.4.0
        with:
          node-version: 26
          package-manager-cache: false
      - name: Publish npm package
        run: npm stage publish --ignore-scripts
If an old workflow used secrets.NPM_TOKEN, remove it from the YAML now — deleting the secret and revoking the token is already covered by the Step 2 checklist (from the facts gathered in Step 1).

3b. Run zizmor locally and fix every finding

docker run --rm -t -v "$(pwd):/repo:ro" ghcr.io/zizmorcore/zizmor:latest /repo/.github/workflows
Run it yourself if Docker is available; otherwise ask the user to run this command and paste the output. Fix everything it reports in the existing workflows (pull_request_target misuse, shell injection, unpinned actions), then re-run until clean. Remind the user to delete stale branches that still contain old vulnerable workflows — attackers exploit old branches (that's how Nx was hit).

3c. .github/workflows/check-workflows.yaml — keep linting on CI

name: Lint CI workflows
on:
  push:
    branches: ['main']
  pull_request:
    branches: ['**']
jobs:
  zizmor:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      actions: read
    steps:
      - name: Checkout the repository
        uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
        with:
          persist-credentials: false
      - name: Run zizmor
        uses: zizmorcore/zizmor-action@6599ee8b7a49aef6a770f63d261d214911a7ce02 # v0.6.0
        with:
          advanced-security: false
3d. Dependency cooldown

Apply the cooldown the user already chose in the batched questions — the fast (1 day) or more secure (3 days). If for some reason it wasn't settled then, use this fact to decide:

A 3-day delay before adopting new dependency versions blocks ~94% of malicious releases (median takedown is 14 hours).
Apply the one matching the project's package manager:

npm config set --location=project min-release-age 3
pnpm config set --location=project minimumReleaseAge 4320
yarn config set npmMinimalAgeGate 3d
For bun, add to bunfig.toml:

[install]
minimumReleaseAge = 259200
pnpm 11+ already turns cooldown on — minimumReleaseAge defaults to 1440 (1 day). So on pnpm 11 you're only raising it to 3 days (4320).

3e. Make sure postinstall scripts are disabled locally

Dependency postinstall/preinstall scripts run arbitrary code on every developer machine. npm 12, pnpm 10, yarn 4.14, and bun disable them by default — check the version actually in use (packageManager field, npm --version etc.):

Version is new enough → nothing to add, just confirm.

Older → add an explicit config:

npm config set --location=project ignore-scripts true
yarn config set enableScripts false
Warn with npm's ignore-scripts=true: it also skips the project's own lifecycle scripts (prepare, husky hooks) — check nothing depends on them.

If some dependency genuinely needs its build script, allowlist that one package instead of re-enabling everything.

Not yet published packages

Trusted Publishing is configured on the package's npm settings page, which doesn't exist until the package is published. If npm view <name> returned E404:

Check the name is actually free (an E404 with the registry reachable) and warn about typosquatting-adjacent names.
The first release happens manually from the maintainer's machine: npm publish --ignore-scripts (add --access public for a scoped package), authenticating interactively with 2FA. No token, no CI for this one release; it won't have the provenance badge — every later release will.
Immediately after the first publish, run the full Step 2 checklist for the new package (Trusted Publisher, stage-only, disallow tokens).
All later releases go through the tag → CI → staged approval flow.
In a monorepo, some packages may be published and others not — split the checklist accordingly.

Monorepo specifics

npm settings are per package. Every public workspace package needs its own Trusted Publisher entry pointing at the same repo and the same publish.yaml. Emit one settings link per package; missing one leaves that package unprotected.
One publish workflow can release everything: npm stage publish --ignore-scripts --workspaces, or --workspace=<name> per package if versions are tagged independently (adjust the tag trigger to the repo's scheme, e.g. <name>@*).
Publish with npm, unless the package relies on a pnpm-only feature npm can't reproduce — the workspace: protocol, or a beforePacking hook in .pnpmfile.cjs. Then publish with pnpm stage publish instead. In that case drop actions/setup-node from the publish job and let pnpm provide Node (use-node-version in pnpm-workspace.yaml) — one tool in the critical job, not two. First check the pnpm version supports staged/trusted publishing; if not, tell the user the tradeoff rather than silently downgrading security.
The --omit=dev hack. In a monorepo, keep build tools (compiler, bundler) in the root dependencies and test/lint tools in devDependencies, then install in the build job with npm ci --omit=dev --ignore-scripts — the build runs without linters, test runners, and their nested dependencies, shrinking the attack surface of the critical job. Moving packages between dependencies and devDependencies changes the published metadata, so this is one of the decisions you ask up front in the batched questions, not mid-edit; on the user's yes, move the build tools and switch the build job's install to --omit=dev.
Tell the user how to release now

End by showing the new release flow, with the tag in the repo's detected format:

# Bump version in package.json and update CHANGELOG.md
git add .
git commit -m 'Release 1.0.1 version'
git tag v1.0.1   # `git tag -s` is better if signing keys are set up
git push origin v1.0.1
Then CI stages the release, and the user approves it in Staged Packages (npm user menu on npmjs.com) or with npm stage approve — this is the manual 2FA step that hacked CI can't fake. Suggest a patch release as an end-to-end test of the pipeline.

Suggest the next step: fewer dependencies

Every nested dependency is attack surface no setting can remove. After the setup is done, run:

npx @e18e/cli analyze
Show the user which dependency branches pull in the most nested packages, and offer to draft a plan (an issue or TODO) for replacing the biggest ones later with lighter alternatives — see the e18e replacements list — or with small local modules. Don't do the replacements now; it's a separate, larger task.

Final checklist

publish.yaml publishes with npm stage publish --ignore-scripts; only the publish job has id-token: write; no dependency installs or caches in it.
zizmor workflow added and existing workflows pass it; stale branches deleted.
All actions pinned by SHA.
Cooldown configured and dependency postinstall scripts disabled (by version or by config).
Every public package has a Trusted Publisher (stage-only) and tokens disallowed — confirmed by the user, per package.
No NPM_TOKEN left in workflows or repo secrets.
Tag ruleset active; immutable releases enabled; 2FA required.
User knows the tag → approve release flow and has run a test release.
```

e con

```
Making More npm Packages Work with jsDelivr ESM mode
PRODUCT UPDATES
·
By Martin Kolárik
·
08 Aug 2026
·
10 min read
Making More npm Packages Work with jsDelivr ESM mode
Over the past few months, we upgraded the /+esm toolchain, worked through the open compatibility reports, and then used production APM data to find the failures that had not been reported yet. This post covers what we found and the changes now running in production.
When we introduced jsDelivr's ESM bundling service, the idea was simple: take a package published to npm and return a browser-ready ES module.
A /+esm request does considerably more than change the module syntax. jsDelivr resolves package exports and browser entry points, converts CommonJS where necessary, provides browser-compatible implementations of supported Node.js APIs, bundles dependencies, removes unused code, minifies the result, and generates a source map. We described many of those capabilities when we announced the service in 2023.
That implementation already worked for most of the npm ecosystem. The packages that remained were not one clear category. They combined generated CommonJS helpers, newer JavaScript syntax, browser aliases, source maps, WebAssembly files, Node.js APIs, and output produced by several generations of build tools.
Before making another round of changes to the bundling pipeline, we wanted to update the backend and its dependencies. Several packages were multiple major versions behind, and some current releases had moved to ESM-only distribution. We converted the backend, its scripts, configuration, tests, and supporting tools to native ESM, then upgraded the dependency stack together.
This included moving from Rollup 2 to Rollup 4 and updating its CommonJS, JSON, and replacement plugins. Rollup 4 itself did not require the backend to be ESM, but the wider dependency upgrade was much easier once the application used the same module system as the growing number of ESM-only packages around it. We also wanted that work finished before adding more substantial fixes and refactorings to versions we already planned to replace.
With the current toolchain in place, we went through the outstanding compatibility reports one by one. After resolving most of the known cases, we used production APM data to inspe[118;1:3uct the /+esm requests that were still failing, grouped them by cause, and fixed the recurring problems that could be handled safely on our side.
What the dependency upgrade fixed by itself

Some reports were resolved directly by the newer Rollup stack.
JSON import attributes are one example. Packages increasingly use the standardized syntax:
import metadata from './package.json' with { type: 'json' };
A reported failure involving @uppy/core came from this syntax. The previous Rollup 2-based pipeline could not process the published package, while the current Rollup and JSON plugin handle it correctly. We added the syntax to our regression fixtures so that future toolchain changes continue to cover it.
Most of the remaining failures were not solved by upgrading Rollup alone. They came from jsDelivr's own resolver, CommonJS handling, package transforms, or assumptions that had worked for older package output but no longer covered what was being published.
Modern syntax still depends on package metadata

Top-level await was one such case.
Rollup already supports top-level await in ESM. The failure occurred because some .js package entry points were being passed through CommonJS conversion even when their package declared:
{
  "type": "module"
}
For a package marked as ESM, that .js file should be parsed as an ES module from the beginning. Running it through the CommonJS plugin could reject the top-level await before Rollup processed the module normally.
For packages with "type": "module", CommonJS conversion is now limited to .cjs files and .js files inside nested dependencies. The package's own .js entry points stay on the native ESM path.
Replacing NODE_ENV in more forms

The /+esm pipeline has long replaced Node-style environment checks with a production value. Many packages contain code such as:
if (process.env.NODE_ENV !== 'production') {
  enableDevelopmentWarnings();
}
Replacing process.env.NODE_ENV with "production" lets Rollup remove development-only branches and avoids requiring a complete process implementation just for an environment check.
Published packages do not always use that exact expression, however. The GraphQL failure used guarded access through globalThis.process, while other packages used global.process or checked whether process existed before reading from it:
typeof process !== 'undefined' && process.env.NODE_ENV;

global.process && global.process.env.NODE_ENV;

globalThis.process && globalThis.process.env.NODE_ENV;
Those cases are now included in the replacement pass.
A later Vite failure exposed another variation:
process.env['NODE_ENV'];
process.env["NODE_ENV"];
We added the bracket-notation forms as well. At the same time, the matching was narrowed so that it does not replace quoted object keys or unrelated member chains such as:
const definitions = {
  "process.env.NODE_ENV": "some literal value"
};

host.process.env.NODE_ENV;
This part of the transform now recognizes the common generated variants without treating every occurrence of the same text as an environment reference.
Two smaller package-input fixes

Some package entry points also serve as command-line programs and begin with a shebang:
#!/usr/bin/env node
That line is useful when the file is executed directly, but it can interfere with later parsing and source-map processing. We replace only the initial #! with //. The replacement has the same length, so line and column positions in an existing source map remain aligned.
We also fixed an edge case in the resolver's handling of the browser field. jsDelivr uses this field directly when selecting browser-specific files, and some packages contain an explicit self-mapping:
{
  "browser": {
    "./dist/iife/index.js": "./dist/iife/index.js"
  }
}
At that point, the resolver has already reached the intended browser file. Following the mapping again only starts the same lookup over, so self-mappings are treated as resolved and the current file is used.
The long tail of CommonJS exports

The most involved part of the work was CommonJS interoperability.
CommonJS is often summarized as require() plus module.exports, but compiled packages expose their APIs in many different ways. jsDelivr cannot run every package in Node.js to discover those exports. It has to identify them statically and construct an ESM interface before Rollup creates the final bundle.
The AWS SDK report is a good example of how several layers can interact.
@aws-sdk/client-s3 expected the named exports Sha1 and Sha256 from browser-oriented crypto dependencies. Those dependencies did contain the exports, but TypeScript had compiled their re-export files into code resembling:
tslib.__exportStar(require('./implementation'), exports);
There is no direct assignment such as exports.Sha256 = ... in that file. The public names come from another CommonJS module through TypeScript's generated __exportStar helper.
Our named-export detector now recognizes __exportStar calls whose target is either exports or module.exports, resolves the referenced module, and includes its names in the ESM interface.
Combining CommonJS lexers

That detector also has to handle more ordinary-looking assignments in less ordinary locations.
The @nodefill/primordials report involved exports declared inside conditional branches:
if (condition) {
  exports.fromPrimordials = value;
} else {
  exports.fallback = require('./fallback');
}
The lexer we were using preserved several object-export and re-export patterns that were important to the existing pipeline, but it did not detect all of the conditional exports.name assignments recognized by Node.js.
Rather than replacing one set of supported patterns with another, the detector now combines the results of Node's cjs-module-lexer and @esm.sh/cjs-module-lexer. If one parser cannot handle a particular file, the other can still provide useful export information.
CommonJS also allows property names that are not valid JavaScript identifiers:
exports['foo-bar'] = value;
exports['RegExpGet$&'] = anotherValue;
Those names used to be dropped while creating ESM bindings. They are now read from the CommonJS namespace through bracket access and exposed using ESM string-literal re-exports.
CommonJS code importing external ESM

A separate interop problem appeared when converted CommonJS code imported a dependency that jsDelivr had already turned into an external ESM URL.
For example, the resolver may normalize a dependency to:
/npm/package@version/+esm
The CommonJS plugin could still apply CommonJS default-export assumptions to that dependency, even though the target was an ES module. This affected several packages built around ast-types.
We now tell the CommonJS conversion stage to treat these external dependencies as ESM namespaces. Their named exports remain available to the converted module.
The CommonJS plugin also creates virtual proxy modules for external imports. When one of those proxies imported an already-normalized /npm/.../+esm path, Rollup could interpret it relative to the virtual module and produce an invalid URL beginning with ./npm/. Imports coming from these CommonJS external proxies are now explicitly kept absolute.
While working through that path, we removed an older behavior that appended this to ESM bundles containing only named exports:
export default null;
The synthetic default was originally intended as a compatibility convenience, but it did not exist in the source package. In some CommonJS interop paths, the plugin preferred that default over the module namespace, so a dependency with valid named exports could resolve to null.
Named-only packages are now emitted without an invented default export.
Keeping source-relative assets next to their modules

The QuickJS and Box2D-WASM reports looked different in the browser but had the same underlying cause.
Both packages shipped WebAssembly files next to JavaScript modules and located them using import.meta.url:
const wasmUrl = new URL('./module.wasm', import.meta.url);
Inside the published package, this points to a file next to the current module. After bundling, however, the JavaScript is served from a new /+esm URL. If import.meta.url refers to that final URL, the relative .wasm request starts from the wrong directory and returns a 404.
The jsDelivr Rollup plugin now uses Rollup's resolveImportMeta hook to preserve the original npm URL of each source module. When package code reads import.meta.url, it receives a URL based on the module's published location rather than only the location of the combined bundle.
The same handling applies to other files loaded relative to a module, including workers, dictionaries, model data, and similar package assets.
Source maps should not prevent valid JavaScript from loading

Published source maps vary considerably in quality.
The pixi-filters failure came from a map containing an unknown source represented as null. That is meaningful as missing information, but Rollup expects source names to be strings. We normalize that form to an unknown source name before passing the map on.
Other maps contain unsupported source values or a non-string sourceRoot. Those maps are ignored rather than being allowed to fail the complete JavaScript bundle.
Production data exposed another case: two source names could normalize to the same path while carrying different sourcesContent values. Rollup cannot combine contradictory source contents for one normalized file, so we discard the unusable input map and continue with the JavaScript.
We also changed how the generated source-map URL is identified. It was previously possible for two transformations to produce the same JavaScript but different source maps. The identifier is now derived from the final serialized map itself, so each distinct map receives its own URL.
Giving tree-shaking a chance to remove Node.js code

Before these changes, the resolver stopped a build as soon as it encountered an unsupported Node.js built-in module such as dgram.
That works for code that genuinely uses dgram in the browser path. It also rejected packages where the import existed only inside a server-specific branch that Rollup could otherwise remove:
if (isNode) {
  const dgram = require('dgram');
}
Unsupported built-ins are now represented temporarily as side-effect-free virtual modules. Rollup performs its normal tree-shaking, after which jsDelivr checks whether any of those virtual modules survived in the generated chunk.
If the server-only branch disappeared, the package can be served. If the built-in remains part of the output, the transform still returns the same unsupported-module error.
Expanding the Node.js compatibility layer

Not every Node.js import needs to disappear. Some packages use APIs that can be implemented meaningfully in a browser, and jsDelivr provides those through a fork of rollup-plugin-polyfill-node.
Our production analysis showed several APIs that packages expected but the existing polyfills did not expose, as well as a few implementation and resolution bugs. We made sixteen focused changes to the fork:
util APIs
stripVTControlCharacters
util.types
TextEncoder
URL and path APIs
urlToHttpOptions
pathToFileURL
the path.posix exports
path.parse()
path.format()
Runtime and built-in APIs
process[Symbol.toStringTag]
coverage and fixes for os.homedir()
timers/promises
broader crypto support
support for fs and fs/promises
Resolution and behavior fixes
explicit resolution of the inherits package
corrected internal polyfill resolution
removal of circular-dependency warnings from the stream implementation
correct zlib error-code behavior
The fs implementation is a browser-side compatibility layer. It does not provide access to a visitor's operating system or local files; it supplies the API behavior expected by packages that already have a browser execution path.
Making large transforms less expensive

Compatibility was not the only source of failed /+esm requests. Some packages could be bundled correctly but used too much of the request's execution window or memory budget.
Rollup already performs module resolution, CommonJS conversion, tree-shaking, and code generation. The final ESM minification step previously ran through Terser, adding another potentially expensive transform after the bundle had been generated.
ESM bundles now use esbuild for that final minification step. We made a similar change to jsDelivr's general JavaScript minifier: files larger than 4 MiB use esbuild, while smaller files continue through Terser.
Large dependency graphs also revealed repeated metadata requests. A package such as antd may import several files from the same external dependency. Previously, each imported path could trigger another fetch and version resolution for the same package manifest. The manifest is now fetched once per external package and reused for every file imported from it.
Packages that still need another runtime

A substantial part of the remaining failure traffic comes from packages that publish JSX directly in .js files, particularly packages intended for React Native.
Those files are normally processed by Metro, Babel, or another project-specific build pipeline. jsDelivr does not run arbitrary package compiler configurations, and applying one generic JSX transform would not necessarily produce the environment expected by the package.
We now recognize this parse-error pattern and return a clear unsupported JSX message instead of recording it as an unexplained transform crash. Our regression coverage includes @expo/vector-icons.
Packages also continue to fail when an unsupported Node.js built-in remains in the browser bundle after tree-shaking. In practice, most unresolved cases now fall into a few expected groups: server-only packages, React Native packages, and packages whose published files require an application-specific compilation step.
All of the fixes above are covered by regression tests, including the original reported packages. User reports remain the best source of concrete, reproducible examples, while the production data gives us a broader view of the failures that occur often enough to investigate before each one is reported separately.
What this means for /+esm

This work reduced a large part of the remaining compatibility backlog, improved performance for demanding transforms, and made the failures that remain much easier to understand.
There will still be packages that require Node.js, React Native, or an application-specific build step, but the browser-compatible part of the npm ecosystem is now covered more thoroughly – and we have a better foundation for expanding that coverage further.
```

il tutto senza cambiare dipendenze e/o comandi package.json e/o scripts che devono rimanere inalterati

al massimo fai uno studio di come potrebbe o dovrebbe essere modificata la libreria, per capire come siamo messi
