// Pinned profiles in every view that lists profiles, and the Settings tab
// being splittable, in a real window.
//
//   node scripts/dev/launch-hidden.mjs --port 9247      # leave it running
//   CDP_PORT=9247 node tabby-core/test/profilePins.cdp.js
//
// Everything is driven inside NgZone: a tab or a modal built from a CDP script
// outside it listens outside it, and then nothing it does is drawn.
//
// The jump list is built and never published — `JumpListService.build()` hands
// back what would be set, so the shell's copy is not touched.
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

const SETUP = `
    const sleep = ms => new Promise(r => setTimeout(r, ms))
    const core = window.nodeRequire('tabby-core')
    const settings = window.nodeRequire('tabby-settings')
    const injector = window.ng.getInjector(document.querySelector('app-root'))
    const zone = injector.get(window.nodeRequire('@angular/core').NgZone)
    const app = injector.get(core.AppService)
    const config = injector.get(core.ConfigService)
    const profiles = injector.get(core.ProfilesService)
    const until = async (what, fn) => {
        for (let i = 0; i < 60; i++) {
            const v = fn()
            if (v) { return v }
            await sleep(100)
        }
        throw new Error('never happened: ' + what)
    }
    window.__P = { sleep, core, settings, injector, zone, app, config, profiles, until }
    // A rerun on the same instance must not inherit the last run's Settings tab.
    for (const tab of app.tabs.filter(t => t instanceof settings.SettingsTabComponent)) {
        zone.run(() => app.closeTab(tab, false))
    }
    config.store.pinnedProfiles = []
    config.store.terminal.showBuiltinProfiles = true
    window.localStorage.removeItem('recentProfiles')
    const all = (await profiles.getProfiles()).filter(p => p.id && !p.isTemplate && p.type === 'local')
    return all.map(p => ({ id: p.id, name: p.name, icon: p.icon ?? null }))
`

// Read the selector as it is drawn: headers and rows, in order.
const READ_SELECTOR = `
    const modal = document.querySelector('selector-modal')
    if (!modal) { return null }
    return [...modal.querySelectorAll('.group-header, .list-group-item')].map(el => {
        if (el.classList.contains('group-header')) { return '# ' + el.textContent.trim() }
        const icon = el.querySelector('profile-icon i')
        return {
            name: el.querySelector('.title').textContent.trim(),
            icon: icon ? icon.className : (el.querySelector('profile-icon .icon') ? 'html' : ''),
            actions: [...el.querySelectorAll('.row-action')].map(b => b.getAttribute('aria-label')),
            active: el.classList.contains('active'),
        }
    })
`

const section = (rows, name) => {
    const out = []
    let inside = false
    for (const row of rows) {
        if (typeof row === 'string') {
            inside = row === '# ' + name
        } else if (inside) {
            out.push(row)
        }
    }
    return out
}

async function main () {
    const { evaluate } = await connect()
    await waitForBoot(evaluate)

    const local = await evaluate(SETUP)
    if (local.length < 3) {
        throw new Error(`needs three local profiles to pin, found ${local.length}`)
    }
    const [first, second, third] = local
    console.log(`       pinning among: ${local.map(p => p.name).join(', ')}`)

    // ── the service ─────────────────────────────────────────────────────
    console.log('service')
    const service = await evaluate(`
        const { profiles, config } = __P
        const all = await profiles.getProfiles()
        const find = id => all.find(p => p.id === id)
        const save = profiles.setProfilePinned(find(${JSON.stringify(second.id)}), true)
        const immediately = [...config.store.pinnedProfiles]
        await save
        await profiles.setProfilePinned(find(${JSON.stringify(first.id)}), true)
        return {
            immediately,
            stored: [...config.store.pinnedProfiles],
            pinned: (await profiles.getPinnedProfiles()).map(p => p.id),
            onDisk: config.readRaw().includes('pinnedProfiles'),
        }
    `)
    check('the store has the pin before the save resolves', service.immediately, [second.id])
    check('pins are kept in pin order', service.stored, [second.id, first.id])
    check('and read back in it', service.pinned, [second.id, first.id])
    check('saved to config.yaml', service.onDisk, true)

    // ── the selector ────────────────────────────────────────────────────
    console.log('selector')
    await evaluate(`
        const { zone, profiles, until } = __P
        window.localStorage.recentProfiles = JSON.stringify([{ id: ${JSON.stringify(third.id)}, name: ${JSON.stringify(third.name)}, type: 'local' }])
        zone.run(() => { profiles.showProfileSelector().catch(() => null) })
        await until('the selector', () => document.querySelector('selector-modal .list-group-item'))
        return true
    `)
    let rows = await evaluate(READ_SELECTOR)
    const headers = rows.filter(r => typeof r === 'string')
    check('Pinned is the first section and Recent the second', headers.slice(0, 2), ['# Pinned', '# Recent'])
    check('Pinned lists the pins in pin order', section(rows, 'Pinned').map(r => r.name), [second.name, first.name])
    check('a pinned row offers Unpin', section(rows, 'Pinned')[0].actions, ['Unpin'])
    const recent = section(rows, 'Recent')
    check('Recent still lists the recent profile', recent[0].name, third.name)
    check('a recent row does not wear the history icon', /fa-history/.test(recent[0].icon), false)
    check('a recent row offers Pin', recent[0].actions, ['Pin'])
    check('Clear recent profiles has no pin button', recent[recent.length - 1].actions, [])
    const everywhere = rows.filter(r => typeof r !== 'string' && r.name === second.name)
    check('a pinned profile is still listed where it lives', everywhere.length, 2)

    // Pin the recent one with the row's own button: the selector stays open.
    await evaluate(`
        const { until, sleep } = __P
        const row = [...document.querySelectorAll('selector-modal .list-group-item')]
            .find(el => el.querySelector('.row-action[aria-label="Pin"]'))
        row.querySelector('.row-action').click()
        await sleep(400)
        return true
    `)
    rows = await evaluate(READ_SELECTOR)
    check('the selector stays open after pinning from a row', rows !== null, true)
    check('and the new pin joins the section, last', section(rows, 'Pinned').map(r => r.name), [second.name, first.name, third.name])

    // Ctrl+P on the keyboard's row — which followed the row just acted on, so
    // this takes back the pin the click made.
    check('the selection stays on the row that was acted on', rows.filter(r => typeof r !== 'string' && r.active).map(r => r.name), [third.name])
    await evaluate(`
        const { sleep } = __P
        const modal = document.querySelector('selector-modal')
        modal.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true, cancelable: true }))
        await sleep(400)
        return true
    `)
    rows = await evaluate(READ_SELECTOR)
    check('Ctrl+P unpins the selected row', section(rows, 'Pinned').map(r => r.name), [second.name, first.name])
    const stored = await evaluate(`return [...__P.config.store.pinnedProfiles]`)
    check('and the config follows', stored, [second.id, first.id])

    await evaluate(`
        const { sleep } = __P
        document.querySelector('selector-modal').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        await sleep(400)
        return true
    `)
    check('Escape still closes it', await evaluate(`return !document.querySelector('selector-modal')`), true)

    // ── Settings → Profiles ─────────────────────────────────────────────
    console.log('settings')
    const page = await evaluate(`
        const { zone, app, settings, until, sleep } = __P
        zone.run(() => app.openNewTabRaw({ type: settings.SettingsTabComponent, inputs: { activeTab: 'profiles' } }))
        await until('the profiles list', () => document.querySelector('settings-tab .collapse-container .collapse-item'))
        await sleep(500)
        const container = document.querySelector('settings-tab .collapse-container')
        const items = [...container.querySelectorAll('.collapse-item')]
        const groups = items.filter(el => !el.classList.contains('ps-4'))
        const firstGroup = groups[0]
        const inPinned = []
        for (let el = firstGroup.nextElementSibling; el && el.classList.contains('ps-4'); el = el.nextElementSibling) {
            inPinned.push(el.querySelector('span.no-wrap').textContent.trim())
        }
        return {
            firstGroup: firstGroup.querySelector('span').textContent.trim(),
            thumbtack: !!firstGroup.querySelector('.fa-thumbtack'),
            inPinned,
            marks: container.querySelectorAll('.pin-mark').length,
        }
    `)
    check('Pinned is the first group on the page', page.firstGroup, 'Pinned')
    check('and wears a pin rather than a folder', page.thumbtack, true)
    check('it lists the pins in pin order', page.inPinned, [second.name, first.name])
    check('each pinned profile is marked in its own group', page.marks, 2)

    const viaMenu = await evaluate(`
        const { sleep, config } = __P
        const container = document.querySelector('settings-tab .collapse-container')
        const row = [...container.querySelectorAll('.collapse-item.ps-4')]
            .filter(el => el.querySelector('span.no-wrap').textContent.trim() === ${JSON.stringify(third.name)}).pop()
        const labels = [...row.querySelectorAll('.dropdown-item')].map(el => el.textContent.trim())
        ;[...row.querySelectorAll('.dropdown-item')].find(el => el.textContent.trim() === 'Pin').click()
        await sleep(600)
        const again = [...document.querySelectorAll('settings-tab .collapse-container .collapse-item.ps-4')]
            .filter(el => el.querySelector('span.no-wrap').textContent.trim() === ${JSON.stringify(third.name)}).pop()
        return {
            labels,
            stored: [...config.store.pinnedProfiles],
            after: [...again.querySelectorAll('.dropdown-item')].map(el => el.textContent.trim()),
        }
    `)
    check('an unpinned row\'s menu offers Pin', viaMenu.labels.includes('Pin') && !viaMenu.labels.includes('Unpin'), true)
    check('choosing it pins the profile', viaMenu.stored, [second.id, first.id, third.id])
    check('and the menu then offers Unpin', viaMenu.after.includes('Unpin') && !viaMenu.after.includes('Pin'), true)

    // ── the side-panel tree ─────────────────────────────────────────────
    console.log('profile tree')
    const tree = await evaluate(`
        const { zone, config, until, sleep } = __P
        zone.run(() => { config.store.showProfileTree = true; config.save() })
        await until('the tree', () => document.querySelector('profile-tree .tree-item'))
        await sleep(500)
        const items = [...document.querySelectorAll('profile-tree .tree-item')]
        const out = items.slice(0, 4).map(el => el.querySelector('span').textContent.trim())
        const pinButton = items[1].querySelector('.actions .action')
        const result = { out, title: pinButton.getAttribute('title') }
        zone.run(() => { config.store.showProfileTree = false; config.save() })
        return result
    `)
    check('the tree opens with Pinned and its profiles', tree.out, ['Pinned', second.name, first.name, third.name])
    check('a pinned row in the tree offers Unpin', tree.title, 'Unpin')

    // ── the tab context menu ────────────────────────────────────────────
    console.log('tab context menu')
    const menu = await evaluate(`
        const { core, injector, app } = __P
        const providers = injector.get(core.TabContextMenuItemProvider)
        for (const provider of providers) {
            const items = await provider.getItems(app.tabs[0], true)
            const item = items.find(x => Array.isArray(x.submenu) && x.label === 'New with profile')
            if (item) { return item.submenu.map(x => x.label) }
        }
        return null
    `)
    check('"New with profile" leads with the pins', menu.slice(0, 3), [second.name, first.name, third.name])
    check('and repeats nothing', menu.length, local.length)

    // ── the start page ──────────────────────────────────────────────────
    console.log('start page')
    const commands = await evaluate(`
        const { core, injector } = __P
        const all = await injector.get(core.CommandService).getCommands({})
        return all.filter(c => (c.locations ?? []).includes(core.CommandLocation.StartPage)).map(c => ({ id: c.id, label: c.label }))
    `)
    const selectorAt = commands.findIndex(c => c.id === 'core:profile-selector')
    check('pinned profiles are start-page commands, right after the selector',
        commands.slice(selectorAt + 1, selectorAt + 4).map(c => c.label), [second.name, first.name, third.name])

    // ── the jump list, built and not published ──────────────────────────
    console.log('jump list')
    const jump = await evaluate(`
        const { injector, profiles, config } = __P
        const plugin = window.nodeRequire('tabby-electron')
        const jumpList = injector.get(plugin.JumpListService)
        const all = (await profiles.getProfiles()).filter(x => x.id && !config.store.profileBlacklist.includes(x.id))
        const categories = await jumpList.build([], all, profiles.pinnedAmong(all))
        return categories.map(c => ({ name: c.name, titles: c.items.map(i => i.title), args: c.items.map(i => i.args) }))
    `)
    check('Pinned is the jump list\'s first category', jump[0].name, 'Pinned')
    check('holding the pins', jump[0].titles, [second.name, first.name, third.name])
    check('each launching its profile by name', jump[0].args[0], `profile "${second.name}"`)
    check('and Profiles still follows', jump[jump.length - 1].name, 'Profiles')

    // ── a deleted or hidden profile ─────────────────────────────────────
    console.log('stale and hidden pins')
    const stale = await evaluate(`
        const { profiles, config } = __P
        config.store.pinnedProfiles = ['no-such-profile', ...config.store.pinnedProfiles]
        const withStale = (await profiles.getPinnedProfiles()).map(p => p.id)
        config.store.profileBlacklist = [${JSON.stringify(first.id)}]
        const withHidden = (await profiles.getPinnedProfiles()).map(p => p.id)
        config.store.profileBlacklist = []
        config.store.pinnedProfiles = []
        await config.save()
        return { withStale, withHidden }
    `)
    check('a pin with no profile lists nothing', stale.withStale, [second.id, first.id, third.id])
    check('a hidden profile is not offered, pinned or not', stale.withHidden, [second.id, third.id])

    // ── the Settings tab can be split and handed to another window ──────
    console.log('settings tab: split and new window')
    const split = await evaluate(`
        const { zone, app, core, settings, injector, until, sleep } = __P
        const isSettings = t => t instanceof settings.SettingsTabComponent
        const tab = app.tabs.find(isSettings)
        const before = app.tabs.length
        const token = await injector.get(core.TabRecoveryService).getFullRecoveryToken(tab, { includeState: true })
        const recovered = await injector.get(core.TabRecoveryService).recoverTab(JSON.parse(JSON.stringify(token)))

        // What the tab context menu's Split does for an unwrapped tab.
        let container
        await zone.run(async () => {
            container = app.wrapAndAddTab(tab)
            await container.splitTab(tab, 'r')
        })
        await sleep(800)
        const inside = container.getAllTabs()

        // The toolbar's Settings button must find it in there, not open another.
        const buttons = injector.get(core.ToolbarButtonProvider)
        const gear = buttons.flatMap(p => p.provide()).find(b => b.title === 'Settings')
        zone.run(() => app.selectTab(app.tabs[0]))
        zone.run(() => gear.click())
        await sleep(300)

        const result = {
            tokenType: token && token.type,
            tokenPage: token && token.activeTab,
            recoveredType: !!recovered && recovered.type === settings.SettingsTabComponent,
            recoveredPage: recovered && recovered.inputs.activeTab,
            topLevelBefore: before,
            topLevelAfter: app.tabs.length,
            topLevelSettings: app.tabs.filter(isSettings).length,
            panes: inside.length,
            panesAreSettings: inside.every(isSettings),
            panesOnPage: inside.map(t => t.activeTab),
            panesDrawn: document.querySelectorAll('split-tab settings-tab').length,
            gearSelectedTheSplit: app.activeTab === container,
        }
        zone.run(() => app.closeTab(container, false))
        await sleep(300)
        return result
    `)
    check('a Settings tab has a recovery token', split.tokenType, 'app:settings')
    check('which names the open page', split.tokenPage, 'profiles')
    check('and recovers to a Settings tab', split.recoveredType, true)
    check('on that page', split.recoveredPage, 'profiles')
    check('splitting adds no second top-level tab', split.topLevelAfter, split.topLevelBefore)
    check('the bare Settings tab gives its place to the split', split.topLevelSettings, 0)
    check('the split holds two panes', split.panes, 2)
    check('both of them Settings', split.panesAreSettings, true)
    check('both on the page that was open', split.panesOnPage, ['profiles', 'profiles'])
    check('and both drawn', split.panesDrawn, 2)
    check('the Settings button selects the split rather than opening a third', split.gearSelectedTheSplit, true)

    console.log(`\n${passed} passed, ${failed} failed`)
    process.exitCode = failed ? 1 : 0
}

main().catch(err => {
    console.error(err)
    process.exitCode = 1
}).finally(closeAll)
