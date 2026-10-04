// Light or dark: `CSI ? 996 n` and mode 2031's unsolicited reports.
//
//   node tabby-terminal/test/colorSchemeReports.test.js
//
// Plain node, nothing running. The sequences are the ones shefrd sends at
// startup and on focus (`CSI ? 2031 h`, then `CSI ? 996 n`), which the inbox
// ConPTY forwards to the terminal — measured, as it does not forward an
// `OSC 11 ; ?`. The running build is colorSchemeReports.cdp.js.

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

const ts = require(path.join(REPO, 'node_modules/typescript'))
Module._extensions['.ts'] = function (module, filename) {
    const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
    }).outputText
    module._compile(js, filename)
}

const cs = require(path.join(REPO, 'tabby-terminal/src/colorSchemeReports.ts'))

const ESC = '\x1b'
const DARK = '\x1b[?997;1n'
const LIGHT = '\x1b[?997;2n'

/**
 * A stand-in for xterm's parser: CSI and ESC c dispatched to handlers by the
 * same ids, newest first, stopping at the first that returns true — so
 * `xterm` records what xterm's own handlers would still have received.
 */
function makeTerminal () {
    const csi = []
    const esc = []
    const parser = {
        registerCsiHandler: (id, cb) => { csi.unshift({ id, cb }); return { dispose () {} } },
        registerEscHandler: (id, cb) => { esc.unshift({ id, cb }); return { dispose () {} } },
    }
    const t = { replies: [], xterm: [] }
    t.state = new cs.ColorSchemeReportState()
    cs.attachColorSchemeReports(parser, t.state, d => t.replies.push(d))
    t.write = (data) => {
        const re = new RegExp(`${ESC}\\[([<=>?]?)([0-9;:]*)([ -/]*)([@-~])|${ESC}c`, 'g')
        let m
        while ((m = re.exec(data))) {
            if (m[0] === '\x1bc') {
                if (!esc.some(h => h.id.final === 'c' && h.cb())) { t.xterm.push(m[0]) }
                continue
            }
            const [, prefix, p, intermediates, final] = m
            const params = p === '' ? [0] : p.split(';').map(x => x === '' ? 0 : Number(x.split(':')[0]))
            const mine = csi.filter(h => (h.id.prefix ?? '') === prefix && (h.id.intermediates ?? '') === intermediates && h.id.final === final)
            if (!mine.some(h => h.cb(params))) { t.xterm.push(m[0]) }
        }
    }
    // What configureColors does after applying a theme.
    t.paint = (background) => {
        const report = t.state.update(cs.appearanceOf(background))
        if (report) { t.replies.push(report) }
    }
    return t
}

// ── reading a background ──────────────────────────────────────────────────────
// Tabby's own default schemes, and the window colours a scheme can carry.

check('Tabby default dark (#171717) is dark', cs.appearanceOf('#171717'), 'dark')
check('Tabby default light (#ffffff) is light', cs.appearanceOf('#ffffff'), 'light')
check('catppuccin latte base is light', cs.appearanceOf('#eff1f5'), 'light')
check('catppuccin mocha base is dark', cs.appearanceOf('#1e1e2e'), 'dark')
check('short hex', cs.appearanceOf('#fff'), 'light')
check('opaque 8-digit hex', cs.appearanceOf('#f7f1e0ff'), 'light')
check('rgb()', cs.appearanceOf('rgb(30, 30, 46)'), 'dark')
check('rgba() with alpha', cs.appearanceOf('rgba(239,241,245,0.9)'), 'light')
check('fully transparent hex says nothing', cs.appearanceOf('#00000000'), null)
check('fully transparent rgba says nothing', cs.appearanceOf('rgba(0,0,0,0)'), null)
check('nonsense says nothing', cs.appearanceOf('papayawhip'), null)
check('nothing says nothing', cs.appearanceOf(undefined), null)
// The midpoint shefrd applies to an OSC 11 answer: 128 of 255, weighted.
check('mid grey #808080 is light, as an OSC 11 reader decides', cs.appearanceOf('#808080'), 'light')
check('#7f7f7f is dark', cs.appearanceOf('#7f7f7f'), 'dark')

// ── asking: CSI ? 996 n ───────────────────────────────────────────────────────

{
    const t = makeTerminal()
    t.write('\x1b[?996n')
    check('unknown appearance: no answer, and xterm never sees 996', [t.replies, t.xterm], [[], []])
    t.paint('#ffffff')
    t.write('\x1b[?996n')
    check('light scheme answers 997;2', t.replies, [LIGHT])
    t.paint('#171717')
    t.write('\x1b[?996n')
    check('dark scheme answers 997;1', t.replies, [LIGHT, DARK])
    check('mode 2031 unset: the flip pushed nothing', t.replies.length, 2)
}

// ── shefrd: mode 2031, then a flip ────────────────────────────────────────────

{
    const t = makeTerminal()
    t.paint('#171717')
    t.write('\x1b[?2031h\x1b[?996n')
    check('shefrd startup: set the mode, ask, get dark', t.replies, [DARK])
    check('xterm still sees the DECSET (it ignores 2031)', t.xterm, ['\x1b[?2031h'])
    t.paint('#171717')
    check('the same scheme applied again pushes nothing', t.replies, [DARK])
    t.paint('#ffffff')
    check('dark → light pushes 997;2 unasked', t.replies, [DARK, LIGHT])
    t.paint('#eff1f5')
    check('another light scheme pushes nothing', t.replies, [DARK, LIGHT])
    t.paint('#1e1e2e')
    check('light → dark pushes 997;1', t.replies, [DARK, LIGHT, DARK])
    t.paint('#00000000')
    check('a transparent repaint says nothing and forgets nothing', [t.replies.length, t.state.current], [3, 'dark'])
    t.write('\x1b[?2031l')
    t.paint('#ffffff')
    check('shefrd exit resets the mode: the next flip is silent', t.replies.length, 3)
    t.write('\x1b[?996n')
    check('but a query still answers', t.replies.slice(-1), [LIGHT])
}

// ── the mode alongside others, and DECRQM ─────────────────────────────────────

{
    const t = makeTerminal()
    t.paint('#ffffff')
    t.write('\x1b[?2031$p')
    check('DECRQM before: reset (2)', t.replies, ['\x1b[?2031;2$y'])
    t.write('\x1b[?1000;2031h')
    check('set alongside another mode', t.state.enabled, true)
    check('and xterm still gets the whole DECSET', t.xterm, ['\x1b[?1000;2031h'])
    t.write('\x1b[?2031$p')
    check('DECRQM after: set (1)', t.replies.slice(-1), ['\x1b[?2031;1$y'])
    t.write('\x1b[?25$p\x1b[?6n\x1b[?1000l')
    check('every other DECRQM, DSR and DECRST is xterm\'s', t.xterm.slice(1), ['\x1b[?25$p', '\x1b[?6n', '\x1b[?1000l'])
    check('and none of them touched the mode', t.state.enabled, true)
}

// ── resets ───────────────────────────────────────────────────────────────────

{
    const t = makeTerminal()
    t.paint('#ffffff')
    t.write('\x1b[?2031h\x1bc')
    check('RIS clears the mode', t.state.enabled, false)
    check('and xterm still resets', t.xterm.slice(-1), ['\x1bc'])
    t.write('\x1b[?2031h\x1b[!p')
    check('DECSTR clears the mode', t.state.enabled, false)
    t.paint('#171717')
    check('so the flip after a reset is silent', t.replies, [])
    t.write('\x1b[?996n')
    check('the appearance survives a reset', t.replies, [DARK])
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
