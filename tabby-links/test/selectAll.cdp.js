// "Select all" over a checkbox group, and a button beside long text.
//
//   node scripts/dev/launch-hidden.mjs --enable links,linkifier &
//   node tabby-links/test/selectAll.cdp.js [--shots <dir>]
//
// Settings → Integrations → Stith → "Show in tooltip" is thirteen checkboxes
// with a tri-state "Select all" at the title. Driven with real input events
// (CDP mouse and keyboard, not `.click()`), so the label, the native toggle
// and the component's own pinning of the box are all in the path:
//
//   - the header is checked / clear / indeterminate as the group is all /
//     none / some, and says "Select all";
//   - a click on a mixed group selects everything, then clears, then selects;
//   - Space on the focused header does the same (it is a real checkbox);
//   - a single field unticked turns the header back to mixed;
//   - Jira's labelled field groups get the same header per group, and one
//     group's header ticks every field in it — the old header wrote one field
//     at a time from a stale snapshot, so only the last one stuck;
//   - Link Tooltip → "Which links a click reaches" has one as well, and it is
//     disabled with the kinds it governs.
//
// And the "Add as rule" button beside a pattern: with a pattern far longer
// than the card, the button stays one line at its full width and inside the
// card, and the pattern is what wraps.
//
// `--shots <dir>` also saves both surfaces in the light and dark schemes.
const fs = require('fs')
const path = require('path')
const { closeAll, connect } = require('./cdp')

const SHOTS = (() => {
    const i = process.argv.indexOf('--shots')
    return i === -1 ? null : process.argv[i + 1]
})()

let passed = 0
let failed = 0
function check (name, actual, expected) {
    const a = JSON.stringify(actual)
    const e = JSON.stringify(expected)
    if (a === e) {
        passed++
        console.log(`ok    ${name}`)
    } else {
        failed++
        console.log(`FAIL  ${name}\n        expected ${e}\n        actual   ${a}`)
    }
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

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
`

// Settings is opened inside Angular's zone, as a click would open it. A tab
// built from a CDP script outside the zone registers its listeners there, and
// tabby-core's `checkbox` asserts it is in the zone on every click — so a field
// box built that way ignores a real click. Any Settings tab already open is
// closed first, since an earlier run may have built it outside.
const OPEN_SETTINGS = `
    ${BOOT}
    const appRoot = document.querySelector('app-root')
    const zone = window.ng.getInjector(appRoot).get(window.nodeRequire('@angular/core').NgZone)
    window.__ZONE = zone
    const settings = window.nodeRequire('tabby-settings')
    for (const old of root.app.tabs.filter(t => t instanceof settings.SettingsTabComponent)) {
        zone.run(() => root.app.closeTab(old, false))
    }
    await sleep(300)
    zone.run(() => root.app.openNewTabRaw({ type: settings.SettingsTabComponent }))
    const tab = root.app.tabs.find(t => t instanceof settings.SettingsTabComponent)
    zone.run(() => root.app.selectTab(tab))
    return true
`

const OPEN_PAGE = label => `
    ${BOOT}
    let link = null
    for (let i = 0; i < 80 && !link; i++) {
        await sleep(250)
        const nav = [...document.querySelectorAll('settings-tab .nav')].find(n => !n.closest('.tab-pane'))
        link = nav && [...nav.querySelectorAll('.nav-link')].find(e => e.textContent.trim() === ${JSON.stringify(label)})
    }
    if (!link) { throw new Error('no ${label} item in the settings nav') }
    link.click()
    await sleep(900)
    return true
`

const OPEN_INTEGRATION = id => `
    ${BOOT}
    const c = window.ng.getComponent(document.querySelector('integrations-settings-tab'))
    if (!c) { throw new Error('the Integrations page did not render') }
    window.__C = c
    const zone = window.__ZONE
    await zone.run(() => c.select(null))
    zone.run(() => window.ng.applyChanges(c))
    const target = c.integrations.find(x => x.id === ${JSON.stringify(id)})
    if (!target) { throw new Error('no integration ${id}: ' + c.integrations.map(x => x.id).join(', ')) }
    await zone.run(() => c.select(target))
    zone.run(() => window.ng.applyChanges(c))
    await sleep(400)
    return { id: c.current && c.current.id, fields: (c.current.manifest.fields || []).length }
`

/** Put the integration's fields in a known state, straight through the registry. */
const SET_FIELDS = (keys) => `
    const c = window.__C
    const all = c.current.manifest.fields.map(f => f.key || f.label || '')
    window.__ZONE.run(() => {
        c.registry.setFieldsVisible(c.current.id, all, false)
        c.registry.setFieldsVisible(c.current.id, ${JSON.stringify(keys)}, true)
        window.ng.applyChanges(c)
    })
    await new Promise(r => setTimeout(r, 150))
    return true
`

/** The header's state as the DOM shows it, and the group's as the boxes do. */
const READ = (selector, boxes) => `
    const host = document.querySelector(${JSON.stringify(selector)})
    if (!host) { return { missing: ${JSON.stringify(selector)} } }
    const input = host.querySelector('input[type=checkbox]')
    const label = host.querySelector('label')
    const boxes = [...document.querySelectorAll(${JSON.stringify(boxes)})]
    const on = boxes.filter(b => b.checked).length
    return {
        header: input.indeterminate ? 'mixed' : input.checked ? 'all' : 'none',
        group: on === 0 ? 'none' : on === boxes.length ? 'all' : 'mixed',
        on, of: boxes.length,
        label: label.textContent.trim(),
        labelFor: label.htmlFor === input.id,
        disabled: input.disabled,
    }
`

// Every write re-emits the integration list a moment later (the registry
// rebuilds on `config.changed$`), which re-renders the checkboxes. A click
// landing mid-rebuild is lost, so each input waits for that to settle first.
const SETTLE_MS = 600

/** Until the registry has been idle for a while, since a save queues a rebuild. */
async function settle (cdp) {
    await cdp.evaluate(`
        const busy = () => window.__C && window.__C.registry && window.__C.registry.rebuilding
        let quiet = 0
        for (let i = 0; i < 50 && quiet < 3; i++) {
            await new Promise(r => setTimeout(r, 150))
            quiet = busy() ? 0 : quiet + 1
        }
        return true
    `)
}

async function clickAt (cdp, selector) {
    await settle(cdp)
    const box = await cdp.evaluate(`
        const el = document.querySelector(${JSON.stringify(selector)})
        if (!el) { return null }
        // Instant: a smooth scroll still moving when the box is measured
        // sends the click to wherever the element used to be.
        el.scrollIntoView({ block: 'center', behavior: 'instant' })
        await new Promise(r => setTimeout(r, 100))
        const r = el.getBoundingClientRect()
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
    `)
    if (!box) {
        throw new Error(`nothing at ${selector}`)
    }
    for (const type of ['mousePressed', 'mouseReleased']) {
        await cdp.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 })
    }
    await sleep(SETTLE_MS)
}

async function pressSpace (cdp, selector) {
    await settle(cdp)
    await cdp.evaluate(`document.querySelector(${JSON.stringify(selector)}).focus(); return true`)
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, text: ' ' })
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32 })
    await sleep(SETTLE_MS)
}

async function setMode (cdp, mode) {
    return cdp.evaluate(`
        ${BOOT}
        const was = root.config.store.appearance.colorSchemeMode
        root.config.store.appearance.colorSchemeMode = ${JSON.stringify(mode)}
        await root.config.save()
        await sleep(1200)
        return was
    `)
}

/** A picture of the region from the first selector's box to the last's. */
async function shot (cdp, name, ...selectors) {
    if (!SHOTS) {
        return
    }
    const clip = await cdp.evaluate(`
        const els = ${JSON.stringify(selectors)}.map(s => document.querySelector(s))
        if (els.some(e => !e)) { return null }
        els[0].scrollIntoView({ block: 'start', behavior: 'instant' })
        await new Promise(r => setTimeout(r, 400))
        const rs = els.map(e => e.getBoundingClientRect())
        const pane = els[0].closest('.tab-pane') || document.body
        const p = pane.getBoundingClientRect()
        const top = Math.max(0, Math.min(...rs.map(r => r.top)) - 10)
        const bottom = Math.min(innerHeight, Math.max(...rs.map(r => r.bottom)) + 10)
        return { x: Math.max(0, p.left), y: top, width: Math.min(innerWidth, p.right) - Math.max(0, p.left), height: bottom - top, scale: 1 }
    `)
    if (!clip) {
        console.log(`      (no screenshot for ${name}: an element is missing)`)
        return
    }
    // A hidden window only composites when something makes it: nudge the
    // viewport by a pixel and back, or the capture can wait for a frame that
    // never comes.
    await cdp.send('Emulation.setDeviceMetricsOverride', { ...VIEWPORT, height: VIEWPORT.height + 1 })
    await cdp.send('Emulation.setDeviceMetricsOverride', VIEWPORT)
    await sleep(300)
    let res = {}
    for (let attempt = 0; attempt < 3 && !res.result?.data; attempt++) {
        if (attempt) {
            await cdp.send('Emulation.setDeviceMetricsOverride', { ...VIEWPORT, width: VIEWPORT.width + 1 })
            await cdp.send('Emulation.setDeviceMetricsOverride', VIEWPORT)
            await sleep(500)
        }
        res = await cdp.send('Page.captureScreenshot', { format: 'png', clip, captureBeyondViewport: false })
    }
    if (!res.result?.data) {
        console.log(`      (no screenshot for ${name}: ${JSON.stringify(res).slice(0, 200)})`)
        return
    }
    fs.mkdirSync(SHOTS, { recursive: true })
    const file = path.join(SHOTS, `${name}.png`)
    fs.writeFileSync(file, Buffer.from(res.result.data, 'base64'))
    console.log(`      saved ${file}`)
}

const VIEWPORT = { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false }

const FIELDS_HEADER = 'integrations-settings-tab .select-all-fields'
const FIELD_BOXES = 'integrations-settings-tab .field-checks:not(.tab-checks) .field-check input[type=checkbox]'

async function main () {
    const cdp = await connect()
    await cdp.send('Page.enable')
    await cdp.send('Accessibility.enable')
    await cdp.send('Emulation.setDeviceMetricsOverride', VIEWPORT)
    const initialMode = await setMode(cdp, 'dark')
    await cdp.evaluate(OPEN_SETTINGS)

    try {
        console.log('\n── Stith: Show in tooltip ──')
        await cdp.evaluate(OPEN_PAGE('Integrations'))
        const opened = await cdp.evaluate(OPEN_INTEGRATION('stith'))
        check('stith opened with its 13 fields', opened, { id: 'stith', fields: 13 })

        await cdp.evaluate(SET_FIELDS(['name', 'status', 'project']))
        let s = await cdp.evaluate(READ(FIELDS_HEADER, FIELD_BOXES))
        check('the header is labelled "Select all", and the label is for the box', [s.label, s.labelFor], ['Select all', true])
        check('some fields on: header indeterminate', [s.header, s.group], ['mixed', 'mixed'])
        await shot(cdp, 'show-in-tooltip-mixed-dark', 'integrations-settings-tab .select-all-head', 'integrations-settings-tab .field-checks')

        await clickAt(cdp, `${FIELDS_HEADER} input`)
        s = await cdp.evaluate(READ(FIELDS_HEADER, FIELD_BOXES))
        check('a click on mixed selects all', [s.header, s.group, s.on, s.of], ['all', 'all', 13, 13])

        await clickAt(cdp, `${FIELDS_HEADER} label`)
        s = await cdp.evaluate(READ(FIELDS_HEADER, FIELD_BOXES))
        check('a click on the label, when all, deselects all', [s.header, s.group, s.on], ['none', 'none', 0])

        await clickAt(cdp, `${FIELDS_HEADER} input`)
        s = await cdp.evaluate(READ(FIELDS_HEADER, FIELD_BOXES))
        check('a click on none selects all', [s.header, s.group, s.on], ['all', 'all', 13])

        await clickAt(cdp, 'integrations-settings-tab .field-check:nth-child(2) checkbox')
        s = await cdp.evaluate(READ(FIELDS_HEADER, FIELD_BOXES))
        check('unticking one field makes the header mixed again', [s.header, s.group, s.on], ['mixed', 'mixed', 12])

        await pressSpace(cdp, `${FIELDS_HEADER} input`)
        s = await cdp.evaluate(READ(FIELDS_HEADER, FIELD_BOXES))
        check('Space on the focused header selects all', [s.header, s.group, s.on], ['all', 'all', 13])
        await pressSpace(cdp, `${FIELDS_HEADER} input`)
        s = await cdp.evaluate(READ(FIELDS_HEADER, FIELD_BOXES))
        check('Space again deselects all', [s.header, s.group, s.on], ['none', 'none', 0])

        const stored = await cdp.evaluate(`return window.__C.registry.visibleFieldKeys(window.__C.current).length`)
        check('the choice reached the config, not just the boxes', stored, 0)

        const ax = await cdp.evaluate(`
            const input = document.querySelector('${FIELDS_HEADER} input')
            return { type: input.type, tabIndex: input.tabIndex, name: input.getAttribute('aria-label') }
        `)
        check('it is a focusable native checkbox with an accessible name', ax, { type: 'checkbox', tabIndex: 0, name: 'Select all: Show in tooltip' })
        const axTree = await cdp.send('Accessibility.getPartialAXTree', {
            backendNodeId: (await cdp.send('DOM.describeNode', {
                objectId: (await cdp.send('Runtime.evaluate', { expression: `document.querySelector('${FIELDS_HEADER} input')` })).result.result.objectId,
            })).result.node.backendNodeId,
            fetchRelatives: false,
        })
        await cdp.evaluate(SET_FIELDS(['name']))
        s = await cdp.evaluate(READ(FIELDS_HEADER, FIELD_BOXES))
        check('set to one field: the box is indeterminate', s.header, 'mixed')
        await sleep(300)
        const axMixed = await cdp.send('Accessibility.getPartialAXTree', {
            backendNodeId: (await cdp.send('DOM.describeNode', {
                objectId: (await cdp.send('Runtime.evaluate', { expression: `document.querySelector('${FIELDS_HEADER} input')` })).result.result.objectId,
            })).result.node.backendNodeId,
            fetchRelatives: false,
        })
        const checkedProp = tree => (tree.result?.nodes?.[0]?.properties ?? []).find(p => p.name === 'checked')?.value?.value
        check('the accessibility tree says "false" when none, then "mixed"', [checkedProp(axTree), checkedProp(axMixed)], ['false', 'mixed'])

        // Every field on, for the screenshot and the button checks below.
        await clickAt(cdp, `${FIELDS_HEADER} input`)
        await shot(cdp, 'show-in-tooltip-all-dark', 'integrations-settings-tab .select-all-head', 'integrations-settings-tab .field-checks')

        console.log('\n── Stith: "Add as rule" beside a long pattern ──')
        const LONG = '^https?://(?:www\\.)?(?:[a-z0-9-]+\\.)*stith\\.lvh\\.me/(?:agent|session|sessions|embed/s)/(?<id>[A-Za-z0-9-]{4,64})(?:\\?(?:[a-z]+=[^&#\\s]*&?)*)?(?:#[A-Za-z0-9_-]+)?' + '(?:/[a-z0-9-]+)*'.repeat(6)
        const btn = await cdp.evaluate(`
            const c = window.__C
            c.currentMatchers = [
                ...c.currentMatchers,
                { kind: 'text', pattern: ${JSON.stringify(LONG)}, description: 'An unreasonably long pattern, with a description long enough to wrap onto a second line on its own as well' },
            ]
            window.ng.applyChanges(c)
            await new Promise(r => setTimeout(r, 200))
            const cards = [...document.querySelectorAll('integrations-settings-tab .matcher-card')].filter(x => x.querySelector('.btn'))
            return cards.map(card => {
                const b = card.querySelector('.btn')
                const text = card.querySelector('.header .code')
                const range = document.createRange()
                range.selectNodeContents(b)
                const lines = new Set([...range.getClientRects()].map(r => Math.round(r.top))).size
                const cr = card.getBoundingClientRect()
                const br = b.getBoundingClientRect()
                const tr = text.getBoundingClientRect()
                return {
                    long: text.textContent.length > 150,
                    buttonLines: lines,
                    clipped: b.scrollWidth > b.clientWidth + 1,
                    inside: br.right <= cr.right + 0.5 && br.left >= cr.left - 0.5,
                    textInside: tr.right <= br.left + 0.5,
                    textLines: Math.round(tr.height / parseFloat(getComputedStyle(text).lineHeight || '18')),
                }
            })
        `)
        check('every matcher card has its button', btn.length >= 3, true)
        for (const [i, b] of btn.entries()) {
            const tag = b.long ? 'the long pattern' : `pattern ${i + 1}`
            check(`${tag}: "Add as rule" is one line, unclipped, inside the card`, [b.buttonLines, b.clipped, b.inside], [1, false, true])
            check(`${tag}: the pattern stays left of the button`, b.textInside, true)
        }
        const long = btn.find(b => b.long)
        check('the long pattern wraps instead', long && long.textLines > 1, true)
        await shot(cdp, 'add-as-rule-long-dark', 'integrations-settings-tab .matcher-card:nth-last-child(1 of .matcher-card)')

        console.log('\n── Jira: labelled field groups ──')
        await cdp.evaluate(OPEN_INTEGRATION('jira'))
        const groups = await cdp.evaluate(`
            return [...document.querySelectorAll('integrations-settings-tab .group-head select-all-checkbox')].map(h => h.textContent.trim())
        `)
        check('jira draws a select-all header per labelled group', groups.length > 0, true)
        await cdp.evaluate(SET_FIELDS([]))
        await clickAt(cdp, 'integrations-settings-tab .group-head select-all-checkbox input')
        const group = await cdp.evaluate(`
            const head = document.querySelector('integrations-settings-tab .group-head')
            const boxes = [...head.nextElementSibling.querySelectorAll('input[type=checkbox]')]
            const input = head.querySelector('input')
            const page = document.querySelector('${FIELDS_HEADER} input')
            return {
                groupOn: boxes.filter(b => b.checked).length, groupOf: boxes.length,
                header: input.indeterminate ? 'mixed' : input.checked ? 'all' : 'none',
                page: page.indeterminate ? 'mixed' : page.checked ? 'all' : 'none',
                stored: window.__C.registry.visibleFieldKeys(window.__C.current).length,
            }
        `)
        check('one group header ticks every field in its group, and all of them are stored',
            [group.groupOn === group.groupOf, group.stored === group.groupOf, group.header], [true, true, 'all'])
        check('the page-level header is then mixed', group.page, 'mixed')

        // The rows are rebuilt whenever the registry re-emits, which the save
        // behind every click causes. Tracked by key, the header survives it,
        // so focus stays where the keyboard left it.
        await pressSpace(cdp, 'integrations-settings-tab .group-head select-all-checkbox input')
        await settle(cdp)
        const kept = await cdp.evaluate(`
            const input = document.querySelector('integrations-settings-tab .group-head select-all-checkbox input')
            return { focused: document.activeElement === input, header: input.indeterminate ? 'mixed' : input.checked ? 'all' : 'none' }
        `)
        check('Space on a group header clears it and keeps focus through the rebuild', kept, { focused: true, header: 'none' })
        await shot(cdp, 'jira-groups-dark', 'integrations-settings-tab .select-all-head', 'integrations-settings-tab .field-checks.grouped')

        console.log('\n── Link Tooltip: which links a click reaches ──')
        await cdp.evaluate(OPEN_PAGE('Link Tooltip'))
        await cdp.evaluate(`
            ${BOOT}
            for (const b of document.querySelectorAll('link-tooltip-settings-tab .accordion-button.collapsed')) { b.click() }
            await sleep(600)
            const c = window.ng.getComponent(document.querySelector('link-tooltip-settings-tab'))
            window.__L = c
            c.config.store.linkTooltip.clickable = true
            c.config.store.linkTooltip.clickableKinds = ['rules']
            window.ng.applyChanges(c)
            await sleep(200)
            return true
        `)
        const KINDS = 'link-tooltip-settings-tab .select-all-kinds'
        const KIND_BOXES = 'link-tooltip-settings-tab .click-kinds-list .form-check-inline input'
        let k = await cdp.evaluate(READ(KINDS, KIND_BOXES))
        check('one kind on: header mixed', [k.header, k.group, k.of], ['mixed', 'mixed', 3])
        await shot(cdp, 'click-kinds-mixed-dark', 'link-tooltip-settings-tab .click-kinds')
        await clickAt(cdp, `${KINDS} input`)
        k = await cdp.evaluate(READ(KINDS, KIND_BOXES))
        check('a click selects every kind', [k.header, k.group, k.on], ['all', 'all', 3])
        await clickAt(cdp, `${KINDS} input`)
        k = await cdp.evaluate(READ(KINDS, KIND_BOXES))
        check('and again clears them', [k.header, k.group, k.on], ['none', 'none', 0])
        const storedKinds = await cdp.evaluate(`return [...window.__L.config.store.linkTooltip.clickableKinds]`)
        check('stored as an empty choice, not as "unset"', storedKinds, [])
        await cdp.evaluate(`
            window.__L.config.store.linkTooltip.clickable = false
            window.ng.applyChanges(window.__L)
            await new Promise(r => setTimeout(r, 150))
            return true
        `)
        k = await cdp.evaluate(READ(KINDS, KIND_BOXES))
        check('disabled with the kinds when clicking is off', k.disabled, true)
        await cdp.evaluate(`
            window.__L.config.store.linkTooltip.clickable = true
            window.__L.config.store.linkTooltip.clickableKinds = ['detected', 'rules', 'osc8']
            window.ng.applyChanges(window.__L)
            await window.__L.config.save()
            return true
        `)

        if (SHOTS) {
            console.log('\n── light scheme ──')
            await setMode(cdp, 'light')
            await cdp.evaluate(`${BOOT}
                for (const b of document.querySelectorAll('link-tooltip-settings-tab .accordion-button.collapsed')) { b.click() }
                window.__L.config.store.linkTooltip.clickableKinds = ['rules']
                window.ng.applyChanges(window.__L)
                await sleep(300)
                return true`)
            await shot(cdp, 'click-kinds-mixed-light', 'link-tooltip-settings-tab .click-kinds')
            await cdp.evaluate(OPEN_PAGE('Integrations'))
            await cdp.evaluate(OPEN_INTEGRATION('stith'))
            await cdp.evaluate(SET_FIELDS(['name', 'status', 'project']))
            await shot(cdp, 'show-in-tooltip-mixed-light', 'integrations-settings-tab .select-all-head', 'integrations-settings-tab .field-checks')
            await cdp.evaluate(`
                const c = window.__C
                c.currentMatchers = [...c.currentMatchers, { kind: 'text', pattern: ${JSON.stringify(LONG)}, description: 'An unreasonably long pattern' }]
                window.ng.applyChanges(c)
                await new Promise(r => setTimeout(r, 200))
                return true
            `)
            await shot(cdp, 'add-as-rule-long-light', 'integrations-settings-tab .matcher-card:nth-last-child(1 of .matcher-card)')
            await cdp.evaluate(OPEN_INTEGRATION('jira'))
            await shot(cdp, 'jira-groups-light', 'integrations-settings-tab .select-all-head', 'integrations-settings-tab .field-checks.grouped')
        }
    } finally {
        await setMode(cdp, initialMode ?? 'auto')
        await cdp.send('Emulation.clearDeviceMetricsOverride')
    }

    console.log(`\n${passed} passed, ${failed} failed`)
    if (failed) {
        process.exitCode = 1
    }
}

main().catch(err => {
    console.error(err)
    process.exitCode = 1
}).finally(closeAll)
