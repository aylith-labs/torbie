// Which key events a hotkey keeps from the terminal.
//
//   node tabby-core/test/hotkeyConsume.test.js
//
// Plain node, nothing running: the real HotkeysService, transpiled, fed the
// key events a keyboard sends. xterm's key handler asks consumedKeyEvent() of
// each keydown and does not type the key when the answer is yes, so this is the
// whole decision between "the hotkey's bytes" and "the hotkey's bytes and the
// key's own". The same keystrokes in the real app, with the bytes that reach
// the session, are tabby-terminal/test/hotkeyEcho.cdp.js.
//
// The bug this pins: the old check, `matchActiveHotkey(true)`, answered no for
// every one-chord hotkey until some plain keystroke had been recorded — at
// launch, and again after each multi-chord hotkey — so the first Ctrl-C of a
// session sent ^C twice. Each case below runs from an empty history *and* after
// a typed key, and must come out the same.

const path = require('path')
const fs = require('fs')
const Module = require('module')
const { Subject } = require('rxjs')

const REPO = path.resolve(__dirname, '../..')

// The service logs every match and unmatch.
console.debug = () => undefined

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

class EventEmitter extends Subject {
    emit (value) { this.next(value) }
}
const decorator = () => () => undefined
const stubs = {
    '@angular/core': { Injectable: decorator, Inject: decorator, NgZone: class {}, EventEmitter },
    '../api/hotkeyProvider': { HotkeyProvider: class {} },
    './config.service': { ConfigService: class {} },
    '../api/hostApp': { HostAppService: class {}, Platform: { Windows: 'Windows', macOS: 'macOS', Linux: 'Linux', Web: 'Web' } },
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
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2019,
            experimentalDecorators: true,
        },
    }).outputText
    module._compile(js, filename)
}

const { HotkeysService } = require(path.join(REPO, 'tabby-core/src/services/hotkeys.service.ts'))

const HOTKEYS = {
    'ctrl-c': ['Ctrl-C'],
    copy: ['Ctrl-Shift-C'],
    paste: ['Ctrl-Shift-V', 'Ctrl-V'],
    'previous-word': ['Ctrl-Left'],
    home: ['Home'],
    'shift-enter-newline': ['Shift-Enter'],
    chord: [['Ctrl-K', 'Ctrl-J']],
}

function service () {
    const zone = { run: fn => fn() }
    const config = {
        ready$: { toPromise: () => new Promise(() => undefined) },
        store: { hotkeys: HOTKEYS },
        enabledServices: x => x,
    }
    const hotkeys = new HotkeysService(zone, config, [], { platform: 'Windows' })
    const fired = []
    // What a handler does: `copy` gives the key back when nothing is selected.
    const state = { selection: '' }
    hotkeys.unfilteredHotkey$.subscribe(h => {
        fired.push(h)
        if (h === 'copy' && !state.selection) {
            hotkeys.passThrough()
        }
    })
    return { hotkeys, fired, state }
}

let clock = 1000
const MODIFIERS = { Ctrl: ['Control', 'ControlLeft', 'ctrlKey'], Shift: ['Shift', 'ShiftLeft', 'shiftKey'] }

function event (type, key, code, held) {
    return {
        type,
        key,
        code,
        ctrlKey: held.has('Ctrl'),
        shiftKey: held.has('Shift'),
        altKey: false,
        metaKey: false,
        repeat: false,
        timeStamp: clock += 40,
    }
}

/**
 * Press one chord the way a keyboard sends it, with each event going to
 * pushKeyEvent as xterm's handler sends it, and return whether the main key's
 * keydown was consumed.
 */
function press ({ hotkeys }, modifiers, key, code) {
    const held = new Set()
    for (const m of modifiers) {
        held.add(m)
        const e = event('keydown', MODIFIERS[m][0], MODIFIERS[m][1], held)
        hotkeys.pushKeyEvent('keydown', e)
    }
    const down = event('keydown', key, code, held)
    hotkeys.pushKeyEvent('keydown', down)
    const consumed = hotkeys.consumedKeyEvent(down)
    hotkeys.pushKeyEvent('keyup', event('keyup', key, code, held))
    for (const m of [...modifiers].reverse()) {
        held.delete(m)
        hotkeys.pushKeyEvent('keyup', event('keyup', MODIFIERS[m][0], MODIFIERS[m][1], held))
    }
    return consumed
}

for (const history of ['an empty history', 'a typed key first']) {
    const at = s => `${s}, from ${history}`
    const fresh = () => {
        const s = service()
        if (history !== 'an empty history') {
            press(s, [], 'x', 'KeyX')
        }
        s.fired.length = 0
        return s
    }

    let s = fresh()
    check(at('Ctrl-C fires ctrl-c'), [press(s, ['Ctrl'], 'c', 'KeyC'), s.fired], [true, ['ctrl-c']])
    check(at('and a second one too'), [press(s, ['Ctrl'], 'c', 'KeyC'), s.fired], [true, ['ctrl-c', 'ctrl-c']])

    s = fresh()
    check(at('Ctrl-V (paste) keeps its key'), press(s, ['Ctrl'], 'v', 'KeyV'), true)
    s = fresh()
    check(at('Ctrl-Left keeps its key'), press(s, ['Ctrl'], 'ArrowLeft', 'ArrowLeft'), true)
    s = fresh()
    check(at('Home keeps its key'), press(s, [], 'Home', 'Home'), true)
    s = fresh()
    check(at('Shift-Enter (a plugin\'s hotkey) keeps its key'), press(s, ['Shift'], 'Enter', 'Enter'), true)

    s = fresh()
    check(at('copy with nothing selected gives the key back'), [press(s, ['Ctrl', 'Shift'], 'C', 'KeyC'), s.fired.includes('copy')], [false, true])
    s = fresh()
    s.state.selection = 'text'
    check(at('copy with a selection keeps it'), press(s, ['Ctrl', 'Shift'], 'C', 'KeyC'), true)

    s = fresh()
    check(at('a plain key is not consumed'), [press(s, [], 'x', 'KeyX'), s.fired], [false, []])
    s = fresh()
    check(at('Ctrl with an unbound key is not consumed'), [press(s, ['Ctrl'], 'b', 'KeyB'), s.fired], [false, []])

    // A chord's first key cannot be known to be one until the second comes, so
    // it types; the key that completes it is the hotkey's.
    s = fresh()
    check(at('a chord\'s first key types'), press(s, ['Ctrl'], 'k', 'KeyK'), false)
    check(at('the key completing it does not'), [press(s, ['Ctrl'], 'j', 'KeyJ'), s.fired], [true, ['chord']])
    check(at('and a one-chord hotkey right after it still keeps its key'), press(s, ['Ctrl'], 'c', 'KeyC'), true)
}

// Only the keydown a hotkey fired on: its own keyup, and some other event, are not.
{
    const s = service()
    const held = new Set(['Ctrl'])
    s.hotkeys.pushKeyEvent('keydown', event('keydown', 'Control', 'ControlLeft', held))
    const down = event('keydown', 'c', 'KeyC', held)
    s.hotkeys.pushKeyEvent('keydown', down)
    const up = event('keyup', 'c', 'KeyC', held)
    s.hotkeys.pushKeyEvent('keyup', up)
    check('the keyup is not consumed', s.hotkeys.consumedKeyEvent(up), false)
    check('the keydown still is', s.hotkeys.consumedKeyEvent(down), true)
    check('an unrelated event is not', s.hotkeys.consumedKeyEvent(event('keydown', 'x', 'KeyX', new Set())), false)
}

// Hotkeys switched off (the hotkey recorder does this) consume nothing.
{
    const s = service()
    s.hotkeys.disable()
    check('disabled, Ctrl-C types', press(s, ['Ctrl'], 'c', 'KeyC'), false)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
