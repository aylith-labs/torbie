// Shift+Enter in a running build: the bytes that reach the session, and, with
// --claude, the real Claude Code in a WSL pane taking it as a new line.
//
//   node scripts/dev/launch-hidden.mjs --keep &
//   node tabby-terminal/test/keyboardProtocol.cdp.js [--claude]
//
// Trusted key events through CDP, so each keystroke takes xterm's key handler,
// the hotkey service and the encoder, as a real one does. What an app writes is
// fed to xterm's parser as output, so the query is answered by the same code a
// real app would reach. The session's input is captured, not delivered, so no
// Enter here reaches the shell; all of it is put back at the end.
//
// --claude types into the pane for real: it starts Claude Code in WSL
// (`claude` on the login PATH, in ~/.cache/cc-newline-probe, which must sit
// under a folder Claude Code already trusts), types line1, Shift+Enter, line2,
// checks the prompt holds two lines, then clears it and exits with Ctrl+C.
// Nothing is ever submitted.
const { connect, closeAll } = require('./cdp')

const ROOT = `window.ng.getComponent(document.querySelector('app-root'))`
const WITH_CLAUDE = process.argv.includes('--claude')

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
    const store = tab.config.store
    const T = window.__KP = {
        tab,
        hotkeys: tab.hotkeys,
        feed: tab.session.feedFromTerminal,
        write: tab.session.write,
        setting: store.terminal.kittyKeyboard,
        savedHotkey: store.hotkeys['shift-enter-newline'],
        sent: [],
        subs: [],
        capture: true,
    }
    tab.session.feedFromTerminal = (buffer) => {
        if (T.capture) { T.sent.push(buffer.toString('latin1')) } else { T.feed.call(tab.session, buffer) }
    }
    // tabby-backslash-newline, as hotkeyEcho.cdp.js emulates it: its hotkey
    // writes ' \\\\' + LF straight to the session.
    tab.session.write = (buffer) => {
        if (T.capture) { T.sent.push(buffer.toString('latin1')) } else { T.write.call(tab.session, buffer) }
    }
    T.subs.push(T.hotkeys.matchedHotkey.subscribe(h => {
        if (h === 'shift-enter-newline') { tab.session.write(Buffer.from(' \\\\\\n', 'utf8')) }
    }))
    return typeof tab.frontend.keyboardProtocol
`

const RESTORE = `
    const T = window.__KP
    if (!T) { return false }
    const store = T.tab.config.store
    T.tab.session.feedFromTerminal = T.feed
    T.tab.session.write = T.write
    for (const s of T.subs) { s.unsubscribe() }
    store.terminal.kittyKeyboard = T.setting
    if (T.savedHotkey === undefined) { delete store.hotkeys['shift-enter-newline'] } else { store.hotkeys['shift-enter-newline'] = T.savedHotkey }
    T.tab.frontend.keyboardProtocol.reset()
    delete window.__KP
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

const ALT = 1
const CTRL = 2
const SHIFT = 8
const MODIFIER_KEYS = [
    [CTRL, 'Control', 'ControlLeft', 17],
    [SHIFT, 'Shift', 'ShiftLeft', 16],
    [ALT, 'Alt', 'AltLeft', 18],
]
const ENTER = { key: 'Enter', code: 'Enter', vk: 13, text: '\r' }
const X = { key: 'x', code: 'KeyX', vk: 88, text: 'x' }

async function main () {
    const d = await connect({})
    const ev = async (params) => {
        await sleep(40)
        await d.send('Input.dispatchKeyEvent', params)
    }
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
    // What the app writes, through xterm's parser; returns what that sent back.
    const appWrites = async (data) => {
        await d.evaluate('window.__KP.sent = []; return 1')
        await d.evaluate(`await new Promise(r => window.__KP.tab.frontend.xterm.write(${JSON.stringify(data)}, r)); return 1`)
        await sleep(50)
        return (await d.evaluate('return window.__KP.sent')).join('')
    }
    const press = async (history, ...chords) => {
        if (history === 'empty') {
            await d.evaluate('window.__KP.hotkeys.clearCurrentKeystrokes(); return 1')
        } else {
            await chord(X)
        }
        await d.evaluate('window.__KP.sent = []; return 1')
        for (const c of chords) {
            await chord(c)
        }
        await sleep(250)
        const sent = await d.evaluate('return window.__KP.sent')
        return sent.filter(x => x !== '\x1b[I' && x !== '\x1b[O').join('')
    }
    const encoding = () => d.evaluate('return window.__KP.tab.frontend.keyboardProtocol.encoding("normal")')
    const report = []
    const measure = async (label, history, c) => {
        const sent = await press(history, c)
        report.push({ label: `${label} [${history}]`, sent })
        return sent
    }

    try {
        check('setup: the frontend carries the protocol state', await d.evaluate(SETUP), 'object')
        await d.evaluate('window.__KP.tab.frontend.keyboardProtocol.reset(); window.__KP.tab.config.store.terminal.kittyKeyboard = true; return 1')

        for (const history of ['empty', 'typed']) {
            console.log(`\n  history: ${history === 'empty' ? 'nothing recorded' : 'a key typed first'}`)

            check('no app has asked: legacy', await encoding(), 'legacy')
            check('Shift+Enter is xterm\'s CR, once', await measure('Shift+Enter, nothing asked', history, { ...ENTER, modifiers: SHIFT }), '\r')

            // Claude Code's startup, as measured through the inbox ConPTY.
            check('the kitty query is answered', await appWrites('\x1b[?2004h\x1b[>0q\x1b[?u'), '\x1b[?0u')
            check('asking arms CSI-u', await encoding(), 'asked')
            check('Shift+Enter is CSI 13;2u, once', await measure('Shift+Enter, asked', history, { ...ENTER, modifiers: SHIFT }), '\x1b[13;2u')
            check('Ctrl+Enter is CSI 13;5u', await measure('Ctrl+Enter, asked', history, { ...ENTER, modifiers: CTRL }), '\x1b[13;5u')
            check('Ctrl+Shift+Enter is CSI 13;6u', await measure('Ctrl+Shift+Enter, asked', history, { ...ENTER, modifiers: CTRL | SHIFT }), '\x1b[13;6u')
            check('plain Enter is still CR', await measure('Enter, asked', history, ENTER), '\r')

            // Its exit.
            check('the exit is not answered', await appWrites('\x1b[>4m\x1b[?2004l'), '')
            check('and hands the keyboard back', await encoding(), 'legacy')
            check('Shift+Enter is CR again', await measure('Shift+Enter, after exit', history, { ...ENTER, modifiers: SHIFT }), '\r')

            // A negotiated kitty push, then modifyOtherKeys on its own.
            await appWrites('\x1b[>1u')
            check('kitty push: CSI 13;2u', await measure('Shift+Enter, kitty pushed', history, { ...ENTER, modifiers: SHIFT }), '\x1b[13;2u')
            await appWrites('\x1b[<u\x1b[>4;2m')
            check('modifyOtherKeys 2: CSI 27;2;13~', await measure('Shift+Enter, modifyOtherKeys 2', history, { ...ENTER, modifiers: SHIFT }), '\x1b[27;2;13~')
            await appWrites('\x1b[>4m')

            // tabby-backslash-newline bound to Shift-Enter keeps the key.
            await appWrites('\x1b[?u')
            await d.evaluate(`window.__KP.tab.config.store.hotkeys['shift-enter-newline'] = ['Shift-Enter']; return 1`)
            check('the plugin\'s hotkey wins, and nothing else is sent', await measure('Shift+Enter, plugin bound', history, { ...ENTER, modifiers: SHIFT }), ' \\\n')
            await d.evaluate(`delete window.__KP.tab.config.store.hotkeys['shift-enter-newline']; return 1`)

            // Switched off: upstream behaviour.
            await d.evaluate('window.__KP.tab.config.store.terminal.kittyKeyboard = false; return 1')
            check('off: Shift+Enter is CR even with the pane armed', await measure('Shift+Enter, setting off', history, { ...ENTER, modifiers: SHIFT }), '\r')
            await d.evaluate('window.__KP.tab.frontend.keyboardProtocol.reset(); return 1')
            check('off: the query goes unanswered', await appWrites('\x1b[?u'), '')
            await d.evaluate('window.__KP.tab.config.store.terminal.kittyKeyboard = true; window.__KP.tab.frontend.keyboardProtocol.reset(); return 1')
        }

        if (WITH_CLAUDE) {
            await realClaude(d, chord)
        }
    } finally {
        console.log('\nbytes per key:')
        for (const { label, sent } of report) {
            console.log(`  ${label.padEnd(44)} ${JSON.stringify(sent)}`)
        }
        await d.evaluate(RESTORE).catch(() => false)
    }

    console.log(`\n${passed} passed, ${failed} failed`)
    process.exitCode = failed ? 1 : 0
}

/** The real Claude Code in a WSL pane: line1, Shift+Enter, line2, and nothing submitted. */
async function realClaude (d, chord) {
    console.log('\n  real Claude Code in WSL')
    // Deliver for real from here on, and log what the keys send.
    await d.evaluate(`
        const T = window.__KP
        T.capture = false
        T.keys = []
        const f = T.tab.session.feedFromTerminal
        T.tab.session.feedFromTerminal = (b) => { T.keys.push(b.toString('latin1')); f(b) }
        return 1`)
    const screen = () => d.evaluate(`
        const b = window.__KP.tab.frontend.xterm.buffer.active
        const out = []
        for (let i = 0; i < b.length; i++) { out.push(b.getLine(i).translateToString(true)) }
        return out`)
    await d.evaluate(`window.__KP.tab.sendInput('wsl.exe -d Ubuntu -- bash -lc "mkdir -p ~/.cache/cc-newline-probe && cd ~/.cache/cc-newline-probe && exec claude"\\r'); return 1`)
    let ready = false
    for (let i = 0; i < 60 && !ready; i++) {
        await sleep(500)
        ready = (await screen()).some(l => /^\s*❯/.test(l)) && await d.evaluate('return window.__KP.tab.frontend.keyboardProtocol.encoding("normal")') !== 'legacy'
    }
    check('Claude Code started and asked about the keyboard', ready, true)
    if (!ready) {
        console.log((await screen()).filter(x => x.trim()).slice(-15).join('\n'))
        return
    }
    // 'asked' through the inbox ConPTY, whose own DA1 answer beats ours;
    // 'kitty' when the instance inherited WT_SESSION (Claude Code then pushes
    // flags unasked), so launch it without that to measure a real Torbie.
    const negotiated = await d.evaluate('return window.__KP.tab.frontend.keyboardProtocol.encoding("normal")')
    console.log(`       negotiated: ${negotiated}`)
    const inWT = await d.evaluate('return !!process.env.WT_SESSION')
    check(`what it negotiated through ConPTY, ${inWT ? 'inside' : 'outside'} Windows Terminal`, negotiated, inWT ? 'kitty' : 'asked')
    await d.send('Input.insertText', { text: 'line1' })
    await sleep(400)
    await d.evaluate('window.__KP.keys = []; return 1')
    await chord({ ...ENTER, modifiers: SHIFT })
    await sleep(400)
    const shiftEnterBytes = await d.evaluate('return window.__KP.keys.join("")')
    check('Shift+Enter sent CSI 13;2u, once', shiftEnterBytes, '\x1b[13;2u')
    await d.send('Input.insertText', { text: 'line2' })
    await sleep(1200)
    const lines = await screen()
    const i1 = lines.findIndex(l => /❯\s*line1\s*$/.test(l))
    check('line1 is on the prompt row', i1 >= 0, true)
    check('line2 is on the row under it, in the same prompt', i1 >= 0 ? lines[i1 + 1].trim() : null, 'line2')
    console.log(lines.slice(Math.max(0, i1 - 1), i1 + 4).map(l => `       | ${l}`).join('\n'))
    // Clear the prompt and leave: Ctrl+C clears, and two in quick succession exit.
    const ctrlC = { key: 'c', code: 'KeyC', vk: 67, modifiers: CTRL }
    await chord(ctrlC)
    await sleep(800)
    await chord(ctrlC)
    await chord(ctrlC)
    let back = false
    for (let i = 0; i < 20 && !back; i++) {
        await sleep(500)
        back = await d.evaluate('return window.__KP.tab.frontend.keyboardProtocol.encoding("normal")') === 'legacy'
    }
    check('its exit handed the keyboard back', back, true)
    check('nothing was submitted: no line1 outside the prompt', (await screen()).filter(l => /line1/.test(l) && !/❯/.test(l)).length, 0)
    await d.evaluate('window.__KP.capture = true; return 1')
}

main().catch(e => {
    console.error(e)
    process.exitCode = 1
}).finally(closeAll)
