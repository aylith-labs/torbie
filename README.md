# Torbie

A terminal for Windows, macOS and Linux, built on the [Tabby](https://github.com/Eugeny/tabby)
codebase and diverged from it. It keeps Tabby's plugin API — third-party plugins written for Tabby
load unchanged — and adds the work catalogued in [`docs/`](docs/index.html): 43 features across
diagnostics, link previews, session resume, build management and the terminal itself.

> **Alpha.** Torbie is run from source and is not yet distributed as an installer. It is a personal
> tool being developed in the open, not a supported product.

## What it is

A VT220-compatible terminal with tabs, nested split panes, an SSH/SFTP/Telnet client and connection
manager, a serial terminal, an encrypted vault for secrets, and full profile and shortcut
configuration. On Windows it drives PowerShell, WSL, Git-Bash, Cygwin, MSYS2, Cmder and CMD.

It is an alternative to conhost, PuTTY, Terminal.app and iTerm. It is not a shell, and it is not
lightweight — it is an Electron application, and if resident memory is the deciding factor, Alacritty
or WezTerm will serve you better.

## What it adds

Each of these has a page in the feature catalogue with what it does, what it deliberately does not
claim, and the commits behind it.

| | |
| --- | --- |
| **Link previews** | A hover card over terminal links, driven by declarative integration manifests that fetch what a link refers to — Jira, GitHub, Slack and more. Rules customise per-pattern behaviour; a preview can open in a real pane beside the terminal. |
| **Session resume** | A restored pane comes back running what it was running, not just a shell — the agent, the multiplexer, the dev server. |
| **Claude Code awareness** | A docked session panel and tab hover cards for Claude Code sessions, joined to tabs by launch directory. |
| **Diagnostics** | `diagnostics.log` records what blocks an event loop, in the main process and every renderer, with attribution to the synchronous calls responsible. Plus render timing, for the frames the event loop cannot explain. |
| **A watchdog** | A process that can never show a window does not get to hold the single-instance lock indefinitely. |
| **Builds** | Every build on the machine, with live process attribution, health checks, and two managed build slots. |
| **Per-window geometry** | Each window remembers its own position and size, rather than every window sharing one. |
| **Jump list icons** | Taskbar profile entries wear their own icons, rasterized from the profile's Font Awesome class or SVG. |

## Running it

Torbie is built and run from source. See [HACKING.md](HACKING.md) for the full setup; the short
version, once the prerequisites are in place:

```bash
yarn --network-timeout 1000000
yarn run build
node scripts/prepackage-plugins.mjs
./node_modules/electron/dist/electron.exe --dev --user-data-dir=<profile> app
```

`--user-data-dir` must come **before** the app path, or Electron hands the switch to the app and
silently ignores it.

## Plugins

Torbie loads plugins built for Tabby. The package-name prefix (`tabby-`), the npm keywords
(`tabby-plugin`, `tabby-builtin-plugin`) and the module names plugins `require` are all unchanged,
and there is no version gate — a plugin that worked with Tabby works here. That compatibility is the
reason this codebase is a Tabby derivative rather than a rewrite, and it is not going to be traded
away.

Third-party plugins are installed from Settings → Plugins, which searches npm for the `tabby-plugin`
keyword.

## Themes

Colour schemes and window themes are plugins like anything else, and Tabby's are compatible. The
built-in schemes are unchanged.

## Relationship to Tabby

Torbie began as a fork of [Eugeny/tabby](https://github.com/Eugeny/tabby) and owes it the entire
foundation. It no longer tracks upstream: changes are cherry-picked across when they are worth
taking, in either direction, rather than the fork sitting rebased on a moving base. Settings →
**Upstream** reports how far apart the two are and which settings this codebase added.

Bugs found here that belong upstream should go upstream. Torbie's own issues belong in
[this repository](https://github.com/aylith-labs/torbie/issues).

## Licence

MIT, as Tabby is. See [LICENSE](LICENSE).
