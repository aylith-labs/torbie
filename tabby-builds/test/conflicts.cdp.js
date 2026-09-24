// Conflict detection, end to end, in a hidden dev build.
//
//   node tabby-builds/test/conflicts.cdp.js [--hold <seconds>]
//
// Unlike the other suites in this package it starts its own instance, because
// the conditions *are* the test: a port held before the app boots, a global
// hotkey registered before the app registers it, heartbeats in a TEMP nothing
// else reads, and an "other app" the process probe attributes by its own
// executable path — a hard-linked copy of Electron with a `data` directory
// beside it, which is what makes it a portable build whose config can be read.
//
// Needs `yarn run build` + `prepackage-plugins`, and tabby-mcp-server installed
// under %APPDATA%\tabby\plugins: the real plugin is loaded, so its own failed
// bind is part of what is measured.
//
// This machine runs a Tabby with live sessions, and that sets the rules:
// - Port 3001 and Ctrl+Space are never used. The port is a free one from a high
//   range, the chord is the first free Ctrl+Alt+Shift+F-key, and the helper
//   refuses both real ones outright.
// - The instance's TEMP is scratch (`launch-hidden --temp`), so the real
//   heartbeat directory and hook spool are never read or written, and
//   CLAUDE_CONFIG_DIR points its .claude.json at scratch too.
// - Every window's isVisible() is polled once a second for the whole run. One
//   that shows stops the instance at once and fails the run.
// - Only PIDs started here are stopped, by PID, and the Tabby/Torbie count is
//   compared before and after.
// - A dev launch rewrites the tabby:// and torbie:// registrations
//   (app/lib/index.ts). Both keys are exported first and imported back after.
//
// --hold N pauses for N seconds once the Builds page shows its conflicts, with
// the debugging port printed, so contrast-audit.cdp.cjs can be pointed at it.
const fs = require('fs')
const net = require('net')
const os = require('os')
const path = require('path')
const { spawn, execFileSync } = require('child_process')
const { closeAll, connect } = require('./cdp')

const REPO = path.resolve(__dirname, '..', '..')
const ELECTRON_DIST = path.join(REPO, 'node_modules', 'electron', 'dist')
const MCP_SOURCE = path.join(process.env.APPDATA ?? '', 'tabby', 'plugins', 'node_modules', 'tabby-mcp-server')
const NETSTAT = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'NETSTAT.EXE')
/** Scratch chords, in the order they are tried. */
const CHORDS = ['F11', 'F12', 'F10', 'F9', ...Array.from({ length: 12 }, (_, i) => `F${13 + i}`)].map(key => `Ctrl+Alt+Shift+${key}`)
const REGISTRY_KEYS = ['HKCU\\Software\\Classes\\tabby', 'HKCU\\Software\\Classes\\torbie']

function arg (name) {
    const i = process.argv.indexOf(`--${name}`)
    return i === -1 ? null : process.argv[i + 1]
}

const HOLD_SECONDS = parseInt(arg('hold') ?? '0', 10) || 0

let failures = 0
function ok (message) { console.log(`ok    ${message}`) }
function fail (message) { failures++; console.error(`FAIL  ${message}`) }
function expect (condition, message, detail) {
    if (condition) {
        ok(message)
    } else {
        fail(detail === undefined ? message : `${message}\n      got ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`)
    }
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const sorted = list => JSON.stringify([...list].sort())

if (process.platform !== 'win32') {
    console.log('skip  written against the Windows dev build')
    process.exit(0)
}
for (const needed of [
    path.join(REPO, 'app', 'dist', 'main.js'),
    path.join(REPO, 'tabby-builds', 'dist', 'index.js'),
    path.join(ELECTRON_DIST, 'electron.exe'),
]) {
    if (!fs.existsSync(needed)) {
        console.log(`skip  ${needed} is missing — build first`)
        process.exit(0)
    }
}
if (!fs.existsSync(path.join(MCP_SOURCE, 'package.json'))) {
    console.log(`skip  tabby-mcp-server is not installed at ${MCP_SOURCE}`)
    process.exit(0)
}

const yaml = require(path.join(REPO, 'node_modules', 'js-yaml'))

// ── The machine ─────────────────────────────────────────────────────────────

function packagedCount () {
    try {
        return parseInt(execFileSync('powershell', [
            '-NoProfile', '-Command', '@(Get-Process Torbie,Tabby -ErrorAction SilentlyContinue).Count',
        ], { encoding: 'utf8' }).trim(), 10)
    } catch {
        return -1
    }
}

function registryCommand (key) {
    try {
        const out = execFileSync('reg', ['query', `${key}\\shell\\open\\command`, '/ve'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
        return /REG_SZ\s+(.*)$/m.exec(out)?.[1].trim() ?? null
    } catch {
        return null
    }
}

function backupRegistry (dir) {
    return REGISTRY_KEYS.map((key, i) => {
        const file = path.join(dir, `registry-${i}.reg`)
        let exported = false
        try {
            execFileSync('reg', ['export', key, file, '/y'], { stdio: 'ignore' })
            exported = true
        } catch { /* the key is not there, so restoring means removing it */ }
        return { key, file, exported, command: registryCommand(key) }
    })
}

function restoreRegistry (backups) {
    for (const backup of backups) {
        try {
            if (backup.exported) {
                execFileSync('reg', ['import', backup.file], { stdio: 'ignore' })
            } else {
                execFileSync('reg', ['delete', backup.key, '/f'], { stdio: 'ignore' })
            }
        } catch (err) {
            fail(`could not restore ${backup.key}: ${err.message}`)
        }
    }
}

function listenersOn (port) {
    const out = execFileSync(NETSTAT, ['-ano'], { encoding: 'utf8' })
    const pids = new Set()
    for (const line of out.split(/\r?\n/)) {
        const match = /^\s*TCP\s+\S+:(\d+)\s+\S+:0\s+.*?(\d+)\s*$/.exec(line)
        if (match && parseInt(match[1], 10) === port) {
            pids.add(parseInt(match[2], 10))
        }
    }
    return [...pids]
}

function bindable (port) {
    return new Promise(resolve => {
        const server = net.createServer()
        server.once('error', () => resolve(false))
        server.listen(port, () => server.close(() => resolve(true)))
    })
}

async function scratchPort () {
    for (let port = 47310; port < 47400; port++) {
        if (await bindable(port)) {
            return port
        }
    }
    throw new Error('no free scratch port in 47310-47399')
}

/** What the free-port action should land on: the first port from 3002 nothing listens on and that binds. */
async function expectedFreePort (exclude) {
    const out = execFileSync(NETSTAT, ['-ano'], { encoding: 'utf8' })
    const taken = new Set()
    for (const line of out.split(/\r?\n/)) {
        const match = /^\s*TCP\s+\S+:(\d+)\s+\S+:0\s/.exec(line)
        if (match) {
            taken.add(parseInt(match[1], 10))
        }
    }
    for (let port = 3002; port <= 3200; port++) {
        if (!taken.has(port) && !exclude.includes(port) && await bindable(port)) {
            return port
        }
    }
    return null
}

/** Hard links: a second Electron at its own path, in 200ms and no disk. */
function linkTree (from, to) {
    fs.mkdirSync(to, { recursive: true })
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
        const source = path.join(from, entry.name)
        const target = path.join(to, entry.name)
        if (entry.isDirectory()) {
            linkTree(source, target)
        } else {
            try {
                fs.linkSync(source, target)
            } catch {
                fs.copyFileSync(source, target)
            }
        }
    }
}

function chordKey (accelerator) {
    const parts = accelerator.toLowerCase().split('+')
    const key = parts.pop()
    return [...parts.map(x => x === 'control' ? 'ctrl' : x).sort(), key].join('+')
}

function writeAtomically (file, text) {
    fs.writeFileSync(`${file}.tmp`, text)
    fs.renameSync(`${file}.tmp`, file)
}

function readProfile (ctx) {
    return yaml.load(fs.readFileSync(path.join(ctx.profile, 'config.yaml'), 'utf8'))
}

// ── The helper ──────────────────────────────────────────────────────────────

async function helperStatus (ctx, predicate, timeoutMs = 20000) {
    const deadline = Date.now() + timeoutMs
    let last = null
    while (Date.now() < deadline) {
        try {
            last = JSON.parse(fs.readFileSync(path.join(ctx.helperDir, 'status.json'), 'utf8'))
        } catch { /* not written yet */ }
        if (last && predicate(last)) {
            return last
        }
        await sleep(200)
    }
    throw new Error(`the helper never reached the expected state: ${JSON.stringify(last)}`)
}

let controlSeq = 0
function commandHelper (ctx, command) {
    controlSeq++
    const seq = controlSeq
    writeAtomically(path.join(ctx.helperDir, 'control.json'), JSON.stringify({ ...command, seq }))
    return command.exit ? Promise.resolve(null) : helperStatus(ctx, status => status.seq >= seq)
}

// ── In the instance ─────────────────────────────────────────────────────────

// Null until the page has a require to ask with: the debugger attaches to the
// renderer before index.pug has set `nodeRequire`, and a question that throws
// there is not an answer about visibility.
const VISIBLE = `
    const load = window.nodeRequire || window.require
    if (typeof load !== 'function') { return null }
    const remote = load('@electron/remote')
    return remote.BrowserWindow.getAllWindows().map(w => ({ id: w.id, visible: w.isVisible() }))
`

const SETUP = `
    for (let i = 0; i < 360 && !window.__T; i++) {
        const root = document.querySelector('app-root')
        if (root && window.ng) {
            try {
                const injector = window.ng.getInjector(root)
                const core = window.nodeRequire('tabby-core')
                const config = injector.get(core.ConfigService)
                const conflicts = injector.get(window.nodeRequire('tabby-builds').BuildConflictsService)
                if (config.store && conflicts) {
                    window.__T = { injector, core, config, conflicts }
                }
            } catch { /* still booting */ }
        }
        if (!window.__T) { await new Promise(r => setTimeout(r, 250)) }
    }
    if (!window.__T) { throw new Error('the app never finished booting') }
    const bootstrap = window.__T.injector.get(window.__T.core.BOOTSTRAP_DATA)
    return {
        pid: process.pid,
        execPath: process.execPath,
        mcpStore: !!window.__T.config.store.mcp,
        mcpPort: window.__T.config.store.mcp ? window.__T.config.store.mcp.port : null,
        installed: bootstrap.installedPlugins.map(p => p.name),
        blacklist: bootstrap.config.pluginBlacklist,
    }
`

const CHECK = `
    const { conflicts } = window.__T
    const before = conflicts.announcements.length
    const toastsBefore = document.querySelectorAll('#toast-container .toast').length
    const started = performance.now()
    const report = await conflicts.check(true)
    const ms = Math.round(performance.now() - started)
    await new Promise(r => setTimeout(r, 300))
    return {
        ms,
        others: report.others.map(o => ({ executable: o.executable, name: o.name, kind: o.kind, pids: o.pids, config: !!o.config })),
        conflicts: report.conflicts.map(c => ({
            id: c.id, resource: c.resource, title: c.title, consequence: c.consequence, itemsLabel: c.itemsLabel,
            items: c.items, location: c.location, hint: c.hint, actions: c.actions.map(a => a.id),
        })),
        readers: report.claudeReaders,
        announced: conflicts.announcements.slice(before).map(a => a.id),
        toastsBefore,
        toasts: [...document.querySelectorAll('#toast-container .toast-message')].map(e => e.textContent.trim()),
    }
`

const OPEN = `
    const { injector, core } = window.__T
    const app = injector.get(core.AppService)
    const settings = window.nodeRequire('tabby-settings')
    const tab = app.tabs.find(t => t instanceof settings.SettingsTabComponent)
    if (tab) {
        tab.activeTab = 'builds'
        app.selectTab(tab)
    } else {
        app.openNewTabRaw({ type: settings.SettingsTabComponent, inputs: { activeTab: 'builds' } })
    }
    let link = null
    for (let i = 0; i < 60 && !link; i++) {
        await new Promise(r => setTimeout(r, 250))
        link = [...document.querySelectorAll('.nav-link')].find(e => e.textContent.trim() === 'Builds')
    }
    if (!link) { throw new Error('no Builds item in the settings nav') }
    link.click()
    for (let i = 0; i < 80; i++) {
        await new Promise(r => setTimeout(r, 250))
        const host = document.querySelector('builds-settings-tab')
        if (host && host.querySelector('.conflicts .finding.conflict')) { return true }
    }
    return false
`

const PAGE = `
    const host = document.querySelector('builds-settings-tab')
    const section = host && host.querySelector('.conflicts')
    if (!section) { return null }
    const text = e => e ? e.textContent.replace(/\\s+/g, ' ').trim() : null
    const rect = section.getBoundingClientRect()
    return {
        apps: [...section.querySelectorAll('.conflicts-head .kind-chip')].map(text),
        conflicts: [...section.querySelectorAll('.finding.conflict')].map(f => ({
            id: f.getAttribute('data-conflict'),
            title: text(f.querySelector('.finding-title')),
            chips: [...f.querySelectorAll('.finding-chip')].map(text),
            actions: [...f.querySelectorAll('[data-action]')].map(b => b.getAttribute('data-action')),
        })),
        // The name and the verdict are sibling spans spaced by a margin, so
        // their textContent runs together; join them as they read.
        readers: [...section.querySelectorAll('.readers .reader')]
            .map(r => [...r.querySelectorAll(':scope > span')].map(text).join(' ')),
        clear: text(section.querySelector('.conflicts-clear')),
        command: text(section.querySelector('.mcp-move .command')),
        pageOverflow: host.scrollWidth - host.clientWidth,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        html: section.innerHTML.length,
    }
`

const CLICK = (prefix, action) => `
    const { conflicts, config } = window.__T
    const host = document.querySelector('builds-settings-tab')
    const finding = [...host.querySelectorAll('.finding.conflict')]
        .find(f => f.getAttribute('data-conflict').startsWith(${JSON.stringify(prefix)}) && f.querySelector('[data-action="${action}"]'))
    if (!finding) { throw new Error('no ${action} button on a ${prefix} conflict') }
    const before = conflicts.announcements.length
    const clickedAt = Date.now()
    finding.querySelector('[data-action="${action}"]').click()
    for (let i = 0; i < 120; i++) {
        await new Promise(r => setTimeout(r, 250))
        if (!conflicts.checking && conflicts.report && conflicts.report.checkedAt >= clickedAt) { break }
    }
    await new Promise(r => setTimeout(r, 300))
    const command = host.querySelector('.mcp-move .command')
    return {
        checkedAfterClick: !!conflicts.report && conflicts.report.checkedAt >= clickedAt,
        ids: conflicts.report.conflicts.map(c => c.id),
        drawn: [...host.querySelectorAll('.finding.conflict')].map(f => f.getAttribute('data-conflict')),
        announced: conflicts.announcements.slice(before).map(a => a.id),
        mcp: { port: config.store.mcp.port, startOnBoot: config.store.mcp.startOnBoot },
        toggle: config.store.hotkeys['toggle-window'],
        move: conflicts.mcpMove,
        command: command ? command.textContent.trim() : null,
    }
`

const OPEN_HOTKEYS = `
    const { injector, core } = window.__T
    const host = document.querySelector('builds-settings-tab')
    const finding = [...host.querySelectorAll('.finding.conflict')].find(f => f.querySelector('[data-action="hotkey-settings"]'))
    if (!finding) { throw new Error('no Open Hotkeys button') }
    finding.querySelector('[data-action="hotkey-settings"]').click()
    await new Promise(r => setTimeout(r, 1000))
    const settings = window.nodeRequire('tabby-settings')
    const app = injector.get(core.AppService)
    const tabs = app.tabs.filter(t => t instanceof settings.SettingsTabComponent)
    return {
        activeTab: tabs[0] ? tabs[0].activeTab : null,
        selected: app.activeTab === tabs[0],
        settingsTabs: tabs.length,
    }
`

// The component's platform service would write the real clipboard, which is
// somebody's. The wiring is what is under test, so it is stubbed for the click.
const COPY = `
    const host = document.querySelector('builds-settings-tab')
    const component = window.ng.getComponent(host)
    const seen = []
    const real = component.platform.setClipboard
    component.platform.setClipboard = content => seen.push(content.text)
    try {
        host.querySelector('.mcp-move .command-line button').click()
    } finally {
        component.platform.setClipboard = real
    }
    return seen
`

const LISTEN = port => `
    window.__listener = window.nodeRequire('net').createServer(socket => socket.destroy())
    await new Promise((resolve, reject) => {
        window.__listener.once('error', reject)
        window.__listener.listen(${port}, resolve)
    })
    return true
`

const UNLISTEN = `
    if (window.__listener) {
        await new Promise(r => window.__listener.close(r))
        window.__listener = null
    }
    return true
`

const SET_PORT = port => `
    const { config } = window.__T
    config.store.mcp.port = ${port}
    await config.save()
    return config.store.mcp.port
`

const BIND = (spec, accelerator) => `
    const { config } = window.__T
    config.store.hotkeys['toggle-window'] = [${JSON.stringify(spec)}]
    await config.save()
    const remote = window.nodeRequire('@electron/remote')
    for (let i = 0; i < 40; i++) {
        await new Promise(r => setTimeout(r, 250))
        if (remote.globalShortcut.isRegistered(${JSON.stringify(accelerator)})) { return true }
    }
    return false
`

const TALLY = `
    const counts = {}
    for (const a of window.__T.conflicts.announcements) { counts[a.id] = (counts[a.id] || 0) + 1 }
    return counts
`

// ── The run ─────────────────────────────────────────────────────────────────

function profileConfig (ctx) {
    return yaml.dump({
        version: 8,
        terminal: {
            profile: 'local:cmd',
            frontend: 'xterm-webgl',
            cursorBlink: false,
            ligatures: false,
            minimumContrastRatio: 1,
            scrollbackLines: 500,
            fontSize: 14,
            font: 'Consolas',
        },
        appearance: { vibrancy: false, opacity: 1 },
        hotkeys: { 'toggle-window': [ctx.hotkey] },
        enableWelcomeTab: false,
        enableAutomaticUpdates: false,
        recoverTabs: false,
        mcp: { port: ctx.port, startOnBoot: true },
        builds: { searchRoots: [], autoSize: false, autoDiagnose: false, watchForNewBuilds: false },
        pluginBlacklist: ['links', 'linkifier', 'claude', 'claude-status'],
    })
}

async function launch (ctx) {
    const child = spawn(process.execPath, [
        path.join(REPO, 'scripts', 'dev', 'launch-hidden.mjs'),
        '--profile', ctx.profile,
        '--keep-profile',
        '--enable', 'builds,mcp-server',
        '--temp', ctx.temp,
    ], {
        cwd: REPO,
        env: { ...process.env, CLAUDE_CONFIG_DIR: ctx.claudeDir },
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    let err = ''
    child.stdout.on('data', chunk => { out += chunk })
    child.stderr.on('data', chunk => { err += chunk })
    const deadline = Date.now() + 30000
    while (Date.now() < deadline) {
        const line = out.split('\n').find(l => l.trim().startsWith('{'))
        if (line) {
            return { child, meta: JSON.parse(line), output: () => out + err }
        }
        if (child.exitCode !== null) {
            throw new Error(`launch-hidden exited ${child.exitCode}: ${err}`)
        }
        await sleep(200)
    }
    throw new Error('launch-hidden never reported its instance')
}

function watchVisibility (cdp, onVisible) {
    const state = { samples: 0, visible: [], stopped: false, timer: null }
    const tick = async () => {
        if (state.stopped) {
            return
        }
        try {
            const windows = await cdp.evaluate(VISIBLE)
            if (Array.isArray(windows)) {
                state.samples++
                if (windows.some(w => w.visible)) {
                    state.visible.push({ at: new Date().toISOString(), windows })
                    onVisible(windows)
                }
            }
        } catch { /* between loads, or already gone */ }
        if (!state.stopped) {
            state.timer = setTimeout(tick, 1000)
        }
    }
    void tick()
    return state
}

async function main () {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tabby-conflicts-'))
    const ctx = {
        root,
        otherDir: path.join(root, 'other'),
        helperDir: path.join(root, 'helper'),
        profile: path.join(root, 'profile'),
        temp: path.join(root, 'temp'),
        claudeDir: path.join(root, 'claude'),
    }
    ctx.otherExe = path.join(ctx.otherDir, 'electron.exe')
    ctx.otherKey = ctx.otherExe.toLowerCase()
    ctx.heartbeats = path.join(ctx.temp, 'tabby-claude-status.windows')

    const packagedBefore = packagedCount()
    const registry = backupRegistry(root)
    console.log(`      packaged Torbie/Tabby processes before: ${packagedBefore}`)
    for (const entry of registry) {
        console.log(`      registry before: ${entry.key}\\shell\\open\\command = ${entry.command}`)
    }

    let helper = null
    let launched = null
    let cdp = null
    let visibility = null
    let refresher = null

    try {
        ctx.port = await scratchPort()

        // ── The other app ──
        linkTree(ELECTRON_DIST, ctx.otherDir)
        const stub = path.join(ctx.otherDir, 'data', 'plugins', 'node_modules', 'tabby-mcp-server')
        fs.mkdirSync(stub, { recursive: true })
        fs.writeFileSync(path.join(stub, 'package.json'), JSON.stringify({ name: 'tabby-mcp-server', version: '0.0.0-stub' }))
        fs.mkdirSync(path.join(ctx.helperDir, 'profile'), { recursive: true })
        helper = spawn(ctx.otherExe, [
            `--user-data-dir=${path.join(ctx.helperDir, 'profile')}`,
            path.join(__dirname, 'conflictHelper.js'),
            '--port', String(ctx.port),
            '--accelerators', CHORDS.join(','),
            '--dir', ctx.helperDir,
            '--parent', String(process.pid),
        ], { stdio: 'ignore', windowsHide: true })
        const held = await helperStatus(ctx, status => status.listening || !!status.error)
        if (!held.listening || !held.registered) {
            throw new Error(`the helper could not hold its resources: ${JSON.stringify(held)}`)
        }
        ctx.accelerator = held.accelerator
        ctx.hotkey = held.accelerator.replaceAll('+', '-')
        ctx.chord = chordKey(held.accelerator)
        ok(`the helper (PID ${held.pid}, ${ctx.otherExe}) holds port ${ctx.port} and ${ctx.accelerator} — not 3001, not Ctrl+Space`)
        fs.writeFileSync(path.join(ctx.otherDir, 'data', 'config.yaml'), yaml.dump({
            hotkeys: { 'toggle-window': [ctx.hotkey] },
            mcp: { port: ctx.port },
            pluginBlacklist: [],
        }))

        // ── This app's profile ──
        fs.mkdirSync(path.join(ctx.profile, 'plugins', 'node_modules'), { recursive: true })
        fs.cpSync(MCP_SOURCE, path.join(ctx.profile, 'plugins', 'node_modules', 'tabby-mcp-server'), { recursive: true })
        fs.writeFileSync(path.join(ctx.profile, 'config.yaml'), profileConfig(ctx))
        const seeded = readProfile(ctx)
        if (seeded.mcp.port !== ctx.port || seeded.mcp.port === 3001) {
            throw new Error('refusing to launch: the profile does not pin the MCP port to the scratch port')
        }
        fs.mkdirSync(ctx.claudeDir, { recursive: true })
        fs.writeFileSync(path.join(ctx.claudeDir, '.claude.json'), JSON.stringify({
            mcpServers: {
                'scratch-mcp': { type: 'http', url: `http://localhost:${ctx.port}/mcp` },
                unrelated: { type: 'stdio', command: 'x' },
            },
            projects: {
                'C:/scratch/project': { mcpServers: { 'scratch-local': { type: 'http', url: `http://127.0.0.1:${ctx.port}/mcp?token=do-not-show` } } },
            },
        }))

        // ── Heartbeats, kept fresh ──
        fs.mkdirSync(ctx.heartbeats, { recursive: true })
        const planted = new Map()
        const plant = (name, content) => {
            planted.set(name, content)
            writeAtomically(path.join(ctx.heartbeats, `${name}.json`), JSON.stringify({ ...content, ts: Date.now() }))
        }
        refresher = setInterval(() => {
            for (const [name, content] of planted) {
                writeAtomically(path.join(ctx.heartbeats, `${name}.json`), JSON.stringify({ ...content, ts: Date.now() }))
            }
        }, 1000)
        plant(`${held.pid}-helper`, { id: `${held.pid}-helper`, sessions: [], pids: [] })

        // ── Launch, and watch for a window ──
        const launchedAt = Date.now()
        launched = await launch(ctx)
        cdp = await connect({ port: launched.meta.port, timeoutMs: 90000 })
        visibility = watchVisibility(cdp, windows => {
            fail(`a window became visible: ${JSON.stringify(windows)} — stopping the instance`)
            if (launched.child.exitCode === null) {
                execFileSync('taskkill', ['/PID', String(launched.meta.pid), '/T', '/F'], { stdio: 'ignore' })
            }
        })
        let firstLook = null
        for (let i = 0; i < 120 && !Array.isArray(firstLook); i++) {
            try {
                firstLook = await cdp.evaluate(VISIBLE)
            } catch { /* the page is still loading */ }
            if (!Array.isArray(firstLook)) {
                await sleep(250)
            }
        }
        expect(Array.isArray(firstLook) && !firstLook.some(w => w.visible),
            `right after launch no window is visible, ${((Date.now() - launchedAt) / 1000).toFixed(1)}s in (${JSON.stringify(firstLook)})`)

        const setup = await cdp.evaluate(SETUP)
        ok(`booted in ${((Date.now() - launchedAt) / 1000).toFixed(1)}s — renderer PID ${setup.pid}`)
        expect(setup.installed.includes('mcp-server') && setup.mcpStore && setup.mcpPort === ctx.port,
            'the real tabby-mcp-server loaded, set to the scratch port', setup)
        expect(sorted(listenersOn(ctx.port)) === sorted([held.pid]),
            'only the helper listens on the port: the plugin’s own bind failed', listenersOn(ctx.port))

        // ── 1: the first check ──
        const heldId = `mcp-held|${ctx.otherKey}|${ctx.port}`
        const hotkeyHeldId = `hotkey-held|${ctx.chord}|${ctx.otherKey}`
        const claudeId = `claude-both|${ctx.otherKey}`
        const first = await cdp.evaluate(CHECK)
        ok(`a check took ${first.ms}ms`)
        const other = first.others.find(o => o.executable === ctx.otherKey)
        expect(other && other.name === 'Electron (portable)' && other.pids.includes(held.pid) && other.config,
            'the helper is found as another app by its own executable, and its config is read', first.others)
        const realTabby = first.others.find(o => o.name === 'Tabby')
        if (realTabby) {
            ok(`the installed Tabby is listed too (${realTabby.pids.length} processes) and collides with nothing here`)
        }
        expect(sorted(first.conflicts.map(c => c.id)) === sorted([heldId, hotkeyHeldId]), 'exactly two conflicts: the port and the hotkey', first.conflicts)
        const mcp = first.conflicts.find(c => c.id === heldId)
        expect(mcp?.title === `Electron (portable, PID ${held.pid}) serves MCP on port ${ctx.port}`, 'MCP: the holder is named, with its PID', mcp?.title)
        expect(mcp?.consequence.startsWith('This app\'s MCP server did not start'), 'MCP: it says this app’s server did not start', mcp?.consequence)
        expect(JSON.stringify(mcp?.items) === JSON.stringify(['scratch-mcp · user', 'scratch-local · local, C:/scratch/project']),
            'MCP: the Claude Code entries pointing at that port are listed, from CLAUDE_CONFIG_DIR', mcp?.items)
        expect(!JSON.stringify(first).includes('do-not-show'), 'MCP: a query string in an entry is never shown')
        expect(mcp?.location === ctx.otherExe, 'MCP: the location is the other app’s executable', mcp?.location)
        const hotkey = first.conflicts.find(c => c.id === hotkeyHeldId)
        expect(hotkey?.title === `Electron (portable) likely holds ${ctx.accelerator}`, 'hotkey: the app whose config binds the chord is named as the likely holder', hotkey?.title)
        const reader = first.readers.find(r => !r.self)
        expect(reader && reader.name === 'Electron (portable)' && reader.consuming && reader.legacy && reader.pids.includes(held.pid),
            'Claude: the planted legacy heartbeat is shown as the helper reading events', first.readers)
        expect(!first.conflicts.some(c => c.resource === 'claude'), 'Claude: one app reading them is not a conflict')
        expect(sorted(first.announced) === sorted([heldId, hotkeyHeldId]), 'toasts: one for each new conflict', first.announced)
        for (const conflict of [mcp, hotkey]) {
            const message = `${conflict?.title}. Settings → Builds says what to do about it.`
            expect(first.toasts.filter(t => t === message).length === 1, `toasts: shown once on screen — "${conflict?.title}"`, first.toasts)
        }

        // ── 2: nothing new, nothing repeated ──
        const second = await cdp.evaluate(CHECK)
        expect(second.announced.length === 0, 'toasts: a second check with nothing new raises none', second.announced)
        expect(second.toasts.length <= first.toasts.length, 'toasts: and adds none to the screen', second.toasts)

        // ── 3: this app reads Claude events too ──
        plant(`${setup.pid}-self`, {
            id: `${setup.pid}-self`,
            sessions: [],
            pids: [],
            app: { exe: setup.execPath, name: 'Torbie', pid: setup.pid },
            consuming: true,
        })
        const third = await cdp.evaluate(CHECK)
        expect(third.conflicts.some(c => c.id === claudeId), 'Claude: both apps reading is a conflict', third.conflicts.map(c => c.id))
        expect(third.readers[0]?.self && third.readers[0].name === 'This app' && !third.readers[0].legacy,
            'Claude: this app is listed first, from its own heartbeat', third.readers)
        expect(JSON.stringify(third.announced) === JSON.stringify([claudeId]), 'toasts: exactly the new one', third.announced)
        const fourth = await cdp.evaluate(CHECK)
        expect(fourth.announced.length === 0, 'toasts: and it is not raised again', fourth.announced)

        // ── 4: the Builds page ──
        expect(await cdp.evaluate(OPEN), 'the Builds page opens with its conflict section')
        const page = await cdp.evaluate(PAGE)
        expect(page && sorted(page.conflicts.map(c => c.id)) === sorted(third.conflicts.map(c => c.id)), 'page: every current conflict is drawn', page)
        expect(page?.apps.some(t => t.startsWith('Electron (portable)')), 'page: the helper is listed as also running', page?.apps)
        expect(page?.readers.includes('This app · reads them') && page.readers.includes('Electron (portable) · reads them'),
            'page: which apps read Claude events', page?.readers)
        const actionsOf = prefix => page?.conflicts.find(c => c.id.startsWith(prefix))?.actions
        expect(JSON.stringify(actionsOf('mcp-held')) === JSON.stringify(['mcp-use-free-port', 'mcp-stop-on-boot']), 'page: the MCP conflict offers both MCP actions', actionsOf('mcp-held'))
        expect(JSON.stringify(actionsOf('hotkey-held')) === JSON.stringify(['hotkey-clear', 'hotkey-settings']), 'page: the hotkey conflict offers both hotkey actions', actionsOf('hotkey-held'))
        expect(JSON.stringify(actionsOf('claude-both')) === '[]', 'page: the Claude conflict offers nothing to do to the other app', actionsOf('claude-both'))
        expect(page?.pageOverflow <= 0, `page: nothing overflows sideways (section ${page?.width}×${page?.height})`, page)

        if (HOLD_SECONDS) {
            console.log(`      holding ${HOLD_SECONDS}s — CDP_PORT=${launched.meta.port}`)
            await sleep(HOLD_SECONDS * 1000)
            expect(await cdp.evaluate(OPEN), 'the Builds page is back after the hold')
        }

        // ── 5: action — a free port ──
        const wanted = await expectedFreePort([ctx.port])
        const moved = await cdp.evaluate(CLICK('mcp-held', 'mcp-use-free-port'))
        expect(moved.checkedAfterClick, 'action: a check follows the click')
        expect(moved.move?.port === wanted && moved.mcp.port === wanted && wanted >= 3002,
            `action: MCP moves to ${wanted}, the first free port from 3002`, moved)
        expect(readProfile(ctx).mcp.port === wanted, 'action: the port is written to config.yaml', readProfile(ctx).mcp)
        expect(listenersOn(wanted).length === 0, `action: nothing listens on ${wanted}`)
        expect(!moved.ids.includes(heldId) && !moved.drawn.includes(heldId), 'action: the MCP conflict clears, in the report and on the page', moved)
        const command = `claude mcp add --transport http torbie-mcp http://localhost:${wanted}/mcp`
        expect(moved.command === command, 'action: the Claude Code command for the new port is shown', moved.command)
        const copied = await cdp.evaluate(COPY)
        expect(JSON.stringify(copied) === JSON.stringify([command]), 'action: Copy copies exactly that command', copied)

        // ── 6: the conflict comes back, and is toasted again ──
        await cdp.evaluate(SET_PORT(ctx.port))
        const back = await cdp.evaluate(CHECK)
        expect(JSON.stringify(back.announced) === JSON.stringify([heldId]), 'toasts: a conflict that cleared and came back is raised again', back.announced)

        // ── 7: this app holds the other app's port ──
        await commandHelper(ctx, { closePort: true })
        expect(listenersOn(ctx.port).length === 0, 'the helper let go of the port')
        await cdp.evaluate(LISTEN(ctx.port))
        expect(sorted(listenersOn(ctx.port)) === sorted([setup.pid]), 'this app’s renderer now listens on it, as the plugin’s server would')
        const blocksId = `mcp-blocks|${ctx.otherKey}|${ctx.port}`
        const blocks = await cdp.evaluate(CHECK)
        expect(blocks.conflicts.some(c => c.id === blocksId) && !blocks.conflicts.some(c => c.id === heldId),
            'MCP: now the other app is the one that cannot start', blocks.conflicts.map(c => c.id))
        expect(blocks.conflicts.find(c => c.id === blocksId)?.title === 'Electron (portable) cannot start its MCP server',
            'MCP: named, by what its config says', blocks.conflicts.find(c => c.id === blocksId))
        expect(JSON.stringify(blocks.announced) === JSON.stringify([blocksId]), 'toasts: raised for it', blocks.announced)
        const stopped = await cdp.evaluate(CLICK('mcp-blocks', 'mcp-stop-on-boot'))
        expect(stopped.mcp.startOnBoot === false && readProfile(ctx).mcp.startOnBoot === false,
            'action: MCP no longer starts here, in memory and in config.yaml', { store: stopped.mcp, disk: readProfile(ctx).mcp })
        expect(stopped.ids.includes(blocksId), 'action: the conflict stays while this app still holds the port — it reports what is true, not what was clicked', stopped.ids)
        await cdp.evaluate(UNLISTEN)

        // ── 8: the hotkey actions ──
        const hotkeys = await cdp.evaluate(OPEN_HOTKEYS)
        expect(hotkeys.activeTab === 'hotkeys' && hotkeys.selected && hotkeys.settingsTabs === 1,
            'action: Open Hotkeys shows the Hotkeys page in the settings tab already open', hotkeys)
        expect(await cdp.evaluate(OPEN), 'back on the Builds page')
        const cleared = await cdp.evaluate(CLICK('hotkey-held', 'hotkey-clear'))
        expect(Array.isArray(cleared.toggle) && cleared.toggle.length === 0, 'action: the toggle-window hotkey is cleared here', cleared.toggle)
        expect(JSON.stringify(readProfile(ctx).hotkeys['toggle-window']) === '[]', 'action: and in config.yaml', readProfile(ctx).hotkeys)
        expect(!cleared.ids.some(id => id.startsWith('hotkey-')), 'action: the hotkey conflict clears', cleared.ids)

        // ── 9: this app holds the chord ──
        await commandHelper(ctx, { unregister: true })
        expect(await cdp.evaluate(BIND(ctx.hotkey, ctx.accelerator)), `this app registered ${ctx.accelerator} once the helper let go`)
        const hotkeyBlocksId = `hotkey-blocks|${ctx.chord}|${ctx.otherKey}`
        const owning = await cdp.evaluate(CHECK)
        expect(owning.conflicts.find(c => c.id === hotkeyBlocksId)?.title === `Electron (portable) cannot use ${ctx.accelerator}`,
            'hotkey: the other app is named as the one that cannot use it', owning.conflicts.map(c => c.id))
        expect(JSON.stringify(owning.announced) === JSON.stringify([hotkeyBlocksId]), 'toasts: raised for it', owning.announced)

        // ── 10: every toast, once per appearance ──
        const tally = await cdp.evaluate(TALLY)
        const expected = { [heldId]: 2, [hotkeyHeldId]: 1, [claudeId]: 1, [blocksId]: 1, [hotkeyBlocksId]: 1 }
        expect(JSON.stringify(Object.keys(tally).sort().map(k => [k, tally[k]])) === JSON.stringify(Object.keys(expected).sort().map(k => [k, expected[k]])),
            'toasts: each conflict raised exactly once per time it appeared', tally)
    } catch (err) {
        fail(err.stack ?? String(err))
        if (launched) {
            const tail = launched.output().split('\n').slice(-15).join('\n')
            console.error(`      launch-hidden output (tail):\n${tail}`)
        }
    } finally {
        if (visibility) {
            visibility.stopped = true
            clearTimeout(visibility.timer)
        }
        if (refresher) {
            clearInterval(refresher)
        }
        closeAll()
        if (launched) {
            if (launched.child.exitCode === null) {
                try {
                    // By PID: the instance, and its tree. launch-hidden notices
                    // the exit, unregisters the port and checks the count.
                    execFileSync('taskkill', ['/PID', String(launched.meta.pid), '/T', '/F'], { stdio: 'ignore' })
                } catch { /* already gone */ }
            }
            const deadline = Date.now() + 20000
            while (launched.child.exitCode === null && Date.now() < deadline) {
                await sleep(200)
            }
            // launch-hidden exits with the instance's own code, which a forced
            // taskkill makes 1. Only 3 is its own verdict: a packaged app's
            // process count fell while it ran.
            expect(launched.child.exitCode !== null && launched.child.exitCode !== 3,
                `launch-hidden exited on its own and reports no packaged app disturbed (exit ${launched.child.exitCode})`)
        }
        if (helper) {
            if (helper.exitCode === null) {
                await commandHelper(ctx, { exit: true })
                const deadline = Date.now() + 5000
                while (helper.exitCode === null && Date.now() < deadline) {
                    await sleep(100)
                }
            }
            if (helper.exitCode === null) {
                try {
                    execFileSync('taskkill', ['/PID', String(helper.pid), '/T', '/F'], { stdio: 'ignore' })
                } catch { /* already gone */ }
            }
        }
        restoreRegistry(registry)
        for (const entry of registry) {
            const after = registryCommand(entry.key)
            console.log(`      registry after:  ${entry.key}\\shell\\open\\command = ${after}`)
            expect(after === entry.command, `${entry.key} is back to what it was`)
        }
        const packagedAfter = packagedCount()
        expect(packagedAfter >= packagedBefore, `no packaged Torbie or Tabby was disturbed (${packagedBefore} → ${packagedAfter})`)
        if (visibility) {
            expect(!visibility.visible.length, `no window was ever visible (${visibility.samples} samples, one a second)`, visibility.visible)
        }
        if (failures) {
            // The instance's launch.log and diagnostics.log are in there, and
            // a failed run is exactly when they are wanted.
            console.log(`      kept ${root} for its logs`)
        } else {
            try {
                fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
            } catch (err) {
                console.log(`      could not remove ${root}: ${err.message}`)
            }
        }
    }
    console.log(failures ? `\n${failures} failed` : '\nall passed')
    process.exitCode = failures ? 1 : 0
}

main()
