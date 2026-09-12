// The settings nav's labelled sections, in a real window.
//
//   node scripts/dev/launch-hidden.mjs --enable links,linkifier,claude,builds --port 9244
//   CDP_PORT=9244 node tabby-settings/test/navGroups.cdp.js [--no-standin]
//
// Leave the launcher running while this runs, rather than passing it --keep:
// the instance lives only as long as that command does.
//
// Two halves.
//
// The first attaches to that instance and checks the nav a user actually gets:
// the order, that a label is a heading and never a page, the column, the arrow
// keys, the active state, the macOS window-control padding, and label contrast
// in both schemes.
//
// The second is the plugin-compatibility claim, and it cannot use that
// instance, because plugins are loaded at boot. It writes a stand-in Tabby
// plugin — plain CommonJS, decorators applied at runtime, five settings pages of
// which four know nothing about sections — into a scratch profile under %TEMP%,
// launches a second hidden instance on that profile through the same launcher,
// checks where the pages landed, stops that instance by its PID and deletes the
// profile. Nothing is written under %APPDATA% or anywhere in the repo.
const { spawn, execFileSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { closeAll, connect, unregisterInstance } = require('../../scripts/dev/cdp.cjs')

const REPO = path.resolve(__dirname, '../..')
const STANDIN = !process.argv.includes('--no-standin')

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
function note (t) { console.log(`       ${t}`) }

const sleep = ms => new Promise(r => setTimeout(r, ms))

const EXPECTED = [
    '# General', 'Application', 'Window', 'Hotkeys',
    '# Terminal', 'Terminal', 'Appearance', 'Color scheme', 'Shell', 'Resume',
    '# Connections', 'Profiles & connections', 'SSH', 'Vault',
    '# Links & integrations', 'Link Tooltip', 'Integrations',
    '# Claude', 'Claude',
    '# Plugins', 'Plugins',
    '# Development', 'Builds', 'Upstream',
    '# Configuration', 'Config sync', 'Config file',
]

// Where the stand-in's pages have to land. `Stand-in: terminal` asks for a
// section that exists, so it follows the pages Terminal lists. Everything else
// knows no section, or names one that does not exist, so it goes under Plugins
// after the manager: `prioritized` first, then weight 0 by title, then weight 10.
const EXPECTED_WITH_STANDIN = EXPECTED.flatMap(entry => {
    if (entry === 'Resume') { return [entry, 'Stand-in: terminal'] }
    if (entry === 'Plugins') { return [entry, 'Stand-in: prioritized', 'Stand-in: bogus', 'Stand-in: no group', 'A stand-in weighted'] }
    return [entry]
})

/**
 * Wait for the window to have booted, a second at a time: one request may not
 * outlive the driver's budget.
 *
 * Booted means the config is loaded, not merely that the app has a tab list.
 * The tab list exists first, and a Settings tab constructed before `load()`
 * finishes throws out of `readRaw()` on a store that is still undefined, which
 * is what a freshly launched instance does if it is asked too early.
 */
async function waitForBoot (evaluate) {
    for (let i = 0; i < 90; i++) {
        const up = await evaluate(`
            try {
                const cmp = window.ng.getComponent(document.querySelector('app-root'))
                if (!(cmp && cmp.app && cmp.app.tabs && cmp.config && cmp.config.store)) { return false }
                cmp.config.readRaw()
                return true
            } catch { return false }
        `)
        if (up) { return }
        await sleep(1000)
    }
    throw new Error('the window never booted')
}

/** Open Settings (or reuse the one open) and wait for its nav. */
const OPEN = `
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const root = window.ng.getComponent(document.querySelector('app-root'))
    const settings = window['nodeRequire']('tabby-settings')
    let tab = root.app.tabs.find(t => t instanceof settings.SettingsTabComponent)
    if (!tab) {
        root.app.openNewTabRaw({ type: settings.SettingsTabComponent, inputs: { activeTab: 'application' } })
        tab = root.app.tabs.find(t => t instanceof settings.SettingsTabComponent)
    }
    root.app.selectTab(tab)
    let nav = null
    for (let i = 0; i < 60 && !(nav && nav.querySelector('.nav-link')); i++) {
        await sleep(250)
        nav = document.querySelector('settings-tab > .content > .nav')
    }
    if (!nav) { throw new Error('the settings nav never rendered') }
    window.__ROOT = root
    window.__TAB = tab
    window.__NAV = nav
    return true
`

const STRUCTURE = `
    return [...__NAV.children].map(el => {
        if (el.classList.contains('nav-group-label')) { return '# ' + el.textContent.trim() }
        const link = el.querySelector(':scope > .nav-link')
        return link ? link.textContent.trim() : '? ' + el.tagName.toLowerCase() + '.' + el.className
    })
`

const CONTRAST = `
    const parse = s => {
        const p = s.slice(s.indexOf('(') + 1, s.lastIndexOf(')')).replace('/', ',').split(/[ ,]+/).filter(Boolean).map(Number)
        return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]
    }
    const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
    const lum = c => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2])
    const ratioOf = (a, b) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
    const over = (t, u) => [t[0] * t[3] + u[0] * (1 - t[3]), t[1] * t[3] + u[1] * (1 - t[3]), t[2] * t[3] + u[2] * (1 - t[3]), 1]
    const hex = c => '#' + c.slice(0, 3).map(v => Math.round(v).toString(16).padStart(2, '0')).join('')
    // The text colour over the backgrounds actually behind it, up to the first
    // opaque one. Exact only while nothing on the way dims the text and its
    // background together, so any opacity on the way is reported, not ignored.
    const measure = el => {
        const fg = parse(getComputedStyle(el).color)
        const layers = []
        const dimmed = []
        let base = null
        for (let n = el; n; n = n.parentElement) {
            const s = getComputedStyle(n)
            if (parseFloat(s.opacity) < 1) { dimmed.push(n.tagName.toLowerCase() + '@' + s.opacity) }
            const bg = parse(s.backgroundColor)
            if (bg[3] > 0 && !base) {
                layers.push(bg)
                if (bg[3] >= 0.999) { base = layers.pop() }
            }
        }
        if (!base) { base = [255, 255, 255, 1] }
        for (let i = layers.length - 1; i >= 0; i--) { base = over(layers[i], base) }
        const shown = over(fg, base)
        return { fg: hex(shown), bg: hex(base), ratio: Math.round(ratioOf(shown, base) * 100) / 100, dimmed }
    }
`

// ── the stand-in plugin ─────────────────────────────────────────────────────

const STANDIN_PACKAGE = {
    name: 'tabby-navgroup-standin',
    version: '0.0.1',
    description: 'Settings pages that know nothing about nav sections, for navGroups.cdp.js',
    author: 'tabby-settings/test/navGroups.cdp.js',
    keywords: ['tabby-plugin'],
    main: 'index.js',
}

// The shape a published Tabby plugin has: CommonJS, JIT decorators applied at
// runtime, fields assigned in the constructor after super() the way compiled
// TypeScript assigns them. `standalone` is left out, as real plugins leave it.
const STANDIN_SOURCE = `
const { NgModule, Injectable, Component } = require('@angular/core')
const { SettingsTabProvider } = require('tabby-settings')

class StandInPage {}
Component({ selector: 'standin-settings-page', template: '<h3>Stand-in page</h3>' })(StandInPage)

function page (id, title, extra) {
    const Provider = class extends SettingsTabProvider {
        constructor () {
            super(...arguments)
            this.id = id
            this.icon = 'flask'
            this.title = title
            Object.assign(this, extra)
        }

        getComponentType () { return StandInPage }
    }
    Injectable()(Provider)
    return Provider
}

const pages = [
    page('standin-nogroup', 'Stand-in: no group', {}),
    page('standin-terminal', 'Stand-in: terminal', { group: 'terminal' }),
    page('standin-bogus', 'Stand-in: bogus', { group: 'no-such-section' }),
    page('standin-prioritized', 'Stand-in: prioritized', { prioritized: true }),
    page('standin-weighted', 'A stand-in weighted', { weight: 10 }),
]

class StandInModule {}
NgModule({
    declarations: [StandInPage],
    providers: pages.map(useClass => ({ provide: SettingsTabProvider, useClass, multi: true })),
})(StandInModule)

exports.default = StandInModule
`

// launch-hidden.mjs's own seed, written here because --keep-profile makes the
// launcher leave the profile alone, which is the only way the plugin can be in
// place before the app starts. Plain cmd rather than clink, which can take a
// hidden instance down three seconds in; mcp-server and claude-status stay off
// because they grab a port and a spool directory another Tabby is using.
const SEED_CONFIG = [
    'version: 8',
    'terminal:',
    '  profile: local:cmd',
    '  frontend: xterm-webgl',
    '  cursorBlink: false',
    '  ligatures: false',
    'appearance:',
    '  vibrancy: false',
    '  opacity: 1',
    'hotkeys:',
    '  toggle-window: []',
    'enableWelcomeTab: false',
    'enableAutomaticUpdates: false',
    'recoverTabs: false',
    'pluginBlacklist:',
    '  - mcp-server',
    '  - claude-status',
    '',
].join('\n')

function tabbyCount () {
    return parseInt(execFileSync('powershell', ['-NoProfile', '-Command',
        '@(Get-Process Torbie,Tabby -ErrorAction SilentlyContinue).Count'], { encoding: 'utf8' }).trim(), 10)
}

/**
 * A debugging port for the stand-in, chosen here rather than by the launcher.
 *
 * The launcher takes the lowest free port in the range, which is the one every
 * other launch on the machine reaches for first, and a port that is free only
 * while its owner restarts is not free. So this walks down from the top, and
 * never takes the bottom of the range or the port the first half attached to.
 */
async function standinPort () {
    const { isPortFree, RANGE } = require('../../scripts/dev/cdp.cjs')
    const attached = parseInt(process.env.CDP_PORT ?? '', 10)
    for (let port = RANGE.to; port > RANGE.from; port--) {
        if (port !== attached && await isPortFree(port)) {
            return port
        }
    }
    throw new Error(`no free debugging port in ${RANGE.from + 1}-${RANGE.to} for the stand-in instance`)
}

/** Start a hidden instance on the scratch profile, through the repo's launcher. */
async function launchStandin (profile) {
    const port = await standinPort()
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [
            path.join(REPO, 'scripts/dev/launch-hidden.mjs'),
            '--enable', 'links,linkifier,claude,builds',
            '--profile', profile,
            '--port', String(port),
            '--keep-profile',
        ], { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] })
        let out = ''
        let settled = false
        const timer = setTimeout(() => {
            if (!settled) {
                settled = true
                reject(new Error('the launcher never printed its instance'))
            }
        }, 60000)
        child.stdout.on('data', chunk => {
            out += chunk
            const line = out.split('\n').find(l => l.trim().startsWith('{'))
            if (line && !settled) {
                settled = true
                clearTimeout(timer)
                resolve({ child, meta: JSON.parse(line) })
            }
        })
        child.stderr.on('data', chunk => process.stderr.write(String(chunk)))
        child.on('exit', code => {
            if (!settled) {
                settled = true
                clearTimeout(timer)
                reject(new Error(`the launcher exited ${code} before printing its instance`))
            }
        })
    })
}

/**
 * Stop the stand-in's Electron by its PID. The launcher sees it go, unregisters
 * the port, re-counts Tabby and Torbie processes and exits — with 3 if that
 * count fell, which is the one outcome this must never cause.
 */
async function stopStandin ({ child, meta }) {
    const exited = new Promise(resolve => {
        if (child.exitCode !== null) {
            resolve(child.exitCode)
            return
        }
        child.once('exit', code => resolve(code))
    })
    try {
        execFileSync('taskkill', ['/PID', String(meta.pid), '/T', '/F'], { stdio: 'ignore' })
    } catch { /* already gone */ }
    let timer
    const timeout = new Promise(resolve => { timer = setTimeout(() => resolve('timeout'), 15000) })
    const code = await Promise.race([exited, timeout])
    clearTimeout(timer)
    if (code === 'timeout') {
        try {
            execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
        } catch { /* already gone */ }
        unregisterInstance(meta.port)
    }
    return code
}

// ── the checks ──────────────────────────────────────────────────────────────

async function checkInstance (evaluate) {
    await waitForBoot(evaluate)
    await evaluate(OPEN)

    console.log('\n── the nav, top to bottom ──')
    check('sections and pages, in order', await evaluate(STRUCTURE), EXPECTED)
    const pageCount = EXPECTED.filter(x => !x.startsWith('# ')).length

    console.log('\n── a label is a heading, not a page ──')
    const labels = await evaluate(`
        return [...__NAV.querySelectorAll(':scope > .nav-group-label')].map(el => ({
            text: el.textContent.trim(),
            tag: el.tagName.toLowerCase(),
            role: el.getAttribute('role'),
            navLink: el.classList.contains('nav-link') || !!el.querySelector('.nav-link, a, button'),
            navItem: el.classList.contains('nav-item'),
            focusable: el.tabIndex >= 0 || el.hasAttribute('tabindex'),
            transform: getComputedStyle(el).textTransform,
            opacity: getComputedStyle(el).opacity,
        }))
    `)
    check('eight labels', labels.length, 8)
    check('none is, or holds, a link', labels.filter(l => l.navLink).map(l => l.text), [])
    check('none is an ngbNavItem', labels.filter(l => l.navItem).map(l => l.text), [])
    check('none is focusable', labels.filter(l => l.focusable).map(l => l.text), [])
    check('each is an li with role=presentation', [...new Set(labels.map(l => `${l.tag}/${l.role}`))], ['li/presentation'])
    check('each is drawn uppercase, at full opacity', [...new Set(labels.map(l => `${l.transform}/${l.opacity}`))], ['uppercase/1'])

    const reach = await evaluate(`
        return {
            viaSelector: document.querySelectorAll('settings-tab > .content > .nav .nav-link').length,
            items: __NAV.querySelectorAll(':scope > li.nav-item').length,
            tabs: __NAV.querySelectorAll('[role=tab]').length,
        }
    `)
    check('every page is a .nav-link under settings-tab > .content > .nav', reach.viaSelector, pageCount)
    check('and one ngbNavItem each, with role=tab', [reach.items, reach.tabs], [pageCount, pageCount])

    console.log('\n── the column ──')
    const layout = await evaluate(`
        const nav = __NAV
        nav.scrollTop = 0
        const navRect = nav.getBoundingClientRect()
        const icon = nav.querySelector('.nav-link i').getBoundingClientRect()
        const range = document.createRange()
        const labels = [...nav.querySelectorAll(':scope > .nav-group-label')].map(el => {
            range.selectNodeContents(el)
            const text = range.getBoundingClientRect()
            return {
                text: el.textContent.trim(),
                textLeft: Math.round((text.left - navRect.left) * 10) / 10,
                textRight: Math.round((navRect.right - text.right) * 10) / 10,
                height: el.getBoundingClientRect().height,
                overflows: el.scrollWidth > el.clientWidth,
            }
        })
        const s = getComputedStyle(nav.querySelector(':scope > .nav-group-label'))
        const r = {
            labels,
            iconLeft: Math.round((icon.left - navRect.left) * 10) / 10,
            width: navRect.width,
            scroll: [nav.scrollWidth, nav.clientWidth],
            vertical: [nav.scrollHeight, nav.clientHeight],
            font: [s.fontSize, s.fontWeight, s.lineHeight, s.letterSpacing],
        }
        // With the provenance marks drawn, since those add width after a title.
        const had = document.body.classList.contains('show-fork-marks')
        document.body.classList.add('show-fork-marks')
        await new Promise(res => setTimeout(res, 300))
        r.scrollWithMarks = [nav.scrollWidth, nav.clientWidth]
        if (!had) { document.body.classList.remove('show-fork-marks') }
        return r
    `)
    const tightest = layout.labels.slice().sort((a, b) => a.textRight - b.textRight)[0]
    note(`label font ${layout.font.join(' / ')}; nav ${layout.vertical.join(' / ')} tall`)
    note(`narrowest margin a label leaves on its right: ${tightest.textRight}px (${tightest.text})`)
    check('the column is still 222px', layout.width, 222)
    check('and does not scroll sideways', layout.scroll[0] <= layout.scroll[1], true)
    check('nor with fork marks drawn', layout.scrollWithMarks[0] <= layout.scrollWithMarks[1], true)
    check('no label overflows its box', layout.labels.filter(l => l.overflows).map(l => l.text), [])
    check('every label is one line', layout.labels.filter(l => l.height !== 16).map(l => `${l.text}:${l.height}`), [])
    check('every label starts where the icons do',
        layout.labels.filter(l => Math.abs(l.textLeft - layout.iconLeft) > 1).map(l => `${l.text}:${l.textLeft}`), [])

    console.log('\n── the arrow keys step over the labels ──')
    const keys = await evaluate(`
        const links = [...__NAV.querySelectorAll('.nav-link')]
        const byText = t => links.find(l => l.textContent.trim() === t)
        // ngbNav listens on the list itself, so a keydown from a focused link
        // reaches it by bubbling, exactly as a real key press does.
        const press = key => {
            document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
            const el = document.activeElement
            return el && el.classList.contains('nav-link') ? el.textContent.trim() : '(not a link: ' + (el && el.tagName) + ')'
        }
        const out = {}
        byText('Hotkeys').focus()
        out.focused = document.activeElement === byText('Hotkeys')
        out.downFromHotkeys = press('ArrowDown')
        byText('Resume').focus()
        out.downAcrossConnections = press('ArrowDown')
        byText('Claude').focus()
        out.upFromClaude = press('ArrowUp')
        out.end = press('End')
        out.downFromLast = press('ArrowDown')
        out.upFromFirst = press('ArrowUp')
        out.home = press('Home')
        document.activeElement.blur()
        return out
    `)
    check('a page link takes focus', keys.focused, true)
    check('Down from Hotkeys lands on the Terminal page, not its label', keys.downFromHotkeys, 'Terminal')
    check('Down across the Connections label', keys.downAcrossConnections, 'Profiles & connections')
    check('Up across the Claude label', keys.upFromClaude, 'Integrations')
    check('End', keys.end, 'Config file')
    check('Down from the last wraps to the first', keys.downFromLast, 'Application')
    check('Up from the first wraps to the last', keys.upFromFirst, 'Config file')
    check('Home', keys.home, 'Application')

    console.log('\n── selecting a page ──')
    const active = await evaluate(`
        const sleep = ms => new Promise(r => setTimeout(r, ms))
        const link = t => [...__NAV.querySelectorAll('.nav-link')].find(l => l.textContent.trim() === t)
        const shown = () => [...document.querySelectorAll('settings-tab .tab-pane.active settings-tab-body > *')].map(e => e.tagName.toLowerCase())
        link('SSH').click()
        await sleep(900)
        const a = {
            active: [...__NAV.querySelectorAll('.nav-link.active')].map(l => l.textContent.trim()),
            selected: link('SSH').getAttribute('aria-selected'),
            shown: shown(),
            labelsActive: __NAV.querySelectorAll('.nav-group-label.active, .nav-group-label .active').length,
        }
        __TAB.activeTab = 'integrations'
        window.ng.applyChanges(__TAB)
        await sleep(900)
        a.afterInput = [...__NAV.querySelectorAll('.nav-link.active')].map(l => l.textContent.trim())
        a.shownAfterInput = shown()
        return a
    `)
    check('a click marks exactly that link active', active.active, ['SSH'])
    check('with aria-selected', active.selected, 'true')
    // SSHSettingsTabComponent declares no selector, so Angular names it ng-component.
    check('and renders its page', active.shown, ['ng-component'])
    check('no label is ever active', active.labelsActive, 0)
    check('activeTab still navigates', [active.afterInput, active.shownAfterInput], [['Integrations'], ['integrations-settings-tab']])

    console.log('\n── macOS window-control padding ──')
    const pad = await evaluate(`
        const sleep = ms => new Promise(r => setTimeout(r, ms))
        const host = document.querySelector('settings-tab')
        __TAB.padWindowControls = true
        window.ng.applyChanges(__ROOT)
        await sleep(300)
        // The host binding is upstream's; if it did not apply, the stylesheet
        // is still what is under test, so the class is applied by hand.
        const bound = host.classList.contains('pad-window-controls')
        if (!bound) { host.classList.add('pad-window-controls') }
        await sleep(100)
        __NAV.scrollTop = 0
        const first = __NAV.firstElementChild
        const r = {
            bound,
            firstIsLabel: first.classList.contains('nav-group-label'),
            paddingTop: getComputedStyle(__NAV).paddingTop,
            firstMarginTop: getComputedStyle(first).marginTop,
            offset: Math.round(first.getBoundingClientRect().top - __NAV.getBoundingClientRect().top),
        }
        __TAB.padWindowControls = false
        window.ng.applyChanges(__ROOT)
        host.classList.remove('pad-window-controls')
        await sleep(300)
        r.offsetAfter = Math.round(first.getBoundingClientRect().top - __NAV.getBoundingClientRect().top)
        return r
    `)
    note(`the host binding applied the class itself: ${pad.bound}`)
    check('the first thing in the column is the General label', pad.firstIsLabel, true)
    check('padded, it sits 40px down with no margin of its own', [pad.paddingTop, pad.firstMarginTop, pad.offset], ['40px', '0px', 40])
    check('unpadded, 20px', pad.offsetAfter, 20)

    const was = await evaluate('return __ROOT.config.store.appearance.colorSchemeMode')
    try {
        for (const mode of ['light', 'dark']) {
            console.log(`\n── contrast, ${mode} ──`)
            const c = await evaluate(`${CONTRAST}
                __ROOT.config.store.appearance.colorSchemeMode = ${JSON.stringify(mode)}
                await __ROOT.config.save()
                await new Promise(r => setTimeout(r, 1500))
                const labels = [...__NAV.querySelectorAll(':scope > .nav-group-label')].map(el => ({ text: el.textContent.trim(), ...measure(el) }))
                const links = [...__NAV.querySelectorAll('.nav-link:not(.active) span')].map(el => measure(el))
                return {
                    labels,
                    worstLink: links.slice().sort((a, b) => a.ratio - b.ratio)[0],
                    active: measure(__NAV.querySelector('.nav-link.active span')),
                    mutedVar: getComputedStyle(__NAV).getPropertyValue('--theme-muted-fg').trim(),
                    dark: matchMedia('(prefers-color-scheme: dark)').matches,
                }
            `)
            const worst = c.labels.slice().sort((a, b) => a.ratio - b.ratio)[0]
            note(`--theme-muted-fg ${c.mutedVar || '(undefined)'}`)
            note(`labels: worst ${worst.ratio}:1, ${worst.fg} on ${worst.bg} (${worst.text})`)
            note(`page links: worst ${c.worstLink.ratio}:1, ${c.worstLink.fg} on ${c.worstLink.bg}; active ${c.active.ratio}:1`)
            check(`${mode}: the scheme actually applied`, c.dark, mode === 'dark')
            check(`${mode}: the labels take their colour from --theme-muted-fg`, c.mutedVar.length > 0, true)
            check(`${mode}: nothing between a label and the root dims it`, [...new Set(c.labels.flatMap(l => l.dimmed))], [])
            check(`${mode}: every label clears 4.5:1`, c.labels.filter(l => l.ratio < 4.5).map(l => `${l.text}:${l.ratio}`), [])
        }
    } finally {
        await evaluate(`
            __ROOT.config.store.appearance.colorSchemeMode = ${JSON.stringify(was)}
            await __ROOT.config.save()
            return true
        `)
    }
}

async function checkStandin () {
    console.log('\n── a plugin that knows nothing about sections, in an instance of its own ──')
    const profile = path.join(process.env.TEMP ?? os.tmpdir(), `tabby-navgroups-standin-${process.pid}`)
    const pluginDir = path.join(profile, 'plugins', 'node_modules', STANDIN_PACKAGE.name)
    fs.rmSync(profile, { recursive: true, force: true })
    fs.mkdirSync(pluginDir, { recursive: true })
    fs.writeFileSync(path.join(profile, 'config.yaml'), SEED_CONFIG)
    fs.writeFileSync(path.join(pluginDir, 'package.json'), JSON.stringify(STANDIN_PACKAGE, null, 2))
    fs.writeFileSync(path.join(pluginDir, 'index.js'), STANDIN_SOURCE)

    const before = tabbyCount()
    let launched = null
    let driver = null
    try {
        launched = await launchStandin(profile)
        note(`stand-in instance: pid ${launched.meta.pid}, port ${launched.meta.port}`)
        driver = await connect({ port: launched.meta.port, timeoutMs: 60000 })
        await waitForBoot(driver.evaluate)
        await driver.evaluate(OPEN)

        check('the pages landed where they belong', await driver.evaluate(STRUCTURE), EXPECTED_WITH_STANDIN)
        const standin = await driver.evaluate(`
            const sleep = ms => new Promise(r => setTimeout(r, ms))
            const p = __TAB.settingsProviders.find(x => x.id === 'standin-nogroup')
            const link = [...__NAV.querySelectorAll('.nav-link')].find(l => l.textContent.trim() === 'Stand-in: no group')
            if (link) { link.click() }
            await sleep(900)
            return {
                loaded: !!p,
                hasGroup: !!p && 'group' in p,
                active: [...__NAV.querySelectorAll('.nav-link.active')].map(l => l.textContent.trim()),
                shown: [...document.querySelectorAll('settings-tab .tab-pane.active settings-tab-body > *')].map(e => e.tagName.toLowerCase()),
            }
        `)
        const log = fs.readFileSync(path.join(profile, 'launch.log'), 'utf8')
        check('the plugin loader found it in the scratch profile', log.includes('Loading navgroup-standin'), true)
        check('its provider has no group at all, not even an undefined one', [standin.loaded, standin.hasGroup], [true, false])
        check('its entry opens its page', [standin.active, standin.shown], [['Stand-in: no group'], ['standin-settings-page']])
    } finally {
        if (driver) { driver.close() }
        if (launched) {
            const code = await stopStandin(launched)
            note(`stand-in launcher exited ${code}`)
            check('the stand-in launcher saw no Tabby or Torbie process disappear', code !== 3, true)
            if (failed) {
                try {
                    const tail = fs.readFileSync(path.join(profile, 'launch.log'), 'utf8').split('\n').slice(-25).join('\n')
                    console.log(`       last lines of the stand-in's launch.log:\n${tail}`)
                } catch { /* no log to show */ }
            }
        }
        fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
        check('the scratch profile, stand-in plugin and all, is gone', fs.existsSync(profile), false)
        check('no Tabby or Torbie process disappeared', tabbyCount() >= before, true)
    }
}

async function main () {
    const { evaluate } = await connect()
    await checkInstance(evaluate)
    if (STANDIN) {
        await checkStandin()
    }
    console.log(`\n${passed} passed, ${failed} failed`)
    process.exitCode = failed ? 1 : 0
}

main().catch(err => {
    console.error(`FAIL  ${err.stack || err}`)
    process.exitCode = 1
}).finally(closeAll)
