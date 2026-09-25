# Dependency upgrade — 25 September 2026

All direct dependency manifests and lockfiles were checked against the public npm
registry, including the desktop app, built-in plugins, web frontend, marketing
site and browser preview. GitHub Actions use the current supported major tags;
the signing action retains its immutable v1.2.1 commit.

## Compatibility decisions

- **TypeScript:** standalone declaration/type checks run native TypeScript 7.0.2.
  `typescript ~6.0.3` remains the JavaScript compiler API dependency of Angular
  22.2 (`>=6.0 <6.1`), ts-loader and svelte-check. The site also runs its checks
  with the native compiler. Replacing the JavaScript API dependency with TS7
  prevents those tools from loading. Declaration configs now use explicit paths
  instead of the removed `baseUrl` option.
- **node-pty:** the existing 1.2 beta line advances to beta.15, preserving the
  shipped line and bundled ConPTY implementation instead of downgrading to the
  registry's stable 1.1.0. The Windows build patch is retained. This remains a
  prerelease dependency and needs platform testing before an installer release.
- **Pug tools:** `@tabby-gang/to-string-loader` and `pug-cli` have no stable
  releases; their latest published versions are still prereleases.
- **Electron 44:** clipboard operations moved to the main process and return
  promises. A narrow IPC bridge preserves `PlatformService`/`ElectronService`
  synchronous clipboard methods for plugins. Only the main frame of an owned
  local-file app window can call it. Linux ARM 32-bit release builds are removed
  because Electron no longer publishes that platform; x64 and ARM64 remain.
  Electron 44 also requires macOS 13+. Existing v1.0.0 download links stay intact.

## API migrations

- ngx-translate 18 uses standalone pipes/directives and provider functions.
  Locale switching uses its public language and fallback APIs; the private
  translation-store monkey patch is removed. English fallback and ICU message
  compilation remain enabled through `@messageformat/core`.
- A local standalone filesize pipe uses filesize 11. The old ngx-filesize wrapper
  required filesize <10 and is removed.
- Sentry uses its public main/renderer exports. Both Electron's `browser` process
  name and the existing webpack `main` constant are recognized. Reporting stays
  disabled without a DSN.
- Babel 8 parses module and CommonJS dependencies using `sourceType: unambiguous`.
  A small Pug loader uses webpack's `getOptions` and dependency tracking instead
  of the obsolete loader-utils query parser.
- Color 5 uses its default export and public lightness accessor; Node 26 typings
  require explicit string/Buffer handling at socket boundaries.
- Native patches for app-builder-lib, serialport, windows-process-tree, glasstron
  and node-pty are retained and checked against the upgraded sources.

Desktop verification does not start Electron or register URL schemes. Browser
checks exercise the real Angular app with the existing mock services. Installer
releases and interactive Windows/macOS smoke tests are separate from this update.
