// The integration logos actually decode in a renderer.
//
//   node scripts/dev/launch-hidden.mjs --enable links,linkifier &
//   node tabby-links/test/icons.cdp.js
//
// `logic.test.js` proves the resolver returns a data URI and that the bundle
// carries four of them. Neither proves the bytes are a *loadable image*: a
// truncated file, a wrong MIME prefix, or a manifest naming a mark that does
// not exist all produce a string that looks right and an <img> that shows
// nothing. Only a browser that has decoded it can say, which is what
// `complete && naturalWidth` reports.
//
// This is also the assertion that catches the webpack rule being switched to
// `asset/resource`: that emits a path rather than a data URI, and a path is a
// broken image under this bundle's `target: 'node'` with no error anywhere.
const { closeAll, connect } = require('./cdp')

// The marks are authored at 64x64. Asserting the real number rather than ">0"
// means a placeholder or a favicon substituted somewhere would fail too.
const EXPECTED_SIZE = 64

function ok (message) { console.log(`ok    ${message}`) }
function fail (message) { console.error(`FAIL  ${message}`); process.exitCode = 1 }

const OPEN = `
    // CDP answers as soon as the debugger is up, which is well before Angular
    // has an app with tabs — so wait for the app itself rather than trusting a
    // timeout.
    let root = null
    for (let i = 0; i < 80 && !root; i++) {
        const el = document.querySelector('app-root')
        const cmp = el && window.ng.getComponent(el)
        if (cmp && cmp.app && cmp.app.tabs) { root = cmp; break }
        await new Promise(r => setTimeout(r, 250))
    }
    if (!root) { throw new Error('the app never finished starting') }

    const settings = window['nodeRequire']('tabby-settings')
    root.app.openNewTabRaw({ type: settings.SettingsTabComponent, inputs: { activeTab: 'integrations' } })

    // And select it. A tab that is not the active one is never rendered, so on
    // a cold window its content — and the nav this used to hunt for — simply
    // never appears. Warm runs hid it: a settings tab left selected by an
    // earlier run made the new one look like it had rendered.
    {
        const opened = root.app.tabs.find(t => t instanceof settings.SettingsTabComponent)
        if (opened) { root.app.selectTab(opened) }
    }
    // The first settings tab on a cold window takes appreciably longer to
    // render than a later one, and the open can land before the app will act on
    // it. A much longer wait, plus one re-issue if no settings nav appeared at
    // all, rather than spending the whole budget on a call that was dropped.
    let link = null
    for (let i = 0; i < 120 && !link; i++) {
        await new Promise(r => setTimeout(r, 250))
        link = [...document.querySelectorAll('.nav-link')].find(e => e.textContent.trim() === 'Integrations')
        if (!link && i === 40 && !document.querySelector('.nav-link')) {
            root.app.openNewTabRaw({ type: settings.SettingsTabComponent, inputs: { activeTab: 'integrations' } })
        }
    }
    if (!link) { throw new Error('no Integrations item in the settings nav') }
    link.click()
    await new Promise(r => setTimeout(r, 800))
    // The *last* one: a previous run may have left a Settings tab open, and
    // querying the whole document would then count every tab's rows at once.
    const hosts = [...document.querySelectorAll('integrations-settings-tab')]
    window.__HOST = hosts[hosts.length - 1]
    const c = window.__HOST && window.ng.getComponent(window.__HOST)
    if (!c) { throw new Error('the Integrations page did not render') }
    await c.select(null)
    window.ng.applyChanges(c)
    // Polled, not slept: on a cold window the list renders well after the nav
    // item it was found by, and every row must be on screen before the images
    // in them can be asked whether they decoded.
    for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 200))
        window.ng.applyChanges(c)
        if (window.__HOST.querySelectorAll('.integration-row').length >= c.integrations.length) { break }
    }
    return c.integrations.map(x => ({ id: x.id, name: x.name, iconUri: (x.iconUri || '').slice(0, 24) }))
`

// Decoding is asynchronous, so a freshly rendered <img> can legitimately report
// complete === false for a moment. `decode()` settles that without a sleep, and
// rejects on bytes the browser cannot read — which is the failure being hunted.
const MEASURE = `
    const rows = [...window.__HOST.querySelectorAll('.integration-row')]
    const out = []
    for (const row of rows) {
        // The first span only: the row also carries a "Not configured" badge
        // inside .integration-name, which would otherwise land in the label.
        const name = ((row.querySelector('.integration-name span') || {}).textContent || '')
        const img = row.querySelector('img.integration-icon')
        if (!img) { out.push({ name: name.trim(), img: false }); continue }
        let decoded = true
        let error = ''
        try { await img.decode() } catch (e) { decoded = false; error = String(e && e.message || e) }
        out.push({
            name: name.trim(),
            img: true,
            decoded,
            error,
            complete: img.complete,
            naturalWidth: img.naturalWidth,
            naturalHeight: img.naturalHeight,
            scheme: (img.currentSrc || img.src).split(',')[0].slice(0, 32),
        })
    }
    return out
`

async function main () {
    const cdp = await connect()
    const integrations = await cdp.evaluate(OPEN)
    if (!integrations.length) {
        fail('no integrations were listed — nothing to measure')
        return
    }
    ok(`${integrations.length} integrations listed`)

    const rows = await cdp.evaluate(MEASURE)
    for (const row of rows) {
        if (!row.img) {
            fail(`${row.name}: no <img> in the row — the icon did not resolve`)
            continue
        }
        if (!row.decoded) {
            fail(`${row.name}: the browser could not decode the icon — ${row.error}`)
            continue
        }
        if (!row.scheme.startsWith('data:image/png')) {
            // A path rather than a data URI is what `asset/resource` produces.
            fail(`${row.name}: icon is not an inlined PNG (${row.scheme})`)
            continue
        }
        if (row.naturalWidth !== EXPECTED_SIZE || row.naturalHeight !== EXPECTED_SIZE) {
            fail(`${row.name}: decoded ${row.naturalWidth}x${row.naturalHeight}, expected ${EXPECTED_SIZE}x${EXPECTED_SIZE}`)
            continue
        }
        ok(`${row.name}: decoded ${row.naturalWidth}x${row.naturalHeight} from an inlined PNG`)
    }

    // Every listed integration must have produced a row with an icon: a
    // manifest naming an unbundled file is the one failure with no symptom
    // beyond an absent image.
    const withIcons = rows.filter(r => r.img && r.decoded).length
    if (withIcons !== integrations.length) {
        fail(`${withIcons} of ${integrations.length} rows carry a decodable icon`)
    } else {
        ok(`all ${integrations.length} rows carry a decodable icon`)
    }
}

main().catch(err => {
    fail(err.stack || String(err))
}).finally(closeAll)
