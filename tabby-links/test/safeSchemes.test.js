// Which schemes an OSC 8 link may use, and which open without a confirmation,
// checked against the sources with no build and no app.
//
//   node tabby-links/test/safeSchemes.test.js
//
// xterm drops every non-http(s) OSC 8 link unless the handler sets
// `allowNonHttpProtocols`, which is all-or-nothing. The decorator sets it and
// `isOsc8LinkAllowed` decides per link, so `stith://focus/<id>` opens through
// its protocol handler while `file:`, `javascript:` and `ms-*` stay inert.

const fs = require('fs')
const path = require('path')
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

const stubs = {
    '@angular/core': new Proxy({}, { get: () => (() => (target) => target) }),
    'tabby-core': { __esModule: true, HostAppService: class {}, Platform: { Windows: 'Windows', macOS: 'macOS', Linux: 'Linux' } },
    'tabby-terminal': new Proxy({}, { get: () => class Stub {} }),
}
const originalResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
    return stubs[request] ? request : originalResolve.call(this, request, ...rest)
}
const originalLoad = Module._load
Module._load = function (request, ...rest) {
    return stubs[request] ?? originalLoad.call(this, request, ...rest)
}
const ts = require(path.join(REPO, 'node_modules/typescript'))
Module._extensions['.ts'] = function (module, filename) {
    const source = fs.readFileSync(filename, 'utf8')
    module._compile(ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
    }).outputText, filename)
}

const src = p => require(path.join(REPO, 'tabby-links/src', p))
const { DEFAULT_SAFE_SCHEMES, safeSchemeList, isOsc8LinkAllowed } = src('safeSchemes.ts')
const { filesystemPath } = src('services/linkTarget.service.ts')

console.log('── the safe list ──')
check('stith is safe out of the box', DEFAULT_SAFE_SCHEMES.includes('stith'), true)
check('nothing configured is the built-in list', safeSchemeList(undefined), [...DEFAULT_SAFE_SCHEMES])
check('configured schemes are trimmed, lowercased and deduplicated',
    safeSchemeList([' VSCode ', '', 'stith', 'vscode']), [...DEFAULT_SAFE_SCHEMES, 'vscode'])

console.log('── which OSC 8 links are links ──')
check('stith opens', isOsc8LinkAllowed('stith://focus/abc123'), true)
check('upper-case STITH opens', isOsc8LinkAllowed('STITH://focus/abc123'), true)
check('https still opens', isOsc8LinkAllowed('https://example.com'), true)
check('http still opens', isOsc8LinkAllowed('http://example.com'), true)
check('file: stays refused', isOsc8LinkAllowed('file:///C:/Windows/System32/calc.exe'), false)
check('a bare Windows path stays refused', isOsc8LinkAllowed('C:\\Windows\\System32\\calc.exe'), false)
check('javascript: stays refused', isOsc8LinkAllowed('javascript:alert(1)'), false)
check('ms-settings: stays refused', isOsc8LinkAllowed('ms-settings:privacy'), false)
check('ms-msdt: stays refused', isOsc8LinkAllowed('ms-msdt:/id'), false)
check('vscode: stays refused, even though a user may list it', isOsc8LinkAllowed('vscode://file/x'), false)
check('a scheme-less string is refused', isOsc8LinkAllowed('stith'), false)

console.log('── a stith link is not mistaken for a file ──')
check('on Windows it resolves to no path, so the click goes to openExternal',
    filesystemPath('stith://focus/abc123', null, true, {}), '')
check('nor in a WSL tab', filesystemPath('stith://focus/abc123', 'Ubuntu', true, { Ubuntu: '/home/me' }), '')

console.log('── the decorator is wired to it ──')
const decorator = fs.readFileSync(path.join(REPO, 'tabby-links/src/decorator.ts'), 'utf8')
const wrapper = decorator.slice(decorator.indexOf('private wrapLinkHandler'), decorator.indexOf('private osc8Link'))
check('the OSC 8 handler lets non-http links through to it', /allowNonHttpProtocols: true,/.test(wrapper), true)
check('both its click and its hover return early unless isOsc8LinkAllowed', (wrapper.match(/if \(!isOsc8LinkAllowed\(uri\)\) \{\s*return\s*\}/g) ?? []).length, 2)

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
