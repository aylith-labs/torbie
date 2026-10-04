// Light or dark in a running build: `CSI ? 996 n` answered, and mode 2031's
// report pushed when the colour scheme flips. With --wsl, the same through
// the inbox ConPTY to a program in WSL, which is how shefrd sees it.
//
//   node scripts/dev/launch-hidden.mjs --keep &
//   node tabby-terminal/test/colorSchemeReports.cdp.js [--wsl]
//
// The colour scheme is flipped through `appearance.colorSchemeMode`, which
// re-applies the pane's colours the way a settings change or an OS theme
// change does. It is put back at the end.
//
// --wsl writes a probe to /tmp in the default Ubuntu distro and types one
// command into the pane: the probe sets mode 2031, asks 996, and records what
// arrives while this flips the scheme under it. Measured before this existed:
// the same probe got nothing for 996, nothing on a flip, and nothing for an
// `OSC 11 ; ?`, which the inbox ConPTY never forwards at all.
const fs = require('fs')
const { connect, closeAll } = require('./cdp')

const WITH_WSL = process.argv.includes('--wsl')
const DARK = '\x1b[?997;1n'
const LIGHT = '\x1b[?997;2n'

const SETUP = `
    let cmp = null
    let tab = null
    for (let i = 0; i < 60 && !tab; i++) {
        try {
            cmp = window.ng.getComponent(document.querySelector('app-root'))
            const all = cmp.app.tabs.flatMap(t => t.getAllTabs ? t.getAllTabs() : [t])
            tab = all.find(t => t.session && t.frontend && t.frontend.xterm) ?? null
        } catch { /* not up yet */ }
        if (!tab) { await new Promise(r => setTimeout(r, 500)) }
    }
    if (!tab) { throw new Error('no terminal tab with a live session') }
    const T = window.__CSR = {
        tab,
        feed: tab.session.feedFromTerminal,
        mode: tab.config.store.appearance.colorSchemeMode,
        sent: [],
        capture: true,
    }
    tab.session.feedFromTerminal = (buffer) => {
        T.sent.push(buffer.toString('latin1'))
        if (!T.capture) { T.feed.call(tab.session, buffer) }
    }
    return typeof tab.frontend.colorSchemeReports
`

const RESTORE = `
    const T = window.__CSR
    if (!T) { return false }
    T.tab.session.feedFromTerminal = T.feed
    T.tab.config.store.appearance.colorSchemeMode = T.mode
    await T.tab.config.save()
    delete window.__CSR
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

const PROBE = `import os, select, sys, termios, time, tty
out = sys.argv[1]
fd = sys.stdin.fileno()
saved = termios.tcgetattr(fd)
tty.setraw(fd)
got = {}
def read(label, wait):
    deadline = time.time() + wait
    data = b""
    while time.time() < deadline:
        if select.select([fd], [], [], 0.05)[0]:
            data += os.read(fd, 4096)
    got[label] = data.decode("latin1")
try:
    os.write(1, b"\\x1b]11;?\\x1b\\\\")
    read("osc11", 1.5)
    os.write(1, b"\\x1b[?2031h\\x1b[?996n")
    read("asked", 1.5)
    open(out + ".ready", "w").close()
    read("pushed", 5)
    os.write(1, b"\\x1b[?2031l")
finally:
    termios.tcsetattr(fd, termios.TCSADRAIN, saved)
    import json
    json.dump(got, open(out, "w"))
`

async function main () {
    const d = await connect({})
    const setMode = mode => d.evaluate(`
        const T = window.__CSR
        T.tab.config.store.appearance.colorSchemeMode = ${JSON.stringify(mode)}
        await T.tab.config.save()
        await new Promise(r => setTimeout(r, 300))
        return T.tab.frontend.colorSchemeReports.current
    `)
    const collect = async (action, wait = 150) => {
        await d.evaluate('window.__CSR.sent = []; return 1')
        await action()
        await sleep(wait)
        return (await d.evaluate('return window.__CSR.sent')).join('')
    }
    const appWrites = data => collect(() => d.evaluate(`await new Promise(r => window.__CSR.tab.frontend.xterm.write(${JSON.stringify(data)}, r)); return 1`))

    try {
        check('setup: the frontend carries the report state', await d.evaluate(SETUP), 'object')

        check('a light scheme is light', await setMode('light'), 'light')
        check('996 answers light', await appWrites('\x1b[?996n'), LIGHT)
        check('DECRQM 2031 before: reset', await appWrites('\x1b[?2031$p'), '\x1b[?2031;2$y')
        check('a flip with the mode unset is silent', await collect(() => setMode('dark')), '')
        check('996 now answers dark', await appWrites('\x1b[?996n'), DARK)

        check('setting 2031 is not answered', await appWrites('\x1b[?2031h'), '')
        check('DECRQM 2031 after: set', await appWrites('\x1b[?2031$p'), '\x1b[?2031;1$y')
        check('dark → light pushes 997;2', await collect(() => setMode('light')), LIGHT)
        check('re-saving the same mode pushes nothing', await collect(() => setMode('light')), '')
        check('light → dark pushes 997;1', await collect(() => setMode('dark')), DARK)
        await appWrites('\x1b[?2031l')
        check('after 2031 l a flip is silent again', await collect(() => setMode('light')), '')
        check('OSC 11 still answers from xterm', await appWrites('\x1b]11;?\x1b\\'), '\x1b]11;rgb:ffff/ffff/ffff\x1b\\')
        const dsr = await appWrites('\x1b[?996n\x1b[?6n')
        const cursorReport = dsr.startsWith(LIGHT) ? dsr.slice(LIGHT.length) : ''
        check('996 answers once and xterm\'s own DSR ?6 still answers', [dsr.split(LIGHT).length - 1, cursorReport.startsWith('\x1b[?') && cursorReport.endsWith('R')], [1, true])

        if (WITH_WSL) {
            console.log('\n  through ConPTY, in WSL')
            const unc = '\\\\wsl.localhost\\Ubuntu\\tmp\\'
            const out = `/tmp/torbie-csr-${process.pid}.json`
            fs.writeFileSync(`${unc}torbie-csr-probe.py`, PROBE)
            check('starting light', await setMode('light'), 'light')
            await d.evaluate(`window.__CSR.capture = false; window.__CSR.tab.sendInput(${JSON.stringify(`wsl.exe -d Ubuntu -- python3 /tmp/torbie-csr-probe.py ${out}\r`)}); return 1`)
            const ready = `${unc}${out.slice(5)}.ready`
            for (let i = 0; i < 60 && !fs.existsSync(ready); i++) { await sleep(500) }
            check('the probe got as far as waiting', fs.existsSync(ready), true)
            await sleep(500)
            await setMode('dark')
            const result = `${unc}${out.slice(5)}`
            for (let i = 0; i < 40 && !fs.existsSync(result); i++) { await sleep(500) }
            const got = JSON.parse(fs.readFileSync(result, 'utf8'))
            console.log(`       probe saw ${JSON.stringify(got)}`)
            check('OSC 11 never arrives through the inbox ConPTY (why 996 matters)', got.osc11, '')
            check('996 is answered light through ConPTY', got.asked, LIGHT)
            check('the flip to dark reaches the program unasked', got.pushed, DARK)
            for (const f of [result, ready, `${unc}torbie-csr-probe.py`]) { fs.rmSync(f, { force: true }) }
        }
    } finally {
        try {
            await d.evaluate(RESTORE)
        } catch { /* the instance went away */ }
        closeAll()
    }
    console.log(`\n${passed} passed, ${failed} failed`)
    process.exitCode = failed ? 1 : 0
}

main().catch(err => {
    console.error(err)
    process.exitCode = 1
}).finally(closeAll)
