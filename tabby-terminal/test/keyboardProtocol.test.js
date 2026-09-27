// Modified Enter, and the kitty keyboard / modifyOtherKeys modes behind it.
//
//   node tabby-terminal/test/keyboardProtocol.test.js
//
// Plain node, nothing running. The sequences fed here are the ones measured
// from the real programs: Claude Code 2.1.283 at startup and exit, over a clean
// PTY and through the inbox ConPTY (whose own DA1 answer beats ours, so Claude
// Code never pushes flags there), and shefrd, which pushes flags unasked. The
// keystroke path in a running build is keyboardProtocol.cdp.js.

const path = require('path')
const fs = require('fs')
const Module = require('module')

const REPO = path.resolve(__dirname, '../..')

let passed = 0
let failed = 0
function check (name, actual, expected) {
    const a = JSON.stringify(actual)
    const e = JSON.stringify(expected)
    if (a === e) {
        passed++
    } else {
        failed++
        console.log(`FAIL ${name}\n  expected ${e}\n  actual   ${a}`)
    }
}

// config.ts imports tabby-core for ConfigProvider/Platform; nothing else is
// evaluated at module scope, so a stub is enough.
const stubs = {
    '@angular/core': new Proxy({}, { get: () => (() => (target) => target) }),
    'tabby-core': new Proxy({}, {
        get: (_t, k) => {
            if (k === '__esModule') {
                return true
            }
            if (k === 'Platform') {
                return { Windows: 'Windows', macOS: 'macOS', Linux: 'Linux', Web: 'Web' }
            }
            return class Stub {}
        },
    }),
}
const originalResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
    return stubs[request] ? request : originalResolve.call(this, request, ...rest)
}
const originalLoad = Module._load
Module._load = function (request, ...rest) {
    return stubs[request] ? stubs[request] : originalLoad.call(this, request, ...rest)
}
const ts = require(path.join(REPO, 'node_modules/typescript'))
Module._extensions['.ts'] = function (module, filename) {
    const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
    }).outputText
    module._compile(js, filename)
}

const kp = require(path.join(REPO, 'tabby-terminal/src/keyboardProtocol.ts'))
const { TerminalConfigProvider } = require(path.join(REPO, 'tabby-terminal/src/config.ts'))

/**
 * A stand-in for xterm's parser: enough CSI and ESC tokenizing to dispatch to
 * handlers registered by the same ids, with parameters as xterm hands them
 * over (an omitted one is 0). Everything else is text and ignored.
 */
const ESC = '\x1b'

function makeTerminal (enabled = () => true) {
    const csi = []
    const esc = []
    const parser = {
        registerCsiHandler: (id, cb) => { csi.push({ id, cb }); return { dispose () {} } },
        registerEscHandler: (id, cb) => { esc.push({ id, cb }); return { dispose () {} } },
    }
    const t = { replies: [], screen: 'normal', handled: [] }
    t.state = new kp.KeyboardProtocolState()
    kp.attachKeyboardProtocol(parser, t.state, d => t.replies.push(d), () => t.screen, enabled)
    t.write = (data) => {
        const re = new RegExp(`${ESC}\\[([<=>?]?)([0-9;:]*)([ -/]*)([@-~])|${ESC}c`, 'g')
        let m
        while ((m = re.exec(data))) {
            if (m[0] === '\x1bc') {
                for (const h of esc) { if (h.id.final === 'c') { h.cb() } }
                continue
            }
            const [, prefix, p, intermediates, final] = m
            const params = p === '' ? [0] : p.split(';').map(x => x === '' ? 0 : Number(x.split(':')[0]))
            for (const h of csi) {
                if ((h.id.prefix ?? '') === prefix && (h.id.intermediates ?? '') === intermediates && h.id.final === final) {
                    t.handled.push(h.cb(params))
                }
            }
        }
    }
    t.enter = (mods = {}) => t.state.encodeEnter(t.screen, { shift: false, alt: false, ctrl: false, meta: false, ...mods })
    return t
}

const SHIFT = { shift: true }
const CTRL = { ctrl: true }
const ALT = { alt: true }

// ── the default ───────────────────────────────────────────────────────────────

check('on by default', new TerminalConfigProvider().defaults.terminal.kittyKeyboard, true)

// ── nothing asked: xterm's bytes, untouched ───────────────────────────────────

{
    const t = makeTerminal()
    check('a shell that asked nothing: Shift+Enter is xterm\'s', t.enter(SHIFT), null)
    check('and so is Ctrl+Enter', t.enter(CTRL), null)
    check('plain Enter is always xterm\'s', t.enter(), null)
    check('encoding is legacy', t.state.encoding('normal'), 'legacy')
    // bash, measured: CSI 13;2u there types ";2u", which is why nothing
    // changes until an app asks.
}

// ── the modifier parameter ────────────────────────────────────────────────────

check('shift is 2', kp.modifierParam({ shift: true, alt: false, ctrl: false, meta: false }), 2)
check('alt is 3', kp.modifierParam({ shift: false, alt: true, ctrl: false, meta: false }), 3)
check('ctrl is 5', kp.modifierParam({ shift: false, alt: false, ctrl: true, meta: false }), 5)
check('ctrl+shift is 6', kp.modifierParam({ shift: true, alt: false, ctrl: true, meta: false }), 6)
check('meta (super) is 9', kp.modifierParam({ shift: false, alt: false, ctrl: false, meta: true }), 9)

// ── Claude Code through the inbox ConPTY (a WSL or local tab on Windows) ──────
// Measured: it writes ?2004h, XTVERSION and the kitty query, reads ConPTY's own
// DA1 answer first, concludes "no kitty", and pushes nothing. On exit it writes
// CSI > 4 m (modifyOtherKeys reset) whatever it negotiated.

{
    const t = makeTerminal()
    t.write('\x1b[?2004h\x1b[>0q\x1b[?u\x1b[c')
    check('the kitty query is answered with the current flags', t.replies, ['\x1b[?0u'])
    check('asking arms CSI-u', t.state.encoding('normal'), 'asked')
    check('Shift+Enter is CSI 13;2u', t.enter(SHIFT), '\x1b[13;2u')
    check('Ctrl+Enter is CSI 13;5u', t.enter(CTRL), '\x1b[13;5u')
    check('Alt+Enter is CSI 13;3u', t.enter(ALT), '\x1b[13;3u')
    check('Ctrl+Shift+Enter is CSI 13;6u', t.enter({ ctrl: true, shift: true }), '\x1b[13;6u')
    check('plain Enter stays CR', t.enter(), null)
    // Its external editor (Ctrl+X Ctrl+E) re-asserts bracketed paste only.
    t.write('\x1b[?2004h')
    check('still armed after the editor round trip', t.enter(SHIFT), '\x1b[13;2u')
    t.write('\x1b[>4m\x1b[>4m\x1b[?2004l\x1b[>4m\x1b[?2004l')
    check('its exit hands the keyboard back', t.state.encoding('normal'), 'legacy')
    check('and Shift+Enter is the shell\'s Enter again', t.enter(SHIFT), null)
    t.write('\x1b[?u')
    check('the next launch asks again and re-arms', t.enter(SHIFT), '\x1b[13;2u')
}

// ── Claude Code over a clean pipe (SSH, a Linux or macOS PTY) ─────────────────
// Measured: once its query is answered before DA1 it pops, pushes 5 and sets
// modifyOtherKeys 2; on exit, CSI > 4 m and a pop.

{
    const t = makeTerminal()
    t.write('\x1b[?u')
    t.write('\x1b[<u\x1b[>5u\x1b[>4;2m')
    check('it negotiated kitty', t.state.encoding('normal'), 'kitty')
    check('only disambiguate is kept of the 5 it pushed', t.state.flags('normal'), 1)
    t.write('\x1b[?u')
    check('and the query reports what is implemented', t.replies[1], '\x1b[?1u')
    check('Shift+Enter is CSI 13;2u', t.enter(SHIFT), '\x1b[13;2u')
    t.write('\x1b[>4m\x1b[<u')
    check('its exit leaves nothing behind', t.state.encoding('normal'), 'legacy')
}

// ── shefrd, which pushes flags without asking ─────────────────────────────────

{
    const t = makeTerminal()
    t.write('\x1b[>7u')
    check('a push alone enables it', t.enter(SHIFT), '\x1b[13;2u')
    check('nothing was asked, nothing answered', t.replies, [])
    t.write('\x1b[<u')
    check('its pop disables it', t.enter(SHIFT), null)
}

// ── modifyOtherKeys on its own ────────────────────────────────────────────────

{
    const t = makeTerminal()
    t.write('\x1b[>4;2m')
    check('level 2: Shift+Enter is CSI 27;2;13~', t.enter(SHIFT), '\x1b[27;2;13~')
    check('level 2: Ctrl+Enter is CSI 27;5;13~', t.enter(CTRL), '\x1b[27;5;13~')
    t.write('\x1b[>4;1m')
    check('level 1 leaves Enter alone, as xterm does', t.enter(SHIFT), null)
    t.write('\x1b[>4;2m\x1b[>4;0m')
    check('level 0 turns it off', t.enter(SHIFT), null)
    t.write('\x1b[>1;2m')
    check('other XTMODKEYS resources are ignored', t.enter(SHIFT), null)
    t.write('\x1b[>4;2m\x1b[>1u')
    check('kitty wins over modifyOtherKeys', t.enter(SHIFT), '\x1b[13;2u')
}

// ── the stack: pop counts, the set forms, the limit, each screen its own ──────

{
    const t = makeTerminal()
    t.write('\x1b[>1u\x1b[>1u\x1b[>1u\x1b[<2u')
    check('popping 2 of 3 leaves one', t.state.flags('normal'), 1)
    t.write('\x1b[<u')
    check('popping the last empties it', t.state.flags('normal'), 0)
    t.write('\x1b[<5u')
    check('popping an empty stack is harmless', t.state.flags('normal'), 0)

    t.write('\x1b[=1;1u')
    check('= mode 1 sets the flags', t.state.flags('normal'), 1)
    t.write('\x1b[=1;3u')
    check('= mode 3 clears bits', t.state.flags('normal'), 0)
    t.write('\x1b[=1;2u')
    check('= mode 2 sets bits', t.state.flags('normal'), 1)
    t.write('\x1b[=0u')
    check('= with no mode replaces', t.state.flags('normal'), 0)

    for (let i = 0; i < 20; i++) {
        t.write('\x1b[>1u')
    }
    t.write('\x1b[<16u')
    check('the stack is bounded at 16', t.state.flags('normal'), 0)

    t.screen = 'alternate'
    t.write('\x1b[>1u')
    check('a push on the alternate screen applies there', t.enter(SHIFT), '\x1b[13;2u')
    t.screen = 'normal'
    check('and not on the normal one', t.enter(SHIFT), null)
    t.screen = 'alternate'
    t.write('\x1b[<u')
    check('its pop clears the alternate stack', t.enter(SHIFT), null)
}

// ── resets ────────────────────────────────────────────────────────────────────

{
    const t = makeTerminal()
    t.write('\x1b[?u\x1b[>1u\x1b[>4;2m\x1bc')
    check('RIS forgets everything', t.state.encoding('normal'), 'legacy')
    t.write('\x1b[?u\x1b[>1u\x1b[>4;2m\x1b[!p')
    check('DECSTR forgets everything', t.state.encoding('normal'), 'legacy')
    check('and neither is consumed, so xterm still resets', t.handled.slice(-1), [false])
}

// ── switched off ──────────────────────────────────────────────────────────────

{
    let on = false
    const t = makeTerminal(() => on)
    t.write('\x1b[?u\x1b[>1u\x1b[>4;2m')
    check('off: the query goes unanswered', t.replies, [])
    check('off: nothing is kept', t.state.encoding('normal'), 'legacy')
    check('off: every handler declines, as if unregistered', t.handled, [false, false, false])
    on = true
    t.write('\x1b[?u')
    check('turned back on, it answers', t.replies, ['\x1b[?0u'])
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
