// What Settings → Startup draws from a launch's timeline: pure logic, no app,
// no bundle. `waterfall.ts` is transpiled on the fly, the way
// newBuildChoice.test.js does it, so this runs on a clean checkout.
//
// Run with: node tabby-render-timing/test/waterfall.test.js
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

const { bootEnd, buildRows, formatMs, labelFor, median, stages } =
    require(path.join(REPO, 'tabby-render-timing/src/waterfall.ts'))

let passed = 0
let failed = 0
function check (name, actual, expected) {
    const a = JSON.stringify(actual)
    const e = JSON.stringify(expected)
    if (a === e) {
        passed++
    } else {
        failed++
        console.error(`FAIL ${name}\n  expected ${e}\n  actual   ${a}`)
    }
}

const T0 = 1_000_000
const main = (t, kind, extra = {}) => ({ t: T0 + t, role: 'main', pid: 1, kind, ...extra })
const renderer = (t, kind, extra = {}) => ({ t: T0 + t, role: 'renderer', pid: 2, window: 1, kind, ...extra })

const record = {
    id: 'x',
    startedAt: T0,
    pid: 1,
    version: '1.0.0',
    execPath: 'electron.exe',
    packaged: false,
    dev: true,
    droppedEvents: 0,
    milestones: { 'app-ready': 1500, 'window-shown': 2000, 'window-ready': 4300, 'first-terminal-output': 4600 },
    events: [
        main(0, 'process-start', { phase: true }),
        main(130, 'main-start', { phase: true }),
        main(1400, 'modules-loaded', { phase: true }),
        main(1450, 'stall', { ms: 1200, detail: 'main event loop blocked 1.2s' }),
        main(1500, 'app-ready', { phase: true }),
        renderer(1560, 'navigation-start', { phase: true }),
        renderer(1860, 'renderer-start', { phase: true }),
        main(2000, 'window-shown', { detail: { window: 1 } }),
        renderer(2800, 'loading-plugins', { phase: true }),
        renderer(2900, 'plugin-loaded', { ms: 80, detail: { name: 'ssh', builtin: true } }),
        renderer(3300, 'bootstrapping-angular', { phase: true }),
        renderer(4290, 'ready', { phase: true }),
        main(4300, 'window-ready', { detail: 'first window reached app:ready' }),
        main(4300, 'window-created', { phase: true }),
        main(4301, 'window-ready', { phase: true }),
        renderer(4600, 'first-terminal-output'),
        main(60000, 'window-blur', { detail: { window: 1 } }),
        renderer(90000, 'unhandledrejection', { detail: 'Error: boom' }),
    ],
}

// ── bootEnd ─────────────────────────────────────────────────────────────────
check('boot ends at the first terminal output', bootEnd(record), 4600)
check('without output, at app:ready', bootEnd({ ...record, milestones: { 'window-ready': 4300 } }), 4300)
check('without milestones, at the last phase', bootEnd({ ...record, milestones: {} }), 4301)

// ── buildRows ───────────────────────────────────────────────────────────────
const boot = buildRows(record, { scope: 'boot', showPlugins: false })
const kinds = boot.map(x => x.kind)
check('boot scope drops what came after the boot', kinds.includes('window-blur'), false)
check('boot scope drops failures after the boot too', kinds.includes('unhandledrejection'), false)
check('plugin loads are hidden unless asked for', kinds.includes('plugin-loaded'), false)
check('a mark and a report of the same moment are one row',
    kinds.filter(x => x === 'window-ready').length, 1)

const byKind = k => boot.find(x => x.kind === k)
check('a phase lasts until the next phase in the same process',
    [byKind('main-start').start, byKind('main-start').end, byKind('main-start').duration], [130, 1400, 1270])
check('a renderer phase is not ended by a main-process phase',
    [byKind('navigation-start').end], [1860])
check('a stall is drawn back from when it was detected',
    [byKind('stall').type, byKind('stall').start, byKind('stall').end], ['stall', 250, 1450])
check('a moment has no duration', [byKind('window-shown').type, byKind('window-shown').duration], ['moment', 0])
check('the last phase in a process is a tick', byKind('ready').duration, 0)

const withPlugins = buildRows(record, { scope: 'boot', showPlugins: true })
const ssh = withPlugins.find(x => x.kind === 'plugin-loaded')
check('a timed entry spans its duration, ending when recorded', [ssh.start, ssh.end, ssh.duration, ssh.type], [2820, 2900, 80, 'timed'])
check('a plugin load is labelled with the plugin', ssh.label, 'Plugin loaded: ssh')

const all = buildRows(record, { scope: 'all', showPlugins: false })
const failure = all.find(x => x.kind === 'unhandledrejection')
check('whole-run scope keeps later events', !!all.find(x => x.kind === 'window-blur'), true)
check('a failure is its own type', failure.type, 'failure')
check('details are carried as text', failure.detail, 'Error: boom')

// ── stages ──────────────────────────────────────────────────────────────────
check('stages split the boot at the milestones', stages(record).map(x => [x.id, x.start, x.duration]), [
    ['electron', 0, 1500],
    ['window', 1500, 500],
    ['boot', 2000, 2300],
    ['terminal', 4300, 300],
])
check('a hidden launch falls back to the page having loaded',
    stages({ milestones: { 'app-ready': 1000, 'did-finish-load': 1400, 'first-contentful-paint': 9000, ready: 3000 } }).map(x => [x.id, x.duration]),
    [['electron', 1000], ['window', 400], ['boot', 1600]])
check('the terminal stage splits at the first PTY when there is one',
    stages({ milestones: { 'app-ready': 1000, 'window-shown': 1200, 'window-ready': 3000, 'tab-pty-spawned': 3100, 'first-terminal-output': 20400 } }).map(x => [x.id, x.start, x.duration]),
    [['electron', 0, 1000], ['window', 1000, 200], ['boot', 1200, 1800], ['tab', 3000, 100], ['terminal', 3100, 17300]])
check('a stage missing either end is left out', stages({ milestones: { 'app-ready': 1000 } }).map(x => x.id), ['electron'])

// ── helpers ─────────────────────────────────────────────────────────────────
check('median, odd', median([5, 1, 3]), 3)
check('median, even', median([4, 1, 3, 2]), 2.5)
check('median of nothing', median([]), undefined)
check('tab-open phases have labels', ['tab-profile-resolved', 'tab-frontend-ready', 'tab-pty-spawned', 'tab-first-output', 'pty-spawned', 'pty-first-data'].every(k => labelFor({ kind: k }) !== k), true)
check('a tab phase is drawn as a bar ending when it was recorded',
    buildRows({ ...record, events: [renderer(5000, 'tab-first-output', { ms: 700, detail: { profile: 'WSL', afterSpawnMs: 650 } })] }, { scope: 'all', showPlugins: false })
        .map(x => [x.type, x.start, x.end, x.duration]),
    [['timed', 4300, 5000, 700]])
check('formatMs under a second', formatMs(812.4), '812 ms')
check('formatMs seconds', formatMs(4312), '4.31 s')
check('formatMs long', formatMs(24076), '24.1 s')
check('formatMs missing', formatMs(undefined), '—')
check('an unknown kind is its own label', labelFor({ kind: 'something-new' }), 'something-new')
check('a slow span is named', labelFor({ kind: 'slow:tab:close' }), 'Slow: tab:close')

console.log(`${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
