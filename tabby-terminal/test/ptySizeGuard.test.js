// When the PTY is sent the terminal's size again, as pure logic.
//
// Run with: node tabby-terminal/test/ptySizeGuard.test.js
const path = require('path')
const fs = require('fs')
const Module = require('module')

const REPO = path.resolve(__dirname, '../..')
const ts = require(path.join(REPO, 'node_modules/typescript'))

// Only the pure export is under test; the decorator's imports are stubbed.
const realResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
    if (['@angular/core', 'rxjs'].includes(request) || request.startsWith('./api/') || request === './session') {
        return request
    }
    return realResolve.call(this, request, ...rest)
}
for (const stub of ['@angular/core', 'rxjs', './api/baseTerminalTab.component', './api/decorator', './session']) {
    require.cache[stub] = { id: stub, filename: stub, loaded: true, exports: {
        Injectable: () => () => undefined,
        interval: () => undefined,
        TerminalDecorator: class {},
    } }
}
Module._extensions['.ts'] = function (module, filename) {
    const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, experimentalDecorators: true },
    }).outputText
    module._compile(js, filename)
}

const { needsResync, RESYNC_GRACE_MS } = require(path.join(REPO, 'tabby-terminal/src/ptySizeGuard.ts'))

let passed = 0
let failed = 0
function check (name, actual, expected) {
    if (actual === expected) {
        passed++
        console.log(`  ok   ${name}`)
    } else {
        failed++
        console.log(`  FAIL ${name}\n         expected ${expected}\n         actual   ${actual}`)
    }
}

const size = (columns, rows) => ({ columns, rows })
const settled = RESYNC_GRACE_MS + 1

check('the measured case: PTY 150, terminal 162', needsResync(size(162, 40), size(150, 40), settled), true)
check('rows alone drifting counts', needsResync(size(150, 41), size(150, 40), settled), true)
check('in step, nothing to do', needsResync(size(150, 40), size(150, 40), settled), false)
check('not while a resize may still be in flight', needsResync(size(162, 40), size(150, 40), RESYNC_GRACE_MS - 1), false)
check('nothing known to have been sent', needsResync(size(162, 40), null, settled), false)
check('a terminal not laid out yet (0 columns) is never sent', needsResync(size(0, 0), size(150, 40), settled), false)
check('nor one with no size at all', needsResync(null, size(150, 40), settled), false)

console.log(`\n${passed} passed, ${failed} failed`)
process.exitCode = failed ? 1 : 0
