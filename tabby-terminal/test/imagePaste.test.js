// Paste with an image and no text on the clipboard: what it sends instead.
//
//   node tabby-terminal/test/imagePaste.test.js
//
// Plain node, nothing running. Claude Code pastes images by reading the
// clipboard itself when it sees Ctrl+V (0x16), so paste has to hand it that byte
// rather than an empty paste — and only then, so text paste is untouched. The
// keystroke path in the real app, with the bytes that reach the session, is
// imagePaste.cdp.js.

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

const ip = require(path.join(REPO, 'tabby-terminal/src/imagePaste.ts'))
const { TerminalConfigProvider } = require(path.join(REPO, 'tabby-terminal/src/config.ts'))

// ── the byte ──────────────────────────────────────────────────────────────────

check('Ctrl+V is 0x16', ip.CTRL_V, '\x16')

// ── the default ───────────────────────────────────────────────────────────────

check('on by default', new TerminalConfigProvider().defaults.terminal.forwardCtrlVForImages, true)

// ── when paste sends Ctrl+V ───────────────────────────────────────────────────

check('an image and no text sends Ctrl+V', ip.imagePasteInput('', true, true), '\x16')
check('switched off, an image pastes as before', ip.imagePasteInput('', true, false), null)
check('an empty clipboard pastes as before', ip.imagePasteInput('', false, true), null)
check('text pastes as text', ip.imagePasteInput('hello', false, true), null)
// A browser's "Copy image" and some screenshot tools put text beside the image.
// The text is what the user will expect, and what every terminal pastes.
check('text beside an image pastes as text', ip.imagePasteInput('https://x.test/a.png', true, true), null)
check('whitespace is still text', ip.imagePasteInput(' ', true, true), null)
check('a newline is still text', ip.imagePasteInput('\n', true, true), null)

// Keeping the paste hotkey's key from also reaching xterm as a raw 0x16 is no
// longer paste's own rule but every hotkey's: tabby-core/test/hotkeyConsume.test.js.

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
