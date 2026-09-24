// Conflicts over machine-wide resources — the MCP port, the global hotkey and
// the Claude hook spool — as pure logic: no app, no bundle, no processes.
//
// `conflicts.ts` is transpiled on the fly, the way navGroups.test.js does it,
// so this runs on a clean checkout. CI runs it on Linux, which is why every
// snapshot names its platform instead of borrowing the host's.
//
// Run with: node tabby-builds/test/conflicts.test.js
const path = require('path')
const fs = require('fs')
const Module = require('module')

const REPO = path.resolve(__dirname, '../..')

const ts = require(path.join(REPO, 'node_modules/typescript'))
Module._extensions['.ts'] = function (module, filename) {
    const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, useDefineForClassFields: false },
    }).outputText
    module._compile(js, filename)
}

const C = require(path.join(REPO, 'tabby-builds/src/conflicts.ts'))

let passed = 0
let failed = 0
function check (name, actual, expected) {
    const a = JSON.stringify(actual)
    const e = JSON.stringify(expected)
    if (a === e) {
        passed++
        console.log(`  ok   ${name}`)
    } else {
        failed++
        console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`)
    }
}
function truthy (name, value) {
    check(name, !!value, true)
}

const source = file => fs.readFileSync(path.join(REPO, file), 'utf8')

// ── What the rules are transcribed from ─────────────────────────────────────
//
// Each rule below mirrors code elsewhere in the tree. Reading that code here
// means a change there fails this suite instead of leaving a copy that
// describes an app which no longer exists.

console.log('\n── the code these rules mirror ──')
{
    const electron = source('tabby-electron/src/index.ts')
    for (const line of [
        "item = typeof item === 'string' ? [item] : item",
        'let electronKeySpec = item[0]',
        "electronKeySpec = electronKeySpec.replaceAll('Meta', 'Super')",
        "electronKeySpec = electronKeySpec.replaceAll('⌘', 'Command')",
        "electronKeySpec = electronKeySpec.replaceAll('⌥', 'Alt')",
        "electronKeySpec = electronKeySpec.replaceAll('-', '+')",
    ]) {
        truthy(`registerGlobalHotkey still converts with: ${line}`, electron.includes(line))
    }
    const app = source('app/lib/app.ts')
    truthy('shouldRegisterGlobalHotkeys still reads hacks.globalHotkey', app.includes('const hotkeyMode = this.configStore.hacks?.globalHotkey'))
    truthy('…and a set value still decides outright, inverted', app.includes('return !hotkeyMode'))
    const portable = source('app/lib/portable.ts')
    truthy('portable.ts still means "a data entry beside the executable"', portable.includes("path.join(appPath, 'data')") && portable.includes('fs.existsSync(portableData)'))
    const plugins = source('app/src/plugins.ts')
    truthy('PluginInfo.name is still the package name less its prefix', plugins.includes('packageName.substring(PLUGIN_PREFIX.length)'))
    check('so the plugin name and package name agree', `tabby-${C.MCP_PLUGIN}`, C.MCP_PACKAGE)
    const entry = source('app/src/entry.ts')
    truthy('installedPlugins is still recorded before the blacklist filters it', entry.indexOf('bootstrapData.installedPlugins = plugins') < entry.indexOf('pluginBlacklist.includes(x.name)'))
}

// ── Hotkeys ─────────────────────────────────────────────────────────────────

console.log('\n── toggle-window accelerators ──')
check('a string is one binding', C.toggleWindowAccelerators('Ctrl-Space'), ['Ctrl+Space'])
check('an array of strings', C.toggleWindowAccelerators(['Ctrl-Space', 'Alt-F12']), ['Ctrl+Space', 'Alt+F12'])
check('a sequence registers its first stroke only', C.toggleWindowAccelerators([['Ctrl-K', 'Ctrl-B']]), ['Ctrl+K'])
check('Meta becomes Super', C.toggleWindowAccelerators(['Meta-Shift-A']), ['Super+Shift+A'])
check('macOS glyphs become names', C.toggleWindowAccelerators(['⌘-⌥-T']), ['Command+Alt+T'])
check('nothing bound', C.toggleWindowAccelerators([]), [])
check('unset', C.toggleWindowAccelerators(undefined), [])
check('an entry that throws there is skipped here', C.toggleWindowAccelerators([42, null, 'Alt-F']), ['Alt+F'])
check('a non-array registers nothing, as forEach throws there', C.toggleWindowAccelerators({ a: 'Ctrl-Space' }), [])

console.log('\n── one spelling per chord ──')
check('Control and ctrl', C.canonicalAccelerator('Control+Space', 'win32'), C.canonicalAccelerator('ctrl+space', 'win32'))
check('modifier order does not matter', C.canonicalAccelerator('Shift+Ctrl+A', 'win32'), C.canonicalAccelerator('Ctrl+Shift+A', 'win32'))
check('CommandOrControl is Ctrl on Windows', C.canonicalAccelerator('CommandOrControl+Space', 'win32'), 'ctrl+space')
check('…and Command on macOS', C.canonicalAccelerator('CmdOrCtrl+Space', 'darwin'), 'command+space')
check('different keys differ', C.canonicalAccelerator('Ctrl+Space', 'win32') === C.canonicalAccelerator('Ctrl+Enter', 'win32'), false)

// ── Sockets ─────────────────────────────────────────────────────────────────

// Shaped exactly like `netstat -ano` on the machine this was written on,
// including the dual-stack listener that shows up once per family, a client
// inside WSL, and a German state column.
const NETSTAT = [
    '',
    'Active Connections',
    '',
    '  Proto  Local Address          Foreign Address        State           PID',
    '  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       2496',
    '  TCP    0.0.0.0:3001           0.0.0.0:0              LISTENING       5716',
    '  TCP    172.22.144.1:3001      172.22.156.9:32988     ESTABLISHED     5716',
    '  TCP    172.22.144.1:3001      172.22.156.9:36996     ESTABLISHED     5716',
    '  TCP    [::]:3001              [::]:0                 LISTENING       5716',
    '  TCP    [::1]:3001             [::1]:51060            ESTABLISHED     5716',
    '  TCP    [::1]:51060            [::1]:3001             ESTABLISHED     35028',
    '  TCP    127.0.0.1:3002         0.0.0.0:0              ABHÖREN         777',
    '  UDP    0.0.0.0:5353           *:*                                    2224',
    '  UDP    [::]:5353              *:*                                    2224',
].join('\r\n')

console.log('\n── netstat ──')
const sockets = C.parseNetstat(NETSTAT)
check('listening sockets, both families, any language', sockets.listening.map(x => `${x.port}/${x.pid}`), ['135/2496', '3001/5716', '3001/5716', '3002/777'])
check('connections, UDP ignored', sockets.connected.length, 4)
check('connections to a server are told apart from the client end', sockets.connected.filter(x => x.port === 3001).length, 3)

console.log('\n── free ports ──')
check('the default port is never offered, even inside the range', C.candidatePorts({ listening: [{ port: 3002, remotePort: 0, pid: 1 }], connected: [] }, 2999, 3004), [2999, 3000, 3003, 3004])
check('the search starts at 3002', C.candidatePorts(null).slice(0, 2), [3002, 3003])
check('and 3001 is nowhere in it', C.candidatePorts(null).includes(3001), false)
check('the Claude Code command', C.claudeAddCommand(3002), 'claude mcp add --transport http torbie-mcp http://localhost:3002/mcp')

console.log('\n── Claude Code entries ──')
const CLAUDE_JSON = {
    mcpServers: {
        'tabby-mcp': { type: 'http', url: 'http://localhost:3001/mcp?token=secret' },
        'chrome-devtools': { type: 'stdio', command: 'npx' },
        mobbin: { type: 'http', url: 'https://api.mobbin.com/mcp' },
        v6: { type: 'http', url: 'http://[::1]:3001/mcp' },
        tls: { type: 'http', url: 'https://127.0.0.1/mcp' },
        wsl: { type: 'http', url: 'http://172.22.144.1:3001/mcp' },
        broken: { type: 'http', url: 'not a url' },
    },
    projects: {
        'C:/Users/u/projects/x': { mcpServers: { local1: { type: 'sse', url: 'http://127.0.0.1:3002/sse' } } },
        'C:/Users/u/projects/y': {},
    },
}
const servers = C.claudeServers(CLAUDE_JSON)
check('loopback entries only, query strings dropped', servers.map(x => `${x.name}|${x.scope}|${x.url}|${x.port}`), [
    'tabby-mcp|user|http://localhost:3001/mcp|3001',
    'v6|user|http://[::1]:3001/mcp|3001',
    'tls|user|https://127.0.0.1/mcp|443',
    'local1|local, C:/Users/u/projects/x|http://127.0.0.1:3002/sse|3002',
])
check('an address of this machine counts too — the WSL adapter, say', C.claudeServers(CLAUDE_JSON, ['172.22.144.1']).some(x => x.name === 'wsl'), true)
check('an IPv6 interface address matches its bracketed form', C.claudeServers({ mcpServers: { a: { url: 'http://[fe80::1]:3001/mcp' } } }, ['fe80::1']).length, 1)
check('nothing usable', C.claudeServers(null), [])
check('no leaked secret', JSON.stringify(servers).includes('secret'), false)

// ── Apps ────────────────────────────────────────────────────────────────────

const ENV = { LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local', APPDATA: 'C:\\Users\\u\\AppData\\Roaming' }
const identify = (exe, hasPortableData = false, platform = 'win32', env = ENV) => C.identifyApp(exe, { platform, env, hasPortableData })

console.log('\n── naming the other app ──')
{
    const tabby = identify('C:\\Users\\u\\AppData\\Local\\Programs\\Tabby\\Tabby.exe')
    check('an installed Tabby', [tabby.kind, tabby.name, tabby.configDirectory], ['installed', 'Tabby', 'C:\\Users\\u\\AppData\\Roaming\\tabby'])
    const torbie = identify('c:\\users\\u\\appdata\\local\\programs\\torbie\\TORBIE.EXE')
    check('an installed Torbie, whatever the case of the path', [torbie.kind, torbie.name, torbie.configDirectory], ['installed', 'Torbie', 'C:\\Users\\u\\AppData\\Roaming\\torbie'])
    const slot = identify('C:\\Users\\u\\Torbie\\builds\\dev\\Torbie.exe', true)
    check('a portable slot keeps its profile beside it', [slot.kind, slot.name, slot.configDirectory], ['portable', 'Torbie (portable)', 'C:\\Users\\u\\Torbie\\builds\\dev\\data'])
    const source = identify('C:\\Users\\u\\projects\\torbie\\node_modules\\electron\\dist\\electron.exe')
    check('a source build’s profile is unknown, not guessed', [source.kind, source.product, source.name, source.configDirectory], ['source', null, 'Electron (source build)', null])
    check('a PID joins the parenthesis there is', [C.appLabel(tabby, 5716), C.appLabel(slot, 812), C.appLabel(slot)], ['Tabby (PID 5716)', 'Torbie (portable, PID 812)', 'Torbie (portable)'])
    const portableElectron = identify('C:\\scratch\\other\\electron.exe', true)
    check('a data entry wins whatever the executable is called, as in portable.ts', [portableElectron.kind, portableElectron.name, portableElectron.configDirectory], ['portable', 'Electron (portable)', 'C:\\scratch\\other\\data'])
    const unpacked = identify('C:\\Users\\u\\projects\\torbie\\dist\\win-unpacked\\Torbie.exe')
    check('an unpacked build uses the default profile', [unpacked.kind, unpacked.name, unpacked.configDirectory], ['packaged', 'Torbie (unpacked)', 'C:\\Users\\u\\AppData\\Roaming\\torbie'])
    const linux = identify('/opt/Torbie/torbie', false, 'linux', {})
    check('outside Windows the profile is not claimed', [linux.product, linux.configDirectory], ['Torbie', null])
    check('the comparison key is lower-case on Windows', C.normalizeExecutable('C:\\A\\B.exe', 'win32'), 'c:\\a\\b.exe')
    check('…and left alone elsewhere', C.normalizeExecutable('/opt/Torbie/torbie', 'linux'), '/opt/Torbie/torbie')
}

console.log('\n── grouping processes ──')
{
    const groups = C.groupOtherProcesses([
        { pid: 900, executable: 'self' },
        { pid: 13108, executable: 'tabby', displayExecutable: 'Tabby.exe' },
        { pid: 5716, executable: 'tabby', displayExecutable: 'Tabby.exe' },
        { pid: 42, executable: 'electron', displayExecutable: 'electron.exe' },
    ], 'self')
    check('one entry per executable, this app excluded, PIDs in order', groups.map(x => `${x.displayExecutable}:${x.pids.join(',')}`), ['Tabby.exe:5716,13108', 'electron.exe:42'])
}

console.log('\n── another app’s settings ──')
check('no file means defaults', C.readOtherAppConfig(null, false, ['Ctrl-Space']), {
    mcpInstalled: false, pluginBlacklist: [], mcpPort: null, mcpStartOnBoot: true, toggleWindow: ['Ctrl-Space'], globalHotkeyHack: null,
})
check('what a real config sets', C.readOtherAppConfig({
    mcp: { port: '3005', startOnBoot: false },
    pluginBlacklist: ['mcp-server', 7],
    hotkeys: { 'toggle-window': [] },
    hacks: { globalHotkey: true },
}, true, ['Ctrl-Space']), {
    mcpInstalled: true, pluginBlacklist: ['mcp-server'], mcpPort: 3005, mcpStartOnBoot: false, toggleWindow: [], globalHotkeyHack: true,
})
check('a zero port is the plugin’s default', C.readOtherAppConfig({ mcp: { port: 0 } }, true, []).mcpPort, null)

// ── Snapshots ───────────────────────────────────────────────────────────────

const SELF = 'c:\\users\\u\\appdata\\local\\programs\\torbie\\torbie.exe'
const TABBY_DISPLAY = 'C:\\Users\\u\\AppData\\Local\\Programs\\Tabby\\Tabby.exe'
const TABBY = TABBY_DISPLAY.toLowerCase()
const NOW = 1789220000000

function tabby (raw = { hotkeys: { 'toggle-window': ['Ctrl-Space'] } }, mcpInstalled = true) {
    return {
        ...identify(TABBY_DISPLAY),
        pids: [5716, 13108],
        config: raw === null ? null : C.readOtherAppConfig(raw, mcpInstalled, ['Ctrl-Space']),
    }
}

function snapshot () {
    return {
        platform: 'win32',
        now: NOW,
        self: {
            executable: SELF,
            pids: [900, 901],
            mcp: { loaded: true, port: null, startOnBoot: true },
            hotkey: { enabled: true, accelerators: [] },
        },
        others: [tabby()],
        processes: [
            { pid: 900, executable: SELF },
            { pid: 901, executable: SELF },
            { pid: 5716, executable: TABBY, displayExecutable: TABBY_DISPLAY },
            { pid: 13108, executable: TABBY, displayExecutable: TABBY_DISPLAY },
        ],
        sockets: { listening: [], connected: [] },
        holderNames: {},
        claudeServers: [],
        heartbeats: [],
    }
}

const ids = report => report.conflicts.map(x => x.id)
const actionIds = conflict => conflict.actions.map(x => x.id)

console.log('\n── nothing else running ──')
{
    const s = snapshot()
    s.others = []
    s.sockets = C.parseNetstat(NETSTAT)
    s.self.hotkey.accelerators = [{ accelerator: 'Ctrl+Space', registered: false }]
    const report = C.computeConflicts(s)
    check('no other app, no report, whatever the snapshot holds', [report.conflicts.length, report.claudeReaders.length, report.others.length], [0, 0, 0])
}

console.log('\n── MCP: another app serves the port ──')
{
    const s = snapshot()
    s.sockets = C.parseNetstat(NETSTAT)
    s.claudeServers = C.claudeServers(CLAUDE_JSON)
    const report = C.computeConflicts(s)
    check('one conflict', ids(report), [`mcp-held|${TABBY}|3001`])
    const [c] = report.conflicts
    check('it names the app and the listening PID', c.title, 'Tabby (PID 5716) serves MCP on port 3001')
    check('it says this app’s server did not start, and where the sessions go', c.consequence, 'This app\'s MCP server did not start, so Claude Code sessions pointed at port 3001 reach Tabby, not this app.')
    check('the Claude Code entries on that port', [c.itemsLabel, c.items], ['Claude Code entries on port 3001', ['tabby-mcp · user', 'v6 · user']])
    check('how many clients are connected to it now', c.hint, '3 client connections are open to it now.')
    check('where it is', c.location, TABBY_DISPLAY)
    check('both actions, both for this app', actionIds(c), ['mcp-use-free-port', 'mcp-stop-on-boot'])

    s.claudeServers = []
    check('no entry says so', C.computeConflicts(s).conflicts[0].hint, '3 client connections are open to it now. No Claude Code entry in .claude.json points at port 3001.')
    s.claudeServers = null
    truthy('an unreadable config says so', C.computeConflicts(s).conflicts[0].hint.includes('could not be read'))

    s.self.mcp.startOnBoot = false
    check('not a conflict once this app does not start MCP', ids(C.computeConflicts(s)), [])
    s.self.mcp.startOnBoot = true
    s.self.mcp.loaded = false
    check('not a conflict when the plugin is not loaded here', ids(C.computeConflicts(s)), [])
    s.self.mcp.loaded = true
    s.sockets = null
    check('nothing claimed without a socket table', ids(C.computeConflicts(s)), [])
}

console.log('\n── MCP: a port this app was moved to ──')
{
    const s = snapshot()
    s.sockets = C.parseNetstat(NETSTAT)
    s.self.mcp.port = 3005
    check('another app on 3001 is no longer this app’s business', ids(C.computeConflicts(s)), [])
    s.sockets.listening.push({ port: 3005, remotePort: 0, pid: 13108 })
    check('but one on the new port is', ids(C.computeConflicts(s)), [`mcp-held|${TABBY}|3005`])
}

console.log('\n── MCP: something that is not a Tabby holds it ──')
{
    const s = snapshot()
    s.sockets = { listening: [{ port: 3001, remotePort: 0, pid: 777 }], connected: [] }
    s.holderNames = { 777: 'node.exe' }
    const [c] = C.computeConflicts(s).conflicts
    check('named by its image', [c.id, c.title, c.location], ['mcp-held|pid:777|3001', 'node.exe (PID 777) holds port 3001', null])
    s.holderNames = {}
    check('or not at all', C.computeConflicts(s).conflicts[0].title, 'Another process (PID 777) holds port 3001')
}

console.log('\n── MCP: this app holds another app’s port ──')
{
    const base = () => {
        const s = snapshot()
        s.sockets = { listening: [{ port: 3001, remotePort: 0, pid: 901 }], connected: [] }
        return s
    }
    const s = base()
    const report = C.computeConflicts(s)
    check('Tabby, with the plugin and the default port, cannot start', ids(report), [`mcp-blocks|${TABBY}|3001`])
    check('its title', report.conflicts[0].title, 'Tabby cannot start its MCP server')
    check('its consequence', report.conflicts[0].consequence, 'This app holds port 3001, which Tabby is also set to serve MCP on, so its server fails to start while this app runs.')

    const variants = [
        ['blacklisted there', { mcp: {}, pluginBlacklist: ['mcp-server'] }, true],
        ['not started on boot there', { mcp: { startOnBoot: false } }, true],
        ['on another port there', { mcp: { port: 3005 } }, true],
        ['not installed there', {}, false],
    ]
    for (const [label, raw, installed] of variants) {
        const v = base()
        v.others = [tabby(raw, installed)]
        check(`no conflict when the plugin is ${label}`, ids(C.computeConflicts(v)), [])
    }
    const unknown = base()
    unknown.others = [tabby(null)]
    check('no conflict claimed about an app whose settings are unknown', ids(C.computeConflicts(unknown)), [])

    const moved = base()
    moved.self.mcp.port = 3002
    check('still reported after this app is moved, while it holds the old port', ids(C.computeConflicts(moved)), [`mcp-blocks|${TABBY}|3001`])
}

console.log('\n── the global hotkey ──')
{
    const s = snapshot()
    s.self.mcp.loaded = false
    s.self.hotkey.accelerators = [{ accelerator: 'Ctrl+Space', registered: false }]
    let report = C.computeConflicts(s)
    check('not registered here, and Tabby binds it', ids(report), [`hotkey-held|ctrl+space|${TABBY}`])
    check('Tabby is named as the likely holder', report.conflicts[0].title, 'Tabby likely holds Ctrl+Space')
    truthy('and it says why only "likely"', report.conflicts[0].hint.startsWith('Windows does not say which application holds a hotkey.'))
    check('with the hotkey actions', actionIds(report.conflicts[0]), ['hotkey-clear', 'hotkey-settings'])

    s.others = [tabby({ hotkeys: { 'toggle-window': ['Control-Space'] } })]
    check('the same chord spelled another way is still the same chord', ids(C.computeConflicts(s)), [`hotkey-held|ctrl+space|${TABBY}`])

    s.others = [tabby({ hotkeys: { 'toggle-window': ['Ctrl-Alt-T'] } })]
    report = C.computeConflicts(s)
    check('nobody running binds it', ids(report), ['hotkey-held|ctrl+space|unknown'])
    check('so nobody is named', report.conflicts[0].title, 'Another application holds Ctrl+Space')

    s.others = [tabby({})]
    check('a Tabby that never set it binds the default', ids(C.computeConflicts(s)), [`hotkey-held|ctrl+space|${TABBY}`])

    s.others = [tabby()]
    s.self.hotkey.accelerators = [{ accelerator: 'Ctrl+Space', registered: true }]
    report = C.computeConflicts(s)
    check('registered here, and Tabby binds it', ids(report), [`hotkey-blocks|ctrl+space|${TABBY}`])
    check('Tabby cannot use it', report.conflicts[0].title, 'Tabby cannot use Ctrl+Space')

    s.others = [tabby({ hotkeys: { 'toggle-window': ['Ctrl-Space'] }, hacks: { globalHotkey: true } })]
    check('not when Tabby does not register hotkeys at all', ids(C.computeConflicts(s)), [])

    s.others = [tabby(null)]
    check('an app with unknown settings is never named', ids(C.computeConflicts(s)), [])

    s.others = [tabby()]
    s.self.hotkey.accelerators = [{ accelerator: 'Ctrl+Space', registered: null }]
    check('nothing when registration could not be asked', ids(C.computeConflicts(s)), [])

    s.self.hotkey = { enabled: false, accelerators: [{ accelerator: 'Ctrl+Space', registered: false }] }
    check('nothing when registration is switched off here', ids(C.computeConflicts(s)), [])

    s.self.hotkey = { enabled: true, accelerators: [{ accelerator: 'Ctrl+Space', registered: false }, { accelerator: 'ctrl+space', registered: false }] }
    check('one conflict per chord', C.computeConflicts(s).conflicts.length, 1)
}

console.log('\n── Claude events ──')
{
    const legacyTabby = { file: '5716-plebdz.json', content: { id: '5716-plebdz', ts: NOW - 1000, sessions: [], pids: [] } }
    const selfReading = consuming => ({
        file: '900-aaaaaa.json',
        content: { id: '900-aaaaaa', ts: NOW - 500, sessions: [], pids: [], app: { exe: 'C:\\Users\\u\\AppData\\Local\\Programs\\Torbie\\Torbie.exe', name: 'Torbie', pid: 900 }, consuming },
    })

    const s = snapshot()
    s.self.mcp.loaded = false
    s.heartbeats = [legacyTabby]
    let report = C.computeConflicts(s)
    check('a legacy heartbeat is resolved through its PID and counts as reading', report.claudeReaders, [
        { key: TABBY, name: 'Tabby', pids: [5716], self: false, consuming: true, legacy: true },
    ])
    check('one app reading them is not a conflict', ids(report), [])

    s.heartbeats = [legacyTabby, selfReading(true)]
    report = C.computeConflicts(s)
    check('this app first, matched by executable whatever its case', report.claudeReaders.map(x => `${x.name}:${x.self}`), ['This app:true', 'Tabby:false'])
    check('both reading is a conflict', ids(report), [`claude-both|${TABBY}`])
    check('its title', report.conflicts[0].title, 'Tabby and this app both read Claude events')
    truthy('and it says why a legacy reader counts', report.conflicts[0].hint.includes('does not say whether it reads the spool'))
    check('and offers nothing to do to the other app', report.conflicts[0].actions, [])

    s.heartbeats = [legacyTabby, selfReading(false)]
    check('not when this app does not read them', ids(C.computeConflicts(s)), [])

    s.heartbeats = [selfReading(true), {
        file: '5716-x.json',
        content: { id: '5716-x', ts: NOW - 100, app: { exe: TABBY_DISPLAY, name: 'Tabby', pid: 5716 }, consuming: false },
    }]
    check('not when the other app says it does not', ids(C.computeConflicts(s)), [])

    s.heartbeats = [{ file: 'a', content: { ...legacyTabby.content, ts: NOW - 8000 } }]
    check('a heartbeat 8s old is a window that has gone', C.computeConflicts(s).claudeReaders.length, 0)
    s.heartbeats = [{ file: 'a', content: { ...legacyTabby.content, ts: NOW - 7999 } }]
    check('…and one just under is not', C.computeConflicts(s).claudeReaders.length, 1)

    s.heartbeats = [{ file: 'b', content: { id: '4242-zz', ts: NOW } }]
    check('a PID nothing accounts for is named by its PID', C.computeConflicts(s).claudeReaders.map(x => [x.key, x.name]), [['pid:4242', 'PID 4242']])

    s.heartbeats = [{ file: 'c', content: null }, { file: 'd', content: { id: 5, ts: NOW } }, { file: 'e', content: { id: 'x' } }, { file: 'f', content: 'nope' }]
    check('malformed files are ignored', C.computeConflicts(s).claudeReaders, [])

    s.heartbeats = [legacyTabby, {
        file: '13108-b.json',
        content: { id: '13108-b', ts: NOW, app: { exe: TABBY_DISPLAY, name: 'Tabby', pid: 13108 }, consuming: false },
    }]
    check('two windows of one app are one reader', C.computeConflicts(s).claudeReaders, [
        { key: TABBY, name: 'Tabby', pids: [5716, 13108], self: false, consuming: true, legacy: true },
    ])
}

console.log('\n── keys and toasts ──')
{
    const s = snapshot()
    s.sockets = C.parseNetstat(NETSTAT)
    s.self.hotkey.accelerators = [{ accelerator: 'Ctrl+Space', registered: false }]
    s.heartbeats = [
        { file: 'a', content: { id: '5716-plebdz', ts: NOW - 1000 } },
        { file: 'b', content: { id: '900-self', ts: NOW - 1000, app: { exe: SELF, pid: 900 }, consuming: true } },
    ]
    const first = C.computeConflicts(s)
    const later = C.computeConflicts({
        ...s,
        now: NOW + 30000,
        heartbeats: s.heartbeats.map(h => ({ ...h, content: { ...h.content, ts: NOW + 29000 } })),
    })
    check('three resources, three conflicts', first.conflicts.map(x => x.resource), ['mcp', 'hotkey', 'claude'])
    check('the same conflict keeps its key from one check to the next', ids(later), ids(first))
    check('a toast names the other app and where to act', C.toastMessage(first.conflicts[0]), 'Tabby (PID 5716) serves MCP on port 3001. Settings → Builds says what to do about it.')
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
