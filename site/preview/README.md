# Torbie browser preview

This mounts the real Angular root, terminal/xterm, settings, Web platform and
Claude Code plugin from the committed Torbie source. Only the session/process,
configuration persistence and Claude/Stith/Shefrd service boundaries are mocked.
The terminal programs are small interactive ANSI fixtures, not installations of
Claude Code, Codex, Shefrd, LazyGit, Neovim or btop. The page labels them as demo data.

## Build and verify

From `site/`:

```sh
npm ci
npm ci --prefix preview
npm run build:preview
npm run lint && npm run check && npm test
npm run build && npm run check:links
npm run preview -- --host 127.0.0.1 --port 5870
# In another terminal, after installing Playwright Chromium:
npm run test:preview
```

`build:preview` archives the committed app sources into a temporary directory,
links the isolated preview dependency set, builds, and removes the directory.
It never installs the desktop package tree or launches Electron. In a dirty
checkout it deliberately uses HEAD for app code, while taking preview changes
from the working tree. Commit app changes before checking their browser version.

The page initially embeds the exact `app/index.pug` / `app/src/preload.scss`
loading screen. IntersectionObserver starts the Angular bundle near the viewport.
The bundle is minified, content-hashed, and cached independently of the site.
No Angular code is included in Svelte's initial bundle. Light/dark changes travel
through an origin-checked message and Torbie's actual ConfigService. On narrow
screens tabs are on top and the Claude panel docks at the bottom.

The browser needs Angular JIT for legacy dynamic plugin components. The loader
inlines existing Pug/SCSS and preserves constructor DI tokens; it explicitly
retains the pre-Angular-22 default change-detection semantics for components that
do not declare their own strategy. The Angular linker handles partial libraries.
CSP allows this compilation but disallows all network connections. Same-origin
iframe messages are checked on both sides. There is no host shell, Electron
bridge, remote MCP endpoint, persistence, or real plugin installation. The Claude
switch activates an already bundled plugin and its seeded service providers.

The desktop feature catalogue is broader than this subset. Feature pages offer
this common workspace playground; native builds, SSH, OS integration and other
plugins still require the desktop app. Configuration changes last for this page
visit. External session links explain the demo boundary instead of navigating.

Review covers scenario switching, terminal keyboard input, real pane count,
plugin activation through both controls, theme propagation, page overflow and
absence of external requests/runtime errors at desktop and mobile widths.

Font Awesome **Free** is fetched from the public npm registry. The preview's
`.npmrc` pins that scope so a developer's private Font Awesome registry cannot
leak into this public build's lockfile. CI needs no npm authentication.
