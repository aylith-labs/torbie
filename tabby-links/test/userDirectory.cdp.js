// The folder button on Settings → Integrations, in a real window.
//
//   node scripts/dev/launch-hidden.mjs --enable links,linkifier &
//   node tabby-links/test/userDirectory.cdp.js
//
// "To add your own, drop a folder containing an integration.json into <dir>"
// has a button that opens <dir>. On a fresh profile it did nothing at all:
// `<config dir>/integrations` does not exist until someone makes it,
// `shell.openPath` answers a missing path with an error *string* rather than a
// rejection, and `PlatformService.openPath` threw that string away.
//
// Two rules keep this suite off the desktop and out of real data:
//
// - `platform.openPath` is stubbed for the run. Letting it through would open
//   Explorer in front of whoever is at the keyboard. What is asserted is that
//   the button handed the directory over, which is the part this plugin owns.
// - Nothing is created or removed outside the registered scratch profile. The
//   directory is resolved from the page, then checked to sit inside the profile
//   `launch-hidden.mjs` recorded for this port, before anything touches it.
const fs = require('fs')
const path = require('path')
const { closeAll, connect, liveInstances } = require('./cdp')

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

/**
 * The profile of the instance this suite attaches to, from the launcher's own
 * registration. Not from `TABBY_CONFIG_DIRECTORY`: a shell inside Tabby
 * inherits that from the installed app, which is the user's real profile.
 */
function profileDirectory () {
    const running = liveInstances()
    const port = process.env.CDP_PORT ? Number(process.env.CDP_PORT) : null
    const matching = port ? running.filter(x => x.port === port) : running
    if (matching.length === 1 && matching[0].profile) {
        return matching[0].profile
    }
    if (matching.length > 1) {
        throw new Error(`${matching.length} dev builds are registered — say which with CDP_PORT`)
    }
    throw new Error('no registered dev build for this port; start one with scripts/dev/launch-hidden.mjs')
}

const OPEN = `
    let root = null
    for (let i = 0; i < 80 && !root; i++) {
        const el = document.querySelector('app-root')
        const cmp = el && window.ng.getComponent(el)
        if (cmp && cmp.app && cmp.app.tabs) { root = cmp; break }
        await new Promise(r => setTimeout(r, 250))
    }
    if (!root) { throw new Error('the app never finished starting') }
    const settings = window['nodeRequire']('tabby-settings')
    // One settings tab, reused: several pages stay in the DOM at once, and a
    // second tab would double every query below.
    const existing = root.app.tabs.find(t => t instanceof settings.SettingsTabComponent)
    if (existing) {
        root.app.selectTab(existing)
        existing.activeTab = 'integrations'
    } else {
        root.app.openNewTabRaw({ type: settings.SettingsTabComponent, inputs: { activeTab: 'integrations' } })
        const opened = root.app.tabs.find(t => t instanceof settings.SettingsTabComponent)
        if (opened) { root.app.selectTab(opened) }
    }
    let link = null
    for (let i = 0; i < 120 && !link; i++) {
        await new Promise(r => setTimeout(r, 250))
        link = [...document.querySelectorAll('.nav-link')].find(e => e.textContent.trim() === 'Integrations')
    }
    if (!link) { throw new Error('no Integrations item in the settings nav') }
    link.click()
    let host = null
    for (let i = 0; i < 40 && !host; i++) {
        await new Promise(r => setTimeout(r, 250))
        host = [...document.querySelectorAll('integrations-settings-tab')].pop()
    }
    if (!host) { throw new Error('the Integrations page did not render') }
    const page = window.ng.getComponent(host)
    // The list, not a detail view left open by an earlier run.
    await page.select(null)
    window.ng.applyChanges(page)
    await new Promise(r => setTimeout(r, 300))
    window.__UD = { host, page }
    return page.userDirectory
`

// Stub the two services the button talks to, recording what it asks of them.
// Own properties over the prototype methods, so `delete` puts them back.
const STUB = `
    const { page } = window.__UD
    for (const [owner, key] of [[page.platform, 'openPath'], [page.notifications, 'error']]) {
        if (Object.prototype.hasOwnProperty.call(owner, key)) {
            throw new Error(key + ' is already stubbed; refusing to stack a second stub')
        }
    }
    window.__UD.opened = []
    window.__UD.errors = []
    page.platform.openPath = p => { window.__UD.opened.push(p) }
    page.notifications.error = (text, details) => { window.__UD.errors.push({ text, details }) }
    return true
`

const RESTORE = `
    const { page } = window.__UD
    delete page.platform.openPath
    delete page.notifications.error
    return typeof page.platform.openPath === 'function' && typeof page.notifications.error === 'function'
`

// The real button, clicked, then long enough for an async mkdir to finish.
const CLICK = `
    const { host } = window.__UD
    const button = host.querySelector('.user-dir .open-user-dir')
    if (!button) { throw new Error('no folder button on the Integrations page') }
    button.click()
    for (let i = 0; i < 20 && !window.__UD.opened.length && !window.__UD.errors.length; i++) {
        await new Promise(r => setTimeout(r, 100))
    }
    await new Promise(r => setTimeout(r, 200))
    return { opened: [...window.__UD.opened], errors: window.__UD.errors.map(e => ({ ...e })) }
`

async function main () {
    const profile = path.resolve(profileDirectory())
    const { evaluate } = await connect()

    console.log('\n── the directory belongs to the scratch profile ──')
    const directory = await evaluate(OPEN)
    note(`profile:   ${profile}`)
    note(`directory: ${directory}`)
    const inside = !!directory && path.resolve(directory).startsWith(profile + path.sep)
    check('the page names a directory inside the registered profile', inside, true)
    if (!inside) {
        throw new Error('refusing to touch a directory outside the scratch profile')
    }

    // Start from what a fresh profile has: no directory. An empty one left by
    // an earlier run is removed; anything with content in it is somebody's,
    // and the suite stops rather than deleting it.
    const existedAtStart = fs.existsSync(directory)
    if (existedAtStart) {
        if (!fs.statSync(directory).isDirectory() || fs.readdirSync(directory).length) {
            throw new Error(`${directory} already holds something; use a fresh profile`)
        }
        fs.rmdirSync(directory)
    }

    await evaluate(STUB)
    try {
        console.log('\n── a click creates the directory, then hands it to the shell ──')
        check('the directory is not there before the click', fs.existsSync(directory), false)
        const first = await evaluate(CLICK)
        check('the click created it', fs.existsSync(directory) && fs.statSync(directory).isDirectory(), true)
        check('and asked the platform to open exactly that path', first.opened, [directory])
        check('without reporting an error', first.errors, [])

        const second = await evaluate(CLICK)
        check('a second click opens it again rather than failing on it', second.opened, [directory, directory])
        check('still without an error', second.errors, [])

        console.log('\n── when it cannot be created, the page says so ──')
        // A *file* where the directory should be: `mkdir` with `recursive`
        // refuses it, which is the failure this is for.
        fs.rmdirSync(directory)
        fs.writeFileSync(directory, 'not a directory')
        const blocked = await evaluate(CLICK)
        check('nothing was handed to the shell', blocked.opened.length, 2)
        check('one error notification', blocked.errors.length, 1)
        check('saying what could not be opened',
            blocked.errors[0]?.text, 'Could not open the integrations folder')
        check('and naming the path', String(blocked.errors[0]?.details).includes(directory), true)
        note(`notification detail: ${blocked.errors[0]?.details}`)
        fs.unlinkSync(directory)

        console.log('\n── the icon-only buttons say what they do ──')
        const names = await evaluate(`
            const { host } = window.__UD
            return [...host.querySelectorAll('.user-dir button')]
                .map(b => [b.getAttribute('title'), b.getAttribute('aria-label')])
        `)
        check('both carry a title and an accessible name',
            names, [['Copy path', 'Copy path'], ['Open folder', 'Open folder']])
    } finally {
        check('the stubs are removed again', await evaluate(RESTORE), true)
        // Leave the profile as it was found.
        if (fs.existsSync(directory) && fs.statSync(directory).isFile()) {
            fs.unlinkSync(directory)
        }
        if (!existedAtStart && fs.existsSync(directory) && !fs.readdirSync(directory).length) {
            fs.rmdirSync(directory)
        }
        if (existedAtStart && !fs.existsSync(directory)) {
            fs.mkdirSync(directory)
        }
    }

    console.log(`\n${passed} passed, ${failed} failed`)
    process.exitCode = failed ? 1 : 0
}

main().catch(err => {
    console.error(`FAIL  ${err.stack || err}`)
    process.exitCode = 1
}).finally(closeAll)
