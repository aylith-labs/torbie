// A hotkey that xterm could also type: the bytes that reach the session.
//
//   node scripts/dev/launch-hidden.mjs --frontend xterm --keep &
//   node tabby-terminal/test/hotkeyEcho.cdp.js
//
// Trusted key events through CDP, so each keystroke takes the path a real one
// does: xterm's key handler, the hotkey service, the handler. Every key here is
// bound the way the user's own config binds it (Ctrl-C to `ctrl-c`, Ctrl-V to
// `paste`, Ctrl-Left to `previous-word`, Shift-Enter to the
// tabby-backslash-newline plugin's hotkey, ...), and the test asserts the exact
// bytes — a hotkey that fired *and* let xterm type the key arrives twice.
// Every case runs twice, from an empty keystroke history and after a typed key:
// the old check's answer depended on which, and the first Ctrl-C after launch
// was the one sent twice.
//
// Nothing of the user's is touched: the clipboard reads and writes are swapped
// for stand-ins on the platform singleton, the session's input is captured
// rather than delivered (so no Enter here ever reaches the shell), and all of
// it is put back at the end.
const { connect, closeAll } = require('./cdp')

const ROOT = `window.ng.getComponent(document.querySelector('app-root'))`

// The user's bindings for every key below (from their config.yaml), plus the
// tabby-backslash-newline plugin's hotkey, which a dev build does not load.
const HOTKEYS = {
    'ctrl-c': ['Ctrl-C'],
    copy: ['Ctrl-Shift-C'],
    paste: ['Ctrl-Shift-V', 'Ctrl-V'],
    'previous-word': ['Ctrl-Left'],
    'next-word': ['Ctrl-Right'],
    'delete-previous-word': ['Ctrl-Backspace'],
    'delete-next-word': ['Ctrl-Delete'],
    home: ['Home'],
    end: ['End'],
    'shift-enter-newline': ['Shift-Enter'],
    // A multi-chord hotkey nothing handles: the key completing it is still the
    // hotkey's, not the terminal's.
    'test-chord': [['Ctrl-K', 'Ctrl-J']],
}

const SETUP = `
    let cmp = null
    let tab = null
    for (let i = 0; i < 60 && !tab; i++) {
        try {
            cmp = ${ROOT}
            const all = cmp.app.tabs.flatMap(t => t.getAllTabs ? t.getAllTabs() : [t])
            tab = all.find(t => t.session && t.frontend && t.frontend.xterm) ?? null
        } catch { /* not up yet */ }
        if (!tab) { await new Promise(r => setTimeout(r, 500)) }
    }
    if (!tab) { throw new Error('no terminal tab with a live session') }
    const parent = cmp.app.tabs.find(t => t.getAllTabs && t.getAllTabs().includes(tab)) || tab
    cmp.app.selectTab(parent)
    await new Promise(r => setTimeout(r, 300))
    tab.frontend.focus()

    const hotkeys = tab.hotkeys
    const store = tab.config.store
    const T = window.__HE = {
        tab,
        hotkeys,
        platform: tab.platform,
        readClipboard: tab.platform.readClipboard,
        clipboardHasImage: tab.platform.clipboardHasImage,
        setClipboard: tab.platform.setClipboard,
        feed: tab.session.feedFromTerminal,
        write: tab.session.write,
        savedHotkeys: {},
        copyOnSelect: store.terminal.copyOnSelect,
        clipboard: { text: '', image: false },
        copied: [],
        sent: [],
        fired: [],
        subs: [],
    }
    tab.platform.readClipboard = () => T.clipboard.text
    tab.platform.clipboardHasImage = () => T.clipboard.image
    tab.platform.setClipboard = (c) => { T.copied.push(c.text) }
    tab.session.feedFromTerminal = (buffer) => { T.sent.push(buffer.toString('latin1')) }
    // What tabby-backslash-newline does: listen on the deprecated emitter and
    // write straight to the session. Its default text, as the user's config
    // sets it (' \\\\n' in YAML, which its unescaping turns into ' \\\\' + LF).
    tab.session.write = (buffer) => { T.sent.push(buffer.toString('latin1')) }
    T.subs.push(hotkeys.matchedHotkey.subscribe(h => {
        if (h === 'shift-enter-newline') { tab.session.write(Buffer.from(' \\\\\\n', 'utf8')) }
    }))
    T.subs.push(hotkeys.unfilteredHotkey$.subscribe(h => { T.fired.push(h) }))
    const wanted = ${JSON.stringify(HOTKEYS)}
    for (const [id, value] of Object.entries(wanted)) {
        T.savedHotkeys[id] = store.hotkeys[id]
        store.hotkeys[id] = value
    }
    store.terminal.copyOnSelect = false
    return typeof T.clipboardHasImage
`

const RESTORE = `
    const T = window.__HE
    if (!T) { return false }
    const store = T.tab.config.store
    T.tab.platform.readClipboard = T.readClipboard
    T.tab.platform.clipboardHasImage = T.clipboardHasImage
    T.tab.platform.setClipboard = T.setClipboard
    T.tab.session.feedFromTerminal = T.feed
    T.tab.session.write = T.write
    for (const s of T.subs) { s.unsubscribe() }
    for (const [id, value] of Object.entries(T.savedHotkeys)) {
        if (value === undefined) { delete store.hotkeys[id] } else { store.hotkeys[id] = value }
    }
    store.terminal.copyOnSelect = T.copyOnSelect
    T.tab.frontend.clearSelection()
    delete window.__HE
    return true
`

const sleep = ms => new Promise(r => setTimeout(r, ms))

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
        console.log(`  FAIL ${name}\n       expected ${e}\n       actual   ${a}`)
    }
}

// Modifier bits for Input.dispatchKeyEvent.
const ALT = 1
const CTRL = 2
const SHIFT = 8

const MODIFIER_KEYS = [
    [CTRL, 'Control', 'ControlLeft', 17],
    [SHIFT, 'Shift', 'ShiftLeft', 16],
    [ALT, 'Alt', 'AltLeft', 18],
]

async function main () {
    const d = await connect({})
    // Spaced like a person's keys: two events with one timestamp are dropped
    // as duplicates by the hotkey service.
    const ev = async (params) => {
        await sleep(40)
        await d.send('Input.dispatchKeyEvent', params)
    }

    /**
     * One chord, pressed the way a keyboard does it: modifiers down, the key
     * down (with its character when it types one, which is what makes the
     * browser follow it with a keypress), the key up, modifiers up.
     */
    const chord = async ({ key, code, vk, modifiers = 0, text }) => {
        let held = 0
        for (const [bit, mkey, mcode, mvk] of MODIFIER_KEYS) {
            if (modifiers & bit) {
                held |= bit
                await ev({ type: 'rawKeyDown', key: mkey, code: mcode, windowsVirtualKeyCode: mvk, modifiers: held })
            }
        }
        await ev(text !== undefined
            ? { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, modifiers, text, unmodifiedText: text }
            : { type: 'rawKeyDown', key, code, windowsVirtualKeyCode: vk, modifiers })
        await ev({ type: 'keyUp', key, code, windowsVirtualKeyCode: vk, modifiers })
        for (const [bit, mkey, mcode, mvk] of [...MODIFIER_KEYS].reverse()) {
            if (held & bit) {
                held &= ~bit
                await ev({ type: 'keyUp', key: mkey, code: mcode, windowsVirtualKeyCode: mvk, modifiers: held })
            }
        }
    }

    /**
     * Press some chords and return what reached the session, and which hotkeys
     * fired. `history` decides what the hotkey service has recorded first:
     * nothing (as at launch, or after a multi-chord hotkey), or a typed key.
     * The old check gave different answers for the two. `setup` runs after
     * that, since typing a key clears a selection.
     */
    let history = 'empty'
    const press = async (chords, setup) => {
        if (history === 'empty') {
            await d.evaluate('window.__HE.hotkeys.clearCurrentKeystrokes(); return 1')
        } else {
            await chord(K.x)
        }
        if (setup) {
            await setup()
        }
        await d.evaluate('Object.assign(window.__HE, { sent: [], fired: [], copied: [] }); return 1')
        for (const c of chords) {
            await chord(c)
        }
        await sleep(300)
        const r = await d.evaluate('const T = window.__HE; return { sent: T.sent, fired: T.fired, copied: T.copied }')
        // Focus reports (CSI I / CSI O) are the window gaining focus, not the key.
        return { ...r, sent: r.sent.filter(x => x !== '\x1b[I' && x !== '\x1b[O').join('') }
    }

    const selectSome = () => d.evaluate(`
        const f = window.__HE.tab.frontend
        f.xterm.write('selectable text\\r\\n')
        await new Promise(r => setTimeout(r, 200))
        f.xterm.selectAll()
        return f.getSelection().length > 0
    `)
    const clipboard = (text, image) => d.evaluate(`window.__HE.clipboard = ${JSON.stringify({ text, image })}; return 1`)

    const K = {
        c: { key: 'c', code: 'KeyC', vk: 67 },
        C: { key: 'C', code: 'KeyC', vk: 67 },
        v: { key: 'v', code: 'KeyV', vk: 86 },
        k: { key: 'k', code: 'KeyK', vk: 75 },
        j: { key: 'j', code: 'KeyJ', vk: 74 },
        x: { key: 'x', code: 'KeyX', vk: 88 },
        left: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 },
        right: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
        backspace: { key: 'Backspace', code: 'Backspace', vk: 8 },
        del: { key: 'Delete', code: 'Delete', vk: 46 },
        home: { key: 'Home', code: 'Home', vk: 36 },
        end: { key: 'End', code: 'End', vk: 35 },
        enter: { key: 'Enter', code: 'Enter', vk: 13, text: '\r' },
    }
    const report = []
    const measure = async (label, ...chords) => {
        const r = await press(chords)
        report.push({ label, ...r })
        return r
    }
    const measureSelected = async (label, ...chords) => {
        const r = await press(chords, async () => check('a selection to copy', await selectSome(), true))
        report.push({ label, ...r })
        return r
    }

    try {
        check('setup', await d.evaluate(SETUP), 'function')

        for (history of ['empty', 'typed']) {
            console.log(`\n  history: ${history === 'empty' ? 'nothing recorded' : 'a key typed first'}`)
            const at = label => `${label} [${history}]`

            let r = await measure(at('Ctrl+C, nothing selected'), { ...K.c, modifiers: CTRL })
            check('Ctrl+C with nothing selected sends one ^C', r.sent, '\x03')

            r = await measureSelected(at('Ctrl+C, text selected'), { ...K.c, modifiers: CTRL })
            check('Ctrl+C with a selection sends nothing', r.sent, '')
            check('and copies it', r.copied.length, 1)
            check('and clears the selection', await d.evaluate('return window.__HE.tab.frontend.getSelection()'), '')

            r = await measure(at('Ctrl+Shift+C, nothing selected'), { ...K.C, modifiers: CTRL | SHIFT })
            check('Ctrl+Shift+C (copy) with nothing selected sends nothing', r.sent, '')

            r = await measure(at('Ctrl+Left'), { ...K.left, modifiers: CTRL })
            check('Ctrl+Left sends one word-left', r.sent, '\x1b[1;5D')
            r = await measure(at('Ctrl+Right'), { ...K.right, modifiers: CTRL })
            check('Ctrl+Right sends one word-right', r.sent, '\x1b[1;5C')
            r = await measure(at('Ctrl+Backspace'), { ...K.backspace, modifiers: CTRL })
            check('Ctrl+Backspace sends one ^W and no backspace', r.sent, '\x17')
            r = await measure(at('Ctrl+Delete'), { ...K.del, modifiers: CTRL })
            check('Ctrl+Delete sends one delete-next-word', r.sent, '\x1bd\x1b[3;5~')
            r = await measure(at('Home'), K.home)
            check('Home is sent once', ['\x1b[H', '\x1bOH'].includes(r.sent), true)
            r = await measure(at('End'), K.end)
            check('End is sent once', ['\x1b[F', '\x1bOF'].includes(r.sent), true)

            await clipboard('hello', false)
            r = await measure(at('Ctrl+V, text'), { ...K.v, modifiers: CTRL })
            // Bracketed or not, depending on whether the shell asked for it.
            check('Ctrl+V pastes the text once and nothing else', ['hello', '\x1b[200~hello\x1b[201~'].includes(r.sent), true)
            await clipboard('', true)
            r = await measure(at('Ctrl+V, image'), { ...K.v, modifiers: CTRL })
            check('Ctrl+V with an image sends one ^V', r.sent, '\x16')

            r = await measure(at('Shift+Enter'), { ...K.enter, modifiers: SHIFT })
            check('Shift+Enter sends the plugin\'s text and no Enter', r.sent, ' \\\n')

            r = await measure(at('Ctrl+K Ctrl+J'), { ...K.k, modifiers: CTRL }, { ...K.j, modifiers: CTRL })
            check('a two-chord hotkey fires once', r.fired, ['test-chord'])
            // Its first chord cannot be known to be one until the second comes.
            check('its first chord types, the one completing it does not', r.sent, '\x0b')

            r = await measure(at('x'), { ...K.x, text: 'x' })
            check('a plain key still types', r.sent, 'x')
            r = await measure(at('Enter'), K.enter)
            check('Enter with no hotkey is sent once', r.sent, '\r')

            // Copy on Ctrl-C, as Windows Terminal binds it: with nothing to copy
            // the key falls through and the terminal sends its ^C, once.
            await d.evaluate(`
                const h = window.__HE.tab.config.store.hotkeys
                h['ctrl-c'] = []
                h.copy = ['Ctrl-Shift-C', 'Ctrl-C']
                return 1`)
            r = await measure(at('Ctrl+C = copy, nothing selected'), { ...K.c, modifiers: CTRL })
            check('copy on Ctrl+C with nothing selected sends one ^C', r.sent, '\x03')
            r = await measureSelected(at('Ctrl+C = copy, text selected'), { ...K.c, modifiers: CTRL })
            check('copy on Ctrl+C with a selection sends nothing', r.sent, '')
            check('and copies it', r.copied.length, 1)
            await d.evaluate(`
                const h = window.__HE.tab.config.store.hotkeys
                h['ctrl-c'] = ['Ctrl-C']
                h.copy = ['Ctrl-Shift-C']
                return 1`)
        }
    } finally {
        console.log('\nbytes per key:')
        for (const { label, sent, fired } of report) {
            console.log(`  ${label.padEnd(44)} ${JSON.stringify(sent).padEnd(30)} hotkeys ${JSON.stringify(fired)}`)
        }
        await d.evaluate(RESTORE).catch(() => false)
    }

    console.log(`\n${passed} passed, ${failed} failed`)
    process.exitCode = failed ? 1 : 0
}

main().catch(e => {
    console.error(e)
    process.exitCode = 1
}).finally(closeAll)
