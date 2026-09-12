#!/usr/bin/env node
// Text contrast on every settings page, the tab bar, the settings nav and the
// profile selector — in the light scheme and the dark one — measured in a
// hidden dev build.
//
//   node scripts/dev/launch-hidden.mjs --enable links,linkifier,claude,builds --port 9246 &
//   CDP_PORT=9246 node scripts/dev/contrast-audit.cdp.cjs [--mode light|dark]
//       [--page "Builds,Link Tooltip"] [--min 4.5] [--json out.json] [--strict]
//       [--inject-css extra.css]
//   CDP_PORT=9246 node scripts/dev/contrast-audit.cdp.cjs --self-test
//
// Leave the launcher running rather than passing it --keep: the instance lives
// only as long as that command does.
//
// A screenshot cannot say whether a page of thirty rows at four opacities is
// readable; a number per text run can. Each visible text run is measured the
// way it is composited. Every element is an isolated group — its background,
// then its content, the whole multiplied by its opacity and laid over what is
// behind it — all the way up to the root. So an ancestor's opacity dims the
// background it paints and the text on it together, which is how a browser
// draws them. The first version multiplied opacity into the text alone and
// stopped at the first opaque background; it scored white text in a
// half-opacity black box at 5.28:1, where the composited result is 4.04:1.
//
// Also measured: the value, or failing that the placeholder, of every text
// input and select. Bootstrap 5.3 paints a table cell's background as an inset
// box-shadow, which is read as a layer above the background colour. A gradient
// background-image is not read, and a failure over one says so.
//
// Thresholds are WCAG 2.2 AA: 4.5:1, or 3:1 for large text (24px, or 18.66px
// bold). Disabled controls are exempt, as WCAG exempts them. Icons are not text
// and are not measured, and neither is anything with no box — a collapsed
// group, which is why every accordion group on a page is opened first.
//
// `--self-test` plants fixtures with known ratios, one per rule above, and fails
// unless the audit reports each one exactly. Run it after changing how anything
// is measured. `--inject-css` adds a stylesheet before measuring, which is how
// a before-and-after is taken without a rebuild.
//
// It changes `appearance.colorSchemeMode` in the instance it attaches to, and
// puts it back when it is done, which is why it is only ever pointed at a hidden
// build on a scratch profile.
const fs = require('fs')
const { closeAll, connect } = require('./cdp.cjs')

function arg (name, fallback) {
    const i = process.argv.indexOf(`--${name}`)
    return i === -1 ? fallback : process.argv[i + 1]
}

const MODES = arg('mode') ? [arg('mode')] : ['light', 'dark']
// `--page "Builds,Link Tooltip"` audits those settings pages only (by nav label,
// case-insensitive) and skips the chrome and the profile selector.
const PAGES = arg('page') ? arg('page').split(',').map(x => x.trim().toLowerCase()) : null
const MIN = Number(arg('min', '4.5'))
const JSON_OUT = arg('json')
const STRICT = process.argv.includes('--strict')
const SELF_TEST = process.argv.includes('--self-test')
const INJECT_CSS = arg('inject-css') ? fs.readFileSync(arg('inject-css'), 'utf8') : null

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

// The settings tab's own nav and its active page — not a nav or a pane nested
// inside a page. Pages have tabs of their own, and more than one page can be in
// the DOM at once.
const LOCATE = `
    const settingsTab = () => document.querySelector('settings-tab')
    const settingsNav = () => {
        const tab = settingsTab()
        return tab ? [...tab.querySelectorAll('.nav')].find(n => !n.closest('.tab-pane')) ?? null : null
    }
    const settingsPane = () => {
        const tab = settingsTab()
        return tab ? [...tab.querySelectorAll('.tab-pane.active')].find(p => !p.parentElement.closest('.tab-pane')) ?? null : null
    }
    const navLinks = () => {
        const nav = settingsNav()
        return nav ? [...nav.querySelectorAll('.nav-link')] : []
    }
`

const INSTALL = `
    const TRANSPARENT = [0, 0, 0, 0]
    const WHITE = [255, 255, 255, 1]
    // Chromium serialises a computed sRGB colour as rgb()/rgba(), and the result
    // of a color-mix() as color(srgb r g b / a); both are parsed exactly.
    // Anything else (oklch, lab) goes through a 1px canvas, which is the fallback
    // rather than the rule because an 8-bit readback of a faint tint loses most
    // of its channel precision.
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    const viaCanvas = new Map()
    const parse = s => {
        s = s.trim()
        if (s === 'transparent') { return TRANSPARENT }
        if (s.startsWith('rgb')) {
            const p = s.slice(s.indexOf('(') + 1, s.lastIndexOf(')')).replace('/', ',').split(/[ ,]+/).filter(Boolean).map(Number)
            return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]
        }
        if (s.startsWith('color(srgb ')) {
            const p = s.slice(11, s.lastIndexOf(')')).replace('/', ' ').split(/\\s+/).filter(Boolean).map(Number)
            return [p[0] * 255, p[1] * 255, p[2] * 255, p.length > 3 ? p[3] : 1]
        }
        if (viaCanvas.has(s)) { return viaCanvas.get(s) }
        ctx.clearRect(0, 0, 1, 1)
        ctx.fillStyle = '#000'
        ctx.fillStyle = s
        ctx.fillRect(0, 0, 1, 1)
        const d = ctx.getImageData(0, 0, 1, 1).data
        const v = [d[0], d[1], d[2], d[3] / 255]
        viaCanvas.set(s, v)
        return v
    }
    const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4) }
    const lum = c => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2])
    const ratio = (a, b) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
    // Source-over, for two colours that may both be translucent (straight alpha).
    const over = (top, under) => {
        const a = top[3] + under[3] * (1 - top[3])
        if (a <= 0) { return TRANSPARENT }
        const mix = i => (top[i] * top[3] + under[i] * under[3] * (1 - top[3])) / a
        return [mix(0), mix(1), mix(2), a]
    }
    const fade = (c, op) => [c[0], c[1], c[2], c[3] * op]
    // Bootstrap 5.3 paints table cells as box-shadow: inset 0 0 0 9999px <colour>.
    // Any inset shadow with a spread that large covers the box, so it is a fill.
    const insetFill = shadow => {
        if (!shadow || shadow === 'none' || !shadow.includes('inset')) { return TRANSPARENT }
        let fill = TRANSPARENT
        // Listed top first, so they are laid down last to first.
        for (const part of shadow.split(/,(?![^(]*\\))/).reverse()) {
            if (!part.includes('inset')) { continue }
            const lengths = [...part.matchAll(/(-?[\\d.]+)px/g)].map(m => Number(m[1]))
            const colour = part.match(/(rgba?\\([^)]*\\)|color\\([^)]*\\))/)
            if (lengths.length >= 4 && lengths[3] >= 500 && colour) { fill = over(parse(colour[1]), fill) }
        }
        return fill
    }
    const hex = c => '#' + c.slice(0, 3).map(v => Math.round(v).toString(16).padStart(2, '0')).join('')
    const label = el => {
        let s = el.tagName.toLowerCase()
        const cls = [...el.classList].filter(c => !c.startsWith('ng-')).slice(0, 3)
        if (cls.length) { s += '.' + cls.join('.') }
        return s
    }
    const path = el => {
        const parts = []
        for (let n = el, i = 0; n && i < 4; n = n.parentElement, i++) { parts.unshift(label(n)) }
        return parts.join(' > ')
    }
    const DISABLED = ':disabled, [disabled], .disabled, [aria-disabled="true"]'

    window.__contrastAudit = (root, surface, min) => {
        // Kept last in <head>, so an injected stylesheet still wins over
        // component styles Angular added after it.
        const extra = document.getElementById('__contrast_audit_css')
        if (extra && extra !== document.head.lastElementChild) { document.head.appendChild(extra) }

        const style = new Map()
        const cs = el => { let s = style.get(el); if (!s) { s = getComputedStyle(el); style.set(el, s) } return s }
        const found = new Map()
        let measured = 0

        // The text as drawn, and the pixels right beside it, both composited up
        // to the root and finally over an opaque white canvas.
        const composite = (el, fg) => {
            let text = fg
            let beside = TRANSPARENT
            let alpha = fg[3]
            const dimmedBy = []
            const images = []
            for (let n = el; n; n = n.parentElement) {
                const ns = cs(n)
                if (ns.backgroundImage !== 'none' && beside[3] < 0.999) { images.push(label(n)) }
                const own = over(insetFill(ns.boxShadow), parse(ns.backgroundColor))
                text = over(text, own)
                beside = over(beside, own)
                const op = parseFloat(ns.opacity)
                if (op < 1) {
                    text = fade(text, op)
                    beside = fade(beside, op)
                    alpha *= op
                    dimmedBy.push(label(n) + '@' + op)
                }
            }
            return { text: over(text, WHITE), beside: over(beside, WHITE), alpha, dimmedBy, images }
        }

        const record = (el, raw, colour, kind) => {
            const text = raw.split(/\\s+/).join(' ').trim()
            if (!text) { return }
            const s = cs(el)
            const c = composite(el, parse(colour))
            // Nothing is drawn: a hover-reveal at rest, or opacity: 0.
            if (c.alpha <= 0.01) { return }
            const r = ratio(c.text, c.beside)
            const size = parseFloat(s.fontSize)
            const weight = parseInt(s.fontWeight, 10) || 400
            const need = size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : min
            measured++
            if (r + 1e-9 >= need) { return }
            const where = path(el)
            const planted = el.closest('[data-case]')
            const key = [kind, where, hex(c.text), hex(c.beside), planted ? planted.dataset.case : ''].join('|')
            const prev = found.get(key)
            if (prev) { prev.count++; return }
            found.set(key, {
                surface,
                kind,
                text: text.slice(0, 50),
                path: where,
                fg: hex(c.text),
                bg: hex(c.beside),
                ratio: Math.round(r * 100) / 100,
                need,
                size,
                weight,
                dimmedBy: c.dimmedBy.join(' '),
                ...(c.images.length ? { backgroundImage: c.images.join(' ') } : {}),
                ...(planted ? { case: planted.dataset.case } : {}),
                count: 1,
            })
        }

        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
        const range = document.createRange()
        let excluded = 0
        for (let t = walker.nextNode(); t; t = walker.nextNode()) {
            if (!t.textContent.trim()) { continue }
            const el = t.parentElement
            if (!el || el.closest('script, style, textarea, select, option, .skeleton, .skeleton-line')) { continue }
            // A colour scheme preview draws the palette it previews, ANSI black on
            // the scheme's own black included; that is data, not the app's
            // chrome, and the Color scheme page alone holds ~2,700 such runs. The
            // terminal grid is the same. Counted, so a run says it skipped them.
            if (el.closest('color-scheme-preview, .xterm')) { excluded++; continue }
            if (el.closest(DISABLED)) { continue }
            // The text's own boxes, not its element's: an element can have a box
            // while the run inside it has none.
            range.selectNodeContents(t)
            if (![...range.getClientRects()].some(b => b.width > 0 && b.height > 0)) { continue }
            if (cs(el).visibility !== 'visible') { continue }
            record(el, t.textContent, cs(el).color, 'text')
        }

        for (const input of root.querySelectorAll('input, textarea, select')) {
            if (/^(checkbox|radio|range|color|hidden|file|button|submit|reset|image)$/.test(input.type)) { continue }
            if (input.closest(DISABLED)) { continue }
            const box = input.getBoundingClientRect()
            if (!box.width || !box.height || cs(input).visibility !== 'visible') { continue }
            if (input.tagName === 'SELECT') {
                const option = input.selectedOptions[0]
                if (option) { record(input, option.textContent, cs(input).color, 'value') }
            } else if (input.value) {
                record(input, input.type === 'password' ? '(password)' : input.value, cs(input).color, 'value')
            } else if (input.placeholder) {
                record(input, input.placeholder, getComputedStyle(input, '::placeholder').color, 'placeholder')
            }
        }

        return { measured, excluded, failures: [...found.values()] }
    }
    // A nav link's own label: its first run of text, so a count badge beside
    // it ("Builds 8", drawn as two elements) does not become part of the name.
    window.__contrastLabel = a => {
        const w = document.createTreeWalker(a, NodeFilter.SHOW_TEXT)
        for (let t = w.nextNode(); t; t = w.nextNode()) {
            if (t.textContent.trim()) { return t.textContent.trim() }
        }
        return ''
    }
    return true
`

const INJECT = css => `
    let s = document.getElementById('__contrast_audit_css')
    if (!s) {
        s = document.createElement('style')
        s.id = '__contrast_audit_css'
        document.head.appendChild(s)
    }
    s.textContent = ${JSON.stringify(css)}
    return true
`

const SET_MODE = mode => `
    ${BOOT}
    const cfg = root.config
    const was = cfg.store.appearance.colorSchemeMode
    cfg.store.appearance.colorSchemeMode = ${JSON.stringify(mode)}
    await cfg.save()
    await sleep(1200)
    const vars = getComputedStyle(document.documentElement)
    return {
        was,
        mode: cfg.store.appearance.colorSchemeMode,
        background: vars.getPropertyValue('--body-bg').trim(),
        foreground: vars.getPropertyValue('--theme-fg').trim(),
    }
`

const OPEN_SETTINGS = `
    ${BOOT}
    ${LOCATE}
    const settings = window.nodeRequire('tabby-settings')
    let tab = root.app.tabs.find(t => t instanceof settings.SettingsTabComponent)
    if (!tab) {
        root.app.openNewTabRaw({ type: settings.SettingsTabComponent })
        tab = root.app.tabs.find(t => t instanceof settings.SettingsTabComponent)
    }
    root.app.selectTab(tab)
    let links = []
    for (let i = 0; i < 120 && !links.length; i++) {
        await sleep(250)
        links = navLinks()
    }
    return links.map(l => l.textContent.trim()).filter(Boolean)
`

// One page per request, and one inner tab per request: the CDP driver gives a
// request 20s, and a page that opens 144 plugin groups can use most of that.
const OPEN_PAGE = label => `
    ${BOOT}
    ${LOCATE}
    const link = navLinks().find(l => l.textContent.trim() === ${JSON.stringify(label)})
    if (!link) { return { error: 'no nav link' } }
    link.click()
    await sleep(1200)
    for (let i = 0; i < 24 && settingsPane() && settingsPane().querySelector('.skeleton, .skeleton-line'); i++) { await sleep(250) }
    const p = settingsPane()
    if (!p) { return { error: 'no active pane' } }
    return {
        inner: [...p.querySelectorAll('ul.nav-tabs .nav-link')].map(a => ({
            label: window.__contrastLabel(a),
            active: a.classList.contains('active'),
        })),
    }
`

const SELECT_INNER = index => `
    ${BOOT}
    ${LOCATE}
    const p = settingsPane()
    const a = p && [...p.querySelectorAll('ul.nav-tabs .nav-link')][${index}]
    if (!a) { return false }
    a.click()
    await sleep(900)
    return true
`

const AUDIT_PANE = surface => `
    ${BOOT}
    ${LOCATE}
    const p = settingsPane()
    if (!p) { return { surface: ${JSON.stringify(surface)}, error: 'no active pane' } }
    // A collapsed group has no box, and the audit skips what has no box, so
    // every group is opened first or its contents would pass by not being looked
    // at. A list that closes the others when one opens (Plugins) ends with only
    // its last item open, which still measures one body of the shape they share.
    const collapsed = [...p.querySelectorAll('.accordion-button.collapsed')]
    for (const b of collapsed) { b.click() }
    if (collapsed.length) { await sleep(700) }
    const r = window.__contrastAudit(p, ${JSON.stringify(surface)}, ${MIN})
    return { surface: ${JSON.stringify(surface)}, measured: r.measured, excluded: r.excluded, failures: r.failures, opened: collapsed.length }
`

const AUDIT_CHROME = `
    ${BOOT}
    ${LOCATE}
    const results = []
    for (const [name, find] of [['Tab bar', () => document.querySelector('app-root .tab-bar')], ['Settings nav', settingsNav]]) {
        const el = find()
        if (!el) { results.push({ surface: name, error: 'not rendered' }); continue }
        const r = window.__contrastAudit(el, name, ${MIN})
        results.push({ surface: name, measured: r.measured, failures: r.failures })
    }
    return results
`

const AUDIT_SELECTOR = `
    ${BOOT}
    const core = window.nodeRequire('tabby-core')
    const profiles = window.ng.getInjector(document.querySelector('app-root')).get(core.ProfilesService)
    void profiles.showProfileSelector()
    let modal = null
    for (let i = 0; i < 40 && !modal; i++) {
        await sleep(150)
        if (document.querySelector('ngb-modal-window .list-group-item')) { modal = document.querySelector('ngb-modal-window') }
    }
    if (!modal) { return [{ surface: 'Profile selector', error: 'never opened' }] }
    await sleep(400)
    const r = window.__contrastAudit(modal, 'Profile selector', ${MIN})
    const row = modal.querySelector('.list-group-item')
    const cursor = {
        row: getComputedStyle(row).cursor,
        title: getComputedStyle(row.querySelector('.title') || row).cursor,
    }
    modal.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
    await sleep(500)
    return [{ surface: 'Profile selector', measured: r.measured, failures: r.failures, cursor }]
`

// Fixtures with ratios worked out independently below. Each exercises one rule
// of the measurement, and two are there to be *not* measured.
const SELF_TEST_PAGE = `
    const host = document.createElement('div')
    host.id = '__contrast_self_test'
    host.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;background:#f9f9f9;padding:4px;font:14px sans-serif'
    host.innerHTML = [
        '<div data-case="grey-on-white" style="background:#fff;color:#aaa">grey on white</div>',
        '<div data-case="opacity-above-bg" style="opacity:.5;background:#000"><span style="color:#fff">white in a half-opacity black box</span></div>',
        '<div data-case="rgba-text" style="background:#fff;color:rgba(0,0,0,.5)">half-alpha black text</div>',
        '<div data-case="color-mix-text" style="background:#fff;color:color-mix(in srgb, #000 50%, transparent)">color-mix text</div>',
        '<div data-case="inset-shadow-bg" style="background:#fff;box-shadow:inset 0 0 0 9999px #eee;color:#fff">white on a shadow fill</div>',
        '<div data-case="large-passes" style="background:#fff;color:#949494;font-size:24px">large grey</div>',
        '<div data-case="hidden" style="display:none;background:#fff;color:#fff">hidden</div>',
        '<div data-case="disabled" class="disabled" style="background:#fff;color:#fff">disabled</div>',
        '<style>#__contrast_self_test input::placeholder { color: #bbb }</style>',
        '<input data-case="placeholder" placeholder="placeholder text" style="background:#fff;color:#000;border:0">',
    ].join('')
    document.body.appendChild(host)
    await new Promise(r => setTimeout(r, 100))
    const result = window.__contrastAudit(host, 'self-test', 4.5)
    host.remove()
    return result
`

function wcag (a, b) {
    const lin = c => {
        c /= 255
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    }
    const L = c => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2])
    const x = L(a)
    const y = L(b)
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}
const grey = v => [v, v, v]

async function selfTest (evaluate) {
    const expected = {
        'grey-on-white': wcag(grey(170), grey(255)),
        // The box and its text dim together, over the host's #f9f9f9.
        'opacity-above-bg': wcag(grey((255 + 249) / 2), grey(249 / 2)),
        'rgba-text': wcag(grey(127.5), grey(255)),
        'color-mix-text': wcag(grey(127.5), grey(255)),
        // 1.00 if the shadow fill were missed.
        'inset-shadow-bg': wcag(grey(255), grey(238)),
        placeholder: wcag(grey(187), grey(255)),
    }
    const result = await evaluate(SELF_TEST_PAGE)
    const byCase = new Map(result.failures.filter(f => f.case).map(f => [f.case, f]))
    let failed = 0
    const check = (ok, line) => {
        console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${line}`)
        failed += ok ? 0 : 1
    }
    for (const [id, want] of Object.entries(expected)) {
        const f = byCase.get(id)
        check(!!f && Math.abs(f.ratio - want) <= 0.015,
            `${id}: reported ${f ? `${f.ratio.toFixed(2)} (${f.fg} on ${f.bg})` : 'nothing'}, expected ${want.toFixed(2)}`)
    }
    check(!byCase.has('large-passes'), 'large-passes: 24px text needs 3:1 and has it, so it is not reported')
    check(!byCase.has('hidden'), 'hidden: no box, so not measured')
    check(!byCase.has('disabled'), 'disabled: exempt, so not measured')
    check(result.measured === 7, `measured ${result.measured} runs, expected 7`)
    // What the first version's arithmetic made of the opacity case, for the record.
    const old = wcag(grey(127.5), grey(0))
    console.log(`\n  the previous compositing scored opacity-above-bg at ${old.toFixed(2)}`)
    console.log(failed ? `\n${failed} self-test check(s) failed` : '\nself-test passed')
    process.exitCode = failed ? 1 : 0
}

async function main () {
    const { evaluate } = await connect()
    await evaluate(INSTALL)
    if (SELF_TEST) {
        await selfTest(evaluate)
        return
    }
    if (INJECT_CSS !== null) {
        await evaluate(INJECT(INJECT_CSS))
    }

    const guarded = async (surface, script) => {
        try {
            return await evaluate(script) ?? { surface, error: 'no answer within the CDP request budget' }
        } catch (err) {
            return { surface, error: String(err.message).split('\n')[0] }
        }
    }

    const report = {}
    let initial = null
    try {
        for (const mode of MODES) {
            const applied = await evaluate(SET_MODE(mode))
            if (initial === null) {
                initial = applied.was
            }
            console.log(`\n══ ${mode} ══  background ${applied.background}, text ${applied.foreground}`)
            const pages = await evaluate(OPEN_SETTINGS)
            const surfaces = PAGES ? [] : [...await evaluate(AUDIT_CHROME)]
            for (const page of pages) {
                if (PAGES && !PAGES.includes(page.toLowerCase())) {
                    continue
                }
                const opened = await guarded(page, OPEN_PAGE(page))
                if (opened.error) {
                    surfaces.push({ surface: page, error: opened.error })
                    continue
                }
                const inner = opened.inner.length > 1 ? opened.inner : []
                const active = inner.find(t => t.active)
                const first = active ? `${page} / ${active.label}` : page
                surfaces.push(await guarded(first, AUDIT_PANE(first)))
                for (let i = 0; i < inner.length; i++) {
                    if (inner[i].active) {
                        continue
                    }
                    const name = `${page} / ${inner[i].label}`
                    if (await guarded(name, SELECT_INNER(i)) === true) {
                        surfaces.push(await guarded(name, AUDIT_PANE(name)))
                    }
                }
            }
            if (PAGES) {
                const missing = PAGES.filter(p => !pages.some(x => x.toLowerCase() === p))
                for (const p of missing) {
                    surfaces.push({ surface: p, error: `no settings page with that nav label (have: ${pages.join(', ')})` })
                }
            } else {
                surfaces.push(...await evaluate(AUDIT_SELECTOR))
            }
            report[mode] = surfaces
            for (const s of surfaces) {
                if (s.error) {
                    console.log(`  ${s.surface.padEnd(32)} ERROR ${s.error}`)
                    continue
                }
                const extra = (s.cursor ? `  cursor: row ${s.cursor.row}, title ${s.cursor.title}` : '')
                    + (s.excluded ? `  (${s.excluded} preview runs not measured)` : '')
                console.log(`  ${s.surface.padEnd(32)} ${String(s.measured).padStart(4)} measured  ${s.failures.length ? `${s.failures.length} below` : 'ok'}${extra}`)
                for (const f of s.failures.sort((a, b) => a.ratio - b.ratio)) {
                    const dim = f.dimmedBy ? `  dimmed by ${f.dimmedBy}` : ''
                    const image = f.backgroundImage ? `  over a background-image on ${f.backgroundImage}` : ''
                    const times = f.count > 1 ? ` ×${f.count}` : ''
                    const kind = f.kind === 'text' ? '' : ` [${f.kind}]`
                    console.log(`      ${f.ratio.toFixed(2).padStart(5)} < ${f.need}  ${f.fg} on ${f.bg}  ${f.size}px${kind}  "${f.text}"${times}`)
                    console.log(`             ${f.path}${dim}${image}`)
                }
            }
        }
    } finally {
        if (initial !== null) {
            await evaluate(SET_MODE(initial))
        }
    }

    if (JSON_OUT) {
        fs.writeFileSync(JSON_OUT, JSON.stringify(report, null, 2))
    }
    let total = 0
    console.log('\n── summary ──')
    for (const [mode, surfaces] of Object.entries(report)) {
        const ok = surfaces.filter(s => !s.error)
        const runs = ok.reduce((n, s) => n + s.failures.length, 0)
        const measured = ok.reduce((n, s) => n + s.measured, 0)
        const errors = surfaces.length - ok.length
        total += runs
        console.log(`  ${mode}: ${runs} distinct runs below threshold, ${measured} measured, ${ok.length} surfaces${errors ? `, ${errors} errored` : ''}`)
        for (const s of ok.filter(x => x.failures.length).sort((a, b) => b.failures.length - a.failures.length)) {
            const worst = Math.min(...s.failures.map(f => f.ratio))
            console.log(`    ${String(s.failures.length).padStart(3)}  ${s.surface}  (worst ${worst.toFixed(2)})`)
        }
    }
    console.log(`\n${total} distinct text runs below threshold`)
    if (STRICT && total) {
        process.exitCode = 1
    }
}

main().catch(e => { console.error(e); process.exitCode = 1 }).finally(closeAll)
