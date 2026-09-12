// What a running build is offered when a newer one appears, and whether the
// offer may delete it: pure logic, no app, no bundle.
//
// `newBuildChoice.ts` and `productNames.ts` are transpiled on the fly, the way
// navGroups.test.js does it, so this runs on a clean checkout.
//
// Run with: node tabby-builds/test/newBuildChoice.test.js
const path = require('path')
const fs = require('fs')
const Module = require('module')

const REPO = path.resolve(__dirname, '../..')

const ts = require(path.join(REPO, 'node_modules/typescript'))
Module._extensions['.ts'] = function (module, filename) {
    const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019, useDefineForClassFields: false },
    }).outputText
    module._compile(js, filename)
}

const { mayDeleteOnSwitch, newerBuild, watchesForNewerBuilds } =
    require(path.join(REPO, 'tabby-builds/src/newBuildChoice.ts'))
const { productFromExecutable, productFromPackageName } =
    require(path.join(REPO, 'tabby-builds/src/productNames.ts'))

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
        console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`)
    }
}

const HOUR = 3600 * 1000
// The reported case: the installed release was built at 09:18 local time, and
// both the checkout's electron-builder output and the canary slot at 12:54.
const RELEASE = Date.parse('2026-09-12T07:18:00Z')
const LATER = RELEASE + 3.6 * HOUR

const build = (id, kind, product, builtAt, extra = {}) => Object.assign(
    { id, kind, product, builtAt, executable: `C:\\builds\\${id}\\${product || 'electron'}.exe` },
    extra,
)
const idOf = x => x ? x.id : null

console.log('the reported dialog')
{
    const installed = build('installed-torbie', 'installed', 'Torbie', RELEASE)
    const winUnpacked = build('checkout-win-unpacked', 'packaged', 'Torbie', LATER)
    const canary = build('canary', 'portable', 'Torbie', LATER)
    check('an installed release does not look for newer builds', watchesForNewerBuilds(installed), false)
    check('an installed release is offered neither the checkout output nor a newer slot',
        idOf(newerBuild(installed, [installed, winUnpacked, canary])), null)
}

console.log('where a switch may land')
{
    const running = build('dev', 'portable', 'Torbie', RELEASE)
    check('a newer slot of the same product is offered',
        idOf(newerBuild(running, [running, build('canary', 'portable', 'Torbie', LATER)])), 'canary')
    check('a newer installed build of the same product is offered',
        idOf(newerBuild(running, [running, build('installed', 'installed', 'Torbie', LATER)])), 'installed')
    check('electron-builder output is never offered, however new',
        idOf(newerBuild(running, [running, build('win-unpacked', 'packaged', 'Torbie', LATER)])), null)
    check('an installer file is never offered',
        idOf(newerBuild(running, [running, build('setup', 'installer', 'Torbie', LATER)])), null)
    check('a newer source build is not offered',
        idOf(newerBuild(running, [running, build('checkout', 'source', 'Torbie', LATER)])), null)
    check('upstream Tabby is never offered to Torbie, however new',
        idOf(newerBuild(running, [running, build('tabby', 'installed', 'Tabby', LATER)])), null)
    check('the newest of several candidates wins',
        idOf(newerBuild(running, [
            build('older', 'portable', 'Torbie', RELEASE + HOUR),
            running,
            build('newest', 'portable', 'Torbie', LATER),
        ])), 'newest')
    check('a build made at the same moment is not newer',
        idOf(newerBuild(running, [running, build('twin', 'portable', 'Torbie', RELEASE)])), null)
    check('a build with no executable is not offered',
        idOf(newerBuild(running, [running, build('broken', 'portable', 'Torbie', LATER, { executable: null })])), null)
    check('a build with no build time is not offered',
        idOf(newerBuild(running, [running, build('undated', 'portable', 'Torbie', null)])), null)
}

console.log('which running builds look at all')
{
    const source = build('checkout', 'source', 'Torbie', RELEASE)
    check('a source build is offered a newer slot',
        idOf(newerBuild(source, [source, build('canary', 'portable', 'Torbie', LATER)])), 'canary')
    const unnamed = build('mystery', 'portable', null, RELEASE)
    check('a build whose product is unknown is offered nothing',
        idOf(newerBuild(unnamed, [unnamed, build('canary', 'portable', null, LATER)])), null)
    check('an undated build does not look for newer builds',
        watchesForNewerBuilds(build('undated', 'portable', 'Torbie', null)), false)
}

console.log('what may be deleted on the way out')
check('a slot that is not the active build',
    mayDeleteOnSwitch(build('dev', 'portable', 'Torbie', RELEASE), false), true)
check('never the active slot',
    mayDeleteOnSwitch(build('dev', 'portable', 'Torbie', RELEASE), true), false)
check('never an installed build, which has an uninstaller',
    mayDeleteOnSwitch(build('installed', 'installed', 'Torbie', RELEASE), false), false)
check('never a source build, which is more than its root',
    mayDeleteOnSwitch(build('checkout', 'source', 'Torbie', RELEASE), false), false)
check('never unpacked electron-builder output',
    mayDeleteOnSwitch(build('win-unpacked', 'packaged', 'Torbie', RELEASE), false), false)

console.log('naming a build after its product')
check('an installed Windows executable',
    productFromExecutable('C:\\Users\\steve\\AppData\\Local\\Programs\\Torbie\\Torbie.exe'), 'Torbie')
check('an upstream Windows executable',
    productFromExecutable('C:\\Users\\steve\\AppData\\Local\\Programs\\Tabby\\Tabby.exe'), 'Tabby')
check('a Linux executable', productFromExecutable('/opt/Torbie/torbie'), 'Torbie')
check('a macOS bundle executable', productFromExecutable('/Applications/Torbie.app/Contents/MacOS/Torbie'), 'Torbie')
check('electron.exe names no product',
    productFromExecutable('C:\\src\\node_modules\\electron\\electron.exe'), null)
check('a look-alike file name is not a product', productFromExecutable('C:\\builds\\Torbie-dev.exe'), null)
check('a checkout package name', productFromPackageName('torbie'), 'Torbie')
check('an upstream checkout package name', productFromPackageName('tabby'), 'Tabby')
check('a plugin package is not a product', productFromPackageName('tabby-core'), null)
check('no name at all', productFromPackageName(undefined), null)

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
