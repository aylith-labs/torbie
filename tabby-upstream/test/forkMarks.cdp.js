// The provenance marks actually draw, in a real window.
//
//   node scripts/dev/launch-hidden.mjs --enable links,linkifier,claude,builds &
//   node tabby-upstream/test/forkMarks.cdp.js
//
// `--enable` matters: `launch-hidden.mjs` blacklists links, claude and builds by
// default, so without it four of the six fork-added pages do not exist and every
// nav assertion below would pass by finding nothing.
//
// **The marks are CSS `::after` pseudo-elements.** They are in no `textContent`,
// no `innerText`, no accessibility tree, and `querySelector` cannot reach them —
// so a test that greps the DOM for a diamond passes on zero marks. Every check
// here reads `getComputedStyle(el, '::after')`, which is the only thing that can
// tell "drawn" from "not drawn". The reference fork learned this the hard way:
// counting its marks through UI Automation found only the switch's own
// description text, and the mark had to be checked on screen.
const { closeAll, connect } = require('./cdp')

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

const ROOT = `window.ng.getComponent(document.querySelector('app-root'))`

/** Open Settings on a page and select it, since a hidden tab never renders. */
function open (tabId, label) {
    return `
    let root = null
    for (let i = 0; i < 80 && !root; i++) {
        const el = document.querySelector('app-root')
        const cmp = el && window.ng.getComponent(el)
        if (cmp && cmp.app && cmp.app.tabs) { root = cmp; break }
        await new Promise(r => setTimeout(r, 250))
    }
    if (!root) { throw new Error('the app never finished starting') }
    const settings = window['nodeRequire']('tabby-settings')
    // Reuse one if it is already open: activeTab is a one-way binding, so
    // assigning it navigates a live tab, and stacking up settings tabs would
    // leave two pages in the DOM for every query below to read at once.
    const existing = root.app.tabs.find(t => t instanceof settings.SettingsTabComponent)
    if (existing) {
        root.app.selectTab(existing)
        existing.activeTab = ${JSON.stringify(tabId)}
    } else {
        root.app.openNewTabRaw({ type: settings.SettingsTabComponent, inputs: { activeTab: ${JSON.stringify(tabId)} } })
        const opened = root.app.tabs.find(t => t instanceof settings.SettingsTabComponent)
        if (opened) { root.app.selectTab(opened) }
    }
    let link = null
    for (let i = 0; i < 120 && !link; i++) {
        await new Promise(r => setTimeout(r, 250))
        link = [...document.querySelectorAll('.nav-link')].find(e => e.textContent.trim() === ${JSON.stringify(label)})
    }
    if (!link) { throw new Error('no ${label} item in the settings nav') }
    link.click()
    await new Promise(r => setTimeout(r, 900))
    window.__CFG = root.config
    `
}

/**
 * Which rows on one settings page are actually drawing a mark.
 *
 * Scoped to the page element, not to `settings-tab`: more than one page stays
 * in the DOM at a time, so a document-wide query reads rows from a page nobody
 * is looking at. Measured — window-settings-tab and upstream-settings-tab were
 * both present at once.
 */
const marksIn = selector => `
    const marked = []
    const host = document.querySelector(${JSON.stringify(selector)})
    if (!host) { throw new Error('page not rendered: ' + ${JSON.stringify(selector)}) }
    for (const el of host.querySelectorAll('.form-line .title')) {
        const s = getComputedStyle(el, '::after')
        if (s.content === 'none' || !s.content) { continue }
        marked.push({
            text: el.textContent.trim(),
            width: s.width,
            height: s.height,
            background: s.backgroundColor,
            borderStyle: s.borderTopStyle,
            // Proving it is drawn and not typed: nothing here is in the text.
            inText: el.textContent.includes('◆') || el.textContent.includes('◇'),
        })
    }
    return marked
`

async function main () {
    const { evaluate } = await connect()

    // ── off by default ──────────────────────────────────────────────────────
    console.log('\n── nothing is marked until asked for ──')
    const off = await evaluate(`
        ${open('upstream', 'Upstream')}
        const page = window.ng.getComponent(document.querySelector('upstream-settings-tab'))
        page.setForkMarks(false)
        page.setConfigOnlyMarks(false)
        await new Promise(r => setTimeout(r, 400))
        window.__PAGE = page
        return {
            bodyClasses: [...document.body.classList].filter(c => c.includes('mark')),
            marks: (() => { ${marksIn('upstream-settings-tab')} })().length,
            rows: [...document.querySelectorAll('settings-tab')].pop().querySelectorAll('.form-line .title').length,
        }
    `)
    check('neither body class is set', off.bodyClasses, [])
    check('and no row draws a mark', off.marks, 0)
    check('though the page has rows to draw one on', off.rows > 3, true)

    // ── the switch previews itself ──────────────────────────────────────────
    console.log('\n── switching it on marks the row you clicked ──')
    const on = await evaluate(`
        window.__PAGE.setForkMarks(true)
        await new Promise(r => setTimeout(r, 400))
        const marks = (() => { ${marksIn('upstream-settings-tab')} })()
        const own = marks.find(m => m.text.startsWith('Mark the settings this fork added'))
        return {
            bodyClasses: [...document.body.classList].filter(c => c.includes('mark')),
            own,
            accent: getComputedStyle(document.body).getPropertyValue('--theme-accent').trim(),
        }
    `)
    check('the body class appears', on.bodyClasses, ['show-fork-marks'])
    // The switch's own row carries the mark it controls, so flipping it is its
    // own demonstration — no navigation needed to see what it does.
    check('the switch row draws its own mark', !!on.own, true)
    check('at the size the stylesheet asks for', [on.own?.width, on.own?.height], ['7px', '7px'])
    check('and it is drawn, not typed into the label', on.own?.inText, false)
    note(`mark background ${on.own?.background}, --theme-accent ${on.accent || '(unset)'}`)

    // ── the Window page: exactly the rows this fork added ────────────────────
    console.log('\n── on a shared page, only our rows are marked ──')
    const window_ = await evaluate(`
        // One of the three only renders while the multi-column tab bar is on
        // and the tabs are on a side, so put the page in the state where all
        // three exist first — otherwise this asserts the wrong number and
        // passes for the wrong reason.
        window.__WAS = {
            multi: window.__CFG.store.appearance.sideTabBarMultiColumn,
            location: window.__CFG.store.appearance.tabsLocation,
        }
        window.__CFG.store.appearance.sideTabBarMultiColumn = true
        window.__CFG.store.appearance.tabsLocation = 'left'

        // Navigated by assigning activeTab rather than by clicking the nav:
        // it is a one-way binding, so it navigates a live tab deterministically
        // and does not race the click handler.
        const settings2 = window['nodeRequire']('tabby-settings')
        const root2 = ${ROOT}
        const tab = root2.app.tabs.find(t => t instanceof settings2.SettingsTabComponent)
        tab.activeTab = 'window'
        // Outside Angular's zone nothing re-renders on its own, so the view
        // would still be on the previous page when the poll below gave up.
        window.ng.applyChanges(tab)
        let host = null
        for (let i = 0; i < 60 && !host; i++) {
            await new Promise(r => setTimeout(r, 200))
            host = document.querySelector('window-settings-tab')
        }
        if (!host) { throw new Error('the Window page did not render') }
        // Two of the three rows are behind *ngIf on tabsLocation and on the
        // multi-column switch, and the config was written from outside the
        // zone — so nothing re-renders until change detection is asked for.
        // Poll for the last row to appear rather than guessing at a delay.
        const page = window.ng.getComponent(host)
        let ready = false
        for (let i = 0; i < 60 && !ready; i++) {
            window.ng.applyChanges(page)
            await new Promise(r => setTimeout(r, 200))
            ready = [...host.querySelectorAll('.form-line .title')]
                .some(el => el.textContent.trim() === 'Minimum column width')
        }
        if (!ready) { throw new Error('the side-tab-bar rows never appeared') }
        return (() => { ${marksIn('window-settings-tab')} })().map(m => m.text)
    `)
    // The count is asserted, not just membership: an over-broad selector that
    // marked everything would otherwise look like success.
    check('exactly three rows on the Window page are ours', window_.length, 3)
    check('and they are the three this fork added', window_.sort(),
        ['Accent color', 'Minimum column width', 'Multi-column tab bar'])

    await evaluate(`
        window.__CFG.store.appearance.sideTabBarMultiColumn = window.__WAS.multi
        window.__CFG.store.appearance.tabsLocation = window.__WAS.location
        await window.__CFG.save()
        return true
    `)

    // ── the hollow mark ─────────────────────────────────────────────────────
    console.log('\n── the hollow mark reads as the same family ──')
    const hollow = await evaluate(`
        window.__PAGE.setConfigOnlyMarks(true)
        await new Promise(r => setTimeout(r, 500))
        const marks = (() => { ${marksIn('window-settings-tab')} })()
        const cycle = marks.find(m => m.text.startsWith('Wrap around at the last tab'))
        const accent = marks.find(m => m.text === 'Accent color')
        return { cycle, accent, count: marks.length }
    `)
    check('the config-only row now draws one', !!hollow.cycle, true)
    // Same shape and size is the whole "one family" claim, so it is measured
    // rather than asserted in prose.
    check('the same size as the filled mark',
        [hollow.cycle?.width, hollow.cycle?.height], [hollow.accent?.width, hollow.accent?.height])
    check('but unfilled', hollow.cycle?.background, 'rgba(0, 0, 0, 0)')
    check('and outlined instead', hollow.cycle?.borderStyle, 'solid')
    check('while the filled one is still filled',
        hollow.accent?.background !== 'rgba(0, 0, 0, 0)', true)

    // ── the nav entries ─────────────────────────────────────────────────────
    console.log('\n── a page that is entirely ours is marked once, on its entry ──')
    const nav = await evaluate(`
        const out = { marked: [], unmarked: [] }
        for (const el of document.querySelectorAll('.nav-link span')) {
            const s = getComputedStyle(el, '::after')
            const text = el.textContent.trim()
            if (!text) { continue }
            if (s.content !== 'none' && s.content) { out.marked.push(text) } else { out.unmarked.push(text) }
        }
        out.marked = [...new Set(out.marked)].sort()
        out.unmarked = [...new Set(out.unmarked)].sort()
        return out
    `)
    note(`marked nav entries: ${nav.marked.join(', ')}`)
    check('the six fork-added pages are marked', nav.marked,
        ['Builds', 'Claude', 'Integrations', 'Link Tooltip', 'Resume', 'Upstream'])
    for (const page of ['Window', 'Terminal', 'Appearance', 'Color scheme', 'Hotkeys', 'Config file']) {
        check(`${page} is upstream's and is not marked`, nav.unmarked.includes(page), true)
    }

    // ── off again, without navigating ───────────────────────────────────────
    // This is the reference fork's own bug reproduced as a test: there the
    // handler read the property before the two-way binding had written it back,
    // so the mark only ever changed on the *next* navigation.
    console.log('\n── switching off takes effect where you flipped it ──')
    const backOff = await evaluate(`
        const nav = [...document.querySelectorAll('.nav-link')]
        nav.find(e => e.textContent.trim() === 'Upstream').click()
        await new Promise(r => setTimeout(r, 900))
        const page = window.ng.getComponent(document.querySelector('upstream-settings-tab'))
        page.setForkMarks(false)
        page.setConfigOnlyMarks(false)
        await new Promise(r => setTimeout(r, 400))
        return {
            bodyClasses: [...document.body.classList].filter(c => c.includes('mark')),
            marks: (() => { ${marksIn('upstream-settings-tab')} })().length,
            navMarks: [...document.querySelectorAll('.nav-link span')]
                .filter(el => { const s = getComputedStyle(el, '::after'); return s.content !== 'none' && s.content }).length,
        }
    `)
    check('the body classes go', backOff.bodyClasses, [])
    check('every row mark goes with them, with no navigation', backOff.marks, 0)
    check('and so does every nav mark', backOff.navMarks, 0)

    // ── the nav column has room for them ────────────────────────────────────
    // The settings nav is a fixed-width column with `overflow-y: auto`, and per
    // CSS that computes `overflow-x` to `auto` as well — so 13px added after the
    // longest title can produce a scrollbar or clip the mark. Cheap to check,
    // invisible to every other assertion here.
    console.log('\n── the marks fit in the nav column ──')
    const fits = await evaluate(`
        const page = window.ng.getComponent(document.querySelector('upstream-settings-tab'))
        page.setForkMarks(true)
        await new Promise(r => setTimeout(r, 500))
        const nav = document.querySelector('settings-tab .nav')
        const r = { scrollWidth: nav.scrollWidth, clientWidth: nav.clientWidth }
        page.setForkMarks(false)
        await new Promise(r2 => setTimeout(r2, 300))
        return r
    `)
    note(`nav ${fits.scrollWidth} / ${fits.clientWidth}`)
    check('the nav does not scroll sideways with marks on',
        fits.scrollWidth <= fits.clientWidth, true)

    // Leave the profile as it was found.
    await evaluate(`
        window.__CFG.store.upstream.showForkMarks = false
        window.__CFG.store.upstream.showConfigOnlyMarks = false
        await window.__CFG.save()
        return true
    `)

    console.log(`\n${passed} passed, ${failed} failed`)
    process.exitCode = failed ? 1 : 0
}

main().catch(err => {
    console.error(`FAIL  ${err.stack || err}`)
    process.exitCode = 1
}).finally(closeAll)
