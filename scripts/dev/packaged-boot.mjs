#!/usr/bin/env node
// Boot a *packaged* build, hidden, on a throwaway profile, and require that its
// first window reaches `app:ready`.
//
//   node scripts/build-windows.mjs --dir          # dist/win-unpacked, no installer
//   node scripts/dev/packaged-boot.mjs [path/to/Torbie.exe] [--timeout 90]
//
// Why a packaged build and not the source one: v1.0.1 booted from source and
// never once installed. A source launch resolves modules through the repo's own
// `node_modules`, which answers anything the shared module map forgets; a
// packaged one has only `app.asar`, `builtin-plugins` and the map. The bundle
// asked for `@angular/core/rxjs-interop`, only the source tree had it, and the
// installed app sat on its splash until the watchdog quit it after 60s.
//
// What counts: a `window-ready` record from the process we started, in the
// profile's own `diagnostics.log` (written by `app/lib/watchdog.ts` when the
// first window sends `app:ready`). What fails fast: `watchdog-quit`, a
// `bootstrap-failed` (the renderer fell back to safe mode), or the process
// exiting. Every `require-failed` is printed either way — optional modules
// fail by design, so they are evidence rather than the verdict.
//
// Safe beside a running Torbie: its own --user-data-dir (Electron's
// single-instance lock is keyed on that), no global hotkey, no MCP server, no
// updater; only the PID started here is ever stopped, and the count of
// Torbie/Tabby processes is checked to be back where it was.
import { spawn, execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import * as url from 'node:url'

const root = path.resolve(url.fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const args = process.argv.slice(2)
const flag = (name, fallback) => {
    const i = args.indexOf(`--${name}`)
    return i === -1 ? fallback : args[i + 1]
}
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')))
const exe = path.resolve(positional[0] ?? path.join(root, 'dist', 'win-unpacked', 'Torbie.exe'))
const timeoutMs = Number(flag('timeout', '120')) * 1000
const keepProfile = args.includes('--keep-profile')

if (!fs.existsSync(exe)) {
    console.error(`FAIL  no packaged build at ${exe} — run \`node scripts/build-windows.mjs --dir\` first`)
    process.exit(1)
}

const packagedCount = () => {
    if (process.platform !== 'win32') {
        return 0
    }
    try {
        return parseInt(execFileSync('powershell', ['-NoProfile', '-Command',
            '@(Get-Process Torbie,Tabby -ErrorAction SilentlyContinue).Count'], { encoding: 'utf8' }).trim(), 10)
    } catch {
        return -1
    }
}

const profile = fs.mkdtempSync(path.join(process.env.RUNNER_TEMP ?? os.tmpdir(), 'torbie-packaged-boot-'))
fs.writeFileSync(path.join(profile, 'config.yaml'), [
    'version: 8',
    'terminal:',
    '  profile: local:cmd',
    'hotkeys:',
    '  toggle-window: []',
    'enableWelcomeTab: false',
    'enableAutomaticUpdates: false',
    'recoverTabs: false',
    'pluginBlacklist:',
    // Must not take the MCP port from a Torbie the user is actually running.
    '  - mcp-server',
    '',
].join('\n'))

// What a packaged app would see launched from Explorer: nothing inherited that
// points at another build's plugins or profile.
const env = { ...process.env, TABBY_CONFIG_DIRECTORY: profile, TORBIE_CONFIG_DIRECTORY: profile, TABBY_DIAG: '1' }
//
// RUST_TARGET_TRIPLE too: the CI job sets it for the native builds, and
// `russh/lib/native.js` takes it as the name of its binary at *runtime*
// (`russh.x86_64-pc-windows-msvc.node`, which does not exist), so tabby-ssh —
// and tabby-electron, which requires it — failed to load on the runner only.
// No desktop launch carries it, except a Rust developer's shell, which is a
// real if narrow product bug in russh and not what this gate is asking.
for (const k of ['NODE_PATH', 'TABBY_PLUGINS', 'TORBIE_PLUGINS', 'TABBY_DEV', 'TORBIE_DEV', 'ELECTRON_RUN_AS_NODE', 'NODE_OPTIONS', 'RUST_TARGET_TRIPLE']) {
    delete env[k]
}

const before = packagedCount()
const started = Date.now()
const child = spawn(exe, [`--user-data-dir=${profile}`, '--hidden', '--enable-logging=stderr'], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
})
const log = fs.createWriteStream(path.join(profile, 'launch.log'))
child.stdout.pipe(log)
child.stderr.pipe(log)
let exited = null
child.on('exit', code => { exited = { code, afterMs: Date.now() - started } })
console.log(`started ${path.basename(exe)} pid ${child.pid}, profile ${profile}`)

function records () {
    const file = path.join(profile, 'diagnostics.log')
    if (!fs.existsSync(file)) {
        return []
    }
    return fs.readFileSync(file, 'utf8').split('\n').filter(l => l.trim()).flatMap(l => {
        try {
            return [JSON.parse(l)]
        } catch {
            return []
        }
    })
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
let verdict = null
while (!verdict) {
    const rs = records()
    const ready = rs.find(r => r.kind === 'window-ready' && r.pid === child.pid)
    const fatal = rs.find(r => ['watchdog-quit', 'bootstrap-failed', 'fatal-startup-error'].includes(r.kind)
        // tabby-core is the one plugin nothing can boot without; waiting the
        // watchdog's 60s out after it failed only delays the same verdict.
        || (r.kind === 'require-failed' && /(^|[\\/])tabby-core$/.test(r.request ?? '')))
    if (ready) {
        verdict = { ok: true, why: `window-ready after ${((ready.afterMs ?? Date.now() - started) / 1000).toFixed(1)}s` }
    } else if (fatal) {
        verdict = { ok: false, why: `${fatal.kind}: ${fatal.summary ?? fatal.message ?? JSON.stringify(fatal).slice(0, 300)}` }
    } else if (exited) {
        verdict = { ok: false, why: `process exited with code ${exited.code} after ${(exited.afterMs / 1000).toFixed(1)}s without reaching app:ready` }
    } else if (Date.now() - started > timeoutMs) {
        verdict = { ok: false, why: `no window reached app:ready in ${timeoutMs / 1000}s` }
    } else {
        await sleep(500)
    }
}

const failedRequires = records().filter(r => r.kind === 'require-failed')
for (const r of failedRequires) {
    console.log(`note  require-failed ${r.request} (${r.code}) from ${r.from} during ${r.phase}`)
}

if (!exited) {
    try {
        // By PID and its tree, never by name: a real Torbie may be running.
        execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    } catch { /* already gone */ }
    for (let i = 0; i < 20 && !exited; i++) {
        await sleep(250)
    }
}
const after = packagedCount()

console.log(`${verdict.ok ? 'ok  ' : 'FAIL'}  packaged boot: ${verdict.why}`)
if (!verdict.ok) {
    const tail = fs.existsSync(path.join(profile, 'launch.log'))
        ? fs.readFileSync(path.join(profile, 'launch.log'), 'utf8').split('\n').slice(-25).join('\n')
        : ''
    console.log(`---- launch.log (tail) ----\n${tail}`)
}
if (before >= 0 && after !== before) {
    console.log(`FAIL  Torbie/Tabby process count went from ${before} to ${after}`)
    verdict.ok = false
}
if (!keepProfile) {
    // Chromium can hold files for a moment after its process tree is gone.
    for (let i = 0; i < 10; i++) {
        try {
            fs.rmSync(profile, { recursive: true, force: true })
            break
        } catch {
            await sleep(500)
        }
    }
}
process.exit(verdict.ok ? 0 : 1)
