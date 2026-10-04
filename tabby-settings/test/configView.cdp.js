// The Config file page, live: the structured tree (default), its filter,
// expand/collapse, long values and notes against the defaults; the raw view's
// highlighted layer staying character-for-character under the textarea; and
// Save and apply / Show defaults working as they did before the two views.
//
// Attaches to a hidden dev build that is already listening:
//
//   node scripts/dev/launch-hidden.mjs --keep &
//   CDP_PORT=<its port> node tabby-settings/test/configView.cdp.js
//
// It rewrites the instance's config (a scratch profile), so never point it at
// a build someone is using. It never presses "Show config file", which would
// open Explorer on the desktop.
const { closeAll, connect } = require('../../scripts/dev/cdp.cjs')

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

async function waitForBoot (evaluate) {
    for (let i = 0; i < 90; i++) {
        const up = await evaluate(`
            try {
                const cmp = window.ng.getComponent(document.querySelector('app-root'))
                return !!(cmp && cmp.app && cmp.app.tabs && cmp.config && cmp.config.store)
            } catch { return false }
        `)
        if (up) { return }
        await sleep(1000)
    }
    throw new Error('the window never booted')
}

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">\n  <path d="M1 1h14v14H1z" fill="#c48a3a"/>\n  <path d="M4 4h8v8H4z" fill="#fff"/>\n</svg>'

// Plant values whose annotations are known, then open Settings on the page —
// inside the zone, as a click would.
const SETUP = `
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const appRoot = document.querySelector('app-root')
    const root = window.ng.getComponent(appRoot)
    const zone = window.ng.getInjector(appRoot).get(window['nodeRequire']('@angular/core').NgZone)
    const yaml = window['nodeRequire']('js-yaml')
    const settings = window['nodeRequire']('tabby-settings')
    const store = yaml.load(root.config.readRaw()) || {}
    store.terminal = Object.assign({}, store.terminal, { fontSize: 17 })
    store.appearance = Object.assign({}, store.appearance, { accentColor: '#c48a3a' })
    store.cfgViewProbe = { nested: { flag: true } }
    store.profiles = [{ type: 'local', name: 'Probe profile', icon: ${JSON.stringify(SVG)}, options: { command: 'cmd.exe' } }]
    await zone.run(() => root.config.writeRaw(yaml.dump(store)))
    localStorage.removeItem('configFileView')
    for (const old of root.app.tabs.filter(t => t instanceof settings.SettingsTabComponent)) {
        zone.run(() => root.app.closeTab(old, false))
    }
    await sleep(300)
    zone.run(() => root.app.openNewTabRaw({ type: settings.SettingsTabComponent, inputs: { activeTab: 'config-file' } }))
    const tab = root.app.tabs.find(t => t instanceof settings.SettingsTabComponent)
    zone.run(() => root.app.selectTab(tab))
    for (let i = 0; i < 60 && !document.querySelector('settings-tab config-file-view'); i++) {
        await sleep(250)
    }
    if (!document.querySelector('settings-tab config-file-view')) { throw new Error('the config page never rendered') }
    window.__ZONE = zone
    window.__ROOT = root
    return true
`

/** Click inside the zone and let change detection settle. */
const click = selectorJs => `
    const el = ${selectorJs}
    if (!el) { return 'missing' }
    window.__ZONE.run(() => el.click())
    await new Promise(r => setTimeout(r, 150))
    return 'clicked'
`

const ROWS = `
    return [...document.querySelectorAll('config-file-view .pane:first-child config-tree .tree-row')].map(r => ({
        label: r.querySelector('.label').textContent.trim(),
        level: +r.getAttribute('aria-level'),
        expanded: r.getAttribute('aria-expanded'),
        chips: [...r.querySelectorAll('.chip')].map(c => c.textContent.trim()).filter(Boolean),
        value: r.querySelector('.value')?.textContent.trim() ?? null,
        valueClass: [...(r.querySelector('.value')?.classList ?? [])].filter(c => c.startsWith('y-')),
    }))
`
const rowByLabel = (label, level) => `[...document.querySelectorAll('config-file-view .pane:first-child config-tree .tree-row')].find(r => r.querySelector('.label').textContent.trim() === ${JSON.stringify(label)} && +r.getAttribute('aria-level') === ${level})`

async function setFilter (d, text) {
    await d.evaluate(`
        const input = document.querySelector('config-tree .filter input')
        input.focus()
        input.select()
        return true
    `)
    if (text) {
        await d.send('Input.insertText', { text })
    } else {
        await d.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Delete', code: 'Delete', windowsVirtualKeyCode: 46 })
    }
    await sleep(200)
}

async function main () {
    const d = await connect({ port: process.env.CDP_PORT ? +process.env.CDP_PORT : undefined })
    const { evaluate } = d
    await waitForBoot(evaluate)
    await evaluate(SETUP)
    await sleep(300)

    console.log('── structured view (the default) ──')
    const first = await evaluate(`
        const v = document.querySelector('config-file-view')
        return {
            tree: !!v.querySelector('config-tree'),
            editor: !!v.querySelector('yaml-editor'),
            active: v.querySelector('.view-header .btn.active')?.textContent.trim(),
            topLevel: Object.keys(window['nodeRequire']('js-yaml').load(window.__ROOT.config.readRaw())),
        }
    `)
    check('opens on the tree, with no stored choice', [first.tree, first.editor, first.active], [true, false, 'Structured'])
    let rows = await evaluate(ROWS)
    check('top level: every key of the file, in order, collapsed', rows.map(r => r.label), first.topLevel)
    check('  all at level 1, none open', rows.every(r => r.level === 1 && r.expanded !== 'true'), true)
    const terminal = rows.find(r => r.label === 'terminal')
    note(`terminal row: ${JSON.stringify(terminal)}`)
    check('a collapsed branch counts what changed in it', terminal.chips.some(c => /^\d+ changed$/.test(c)), true)
    check('a branch absent from the defaults says so', rows.find(r => r.label === 'cfgViewProbe').chips, ['not in defaults'])

    await evaluate(click(`${rowByLabel('terminal', 1)}.querySelector('.toggle')`))
    rows = await evaluate(ROWS)
    const fontSize = rows.find(r => r.label === 'fontSize' && r.level === 2)
    check('opening terminal shows its keys', !!fontSize, true)
    check('  a number is coloured as one', [fontSize?.value, fontSize?.valueClass], ['17', ['y-number']])
    check('  and it is marked changed', fontSize?.chips, ['changed'])
    await evaluate(click(`${rowByLabel('fontSize', 2)}.querySelector('.chip-changed')`))
    const notes = await evaluate(`return document.querySelector('config-tree .notes')?.textContent.replace(/\\s+/g, ' ').trim() ?? null`)
    check('the chip opens a note naming the default', notes, 'Default: 14')

    await evaluate(click(`${rowByLabel('appearance', 1)}.querySelector('.toggle')`))
    rows = await evaluate(ROWS)
    check('a fork-added key carries the Torbie mark', rows.find(r => r.label === 'accentColor')?.chips, ['changed', 'Torbie'])

    console.log('\n── expand all, collapse all ──')
    const collapsedCount = (await evaluate(`return document.querySelectorAll('config-file-view .pane:first-child config-tree .tree-row').length`))
    await evaluate(click(`[...document.querySelectorAll('config-tree .tree-toolbar .btn')].find(b => b.textContent.includes('Expand all'))`))
    rows = await evaluate(ROWS)
    check('expand all opens every branch', rows.filter(r => r.expanded === 'false').length, 0)
    check('  and reaches the profile item and its options', rows.some(r => r.label === 'command' && r.level === 4), true)
    check('a list item is named by its profile', await evaluate(`return [...document.querySelectorAll('config-file-view config-tree .hint')].map(h => h.textContent.trim()).includes('Probe profile')`), true)
    note(`${collapsedCount} rows collapsed → ${rows.length} expanded`)

    console.log('\n── a long value ──')
    const icon = await evaluate(`
        const row = ${rowByLabel('icon', 3)}
        return {
            preview: row.querySelector('.truncated')?.textContent ?? null,
            button: row.querySelector('.value-toggle')?.textContent.replace(/\\s+/g, ' ').trim(),
            height: row.getBoundingClientRect().height,
        }
    `)
    check('an SVG is cut to its first line', icon.preview, SVG.split('\n')[0] + '…')
    check('  with what was left out', icon.button, `Show all (${SVG.length} chars, 4 lines)`)
    check('  on one row', icon.height <= 24, true)
    await evaluate(click(`${rowByLabel('icon', 3)}.querySelector('.value-toggle')`))
    check('Show all draws the whole value', await evaluate(`return document.querySelector('config-tree pre.full-value')?.textContent`), SVG)

    await evaluate(click(`[...document.querySelectorAll('config-tree .tree-toolbar .btn')].find(b => b.textContent.includes('Collapse all'))`))
    check('collapse all goes back to the top level', (await evaluate(ROWS)).map(r => r.label), first.topLevel)

    console.log('\n── the filter ──')
    await setFilter(d, 'fontsize')
    rows = await evaluate(ROWS)
    check('narrows to the match and the way to it', rows.map(r => r.label), ['terminal', 'fontSize'])
    await setFilter(d, 'nested.flag')
    rows = await evaluate(ROWS)
    check('a dotted term matches the path', rows.map(r => r.label), ['cfgViewProbe', 'nested', 'flag'])
    check('  a boolean is coloured as one', rows[2]?.valueClass, ['y-boolean'])
    await setFilter(d, 'zzzz-nothing')
    check('no match says so', await evaluate(`return document.querySelector('config-tree .empty')?.textContent.trim()`), 'Nothing matches this filter.')
    await setFilter(d, '')
    check('clearing it brings the collapsed tree back', (await evaluate(ROWS)).map(r => r.label), first.topLevel)

    console.log('\n── raw view ──')
    await evaluate(click(`[...document.querySelectorAll('config-file-view .view-header .btn')].find(b => b.textContent.includes('Raw'))`))
    await sleep(200)
    const raw = await evaluate(`
        const ta = document.querySelector('config-file-view yaml-editor textarea')
        const layer = document.querySelector('config-file-view yaml-editor pre.layer')
        const tab = window.ng.getComponent(document.querySelector('settings-tab'))
        const cs = el => { const s = getComputedStyle(el); return [s.fontFamily, s.fontSize, s.lineHeight, s.paddingTop, s.paddingLeft, s.whiteSpace, s.tabSize, s.letterSpacing].join('|') }
        return {
            stored: localStorage.getItem('configFileView'),
            same: ta.value === tab.configFile,
            layerText: layer.textContent === ta.value + '\\n',
            metrics: cs(ta) === cs(layer),
            textTransparent: getComputedStyle(ta).webkitTextFillColor,
            kinds: [...new Set([...layer.querySelectorAll('span')].map(s => s.className))].sort(),
            heights: [layer.offsetHeight, ta.scrollHeight],
            noTree: !document.querySelector('config-file-view config-tree'),
        }
    `)
    check('the choice is remembered', raw.stored, 'raw')
    check('the textarea holds the config file text', raw.same, true)
    check('the layer is the same text, character for character', raw.layerText, true)
    check('  in identical metrics', raw.metrics, true)
    check('  the textarea text is transparent over it', raw.textTransparent, 'rgba(0, 0, 0, 0)')
    check('keys, strings, numbers, booleans and dashes are coloured', ['y-key', 'y-string', 'y-number', 'y-boolean', 'y-punct'].every(k => raw.kinds.includes(k)), true)
    check('  the layer is as tall as what the textarea scrolls', Math.abs(raw.heights[0] - raw.heights[1]) <= 1, true)
    note(`token kinds: ${raw.kinds.join(' ')}; heights ${raw.heights}`)
    check('the tree is gone', raw.noTree, true)

    const scrolled = await evaluate(`
        const ta = document.querySelector('config-file-view yaml-editor textarea')
        ta.scrollTop = 120
        ta.dispatchEvent(new Event('scroll'))
        await new Promise(r => setTimeout(r, 50))
        return [ta.scrollTop, document.querySelector('config-file-view yaml-editor pre.layer').style.transform]
    `)
    check('scrolling moves the layer with it', scrolled[1], `translate(0px, ${-scrolled[0]}px)`)

    // Type the way a keyboard does: a comment at the very start.
    await evaluate(`
        const ta = document.querySelector('config-file-view yaml-editor textarea')
        ta.focus()
        ta.setSelectionRange(0, 0)
        return true
    `)
    await d.send('Input.insertText', { text: '# typed\n' })
    await sleep(200)
    const typed = await evaluate(`
        const tab = window.ng.getComponent(document.querySelector('settings-tab'))
        const layer = document.querySelector('config-file-view yaml-editor pre.layer')
        return {
            model: tab.configFile.startsWith('# typed\\n'),
            comment: layer.querySelector('.y-comment')?.textContent,
            save: !!document.querySelector('settings-tab .btn-primary:not([disabled])')?.textContent.includes('Save and apply'),
        }
    `)
    check('typing reaches the settings tab', typed.model, true)
    check('  and is highlighted as a comment', typed.comment, '# typed')
    check('  and Save and apply is offered', typed.save, true)

    await d.send('Input.insertText', { text: '{{' })
    await sleep(200)
    check('broken YAML disables saving, as before', await evaluate(`return document.querySelector('settings-tab .btn-primary[disabled]')?.textContent.trim()`), 'Invalid syntax')
    await d.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
    await d.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 })
    await sleep(200)

    // Change a value in the text and save it.
    await evaluate(`
        const ta = document.querySelector('config-file-view yaml-editor textarea')
        const at = ta.value.indexOf('fontSize: 17')
        ta.focus()
        ta.setSelectionRange(at + 10, at + 12)
        return at
    `)
    await d.send('Input.insertText', { text: '19' })
    await sleep(200)
    await evaluate(click(`[...document.querySelectorAll('settings-tab .btn-primary')].find(b => b.textContent.includes('Save and apply'))`))
    await sleep(500)
    check('Save and apply writes the edit', await evaluate(`return window.__ROOT.config.store.terminal.fontSize`), 19)

    console.log('\n── show defaults ──')
    await evaluate(click(`[...document.querySelectorAll('settings-tab .btn-secondary')].find(b => b.textContent.trim() === 'Show defaults')`))
    const defRaw = await evaluate(`
        const panes = document.querySelectorAll('config-file-view .pane')
        const ta = panes[1]?.querySelector('yaml-editor textarea')
        return { panes: panes.length, readonly: ta?.readOnly, hasDefaults: !!ta && ta.value.includes('terminal:') }
    `)
    check('raw: a second, read-only pane of defaults', defRaw, { panes: 2, readonly: true, hasDefaults: true })
    await evaluate(click(`[...document.querySelectorAll('config-file-view .view-header .btn')].find(b => b.textContent.includes('Structured'))`))
    const defTree = await evaluate(`
        const panes = document.querySelectorAll('config-file-view .pane')
        return {
            trees: document.querySelectorAll('config-file-view config-tree').length,
            defaultsRows: panes[1]?.querySelectorAll('.tree-row').length,
            defaultsChips: panes[1]?.querySelectorAll('.chip-changed, .chip-added').length,
            stored: localStorage.getItem('configFileView'),
        }
    `)
    check('structured: two trees', defTree.trees, 2)
    check('  the defaults tree has rows and no comparison chips', [defTree.defaultsRows > 5, defTree.defaultsChips], [true, 0])
    check('  and the choice is remembered again', defTree.stored, 'structured')
    await evaluate(click(`[...document.querySelectorAll('settings-tab .btn-secondary')].find(b => b.textContent.trim() === 'Show defaults')`))
    check('Show defaults toggles back off', await evaluate(`return document.querySelectorAll('config-file-view .pane').length`), 1)
    check('Show config file is still there (not pressed)', await evaluate(`return !![...document.querySelectorAll('settings-tab .btn-secondary')].find(b => b.textContent.includes('Show config file'))`), true)
}

main()
    .catch(error => {
        failed++
        console.error(error)
    })
    .finally(() => {
        console.log(`\n${passed} passed, ${failed} failed`)
        process.exitCode = failed ? 1 : 0
        closeAll()
    })
