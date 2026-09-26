#!/usr/bin/env node
// Every button on every settings page: one line, unclipped, and inside the
// page — measured in a hidden dev build, at the window's width and at a
// narrow one.
//
//   node scripts/dev/launch-hidden.mjs --enable links,linkifier,claude,builds --port 9246 &
//   CDP_PORT=9246 node scripts/dev/button-audit.cdp.cjs [--page "Integrations,Builds"] [--widths 0,720]
//       [--inject-css before.css]
//
// What it caught: a button beside long text in a flex row shrank until its
// label broke ("Add as / rule"). `.btn` is `white-space: nowrap; flex-shrink:
// 0` in the theme now, so the failure it looks for has changed shape — a
// button that cannot wrap and cannot shrink can instead be *pushed*: past its
// card, or past the page. So three things are measured per visible `.btn`
// with text:
//
//   - lines  — its text laid out on more than one line;
//   - clip   — its content wider than its box (`.btn` is `overflow: hidden`);
//   - escape — its box past the right edge of the settings page, or of the
//              nearest ancestor that clips.
//
// The Integrations page is also opened into every integration in turn,
// because its buttons live in the detail view. Accordions are opened first; a
// collapsed group has no boxes to measure.
const { closeAll, connect } = require('./cdp.cjs')

function arg (name, fallback) {
    const i = process.argv.indexOf(`--${name}`)
    return i === -1 ? fallback : process.argv[i + 1]
}

const PAGES = arg('page') ? arg('page').split(',').map(x => x.trim().toLowerCase()) : null
const WIDTHS = arg('widths', '0,720').split(',').map(x => parseInt(x, 10))
// `--inject-css <file>` adds a stylesheet first — how the same audit is run
// against the old rule for a before-and-after without a rebuild.
const INJECT_CSS = arg('inject-css') ? require('fs').readFileSync(arg('inject-css'), 'utf8') : null

const BOOT = `
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    let root = null
    for (let i = 0; i < 80 && !root; i++) {
        const el = document.querySelector('app-root')
        const cmp = el && window.ng.getComponent(el)
        if (cmp && cmp.app && cmp.app.tabs) { root = cmp; break }
        await sleep(250)
    }
    if (!root) { throw new Error('the app never finished starting') }
    const settingsTab = () => document.querySelector('settings-tab')
    const settingsNav = () => {
        const tab = settingsTab()
        return tab ? [...tab.querySelectorAll('.nav')].find(n => !n.closest('.tab-pane')) ?? null : null
    }
    const settingsPane = () => {
        const tab = settingsTab()
        return tab ? [...tab.querySelectorAll('.tab-pane.active')].find(p => !p.parentElement.closest('.tab-pane')) ?? null : null
    }
    const navLinks = () => {
        const nav = settingsNav()
        return nav ? [...nav.querySelectorAll('.nav-link')] : []
    }
`

const OPEN_SETTINGS = `
    ${BOOT}
    const settings = window.nodeRequire('tabby-settings')
    let tab = root.app.tabs.find(t => t instanceof settings.SettingsTabComponent)
    if (!tab) {
        root.app.openNewTabRaw({ type: settings.SettingsTabComponent })
        tab = root.app.tabs.find(t => t instanceof settings.SettingsTabComponent)
    }
    root.app.selectTab(tab)
    let links = []
    for (let i = 0; i < 120 && !links.length; i++) {
        await sleep(250)
        links = navLinks()
    }
    return links.map(l => l.textContent.trim()).filter(Boolean)
`

const OPEN_PAGE = label => `
    ${BOOT}
    const link = navLinks().find(l => l.textContent.trim() === ${JSON.stringify(label)})
    if (!link) { return { error: 'no nav link' } }
    link.click()
    await sleep(1200)
    for (let i = 0; i < 24 && settingsPane() && settingsPane().querySelector('.skeleton, .skeleton-line'); i++) { await sleep(250) }
    const p = settingsPane()
    if (!p) { return { error: 'no active pane' } }
    return { inner: [...p.querySelectorAll('ul.nav-tabs .nav-link')].length }
`

const SELECT_INNER = index => `
    ${BOOT}
    const p = settingsPane()
    const a = p && [...p.querySelectorAll('ul.nav-tabs .nav-link')][${index}]
    if (!a) { return null }
    a.click()
    await sleep(900)
    return a.textContent.trim()
`

const INTEGRATIONS = `
    ${BOOT}
    const c = window.ng.getComponent(document.querySelector('integrations-settings-tab'))
    return c ? c.integrations.map(x => x.id) : []
`

const OPEN_INTEGRATION = id => `
    ${BOOT}
    const c = window.ng.getComponent(document.querySelector('integrations-settings-tab'))
    await c.select(null)
    window.ng.applyChanges(c)
    await c.select(c.integrations.find(x => x.id === ${JSON.stringify(id)}))
    window.ng.applyChanges(c)
    await sleep(500)
    return true
`

const MEASURE = surface => `
    ${BOOT}
    const p = settingsPane()
    if (!p) { return { surface: ${JSON.stringify(surface)}, error: 'no active pane' } }
    const collapsed = [...p.querySelectorAll('.accordion-button.collapsed')]
    for (const b of collapsed) { b.click() }
    if (collapsed.length) { await sleep(700) }

    const pane = p.getBoundingClientRect()
    const clipper = el => {
        for (let a = el.parentElement; a && a !== p; a = a.parentElement) {
            const s = getComputedStyle(a)
            if (s.overflowX !== 'visible') { return a }
        }
        return p
    }
    const describe = el => {
        const text = el.textContent.trim().replace(/\\s+/g, ' ').slice(0, 40)
        const where = el.closest('.form-line, .matcher-card, .credential-card, .build-card, .accordion-item, .card')
        const title = where && (where.querySelector('.title, .header, .accordion-button')?.textContent ?? '').trim().replace(/\\s+/g, ' ').slice(0, 40)
        return title ? text + '  (in: ' + title + ')' : text
    }
    let measured = 0
    const failures = []
    for (const b of p.querySelectorAll('.btn')) {
        const r = b.getBoundingClientRect()
        if (!r.width || !r.height || !b.textContent.trim()) { continue }
        if (getComputedStyle(b).visibility === 'hidden') { continue }
        measured++
        // Lines of *text*: an icon beside the label sits at its own height,
        // so element boxes are left out, and rects closer than half a line
        // apart are one line.
        const tops = []
        const walker = document.createTreeWalker(b, NodeFilter.SHOW_TEXT)
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            if (!n.textContent.trim()) { continue }
            const range = document.createRange()
            range.selectNodeContents(n)
            for (const x of range.getClientRects()) { if (x.width > 0) { tops.push(x.top) } }
        }
        const half = (parseFloat(getComputedStyle(b).lineHeight) || 20) / 2
        tops.sort((x, y) => x - y)
        const lines = tops.filter((t, i) => i === 0 || t - tops[i - 1] > half).length
        const problems = []
        if (lines > 1) { problems.push('wraps onto ' + lines + ' lines') }
        if (b.scrollWidth > b.clientWidth + 1) { problems.push('clipped by ' + (b.scrollWidth - b.clientWidth) + 'px') }
        const c = clipper(b).getBoundingClientRect()
        const right = Math.min(c.right, pane.right)
        if (r.right > right + 1) { problems.push('escapes its container by ' + Math.round(r.right - right) + 'px') }
        if (problems.length) { failures.push(describe(b) + ' — ' + problems.join(', ')) }
    }
    return { surface: ${JSON.stringify(surface)}, measured, failures }
`

async function main () {
    const cdp = await connect()
    let total = 0
    let failing = 0
    const report = []
    if (INJECT_CSS !== null) {
        await cdp.evaluate(`
            const s = document.createElement('style')
            s.id = '__button_audit_css'
            s.textContent = ${JSON.stringify(INJECT_CSS)}
            document.head.appendChild(s)
            return true
        `)
    }
    try {
        for (const width of WIDTHS) {
            if (width) {
                await cdp.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false })
            } else {
                await cdp.send('Emulation.clearDeviceMetricsOverride')
            }
            const size = await cdp.evaluate('return innerWidth + "x" + innerHeight')
            console.log(`\n══ window ${size} ══`)
            const pages = await cdp.evaluate(OPEN_SETTINGS)
            for (const page of pages) {
                if (PAGES && !PAGES.includes(page.toLowerCase())) {
                    continue
                }
                const opened = await cdp.evaluate(OPEN_PAGE(page))
                if (!opened || opened.error) {
                    report.push({ surface: page, error: opened?.error ?? 'no answer' })
                    continue
                }
                const surfaces = [[page, null]]
                for (let i = 1; i < opened.inner; i++) {
                    surfaces.push([null, i])
                }
                for (const [name, inner] of surfaces) {
                    const label = inner === null ? name : `${page} / ${await cdp.evaluate(SELECT_INNER(inner))}`
                    report.push({ width: size, ...await cdp.evaluate(MEASURE(label)) })
                }
                if (page === 'Integrations') {
                    for (const id of await cdp.evaluate(INTEGRATIONS)) {
                        await cdp.evaluate(OPEN_INTEGRATION(id))
                        report.push({ width: size, ...await cdp.evaluate(MEASURE(`Integrations / ${id}`)) })
                    }
                    await cdp.evaluate(OPEN_PAGE(page))
                }
            }
            for (const r of report.filter(x => x.width === size || !x.width)) {
                if (r.error) {
                    console.log(`  ?  ${r.surface}: ${r.error}`)
                    continue
                }
                total += r.measured
                failing += r.failures.length
                console.log(`  ${r.failures.length ? 'x' : 'ok'}  ${r.surface}: ${r.measured} buttons`)
                for (const f of r.failures) {
                    console.log(`       ${f}`)
                }
            }
            report.length = 0
        }
    } finally {
        await cdp.send('Emulation.clearDeviceMetricsOverride')
        await cdp.evaluate(`document.getElementById('__button_audit_css')?.remove(); return true`)
    }
    console.log(`\n${total} buttons measured, ${failing} failing`)
    if (failing) {
        process.exitCode = 1
    }
}

main().catch(err => {
    console.error(err)
    process.exitCode = 1
}).finally(closeAll)
