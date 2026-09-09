---
name: Torbie
tagline: A terminal that keeps Tabby's plugins and answers why it froze
description: >-
  A desktop terminal derived from Tabby, keeping its plugin API intact while
  adding the instrumentation a terminal usually lacks: what blocked the event
  loop, why a build will not start, and what each pane was running before the
  last restart.
category: developer-tools
status: building
features:
  - Loads plugins written for Tabby unchanged — the compatibility contract is deliberate
  - Records what blocks an event loop, in the main process and every renderer, with per-call attribution
  - A restored pane comes back running what it was running, not a bare shell
  - Hover cards over terminal links, driven by declarative integration manifests
  - Health-checks every build on the machine and names the cause when one will not start
  - A watchdog, so a process that can never show a window cannot hold the single-instance lock
  - Per-window position and size, rather than every window sharing one
targetUser: >-
  Developers who live in a terminal all day, run long-lived agent and server
  sessions in it, and want to know why it stalled rather than restart and hope
featured: false
icon: >-
  M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0 0 21
  18V6a2.25 2.25 0 0 0-2.25-2.25H5.25A2.25 2.25 0 0 0 3 6v12a2.25 2.25 0 0 0
  2.25 2.25z
gradientFrom: '#c97a3a'
gradientTo: '#8a5a2b'
---

## What it is

Torbie is a terminal for Windows, macOS and Linux, built on the
[Tabby](https://github.com/Eugeny/tabby) codebase and diverged from it. It has tabs, nested split
panes, an SSH/SFTP/Telnet client and connection manager, a serial terminal, and an encrypted vault
for secrets. On Windows it drives PowerShell, WSL, Git-Bash, Cygwin, MSYS2, Cmder and CMD.

It is in alpha: run from source, not yet distributed as an installer.

## Why it exists

Two reasons, and they pull in the same direction.

The first is the plugin ecosystem. A terminal is only as useful as what people have already built
for it, and Tabby's plugin API has a real one. Torbie keeps it — the package names, the npm keyword,
the modules plugins `require` — so a plugin written for Tabby loads here unchanged. That is not a
transitional courtesy; it is the reason this is a derivative rather than one more terminal written
from scratch.

The second is that terminals are opaque when they misbehave. A window that freezes for ninety
seconds leaves no trace: the OS reports the process as responding, nothing throws, and the only
evidence is the user's memory of it. Torbie's answer is instrumentation rather than optimism.

## What it adds

**It says why it froze.** `diagnostics.log` records what blocks an event loop, in the main process
and in every renderer, and attributes the stall to the synchronous calls responsible. The finding is
usually the summary line: *"renderer event loop blocked 71.3s during boot — 98% synchronous I/O:
fs.readFileSync ×58214"*. It counts tallies rather than slow calls, because what freezes an
application of this kind is tens of thousands of individually fast operations, none of which would
trip a threshold.

**It refuses to be a useless hostage.** Exactly one process holds the single-instance lock, so a
process that can never show a window silently swallows every later launch — measured at six hours of
it. A watchdog now ends a process in which no window has ever finished booting, and a startup error
no longer blocks the main loop in a modal dialog nobody is looking at.

**It brings a pane back running.** Restoring a session normally restores the furniture: the tabs,
the splits, a picture of the scrollback. Every pane still comes back as a fresh shell, so the agent
you had a two-hour conversation with is simply not there. Torbie asks each pane what it is running,
persists that with the layout, and types it back.

**It previews what a link refers to.** A hover card over a terminal link, driven by declarative
integration manifests that fetch a summary — a ticket's status, a pull request's checks, a commit's
files. Rules customise it per pattern, and a preview can open in a real pane beside the terminal.

**It inventories itself.** Every build on the machine, with live process attribution, size, git
provenance, and a health check that names the cause when one will not start — written after an
auto-update deleted nine builtin plugins and left the app on a splash screen indefinitely while
Windows called it responding.

## Relationship to Tabby

Torbie began as a fork and owes it the whole foundation. It no longer tracks upstream: changes are
cherry-picked across when they are worth taking, rather than the fork sitting rebased on a moving
base. A settings page reports how far apart the two are, and marks which settings this codebase
added — because otherwise every row in the window looks the same whichever project it came from.
