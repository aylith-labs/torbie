// The rule editor's live preview, and the preset dedup, in a real window.
//
//   node scripts/dev/launch-hidden.mjs --enable links,linkifier &
//   node tabby-links/test/ruleEditor.cdp.js
//
// The assertion worth having here is that the preview shows the sample and
// nothing else. pug is compiled with `pretty: true`, so indentation between two
// *literal* sibling elements becomes a real space in the rendered text — the
// hazard the Windows Terminal fork hit with three side-by-side text blocks. It
// does not arise here, because the segments come from one `*ngFor` over one
// element and Angular inserts nothing between the instances; this is what says
// so rather than assuming it. Both text views are checked, since they can
// disagree: `innerText` is the rendered model and would report a line break per
// segment if these were flex items, which is how the first version of this went
// wrong.
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

// Open Settings on Link Tooltip and expose the page component.
const OPEN = `
    // CDP answers as soon as the debugger is up, which is well before Angular
    // has an app with tabs — so wait for the app itself rather than trusting a
    // timeout. Measured: on a cold window this opened Settings into nothing and
    // then hunted for a nav item that did not exist yet.
    let root = null
    for (let i = 0; i < 80 && !root; i++) {
        const el = document.querySelector('app-root')
        const cmp = el && window.ng.getComponent(el)
        if (cmp && cmp.app && cmp.app.tabs) { root = cmp; break }
        await new Promise(r => setTimeout(r, 250))
    }
    if (!root) { throw new Error('the app never finished starting') }

    const settings = window['nodeRequire']('tabby-settings')
    root.app.openNewTabRaw({ type: settings.SettingsTabComponent, inputs: { activeTab: 'link-tooltip' } })

    // And select it. A tab that is not the active one is never rendered, so on
    // a cold window its content — and the nav this used to hunt for — simply
    // never appears. Warm runs hid it: a settings tab left selected by an
    // earlier run made the new one look like it had rendered.
    {
        const opened = root.app.tabs.find(t => t instanceof settings.SettingsTabComponent)
        if (opened) { root.app.selectTab(opened) }
    }
    // The first settings tab on a cold window takes appreciably longer to
    // render than a later one — measured failing repeatedly at a 10s budget —
    // and the open can land before the app will act on it. So: a much longer
    // wait, and one re-issue if no settings nav appeared at all, rather than
    // spending the whole budget waiting on a call that was dropped.
    let link = null
    for (let i = 0; i < 120 && !link; i++) {
        await new Promise(r => setTimeout(r, 250))
        link = [...document.querySelectorAll('.nav-link')].find(e => e.textContent.trim() === 'Link Tooltip')
        if (!link && i === 40 && !document.querySelector('.nav-link')) {
            root.app.openNewTabRaw({ type: settings.SettingsTabComponent, inputs: { activeTab: 'link-tooltip' } })
        }
    }
    if (!link) { throw new Error('no Link Tooltip item in the settings nav') }
    link.click()
    await new Promise(r => setTimeout(r, 800))
    const hosts = [...document.querySelectorAll('link-tooltip-settings-tab')]
    window.__HOST = hosts[hosts.length - 1]
    window.__P = window.__HOST && window.ng.getComponent(window.__HOST)
    if (!window.__P) { throw new Error('the Link Tooltip page did not render') }
    window.__CFG = ${ROOT}.config
`

async function main () {
    const { evaluate } = await connect()
    await evaluate(OPEN)

    // ── the whitespace hazard ───────────────────────────────────────────────
    // A sample with a double space and a trailing space: exactly the shape that
    // markup-injected whitespace would silently normalise away.
    console.log('\n── the preview shows the sample, character for character ──')
    const SAMPLE = 'see  PROJ-1234 and PROJ-9 '
    const rendered = await evaluate(`
        const p = window.__P
        window.__CFG.store.linkTooltip.rules = []
        await window.__CFG.save()
        p.addRule()
        p.currentRule.match = 'text'
        p.currentRule.pattern = '[A-Z]{2,}-\\\\d+'
        p.sampleText = ${JSON.stringify(SAMPLE)}
        p.runProbe()
        window.ng.applyChanges(p)
        // Polled, not slept: on a cold window the page renders well after the
        // nav item it was found by, and a fixed wait either flakes or is far
        // longer than it needs to be every other time.
        let el = null
        for (let i = 0; i < 60 && !el; i++) {
            await new Promise(r => setTimeout(r, 200))
            window.ng.applyChanges(p)
            el = window.__HOST.querySelector('.sample-render')
        }
        if (!el) { throw new Error('the sample preview did not render') }
        return {
            innerText: el.innerText,
            textContent: el.textContent,
            display: getComputedStyle(el).display,
            hits: [...el.querySelectorAll('.seg-hit')].map(n => n.textContent),
            segments: p.probeSegments.length,
            distinctTops: [...new Set([...el.querySelectorAll('.seg')]
                .map(n => Math.round(n.getBoundingClientRect().top)))].length,
        }
    `)
    note(`display: ${rendered.display}, segments: ${rendered.segments}`)
    // `innerText` is the rendered text model — what a selection and a copy see.
    check('the rendered text is exactly the sample', rendered.innerText, SAMPLE)
    check('and so is the DOM text', rendered.textContent, SAMPLE)
    check('both matches are highlighted', rendered.hits, ['PROJ-1234', 'PROJ-9'])
    check('the sample really was cut into several segments, so this is not vacuous',
        rendered.segments, 5)
    // Ordinary inline content. A flex container was tried here first as belt
    // and braces against pug's `pretty: true`: it looks identical — measured,
    // every segment on one line — but flex items are block-level, so
    // `innerText` gains a line break between each of them.
    check('the segments are inline, not flex items', rendered.display !== 'flex', true)
    check('and they all render on one line', rendered.distinctTops, 1)

    // ── the preview refuses what the terminal would refuse ──────────────────
    console.log('\n── the preview agrees with the terminal ──')
    const criteria = await evaluate(`
        const p = window.__P
        p.currentRule.match = 'link'
        p.currentRule.pattern = 'example'
        p.currentRule.schemes = ['ftp']
        p.sampleText = 'https://example.com/x'
        p.runProbe()
        window.ng.applyChanges(p)
        await new Promise(r => setTimeout(r, 300))
        const verdicts = [...window.__HOST.querySelectorAll('.sample-verdict')].map(n => n.textContent.trim())
        return { rejectedBy: p.probe.rejectedBy, spans: p.probe.spans.length, verdicts }
    `)
    check('a pattern that matches but a scheme that does not is reported as such',
        [criteria.spans > 0, criteria.rejectedBy], [true, 'scheme'])
    check('and the page says so rather than showing a bare highlight',
        criteria.verdicts.some(v => v.includes('scheme')), true)

    const bad = await evaluate(`
        const p = window.__P
        p.currentRule.schemes = []
        p.currentRule.pattern = '([a-z'
        p.sampleText = 'anything'
        p.runProbe()
        window.ng.applyChanges(p)
        await new Promise(r => setTimeout(r, 300))
        return { error: p.probe.error, shown: p.patternError }
    `)
    check('an uncompilable pattern is reported', bad.error.length > 0, true)
    check('and the page shows that same message, not a second opinion',
        bad.shown, bad.error)

    // ── preset dedup ────────────────────────────────────────────────────────
    console.log('\n── a preset already in the list is not offered again ──')
    const dedup = await evaluate(`
        const p = window.__P
        window.__CFG.store.linkTooltip.rules = []
        await window.__CFG.save()
        p.currentRule = null
        const preset = p.presets.find(x => x.pattern)
        if (!preset) { throw new Error('no preset with a pattern to test with') }
        const before = p.presetInUse(preset)
        p.addRuleFromPreset(preset)
        await new Promise(r => setTimeout(r, 300))
        const after = p.presetInUse(preset)
        // The editor's own menu must still offer the preset the open rule is:
        // there it means "re-sync me", not "duplicate me".
        const inEditor = p.presetInUseElsewhere(preset)
        // And a hand-edited pattern must not lose the rule its name identifies.
        p.currentRule.pattern = 'something-else-entirely'
        const afterEdit = p.presetInUse(preset)
        return { name: preset.name, before, after, inEditor, afterEdit }
    `)
    note(`preset: ${dedup.name}`)
    check('a preset is offered when it is not in the list', dedup.before, false)
    check('and not offered once it is', dedup.after, true)
    check('but the open rule may still re-apply its own preset', dedup.inEditor, false)
    // Name first, pattern as the fallback: the reference fork found this by
    // shipping a preset whose pattern changed, leaving an older rule unmatched.
    check('a hand-edited pattern does not make it offerable again', dedup.afterEdit, true)

    // ── the settings groups ─────────────────────────────────────────────────
    console.log('\n── the page is grouped, and remembers what was open ──')
    const groups = await evaluate(`
        const btns = [...window.__HOST.querySelectorAll('.accordion-button')]
        return {
            headers: btns.map(b => b.textContent.trim()),
            // Nothing may disable an accordion item: that disables its own
            // header, and the master switch lives inside the group.
            headerDisabled: btns.map(b => b.disabled),
            expanded: btns.map(b => b.getAttribute('aria-expanded')),
            ungrouped: [...window.__HOST.querySelectorAll(':scope > .form-line .title')]
                .map(t => t.textContent.trim()),
        }
    `)
    check('the four groups are there',
        groups.headers, ['Hover card', 'Buttons', 'Clicking', 'Integration previews'])
    check('no group header is ever disabled', groups.headerDisabled, [false, false, false, false])
    // `allowHtml` governs the preview pane too, which outlives the card — so it
    // must not sit under the card's master switch, where it would be greyed out
    // while still applying. Its own group is how that is expressed.
    check('integration previews are their own group, not part of the card',
        groups.headers.includes('Integration previews'), true)
    // These two are governed by nothing on this page and stay out of every group.
    check('detection and safe schemes stay ungrouped', groups.ungrouped,
        ['Automatically detect URLs and make them clickable', 'URI schemes that open without a warning'])

    const remembered = await evaluate(`
        const p = window.__P
        // Close the one that starts open, and open one that starts closed.
        p.setCollapsed('card', true)
        p.setCollapsed('buttons', false)
        const stored = JSON.parse(window.localStorage.linkTooltipGroupCollapsed || '{}')
        // A save fires config.changed$ under the page — the moment the old flat
        // page would have had nothing to lose and this one does.
        await window.__CFG.save()
        await new Promise(r => setTimeout(r, 400))
        return {
            stored,
            afterSave: [p.collapsed('card'), p.collapsed('buttons')],
            // An id nobody has stored falls back to its author's default, not
            // to "open", so a group added later starts where it was meant to.
            unknownId: p.collapsed('a-group-added-later'),
            previewsDefault: p.collapsed('previews'),
        }
    `)
    check('the state is written to localStorage',
        [remembered.stored.card, remembered.stored.buttons], [true, false])
    check('and survives a config save', remembered.afterSave, [true, false])
    check('an unrecorded group falls back to its own default', remembered.unknownId, false)
    check('which is not the same as "open" for every group', remembered.previewsDefault, true)

    // Rebuilt from scratch is the real test: `ngbNav` destroys hidden tab
    // content, so navigating away and back constructs this page again.
    const afterNav = await evaluate(`
        const nav = [...document.querySelectorAll('.nav-link')]
        nav.find(e => e.textContent.trim() === 'Window').click()
        await new Promise(r => setTimeout(r, 600))
        nav.find(e => e.textContent.trim() === 'Link Tooltip').click()
        await new Promise(r => setTimeout(r, 900))
        const host = [...document.querySelectorAll('link-tooltip-settings-tab')].pop()
        window.__HOST = host
        window.__P = window.ng.getComponent(host)
        const btns = [...host.querySelectorAll('.accordion-button')]
        return {
            rebuilt: window.__P !== null,
            expanded: btns.map(b => b.getAttribute('aria-expanded')),
        }
    `)
    check('the page really was rebuilt', afterNav.rebuilt, true)
    check('and the groups came back as they were left',
        afterNav.expanded.slice(0, 2), ['false', 'true'])

    // The other hard rule: gating goes on the rows, never on the group.
    console.log('\n── a switched-off group greys its rows, not its header ──')
    const gated = await evaluate(`
        window.__CFG.store.linkTooltip.clickable = false
        await window.__CFG.save()
        const p = window.__P
        p.setCollapsed('clicking', false)
        window.ng.applyChanges(p)
        await new Promise(r => setTimeout(r, 700))
        const btns = [...window.__HOST.querySelectorAll('.accordion-button')]
        const clicking = btns.find(b => b.textContent.trim() === 'Clicking')
        const body = clicking.closest('.accordion-item')
        // The master switch is the group's first row and must stay usable, or
        // the group could never be switched back on. Everything after it is
        // what the switch governs.
        const rows = [...body.querySelectorAll('.form-line')]
        const master = rows[0]
        const dependent = rows.slice(1).flatMap(r => [...r.querySelectorAll('select, input')])
        return {
            headerStillClickable: !clicking.disabled,
            expanded: clicking.getAttribute('aria-expanded'),
            rows: rows.length,
            dependentControls: dependent.length,
            allDisabled: dependent.length > 0 && dependent.every(c => c.disabled),
            masterEnabled: [...master.querySelectorAll('input, select')].every(c => !c.disabled),
        }
    `)
    check('the Clicking header is still usable with clicking off',
        gated.headerStillClickable, true)
    check('and the group still opens', gated.expanded, 'true')
    check('its dependent controls are greyed', gated.allDisabled, true)
    check('while the master switch that turns it back on is not',
        gated.masterEnabled, true)

    // Leave the profile as it was found.
    await evaluate(`
        window.__CFG.store.linkTooltip.clickable = true
        window.__P.currentRule = null
        window.__CFG.store.linkTooltip.rules = []
        await window.__CFG.save()
        delete window.localStorage.linkTooltipGroupCollapsed
        return true
    `)

    console.log(`\n${passed} passed, ${failed} failed`)
    process.exitCode = failed ? 1 : 0
}

main().catch(err => {
    console.error(`FAIL  ${err.stack || err}`)
    process.exitCode = 1
}).finally(closeAll)
