# Torbie — Claude Code guidance

<!-- aylith-handbook:start -->
> **📖 Aylith handbook (authoritative).** This repo is part of the `aylith-labs` lab. Before any
> cross-repo, catalog, design-system, CI/runner, or data-flow work you **must** consult the org
> handbook — the single source of truth for these conventions:
> https://github.com/aylith-labs/aylith-handbook (locally `../aylith-handbook/`, skill `aylith-labs`).
<!-- aylith-handbook:end -->


## Project Overview

**Torbie** (`aylith-labs/torbie`) is a desktop terminal for Windows, macOS and Linux —
Electron + Angular + TypeScript, built with Webpack, xterm.js for the terminal
itself. It is derived from [Eugeny/tabby](https://github.com/Eugeny/tabby) and has
diverged from it; upstream is now a source to cherry-pick from, not a base to sit on.

**The one hard constraint: plugins written for Tabby must keep loading.** That
ecosystem is why this is a derivative rather than a rewrite. The `tabby-` package
prefix, the `tabby-plugin` npm keyword and the module names plugins `require` are
therefore *not* renamed and never will be — see *What the rename did not touch*.

Run from source; not yet distributed as an installer.

## Commands

```bash
yarn --network-timeout 1000000     # postinstall: patch-package, install-deps, build-native
yarn run build                     # typings + webpack for app and all tabby-* packages
node scripts/prepackage-plugins.mjs
yarn run test                      # the fast tier — pure logic, ~5s, what CI gates on
yarn run test:checks               # check-docs + check-fork-marks (needs `upstream` fetched)
yarn run test:cdp                  # the slow tier — each launches a hidden dev build
yarn run test:list                 # every suite, by tier
yarn run lint                      # biome check . — 443 files in ~0.15s
yarn run lint:fix                  # biome check --write . (safe fixes only)
yarn run typecheck
```

Launching is not `yarn start` — see *Building and running locally* below, which has two
gotchas that cost real time.

## Architecture

`app/` is the Electron shell (main process in `app/lib/`, renderer entry in `app/src/`).
Everything else is a plugin package, builtin or not, listed in `scripts/vars.mjs`:
`tabby-core` (UI, tabs, config, extension points), `tabby-terminal` (emulation),
`tabby-local` / `tabby-ssh` / `tabby-serial` / `tabby-telnet` (session kinds),
`tabby-settings`, `tabby-electron`, `tabby-web`. The fork's own builtins are
`tabby-claude`, `tabby-links`, `tabby-resume`, `tabby-builds`, `tabby-upstream` and
`tabby-render-timing`; each has a section below.

## Conventions

- **Prefer adding new files over editing upstream ones** where there is a choice — it
  decides how much of a cherry-pick lands cleanly, in either direction.
- **Keep commits one-concern-each.** A fat commit is a fat conflict.
- **Never kill the running app.** See the section of that name; it is not a style rule.
- Everything else worth knowing is below, roughly one section per subsystem, and each
  one records what it cost to find out.

## Goals

- **Run locally from source**, with local changes applied. Never build the installer
  (`scripts/build-windows.mjs`, electron-builder) — it is not needed and is slow.
- **Take from upstream deliberately**, by cherry-pick, rather than staying rebased on it.
- **Keep Tabby's plugin API working** — the plugin ecosystem is the reason this is a
  Tabby derivative and not a rewrite.
- Land fixes here first; upstreaming them is optional and never a blocker.

## Branch strategy

**One branch: `main`.** It is the default branch and everything lands there.
There is no mirror branch and no long-lived patch series to replay.

This replaced a two-branch scheme — a pristine `master` mirroring
`upstream/master`, with the fork's work rebased on top as `local` — which is
worth knowing about because a lot of the older notes below were written under
it. That scheme buys conflict-free fast-forward syncs, and it costs a rebase of
the entire series every time upstream moves, which rewrites every SHA and
invalidates every commit link in `docs/`. The fork has diverged far enough that
the trade stopped paying.

**Upstream is now a source to take from, not a base to sit on.** `upstream`
stays configured as a remote and is still fetched, but work is *cherry-picked*
across when something there is wanted:

```bash
git fetch upstream
git log --oneline main..upstream/master        # what they have that we don't
git cherry-pick <sha>                          # take the ones worth taking
```

Nothing forces a periodic sync any more. Upstream's release cadence, measured
(2026-08), is irregular anyway: gaps between the last 15 releases ranged 3–135
days, and `master` averaged ~52 active days a year in bursts.

Two things that were true under the old scheme and stay true:

- **Prefer adding new files over editing upstream ones** where there is a
  choice. It was about rebase conflicts; it is now about how much of a
  cherry-pick lands cleanly, which is the same property.
- **Keep commits one-concern-each.** A fat commit is a fat conflict whichever
  direction the change travels.

**What still needs `upstream/master`.** `scripts/dev/check-fork-marks.mjs`
computes which settings are the fork's as
`keys(working tree) − keys(upstream/master)`, so the remote has to be present
and fetched for it to run — it says so and exits 1 rather than guessing.
`TABBY_UPSTREAM_REF` names another ref. Settings → **Upstream** reads the same
remote through `upstream.remote` / `upstream.branch`, which are config keys and
were never tied to a local branch.

## The rename, and what it deliberately did not touch

The fork is **Torbie** — a tortoiseshell tabby, so the lineage is in the name —
living at `aylith-labs/torbie`. What a user or the operating system reads is
renamed. What a *plugin* reads is not, and that asymmetry is the whole design.

**The compatibility contract, which must never move.** `tabby-core` and its five
sibling packages, the `tabby-` package prefix (`app/src/plugins.ts`,
`webpack.plugin.config.mjs:192`), the `tabby-plugin` / `tabby-builtin-plugin` npm
keywords, the `require` monkey-patches, and the colour scheme names
`Tabby Default` / `Tabby Default Light`, which live **by name** in every user's
`config.yaml`. There is **no version check anywhere in the loader** — no
`apiVersion`, no engine gate — so the prefix and the keyword *are* the entire
contract. Renaming either would unload everybody's plugins with no error.

**Measured, not asserted.** The three third-party plugins installed on this
machine — `tabby-mcp-server`, `tabby-claude-status`, `tabby-backslash-newline`,
each with `require("tabby-core")` and friends compiled into its `dist` bundle —
were copied into a scratch profile and the build launched against it. All three
load, every builtin they ask for resolves (`core`, `settings`, `terminal`,
`local`, `ssh`), `diagnostics.log` records no `require-failed` beyond the
`macos-native-processlist` that is expected on Windows, and their config keys
(`mcp`, `claudeStatus`, `backslashNewline`) are present in the store — which
means their `ConfigProvider`s actually ran rather than the modules merely being
found. 21 plugins in total. Redo this after anything that touches
`app/src/plugins.ts` or a builtin's package name; it is the one claim that
makes this a Tabby derivative rather than another terminal.

**Four pairs that break in silence, now reading one list.** A build used to be
recognised by the literal `'tabby'` in four unrelated places: the well-known
install roots, the executable beside `resources`, a checkout's `package.json`,
and the window title that means a renderer never booted. Rename half of any pair
and nothing throws — the scan simply finds nothing, or the doctor calls every
stuck build healthy. They all read `tabby-builds/src/productNames.ts` now, and
that list keeps **both** products: this machine has an installed Tabby as well,
and a page whose job is "every build here" must still see it. Process
attribution was the same shape (`Get-Process -Name Tabby`) and is fixed the same
way.

**The profile is copied forward, not abandoned.** `app/package.json`'s `name`
decides `app.getPath('userData')`, so it moved from `%APPDATA%\tabby` to
`%APPDATA%\torbie`. `app/lib/migrateUserData.ts` copies the old profile in
before anything reads the config directory — config, window geometry,
credentials, jump-list icons, plugins and `Local Storage`, which holds the saved
tab layout and is the one whose loss is destructive rather than merely rude.
**Copy, never move**: the old directory belongs to an app that may still be
running, and on this machine it is. Precedent is in the tree: `app/lib/config.ts`
has migrated `../terminus/config.yaml` forward since the *last* time this
codebase was renamed, and `app/src/plugins.ts` still aliases `tabby-*` →
`terminus-*`. That rename is the working template — **add names alongside, never
replace**.

**Both environment prefixes, and neither retired.** `TABBY_*` is documented in
HACKING.md, used by every test here, and already sitting in shell profiles and
Windows shortcuts, where an unset variable is not an error but a default.
`app/lib/env.ts` mirrors every variable to the other spelling once at startup, so
a caller may use either and forty read sites go on reading the name they already
read. `tabby://` stays registered beside `torbie://` for the same reason.
`TABBY_SESSION` is deliberately **not** aliased in `tabby-local/src/session.ts`:
it is a pane identity that `tabby-resume`'s WSL probe greps for, and a pane
started before the rename is still carrying it.

**The mark is `>T`** — a prompt closing on the crossbar of a T, whose stem is a
git-branch trunk with a commit at its foot and one at the end of the bar. Every
asset is generated from one definition of it by `scripts/dev/make-icons.mjs`:
the three SVGs, the six Linux PNGs, `build/windows/icon.ico`,
`build/mac/icon.icns`, the five tray images and `docs/favicon.svg`. Nothing is
hand-exported, so nothing can drift.

- **Two treatments over one geometry**, per the studio's brand-mark skill.
  *Theme-aware* flips ink to cream through `prefers-color-scheme` and is what the
  SVGs ship; *bronze duotone* is what every raster bakes, because a PNG cannot
  flip and the Windows taskbar takes its colour from `SystemUsesLightTheme`
  rather than from the app.
- **Rasterized by Chromium, never ImageMagick**, which mis-renders SVG strokes —
  the same reason `jumpListIcons.service.ts` draws through a canvas.
  `rasterize-icons.cjs` refuses any size that comes back fully transparent,
  which is the one failure a set of icons produces silently.
- **`.ico` and `.icns` are written by hand**; nothing in this stack encodes
  either. The ICO is a directory plus one PNG per size (16/32/48/64/128/256).
  The ICNS uses only PNG-capable type codes — `ic04`/`ic05` are ARGB, so the
  16pt and 32pt slots are filled by their @2x forms and macOS scales down.
  Both verified by walking the container back: every offset in range, every
  declared length matching a real PNG of that size, and the ICNS walking to its
  declared end exactly.
- **A theme-aware SVG does flip when used as a CSS `background-image`** — that
  is how the splash consumes it, and it is the context where an SVG gets no
  stylesheet from its parent. Measured rather than assumed: the body tone reads
  `rgb(28, 26, 22)` in light and `rgb(243, 239, 231)` in dark, which are the
  palette's ink and cream exactly.
- The macOS tray images are **templates — black plus alpha only**, which the OS
  recolours for the menu bar. A coloured template renders as a solid blob.
- `app/assets/activity.png` is deliberately untouched: it is the Touch Bar's
  "this tab has activity" indicator, not a brand asset.

**macOS is verified structurally and not visually, deliberately.** There is no
Mac here, and that was accepted rather than worked around: `icon.icns` is walked
back byte for byte and the tray images are correctly black-plus-alpha, but
nobody has seen them in Finder, the Dock or the menu bar. Do not re-open it on
this machine — the next thing that would tell us anything is a real Mac, or a
`build-macos.mjs` run on a runner. The same holds for the Automator workflows
below. Treat both as *unchecked*, never as *checked and fine*.

**Still outstanding.** The UI has not been moved onto the lab's warm-stone
palette beyond the splash and the accent. The macOS
Automator workflows were renamed and their code signatures dropped, which is
**unverified on macOS** — they previously launched `Tabby.app/Contents/MacOS/tabby`,
so leaving them alone was a certain failure rather than an unverified one.
Thirteen translated strings changed msgid and now fall back to English in all 23
locales; `yarn i18n:extract` regenerates `app.pot` but needs gettext's `msgcat`,
which is not on this machine.

## What version this is, and where that number comes from

**The root `package.json` owns it.** `scripts/vars.mjs` reads `version` there —
`1.0.0` — and appends `-nightly.${REV}` unless `git tag --points-at HEAD`
carries exactly `v1.0.0`. Nothing consults a tag it did not put there, so a
clone that still has upstream's imported tags cannot relabel the same commit.
Every build that is not the tagged commit is a nightly; see *Cutting a
release* for what a tag sets in motion.

**`app/package.json`'s version is not that number, and used to disagree with
it loudly.** It said `1.0.0-alpha.1` — upstream Tabby's placeholder, which
upstream also never bumps (their real version is a git tag; `v1.0.235` at the
time of writing, while their `app/package.json` still reads `1.0.0-alpha.1`).
That field is what `app.getVersion()` returns, and it is rewritten at package
time by electron-builder's `extraMetadata` in `scripts/build-windows.mjs` — so
a **packaged** build reported `0.1.0-nightly.0` and a **source** build of the
identical commit reported `1.0.0-alpha.1`. It is `0.1.0` now, so the two agree
on the base, but the two paths still differ by the nightly suffix.

**So what the UI shows is compiled in, not read back.**
`process.env.TABBY_BUILD_VERSION` is a DefinePlugin constant in *both* webpack
configs (the app bundle and every plugin bundle — `appRoot.component.ts` lives
in `tabby-core`, so the app config alone would not reach it), set from
`vars.mjs`. The build tooltip and `HomeBaseService.appVersion` — the settings
header, the start page, and the first line of a bug report — read the constant
and fall back to `app.getVersion()`. Measured in a live source build:
`0.1.0-nightly.0`, sha `e44e74d9`, branch `main`, built "2 minutes ago".

`app.getVersion()` is deliberately left alone at its two remaining call sites:
`updater.service.ts` compares it against a GitHub release tag, and
`configSync.service.ts` records `last_used_with_version`. Both want the
identity a release has, not the one a working tree has.

## Angular 22, and the two defaults that changed under the plugins

The tree is on **Angular 22.1.5 + TypeScript 6.0.3**, up from 15.2 + 4.9. Six
things were in the way; the last two are the ones worth remembering, because
both fail *silently* and one of them threatens the plugin contract directly.

- **Module resolution, not an API change.** A wall of "`@ng-bootstrap` has no
  exported member `NgbModal`" and "cannot find `@angular/cdk/drag-drop`" was
  `moduleResolution: node`, which predates the `exports` field that Angular 22,
  the CDK and ng-bootstrap 21 all publish their subpaths through. `bundler`
  plus `target: es2022` cleared every one.
- **`useDefineForClassFields` is off**, and has to be. `target: es2022` turns it
  on, which changes what a class field *is* — defined before the constructor
  body rather than assigned inside it. A field initializer calling
  `this.translate.instant(...)`, where `translate` is a constructor parameter
  property, was 64 of the 65 errors that produced. Angular's own generated
  tsconfig sets it false.
- **`BootstrapOptions.ngZone` is gone**, so `bootstrapModule(m, { ngZone:
  'zone.js' })` was *silently ignored* rather than rejected, and
  `ZONELESS_ENABLED` now defaults to true. `provideZoneChangeDetection()` in the
  root module asks for a real zone explicitly. Going zoneless for real is a
  migration this codebase has not had — no signals, no `markForCheck`
  discipline, state mutated from xterm and IPC callbacks throughout.
- **`ModuleConcatenationPlugin` is off.** Scope-hoisting Angular 22's chunked
  ESM (`@angular/common`'s `_*-chunk.mjs`) produces a reference to a module with
  a **null id**, which fails as `Cannot read properties of undefined (reading
  'call')` from inside webpack's own require — naming nothing and pointing at
  the runtime. Found by patching the built bundle to print the id it could not
  find. It is an optimisation; re-enable it only with a boot to prove it.

**`OnPush` is the default change-detection strategy now**, and that is the whole
of "Angular 22 boots but does not render". `ChangeDetectionStrategy` gained
`Eager = 1` for the old `CheckAlways` and demoted `Default` to a deprecated
alias of it; the compiler reads `changeDetection ?? OnPush`. `AppRootComponent`
declares no strategy and compiled to `onPush: true`.

The diagnosis that *looked* right and was not: "nothing schedules the first
pass". Measured against that, the zone was real, its inner zone was `angular`,
`NgZoneChangeDetectionScheduler` was subscribed to that exact instance, and it
emitted. The DOM stayed at one element regardless, and a full
`ApplicationRef.tick()` changed nothing while `ng.applyChanges()` took it to 78
— the difference being that `applyChanges` marks the view dirty first, which is
the signature of a view Angular no longer treats as `CheckAlways`.

**`standalone` defaults to `true` now too** — the same change in a second place,
and it fails louder. A plugin declares its components in its own NgModule and
Angular refuses them (*"is marked as standalone and can't be declared in any
NgModule"*), the module throws, and the plugin does not load: 18 plugins instead
of 21, with **nothing in `diagnostics.log`**, because nothing failed to resolve.

**Both are restored in `app/src/plugins.ts`, on the shared module map, and that
placement is the point.** Third-party plugins are why this fork exists; they are
JIT — measured, none of the three installed here ships a static `ɵcmp`, they
call `Component()` at runtime — and `webpack.plugin.config.mjs` marks
`/^@angular/` external, so every builtin *and* every plugin reaches the
decorator through that one object. Annotating our own 87 files would have fixed
our UI and silently frozen theirs, which is exactly what the `tabby-` prefix and
the absent version check exist to prevent. Only *absent* keys are filled in, so
the five components that ask for `OnPush` deliberately still get it, and
`@ng-bootstrap` and `@angular/cdk` are untouched either way — they are
partial-compiled and go through the linker, which picks its defaults from the
Angular version each was built against.

It is a `Proxy`, not a copy, so every other export keeps its identity — they
include the DI tokens and classes the whole app compares against. Assigning onto
the namespace is not available: webpack defines harmony exports as
non-configurable getters, the same reason `xtermFrontend.ts` spreads
`_core.browser` rather than writing into it.

**Verified after, not asserted:** the window renders 91 elements unaided — the
same count as the Angular 15 build — and a forced pass then changes nothing. 21
plugins load, all three third-party ones among them, every builtin they require
resolves, and their `ConfigProvider`s ran.

**Node.** Angular 22 wants `^22.22.3 || ^24.15.0 || >=26.0.0`; this machine has
25.2.1, so installs need `--ignore-engines`. CI is on 22.

## Cutting a release

A tag is the only thing that makes a build call itself a release, and it is also
the only thing that exercises the release path at all. Both halves matter.

**electron-builder is the uploader.** `scripts/build-{macos,linux,windows}.mjs`
each declare a `github` publish provider and `publish: isTag ? 'always' :
'never'`, so on a tag electron-builder pushes the installers *and* the
`latest-*.yml` update manifests into the release itself. Nothing else needs to
attach anything, and adding a second uploader (`softprops/action-gh-release` and
friends) would mean two things owning one release.

**And one workflow owns the whole release.** A tag push runs `release.yml`
(`tagged-release`), which does nothing but *call* `build.yml` — gate, draft,
three platform builds, upload — as one run under that one name. `build.yml` no
longer triggers on tags itself. That shape is what closes the alerting gap the
registry table above used to record: `deploy-alert-targets.json` watches
`tagged-release`, and packaging is now inside it.

- **Every build step needs `GITHUB_TOKEN`, including the unsigned one.** This
  repository has no Actions secrets, so `CAN_SIGN` is false and **every tag
  takes the "without signing" path** — which makes that the step that releases.
  It had the token on Linux and not on macOS or Windows, so v1.0.0 built every
  artifact on all three and then died on two of them with *"GitHub Personal
  Access Token is not set, neither programmatically, nor using env `GH_TOKEN`"*,
  from `electron-publish/src/gitHubPublisher.ts`. Green on `main`, red on the
  tag, at the same commit — because only a tag turns the publisher on.
- **A tag is the only test of this.** `workflow_dispatch` does not reproduce it:
  `isTag` is false, so `publish` is `'never'` and the whole path is skipped.
  There is no way to verify a change here except to cut a tag.
- **Assets arrive minutes after the run starts, one platform at a time.**
  Measured on v1.0.0: the run began at 00:57 and Linux's eighteen artifacts
  landed between 01:05 and 01:10. **So `assets: 0` means "not yet", not
  "none".** Read it once and act on it later and you are acting on a stale
  number — which is exactly how the first v1.0.0 draft came to be deleted as
  empty while holding eighteen uploaded files. Re-read immediately before
  anything destructive, and gate the destructive step on that read rather than
  chaining it after one.
- **The draft is created once, by `build.yml`'s own `Draft` job, before any
  platform job can upload.** It used to come from
  `marvinpinto/action-automatic-releases` in `release.yml`, which makes a
  **new** draft on every push of a tag rather than reusing the one already
  there — so a re-tagged version left two, and electron-builder's platform jobs
  (which upload into "the draft for this tag", whichever they list first) split
  the artifacts between them. Measured on v1.0.0's third push: Windows x64 and
  twelve Linux artifacts in the newer draft, Windows arm64 and eighteen Linux
  in the older, macOS 4/8. Neither was a complete release.
  - It does not bite on a first, clean tag; it bites the moment a tag is
    moved, which is exactly when you are iterating on this workflow.
  - **Why not let electron-builder create the draft itself**, which it does
    when none exists: `getOrCreateRelease` in `electron-publish` lists
    releases and creates one if nothing matches, with no lock between the
    two. Seven platform jobs finish at their own pace, and two matrix jobs on
    the same platform land within seconds of each other — each finding
    nothing and each creating a draft is the same split from a different
    direction. A draft that exists before any build finishes is what removes
    that race, and the old workflow got that half right.
  - **The `Draft` job is idempotent and refuses ambiguity.** One release for
    the tag is reused; none is created (`gh release create --draft
    --verify-tag --generate-notes`); more than one fails the run with the ids,
    because uploading into that state is how a split happens. It runs on
    branch pushes too and does nothing, so the platform jobs `needs:` it
    unconditionally. **It has no checkout, so `gh release create` needs
    `--repo`** — without it gh infers the repository from git and fails with
    *"not a git repository"*, which is how the first run of this job went.
    The command was then proven from a directory with no `.git` before it
    was pushed again; a probe draft made that way was deleted on a fresh read.
  - **Verified on the run after that** (v1.0.0 at `9198ed8f`): every job
    green under `tagged-release`, and exactly **one** draft holding all 34
    assets — Linux x64/arm64/armv7l in five formats each, macOS arm64/x86_64
    as dmg, blockmap and zip, Windows x64/arm64 as setup, blockmap and
    portable zip, plus the seven `latest-*.yml` manifests. That count is the
    thing to check on the next release: fewer means a platform did not
    publish, and two releases for one tag means the split is back.
  - **Recovery from a split:** delete *every* draft for the tag, then push the
    tag once. Delete on a fresh read, per the bullet above.
- The draft is `draft: true`, so a release is never public until somebody
  publishes it. **Once one is published, its tag is frozen**: v1.0.0 was
  force-moved three times while every version of it was an unpublished draft
  with zero downloads and only CI commits between them, and that is the
  boundary — a published tag gets fixes as a patch release, never a move.
  Note that a draft's URL
  is `releases/tag/untagged-<hash>` and `releases/latest` still answers **404**
  — GitHub does not bind a draft to its tag. The gift icon therefore cannot
  appear from a draft, and it cannot appear from a release matching the running
  version either: `ElectronUpdaterService` compares `app.getVersion()` against
  `tag_name`, so the icon is correct to stay hidden until there is a *newer*
  published release.

## Toolchain: why TypeScript is pinned, and why that is not neglect

The org toolchain says `typescript` at its `latest` dist-tag — TS 7, the Go
compiler — and that *"if a repo's toolchain genuinely cannot take TS 7, that is
a finding to report, not a reason to pin quietly"*. It also says an older pin
needs a reason written at it. `package.json` cannot carry a comment, so this
is that reason.

**Angular decides this, and Angular is one major behind TS.** Measured
2026-09-09:

| | version | `typescript` peer |
|---|---|---|
| `main` | `@angular/compiler-cli` 22.1.5 | `>=6.0 <6.1` — hence `typescript@~6.0.3` |
| org standard | `typescript@latest` | **7.0.2** |

So TS 7.0 is unreachable. This is not a pin we chose and it is not one we can
lift by editing a range: `@ngtools/webpack` and the AOT compiler both hard-fail
outside the peer window. Angular 15 used to make this two majors rather than
one; that half is closed.

**The unblocking release is TypeScript 7.1, not an Angular major.** TS 7.0's
Go rewrite dropped the API surface that Angular's compiler, Vue's `vue-tsc`
and typescript-eslint all build on; 7.1 restores enough of it for them to move.
So the sequence is: TS 7.1 stable → Angular widens its peer range → this repo
follows. Measured 2026-09-09: `typescript@latest` is **7.0.2** and 7.1 exists
only as nightlies on `next` (`7.1.0-dev.20260909.1`), which the org toolchain
rules out explicitly — *"Do not pin `typescript@next` or a `x.y.z-dev.*` build
anywhere."*

Re-check by asking, not remembering: `npm view typescript dist-tags` for a
stable 7.1, and `npm view @angular/compiler-cli@latest peerDependencies.typescript`
for whether Angular has widened. Both have to have moved.

**Report it upward rather than sitting on it** — the handbook asks for that
explicitly, and a repo quietly two majors behind the org standard looks like
neglect from outside.

## Where this repo is registered, and where it deliberately is not

The catalog fills itself; five cross-repo registries do not, and nothing fails
when one is skipped — so a repo can look fully onboarded while being invisible
to the hub and the infra dashboard. The handbook's rule is that
*"considered and doesn't apply" is a finished decision; "never looked" is the
gap*, so each is recorded here rather than left to be re-derived.

| Registry | Decision |
|---|---|
| `aylith-com/.aylith/deploy-alert-targets.json` | **Registered**, watching `tagged-release`. It cuts a GitHub release, which is the manifest's own criterion. `Package-Build` runs on `main` too, and routing an ordinary red build there is the noise the criterion excludes — so on a tag, `tagged-release` *calls* `Package-Build` rather than running beside it, and the gate, the draft, every platform build and the upload all fail under the watched name. That closed a real gap: v1.0.0's packaging failed twice on the tag and alerted nobody, because packaging then ran under the unwatched name. See *Cutting a release* below. |
| `aylith-hub/packages/db/seed.ts` | **No.** The hub groups changelogs, stats and live status *by service*; this is a desktop application with no service and, so far, no releases. Revisit at the first tagged release, when there is a changelog worth grouping. |
| `aylith-infra/apps/api/src/config/apps.ts` | **No.** It polls a health endpoint. A terminal on someone's laptop has none, and inventing one would mean the app phoning home — the opposite of what severing upstream's telemetry was for. |
| `entity-graph/adapters/` | **No.** What this stores is profiles, keys and window geometry, all per-machine and private. There is nothing another app should link to or put on a timeline. |
| `aylith-venture/strategy/portfolio.md` | **No.** MIT, alpha, and a personal tool. Not part of the monetized portfolio; a business call rather than a wiring step, and the answer today is no. |

`scripts/audit-onboarding.sh torbie` reports the first as satisfied and the
rest as REVIEW — that is the audit asking a human, not a failure, and this
table is the answer.

## The feature catalogue (`docs/`)

`docs/` is a static showcase site listing everything this carries that upstream
does not — 46 features over 97 of the 109 commits on top of upstream, each with
a detail page. Plain HTML/CSS/JS opened straight from disk: no build step,
no Jekyll (`.nojekyll`), no CDN, no network at all. `docs/features.js` is the
one source the cards, the filters and the detail pages all read;
`docs/feature-details.js` carries the long-form prose beside it. Both workflows
now carry `paths-ignore: docs/**` so a docs-only commit does not run a package
build.

**It has to be kept current — that is the whole point of it.** When a commit
lands on `main` that a reader would call a feature, it belongs there, as a new
entry or on an existing one's `commits`.

```bash
node scripts/dev/check-docs.mjs
```

recomputes every `ins`/`del`/`files`/`dateAdded` from git and fails on anything
that disagrees, on a commit claimed twice, on a commit not on the branch, on a
detail entry for a feature that no longer exists, on a dead link, and on a
capture referenced but never committed. It also *warns* about commits in no
feature — twelve today, all reverts, docs or build patches.

- **Commit SHAs are now stable.** Under the old rebase-onto-`master` scheme,
  replaying the series rewrote every SHA, so all of the commit links went stale
  at once and every entry failed until they were re-pointed — the site's one
  real maintenance cost. A single `main` that is never rebased retires it: run
  the checker after adding a feature, not after a sync.
- **On a shallow clone it passes without checking anything.** The git checks
  start from `git merge-base HEAD upstream/master`, and on a shallow checkout
  that command fails; the checker catches the failure and prints *"no
  upstream/master — skipping the git checks"* even when the ref is right there.
  It then reports `docs OK` over numbers nobody compared. CI clones with
  `fetch-depth: 0`, so a wrong count passes locally and fails on `main`.
  `git rev-parse --is-shallow-repository` says which you have, and
  `git fetch --unshallow upstream` fixes it. Found 2026-09-12, when the local
  checks had been skipping for an unknown stretch.
- **The candour is load-bearing.** Each page has a *What this does not claim*
  block, and the index has *Known limits*: emoji width is listed as broken, the
  stale-glyph artifacts are stated as **not reproduced** by `glyphs.cdp.js`, and
  the things that are upstream's — light/dark schemes, draggable pane titles,
  the jump list itself — say so. Anything hedged in this file must stay hedged
  there.
- **No captures ship.** The pages render media per theme when files exist in
  `docs/media/` and degrade to a placeholder when they do not; nothing fakes
  one meanwhile, and the checker refuses a `media` entry with no file.
- Verified by rendering all 40 pages, and the unknown-id path, in a hidden
  `BrowserWindow` under four theme states (OS light, OS dark, and each forced
  by the toggle) — worst measured contrast 4.93:1 — plus a pass at 380px wide
  for horizontal overflow, and a run over the controls: search, chips, both
  sorts, the view switch, the whole-card click target and the toggle surviving
  navigation.

## Building and running locally

Prereqs on this machine: VS 2022 Build Tools (VC x86/x64 toolset v143), Rust +
`x86_64-pc-windows-msvc`, Python 3.13, `yarn` 1.x, `node-gyp`. Node v25 works; CI uses 22.

**Electron is pinned to 43, and 44 is a plugin-API break rather than a chore.**
Electron 44 replaced the synchronous `clipboard` with a promise-based one:
`clipboard.readText()` returns `Promise<string>` there, and the old
`readText(type?)` is gone. `PlatformService.readClipboard(): string` is an
abstract method in `tabby-core`'s public API — plugins call it, and
`baseTerminalTab`'s paste path is synchronous around it — so taking 44 means
changing a signature every third-party plugin compiled against. The boundary was
measured by unpacking each major's `electron.d.ts`: 39, 40, 41, 42 and 43 all
still declare `readText(type?): string`, and 44 is the first that does not. So
43 is the highest version that costs nothing, and 44 waits for a deliberate
decision about that signature.

```bash
yarn --network-timeout 1000000     # postinstall: patch-package, install-deps, build-native
yarn run build                     # typings + webpack for app and all tabby-* packages
node scripts/prepackage-plugins.mjs
```

### Launching — two gotchas that cost real time

Run the dev build **only** with an isolated profile and a scrubbed environment:

```bash
PROFILE='<scratch>/tabby-profile'
NODE_PATH='C:\Users\steve\projects\tabby\app\node_modules' \
TABBY_PLUGINS= TABBY_DEV=1 TABBY_CONFIG_DIRECTORY="$PROFILE" \
  ./node_modules/electron/dist/electron.exe --user-data-dir="$PROFILE" app --enable-logging=stderr
```

`--dev` is equivalent to `TABBY_DEV=1` and can be used instead — it exists so a
source build can be started from a Windows shortcut, which cannot carry
environment variables. `TABBY_CONFIG_DIRECTORY` follows `--user-data-dir` when
unset, so `electron.exe --dev --user-data-dir=<profile> app` is a complete
launch on its own.

1. **`--user-data-dir` must come BEFORE the app path.** After it, Electron hands the
   switch to the app instead of Chromium and it is silently ignored — the dev build
   then shares `%APPDATA%\torbie` with every other build running under that name,
   and Electron's single-instance lock is keyed on exactly that directory.
2. **Scrub the inherited `NODE_PATH`.** A shell started *inside* Tabby inherits
   `NODE_PATH` pointing at the **installed** app's `resources\builtin-plugins`,
   `app.asar\node_modules` and `%APPDATA%\tabby\plugins\node_modules`, plus
   `TABBY_CONFIG_DIRECTORY`. `findPlugins()` reads `nodeModule.globalPaths`, so the dev
   build loads the *installed* app's plugins against this repo's `tabby-core` →
   `NullInjectorError: No provider for ShellProvider!`. Point `NODE_PATH` at this
   repo's `app/node_modules` — not empty (plugins need `windows-native-registry` etc.
   from there) and not inherited.

Never launch without the isolated profile: the real Tabby holds live Claude Code
sessions, and Electron's single-instance lock is keyed on the userData dir.

### Verifying without a GUI

`ELECTRON_RUN_AS_NODE=1 ./node_modules/electron/dist/electron.exe script.js` runs
Electron as plain Node — no window, but the correct native ABI. Use it to check that
native modules load, instead of launching the app and stealing focus.

### A CDP test must prove what it attached to

**A hardcoded debugging port is a live hazard, not a style problem.** Chromium does
not report a `--remote-debugging-port` it could not bind — it just does not listen,
and every request then goes to whatever *is* on that port. Measured here: a test
that assumed 9251 attached to the user's own Chrome, full of logged-in tabs, and
only a URL filter stopped it evaluating JavaScript in them. Probing whether a port
is free beforehand does not help; the collision is with something that binds it
first, or that was there all along.

So every `*.cdp.js` in this repo goes through `scripts/dev/cdp.cjs`, and:

- **The port is found, never assumed.** `scripts/dev/launch-hidden.mjs` picks a free
  one, records it under `%TEMP%\tabby-cdp\<port>.json`, and removes it on exit; a
  test reads that, sweeps `9230-9280` if there is nothing registered, and refuses
  ambiguity rather than guessing between two instances. There is deliberately no
  fallback constant. `CDP_PORT` names an instance; it vouches for nothing.
- **Nothing is attached to until `/json/version` answers with JSON that names
  Electron.** A browser answers there too — with `Chrome/…` — and is refused. So is
  a port answering HTML, and one that accepts the connection and then says nothing,
  which is what 9223/9224 do because svchost forwards them from WSL (hence a 1.5s
  probe timeout; without it the whole suite waits on the OS).
- `scripts/dev/cdp.test.cjs` asserts each refusal against HTTP servers it owns.
  Never point a negative test at a real browser.

**And a failing CDP test has to exit.** An open CDP socket holds the event loop, so
a `main().catch(…)` that sets `process.exitCode` without closing it leaves the
process alive for ever — `integrationsFreeze.cdp.js` did exactly that, measured at
`>90s` and still going, against 11s now. Two halves: a test that reports by exit
code ends `.finally(closeAll)`, and the shared driver settles every pending request
both when the target goes away and when it simply never replies (20s), because a
promise that does neither is the same hang one level down.

## Linting is Biome, and the formatter is off

`biome.jsonc` replaces `.eslintrc.yml`. Biome is the org's house linter, and
here it checks 443 files in about 150 ms against ESLint's 58 seconds — which is
the difference between a check you run and one you remember to run.

**Three settings carry the whole configuration, and each is load-bearing:**

- **`unsafeParameterDecoratorsEnabled`.** Angular's DI is built on parameter
  decorators — `@Inject(TOKEN) x: T` in a constructor — and the TC39 proposal
  Biome implements has no such thing. Without this, **38 files fail to parse**,
  which is not a lint result but a refusal to read the file.
- **The formatter is off.** It would rewrite **416 of 443 files**. This project
  takes commits from upstream by cherry-pick, and a tree-wide reformat is the
  most conflict-hostile change possible to that — every future pick would land
  in a file whose every line had moved. The house style (no semicolons, four
  spaces, single quotes, trailing commas) is still *recorded* under
  `javascript.formatter`, so `biome format` on a single file is correct if
  someone runs it deliberately. `organizeImports` is off for the same reason:
  245 files, no behavioural gain.
- **`useImportType` and `useNodejsImportProtocol` are off**, and neither is a
  taste call. A type-only import is erased, and Angular reads constructor
  parameter *types* at runtime to resolve them — applying that rule to a DI'd
  class breaks injection with no compile error. And `fs`, `path`, `module` and
  `child_process` are webpack **externals** keyed on exactly those names, so
  rewriting them to `node:fs` silently unmaps them and bundles a shim.

Four more rules are off because the pattern each flags is deliberate and was
already carrying an `eslint-disable` saying so: `noUselessConstructor` (a
subclass constructor that only forwards to `super()` *is* the Angular injection
site), `noInnerDeclarations` (`var x = require(...)` in a try/catch hoists out
of the block on purpose, which is how every optional native module loads),
`noUnusedFunctionParameters` (a default-implementation method on an abstract
provider names its parameters as documentation) and `noUnusedVariables` on a
public type parameter. Everything else that fired was fixed.

- **A `// biome-ignore` carries its reason**, and the five in the tree are all
  cases where the rule is right in general and wrong here: a regex that strips
  control characters *on purpose*, an ESC deliberately excluded from a path
  pattern, two `new Promise(async …)` that settle from callbacks, and Angular's
  own `useExisting: <this class>` registration.
- **The old `eslint-disable` comments are left in place** across 132 files. They
  are inert now, but they document *why* a line is written the way it is, and
  sweeping them would touch 132 mostly-upstream files to delete comments.

## Tests, and the tier they belong in

Until the rename there was **no `test` script in any `package.json` and no
workflow ran any of the forty test files here** — every one was run by hand,
which is the real gap behind "improve stability": there was no safety net at
all, only a habit. `scripts/dev/run-tests.mjs` groups them, and
`.github/workflows/ci.yml` gates on the fast tier.

| Tier | Command | What it needs |
|---|---|---|
| **fast** | `yarn test` | Nothing but a checkout. ~5s, 8 suites / 295 checks. **This is the gate.** |
| **built** | `yarn test:built` | `yarn run build` — it reads the compiled bundle, 515 checks. |
| **checks** | `yarn test:checks` | `check-docs` needs full history; `check-fork-marks` needs `upstream` fetched. **CI runs this too, and it gates packaging** — so a green `yarn test` is not a green CI. Run it before pushing anything that adds a config key or a feature: a fork-added key missing from `fork-settings.json` fails here and nowhere else, and the fix is `node scripts/dev/check-fork-marks.mjs --write`. |
| **cdp** | see below | A compiled bundle **and an instance already listening**. Not a push-button tier. |
| **electron** | `--tier electron` | Electron's native ABI, via `ELECTRON_RUN_AS_NODE`. |
| **wsl** | `--tier wsl` | A real Ubuntu distro. Starts and cleans up its own panes, by pid. |

`yarn test:list` prints every suite and its tier.

- **A fast-tier suite must stay dependency-free, and the runner enforces it.**
  One that quietly starts needing a built bundle turns the gate into a liability
  the first time somebody runs it on a clean checkout. That is not hypothetical:
  `tabby-links/test/logic.test.js` was put in `FAST` and CI caught it on the
  first run, because it reads `tabby-links/dist` and every developer machine
  already has one. `run-tests.mjs` now greps the fast tier for a `/dist/`
  reference and refuses — cruder than running it, but it fails when the suite is
  *added* rather than the next time someone starts from a clean tree.
- **A missing file is a failure, not a skip.** A suite that is renamed and
  silently stops running is precisely what this exists to prevent.
- The CDP tier stays out of CI on purpose: each suite drives a window, and a
  gate that is red for windowing reasons teaches people to ignore it.
- **`yarn test:cdp` does not work, and the tier list is documentation rather
  than a command.** Only the five `app/test/*.test.js` suites launch their own
  instances; every `*.cdp.js` attaches to one that is *already listening* and
  refuses rather than guessing. Run bare, it reports 6 of 28 and twenty-two
  copies of "no hidden dev build is listening", which reads like a catastrophe
  and is a missing precondition. Start one first, with whatever plugins the
  suites need, and leave it up:

  ```bash
  node scripts/dev/launch-hidden.mjs --enable links,linkifier,claude,builds --keep &
  node tabby-links/test/card.cdp.js        # then the suites, individually
  ```

- **Suites share that instance and its profile, so one can poison the next.**
  `tableView.cdp.js` leaves the Builds page on the table view, `view` is
  persisted in `config.yaml`, and its own setup used to wait for a
  `.build-card` that the table view never draws — so it passed on a fresh
  profile and hung on every rerun until it exceeded the driver's 20s request
  budget, reporting "no builds were found" about a scan that had returned
  seven. Wait for a component's own readiness, never for markup only one of its
  views renders.

## NEVER kill the running packaged app

The installed app runs live Claude Code agent sessions. **Never close, restart or kill
it.** The dev build runs as **`electron.exe`**; a packaged build is **`Torbie.exe`** —
and, while an installed Tabby is still on this machine, **`Tabby.exe`** as well. So
`Get-Process electron | Stop-Process` is safe and both of the others are off-limits.
Always verify after killing anything: `@(Get-Process Torbie,Tabby).Count` must be
unchanged. **Kill by PID, never by name** — `scripts/dev/launch-hidden.mjs` records
the count before launching and re-checks it on exit, and only ever stops the PID it
spawned.

## Local patches

Two packages hardcode `SpectreMitigation` in their `binding.gyp` and fail to compile
with MSVC `MSB8040`, because the Spectre-mitigated VC libraries component is not
installed on this machine. Both are patched to drop it:

- `app/patches/node-pty+*.patch`
- `app/patches/@tabby-gang+windows-process-tree+*.patch`

**`@tabby-gang/windows-process-tree` is an `optionalDependency`, which makes its failure
silent** — yarn prints `info This module is OPTIONAL, you can safely ignore this error`,
drops the package, and exits 0. The app then boots to a *different* error, because
`tabby-electron/src/services/platform.service.ts` requires it and `windows-native-registry`
in the **same `try` block**: the first require throwing means `var wnr` is never assigned,
so the real symptom is `Cannot read properties of undefined (reading 'getRegistryKey')`
with nothing about process-tree anywhere. Every `wnr` require in `tabby-electron` is
`try { … } catch { }`, so resolution failures are invisible — instrument the catch before
theorising.

Chicken-and-egg on reinstall: yarn runs the package's own install script (which fails and
removes it) *before* `patch-package` can fix it. To restore it, extract the tarball
directly rather than installing:

```bash
npm pack @tabby-gang/windows-process-tree@0.6.1 --pack-destination <tmp>
tar -xzf <tmp>/*.tgz -C <tmp> && cp -r <tmp>/package app/node_modules/@tabby-gang/windows-process-tree
cd app && npx patch-package && cd .. && node scripts/build-native.mjs
```

**`yarn --ignore-scripts` deletes the Electron binary.** Electron's `dist/` is
produced by its own `postinstall`, so any install that skips scripts relinks the
package and leaves `node_modules/electron/dist/electron.exe` gone — every launch
then fails with `ENOENT spawn …electron.exe`, which does not mention scripts.
Hit twice. Recover without a full reinstall:

```bash
cd node_modules/electron && node install.js
```

**Never `npm install` in this repo.** It reconciles the yarn-managed tree to npm's layout
(observed: "added 104, removed 62, changed 27"), which leaves two copies of Angular and
breaks DI with `NullInjectorError: No provider for ShellProvider!` — a symptom that looks
nothing like its cause. Recover with `cd app && yarn`.

**Patch files must be written by hand.** `patch-package <pkg>` auto-generates garbage here:
it sweeps in `build/Release` binaries, `.obj` and `.tlog` files (2273 lines for node-pty).
Patches are also version-pinned in their filename — when upstream bumps either package,
regenerate or patch-package errors on the mismatch.

**`pug-html-loader` must stay at 1.1.5.** 1.1.7 fails the build with `A valid
query string passed to parseQuery should begin with '?'`: `app/webpack.config.mjs`
reaches it through an inline loader chain
(`file-loader?name=index.html!pug-html-loader!…`), and the `loader-utils` it
picks up at that version refuses the empty query that leaves it. Found by
applying a grouped Dependabot batch rather than reading it; the pin is exact so
a range cannot drift past it.

Do not commit `app/yarn.lock` churn. Yarn 1.x rewrites the aliased `string-width-cjs` /
`strip-ansi-cjs` entries on every install; `git checkout -- app/yarn.lock` after
installing. Upstream edits that file often, so local noise there causes sync pain.

## Claude Code integration (`tabby-claude`)

Claude session awareness is **built into the fork**, not a plugin: `tabby-claude/`
is a builtin package (listed in `scripts/vars.mjs`), so it ships inside a build slot
and is frozen with it. It provides a docked session panel and a tab hover card.

It rests on two new **generic** extension points in `tabby-core`, both add-only files:

- `SidePanelProvider` — contributes a panel to the dock host. The host
  (`sidePanelHost.component.*`) owns the header, edge picker and resize handle;
  `appRoot` places it with a **CSS grid area**, so moving a panel between edges
  never re-creates the component. `.window` keeps its original flex layout when no
  panel is shown, so the diff against upstream is one class binding plus one line.
- `TabHoverProvider` — contributes a rich hover card for a tab header, rendered
  through `tab-hover-host`. Falls back to the plain title tooltip when no provider
  applies. `isApplicable()` runs on every hover, so it must stay cheap.

**Data comes from stith** (`https://stith.lvh.me/api/{agents,waiting,usage}`), the
session registry — *not* from the hook spool. This is deliberate: the spool is
consume-and-delete, so a second reader would steal events from
`tabby-claude-status`, which still owns audio, tab decoration and session restore.
Reading stith means zero conflict and no plugin changes.

stith does not compute context-window usage, so that is derived locally from the
tail of the transcript JSONL (`transcriptMetrics.service.ts`). Transcripts reach
**160 MB**, so never read one whole — a 256 KB tail is enough, verified against
every live session. WSL transcripts are read over `\\wsl.localhost\<distro>\…`,
built from stith's `wslDistro`.

**Tabs are joined to sessions by directory**, never by PID: a Claude session in
WSL reports Linux PIDs that can never match Tabby's Windows conpty PIDs. Only an
unambiguous 1:1 pairing is trusted — a card on the wrong tab is worse than no
card.

Three things make that join work, each of which cost real debugging:

1. **The join key is the *launch* directory, not `cwd`.** A session's reported
   `cwd` comes from the hook payload, which follows every `cd` the agent makes
   through the Bash tool — measured live, 2 of 13 sessions had already drifted.
   Claude does record the launch directory, encoded into the transcript's
   project folder (`~/.claude/projects/C--Users-steve-projects/`). That encoding
   (`[\\/:]` → `-`) is lossy, so it is never decoded: the tab's directory is
   encoded the same way and the encoded forms compared, which is exact.
   Verified against the live registry — 11 of 13 reproduce, and the 2 that
   don't are exactly the drifted ones.
2. **The launch directory can be *recovered*** by walking the drifted cwd's
   ancestors until one encodes to the project key. `claude --resume` only finds
   a session from its launch directory, so this is what makes Resume work at
   all — see `ClaudeSessionsService.launchDirectory()`.
3. **`getWorkingDirectory()` alone never matches Windows tabs.** tabby-local
   deliberately returns null when the shell's live directory still equals the
   one it launched in (`tabby-local/src/session.ts`: "shell doesn't truly change
   its process' CWD") — i.e. the common case of opening a terminal in a repo and
   running `claude`. So `initialCWD` and the profile's cwd are used as
   fallbacks.

For WSL, `OSCProcessor` now parses **OSC 7** (`file://host/path`) as well as
iTerm's OSC 1337; OSC 7 is what default bash/zsh (including WSL's) emit, so
before this a WSL tab reported no working directory at all.

### Clicking a row focuses the pane it is actually running in

"Focus tab" could only ever mean a tab in this window, and most sessions on this
machine are not in one: measured live, **15 of 15 listed sessions had a
herdr/shefrd pane and no tab here**, so every single click fell through to the
"there is nothing to focus" branch and opened stith in a browser.
`herdr.service.ts` closes that, and `claude.shefrd.enabled` (on) is the switch.

- **Everything goes through stith, and nothing invokes a binary.** stith already
  holds a socket to every multiplexer server, which is the only reason this is
  reachable from a renderer at all — `GET /api/herdr/panes` and
  `POST /api/herdr/focus {kind,id}`. `tabby-links`' `shefrd.json` manifest talks
  to exactly those two, and the addresses are kept identical on purpose. There
  is deliberately **no second URL setting**: `claude.stithURL` is the whole
  address, so the two cannot drift apart.
- **The join is `sessionId`**, matched against the pane rows' own. A pane with
  no session is the trap — `undefined === undefined` would match it for any
  session whose id is missing — so paneless rows are excluded explicitly.
- **It is a separate service from `StithService`**, which documents at the top of
  its file that it never mutates stith state. A focus POST does.
- **Three places, tried nearest first**, because each is more disruptive than
  the last: a tab here, then a pane, then a browser. `focusSession` returns which
  it used.
- **`focus()` returns how it failed, not a boolean.** "No pane" means the session
  is elsewhere and a browser is the honest answer; "failed" means the pane is
  real and something transient went wrong, which is not the same fallback.
- **The timeout is its own constant, not `claude.requestTimeoutMs`.** That one is
  the poll's budget, tuned against a 2s interval where failing fast is right.
  Neither call here is a poll, and an aborted focus looks exactly like a click
  that did nothing. Measured: listing 45–110 ms for 44 panes, focus POST 120 ms.
- The pane cache is warmed from the panel's own `options` getter rather than a
  timer — it no-ops unless the cache is over ten seconds old, so the labels stay
  honest without doubling this window's traffic to stith.
- `tabby-claude/test/herdr.test.js` (20 checks, fast tier) drives the service
  against an HTTP server it owns. **Never point it at the real stith**: the whole
  point of the service is a command that moves someone's desktop, which is not a
  thing a suite may do as a side effect. The live path was verified once, by
  hand, recording which pane was focused first and putting it back.

### The panel is panes, VSCode-style

One long scroll became four panes, each with its own header and its own scroll
container, the expanded ones sharing the panel's height.

- **Not ng-bootstrap's accordion**, deliberately. That sizes each body to its
  content and collapses by animating height; a pane here has to take *a share of
  the panel* and scroll inside it.
- **`flex: 1 1 0`, not `1 1 auto`.** With `auto` the panes split the height in
  proportion to how much content each holds, so one busy pane takes everything
  and the rest are reduced to their headers anyway — which is the problem this
  set out to fix. A collapsed pane is `flex: none` and costs exactly its header.
- **The panel owns its height** (`:host { height: 100% }`) so `.panel-body`'s own
  `overflow: auto` never engages. That stays in `sidePanelHost` as the fallback
  for a panel that does not do this.
- **`trackBy: trackSession`.** Every poll builds fresh session objects, so
  identity tracking re-created every row twice a second — which drops hover
  state and defeats the browser's scroll anchoring inside a pane that is now
  independently scrollable.
- The usage view switch lives in the pane header and `stopPropagation()`s:
  the header is the pane's toggle, and changing the view must not collapse the
  pane you are looking at.
- State is view state: `localStorage.claudePanelPaneCollapsed`, the shape
  `linkTooltipGroupCollapsed` and `profileGroupCollapsed` already use.

### The settings page is grouped, and a dependant says so

Four accordion groups over what was a 183-line flat scroll
(`localStorage.claudeGroupCollapsed`), following the Link Tooltip page exactly —
including its rule that **nothing sets `disabled` on an accordion item**, since
every master switch lives inside the group it governs and a disabled header
could never be opened to switch it back on.

- The six rows under **Active session** are the sections the panel renders
  *inside* `*ngIf='showActiveSession && activeSession'`. With the master off they
  were six controls that silently changed nothing; they are now indented and
  `[disabled]`, which is measured both ways in the live check.
- They are a table in the component rather than six near-identical template
  blocks, because the thing that matters about them is that they are one group.
- **Waiting / Other sessions / Usage are deliberately not indented** — they are
  their own top-level sections in the panel and are governed by nothing above.
- The connection test reports the pane count beside the session count: stith
  answering while herdr is not running is a real state, and the one that makes
  pane focusing fall back to the browser without saying why.

### Verifying the UI without stealing focus

Tabby's `--hidden` flag creates the window with `show: false` and skips
`focus()`, so the full renderer boots with nothing on screen. Combined with
`--remote-debugging-port` that allows rigorous verification while the machine is
in use — and CDP checks layout better than a screenshot: read
`getComputedStyle(...).gridTemplateAreas` and `getBoundingClientRect()` and
assert the panel and terminal tile without overlap.

```bash
NODE_PATH=<repo>/app/node_modules TABBY_PLUGINS= TABBY_DEV=1 \
TABBY_CONFIG_DIRECTORY=$P ./node_modules/electron/dist/electron.exe \
  --user-data-dir=$P --remote-debugging-port=9238 app --hidden
```

Gotchas found the hard way: a **second** dev instance on the same
`--user-data-dir` exits silently with code 0 (single-instance lock) — use a
separate profile. `window.ng.applyChanges(cmp)` is needed after poking a
component directly, since that bypasses the zone-patched listener that would
normally run change detection. And `app.tabs` holds `SplitTabComponent`
wrappers, not terminals — descend via `getAllTabs()`.

Verify the network path without a GUI — Node's fetch uses its own CA bundle, so
only a real renderer proves the mkcert cert is trusted:

```bash
./node_modules/electron/dist/electron.exe --user-data-dir=<scratch> fetch-test.js
# BrowserWindow({ show: false }) + webContents.executeJavaScript(fetch(...))
```

## Link tooltips and integrations (`tabby-links`)

### Rich content, contextual headers and embedded links

Jira ADF tables and panels retain their structure through `richText.ts`. The shared preview
component renders tables/callouts recursively; fenced code uses `PreviewCodeComponent`,
with hover/focus Copy and an overflow-dependent Wrap control. Pane author identities use
40px circular avatars and two lines; popovers keep their compact single-line identity.

Lintel display fields can set `placement` (`header`, `status`, `details`) and a URL `link`
template. Title, status/actions and contextual metadata stay above the tabs. Jira type and
priority links open searches, and parent links use the same hover controller as buffer links.
`EmbeddedLinksService` bridges into the existing decorator without a component import cycle;
children have independent hover state and remain in the parent DOM subtree to keep it alive.
`linkTooltip.nested` defaults false inside popovers; panes enable embedded previews. Depth is
capped at four. `linkTooltip.maxHeight` defaults 720 and caps the complete scrolling card.

`pathResolution.ts` and `pathPatterns.ts` are generated from Lintel `paths/`. Known source
WSL distributions are authoritative. Unknown ones are resolved by registered distributions
and asynchronous existence checks, accepting a unique match only. Never run a shell from a
hover. Explicit Windows drive paths stay Windows paths, including mapped `Z:` drives.

The new rich-content, embedded-link and path cases are part of the 733 link logic checks.
Lint/type checks and bundle compilation do not replace live hover verification after restart.

GitHub account settings use `integrationAccount.ts`: CLI-first authentication for github.com,
then a saved PAT. The same credential selection feeds repo#number previews. The ordered
`candidateOwners` editor retains comma-separated storage and validates/deduplicates account
names. Organization discovery includes accessible repository owners because fine-grained
PATs may return no `/user/orgs` memberships. Discovery is opt-in from the menu and bounded to
three pages per endpoint. Identity checks also support Jira and Slack through Lintel's
`account.provider` metadata. Never put credentials or raw response bodies in the account UI.
Only untouched named legacy GitHub presets migrate; custom expressions remain unchanged.


A hover card over terminal links, a **Link Tooltip** settings page of rules that
customise it, and an **Integrations** page driven by declarative `integration.json`
manifests that fetch a preview for what a link refers to. Ported from the Windows
Terminal fork; `tabby-links/INTEGRATIONS.md` is the manifest spec, and the three
built-in manifests (Jira, Slack, stith) are kept interchangeable with that fork's.

The parts that cost real time:

- **Tabby's linkifier was broken for file paths and bare IPs.**
  `@xterm/addon-web-links@0.10.0` filters every match through an internal
  `isUrl()` (`new URL(text)` must parse), so `UnixFileHandler`,
  `WindowsFileHandler` and `IPHandler` never produced a clickable link. Our own
  provider vendors that addon's `LinkComputer` — the wrapped-line window and the
  early-wrapped-wide-char index correction are subtle and worth keeping verbatim —
  minus the filter, which fixes all three.
- **Two hover paths, not one.** xterm registers its own `OscLinkProvider` first
  and earlier providers win, so an OSC 8 link never reaches ours; it reaches
  `xterm.options.linkHandler`, which is *wrapped* rather than replaced (the
  linkifier writes it too, and only one of us can be last).
- **`provideLinks` must call its callback exactly once, on every path.**
  `OscLinkProvider` answers `[]` — truthy — so our links only ever arrive through
  the "every provider replied" pass. A provider that never calls back silently
  kills every provider after it.
- **We splice ourselves to index 1** in `_core._linkProviderService.linkProviders`
  rather than editing `tabby-linkifier`. Decorator order is plugin load order
  (alphabetical, so `linkifier` < `links`), and relying on that would have left
  `WebLinksAddon` shadowing us. Returning `[]` when the feature is off falls
  through to it cleanly, which is what makes the setting live with no re-attach.
- **Slack's `<uri|label>` is one match at a priority above every handler**
  (`delimitedLinks.ts`), not a change to any handler's regex. The Windows
  Terminal port this comes from (`c2dd09a42`) describes a bug that *does not
  exist here*: there `|` is inside the bare-URI character class, so the opener
  was handed `…/9962|repo#9962`; Tabby's `URLHandler` has no `|` in any of its
  classes and already stops at the pipe. What was actually missing is that the
  brackets and the label belonged to no link at all — measured before the fix,
  columns 0 and 33..43 of the construct resolved to `null`. So the delimited
  match has to *enclose* the bare one and take its cells, which is what
  `consider()`'s priority does; it ties with the text-rule tier deliberately, so
  a rule the user wrote for something in the label still wins. The URI is still
  shown in full — collapsing it to the label would mean the renderer showing
  text the buffer does not hold, which selection, copy, search and reflow all
  depend on.
- **The card is `position: fixed` but a DOM child of `.xterm-screen`.** It has to
  be a descendant or xterm's `xterm-hover` guard never applies and `mouseleave`
  clears the link the instant the pointer reaches the card; it has to be fixed or
  `.content { overflow: hidden }` clips it near a pane edge. The fixed containing
  block is not always the window (`app-root` has `will-change: transform`, a
  maximized split has `backdrop-filter`), so it is placed by measuring its own
  origin at `translate(0,0)` and then translating.
- **The card is bounded by the pane, not the window, and the cap comes before
  the measurement.** Clamping where an edge lands does nothing once the card is
  already wider than the pane it sits in — `linkTooltip.maxWidth` defaults to
  640px and knows nothing about how the window is split — so `position()` writes
  `--link-card-max-width`, the lesser of that setting and the hovered
  `.xterm-screen`'s own width, *before* it reads the card's size. The setting is
  an upper bound, never the width. CSS applies `min-width` after `max-width`, so
  the cap has to be spelled into both or `.link-card`'s 220px minimum quietly
  wins back the overflow in a narrow split.
- **Everything runs outside `NgZone`** — xterm's listeners are raw DOM. The card
  is created with `createComponent` + `ApplicationRef.attachView` (no
  `ViewContainerRef` exists in a decorator) and updated inside `zone.run`.
- **An `*ngFor` over a method that builds objects is an unbreakable freeze.**
  Clicking an integration wedged the whole window: the Integrations detail view
  iterated `fieldGroups(current)`, `*ngFor` tracks by identity, so every pass
  destroyed and re-created each `checkbox`, and every new `ngModel` queues the
  microtask that writes its value — which schedules the next pass. Measured at a
  full core and 500 MB and climbing, and **the inspector cannot interrupt it**:
  `Debugger.enable` gets no reply, exactly like the unicode-graphemes hang, so
  the stack has to be reasoned out rather than read. The derived arrays are now
  built once per selection. The hover card was only ever safe because its
  `*ngFor`s carry `trackBy: trackItem`, which returns the *index*.
- **The card is keyed on `(text, range)` and never rebuilt while it is open.**
  The Linkifier re-asks on every rendered-viewport change touching the hovered
  row, so during output that fires many times a second; rebuilding would strobe
  the card and restart its fetch every frame.
- **A rule pattern is a remotely triggerable freeze.** It runs synchronously on
  the mouse-move handler against text a remote host printed, and `(a+)+b` on
  thirty `a`s takes ~12 s. Patterns are probed at increasing input lengths and
  refused both on save and on compile, so a rule hand-written into `config.yaml`
  is covered. **The probe must escalate**: the first version used fixed 64-char
  inputs and took 127 seconds on `(a+)+b` — it reproduced the freeze it was
  meant to prevent. Measuring is also why the built-in handler regexes survive:
  they contain nested quantifiers and are fast, so a static syntax check would
  refuse Tabby's own defaults.
- **`safeStorage` cannot be driven over `@electron/remote`.** `encryptString`
  returns a Buffer, which crosses the bridge as a `Uint8Array`, and
  `decryptString` rejects a non-Buffer. `app/lib/secrets.ts` does the base64 in
  the main process so only strings cross. Credentials live in
  `<config dir>/integration-credentials.json`, never `config.yaml` — Config Sync
  uploads that file verbatim.
- **A `{}` config default silently discards writes.** `isStructuralMember` is
  false for an empty object, so `ConfigProxy` hands back a fresh `deepClone` on
  every read. The `integrations` map needs `__nonStructural: true`.
- **Bind settings inputs to the config, not to an `Integration` snapshot.**
  Snapshots are rebuilt on `config.changed$`, which arrives after
  `config.save()` resolves, so an input bound to one reverts characters while
  they are being typed.
- Open and Show in folder use `platform.openPath()` / `showItemInFolder()`, not
  `openExternal('file://' + p)` — that yields `file://C:\foo` on Windows and is
  an existing upstream bug in `tabby-linkifier/src/handlers.ts`.

### The Integrations list verifies itself when it opens

`checkIntegrationAccount` already existed and only ever ran for the integration
you had clicked into, so the list said nothing about whether any of them
actually worked — a row whose token was revoked last week and a working row drew
identically. `integrationAccounts.service.ts` checks every row on open and each
one carries its own verdict.

- **This is deliberately the opposite call from the Upstream page**, which
  refuses to fetch on open because network I/O on a settings page is how one
  earns a reputation for being slow. The difference is what a stale answer is
  worth: a commit count still describes something usefully when it is old, while
  a credential either works right now or the feature silently does nothing.
- So the cost is kept down rather than avoided: **nothing is sent** for an
  integration that is off or unconfigured (`checkIntegrationAccount` answers
  those without a request, so the row still gets a badge for free), the rest go
  **out together**, and the rows **draw first** with each badge filling itself in.
- **The cache is load-bearing, not an optimisation.** `integrations$` re-emits on
  every `config.save()`, which is per keystroke in a settings box — without a
  TTL, "check the list when it changes" is a request per character. Blur is the
  only safe place to invalidate for the same reason.
- **The detail view's check goes through the same service.** Two code paths
  asking the same question would be two answers on screen at once, one behind
  the other. Organization *discovery* stays direct: different, heavier request,
  and not what the list shows.
- **The label is an answer, not the state's name.** "unsupported" describes the
  code; "No account to check" describes what the reader is looking at. State is
  carried by an icon as well as a colour.
- `tabby-links/test/integrationAccounts.test.js` (15 checks, fast tier) replaces
  the check module with a counter before the service is loaded, so nothing in
  that process can reach a network — which is the only way to assert the
  economics rather than the verdicts. Measured live once instead: 6 rows, all
  drawn before any check finished, GitHub connected as the real account via the
  CLI, Jira and Slack asking to be set up, three manifests with no account
  endpoint saying so.
- **A transient is not always observable, and a flaky assertion is worse than
  none.** "A row starts as Checking…" failed intermittently because `gh auth
  token` plus one API call can finish inside the sampling window. The spinner
  path is asserted deterministically instead, from `accounts.busy` immediately
  after a forced re-check.

### The folder button creates the folder it opens

On a fresh profile the button beside "drop a folder containing an
integration.json into" did nothing. `<config dir>/integrations` does not exist
until someone makes it, `shell.openPath` answers a missing path with an error
*string* rather than a rejection, and `PlatformService.openPath` discards it.
The button now creates it (`recursive`) first, and reports a failure it can
see, such as a file sitting where the directory should be. A shell failure
after that stays invisible, because `openPath` returns nothing; surfacing it
means changing that platform API. `userDirectory.cdp.js` stubs `openPath` for
the run, so no Explorer window opens on the desktop.

### Rich integrations

The reference fork grew five manifest keys in `3f221ee31`, and a manifest using
them **degraded silently here** until this was done — which is the actual threat
to "one manifest, many terminals", far more than any cosmetic divergence.

- **`fieldGroups`** — named sets of display fields, with a heading on the card
  and a tri-state header checkbox in settings. Anything no group claims becomes
  an implicit unlabelled group shown *first*, so a manifest that groups only its
  secondary data still leads with its title.
- **`tabs`** — a description body or a comment list, behind a strip. `adf`
  (Atlassian Document Format) is flattened by walking the node tree; `markdown`
  is **parsed to data, never to HTML**, and the template renders blocks and
  inline spans through interpolation. This text is written by whoever opened the
  ticket, so there is deliberately nothing to sanitise.
- **`actions`** — the only part of this subsystem that *writes*. A `choice`
  resolves its options from an earlier step, applies one, drops the cached
  preview and re-fetches so the badge updates in place. Undo is offered only
  when some other option leads back to where you were — Jira workflows are
  frequently one-directional, and the card says nothing rather than offering an
  undo that would fail.
- **`detectPatterns`** — joined to the scan pool as *synthetic rules*, which is
  what makes them obey the 16-pattern cap, the ReDoS guard and first-match-wins
  without any of that being written twice. User rules are added first, so one the
  user wrote still wins.
- **step `optional`** — a failing step is recorded and stepped over. Jira's
  Development panel and GitHub's richer endpoints are permission-dependent, and a
  403 should cost that section, not the card.

`github.json` joins the built-ins. All four manifests are held to the
reference's copies **key by key** — every top-level key, so one nobody thought
to compare cannot drift — at a **pinned commit**, `b9a41937a1` ("Give Slack its
logo too"), the newest one there that touches a manifest.

Pinning is the point. That checkout is somebody's live workspace; its HEAD moved
four times during one session here, so a test that reads its HEAD reports a
different number every run, and "parity" stops being checkable. `TERMINAL_REF`
in `tabby-links/test/logic.test.js` names the commit; re-point it deliberately,
after `git log <pin>..HEAD -- …/integrations` in that checkout says there is
anything to re-point for. A pin that has been rebased away *fails* rather than
skipping — the skip is only for a machine with no reference checkout at all,
because a parity test that quietly skips is how this drifted in the first place.

The divergences are a table in the test, and an entry is only spent when the key
really differs, so one resolved upstream fails too and asks for its entry back:

- **Jira's `normalize`/`suffix`** and **stith's `html`** — additive, documented
  above, and ignorable by a host that has never heard of them.
- **`github.icon` used to be here, and is not any more.** That fork wrote its
  icon as a bare Segoe MDL2 code point, which an `<img src>` cannot load; it
  now ships `ms-appx:///IntegrationIcons/<file>.png`, and so do we, verbatim.
  Each host resolves that URI its own way — `IconPathConverter` there,
  `integrationIcons.ts` against a map of PNGs webpack inlines into the bundle
  here — so the key is identical again and the entry is spent. An icon this
  host cannot resolve yields `''` and one log line, so the card draws no icon
  rather than a broken one.
- **`github.settings` and `github.matchers`** — `candidateOwners` and the
  `repo#number` matcher, which are one feature whose working half is host code
  there: a cached probe of each candidate owner, falling back to
  `gh auth token`. No manifest key expresses that, so a `repo#123` match here
  would resolve no owner and fetch `repos//<repo>/issues/<n>` — a 404 offered as
  a suggested rule. Adopt the pair together, once that resolution is ported.

The assertion had in fact been **red for some time** — nine failures, drift on
three of the four manifests — which is the same shape as everything else in this
section: a ported feature degrading quietly while the note above it says it is
fine. What it had missed:

- **Slack's capture groups**, renamed `ts_s`/`ts_us` → `tsSeconds`/`tsMicros`
  upstream to satisfy ICU's stricter group-name grammar. JS `RegExp` needs no
  such thing, and the rename is adopted anyway: a manifest is meant to be moved
  between the two, and a group name is exactly the sort of detail that decides
  whether it works when it arrives.
- **GitHub's `commitSha`, `commitParent` and `commitFiles`**, and the field
  group that lists them.
- **stith's `tabs`** (a markdown Summary body), its `baseUrl` default, and the
  suggested text matcher that makes a `stith://` reference in plain output
  offerable as a rule.

Two of those needed the engine to mean the same thing, not just the JSON:

- **`length` on an array is a pointer extension the reference has** and this did
  not. `commit:/files/length` is how GitHub's "Files changed" is counted for a
  commit, and without it that field rendered as nothing at all — the adopted-key,
  silent-no-op failure in miniature.
- **A settings field's `default`** is now seeded, stored values overlaying it.
  It is the whole of the reference's "default configuration" fix: stith previews
  out of the box instead of calling itself unconfigured until someone retypes the
  placeholder into the box. The reference *also* falls back to a `placeholder`
  that starts with a scheme; that is a host heuristic rather than a manifest key,
  and no built-in manifest can tell the difference, so it is not copied.

Two things worth knowing:

- **`detectPatterns` is often belt and braces here.** Tabby's own URI detector
  already claims anything with a `scheme://`, so `stith://…` in plain output was
  hoverable before this. Measured, not assumed: two providers claim it, both as a
  *link*. It earns its keep on patterns that are not URIs.
- **A restored-but-never-rendered tab has a frontend and an `xterm` but no
  provider of ours.** Of six terminals in the scratch profile only two had the
  decorator attached, and a test that picks the first one makes a working
  detector look broken. Select on `decorator.states.has(tab)`.

### The `html` representation

A manifest may carry an `html` key — a complete HTML document, rendered in place
of the `fields` list, given `window.__data` (every fetch step's JSON, keyed by
step id) and `window.__uri`, and talking back over
`chrome.webview.postMessage` with `{height}` (clamped 40–320) or `{open}`.
`tabby-links/INTEGRATIONS.md` has the contract; `htmlHost.ts` builds the
document and `stith.json` is the worked example.

This is a **port of the Windows Terminal fork's contract, which that fork cannot
run**: its WebView2 host is compiled behind `Feature_HyperlinkPreviewHtml` with
no `WebView2Loader.dll` shipped, so `html` there always falls back to `fields`.
Both repos previously documented it as "reserved, not implemented in either
fork", which was wrong and cost a rediscovery.

- **`sandbox="allow-scripts"`, and nothing else, is the entire security story.**
  Tabby's renderer is `nodeIntegration: true`, `contextIsolation: false`
  (`app/lib/window.ts:77`) with **no CSP anywhere in the app**, so a plugin page
  that reached the parent realm would be `require('child_process')`, not XSS.
  Without `allow-same-origin` the frame is on an opaque origin and can do
  nothing but post a message. Verified live: `window.origin === 'null'`, no
  `require`, no `process`, and reading into the frame from the host throws
  `SecurityError`.
- **Angular refuses a *bound* `sandbox`** (NG0910) and is right to, so it is
  written out literally in the template. `HTML_SANDBOX` exists only so a test can
  assert the two have not drifted.
- **A CSP is injected ahead of the document** — `default-src 'none'`,
  `connect-src 'none'` — which the WebView2 host does not do. The page renders
  data already fetched and cannot call home. `img-src https:` is the one
  exception, for parity with `iconPath` on a `fields` card.
- **`srcdoc` is written only when the card's key changes.** Assigning it reloads
  the page and restarts its script, and the Linkifier re-asks many times a second
  during output.
- **A page cannot be verified in the hidden dev build.** Chromium throttles
  rendering for a cross-origin subframe that is never visible, so the frame's
  document is never laid out and *every* measurement inside it reads 0 — a
  `height: 77px` div included. `test/htmlPage.electron.js` gives the page its own
  window, shown without focus and off-screen, purely so a compositor runs.
- **Measure `document.body.scrollHeight`, not `documentElement`'s.** The latter is
  the frame's own viewport, so a page that reports it just asks to stay the size
  it already is — a silent no-op that looks exactly like a broken channel.

### Show in pane

A card button puts the same preview in a **real pane** beside the terminal —
grouped fields, markdown bodies, comments, actions and a plugin's own `html` —
with a switch that silences hover cards while one is open.

**This reverses a decision this fork had written down.** `htmlHost.ts` used to
say outright that "a plugin asking for 1000px does not get the pane", because
there was no pane. Half of that sentence was always about the card and still
holds: the card is a hover affordance, it is still bounded by the terminal pane
it floats over, and a page there is still clamped to 320px. The pane is the
opt-in place where a big preview is legitimate, and there a page may ask for up
to 4000px. That comment now says which host each limit belongs to rather than
stating a policy the code contradicts.

- **One renderer, in two hosts.** `linkPreviewView.component` is the whole
  preview — groups, the tab strip, markdown, comments, actions, the sandboxed
  frame — and the card and the pane each mount it. A second copy of that markup
  is exactly how the pane would end up less sealed than the card, so
  `logic.test.js` now also asserts that no other template in the package
  contains an `iframe` at all.
- **The only thing the pane passes it that the card does not is room**: a `pane`
  flag that swaps five CSS variables (body cap, options cap, two line clamps, an
  image cap) and a larger `maxHtmlHeight`. Everything else — `trackBy` on every
  `*ngFor`, markdown parsed to data and never to HTML, `srcdoc` written only
  when the key changes — is therefore stated once and true in both.
- **`ngAfterViewChecked` writes the frame**, not each host. The card called
  `syncHtmlFrame()` from its own `refresh()`; with two hosts that becomes two
  places to forget. A check whose key has not changed is one comparison.
- **The pane must be opened inside `NgZone`.** The card's buttons hang off
  xterm's own DOM, which is outside it, and `TabsService.create` +
  `SplitTabComponent.addTab` from outside the zone builds a tab nothing ever
  draws.
- **Settling a load must not happen during the pass that created the view.**
  `load()` finishes *synchronously* when no integration claims the link, so
  `ngOnInit` defers it by a microtask; otherwise its `detectChanges()` re-enters
  the pass that is still constructing the pane.
- **Suppression needs both halves** — `linkTooltip.hideTooltipsWithPane` *and* a
  pane open — which is what makes the switch safe to leave on: closing the last
  pane brings hover cards back without anyone having to remember to turn it off.
  It is asked in `onHover`, so a suppressed hover costs no timer, no `convert`
  and no rule resolution.
- **The pane takes the card's answers rather than resolving again.** The card
  already knows which buttons this link earned, which integration answered and
  what a `text` match resolved to; asking a second time can get a different
  answer, because a `text` match has no link until an integration says so.
- **A pane has no recovery token**, so it is not restored with the window. That
  is upstream's own path for a tab that cannot be recovered (`recoverContainer`
  skips a null child) and it leaves that container's ratios one entry long,
  which is an upstream bug affecting any such tab. Not worth a preview pane
  re-running someone's Jira fetch at boot.
- Verified in `tabby-links/test/pane.cdp.js` (40 checks): opened through a real
  hover and a real click on the card's button; the `html` frame in the pane on
  an opaque origin with no `require`, no `process`, the CSP present and the
  network refused; tooltips silenced and restored; and **change-detection
  passes over an idle pane counted — measured 0 over 2.5s** — because the
  `*ngFor` freeze does not fail a test, it hangs one.

### Click chords

What a click does is configurable: two chords, primary and alternative, each a
**modifier × gesture × action**, plus which kinds of link a click reaches at all
(`detected`, `rules`, `osc8`) and a master `linkTooltip.clickable`. A rule may
override either chord's action — `''` inherits, `'none'` suppresses.
`clickChords.ts` is the whole decision, kept pure so `logic.test.js` measures it.

- **`clickableLinks.modifier` is upstream's and is migrated, not dropped.** It
  may be in a real `config.yaml` — the Windows Terminal fork could retire its
  equivalent without a migration only because that one was in nobody's settings
  file. `LinkClicksService.migrateLegacyModifier()` moves the modifier onto the
  primary chord, silences the alternative (which defaults to Ctrl+click and would
  otherwise re-enable the very click the user turned off), and **clears the key as
  it reads it** — which is what makes it idempotent without a `config.version`
  bump. A fork-owned bump would make upstream's own migrations skip these configs
  at the next sync. It runs from `config.ready$` in the module constructor,
  because the decorator and the settings page only exist once you open a terminal
  or that page, and until it runs both settings are live and disagreeing.
- **Modifiers match exactly**, so a Ctrl chord does not fire mid-Ctrl+Shift-drag.
  The cost is that alt+click and shift+click no longer follow a link, which
  `!modifier` used to allow — both are selection gestures, and this is what
  Windows Terminal does.
- **Left resolves on release; middle and double resolve on the press.** A press is
  also the start of a selection drag, so a left chord has to wait and then refuse
  if a selection was made. The other two have something to beat on the same
  event: the terminal pastes on a middle *mousedown* (`baseTerminalTab`, via the
  frontend host, an ancestor of `.xterm-screen`), and a double press selects a
  word — waiting would mean the drag guard finding that selection and refusing.
  So `onPress` listens on `.xterm-screen` itself and `stopPropagation()`s, but
  **only once it knows an action will actually run**; a chord resolving to `none`
  leaves the press for whoever else wanted it.
- **A mousedown resets xterm's selection model**, which is what makes
  `hasSelection()` at mouseup mean "this press selected something" rather than
  "something is selected". The cell-distance check beside it is the second
  opinion.
- **xterm calls `activate` on *any* button's mouseup**, with no button check
  (`Linkifier._handleMouseUp`), so a middle release would fire a second time
  after the press already did. `activate` therefore handles left gestures only.
- **OSC 8 clicks are taken over, not forwarded.** `tabby-linkifier`'s own
  `linkHandler.activate` decides for itself from `clickableLinks.modifier`;
  leaving it in the wrapper would mean an OSC 8 link ignoring both the chords and
  the `osc8` filter, and opening twice whenever they agreed.
- **A press uses xterm's `currentLink` to decide there is a link under the
  pointer**, not our own `state.hovered` — that outlives the hover by the hide
  delay, so a middle click a moment after leaving a link would run against the
  link just left.
- **`state.settings` is dropped on every new hover.** It is the answer for the
  link just left, and a click on a second link on the same row beats the show
  delay easily — the click would otherwise inherit the neighbour's rule.
- `terminal.rightClick: 'menu'` (the Windows default) already treats ctrl+left as
  a right click, so the default alternative chord pops a context menu as well as
  following the link. Unchanged from before — `clickableLinks.modifier: null` had
  exactly the same overlap — but it is the reason `clicks.cdp.js` turns that
  setting off for its run.

### Fixed in the second pass

Each of these was shipped and wrong; they are listed because the shape recurs.

- **`fileTypeGroup` and `extensions` never matched.** `decorator.ts` passed `''`
  as the resolved path, and `linkRules.service.ts` requires a real one — so two
  controls in the rule editor did nothing at all. The rules are now asked twice:
  once for the show delay, then again once the path is known.
- **`lookupPath` tested for a colon before a leading slash**, so `/links/self:href`
  parsed as a step named `/links/self` and the field silently vanished.
- **`colorPath` vs `color` precedence was inverted** relative to the other fork,
  which breaks the one thing the format promises. The path wins; the literal is
  the fallback.
- **`cacheSeconds: 0` meant "cache for a second"**, not "never cache".
- **`fields: []` could not be expressed** — unticking the last display field
  sprang back to the manifest defaults, because empty and absent were the same
  value. `Integration.fields` is now `string[] | null`.
- **A `command` step merged stderr into stdout**, so any command that warns
  before succeeding failed to parse, reporting "produced no usable output" about
  output that was fine. Now separate, and any credential appearing in stderr is
  redacted — a failing command usually echoes the command line it was given.
- **An unconfigured integration lost Open / Copy link**: resolving `CAB-8209` to
  a URL needs only the matcher, not a credential. Only *previewing* needs one.
- The **punycode/IDN annotation was missing entirely** — a homograph warning the
  reference has and this port had silently dropped.

### Rule presets

Adding a Link Tooltip rule no longer starts with writing a regex: the "Add rule"
button is a split button whose caret offers eleven ready-made rules, and an
"Apply preset" dropdown inside the editor rewrites the open one.
`tabby-links/src/presets.ts` holds them.

- **A preset does not own its pattern.** Anything an integration already matches
  takes the pattern *from that manifest*, selected by running the manifest's own
  matchers against a canonical example the preset names. A hardcoded twin of the
  Jira key regex would be a second copy that drifts, and these manifests are
  held key by key to the Windows Terminal fork's, so they do move — Slack's
  capture groups were renamed there and no preset had to notice. The
  join fails safe: no matcher claims the example, or more than one does, and the
  preset is simply not offered. Only commit hashes, media files and source files
  — which no manifest describes — carry a pattern written here.
- Consequence: presets are **per matcher**, not per subject. The reference merges
  `pull|issues` into one preset and both stith forms into another; here they are
  five separate presets, because that is how the manifests are written.
- **Every preset must pass `regexGuard.checkPattern`** — one that the guard then
  refuses is a rule that silently never fires. `logic.test.js` times all of them
  through the guard and against adversarial input at 512 and 4096 characters
  (measured: worst 0.06 ms to check, 0.05 ms to match).
- `\b[0-9a-f]{7,40}\b`, the reference's commit-hash pattern, is carried here as
  `\b(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b`. Without the letter it demands, every
  seven-digit number in the output is a commit — PIDs, ports, epoch seconds — and
  a rule that decorates everything gets turned off.
- Applying a preset resets the delay/width overrides and the button suppression
  but **keeps custom actions**: they are the one part of a rule that is
  unambiguously the user's own work.

### The preset menus are grouped, and the cursor starts in the search

Both preset menus (the Add rule caret and Apply preset) list presets under the
integration or family they belong to (`presetGroups()` in `presets.ts`),
focus their search when they open, and clear it when they close.

- **`name` keeps its prefix.** It is what a rule made from a preset is called,
  and how `presetForRule` recognises that rule later, so the menu shows a
  separate `label` under the group's header instead of renaming anything.
- **Focus waits one task.** ngbDropdown emits `openChange` before it focuses
  its own toggle and before `.show` is on the menu, and nothing inside a
  `display: none` menu can take focus.
- **ngbDropdown only navigates from its toggle or an item**, so ArrowDown in
  the search box did nothing until the component moved focus itself.
- **A view built by `window.ng.applyChanges` from a CDP script listens outside
  the zone.** A rule editor built that way let the menu fall behind typing;
  built inside `NgZone.run` it kept up. `presets.cdp.js` builds it in the zone,
  and says why.

### The card says which rule made it, and the buttons pick a real edge

`EffectiveTooltipSettings.rule` has carried the answer since rules existed and
the card threw it away, so "why is this link not previewed the way I set it up"
had no answer anywhere in the UI. Behind `linkTooltip.showRuleAttribution`
(off), the card carries a line on its far edge, and clicking it opens that rule.

- **Three states, not two.** `null` → *No rule matched*, which is the useful
  half. A stored rule → *Matched by X*, openable. An integration's own
  `detectPatterns` → *Detected by the X integration*, with nothing to open:
  those are real rules in the matching pool but live in no array, so calling one
  "no rule matched" would be untrue and linking it would link index `-1`. They
  are tracked in a `WeakSet` as `textRules()` mints them rather than recognised
  by their shape, since a user rule can carry the same name and integration.
- **Identity is exact, not a guess.** `hydrateRule` completes a stored rule *in
  place* — "because the settings page edits these same objects" — and `rules()`
  memoises that array, so the object the matcher returned *is* the object the
  page edits and `indexOf` is exact. The name rides along as a check, because
  the settings can be edited while a card is up: opening resolves
  index-then-name, and failing both lands on the rules list rather than on
  whatever has since moved into that slot.
- **`linkTooltip.actionsPlacement` names the edge relative to the *link*.** The
  card flips above the hovered line when there is no room below, so "bottom" was
  the near edge half the time and the far edge the rest, decided by where in the
  pane you happened to be pointing. `position()` now reports which way it went
  and `place()` resolves near/far afterwards — safe in that order for one
  reason: it is CSS `order` over the same children, so it cannot change the
  height the flip was computed from. Asserted: the card is exactly as tall
  either way. All three call sites go through `place()`, so the second half
  cannot be forgotten at one of them.
- **`showButtons` no longer eats custom actions.** It gated `rule.actions` too,
  so a switch labelled "show buttons on the link tooltip" silently deleted
  buttons the user had written — the same destructive click `applyPreset`
  deliberately refuses, from further away. `linkTooltip.showCustomActions` (on)
  is its own switch, and both descriptions now say they apply to the pane too.

### A rule shows what it finds

`ruleProbe.ts` runs the open rule against a line of sample text and highlights
what it finds, lists the named captures an integration would read back, and says
when the pattern will not compile.

- **Fidelity is the whole of it**, so it reproduces the live decision rather
  than approximating it: the same `GuardedRegex` (whose constructor runs
  `checkPattern`, so the ReDoS guard is not opt-in), the same flags and match
  caps as `LinkRulesService`, the same `MAX_TEXT_INPUT` truncation, and **the
  same criteria beyond the pattern** — a `link` rule also ANDs `schemes` and the
  file-type group, so the box reports *which* one refused. A preview showing
  only the pattern would claim matches the terminal refuses, which is the exact
  failure it exists to prevent.
- **Its own regex, never the service's.** That one memoises into a shared cache
  and is wired to disable the rule and raise a notification on a slow pattern;
  driven from a box someone is typing in, that would kill their rule for the
  session and toast on every keystroke.
- **The whitespace hazard does not arise here, and guarding against it made
  things worse.** `pretty: true` means pug inserts whitespace between two
  *literal* siblings — the reference fork hit exactly that with three
  side-by-side text blocks — but these segments come from one `*ngFor` over one
  element and Angular inserts nothing between instances. Measured: `textContent`
  is the sample character for character. A flex container added as belt and
  braces renders identically (every segment on one line) but makes flex items
  block-level, so `innerText` — the model a selection and a copy go through —
  gained a line break between every segment. Dropped.
- **Preset identity is name first, pattern as the fallback.** Three presets take
  their pattern from a manifest and those manifests move, so a rule added before
  a preset's pattern changed is still that preset to the person reading the
  list; the pattern fallback still recognises a renamed rule. Both menus grey
  out a preset already present — the editor's own still offers the one the open
  rule *is*, because there it means "re-sync me". `addAsRule()` on the
  Integrations page had **no check at all** and reported success twice.

### The Link Tooltip page is grouped

Four collapsible groups over what was a 519-line flat scroll, remembering what
was open. ng-bootstrap's directive accordion was already imported and Bootstrap
5's `.accordion` already themed, so this needed no new dependency or styling.

- **A setting only goes under a switch that governs it.** `allowHtml` sits with
  the card settings and belongs with none of them: it governs the preview
  *pane*, which outlives the card. Under the card's master it would be greyed
  out while still applying — the one thing an accordion must not do — so it has
  a group of its own. `detectLinks` and `safeSchemes` stay ungrouped for the
  same reason in reverse: nothing on the page governs them.
- **Never set `disabled` on an accordion item.** It disables the item's own
  header, and every master switch lives *inside* the group it governs, so a
  disabled group can never be opened to switch it back on. The old
  `*ngIf='…clickable'` wrapper is gone with it — a group-level `*ngIf` would
  leave an expandable that opens onto nothing — and is per-row `[disabled]` now.
- State is view state: `localStorage.linkTooltipGroupCollapsed`, in the shape
  `profileGroupCollapsed` already uses. An **absent** id falls back to *that
  group's* intended default rather than to "open".
- **A collapsed group has to be opened before anything in it can be measured**,
  and how it fails depends on `destroyOnHide`. `clicks.cdp.js` read `.chord-row`
  straight out of the document and found nothing, which is the loud failure.
  This page sets `[destroyOnHide]='false'`, so the *quiet* one applies here
  instead: every control stays in the DOM under a `display: none` collapse and
  measures **0 in every dimension**. A check like "all three checkboxes start at
  the same x" is trivially true of three zeroes, so a probe must assert the
  element has layout before believing an alignment. Cost a green run that proved
  nothing. Tabby has no settings search, so the reference's concern about a
  search index reaching into a collapsed expander has no analogue here.
- **The click-kind checkboxes need two boxes, not one.** `.click-kinds` is
  right-aligned like every other control on the page and the checks wrap to one
  per line, so `justify-content: flex-end` aligned each *line* on its own — and
  since the labels differ in length, the checkboxes landed on a ragged left edge
  (measured 847 / 861 / 820, a 41px spread). The outer box right-aligns; an
  inner `.click-kinds-list` shrinks to the widest line and left-aligns inside
  it, which is what gives the boxes a common edge. CSS has no way to align items
  *across* wrapped lines without that wrapper.

### WSL paths: the translation was right and unreachable

The `\\wsl.localhost\<distro>\…` translation was correct in isolation and never
ran, so a path printed by anything inside WSL had no Copy path, no Show in
folder, and a click that did nothing at all.

- **The order was backwards.** `decorator.ts` gated the whole thing on
  `handler.verify()`, which is `fs.access` on the string as written
  (`tabby-linkifier/src/handlers.ts:61`, and it ignores the tab it is handed).
  For `/home/you/notes.md` that asks Windows about `C:\home\you\notes.md`, which
  is false, so `resolve()` bailed before it could translate anything. Existence
  is now asked once, of the path that would actually be opened.
- **`verify` is not consulted at all any more**, rather than being fixed — it is
  upstream code, and every line changed there is rebase surface. Nothing is lost:
  it *is* the existence check, and it was being run on the wrong string.
- **What replaces it as the "is this a path" test is rootedness**, not existence.
  A text rule matches things like an issue key, and `fs.access('CAB-8209')` is
  answered against the app's own working directory, where it could plausibly
  exist. Anything not rooted is not asked about — which also drops the
  `fs.access` that every hovered `http` URL used to cost.
- **An OSC 8 `file://` link arrives with no handler**, so `isFileLike` was
  false and the `file://` branch of `resolve()` was dead code. That is the form
  Claude Code emits, and the one that carries a fragment.
- **`#L6-L7` is a fragment, not part of the name** (RFC 3986 §3.5), and it was
  carried into both the existence check and the share path. Stripped *before*
  percent-decoding, so a `#` genuinely in a filename — which has to arrive as
  `%23` — survives. Reference commit `c15aae37a`; GH#14116 has asked upstream
  for it since 2022.
- **The reference's UTF-8 escape handling has no analogue here.**
  `PathCreateFromUrlW` unescapes `%XX` a byte at a time and widens each byte
  alone, so `caf%C3%A9.md` arrives mojibaked; `decodeURIComponent` is already
  correct. It throws on a stray `%`, though, and that throw was reaching an
  unawaited `show()`.
- **`file://<authority>/…` is a UNC path**, which is how an editor writes a WSL
  link that already names its own distro. `/mnt/<letter>/` becomes the drive,
  since the share would answer for a file sitting on the local disk.
- **Clicking takes the new route only when translation changed the path.** A
  Windows path and an `http` link still go through the handler exactly as they
  did; asserted both ways in `tabby-links/test/wslPath.cdp.js`.
- Still wrong, and left alone: `~/notes` in a WSL tab is untildified to the
  *Windows* home by `BaseFileHandler.convert`, so it resolves to the wrong file
  if that path happens to exist. Fixing it needs the distro's home, which costs
  a `wsl.exe` spawn on a hover.

## Bringing back what a pane was running (`tabby-resume`)

Upstream restores the furniture: the tabs, the splits, the profiles, and — via
`xtermFrontend`'s serialized scrollback — a picture of what was on screen. Every
pane still comes back as a fresh shell, so the agent you had a two-hour
conversation with, the multiplexer holding six sessions and the dev server are
all simply not running any more. `tabby-resume` is a builtin that asks each pane
what it is running, persists the answer with the layout, and types it back into
the restored pane.

Ported from the Windows Terminal fork (`session-resume`, `a01b20b26`…`b44bdcbd8`);
`recognize.ts`'s agent table is kept row-for-row with that fork's
`PaneSessionCapture.h`.

It rests on one new **generic** extension point in `tabby-core`, an add-only
file: `TabRecoveryAugmentor` — `augment(tab, token, options)` on the way to
storage and `restore(token, params)` on the way back. Orthogonal to
`TabRecoveryProvider`, which owns tab *types* and rebuilds them; an augmentor
runs for every token whatever its type, so a plugin can persist something about
a tab without owning that tab or editing the provider that does. `tabby-local`'s
recovery provider is untouched, so a resumed pane still comes back on its own
profile, in its own directory, inside its own split.

### Identifying a WSL pane: `TABBY_SESSION`

None of a WSL pane's processes are Windows processes, so nothing Tabby knows
about a pane — least of all its conpty pid — can be matched against them. Windows
Terminal has `WT_SESSION` for exactly this; Tabby had no equivalent, so
`tabby-local/src/session.ts` now mints one per pane and, on Windows, appends it
to `WSLENV`, which is the only thing that carries a variable into a distro.
Every descendant of the pane's shell inherits it, and that is the whole join.

One `wsl.exe` probe per **distro**, never per pane, greps every `/proc/*/environ`
at once — the obvious loop reads each and forks four helpers per process, which
on this machine's 1531-process distro measured 3.5s against ~250ms for the grep.
Two filters carry the rest of the weight, because a daemon started from a pane
inherits that pane's identity and keeps it for ever: a controlling terminal is
required (which drops detached daemons), and anything carrying `TMUX`, `STY`,
`ZELLIJ` or `HERDR_ENV` is skipped (which drops everything a multiplexer owns).

- **`tpgid` describes the terminal, not the process.** Every process sharing a
  controlling terminal reports the same value, so "the topmost process's tpgid"
  is not that process's opinion about its children — it is which group the
  terminal is currently listening to. The port read it the first way and
  reported *nothing at all* for a pane with anything between it and its shell.
  The rule is now "am I the group the terminal is listening to":
  `pid === pgrp === tpgid`, with a parent inside the pane. A pane at its prompt
  has only its shell, which is a root, so nothing qualifies; a pipeline
  qualifies at its leader; an agent qualifies rather than its MCP children,
  which are in its group and are not its leader; and a nested pty qualifies
  twice, which is why depth breaks the tie.
- A profile with no `-d` is probed with no `-d` too, so it lands in the same
  default distro that pane opened. The port treated that as "not a WSL pane".

A **native** pane has no foreground process group to ask, so depth stands in for
it: the *shallowest* non-shell descendant of the pane's own shell. Not the
deepest, which is wrong for exactly the case this exists for — an agent spawns a
child per MCP server. `session.getShellPID()` is the PTY's own process,
deliberately not `getTruePID()`, which walks down single-child chains and would
hand back the program.

### Typed into the pane, never launched as it

Putting the command in the profile's command line would make it the pane's root
process, so the pane would close the moment the program exited. It is sent as
input instead, after `resume.inputDelayMs`, and the Enter goes as its own write
— many TUIs read one write containing text and newline as a bulk paste and never
submit it.

- **A restored pane does not start its shell until it is first rendered.**
  `TerminalTabComponent` calls `initializeSession()` from `onFrontendReady`, and
  only the tab that ends up selected is rendered at startup — so restoring five
  panes gives you one session and four tabs that are, for now, just titles. The
  first version gave up after ten seconds and every restored pane but the active
  one silently lost its resume (measured: two panes, `hasSession: false` on
  both, hours later). The wait now has no deadline and ends when the tab does.
- **`savedStateIsLive` is not "the PTY was adopted", though it reads exactly
  like it.** `terminalTab.component.ts` computes it in `onFrontendReady`, before
  the session it compares against has a PTY, so `getID()` is still null and a
  *fresh* pane comes out `null === null` — true. Measured live on every ordinary
  pane. Asking the same question a second later, when the PTY exists, is exact,
  and that is what guards against typing a resume at a pane that adopted a
  still-running PTY.
- **"Open in new window" is excluded by identity, not by heuristic.** That flow
  reuses the running PTY, so the pane's agent never stopped; the augmentor
  collects the leaf tokens of `bootstrapData.initialTab` at construction and
  declines them. Every other route through `recoverTab` — the persisted layout,
  reopening a closed tab — ends in a fresh shell, which is what this is for.
- **A pane that reopens an agent conversation does not repaint its scrollback**:
  the agent redraws its own history and both would show the same transcript
  twice. Decided by re-reading the command (`resumesAgentSession`) rather than by
  a flag stored beside it — a command and a flag describing it can disagree
  after a hand-edited config, and the flag is the half nothing would notice.
- **A restored pane is found by sweeping, not by an event.** A pane inside a
  restored split is created by `SplitTabComponent` straight into its own view
  and announced to nobody, so the only reliable signal it exists is that it is
  in the tab tree carrying the input the augmentor put on it. The sweep also has
  to stop when its count is *not* met: `recoverTab` produces tab parameters and
  nothing guarantees each becomes a tab, and one that does not held the whole
  batch to the deadline — measured, a resume typed 20s after the window opened.

### What it costs

Nothing on the save path, by construction. The capture runs on a timer that the
save pass merely *kicks*; the save reads a cache. Measured live: `augment`
0.002–0.010 ms per tab, `saveTabs` under 0.01 ms for one tab, worst event-loop
gap during a full capture 11 ms — against the 250 ms the diagnostics call a
stall.

There is **no shutdown cost at all**, and that is upstream's doing rather than
ours: `AppService.closeWindow` sets `tabRecovery.enabled = false` *before* its
own final `saveTabs`, which then returns immediately. So the last save before a
quit does nothing, there is no flush-before-quit seam to hang a probe on, and a
recorded command is at most one `refreshIntervalSec` stale — the same guarantee
Tabby already gives the scrollback saved beside it.

- **A restored pane carries its command forward.** Without that the feature
  quietly undoes itself: capture runs on a timer, so the first save after a
  restore would write the layout back with no command and the next restart would
  give you a bare shell.
- The Claude registry watch is held only while a pane is *actually* running
  claude, not merely while agent resume is switched on — which is the default,
  and would otherwise have every user polling stith for a join nobody asked for.

### Two things that only a running window found

- **Injecting the service into the augmentor deadlocks the app.** `AppService`
  builds `TabRecoveryService`, which asks for every augmentor, whose service asks
  for `AppService`: `NG0200: Circular dependency in DI detected for AppService`,
  bootstrap fails, safe mode fails identically, and the window sits on the splash
  screen for ever. The augmentor resolves it from an `Injector` on first use
  instead — by which time everything exists.
- **Claude resume is `tabby-claude`'s, extended, not reimplemented.**
  `ClaudeActionsService.resumeCommand` already knows the one hard part — the
  *launch* directory a `--resume` has to run from, recovered from a drifted cwd.
  It now takes the flags the pane was running with, a quoting function, and which
  shell it is being typed into: `cd /d` is cmd's alone, and Windows PowerShell
  5.1 has no `&&` at all — it is a parse error there, not a fallback.

### Tests

- `test/logic.test.js` — 96 checks, no app: the agent table, the multiplexer
  attach forms, quoting per shell, `CommandLineToArgvW` splitting, the selection
  rules against synthetic trees and probe records.
- `test/wslProbe.test.js` — 14 checks against the **real Ubuntu distro**. Starts
  its own panes (a pty via `script`, carrying `TABBY_SESSION` over `WSLENV`),
  proves a pane is identified, a detached daemon that inherited the same token is
  not, a real `tmux` is attached to rather than relaunched and what it runs is
  never reported, and that in a real pane the shell is the root of the set.
  Cleans up by pid; never touches the distro itself.
- `test/native.electron.js` — a real Windows process tree under
  `ELECTRON_RUN_AS_NODE`, asserting the first child wins and showing the deepest
  descendant really is a different answer on that shape.
- `test/resume.cdp.js` — 27 checks in a live window: the pane's environment, the
  capture reaching the token, the exclusion list beating the switches, scrollback
  suppression, the pane surviving the program it was given, and the timings above.
- `test/restart.cdp.js` — the whole claim, end to end: launches the dev build,
  starts a program in a pane, kills the window, relaunches **on the same
  profile**, and finds the program running again. It needs
  `scripts/dev/launch-hidden.mjs --keep-profile`, added for it, since every other
  launch begins by deleting the profile it is about to use. Chromium is asked to
  flush storage before the kill: it commits localStorage on its own schedule, and
  without that the second run comes up with no saved layout at all.

## Builds page (`tabby-builds`)

Settings → **Builds** lists every Tabby build on this machine: the installed
app, the webpack output this fork runs from, electron-builder output inside a
checkout, and installer files. Live process counts, memory and uptime; size on
disk, build time, arch, branch and provenance. Two tabs — the list (kind filter
+ cards/table switch) and Options.

The bits that cost real time:

- **Processes are attributed by executable path**, from one PowerShell call per
  poll (`Get-Process -Name Torbie,Tabby,electron` → `.Path`). `tasklist` cannot
  report a path, and two builds sharing an executable name are otherwise
  indistinguishable. Tabby is named alongside us because this page inventories
  every build on the machine, and an installed Tabby is one.
  Linux reads `/proc` directly rather than spawning `ps`; the poll pauses while
  the window is unfocused, because it costs a subprocess.
- **Discovery is one walk of the search roots that classifies each directory**
  — checkout, application directory, or neither — and stops descending as soon
  as it knows, because a build holds three thousand files nobody needs to list.
  A **standalone application directory** (binary + `resources`) counts wherever
  it is: the frozen build slots under `~\Torbie\builds\` live outside any
  checkout, so nothing else would ever find them. A `data` directory beside the
  binary means portable, which is what lets a slot run alongside the installed
  app. `~\Torbie` is therefore a default search root, and `~\Tabby` stays one
  so slots cut before the rename remain visible.
- **The walk asks the directory once and answers from the listing.** It used to
  `stat` a handful of candidate paths per directory to decide what it was
  looking at — `scripts/`, an executable, a `.app` — which is several syscalls
  each, over a tree with thousands of directories. `readdir` already returns all
  of that, so `isSourceTree` now gates on `names.has('scripts')` and the app
  seed on an executable name or `.app` dir being *in the listing*. Breadth-first
  at `CONCURRENCY = 32`, with results batched per index so ordering is stable.
  **Measured on this machine: 805 ms → 27–36 ms** across three consecutive
  scans, which moves the whole cost of opening the page onto `readVersions`
  (~290 ms, reading each executable's version resource).
- **A slot's `BUILD-INFO.txt` wins over its version resource.** Slot binaries
  report `1.0.0`; the sidecar carries the real version, the commit, the branch,
  the originating checkout and the upstream base it was forked from. Taking
  `builtFrom` from the slot and `head` from that checkout is what makes "this
  slot is behind the tree" visible.
- **A Windows junction is not a directory to `lstat`.** `data\plugins` in a slot
  is a junction into `%APPDATA%\tabby\plugins`; Node reports it as a symlink, so
  the size walk skips it and `fs.rm` unlinks it rather than following it —
  verified on a decoy, and confirmed by arithmetic (the slots differ by 52 files,
  not by the plugin directory's 289).
- **Every `fs` call here goes through `original-fs`** (`tabby-builds/src/nodeFs.ts`),
  because Electron's patched `fs` mounts an `.asar` as a directory *and the first
  patched call on one opens the archive and keeps the handle for the life of the
  process*. Sizing a build is such a call — `lstat` on `resources\app.asar` — so
  every packaged build the page listed was pinned by the renderer itself, and
  Delete then died on the archive it had pinned:

  ```
  EBUSY: resource busy or locked, rmdir '…\resources\app.asar'
  ```

  `rmdir` because the patched `lstat` calls the archive a directory; `EBUSY`
  because the handle is ours. Nothing could clear it — not `maxRetries`, not
  `process.noAsar` set afterwards, not `original-fs` at the delete site: measured,
  a *single* `lstat`, `stat`, `access` or `readdir` through the patched `fs` is
  enough, and only a process that never touched the archive can remove it. So the
  fix is upstream of the delete: nothing in this plugin may open an archive at
  all. `tabby-builds/test/asarDelete.cdp.js` asserts both halves — the patched
  `fs` still failing exactly that way on a control fixture, which is also what
  proves the fixture is an archive Electron recognises, and the real services
  sizing and deleting an untouched one.
- **Versions come from the executable's own version resource**, not from
  `resources/builtin-plugins/tabby-core/package.json` — that stamp goes stale
  (the installed 1.0.230 here still carries a 1.0.197 plugin stamp).
- **A source build's version and provenance come from `app/dist/build-info.json`**,
  a sidecar `app/webpack.config.mjs` writes next to the bundle. The DefinePlugin
  constants that feed the tab-bar build hint can only be read from *inside* a
  running instance; this page has to describe builds sitting on disk. A card
  reads `stale` when the checkout's HEAD has moved past what the bundle was
  compiled from.
- **`root` for a source build is `app/dist`, never the checkout.** Delete means
  "delete the build", so it must not be able to mean "delete the repo". It also
  removes the plugin `dist` dirs and `builtin-plugins` (`extraPaths`), which is
  the rest of what `yarn build` produced.
- **Delete on a running build quits it first** — `taskkill /PID /T` (a WM_CLOSE,
  so the app can save state), force only after a grace period, then the
  directory goes. The build the window is running from is never deletable.
- Arch is read out of the PE header, except for installers: an NSIS stub is a
  32-bit executable whatever it installs, so there the file name wins.
- Sizes are walked one build at a time off the render path and cached; symlinks
  are never followed, or `builtin-plugins` would count the same bytes twice.

### Cards are a grid, laid out by container queries

The page opts out of the settings column's 600px cap (`wide`) so the table has
room, which in cards view let each card stretch across the whole pane: at a
2400px pane a card was 2401px wide with its facts packed at the left.

- **Container queries, not media queries.** The page host is
  `container: builds-page / inline-size` and every card `build-card`, because
  the width that matters is the pane's, which the viewport cannot see past the
  settings nav or a docked panel. Cards fill as many columns of at least 460px
  as fit, each capped at 720px (1/2/3/5 columns at 700/1100/1600/2400px). Under
  a 640px page the filter buttons come apart and wrap; under a 284px card each
  fact becomes a label beside its value.
- **A container is a stacking context**, so a tooltip left inside a card paints
  under the card after it. Every tooltip on the page renders into `<body>`.
- **A kind is a chip with an icon, not a colour.** This theme's `primary` and
  `info` are one colour (both `theme.colors[4]`), a `dark` fill vanishes on a
  light scheme, and the remaining fills already mean a status on the same card.
  So kinds are neutral chips carrying `KIND_ICONS`, and filled colours mean
  status only. Status badges get a 1px inset ring in their key's text colour,
  since light "stale" had no other edge (1.71:1).
- **Checking a container from CDP:** `ng.getHostElement(ng.getOwningComponent(el))`
  handed back the wrong element for a node rendered through the page's
  `ngTemplateOutlet`, and reported no container at all. Walk up from the node
  to the nearest `_nghost-*` attribute instead.

### Cutting a slot

There are exactly **two** slots, after the model this machine's Windows Terminal
fork uses for `wtd` / `wtt` — and they are not two equivalent scratch installs:

| Slot | Directory | What it is |
|---|---|---|
| **canary** | `~\Torbie\builds\canary` | Disposable. Every build replaces it. The only slot the script will overwrite on its own. |
| **dev** | `~\Torbie\builds\dev` | Production — the terminal you work in. Changes exactly one way: canary is promoted into it. |

The root moved from `~\Tabby\builds` with the rename. `make-slot.mjs` moves a slot
across on its next run — but only one with nothing waiting for it at the
destination, and **never one that is running**, which is the one thing that
script exists to refuse. `~\Tabby` stays in `builds.searchRoots`, so anything
left behind is still listed, runnable and deletable from the Builds page rather
than becoming invisible.

```bash
node scripts/make-slot.mjs                 # build and install canary
node scripts/make-slot.mjs --promote       # copy canary into dev
node scripts/make-slot.mjs --dry-run --skip-build --seed-from <dir>
```

- **Two fixed names, not `<version>-<MMDD>-<HHmm>-<sha>` directories.** The old
  scheme accumulated one per build until somebody noticed the disk; worse, every
  slot on this machine at the time was stale enough to hang, so what piled up was
  three copies of a trap. Fixed names also retire the whole business of
  retargeting shortcuts — a slot's path never changes now, so a pin made once
  stays correct for ever, and `--activate` is gone with it.
- **Promotion copies the canary that was built and tried, never a fresh
  compile.** Otherwise "promote what I verified" would quietly mean "build
  something new and call it verified". `dev`'s `BUILD-INFO.txt` is canary's,
  with a `Promoted:` line — so dev can never claim a commit that was not in its
  binaries.
- **A slot that is running is never replaced.** The check is on that slot's own
  path, not "any Tabby" — the point of two slots is that the other one keeps
  running while you rebuild this one.
- **Rebuilding a slot keeps its `data\`.** Only application files are replaced,
  which is what makes settings survive a rebuild and is most of why the old
  seeding logic could go. A genuinely new slot seeds from the *other* slot —
  a new canary from dev, a new dev from the canary being promoted — and from
  `%APPDATA%\tabby` only when there is no other slot at all. Printed as `seed:`
  (in `--dry-run` too); `--seed-from <dir>` overrides it.
- **Anything under `~\Tabby\builds\` that is neither is pruned on every run**,
  unless it is running, in which case it is reported and left. That is what
  makes "only ever two" structural rather than a habit.
- `--dir` only — a slot is an unpacked directory, never an installer.
- **`cpSync` carries the read-only bit**, so promoting a *frozen* canary lands
  frozen files in dev and the very next write — `BUILD-INFO.txt` — fails
  `EPERM`. The attributes are cleared after the copy as well as before it;
  `freeze()` puts them back.
- The Builds page now reads every portable build's own `data\config.yaml`, not
  just the running one's, so **Delete says that the settings go with it**.
- The seeded profile drops `hotkeys.toggle-window` and blacklists `mcp-server`,
  because a slot is meant to run *beside* your Tabby: otherwise whichever
  instance starts first takes the global hotkey and the MCP port, and the other
  silently half-works.
- `data\plugins` is a junction to `%APPDATA%\tabby\plugins` so plugins stay
  shared and live. The Builds page knows not to follow it.
- App files are marked read-only, so a slot cannot drift after it is cut —
  **but `data\` must stay writable, and the first version of `freeze()` did not
  leave it that way.** `attrib +R <slot>\* /S /D` froze `data\config.yaml` too
  (`/D` does not exempt anything — it *adds* folders to what attrib touches), and
  a read-only config file makes a slot lose every settings change in silence:
  `app/lib/config.ts` writes through `atomically`, whose rename over a read-only
  file is `EPERM` on Windows, so `ConfigService.save()` throws before
  `emitChange()`. Both halves of that hurt. Nothing persists — and nothing driven
  by `config.changed$` re-applies either, so Spaciness, theme and docking appear
  to do nothing at all while you are still in the window. `freeze()` now skips
  `data` by name and `make-slot.mjs` asserts `data\config.yaml` is writable
  before it reports success.

### The doctor

Each build is health-checked on every scan, and a build that will not start
says why on its own card. Written after an auto-update applied while the old
version was running, deleted nine of the twelve directories under
`resources/builtin-plugins`, and left the app starting to a splash screen
forever — with Windows reporting the process as responding the whole time.

- **`Responding` / `IsHungAppWindow` do not catch a boot that stalled.** The
  window pumps messages perfectly; it just never rendered. Measured on the real
  failure: responding `True`, 6.5 s of CPU across 37 minutes.
- **The main window title is the signal that does.** A booted window is titled
  after the active tab; one still on the splash is called after the app —
  `Torbie`, or `Tabby` for a stock build, which is why `isSplashTitle()` takes
  its list from `productNames.ts` rather than a literal. No cooperation from the
  app required, so it works for stock builds too. Past a 30 s grace period, that
  is *stuck at boot*.
- **The cause is found on disk, not in the process.** `tabby-core`,
  `tabby-settings`, `tabby-terminal`, `tabby-local` and `tabby-electron` are
  the builtins whose absence is fatal — each throws `Cannot find module` out of
  the plugin loader as an unhandled rejection that nothing catches.
- **`fs.access` lies about `app.asar`.** Electron mounts the archive as a
  directory, so `access()` on it answers ENOENT for a file that is plainly
  there while `stat()` calls it a directory. Ask the parent's directory
  listing instead — this produced a false "bundle is missing" on every
  packaged build until it was caught in testing.
- A builtin copied into the *user* plugin directory is reported too: a second
  `tabby-core` on the module path loads a second Angular and breaks DI.
- Verified by reproducing the fault — a copy of a slot with `tabby-local`
  deleted, launched, and confirmed to be reported as `will not start` with both
  the cause and the symptom, while every healthy build stayed clean.

### The active build and the taskbar pin

Exactly one build is **active** — "the terminal you use". It is the build the
Windows taskbar pin launches, it carries an `active` badge, and it is never
deletable, so there is always a working build left on the machine. Together
with "the build this window runs from is never deletable", that is the
guarantee: you must hand the crown to another build before you may delete this
one.

- **Nothing here can create a taskbar pin.** Windows removed the "pin to
  taskbar" shell verb in 1809 and blocks it for automation; `Torbie.exe` only
  offers *Pin to Start*. What a pin *is*, though, is a shortcut in
  `%APPDATA%\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar`, and
  rewriting its target is allowed. So: pin it by hand once, and the page
  keeps that single pin aimed at the active build.
- **What you pin is a Start menu entry, and that part *can* be created.**
  Windows offers *Pin to Start* and *Pin to taskbar* only for things it
  considers Start menu apps: `~\Torbie\Torbie-dev.lnk` was found by Start search
  but its context menu had nothing but Run as administrator and Open file
  location, which is what "I can't pin my fork" turned out to be. Builds →
  Options writes
  `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Torbie.lnk`; pinning it
  is still a right-click, and the pin that results is a copy this page then
  keeps retargeted.
- **One stable shortcut name, never the build's.** Pinning copies the file, so
  a name that changed with the active build would strand every pin made from
  it. `setActive` retargets it — but only when it already exists: putting an
  app in someone's Start menu because they clicked "make active" is not the
  page's call.
- **The rename is exactly the case that warning describes**, so the old name is
  retargeted rather than renamed away. A Start pin is a *copy* of the shortcut
  it was made from and goes on pointing wherever that copy pointed, so
  `taskbar.service.ts` writes `Torbie.lnk` and, whenever `Tabby-fork.lnk` is
  still there, aims that at the active build as well. It never *creates* the
  old name — by the rule directly above.
- **Two slots means two shortcuts, and neither is ever retargeted.**
  `Torbie-canary.lnk` and `Torbie-dev.lnk` (in `~\Torbie\` and in the
  Start menu) point at fixed paths, so `make-slot.mjs` writes them once and a
  pin made from either stays correct across every rebuild.
- **On first run the page adopts whatever the pin already points at**, rather
  than nominating a build and overruling the desktop.
- **A source build can be pinned because of `--dev`.** A `.lnk` cannot carry
  environment variables, and dev mode was previously only expressible as
  `TABBY_DEV=1`, so the shortcut would have started an Electron with no
  plugins. `app/lib/index.ts` now sets `TABBY_DEV` when `--dev` is on the
  command line. `--user-data-dir` covers the rest: `TABBY_CONFIG_DIRECTORY`
  defaults to `app.getPath('userData')`, which follows it. Verified by
  launching with the env explicitly scrubbed.
- The icon is rewritten with the target, and for a source build it comes from
  `build/windows/icon.ico` in the checkout — the target there is `electron.exe`,
  whose icon is Electron's.

### Offering a newer build

`newBuildWatcher.service.ts` offers to switch when a newer build turns up, and
`newBuildChoice.ts` decides what counts, as pure logic. The first version
compared build times and nothing else, so an installed 1.0.0 opened on a dialog
offering `tabby (win-unpacked)`, this checkout's electron-builder output, with
a button that would have deleted the install.

- **An installed build is offered nothing.** It is a release, and the next
  release replaces it; the watcher is for the in-place loop where a slot is cut
  while an older one runs.
- **A switch lands only on a portable or installed build of the same product.**
  Build times cannot say whether an upstream Tabby should replace a Torbie.
  `packaged` is excluded because an unpacked directory with no `data\` shares
  `%APPDATA%\<name>` with the installed app, and the single-instance lock is
  keyed on that directory: launching it while the installed app runs hands the
  launch back to the running process, and the switch then closes this window
  with nothing left open. It is also what `make-slot.mjs` copies into a slot,
  and the slot is the build to switch to.
- **Only a slot that is not the active build may be deleted on the way out.**
  `scan()` leaves `isActive` false for every build, since only the Builds page
  resolves it, so the old `!current.isActive` offered deletion for everything,
  the active build included. The watcher now asks `builds.activeExecutable`,
  and an unset one counts as active. An installed build goes through its
  uninstaller, never a directory removal; a source build is more than its
  `root`.
- **Builds are named after their product, not their folder.** This checkout
  lives in a directory called `tabby`, so its builds read `tabby (source)` and
  `tabby (win-unpacked)`, which is upstream's name. They read `Torbie (…)` now:
  `TabbyBuild.product` comes from the executable, the checkout's
  `app/package.json` or the installer's file name.
- `tabby-builds/test/newBuildChoice.test.js` (fast tier) holds each rule as a
  case, the reported dialog first.

## The jump list wears the profiles' own icons

Right-clicking Tabby in the taskbar or the Start menu offers your profiles.
Upstream already built that list (`tabby-electron/src/services/dockMenu.service.ts`)
but gave **every entry `iconPath: process.execPath`**, so it was a column of
identical Tabby logos that told you nothing about what you were about to open.
`jumpList.service.ts` builds the list and `jumpListIcons.service.ts` draws each
profile's own icon into a file the shell can read; both are add-only, and the
edit to the upstream file is one call.

A profile icon is a Font Awesome class or an inline SVG document, and
`iconPath` takes neither — it wants a file plus an index. So rasterize them:
the same conclusion the Windows Terminal maintainers reached in
microsoft/terminal#10552, and what the reference fork does with
Direct2D/DirectWrite. Here **the renderer already is a text-and-SVG rasterizer**,
so a canvas does it with no native code and no new dependency.

- **The glyph comes out of the stylesheet, not a table of codepoints.** A probe
  element gets the class and `getComputedStyle(el, '::before').content` answers
  with the character; the family and weight come from the same place. That
  covers solid, regular and brands at once, survives a Font Awesome bump, and
  a class that resolves to no icon font is how an unknown one is detected.
- **`.ico` is written by hand** — nothing in this stack encodes one, and a
  canvas produces PNG and nothing else. The container is a directory plus one
  PNG per size (16/24/32/48, i.e. a 16px shell icon at 100–200%), which has
  been legal since Vista.
- **The blank check is the only honest test.** A font that had not loaded, an
  SVG whose paths fall outside its viewBox and a mistyped class all produce a
  perfectly well-formed file full of nothing. The canvas is scanned for a
  non-transparent pixel before anything is written; failing that, the entry
  falls back to the app icon. **An entry is never dropped and never blank.**
- **The webfont has to be waited for.** `font-display: block` means the CSS
  knows the family long before the file arrives, and a canvas silently
  substitutes rather than waiting — so the first rebuild after a cold start
  drew tofu until `document.fonts.load` was added.
- **Resolve once, draw four times.** Reading the class out of the stylesheet is
  a DOM insertion and a forced style recalc, and parsing an SVG is a whole
  document; neither is per-size. Measured on the renderer thread, 28 profiles:
  a cold pass draws 15 distinct icons in ~1.1s (~0.3s once the webfonts are
  warm), a warm pass draws none and costs nothing. The loop awaits I/O between
  icons, so that is not 1.1s of blocked event loop.
- **Icons live in `<config dir>/jumplist-icons`**, keyed on the icon *and* the
  colour, and pruned to what the last pass handed out. Beside `config.yaml`
  because a slot's app files are read-only and `data\` is the only writable
  part of one — and because two builds running side by side must not hand each
  other a file drawn for the other's theme. `original-fs` throughout: a
  portable build's config directory is a sibling of `resources\app.asar`, and
  one patched `fs` call on an archive pins it for the process's life.
- **The cache is re-checked, not trusted.** The shell's copy of the list
  outlives the app, the build and the profile directory, so a cached path is
  `access`ed every pass and redrawn if it has been swept — which is what
  happens when a slot is deleted.
- **The colour is `SystemUsesLightTheme`, not `AppsUseLightTheme`** and not
  Tabby's own scheme, which the user may have forced the other way. The jump
  list is taskbar chrome. A monochrome glyph baked in the wrong colour is
  invisible against the flyout, which looks exactly like the blank tile this
  set out to fix. A profile's own `color` wins when it has one.
- **An empty custom category makes the shell reject the whole call**, not just
  that category — so on a profile where nothing had been opened yet, upstream's
  list was refused entire and *no* profiles appeared. Empty categories are now
  dropped, and the result string is logged instead of discarded.
- **`profile "<name>"` was interpolated, not quoted.** Profile names are free
  text; one containing a quote produced an entry that opened the wrong profile
  or none. `quoteArgument()` applies the CRT's rules (double the backslashes
  before a quote, escape the quote). Two profiles sharing a name now produce
  one entry, since `profile <name>` resolves by name and the second was
  unreachable however it was listed.
- **Staleness is already handled by `config.changed$`.** `DockMenuService`
  subscribes to it, and `tabby-builds`' "make this the active build" ends in
  `config.save()` — so activating a slot rebuilds the list, which is the
  analogue of the reference fork's refresh-on-deploy. Asserted in the test
  rather than assumed.
- Entries launch `process.execPath` — *this* build, deliberately, not the
  active one. They are built from this instance's profiles, and only this
  build's config directory knows what those names mean.

### What writes whose jump list

A jump list is shell state keyed on the app's AppUserModelID, so this is the
one thing here that is visible to the whole desktop. Measured on this machine
by reading `%APPDATA%\Microsoft\Windows\Recent\CustomDestinations` — the files
are shell links, so the paths inside are greppable as UTF-16:

- **The dev build keeps its own file.** Its entries name
  `…\projects\tabby\node_modules\electron\dist\electron.exe`; a packaged
  build's name a `Torbie.exe` or a `Tabby.exe`. So running a dev instance does
  not overwrite a packaged build's list — but that is asserted, not relied on:
  `app/test/jumpList.test.js` hashes every jump list file naming either
  packaged executable before the run and refuses to pass unless they are
  byte-identical after.
- **The rename moved the AppUserModelID**, `org.tabby` → `com.aylith.torbie`,
  and that is the key a jump list is filed under — so a packaged Torbie writes
  a *different* file from a packaged Tabby rather than fighting it for one.
  The measurement below predates that and describes the old identity:
- **Only one packaged Tabby had a file**, with entries pointing at
  `~\Tabby\builds\dev\Tabby.exe` — the slot, not the installed app. Either the
  two shared an identity and the slot wrote last, or the installed app's write
  never landed. Never resolved, and now moot for our own builds; still worth
  knowing before trusting a jump list to belong to the build you think it does.
- **The test publishes exactly once**, and only after giving the instance a
  scratch AppUserModelID of its own, deleting the file that leaves behind.
  Every other check runs against `JumpListService.build()`, which produces the
  categories and the icon files and publishes nothing.
- Dev entries are dead either way: `electron.exe profile "X"` has no app path,
  so it starts nothing. Left alone — it is upstream's shape, and it now lands
  on an identity nothing else uses.

**`b8bc5aa7e` from the reference fork does not apply here** and was skipped
deliberately: it keeps a local copy of profile icons given as http(s) URLs so
settings load does not block on the network. Tabby has no URL profile icons —
`profileIcon.component` renders a Font Awesome class or an inline HTML string
and nothing else, and the settings field is a typeahead over class names.
There is nothing to cache. (Such a string reaches the rasterizer as neither a
glyph nor markup, so it falls back to the app icon rather than misbehaving.)

## A build must load its own plugins

**A Tabby exports `NODE_PATH` to every shell it starts** — its own
`builtin-plugins`, its `app.asar\node_modules`, and `%APPDATA%\tabby\plugins\node_modules`
— and `initModuleLookup()` used to *append* its own paths to whatever it
inherited. So a Tabby started from a terminal inside another Tabby resolved
`tabby-core` to the **other build's** copy: two Angulars, and a boot that stops
dead on the splash screen. This is the dev-build gotcha in *Launching* above,
except it bites a packaged slot exactly as hard, and there it is invisible —
there is no console to see it in.

- **The symptom is an idle process, not a busy one.** Measured on the real
  failure: the renderer sat at 94 MB and 0% CPU for five hours, window titled
  `Tabby`, nothing in the app log after `renderer-start`. `diagnostics.log` had
  the answer in one line — `require-failed`, `tabby-local`, MODULE_NOT_FOUND —
  and a sampled 203 ms `readFileSync` of
  `%APPDATA%\tabby\plugins\node_modules\tabby-core\dist\index.js`, which is a
  path no healthy build should ever read.
- **A stale copy of a builtin in the user plugin directory does the same.**
  Three of them were there, at 1.0.197, pulled in by `tabby-backslash-newline`
  listing `tabby-core`/`tabby-settings`/`tabby-terminal` under `dependencies`
  rather than `peerDependencies`. `findPlugins()` already skips such copies for
  *discovery*; nothing stopped `require` finding them first.
- **The fix is ordering plus absolute paths**: this build's paths go ahead of
  anything inherited, and the four builtins are required from
  `builtinPluginsPath` by absolute path rather than by name. (`+=` on an unset
  `NODE_PATH` also left a literal `"undefined"` entry, for years.)
- **Relaunching does not clear it.** The single-instance lock hands the launch
  to the poisoned process, which opens another window that never boots either —
  which is what "it's still hanging" turned out to mean. That instance has to
  be closed first.
- `app/test/moduleLookup.test.js` resolves the four builtins under each
  poisoned environment and asserts they all come from the build itself. Like
  the asar test, it also asserts the *old* ordering still fails — otherwise a
  green run on a clean machine would prove nothing.

## A useless process must not hold the lock (`app/lib/watchdog.ts`)

The fix above stops one *cause*. The trap it produced was the single-instance
lock: exactly one process answers for the app, so once that process cannot show
a window, every later launch is handed to it and silently swallowed — no
window, no error, no crash, indefinitely. Six hours of it, measured. Nothing
anywhere checked that the lock holder had ever produced a **working** window.

**`app:ready` is the only line that matters.** It is sent from
`appRoot.ngOnInit` once `config.ready$` resolves, so it means an Angular root
exists in that renderer — and everything that can open a tab or spawn a PTY
lives at or after that point. A process in which *no* window has ever emitted
it has never run a session and holds nothing to lose. The first one disarms the
watchdog permanently, for the life of the process. That single rule is what
makes code that can call `app.exit()` safe to ship.

Two failure shapes here, and they need different tests. A third — a process
sitting inside a blocking error box — is what made both of these unreachable,
and it is closed in `app/lib/fatal.ts` below.

- **No window at all** — a creation that threw, or a handoff that produced
  nothing. `activate`, the `app:new-window` IPC and `handleSecondInstance` all
  call `newWindow()` with no catch, so the failure vanishes and the process
  carries on with nothing to show. Ported from the reference fork's
  `_armNoWindowWatchdog` (`c353d92a1` in the Windows Terminal fork): five
  seconds, and it returns early whenever a window exists.
- **A window that never booted** — the one that actually bit, and the half a
  zero-window check cannot see. `newWindow()` pushes the window onto its list
  *before* awaiting `window.ready`, so the window exists, the renderer is alive,
  and from outside nothing looks wrong. Armed once at `app-ready`; sixty
  seconds; fires only on "no window has ever reached `app:ready`".

- **The boot budget is spent in ticks of a live event loop, not wall clock.** A
  main process blocked for 19.7s during `main-start` is measured here on every
  cold launch — it has not given the renderer that time, and burning the budget
  on it would quit a build that was only slow. Measured margin: a healthy dev
  build reaches `app:ready` **1.3–3.8s** after the watchdog arms.
- **`app.exit()`, never `app.quit()`.** `Window`'s own `close` handler calls
  `preventDefault()` and asks the renderer to confirm; a renderer that never
  booted never answers, so quitting politely would hang in exactly the place we
  are escaping.
- **It writes to both logs before exiting.** `diagnostics.log` batches behind a
  one-second timer and `app.exit()` runs no timers, so `flushDiagnostics()`
  writes synchronously — otherwise the one record explaining the exit is the one
  record guaranteed to be lost. The reason also goes to
  `main-process-errors.log`, which is where someone asking "why did Tabby quit
  on me?" actually looks.
- A `window-ready` record is now written on every successful boot, with how long
  it took. The boot phase marks are breadcrumbs, which are invisible unless
  something stalls — so this was previously unanswerable from outside.
- `TABBY_WATCHDOG=0` disables it; `TABBY_WATCHDOG_BOOT_MS` and
  `TABBY_WATCHDOG_NO_WINDOW_MS` retune it without a rebuild.

`app/test/watchdog.test.js` launches three real dev builds against throwaway
profiles. **The poisoned `NODE_PATH` no longer reproduces the fault** — the fix
above works, and a dev build launched with the installed app's plugin
directories on `NODE_PATH` now boots in under two seconds. The lever is
blacklisting `core` instead: the same fault class the doctor covers (a builtin
the app cannot start without is unavailable), landing in the same state —
bootstrap fails, safe mode fails behind it, the renderer sits on the splash
screen at 0% CPU and the window is still there. Like the module-lookup test it
also runs the fault with `TABBY_WATCHDOG=0` and asserts it *still* hangs,
because otherwise a fixture that quietly stopped reproducing would turn the
whole run green.

**The zero-window half is now covered end to end** by
`app/test/startupFailure.test.js` — a real window-construction throw, quit by
`armNoWindowWatchdog` 4s later, with the reason in the log. It could not be
reached before because the modal below caught the throw first and stopped the
loop the timer lives on. What is still beyond all of this, by construction, is
a wedged *main* process: the watchdog runs on that loop.

### A startup error is the third hostage shape (`app/lib/fatal.ts`)

`dialog.showErrorBox` is **modal and synchronous** — the main loop stops inside
it until someone clicks OK. Measured: a process showing one ran **not a single
timer callback in fourteen seconds**. So a startup error left a process alive,
with no window, holding the lock, unable to run the watchdog that exists for
exactly that; and on an unattended launch nobody ever saw the box. Measured
before and after, on a window construction that throws:

| | before | after |
|---|---|---|
| the failed launch | still there at 19s, nothing in `diagnostics.log` | exits itself in **5.3s** (a 4s no-window budget), exit 1 |
| the launch after it | handed to it, **exit 0 after 1.3s**, no window | its own process, `app:ready` in 1.7s |
| a config that will not parse | modal, forever, invisible | exits in **1.2s**, record flushed |

Four rules, in this order:

1. **Record before anything else.** `recordFailure` + `logMainError`, then
   `flushDiagnostics()` — `app.exit()` runs no timers, so the batched record
   explaining the exit is otherwise the one guaranteed to be lost. A box on a
   screen nobody is looking at is not a record of anything.
2. **Release the single-instance lock before saying a word.** The hostage
   property is then closed by one call rather than by everything after it going
   right.
3. **Never block the loop.** `dialog.showMessageBox` runs its dialog on its own
   thread and answers with a promise. Verified both ways: under the async box a
   500ms interval kept ticking and an 8s timer fired; under `showErrorBox`
   nothing ran at all.
4. **Don't decide the exit here.** Whether there is anything worth keeping is
   the watchdog's question and it already answers it carefully, so quitting is
   handed back to `armNoWindowWatchdog` via `hasSomethingToLose()`. That also
   means a failure at the *tail* of startup — `focus()` on a window the user
   closed while it was booting — no longer kills a window that had already
   reached `app:ready`.

- **`--hidden` is the only certain "nobody is watching".** Nothing on Windows
  separates a double-click from a startup item, so the box is shown by default
  and skipped only where the answer is known: a launch that asked for no window
  at all. Nobody loses the error that way — a hidden Tabby that failed to start
  is one the user launches again the ordinary way, and *that* launch is not
  hidden, with both logs already written. `TABBY_FATAL_DIALOG_MS` (2 min) bounds
  the cost of guessing wrong; `TABBY_FATAL_DIALOG=0` skips it outright.
- **Before `app.ready` the blocking box is still the only one available**, so a
  config that will not parse gets `showErrorBox` — tolerable there and nowhere
  else, because `requestSingleInstanceLock()` has not been called yet, so that
  process is holding nothing. Nothing is armed that early either (there is no
  `Application` to count windows), so that path exits on its own.
- **`report()`'s detail must not carry a `kind` field.** It is spread over the
  record after its own kind, so `report('startup-failed', { kind })` silently
  files the record under the *other* name. Cost a round trip; the field is
  `failure` now.
- **The documented lever no longer throws.** A `window.json` with non-numeric
  bounds is cascaded past by `usable()` in `windowGeometry.ts` since
  `0036abab`. The test uses a *directory* named `window.json`: `conf` reads it
  with `readFileSync`, and EISDIR is neither ENOENT nor a SyntaxError, so it
  rethrows — from inside the `Window` constructor, which is the same place and
  the same shape.
- **The attended checks are opt-in** (`--attended`), because they put a real
  dialog on the screen. They read the box's own title from outside
  (`MainWindowTitle`) and then let it hit the cap: a timer firing while the box
  is up is the proof that it is no longer blocking.

## Where each window was

Position and size are remembered **per window**, in `<config dir>/window.json`
under `windowGeometries`. Upstream keeps one `windowBoundaries` key that every
window reads and writes, which is invisible with one window and wrong the moment
there are two: the second opens exactly on top of the first, and whichever
closes last overwrites the other. Multi-window is fork-added; the persistence is
upstream's and was never scoped to it.

- **The identity is the window ordinal, because it is the only one Tabby already
  has.** `isMainWindow` — the first window in `Application.windows` — is the sole
  condition under which the saved tab list is replayed (`app.service.ts`), so a
  window-scoped thing is already keyed off an ordinal; this widens that from one
  bit to N. Nothing else about a window survives a restart to key off: the tab
  list is one `localStorage` blob shared by every window in the partition, and
  only the main window reads it.
- **Slots are claimed lowest-free and released on close**, so *open* order
  decides them and close order cannot disturb them. Open order at launch is not
  a guess — `app.on('ready')` creates exactly one window — so slot 1 is always
  the main window. What it does not survive: closing window 1 and opening
  another mid-session hands the new one slot 1, so it lands where window 1 was.
- **No DPI is stored.** Windows Terminal's version of this (microsoft/terminal#12633,
  the reference for the port) keeps physical pixels and rescales them; Electron's
  screen coordinates are already per-display DIPs, so rescaling would introduce
  exactly the drift it exists to prevent.
- **A frameless window does not land on the rectangle it is given, and the
  discrepancy moves with Electron — so it is measured, never assumed.**
  `getBounds()` is what gets saved, so anything the window does not honour
  compounds: a window only ever opened and closed grew every launch and crept
  across the screen. Upstream has this too.
  - On **Electron 38** the constructor came back 2px taller and `setBounds` was
    exact, so re-applying the rectangle once after construction was the whole
    fix.
  - On **Electron 43** `setBounds` is not exact either: measured against this
    machine's 1.5x display, width comes back **+1 on every value** — 897→898,
    902→903, a real 1px border — so one pass turned 820 into 821, saved 821, and
    the next launch made it 822. The drift was back, one pixel at a time, and
    the test caught it by comparing the reopened window against the *file* it
    was restored from rather than against the number a test typed.
  - `window.ts` now measures the delta after `setBounds` and subtracts it.
    Width comes back exact. **Height cannot**: at 1.5x it snaps to the nearest
    odd number (598→599, 600→601), so it settles one pixel from the request and
    then stays there — a platform floor, not drift. `windowGeometry.test.js`
    allows one pixel on *size only*, and keeps the anti-drift assertion exact.
- **"On screen" is decided by the title bar, not by area.** The old check only
  fired when the saved rect missed the nearest display *entirely*, so a window
  whose title bar was above the top of the screen was restored exactly there and
  could not be dragged back. A rect now needs 120px of width and a 32px strip of
  its top edge inside some work area, or it is clamped into the nearest one — and
  a window deliberately hung off an edge is left alone. Size is clamped to the
  work area either way, so a rect saved on a 4K display does not reopen larger
  than a laptop panel. (The old centring was also wrong on a secondary monitor:
  it used the display's *size* without its origin.)
- **A slot with nothing saved cascades** 28px off the newest live window,
  wrapping at the work area edge, rather than opening on top of it.
- Geometry is written on close and 2s after the last move or resize — the
  watchdog's `app.exit()`, a session ending and a crash all skip `close`. The
  write is `conf`'s read-modify-write through `write-file-atomic`, which throws
  rather than losing data quietly, and a failure is recorded as
  `window-geometry-save-failed` (the read-only `data\` of a mis-frozen slot is
  what produces it).
- Slot 1 is mirrored back to `windowBoundaries`, so a build without slots —
  upstream, or an older one of ours — still finds the main window's place.
- Every placement writes a `window-geometry` record to `diagnostics.log`, and an
  adjusted one writes `window-geometry-adjusted` saying what was wrong. "Why did
  my window open there" is otherwise unanswerable from outside the process.

**No setting.** The reference gates this behind `rememberWindowGeometry` because
there it is new behaviour; here geometry has always been remembered and this only
fixes who it belongs to, so a toggle would be a way to ask for the bug. It would
also mean a `configDefaults.yaml` line, and every changed default is a rebase
conflict.

`app/test/windowGeometry.test.js` launches three hidden dev instances and drives
them over CDP, opening the extra windows through `app:new-window`'s own `hidden`
option so a run never shows a window or takes focus. It transcribes the old
placement and runs it against the same `window.json` and the same displays,
because a check only the new code can fail proves nothing — the transcription
puts both windows in one place and accepts the unreachable rect unchanged.

**Probe the debugging port, never assume it.** A port Chromium cannot bind is not
an error it reports: it simply does not listen, and every request goes to whatever
*is* there. Measured — 9251 was the user's own Chrome, full of logged-in tabs, and
the first version of this test was one URL filter away from evaluating JavaScript
in it. It now finds a free port and checks `/json/version` says Electron before
attaching.

## Why it froze (`diagnostics.log`)

`app/lib/diagnostics.ts` records what blocks an event loop, in both the main
process and every renderer, to `<config dir>/diagnostics.log` as JSONL. A frozen
window otherwise leaves no trace: Windows calls the process responding, nothing
throws, and until now the app log had no timestamps to line anything up against.

A stall record reads like this, and the summary alone is usually the answer:

```
renderer event loop blocked 71.3s during "ready" — 98% synchronous I/O:
fs.readFileSync ×58214 (41.0s), fs.unlinkSync ×58214 (28.2s)
```

- **The tally is the point, not a slow-call threshold.** What freezes this app is
  tens of thousands of individually-fast synchronous calls — draining a spool
  directory, walking a build tree — where no single call would ever trip a "slow
  call" limit but the sum blocks the UI for minutes. Every sync `fs` and
  `child_process` method is wrapped and counted; stacks are sampled every 500
  calls and deduplicated, so a burst is attributed without paying for a capture
  on each one.
- **`syncMs` versus `ms` decides where to look.** A stall that is mostly
  synchronous I/O names its own fix; one with almost none is script or GC, and no
  amount of I/O detail would have helped.
- **It installs before zone.js and the plugin loader.** The detector runs on
  timers captured before zone.js patches them — a zone-patched interval would
  schedule a change-detection pass every tick, and would stop reporting at
  exactly the moment the zone is what is wedged.
- **The `fs` wrapper must go on the module `require` returns.** `import * as fs`
  compiles to `__importStar(require('fs'))`, whose properties are forwarding
  *getters*; assigning a wrapper onto that copy throws straight into our own
  `catch` and instruments nobody, with reports still arriving and attribution
  always empty. Verified by checking the bundle: `fs` is emitted as
  `external "fs"` → `module.exports = require("fs")`, the one shared builtin, so
  this covers plugin code too without their cooperation.
- **Records are size-capped by dropping whole fields, never by cutting the
  string** — a JSONL log whose long lines do not parse is worse than one that
  admits it left something out. Lines stay ~1 KB, inside the size where an
  O_APPEND write from several processes still lands atomically.
- Writes are buffered and asynchronous: an instrumentation that blocks the loop
  to report that the loop was blocked would be measuring itself.
- `TABBY_DIAG=0` disables it; `TABBY_DIAG_STALL_MS` (default 250) and
  `TABBY_DIAG_INSTRUMENT_IO=0` tune it without a rebuild. Overhead is two
  `performance.now()` calls and a map lookup per synchronous call, ~200ns.

Also recorded: `render-process-gone`, `child-process-gone`, per-window
`unresponsive` with how long it lasted, renderer `unhandledrejection`, main
`uncaughtException`, and boot phase marks (`app-ready`, `window-created`,
`loading-plugins`, `bootstrapping-angular`, `ready`) so a stall says what was in
progress when it hit.

**And `require-failed` — every module that would not load, including the ones
nothing reports.** `tabby-electron` alone has seven
`try { var wnr = require(…) } catch { }` blocks, and the plugin loader has its
own; before this, a module that failed to resolve left no trace and surfaced
later as something unrecognisable (the documented case: a missing
`windows-process-tree` presenting as `Cannot read properties of undefined
(reading 'getRegistryKey')`).

- **`Module._load` is wrapped, so the throw is seen before any of those catches
  swallow it.** Nothing changes at the seven call sites, third-party plugin code
  is covered without its cooperation, and the error is always rethrown — this
  observes, it does not alter what happens next.
- Deduped by `request|code` and capped at 32 distinct, because a failing
  `require` is often *intentional*: optional dependencies and platform probes
  fail by design. One line per distinct thing that could not load, not one per
  attempt.
- Records the requesting file, so the answer is "which package asked", and the
  boot phase, so a load failure lines up against the stall it caused.
- Verified by reproducing the swallowed shape in a live renderer. It also
  immediately named a real one nothing had ever reported:
  `macos-native-processlist`, MODULE_NOT_FOUND, from `tabby-electron/dist/index.js`
  during `loading-plugins` — harmless on Windows, and previously invisible.
- **`module` must stay in the renderer webpack `externals`** (it is, beside `fs`),
  or `require('module')` resolves to a webpack shim, the wrapper never installs,
  and the whole thing silently does nothing.

**Known offenders it has already named**, both worth fixing at the source:

- `tabby-claude-status`'s `processSpoolDir()` drains `%TEMP%\tabby-claude-status.d`
  with synchronous `readdirSync`/`readFileSync`/`unlinkSync`, uncapped and without
  yielding, on the renderer thread. `hook.js` writes one file per Claude event and
  never prunes, so the backlog is proportional to how long Tabby was *not* running —
  measured 0.126 ms/file warm, and a 3.5-day gap is ~60,000 files.
- A cold main process blocked **17.4s** during `main-start` on `fs.readFileSync
  ×817`, i.e. module loading. Expected to be cheaper from an asar slot than a dev
  build, but it has never been measured before.

## When it isn't the event loop (`tabby-render-timing`)

The stall recorder covers the loop. It says nothing about the other way a
terminal feels slow: nothing blocks, the loop stays free, and the screen still
lags — because frames are being dropped, or because xterm is taking a long time
to parse and lay out what was written to it. `tabby-render-timing` is a builtin
that times both and writes `render-timing` records into the same log:

```
render-timing  frames: 327, slowFrames 3, jankFrames 2, worst 150ms, p50 8.3, p95 8.5
               term1: 7 writes, mean 22.7ms, worst 81ms, 2 slow
```

- **A `TerminalDecorator`, not an edit to `xtermFrontend.ts`.** Add-only, so it
  costs nothing at the next rebase, and it reaches any frontend exposing an
  `xterm` without knowing which. It wraps `xterm.write` and measures call →
  callback, which is the interval that matters: the caller's `await` returns long
  before the screen reflects anything.
- **Tallied, never streamed.** A busy terminal writes thousands of times a
  second; the finding is a distribution. Same principle as the stall recorder.
- **The rAF loop only runs while something is writing** and stops two seconds
  after. A permanent one would keep the compositor awake on an idle window —
  a poor trade for a diagnostic.
- **Gaps over 500 ms are not counted as dropped frames.** An idle tab produces
  one enormous gap, and counting it would make every summary look catastrophic.
- **`note()` was the wrong API and cost a debugging round.** It only appends a
  breadcrumb, which is shown as *context when a stall is reported* and is
  invisible otherwise — so the summaries went nowhere. `report()` was added
  alongside it for records that are the finding rather than context for one.
- Reports only when there is something to say: a healthy hour writes no lines.

## What upstream has that we don't (`tabby-upstream`)

Settings → **Upstream** compares this checkout against the project the fork
tracks: how many commits have landed there that are not here, the patch series
carried on top, and where each commit is on the web. It is the "should I sync?"
question, answered without leaving the app.

- **It never fetches on its own.** Network I/O when a settings page opens is how
  a page earns a reputation for being slow; fetching is a button. Which makes
  the *staleness* the thing that has to be visible, so the last-fetch time is
  shown, warned about past a week, and the page says outright that it is
  reporting what was last fetched rather than what upstream has now. "0 behind"
  from a month-old fetch looks identical to a fresh one otherwise.
- **`FETCH_HEAD`'s mtime is when the fetch happened**; the ref's own mtime is
  when it last *moved*, which is a different question and usually much older.
- **Only a source build has a checkout to find**, by walking up from
  `process.execPath` — a packaged build genuinely has none, since
  `app/dist/build-info.json` records the commit but not where it was built. That
  case is reported plainly, with a setting to point at a checkout anyway, rather
  than guessed at.
- Fields are split on `%x1f`/`%x1e` rather than a delimiter that could appear in
  a commit message.
- A missing `upstream` remote is the ordinary case for a fresh clone, so it is a
  message with the command to fix it, not an error.
- Verified against `git rev-list` on this checkout: behind and ahead counts,
  branch, the newest local subject, and the resolved GitHub URL all match, and
  the Fetch button moves `FETCH_HEAD` in ~1.5s.

## The settings nav is in sections (`tabby-settings`)

Eight labelled sections replace four prioritized pages and an alphabetical
run: General, Terminal, Connections, Links & integrations, Claude, Plugins,
Development, Configuration. `tabby-settings/src/settingsGroups.ts` is one
table of provider ids per section, in order.

- **Placed by id, so no provider file changed.** Every line edited in an
  upstream provider is a line a cherry-pick has to land, and the fork's own
  providers are left alone for the same reason.
- **A plugin's page must still find a home.** `SettingsTabProvider.group` is
  optional and add-only. A page that names no section and is not in the table
  goes under Plugins, and so does one naming a section that does not exist.
  `navGroups.cdp.js` proves it with a stand-in plugin loaded from a scratch
  profile under `%TEMP%`, launched on a port picked from the top of the range
  so it never lands on the instance a person is using.
- **Application opens the first section and Config file closes the last**
  because the template still draws those two pages itself, where upstream put
  them. That keeps the template's diff to one loop.
- **Labels are headings, not pages**: no `.nav-link`, not focusable, stepped
  over by ngbNav's arrow keys. Every page link is still a `.nav-link` under the
  settings tab's own nav, which `forkMarks.cdp.js` and the contrast audit
  select by.
- `prioritized` now only means "early within its section". The labels are not
  translated yet, and screen readers do not announce them as group names.

## Which settings are this fork's (`tabby-upstream`)

Nothing in the running program said which behaviour is ours and which is
upstream Tabby's — every row in the settings window is drawn identically either
way, which makes the divergence invisible at exactly the moment you are deciding
whether to change something. Two switches on Settings → **Upstream**, both off:
`upstream.showForkMarks` draws a **filled** diamond beside every setting
upstream does not have, and `upstream.showConfigOnlyMarks` a **hollow** one,
same shape and size, for a setting upstream *does* have and gives no control
for. A row carries at most one; the stylesheet settles which wins.

- **A CSS class, not a directive.** Angular matches directives in the
  *declaring component's* module scope, so a directive would have to be declared
  and exported from `tabby-core` — the most rebase-hostile file in the tree —
  before `tabby-settings` or `tabby-terminal` could use it. A class needs no
  registration, so marking a row is `.title` → `.title.fork-mark`: ten
  characters in a line that already exists. `forkMarks.scss` is injected
  globally by *not* being named `*component.scss`, which is how
  `webpack.plugin.config.mjs` chooses `style-loader` over `to-string-loader`;
  `dropZone.directive.scss` already relies on this, and the `<body>` class
  follows `ThemesService`'s own `no-animations`.
- **Drawn, not typed.** A rotated 7px square rather than U+25C6: no font
  coverage to rely on, no encoding to preserve, and the two marks are guaranteed
  the same size rather than the same size *in whatever font rendered them*. The
  cost is that a translator cannot drop it, which the reference's resource-file
  approach allows — stated rather than implied.
- **The list is derived.** `keys(working tree) − keys(master)`, recomputed by
  `scripts/dev/check-fork-marks.mjs`. 91 keys, almost all on the six pages that
  are entirely ours — **those are marked once, on the nav entry**, because
  marking their ~85 rows would be noise. On shared pages that leaves exactly
  three: Accent color, Multi-column tab bar, Minimum column width.
- **Changed *defaults* are deliberately not marked** — `tabsLocation`,
  `colorSchemeMode`, `minimumContrastRatio`, Windows `terminal.font`. They exist
  upstream, so they are not ours; the rule is a difference of keys, and the docs
  catalogue already covers them.
- **The hollow mark needed something to mark.** The reference shipped its
  equivalent and marked zero rows with it. Upstream Tabby hides very little; the
  audit found two real cases — `appearance.cycleTabs` (read three times in
  `app.service.ts`) and `terminal.detectProgress` (drives the tab's progress bar
  and the taskbar icon) — both with no control anywhere. Both now have one, which
  is more useful than the claim: the row stops saying "upstream hides this" and
  becomes where you change it.
- **`config.save()` awaits the disk**, so both switches apply the value from the
  event and only then save, or the mark lags the switch controlling it — the
  trap the accent swatch already documents. Reading `$event` rather than
  re-reading the store is also what avoids the reference's own bug, where the
  handler read the property before the two-way binding wrote it back and the
  mark never appeared.

### The checker, and why the sweep is only a review gate

`check-fork-marks.mjs` recomputes the fork-added set as
`keys(working tree) − keys(upstream/master)` and fails when the checked-in list
disagrees **in either direction** — which is what fires the moment a cherry-pick
brings across a key we had marked as ours. It needs the `upstream` remote
fetched and says so rather than guessing when it is missing;
`TABBY_UPSTREAM_REF` names another ref. It also refuses a marked row editing no
fork-added key, a fork-added key with an unmarked row on a shared page, a row
with both marks, a mark on a page already marked at its nav entry, a fork page
that forgets `forkAdded`, and a stylesheet or import gone missing. `--write`
regenerates the derived half, since that is git's answer rather than an opinion.
All four drift shapes were confirmed to fail it.

The *config-only* list cannot be computed, and the sweep that looks for keys
with no control is wrong in both directions. Two of its mistakes were found
while writing it:

- **`.ms-5.form-line`** is how the docking sub-settings are indented, so
  matching only a leading `.form-line` made six rows that plainly have controls
  look as though they had none.
- **A control is not always inside its row** — "Custom CSS" puts its textarea
  after the `.form-line` as a sibling.

What it still cannot see through is named in `fork-settings.json` with a reason
rather than left looking like a missing mark: `terminal.colorScheme` has a full
editor reached as `config.store.terminal[this.configKey]`, so its name appears
as a literal nowhere; `platformDefaults` is not parsed because its keys are
computed (`[Platform.Windows]`); and `hacks.globalHotkey` and
`terminal.environment` are real, unexposed, and deliberately still unexposed.

**And `builtin-plugins/` and every `dist/` are gitignored bundles of every
default and every compiled template**, so a filesystem walk finds each key a
dozen times and concludes everything has a UI. The scanner iterates
`git ls-files` for that reason alone.

`tabby-upstream/test/forkMarks.cdp.js` (25 checks) verifies it live. **The marks
are `::after` pseudo-elements** — in no `textContent`, no `innerText`, no
accessibility tree, and unreachable by `querySelector` — so a test that greps
the DOM for a diamond passes on zero marks; every check reads
`getComputedStyle(el, '::after')`. It asserts the *count* on the Window page so
an over-broad selector fails rather than looking like success, that the hollow
mark is the same size as the filled one (the whole "one family" claim), that
switching off takes effect **without navigating**, and that the 222px nav column
gains no horizontal scrollbar. Computed style only proves the rule matched, so
the mark was also captured on screen in both colour schemes and looked at.

Two things only a running window found: assigning `activeTab` from outside
Angular's zone changes nothing until `applyChanges`, and **more than one
settings page stays in the DOM at once**, so a document-wide query reads rows
from a page nobody is looking at.

## The empty Plugins tab was markup, not compatibility

Settings → **Plugins** rendered both of its lists as nothing at all after the
Angular 22 / ng-bootstrap 21 upgrade, which looks exactly like "plugins stopped
working". It was not that, and the distinction matters enough to record how each
half was established:

- **Plugins are fine.** 21 load, including all three third-party ones, their
  config keys are in the store, and the Installed list — once it rendered —
  showed 19 entries. That is the measurement described under *The rename*, redone.
- **`<ngb-accordion>` and `<ngb-panel>` were removed in ng-bootstrap 15** and
  this tree is on 21. Both lists used them, and **an unknown element is not an
  error in Angular** — no exception, no console warning, no failed build. The
  markup simply resolved to nothing, in the one component nobody had reopened
  since the upgrade. `grep` for the two tags across `src` found these and
  nothing else, so the same fault is not hiding elsewhere.

The migration is to the directive API already used by the Link Tooltip page:
`ngbAccordion` / `ngbAccordionItem` / `ngbAccordionHeader` / `ngbAccordionButton`
/ `ngbAccordionCollapse` / `ngbAccordionBody`, with the body's content inside an
`ng-template`.

- **The Upgrade button is now a sibling of the toggle, not a child.** The
  component API rendered `ngbPanelTitle` *inside* the header button, so a plugin
  with an upgrade available produced a `<button>` nested in a `<button>` —
  invalid, and the inner click is swallowed in some browsers. The header is the
  flex row now and the toggle takes the slack; the live check asserts
  `button button` matches **zero** elements.
- **The old stylesheet targeted `.card-header > button`**, which is ng-bootstrap
  *4's* markup. Nothing has emitted that element for several majors, so it had
  been styling nothing for as long as it had been there.
- Verified live: 144 available and 19 installed items, zero of either removed
  tag, a body that instantiates its Get / Homepage / version content on click.

### Search that filters, when the registry will not

Typing into Search plugins reordered the Available list and never shortened
it, and a refused request left the spinner turning for good. Both were the
registry path, not the page.

- **The npm registry does not filter by a term sent beside a `keywords:`
  qualifier.** Measured: `keywords:tabby-plugin tmux`, a nonsense term and the
  qualifier alone all return the same 149 packages, re-ranked. So the
  catalogue is fetched once (both keywords, paged past 250, cached five
  minutes) and `pluginSearch.ts` filters and sorts locally. Typing sends no
  request.
- **A refused request still has a JSON body.** A 429 is `{"code":"E429",…}`,
  and reading `.objects` off it threw inside the RxJS stream, which ended it:
  the spinner kept turning over a stale list and later typing sent nothing. A
  non-OK response now throws a readable error, shown with Retry.
- **Two `async` pipes on one cold stream double every request.** Each pause in
  typing cost four. The component holds the catalogue itself now.
- Relevance with no query keeps the registry's score order, so the default
  view is unchanged. The sort choice is view state, in
  `localStorage.pluginsSortOrder`.
- The dummy-transition guard read `item.keywords`, which the registry never
  sends; the keywords are on `item.package`.

## The renderer and xterm 6

The terminal renders through **WebGL**, on **xterm.js 6.0**. Two things worth
knowing before touching either.

**The canvas renderer is gone.** `terminal.frontend: xterm` used to mean
`@xterm/addon-canvas`; that addon was last released in April 2024 against
`@xterm/xterm ^5.0.0` and xterm 6 deletes it outright (xtermjs/xterm.js#5105).
It is also the renderer behind every stale-glyph report upstream has open
(#11511, #9429, #9263, #10378): it repaints only the rows it believes are
dirty, so anything it draws and then loses track of stays on screen until
something forces a full repaint. `XTermFrontend` now means xterm's own DOM
renderer — slow but always correct, and the fallback for the SwiftShader
workaround (#8884) and for a pane whose WebGL context could not be recovered.

**A saved `frontend: xterm` is aliased to WebGL** in
`baseTerminalTab.component.ts` rather than migrated. A fork-owned bump of
`config.version` would make upstream's own migration 9 skip these configs at
the next sync, so the alias is one map entry and no versioning risk.

Four things break in `xtermFrontend.ts` against 6.0, each checked against the
shipped sources rather than the changelog:

- `overviewRulerWidth` is now `overviewRuler: { width, showTopBorder,
  showBottomBorder }`.
- **`_core.viewport._refresh()` is gone.** The viewport is private (`_viewport`)
  and rebuilt on VS Code's scrollable element; `queueSync()` replaces it. The
  synchronous `_renderService._renderRows()` after a fit stays — it is what
  closes the blank frame during a window drag, and `xterm.refresh()` cannot
  replace it because that goes through the render debouncer and lands a frame
  later.
- **`_core.browser` cannot be assigned into.** It is xterm's `common/Platform`
  module namespace, whose properties are read-only getters, so the three
  platform assignments in `configure()` throw. Spread it instead. This only
  bites on 6.0 because the ESM build hands out a real namespace object where
  the CommonJS one handed out a plain object.
- **`scrollToBottom()` gained `disableSmoothScroll`** and xterm's own callers
  pass `true`. Without it every pinned write starts a scroll animation. Same for
  restoring a scroll position while unpinned, which is why that now goes through
  the viewport directly.

xterm 6 also **paints `.xterm-viewport` black and `.xterm-scrollable-element`
white**, both on top of Tabby's background — measured, not theorised. Both are
overridden in `xterm.css`. The scrollbar slider needs nothing from us: xterm
derives it from the theme's foreground at 20/40/50% opacity, which already
follows a light or dark scheme.

### The addon that cannot be bundled

**`@xterm/addon-unicode-graphemes@0.4.0` hangs the renderer if it is imported
into `tabby-terminal` at all.** This is what forced the previous attempt at the
xterm 6 upgrade to be reverted (`9c4266f0` / `c9fcd052`), and it is why the
emoji-width fix is still open.

The symptom: the renderer spins at 100% CPU during module evaluation — before
a single plugin loads, because `initModuleLookup()` eagerly requires
`tabby-terminal` before `findPlugins()` runs — so the app log stops after
`Window bootstrap data` and the window sits on the splash screen for ever.
Measured at 270s of CPU and climbing.

- **V8's inspector cannot interrupt it.** `Debugger.enable` gets no reply and
  no `scriptParsed` events arrive, so `Debugger.pause` never lands. That rules
  out the usual approach and is itself a clue: a plain JS loop is interruptible.
- **It is the import, not the use.** Replacing `loadAddon(new
  UnicodeGraphemesAddon())` with `void UnicodeGraphemesAddon` still hangs.
  Removing the import entirely boots in seconds.
- **Not the ESM entry.** Every `@xterm` package at 6.x ships both a CommonJS
  `main` and an ESM `module`, and the shared config's `mainFields` prefer
  `module`, so the upgrade does silently move the whole tree onto `.mjs` — but
  forcing `mainFields: ['main', ...]` (confirmed with
  `scripts/dev/which-modules.mjs`) hangs identically. Note `resolve.alias` is
  useless here: `@ngtools/webpack`'s resolver ignores it.
- **Not babel.** `babel-loader` runs over every `.js` in node_modules; excluding
  the `@xterm` packages from it hangs identically.
- **Not the addon itself.** Loaded standalone it takes 11-15 ms, from either the
  `.js` or the `.mjs` build.

So it is something about that module inside this bundle, and it is still
unexplained. The earlier investigation cleared the addon by loading it
standalone, which is exactly the test that does not reproduce it.

### Measuring stale glyphs

`tabby-terminal/test/glyphs.cdp.js` answers "did the renderer leave anything on
screen the buffer does not account for" with a number, over CDP against a
hidden dev build (`scripts/dev/launch-hidden.mjs`). It fills the scrollback
past capacity, scrolls up with real wheel events while output keeps arriving,
resizes mid-flow, snapshots the renderer's own canvases, forces the full
repaint a tab switch would do, and snapshots again. Any pixel that moved was
stale; the buffer is serialized on both sides so a run that changed content is
discarded.

**It reports 0 dirty cells on canvas, on WebGL and on xterm 6** — so it does
not reproduce the artifacts that prompted this work and cannot be cited as
proof they are fixed. Its instrumented `refreshRows` counter says why: under
this generator a full-viewport repaint follows nearly every buffer scroll, so
nothing can go stale. Whatever the real conditions are, they are narrower than
this.

Reading the canvases directly rather than screenshotting is deliberate: the
result then does not depend on the window being composited, which is what makes
it usable on a `--hidden` instance.

## Searching the selection (`tabby-terminal/src/webSearch.ts`)

Right-clicking a selection offers **Search the web for "…"**, which opens
`terminal.webSearchQueryURL` — `https://www.google.com/search?q={{query}}` by
default — through `platform.openExternal()`. Upstream has no web-search action
anywhere; Windows Terminal's `searchWeb` is the model, and its Bing default
wrapped the selection in `%22…%22`, which this deliberately does not: the
selection searches as ordinary terms.

- **`{{query}}`, not Windows Terminal's `%s`.** `{{name}}` is already how every
  URL built from matched text is written here — the `tabby-links` integration
  manifests use `{{match}}` and friends — so there is one templating convention
  in the repo rather than two.
- **The template is parsed twice and the origins compared.** The selection is
  text a remote host printed; `encodeURIComponent` alone already stops it
  becoming a second parameter or a fragment, but a template is also probed with
  an inert stand-in and the result refused unless the scheme is http(s) and the
  final URL's origin is identical to the probe's. So a template can never be
  turned into a different host by what was selected, and a malformed or
  `javascript:`/`file:` template opens nothing and says why instead.
- **`&` in a menu label is a mnemonic on Windows and Linux**, so a selection of
  `foo & bar` would show as `foo _bar`. It is doubled for those platforms and
  left alone on macOS, where Electron takes labels verbatim. Truncation happens
  *before* the doubling, or a cut could split a `&&`.
- **ICU MessageFormat passes `{{query}}` through as an argument.** The "must be
  an http(s) URL containing {{query}}" notification would be a compile error if
  the braces were in the pattern, so the token rides in as `{token}`;
  `webSearch.cdp.js` asserts the rendered string.
- Selections are capped at 512 characters and whitespace runs collapse to single
  spaces — a terminal selection can be megabytes, and a multi-line one has to
  search, and label, as one line.

## Changed upstream defaults

Kept to a minimum — every one is a line that conflicts on rebase.

- `appearance.tabsLocation: left` (`tabby-core/src/configDefaults.yaml`) —
  vertical tabs. Titles here are paths and session names, which a horizontal
  strip truncates to nothing. Only affects profiles with no value saved.

- `terminal.minimumContrastRatio: 1` (`tabby-terminal/src/config.ts`), was `4`.
  The value goes straight into `xterm.options.minimumContrastRatio`, and
  xterm.js rewrites **every** foreground that misses the ratio — 24-bit ones
  included (`TextureAtlas._getMinimumContrastColor` has no `CM_RGB` exemption).
  At 4, and worse at 6, that recolours entire palettes: Solarized Light on a
  light background sits at 3–5:1, so all 13 of its colours get pushed toward
  mud and near-neighbours collapse onto each other. 1 is the "off" value and
  what xterm.js itself defaults to; Windows Terminal's equivalent,
  `adjustIndistinguishableColors`, resolves `Automatic` → `Never` unless
  Windows high-contrast is on (`TerminalCore/Terminal.cpp`). So this is now
  "draw what the app asked for", same as WT/iTerm2.

  **The same key also drives the chrome's contrast floors, and there are two.**
  `ThemesService.applyThemeVariables` floors each derived pair by what its
  foreground is used for:

  - **Text, 4.5** (`TEXT_CONTRAST_RATIO`): `--bs-body-color`, `--theme-fg`,
    `--theme-fg-less`, `--theme-fg-less-2`, `--theme-fg-more`, every
    `--theme-<key>-fg` and `-active-fg`, and `--theme-accent`. Each of them
    colours words somewhere: body text, tab titles, nav links,
    `--bs-emphasis-color`, `<code>`, the active nav pill.
  - **Tint, 4** (`UI_MINIMUM_CONTRAST_RATIO`): `--theme-fg-more-2` only, which
    is the scrollbar thumb, a focused input's border and a fork mark's outline.

  Both are `max(floor, terminal.minimumContrastRatio)`, so dropping that
  default to 1 changed nothing here, and raising it still escalates both. One
  floor of 4 used to cover text too, which left a secondary button's label at
  4.30:1. A foreground that is ever read as text belongs in the text list.

  Colours no pair covers are measured against where they land.
  `--theme-muted-fg` meets 4.5:1 on `--body-bg`, `--theme-bg`, `-more`,
  `-more-2`, `-less` and `-less-2`. `--theme-<key>-text` meets it on those and
  on `--theme-<key>-alert-bg` (the key at 14% over the page), and
  `--theme-<key>-border` meets 3:1 on the same. `--theme-<key>-contrast-fg` and
  its `-hover-` and `-active-` forms meet 4.5:1 on that key's own fill.
  `--theme-<key>-edge` is an outline for a badge fill too close to the page, or
  `transparent`. Every search is judged in whole channels, because an
  unrounded 4.500 painted as 4.487.

## Text contrast is measured (`scripts/dev/contrast-audit.cdp.cjs`)

Every settings page, the tab bar, the settings nav and the profile selector
are measured in the light scheme and the dark one, in a hidden dev build,
against WCAG AA: 4.5:1, or 3:1 for text of 24px (18.66px bold). On 2026-09-12
it found 94 runs below that in AtomOneLight and 98 in Afterglow, colour-scheme
previews excluded, and none in either once the fixes below landed.

```bash
node scripts/dev/launch-hidden.mjs --enable links,linkifier,claude,builds --port 9246   # leave it running
CDP_PORT=9246 node scripts/dev/contrast-audit.cdp.cjs [--page "Builds,Plugins"] [--json out.json]
CDP_PORT=9246 node scripts/dev/contrast-audit.cdp.cjs --self-test
```

- **Text is measured the way it is composited.** Every element is an isolated
  group: its background, then its content, the whole multiplied by its opacity
  and laid over what is behind it, up to the root. The first version multiplied
  opacity into the text alone and scored a planted white-on-half-black case at
  5.28:1 where the painted result is 4.04:1. `--self-test` plants that case and
  six more and fails unless each comes back exact.
- **A collapsed accordion measures nothing**, so every group on a page is
  opened first, and a page's inner tabs (Builds → Options) are visited in turn.
- **Colour-scheme previews are skipped**, because they draw a scheme's own
  colours on purpose, and disabled controls are exempt, as WCAG exempts them.
- **Not covered yet:** the Claude side panel and tab hover card, the link hover
  card and preview pane, the SFTP panel, menus, toasts, and text that only
  appears on hover. Plain links outside alerts still use Bootstrap's
  `#0d6efd`, 4.27:1 on a light page and 3.58:1 on a dark one; no audited page
  shows one, and recolouring every link is a design decision not yet taken.

What it found, and where the fixes live:

- **Secondary text was an opacity, not a colour.** `.text-muted` was the
  foreground at `opacity: .5`, a different colour on every surface it lands on
  and about 2.5:1 on a light scheme's grey panel. `--theme-muted-fg` replaces
  it. A component that dims text uses that variable and no `opacity` on the
  same element, or the two stack and fail again.
- **Bootstrap compiles half of each contextual class and the theme supplies
  the other half at runtime.** `.text-bg-*` baked `color: #fff` or `#000` in
  at build time against Bootstrap's own palette, while its background was
  `var(--bs-*-rgb)`: AtomOneLight's secondary badge was white on pale grey at
  1.40:1. `.btn-outline-*` kept `#0d6efd` and `#dc3545` whatever the scheme.
  Both now read colours `ThemesService` measured against the real fill.
- **Accordions are outlined cards, not grey slabs.** Bootstrap filled header
  and body with `--bs-accordion-bg`, gave an open header a darker fill, and
  drew the chevron from a compiled `#212529` or `#052c65`, which measured
  1.14:1 on a dark scheme. Bodies are the page now, the header carries the
  weight, and the chevron is a mask over `currentColor`.
- **`primary` and `info` are the same colour** (`theme.colors[4]`), so their
  badges and alerts are identical. Left as it is; a page that needs to tell two
  things apart should not lean on those two keys, which is why the Builds page
  shows a build's kind as an icon chip.

## The colour scheme page

Settings → Color scheme opens on **Pair**, has one search above its three
tabs, and each mode tab opens on its own tone.

- **Pairing: the name finds the design, the colours decide the halves**
  (`colorSchemeTone.ts`). The old rule needed dark, light, night or day as a
  separate word on both halves, and lost three kinds of pair: words run
  together (`OneHalfDark`, `TokyoNight Day`), a plain name that is one half
  (`Tomorrow`, `ayu`, `Tabby Default`), and a family with a third variant.
  Names now split at separators and at lower-to-upper case, variant words
  (`moon`, `storm`, `dawn`, `mocha` and so on) come out like tone words, and a
  name claiming the tone its colours contradict is never a half. 6 pairs
  became 21 rows from 14 designs.
- **`morning` and `evening` are not tone words.** Base2Tone ships Morning and
  Evening as separate designs, and removing the words would pair a design
  nobody drew.
- **A longer name joins a design only if it also carries a tone word**, so
  Tomorrow Night Eighties joins Tomorrow and Solarized Darcula stays out.
- **The search lives on the page, not in a tab**, because ngbNav destroys a
  tab's content when another is selected and the query has to survive that.
- **The tone filter is not stored.** It was one localStorage value shared by
  both mode tabs, which is how Light chosen on the Light tab was still
  selected on the Dark one. An override now lasts one visit.
- `colorSchemeTone.test.js` transcribes the old rule and asserts its six pairs
  are still found, then pins all 21 rows and the deliberate non-pairs.
  `colorSchemePage.cdp.js` covers the tab order, the per-tab tone, the shared
  search and the Pair title alignment.

## The accent colour

`appearance.accentColor` (Settings → **Window**) colours every `<code>` in the
app — paths, commits, identifiers, the build tooltip. Null follows the colour
scheme.

- **What it replaces is Bootstrap's `$code-color`, a pink (`#d63384`) belonging
  to no scheme here.** `theme.vars.scss` overrode it to orange, but nothing
  imports that file any more — `theme.new.scss` imports Bootstrap with its own
  defaults — so the pink was live and was the only hardcoded accent left in the
  UI.
- **The configured value is parsed before it is used.** `applyThemeVariables`
  runs on every keystroke in the settings box, and a half-typed `#ab` thrown out
  of `Color()` would take every other variable in that pass with it.
- It goes through the same contrast floor as the rest of the chrome, so a pale
  pick is darkened against the window background rather than left illegible.
- The build tooltip now follows the theme (`--bs-tooltip-bg`) instead of being
  Bootstrap's near-black, which is what keeps the accent inside it legible —
  it is contrasted against the window, not against black.

## The splash screen

Follows the OS scheme now. The window's backing colour already did
(`opaqueBackgroundColor()` reads `nativeTheme.shouldUseDarkColors`); only the CSS
was hardcoded dark, so a light desktop got a black flash before the window drew.

`app/src/preload.scss` keeps its dark values as-is and adds a
`@media (prefers-color-scheme: light)` block that overrides four of them — an
override rather than a pair of themes, so the dark path's diff is nil and the
rebase surface on an upstream file stays one appended block.

- **`prefers-color-scheme` is already correct when the splash paints.**
  `setDarkMode()` runs during window construction (`window.ts:141`), before the
  page is shown, so the media query reflects `appearance.colorSchemeMode` — the
  user's choice, not merely the OS default.
- The light background is `#f5f7f9`, deliberately not white: the logo's palest
  gradient stops (`#ccecff`, `#9feced`) all but vanish against pure white.
- Verified by extracting the compiled stylesheet out of `app/dist/preload.js` and
  rendering the real splash markup under both `nativeTheme.themeSource` values in
  an off-screen window — dark stays exactly `#1d272d`/`#a1c5e4`, light comes back
  `#f5f7f9`/`#2f5d80`.

## Known issues to fix in this fork

- **Emoji width** — `❇️` gets **one** column where Windows Terminal gives two, so
  the glyph paints wider than the cell reserved for it and everything after it sits
  one column off. xterm 6 removed the first blocker; the addon that carries the fix
  is now the blocker. See Planned, and *The addon that cannot be bundled* above.
- **The stale-glyph artifacts that prompted the renderer work are not reproduced**
  by `tabby-terminal/test/glyphs.cdp.js`. Retiring the canvas renderer is
  well-founded on its own, but it is not *measured* to be the fix.
- Open upstream PR by us, not yet merged — carry it here rather than waiting:
  [#11383](https://github.com/Eugeny/tabby/pull/11383) fix(linkifier): keep `:` `,` `/`
  in clickable URL path/query.

## Planned

- **Emoji width.** xterm 6 has landed (see *The renderer and xterm 6* above), which
  was the prerequisite — but the addon that carries the fix cannot be loaded.

  | sequence | xterm + unicode11 | other terminals |
  |---|---|---|
  | `U+2747` alone | 1 | 1 |
  | `U+2747 U+FE0F` (`❇️`) | 1 + 0 = **1** | **2** |
  | `U+2705` (emoji by default) | 2 | 2 |

  VS16 is width 0 and never promotes its base to the emoji-presentation width 2.
  `@xterm/addon-unicode11` cannot fix that at any version, and on xterm 5.4
  swapping in `@xterm/addon-unicode-graphemes` did nothing either: 5.4's
  `UnicodeService` delegates only `wcwidth` to the provider and implements
  `charProperties` itself on top of it, so the provider's richer version was never
  called. xterm 6 does delegate `charProperties`, so the swap would now work.

  **What blocks it is that `@xterm/addon-unicode-graphemes@0.4.0` cannot be put
  in this bundle at all** — see the hang described above. Until that is
  understood, `unicode11` stays and `❇️` keeps its stray space.

- **`useConptyDll`.** node-pty 1.2.0-beta.8 bundles conpty 1.23 under
  `third_party/conpty/`, but `tabby-local/src/session.ts` never passes
  `useConptyDll`, so sessions run on whatever conpty ships with Windows. xterm 6's
  reflow work is aligned to conpty >= 1.22 (xtermjs/xterm.js#5321), and VS Code
  turned the equivalent setting on to fix resize corruption. Worth measuring.
