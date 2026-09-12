// The Color scheme settings page in a real window: which tab it opens on and
// the order the tabs come in, which tone each mode tab opens on and that an
// override stays on its tab, one search carried across all three tabs, the
// Pair tab's left edges, and the pairs it lists.
//
//   node scripts/dev/launch-hidden.mjs --keep &
//   node tabby-terminal/test/colorSchemePage.cdp.js [--mode light|dark]
//
// `--mode` sets `appearance.colorSchemeMode` first. The settings tab is closed
// and reopened so the page is measured as it first opens, not on whatever tab
// an earlier run left it. Nothing here clicks a pair or a scheme, which would
// change the terminal's colours.
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
function note (text) {
    console.log(`       ${text}`)
}

function arg (name, fallback) {
    const i = process.argv.indexOf(`--${name}`)
    return i === -1 ? fallback : process.argv[i + 1]
}

const MODE = arg('mode', null)

const EXPECTED_ROWS = [
    '3024', 'ayu', 'base2tone-heath', 'Belafonte', 'Material', 'OneHalf', 'Owl', 'Pencil',
    'Rose Pine', 'Rose Pine Moon',
    'Solarized', 'Solarized Dark - Patched', 'Solarized Dark Higher Contrast',
    'Tabby Default', 'TokyoNight', 'TokyoNight Storm',
    'Tomorrow', 'Tomorrow Night Blue', 'Tomorrow Night Bright', 'Tomorrow Night Eighties',
    'Violet',
]

// Scoped to the active settings pane throughout: more than one settings page
// stays in the DOM at once, and a document-wide query reads the wrong one.
const HELPERS = `
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const pane = () => document.querySelector('settings-tab > .content > .tab-content > .tab-pane.active')
    const tabLinks = () => [...pane().querySelectorAll('ul.nav-tabs .nav-link')]
    const activeTab = () => pane().querySelector('ul.nav-tabs .nav-link.active').textContent.trim()
    const selectTab = async label => {
        const link = tabLinks().find(a => a.textContent.trim() === label)
        if (!link) { throw new Error('no ' + label + ' tab') }
        link.click()
        await sleep(900)
    }
    const search = () => pane().querySelector('input[type=search]')
    const typeSearch = async text => {
        const input = search()
        input.value = text
        input.dispatchEvent(new Event('input', { bubbles: true }))
        await sleep(700)
    }
    const listed = () => {
        const pairs = pane().querySelector('color-scheme-pairs')
        if (pairs) {
            return [...pairs.querySelectorAll('.list-group-item .pair-title strong')].map(x => x.textContent.trim())
        }
        const mode = pane().querySelector('color-scheme-settings-for-mode')
        return [...mode.querySelectorAll('.body .list-group-item .scheme-identity .me-auto > span')].map(x => x.textContent.trim())
    }
    const lum = c => {
        let h = (c || '').trim().replace(/^#/, '')
        if (h.length === 3) { h = h.split('').map(x => x + x).join('') }
        if (!/^[0-9a-f]{6}$/i.test(h)) { return 0 }
        const ch = i => { const v = parseInt(h.slice(i * 2, i * 2 + 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
        return 0.2126 * ch(0) + 0.7152 * ch(1) + 0.0722 * ch(2)
    }
    const toneState = () => {
        const host = pane().querySelector('color-scheme-settings-for-mode')
        if (!host) { return null }
        const component = window.ng.getComponent(host)
        const tones = component.visibleSchemes.map(s => lum(s.background) < lum(s.foreground) ? 'dark' : 'light')
        return {
            buttons: [...host.querySelectorAll('.scheme-controls .btn-group .btn.active')].map(b => b.textContent.trim()),
            filter: component.toneFilter,
            darks: tones.filter(t => t === 'dark').length,
            lights: tones.filter(t => t === 'light').length,
        }
    }
    const clickTone = async label => {
        const host = pane().querySelector('color-scheme-settings-for-mode')
        const button = [...host.querySelectorAll('.scheme-controls .btn-group .btn')].find(b => b.textContent.trim() === label)
        if (!button) { throw new Error('no ' + label + ' tone button') }
        button.click()
        await sleep(500)
    }
`

const BOOT = `
    ${HELPERS}
    let root = null
    for (let i = 0; i < 60 && !root; i++) {
        const el = document.querySelector('app-root')
        const cmp = el && window.ng.getComponent(el)
        if (cmp && cmp.app && cmp.app.tabs) { root = cmp; break }
        await sleep(250)
    }
    if (!root) { throw new Error('the app never finished starting') }
    const settings = window.nodeRequire('tabby-settings')
    const settingsTabs = () => root.app.tabs.filter(t => t instanceof settings.SettingsTabComponent)
`

// Opening is several short evaluations, never one long one, because the
// driver gives a request 20s. Switching the scheme, closing a tab (which
// serialises its recovery token) and booting a settings page came to more than
// that in one go; and a freshly opened settings tab has been measured taking
// longer than 12s to draw its nav, so finding the link is retried from here
// rather than waited for inside a single request.
const SET_MODE = `
    ${BOOT}
    const mode = ${JSON.stringify(MODE)}
    if (mode) {
        root.config.store.appearance.colorSchemeMode = mode
        await root.config.save()
        await sleep(1000)
    }
    return { mode: root.config.store.appearance.colorSchemeMode, body: getComputedStyle(document.body).backgroundColor }
`

const CLOSE_SETTINGS = `
    ${BOOT}
    for (const tab of settingsTabs()) { void root.app.closeTab(tab) }
    for (let i = 0; i < 60 && settingsTabs().length; i++) { await sleep(250) }
    return settingsTabs().length
`

const OPEN_SETTINGS = `
    ${BOOT}
    root.app.openNewTabRaw({ type: settings.SettingsTabComponent })
    for (let i = 0; i < 20 && !settingsTabs().length; i++) { await sleep(250) }
    if (!settingsTabs().length) { return false }
    root.app.selectTab(settingsTabs()[0])
    return true
`

/** One attempt: 'waiting' until the nav has the link, then 'listed' once the Pair tab has rows. */
const NAVIGATE = `
    ${BOOT}
    const listing = () => pane() && pane().querySelector('color-scheme-pairs .list-group-item')
    const link = () => [...document.querySelectorAll('settings-tab > .content > .nav .nav-link')].find(l => l.textContent.trim() === 'Color scheme')
    for (let i = 0; i < 40 && !link(); i++) { await sleep(250) }
    if (!link()) { return 'waiting' }
    if (!link().classList.contains('active')) { link().click() }
    for (let i = 0; i < 24 && !listing(); i++) { await sleep(250) }
    await sleep(500)
    return listing() ? 'listed' : 'clicked'
`

const STRUCTURE = `
    ${HELPERS}
    const nav = pane().querySelector('ul.nav-tabs')
    const input = search()
    return {
        labels: tabLinks().map(a => a.textContent.trim()),
        active: activeTab(),
        searchBoxes: pane().querySelectorAll('input[type=search]').length,
        searchAboveTabs: Boolean(input) && input.getBoundingClientRect().bottom <= nav.getBoundingClientRect().top,
        searchOutsideEveryTab: Boolean(input) && !input.closest('color-scheme-pairs, color-scheme-settings-for-mode'),
        rows: listed(),
    }
`

const ALIGNMENT = `
    ${HELPERS}
    const rows = [...pane().querySelectorAll('color-scheme-pairs .list-group-item')]
    const measured = rows.map(row => {
        const title = row.querySelector('.pair-title strong')
        const [dark, light] = [...row.querySelectorAll('.pair-column')].map(column => ({
            label: column.querySelector('.pair-label').getBoundingClientRect().left,
            swatch: column.querySelector('.swatch') ? column.querySelector('.swatch').getBoundingClientRect().left : null,
            preview: column.querySelector('.preview').getBoundingClientRect().left,
        }))
        const box = title.getBoundingClientRect()
        return { name: title.textContent.trim(), title: box.left, width: box.width, dark, light }
    })
    // The title row this replaced, rebuilt in the first card from the same
    // global classes, so the old offset is measured rather than remembered.
    const old = document.createElement('div')
    old.className = 'd-flex align-items-center mb-2'
    old.innerHTML = '<i class="fas fa-fw"></i><div class="ms-2"></div><strong class="me-auto">x</strong>'
    rows[0].prepend(old)
    const oldTitle = old.querySelector('strong').getBoundingClientRect().left
    old.remove()
    return { measured, oldTitle }
`

const TONES = `
    ${HELPERS}
    const steps = []
    const record = what => steps.push({ what, tab: activeTab(), ...toneState() })
    await selectTab('Dark mode'); record('open Dark mode')
    await clickTone('All'); record('pick All on Dark mode')
    await selectTab('Light mode'); record('switch to Light mode')
    await clickTone('Dark'); record('pick Dark on Light mode')
    await selectTab('Dark mode'); record('back to Dark mode')
    await selectTab('Pair'); await selectTab('Light mode'); record('Pair, then Light mode')
    await selectTab('Pair')
    return steps
`

const SEARCH = `
    ${HELPERS}
    const steps = []
    const record = what => steps.push({ what, tab: activeTab(), query: search().value, listed: listed() })
    await selectTab('Pair')
    await typeSearch('solarized'); record('type "solarized" on Pair')
    await selectTab('Dark mode'); record('switch to Dark mode')
    await selectTab('Light mode'); record('switch to Light mode')
    await selectTab('Pair'); record('back to Pair')
    await typeSearch(''); record('clear it on Pair')
    await selectTab('Dark mode'); record('Dark mode, cleared')
    await selectTab('Pair')
    return steps
`

const near = (a, b) => a !== null && b !== null && Math.abs(a - b) < 0.5

/** The driver resolves an unanswered request as undefined; that is a failure, not a value. */
async function required (evaluate, expression, what) {
    const result = await evaluate(expression)
    if (result === undefined) {
        throw new Error(`${what} went unanswered`)
    }
    return result
}

async function main () {
    const { evaluate } = await connect()
    const opened = await required(evaluate, SET_MODE, 'setting the colour scheme mode')
    console.log(`\n══ ${opened.mode} ══  body ${opened.body}`)
    const stillOpen = await required(evaluate, CLOSE_SETTINGS, 'closing the settings tab')
    if (stillOpen !== 0) {
        throw new Error(`${stillOpen} settings tab(s) would not close`)
    }
    if (!await required(evaluate, OPEN_SETTINGS, 'opening a settings tab')) {
        throw new Error('the settings tab never opened')
    }
    let navigated = 'waiting'
    for (let attempt = 0; attempt < 5 && navigated !== 'listed'; attempt++) {
        navigated = await required(evaluate, NAVIGATE, 'finding the Color scheme page')
    }
    if (navigated !== 'listed') {
        throw new Error(`the Color scheme page never listed a pair (last state: ${navigated})`)
    }

    console.log('\n── the tabs, and the one search above them ──')
    const structure = await required(evaluate, STRUCTURE, 'reading the tabs')
    check('Pair comes first', structure.labels, ['Pair', 'Dark mode', 'Light mode'])
    check('and the page opens on it', structure.active, 'Pair')
    check('there is one search box on the page', structure.searchBoxes, 1)
    check('it sits above the tabs', structure.searchAboveTabs, true)
    check('and inside none of them', structure.searchOutsideEveryTab, true)
    note(`${structure.rows.length} rows on the Pair tab`)
    check('the Pair tab lists every pair and variant in the catalogue', structure.rows, EXPECTED_ROWS)

    console.log('\n── Pair tab left edges ──')
    const { measured, oldTitle } = await required(evaluate, ALIGNMENT, 'measuring the Pair tab')
    const first = measured[0]
    note(`first card "${first.name}": title ${first.title}, dark name ${first.dark.label}, dark swatches ${first.dark.swatch}, dark preview ${first.dark.preview}`)
    note(`                light name ${first.light.label}, light swatches ${first.light.swatch}, light preview ${first.light.preview}`)
    note(`the old title row, rebuilt in that card, put the title at ${oldTitle}: ${(oldTitle - first.dark.label).toFixed(1)}px right of the names`)
    check('every title has layout, so the edges below are real', measured.every(m => m.width > 0), true)
    check('every title starts where its dark scheme name starts',
        measured.filter(m => !near(m.title, m.dark.label)).map(m => m.name), [])
    check('every column\'s swatches and preview start where its name starts',
        measured.filter(m => ![m.dark, m.light].every(c => (c.swatch === null || near(c.swatch, c.label)) && near(c.preview, c.label))).map(m => m.name), [])

    console.log('\n── the tone each mode tab opens on ──')
    const tones = await required(evaluate, TONES, 'switching tabs and tones')
    for (const step of tones) {
        note(`${step.what.padEnd(26)} tab ${step.tab.padEnd(10)} filter ${step.filter.padEnd(5)} button ${step.buttons.join(',').padEnd(5)} ${step.darks} dark, ${step.lights} light`)
    }
    const [darkOpen, allPicked, lightOpen, darkPicked, darkAgain, lightAgain] = tones
    check('Dark mode opens on Dark', [darkOpen.buttons, darkOpen.filter, darkOpen.lights], [['Dark'], 'dark', 0])
    check('All is an override there', [allPicked.buttons, allPicked.darks > 0 && allPicked.lights > 0], [['All'], true])
    check('which does not follow to Light mode', [lightOpen.buttons, lightOpen.filter, lightOpen.darks], [['Light'], 'light', 0])
    check('the other tone is an override on Light mode', [darkPicked.buttons, darkPicked.lights], [['Dark'], 0])
    check('Dark mode opens on Dark again, its override not kept', [darkAgain.buttons, darkAgain.lights], [['Dark'], 0])
    check('Light mode opens on Light again', [lightAgain.buttons, lightAgain.darks], [['Light'], 0])

    console.log('\n── one search across the three tabs ──')
    const searched = await required(evaluate, SEARCH, 'searching across tabs')
    for (const step of searched) {
        const shown = step.listed.length > 6 ? `${step.listed.length} rows` : step.listed.join(', ')
        note(`${step.what.padEnd(26)} tab ${step.tab.padEnd(10)} query "${step.query}"  ${shown}`)
    }
    const [onPair, onDark, onLight, backOnPair, cleared, darkCleared] = searched
    const allMatch = step => step.listed.length > 0 && step.listed.every(name => name.toLowerCase().includes('solarized'))
    check('the query filters the Pair tab', [onPair.query, allMatch(onPair)], ['solarized', true])
    check('it is still there on Dark mode, and filters it', [onDark.query, allMatch(onDark)], ['solarized', true])
    check('and on Light mode', [onLight.query, onLight.listed], ['solarized', ['Solarized Light']])
    check('and back on Pair', [backOnPair.query, backOnPair.listed], ['solarized', onPair.listed])
    check('clearing it brings every pair back', cleared.listed.length, EXPECTED_ROWS.length)
    check('on every tab', darkCleared.listed.length, darkOpen.darks)

    console.log(`\n${passed} passed, ${failed} failed`)
    process.exitCode = failed ? 1 : 0
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
}).finally(closeAll)
