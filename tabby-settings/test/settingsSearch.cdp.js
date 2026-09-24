// Settings search, live: the index read out of the rendered pages, the ranking
// a person sees, the highlight that must not move text, the centred snippet,
// and opening a result — including one inside a collapsed accordion group and
// one on a page's own inner tab (Builds → Options).
//
// Attaches to a hidden dev build that is already listening:
//
//   node scripts/dev/launch-hidden.mjs --enable links,linkifier,claude,builds --keep &
//   node tabby-settings/test/settingsSearch.cdp.js
//
// It opens Settings inside Angular's zone, as a click would: a tab built from a
// CDP script outside the zone registers its listeners there, and typing into it
// then renders nothing until something else runs change detection.
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

const OPEN = `
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const appRoot = document.querySelector('app-root')
    const root = window.ng.getComponent(appRoot)
    const zone = window.ng.getInjector(appRoot).get(window['nodeRequire']('@angular/core').NgZone)
    const settings = window['nodeRequire']('tabby-settings')
    for (const old of root.app.tabs.filter(t => t instanceof settings.SettingsTabComponent)) {
        zone.run(() => root.app.closeTab(old, false))
    }
    await sleep(300)
    zone.run(() => root.app.openNewTabRaw({ type: settings.SettingsTabComponent, inputs: { activeTab: 'application' } }))
    const tab = root.app.tabs.find(t => t instanceof settings.SettingsTabComponent)
    zone.run(() => root.app.selectTab(tab))
    for (let i = 0; i < 60 && !document.querySelector('settings-tab settings-search input'); i++) {
        await sleep(250)
    }
    if (!document.querySelector('settings-tab settings-search input')) { throw new Error('the search box never rendered') }
    window.__ZONE = zone
    return true
`

/** Type into the box the way a keyboard does, and wait for the index. */
async function search (d, query) {
    await d.evaluate(`
        const input = document.querySelector('settings-search input')
        input.focus()
        input.select()
        return true
    `)
    await d.send('Input.insertText', { text: query })
    return d.evaluate(`
        for (let i = 0; i < 100; i++) {
            await new Promise(r => setTimeout(r, 50))
            if (!document.querySelector('settings-search-results .fa-spin')) { break }
        }
        await new Promise(r => setTimeout(r, 100))
        return [...document.querySelectorAll('settings-search-results .result')].map(r => ({
            kind: r.dataset.kind,
            crumbs: [...r.querySelectorAll('.crumb')].map(c => c.textContent),
            title: r.querySelector('.title').textContent,
            description: r.querySelector('.description')?.textContent ?? null,
            leading: !!r.querySelector('.description.leading'),
            trailing: !!r.querySelector('.description.trailing'),
            marks: [...r.querySelectorAll('.match')].map(m => m.textContent),
            titleMarks: [...r.querySelectorAll('.title .match')].map(m => m.textContent),
            descriptionMarks: [...r.querySelectorAll('.description .match')].map(m => m.textContent),
        }))
    `)
}

async function key (d, keyName, code, modifiers = 0, text) {
    const base = { key: keyName, code, windowsVirtualKeyCode: KEYCODES[keyName] ?? 0, modifiers }
    await d.send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', ...base, text })
    await d.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
}
const KEYCODES = { ArrowDown: 40, ArrowUp: 38, Enter: 13, Escape: 27, f: 70 }
const CTRL = 2

async function main () {
    const d = await connect()
    const { evaluate } = d
    await waitForBoot(evaluate)
    await evaluate(OPEN)

    console.log('── the box ──')
    const layout = await evaluate(`
        const nav = document.querySelector('settings-tab > .content > .nav')
        return {
            first: nav.firstElementChild.classList.contains('nav-search'),
            linkInSearch: !!nav.querySelector('.nav-search .nav-link'),
            navScrollsSideways: nav.scrollWidth > nav.clientWidth,
        }
    `)
    check('sits first in the nav', layout.first, true)
    check('is not a page link (arrow keys and every .nav-link query pass over it)', layout.linkInSearch, false)
    check('does not widen the 222px nav', layout.navScrollsSideways, false)

    // Every Link Tooltip group shut, before the first focus builds the index:
    // indexing opens them all to read them and must leave this as it found it.
    const collapseBefore = await evaluate(`
        localStorage.setItem('linkTooltipGroupCollapsed', JSON.stringify({ card: true, buttons: true, clicks: true, pane: true }))
        return localStorage.getItem('linkTooltipGroupCollapsed')
    `)
    await evaluate(`document.activeElement.blur(); document.body.focus(); return true`)
    await key(d, 'f', 'KeyF', CTRL)
    await sleep(100)
    check('Ctrl+F focuses it', await evaluate(`return document.activeElement === document.querySelector('settings-search input')`), true)

    console.log('\n── what a query finds, in order ──')
    const update = await search(d, 'update')
    note(`update → ${update.slice(0, 4).map(r => r.title).join(' · ')}`)
    check('"update": Automatic Updates is first', update[0]?.title, 'Automatic Updates')
    check('  highlighted in its title and its description', [update[0]?.titleMarks, update[0]?.descriptionMarks], [['Update'], ['update']])
    const shell = await search(d, 'shell')
    note(`shell → ${shell.slice(0, 4).map(r => r.title).join(' · ')}`)
    check('"shell": the Shell page, then Shell integration', shell.slice(0, 2).map(r => [r.kind, r.title]), [['tab', 'Shell'], ['setting', 'Shell integration']])
    const contrast = await search(d, 'contrast')
    check('"contrast": both Minimum contrast ratio rows', contrast.filter(r => r.title === 'Minimum contrast ratio').length, 2)
    const hotkey = await search(d, 'hotkey')
    check('"hotkey": the Hotkeys page first', [hotkey[0]?.kind, hotkey[0]?.title], ['tab', 'Hotkeys'])
    const clau = await search(d, 'clau')
    check('"clau": the Claude page first, as a prefix', [clau[0]?.title, clau[0]?.titleMarks], ['Claude', ['Clau']])
    check('  and no subsequence noise beside it', clau.some(r => r.title === 'The pin currently launches'), false)
    const depth = await search(d, 'search depth')
    check('a setting on an inner tab is indexed (Builds → Options)', depth[0] && [depth[0].title, depth[0].crumbs[0]], ['Search depth', 'Builds'])
    check('indexing put back the collapsed groups it opened', await evaluate(`return localStorage.getItem('linkTooltipGroupCollapsed')`), collapseBefore)
    check('and left no stage behind', await evaluate(`return document.querySelectorAll('.settings-search-index').length`), 0)
    check('and did not take focus from the box', await evaluate(`return document.activeElement === document.querySelector('settings-search input')`), true)

    console.log('\n── snippets ──')
    const cut = clau.find(r => r.leading && r.trailing)
    check('a long description is cut on both sides around the match', !!cut, true)
    if (cut) {
        const text = cut.description
        const mark = cut.descriptionMarks[0]
        const at = text.indexOf(mark)
        const before = at
        const after = text.length - at - mark.length
        note(`…${text}…`)
        check('  within the budget', text.length <= 140, true)
        check('  with the match near the centre', Math.abs(before - after) <= 24, true)
    }
    const tail = shell.find(r => r.trailing && !r.leading)
    check('a match near the start keeps the start and cuts the end', !!tail, true)

    console.log('\n── the highlight does not move text ──')
    const shift = await evaluate(`
        const out = []
        for (const mark of document.querySelectorAll('settings-search-results .match')) {
            const line = mark.parentElement
            const last = line.lastElementChild
            const withMark = [mark.getBoundingClientRect().width, last.getBoundingClientRect().right, line.getBoundingClientRect().height]
            mark.classList.remove('match')
            const without = [mark.getBoundingClientRect().width, last.getBoundingClientRect().right, line.getBoundingClientRect().height]
            mark.classList.add('match')
            const style = getComputedStyle(mark)
            out.push({
                same: withMark.every((v, i) => Math.abs(v - without[i]) < 0.01),
                box: [style.paddingLeft, style.paddingRight, style.marginLeft, style.marginRight, style.borderLeftWidth, style.fontWeight === getComputedStyle(line).fontWeight],
            })
        }
        return out
    `)
    check('every highlight measured', shift.length > 0, true)
    check('no highlight changes a width, a line end or a line height', shift.every(s => s.same), true)
    check('no padding, margin, border or weight on a highlight', [...new Set(shift.map(s => JSON.stringify(s.box)))], [JSON.stringify(['0px', '0px', '0px', '0px', '0px', true])])

    console.log('\n── keyboard ──')
    await search(d, 'update')
    await key(d, 'ArrowDown', 'ArrowDown')
    check('ArrowDown moves the selection', await evaluate(`return [...document.querySelectorAll('settings-search-results .result')].findIndex(r => r.classList.contains('active'))`), 1)
    check('  and the nav did not change page', await evaluate(`return document.querySelector('settings-tab > .content > .nav .nav-link.active').textContent.trim()`), 'Application')
    await key(d, 'ArrowUp', 'ArrowUp')
    await key(d, 'Escape', 'Escape')
    await sleep(100)
    check('Escape clears the query and the results', await evaluate(`return [document.querySelector('settings-search input').value, !!document.querySelector('settings-search-results')]`), ['', false])

    console.log('\n── opening a result ──')
    async function open (query, title) {
        const found = await search(d, query)
        const index = found.findIndex(r => r.title === title)
        if (index < 0) {
            return { error: `"${title}" not in the results for "${query}"` }
        }
        for (let i = 0; i < index; i++) {
            await key(d, 'ArrowDown', 'ArrowDown')
        }
        await key(d, 'Enter', 'Enter', 0, '\r')
        return evaluate(`
            for (let i = 0; i < 60; i++) {
                await new Promise(r => setTimeout(r, 100))
                if (document.querySelector('.settings-search-flash')) { break }
            }
            await new Promise(r => setTimeout(r, 700))
            const row = document.querySelector('.settings-search-flash')
            const pane = document.querySelector('settings-tab > .content > .tab-content')
            const r = row?.getBoundingClientRect()
            const p = pane.getBoundingClientRect()
            return {
                page: document.querySelector('settings-tab > .content > .nav .nav-link.active').textContent.trim(),
                row: row?.querySelector('.title')?.textContent.trim() ?? row?.textContent.trim() ?? null,
                visible: !!r && r.height > 0 && r.top >= p.top && r.bottom <= p.bottom,
                resultsGone: !document.querySelector('settings-search-results'),
                innerTab: row?.closest('settings-tab-body')?.querySelector('.nav-tabs .nav-link.active')?.textContent.trim() ?? null,
            }
        `)
    }
    const auto = await open('automatic upd', 'Automatic Updates')
    check('Enter opens the page', auto.page, 'Application')
    check('  and flashes the row, scrolled into view', [auto.row, auto.visible, auto.resultsGone], ['Automatic Updates', true, true])
    const hover = await open('hovering a link', 'Show a card when hovering a link')
    check('a row in a collapsed group: the page opens', hover.page, 'Link Tooltip')
    check('  the group opens and the row is shown', [hover.row, hover.visible], ['Show a card when hovering a link', true])
    const inner = await open('search depth', 'Search depth')
    check('a row on an inner tab: the page and the tab open', [inner.page, !!inner.innerTab?.includes('Options')], ['Builds', true])
    check('  and the row is shown', [inner.row, inner.visible], ['Search depth', true])
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
