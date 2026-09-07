// The card says which rule produced it, and the button row sits on the edge
// named relative to the *link*.
//
//   node scripts/dev/launch-hidden.mjs --enable links,linkifier &
//   node tabby-links/test/attribution.cdp.js
//
// Both claims are only checkable in a real window. The placement is decided
// after the card has been measured and flipped, and it is applied with CSS
// `order` — so DOM order proves nothing and the check has to be geometric.
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

const SETUP = `
    const cmp = ${ROOT}
    const all = cmp.app.tabs.flatMap(t => t.getAllTabs ? t.getAllTabs() : [t])
    const term = all.find(t => t.frontend && t.frontend.xterm)
    if (!term) { throw new Error('no terminal tab with an xterm') }
    const parent = cmp.app.tabs.find(t => t.getAllTabs && t.getAllTabs().includes(term)) || term
    cmp.app.selectTab(parent)
    await new Promise(r => setTimeout(r, 700))
    window.ng.applyChanges(cmp)
    window.__T = { root: cmp, tab: term, xterm: term.frontend.xterm, core: term.frontend.xterm._core }
    window.__CFG = cmp.config
`

// Measure the open card: where its parts sit, and how tall it is.
const MEASURE = `
    const el = document.querySelector('link-hover-card')
    const cardEl = el.querySelector('.link-card')
    const box = cardEl.getBoundingClientRect()
    const actions = cardEl.querySelector('.actions')
    const attribution = cardEl.querySelector('.attribution')
    const body = cardEl.querySelector('link-preview-view')
    const topOf = n => n ? Math.round(n.getBoundingClientRect().top) : null
    return {
        height: Math.round(box.height),
        cardTop: Math.round(box.top),
        actionsTop: topOf(actions),
        attributionTop: topOf(attribution),
        bodyTop: topOf(body),
        attributionText: attribution ? attribution.textContent.trim() : '',
        attributionAlign: attribution ? getComputedStyle(attribution).textAlign : '',
        attributionIsLink: !!(attribution && attribution.querySelector('a')),
    }
`

// Write a line, find it, and expose the provider's links for it.
//
// The screen is cleared first, so the line lands at the *top* of the viewport
// and the card has room to open below it. Without that, whatever a previous
// section left on screen decides whether the card flips — and the two
// placement sections below need opposite answers to that question.
function linksFor (text, marker) {
    return `
    {
        const { xterm, core } = window.__T
        xterm.clear()
        await new Promise(r => setTimeout(r, 200))
        xterm.write(${JSON.stringify(text)})
        await new Promise(r => setTimeout(r, 450))
        const buffer = xterm.buffer.active
        let row = -1
        for (let i = buffer.length - 1; i >= 0; i--) {
            const line = buffer.getLine(i)
            if (line && line.translateToString(true).includes(${JSON.stringify(marker)})) { row = i; break }
        }
        if (row === -1) { throw new Error('written text not found in the buffer') }
        const ours = core._linkProviderService.linkProviders[1]
        window.__T.row = row
        window.__T.links = await new Promise(resolve => ours.provideLinks(row + 1, resolve))
    }
    `
}

// Re-hover from scratch. The card is keyed on (text, range) and is deliberately
// never rebuilt while it is open, so a setting changed underneath it does
// nothing until the pointer has left and come back.
function rehover (marker) {
    return `
    {
        const link = window.__T.links.find(l => l.text.includes(${JSON.stringify(marker)}))
        if (!link) { throw new Error('link not found: ' + ${JSON.stringify(marker)}) }
        if (link.leave) { link.leave() }
        window.dispatchEvent(new Event('blur'))
        await new Promise(r => setTimeout(r, 700))
        link.hover()
        await new Promise(r => setTimeout(r, 900))
    }
    `
}

async function main () {
    const { evaluate } = await connect()
    await evaluate(SETUP)

    console.log('\n── the attribution line is off unless asked for ──')
    const off = await evaluate(`
        window.__CFG.store.linkTooltip.showRuleAttribution = false
        window.__CFG.store.linkTooltip.actionsPlacement = 'far'
        await window.__CFG.save()
        ${linksFor('\r\nplain https://example.com/no-rule here\r\n', 'no-rule')}
        ${rehover('no-rule')}
        ${MEASURE}
    `)
    check('no attribution line by default', off.attributionText, '')
    check('and the card still renders', off.height > 0, true)

    console.log('\n── with it on, a link no rule claims says so ──')
    const noRule = await evaluate(`
        window.__CFG.store.linkTooltip.showRuleAttribution = true
        await window.__CFG.save()
        ${rehover('no-rule')}
        ${MEASURE}
    `)
    // The useful half: it is the answer to "why is this link not previewed the
    // way I set it up", which the UI otherwise gives no way to ask.
    check('an unmatched link reports that no rule matched', noRule.attributionText, 'No rule matched')
    check('the line is right-aligned, away from the pointer', noRule.attributionAlign, 'right')
    check('and it is not offered as a link, since there is nothing to open', noRule.attributionIsLink, false)

    console.log('\n── placement on a card below the link ──')
    const below = {}
    for (const placement of ['far', 'near']) {
        below[placement] = await evaluate(`
            window.__CFG.store.linkTooltip.actionsPlacement = ${JSON.stringify(placement)}
            await window.__CFG.save()
            ${rehover('no-rule')}
            ${MEASURE}
        `)
    }
    note(`far:  actions ${below.far.actionsTop} vs body ${below.far.bodyTop}`)
    note(`near: actions ${below.near.actionsTop} vs body ${below.near.bodyTop}`)
    // The link is above the card here, so the near edge is the card's top.
    check('far edge puts the buttons below the body',
        below.far.actionsTop > below.far.bodyTop, true)
    check('next to the link puts them above it',
        below.near.actionsTop < below.near.bodyTop, true)
    // The premise that makes it safe to resolve placement after measuring.
    check('the card is exactly as tall either way', below.far.height, below.near.height)

    console.log('\n── placement on a card that flipped above the link ──')
    // The whole point of naming the edge relative to the link: at the bottom of
    // the pane the card sits *above* it, so the near edge is now the bottom. A
    // setting naming a card edge would quietly mean the opposite down here.
    const above = {}
    for (const placement of ['far', 'near']) {
        above[placement] = await evaluate(`
            window.__CFG.store.linkTooltip.actionsPlacement = ${JSON.stringify(placement)}
            await window.__CFG.save()
            const { xterm } = window.__T
            xterm.write('\\r\\n'.repeat(xterm.rows) + 'tail https://example.com/bottom-edge\\r\\n')
            await new Promise(r => setTimeout(r, 500))
            const buffer = xterm.buffer.active
            let row = -1
            for (let i = buffer.length - 1; i >= 0; i--) {
                const line = buffer.getLine(i)
                if (line && line.translateToString(true).includes('bottom-edge')) { row = i; break }
            }
            if (row === -1) { throw new Error('bottom-edge line not found') }
            const core = window.__T.core
            const ours = core._linkProviderService.linkProviders[1]
            window.__T.links = await new Promise(resolve => ours.provideLinks(row + 1, resolve))
            const cell = core._renderService.dimensions.css.cell.height
            const cellTop = core.screenElement.getBoundingClientRect().top
                + (row - (buffer.viewportY || 0)) * cell
            ${rehover('bottom-edge')}
            const measured = (() => { ${MEASURE} })()
            measured.flippedAbove = measured.cardTop < Math.round(cellTop)
            return measured
        `)
    }
    note(`far:  flipped=${above.far.flippedAbove} actions ${above.far.actionsTop} vs body ${above.far.bodyTop}`)
    note(`near: flipped=${above.near.flippedAbove} actions ${above.near.actionsTop} vs body ${above.near.bodyTop}`)
    check('the card really did flip above the line', above.far.flippedAbove, true)
    // Reversed from the un-flipped case, which is the entire claim.
    check('far edge is now the card top', above.far.actionsTop < above.far.bodyTop, true)
    check('next to the link is now the card bottom', above.near.actionsTop > above.near.bodyTop, true)
    check('and the height is still identical either way', above.far.height, above.near.height)

    console.log('\n── a matched rule is named, and the name opens it ──')
    const matched = await evaluate(`
        window.__CFG.store.linkTooltip.actionsPlacement = 'far'
        // A rule that claims the link, so there is something to be named by.
        window.__CFG.store.linkTooltip.rules = [{
            name: 'Example dot com',
            enabled: true,
            match: 'link',
            pattern: 'example\\\\.com',
            preview: false,
        }]
        await window.__CFG.save()
        await new Promise(r => setTimeout(r, 400))
        ${linksFor('\r\nagain https://example.com/owned-by-rule here\r\n', 'owned-by-rule')}
        ${rehover('owned-by-rule')}
        ${MEASURE}
    `)
    check('the card names the rule that matched', matched.attributionText, 'Matched by Example dot com')
    check('and offers it as something to open', matched.attributionIsLink, true)

    const opened = await evaluate(`
        const el = document.querySelector('link-hover-card')
        el.querySelector('.attribution a').click()
        await new Promise(r => setTimeout(r, 1200))
        const cmp = ${ROOT}
        const settings = window['nodeRequire']('tabby-settings')
        const tab = cmp.app.tabs.find(t => t instanceof settings.SettingsTabComponent)
        const host = document.querySelector('link-tooltip-settings-tab')
        const page = host && window.ng.getComponent(host)
        return {
            settingsOpen: !!tab,
            activeTab: tab ? tab.activeTab : '',
            currentRuleName: page && page.currentRule ? page.currentRule.name : null,
            cardHidden: getComputedStyle(document.querySelector('link-hover-card')).display === 'none',
        }
    `)
    check('clicking it opens the settings', opened.settingsOpen, true)
    check('on the Link Tooltip page', opened.activeTab, 'link-tooltip')
    check('with that very rule open in the editor', opened.currentRuleName, 'Example dot com')
    // The card is a hover affordance; leaving it up over a window that just
    // changed underneath it would read as a bug.
    check('and the card is dismissed', opened.cardHidden, true)

    // Leave the profile as it was found.
    await evaluate(`
        window.__CFG.store.linkTooltip.showRuleAttribution = false
        window.__CFG.store.linkTooltip.actionsPlacement = 'far'
        window.__CFG.store.linkTooltip.rules = []
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
