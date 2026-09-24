// Ctrl+V bound to paste, in the real app: the bytes that reach the session.
//
//   node scripts/dev/launch-hidden.mjs --frontend xterm --keep &
//   node tabby-terminal/test/imagePaste.cdp.js
//
// Trusted key events through CDP, so the keystroke takes the same path a real
// one does: xterm's key handler, the hotkey service, the paste hotkey. The
// clipboard is never touched — the platform's two clipboard reads are swapped
// for stand-ins on the singleton every tab holds, and put back at the end —
// because the real one is the user's.
//
// What it proves, and imagePaste.test.js cannot: that an image-only clipboard
// sends exactly one Ctrl+V (not an empty paste, and not a second 0x16 from
// xterm, which is what made Claude Code race itself for the clipboard), and
// that a text paste on Ctrl+V no longer drags a stray 0x16 behind it.
const { connect, closeAll } = require('./cdp')

const ROOT = `window.ng.getComponent(document.querySelector('app-root'))`

const SETUP = `
    // A window that is still booting has no terminal yet; give it a while.
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

    const T = window.__IP = {
        tab,
        platform: tab.platform,
        config: tab.config,
        readClipboard: tab.platform.readClipboard,
        clipboardHasImage: tab.platform.clipboardHasImage,
        feed: tab.session.feedFromTerminal,
        paste: [...tab.config.store.hotkeys.paste],
        forward: tab.config.store.terminal.forwardCtrlVForImages,
        clipboard: { text: '', image: false },
        sent: [],
    }
    tab.platform.readClipboard = () => T.clipboard.text
    tab.platform.clipboardHasImage = () => T.clipboard.image
    tab.session.feedFromTerminal = (buffer) => { T.sent.push(buffer.toString('latin1')) }
    tab.config.store.hotkeys.paste = ['Ctrl-Shift-V', 'Ctrl-V']
    return typeof T.clipboardHasImage
`

const RESTORE = `
    const T = window.__IP
    if (!T) { return false }
    T.tab.platform.readClipboard = T.readClipboard
    T.tab.platform.clipboardHasImage = T.clipboardHasImage
    T.tab.session.feedFromTerminal = T.feed
    T.tab.config.store.hotkeys.paste = T.paste
    T.tab.config.store.terminal.forwardCtrlVForImages = T.forward
    delete window.__IP
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

async function main () {
    const d = await connect({})
    // Spaced like a person's keys: two events with one timestamp are dropped
    // as duplicates by the hotkey service.
    const key = async (type, key, code, vk, modifiers) => {
        await sleep(40)
        await d.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: vk, modifiers })
    }
    const ctrlV = async () => {
        await d.evaluate('window.__IP.sent = []; return 1')
        await key('rawKeyDown', 'Control', 'ControlLeft', 17, 2)
        await key('rawKeyDown', 'v', 'KeyV', 86, 2)
        await key('keyUp', 'v', 'KeyV', 86, 2)
        await key('keyUp', 'Control', 'ControlLeft', 17, 0)
        await sleep(300)
        // Focus reports (CSI I / CSI O) are the window gaining focus, not the key.
        return (await d.evaluate('return window.__IP.sent')).filter(x => x !== '\x1b[I' && x !== '\x1b[O')
    }
    const clipboard = (text, image) => d.evaluate(`window.__IP.clipboard = ${JSON.stringify({ text, image })}; return 1`)
    const forward = on => d.evaluate(`window.__IP.config.store.terminal.forwardCtrlVForImages = ${on}; return 1`)

    try {
        check('the platform answers clipboardHasImage', await d.evaluate(SETUP), 'function')

        await clipboard('', true)
        check('an image and no text sends one Ctrl+V and nothing else', await ctrlV(), ['\x16'])

        await clipboard('hello', false)
        const text = await ctrlV()
        check('text pastes once', text.filter(x => x.includes('hello')).length, 1)
        check('and no stray Ctrl+V follows it', text.some(x => x.includes('\x16')), false)

        await clipboard('https://x.test/a.png', true)
        const both = await ctrlV()
        check('text beside an image pastes the text', both.some(x => x.includes('https://x.test/a.png')), true)
        check('and sends no Ctrl+V', both.some(x => x.includes('\x16')), false)

        await forward(false)
        await clipboard('', true)
        check('switched off, an image sends no Ctrl+V', (await ctrlV()).some(x => x.includes('\x16')), false)
    } finally {
        await d.evaluate(RESTORE).catch(() => false)
        // Whatever the text case typed at the prompt, without ever pressing Enter.
        await d.evaluate(`
            const cmp = ${ROOT}
            const all = cmp.app.tabs.flatMap(t => t.getAllTabs ? t.getAllTabs() : [t])
            const tab = all.find(t => t.session && t.frontend && t.frontend.xterm)
            tab?.sendInput('\\x1b')
            return 1
        `).catch(() => 0)
    }

    console.log(`\n${passed} passed, ${failed} failed`)
    process.exitCode = failed ? 1 : 0
}

main().catch(e => {
    console.error(e)
    process.exitCode = 1
}).finally(closeAll)
