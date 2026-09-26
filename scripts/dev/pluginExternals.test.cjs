// Fast tier: the packaged-resolution model, and the shared module map checked
// against the recorded require set — no build needed.
//
//   node scripts/dev/pluginExternals.test.cjs
//
// The built tier (`check-plugin-externals.mjs`) scans the compiled bundles and
// keeps `plugin-externals.json` true; this suite holds the sources to it. So
// deleting a key from `cachedBuiltinModules`, or dropping a package from
// `app/package.json` that a bundle still requires, fails on a clean checkout.
const fs = require('fs')
const path = require('path')
const lib = require('./pluginExternals.cjs')

const root = path.resolve(__dirname, '..', '..')
let failures = 0
let passes = 0
function check (name, fn) {
    try {
        fn()
        passes++
        console.log(`ok    ${name}`)
    } catch (e) {
        failures++
        console.log(`FAIL  ${name}\n      ${e.message}`)
    }
}
function eq (actual, expected, what = '') {
    const a = JSON.stringify(actual)
    const b = JSON.stringify(expected)
    if (a !== b) {
        throw new Error(`${what} expected ${b}, got ${a}`)
    }
}

check('extractRequires finds webpack externals and plain requires, not look-alikes', () => {
    const src = [
        'module.exports = require("@angular/core/rxjs-interop");',
        "const fs = require('fs')",
        'x.require("not-this")',
        '__webpack_require__("./src/a.ts")',
        'myrequire("nor-this")',
        "//   var colors = require('colors/safe');",
        "  // require('winston').formats.json();",
        '   * const { Hook } = require(\'require-in-the-middle\')',
        'x = 1 // e.g. require(\'foo/lib/../bar.js\')',
        // biome-ignore lint/suspicious/noTemplateCurlyInString: the literal placeholder is the fixture
        'const s = `const dc = require("${e}")`',
    ].join('\n')
    eq([...lib.extractRequires(src)].sort(), ['@angular/core/rxjs-interop', 'fs'])
})

check('sharedModuleKeys reads quoted and bare keys, and the builtinModules extras', () => {
    const ts = [
        'const cachedBuiltinModules = {',
        "    '@angular/core': patch(require('@angular/core')),",
        "    'rxjs/operators': require('rxjs/operators'),",
        "    rxjs: require('rxjs'),",
        '}',
        'const builtinModules = [',
        '    ...Object.keys(cachedBuiltinModules),',
        "    'tabby-core',",
        ']',
    ].join('\n')
    eq([...lib.sharedModuleKeys(ts)].sort(), ['@angular/core', 'rxjs', 'rxjs/operators', 'tabby-core'])
})

check('packageRoot handles scoped and unscoped subpaths', () => {
    eq(lib.packageRoot('@angular/core/rxjs-interop'), '@angular/core')
    eq(lib.packageRoot('rxjs/operators'), 'rxjs')
    eq(lib.packageRoot('@tabby-gang/windows-process-tree/build/Release/x.node'), '@tabby-gang/windows-process-tree')
})

check('parseYarnLock + closure follow dependencies and optionalDependencies', () => {
    const lock = lib.parseYarnLock([
        '# yarn lockfile v1',
        '',
        '"@scope/a@^1.0.0", "@scope/a@^1.1.0":',
        '  version "1.1.0"',
        '  dependencies:',
        '    b "^2"',
        '  optionalDependencies:',
        '    "@scope/c" "3"',
        '',
        'b@^2:',
        '  version "2.0.0"',
        '',
        '"@scope/c@3":',
        '  version "3.0.0"',
        '',
        'unrelated@1:',
        '  version "1.0.0"',
        '',
    ].join('\n'))
    eq([...lib.closure(['@scope/a'], lock)].sort(), ['@scope/a', '@scope/c', 'b'])
})

// The v1.0.1 shape, reduced: `@angular/core` mapped, its subpath not, and
// `@angular` itself nowhere in the packaged app.
const v101 = {
    shared: new Set(['@angular/core', '@angular/common', 'rxjs', 'rxjs/operators']),
    appPackages: new Set(['rxjs', 'any-promise']),
    pluginPackages: new Map([['tabby-ssh', new Set(['@luminati-io/socksv5'])]]),
    builtinPlugins: new Set(['tabby-core', 'tabby-ssh']),
}

check('v1.0.1: @angular/core/rxjs-interop is unresolved when only @angular/core is mapped', () => {
    eq(lib.unresolved({ 'tabby-core': ['@angular/core', '@angular/core/rxjs-interop', 'fs', 'node:fs/promises', 'electron'] }, v101),
        [{ bundle: 'tabby-core', spec: '@angular/core/rxjs-interop' }])
})

check('mapping the subpath resolves it', () => {
    const fixed = { ...v101, shared: new Set([...v101.shared, '@angular/core/rxjs-interop']) }
    eq(lib.unresolved({ 'tabby-core': ['@angular/core/rxjs-interop'] }, fixed), [])
})

check('a plugin\'s own dependency serves it and nobody else', () => {
    eq(lib.resolveIn('@luminati-io/socksv5', 'tabby-ssh', v101), 'plugin-dependency')
    eq(lib.resolveIn('@luminati-io/socksv5', 'tabby-core', v101), null)
})

check('builtin plugins and app.asar packages resolve; the map does not serve the app bundles', () => {
    eq(lib.resolveIn('tabby-core', 'tabby-ssh', v101), 'builtin-plugin')
    eq(lib.resolveIn('any-promise', 'tabby-core', v101), 'app.asar')
    eq(lib.resolveIn('rxjs/operators', 'app', v101), 'app.asar')
    eq(lib.resolveIn('@angular/core', 'app', v101), null)
})

// ── The real tree ───────────────────────────────────────────────────────────

const snapshot = JSON.parse(fs.readFileSync(path.join(__dirname, 'plugin-externals.json'), 'utf8'))
const plugins = Object.keys(snapshot).filter(b => b !== 'app')
const ctx = lib.packagedContext(root, plugins)

check('the shared module map serves @angular/core/rxjs-interop (the v1.0.1 boot failure)', () => {
    if (!ctx.shared.has('@angular/core/rxjs-interop')) {
        throw new Error('app/src/plugins.ts cachedBuiltinModules has no @angular/core/rxjs-interop')
    }
})

check('every recorded runtime require resolves in a packaged app', () => {
    const missing = lib.unresolved(snapshot, ctx)
    if (missing.length) {
        throw new Error(missing.map(m => `${m.bundle}: require("${m.spec}")`).join('; '))
    }
})

check('every @angular / @ng-bootstrap / rxjs require is served by the map, not by luck', () => {
    // These are external to every plugin and absent from app.asar by design, so
    // nothing but the map may answer them. Asserted separately so that adding
    // `@angular/core` to app/package.json cannot quietly paper over a missing
    // key with a second copy of Angular.
    const offenders = []
    for (const [bundle, specs] of Object.entries(snapshot)) {
        if (bundle === 'app') {
            continue
        }
        for (const spec of specs) {
            if (/^(@angular|@ng-bootstrap|rxjs)(\/|$)/.test(spec) && lib.resolveIn(spec, bundle, ctx) !== 'shared-map') {
                offenders.push(`${bundle}: ${spec}`)
            }
        }
    }
    if (offenders.length) {
        throw new Error(offenders.join('; '))
    }
})

console.log(`\n${passes} passed, ${failures} failed`)
process.exit(failures ? 1 : 0)
