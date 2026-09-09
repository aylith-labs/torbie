// A build must load its own builtin plugins, whatever the environment says.
//
//   node app/test/moduleLookup.test.js [path to a packaged build]
//
// Defaults to the newest slot under ~\Tabby\builds, and falls back to this
// checkout. Needs no app running: module resolution is the whole subject.
//
// A Tabby exports NODE_PATH to every shell it starts — its own
// builtin-plugins, its app.asar, and the user plugin directory. A Tabby
// launched from a terminal inside another Tabby therefore used to resolve
// `tabby-core` to the *other* build's copy, and a stale copy in the user
// plugin directory (which arrives whenever a third-party plugin lists a
// builtin as a dependency rather than a peer dependency) did the same. Either
// way: two Angulars, and a boot that stops on the splash screen with the
// process idle and nothing in the log.
//
// The ordering under test is two lines of app/src/plugins.ts, repeated here
// because that file cannot be imported outside Electron.
const fs = require('fs')
const os = require('os')
const path = require('path')
const Module = require('module')
const { execFileSync } = require('child_process')

const APPDATA = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming')

// Both names throughout. This test poisons NODE_PATH with the plugin
// directories of *other* installs and asserts the build still resolves its own
// builtins — so the more real foreign installs it can point at, the more it
// proves. A machine mid-rename has both, which is the worst case and therefore
// the one worth aiming at.
const PROFILE_DIRS = ['torbie', 'tabby']
const PRODUCT_DIRS = ['Torbie', 'Tabby']

const USER_PLUGINS = PROFILE_DIRS
    .map(name => path.join(APPDATA, name, 'plugins', 'node_modules'))
    .find(p => fs.existsSync(p)) ?? path.join(APPDATA, PROFILE_DIRS[0], 'plugins', 'node_modules')

const INSTALLED = PRODUCT_DIRS
    .map(name => path.join(os.homedir(), 'AppData', 'Local', 'Programs', name, 'resources'))
    .find(p => fs.existsSync(p)) ?? path.join(
        os.homedir(), 'AppData', 'Local', 'Programs', PRODUCT_DIRS[0], 'resources')

function newestSlot () {
    const slots = []
    for (const product of PRODUCT_DIRS) {
        const root = path.join(os.homedir(), product, 'builds')
        try {
            slots.push(...fs.readdirSync(root).map(name => path.join(root, name)))
        } catch {
            // No slots under that name; the other may still have some.
        }
    }
    return slots
        .filter(dir => fs.existsSync(path.join(dir, 'resources', 'builtin-plugins')))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] ?? null
}

const build = process.argv[2] ?? newestSlot()
if (!build) {
    console.log('skip  no packaged build to test against')
    process.exit(0)
}

const builtins = path.join(build, 'resources', 'builtin-plugins')
const paths = [
    builtins,
    path.join(build, 'resources', 'app.asar', 'node_modules'),
    USER_PLUGINS,
]

/** Every environment that used to hand a build somebody else's plugins. */
const ENVIRONMENTS = {
    'a clean launch': '',
    'launched from a shell inside another Tabby': [
        path.join(INSTALLED, 'builtin-plugins'),
        path.join(INSTALLED, 'app.asar', 'node_modules'),
        USER_PLUGINS,
    ].join(path.delimiter),
    'a stale builtin in the user plugin directory': USER_PLUGINS,
    // `+=` on an unset NODE_PATH produced this literal entry for years.
    'an inherited "undefined" entry': ['undefined', USER_PLUGINS].join(path.delimiter),
}

const MODULES = ['tabby-core', 'tabby-local', 'tabby-settings', 'tabby-terminal']

// Resolution has to happen in a child: NODE_PATH is read once per process.
const CHILD = `
const path = require('path')
const Module = require('module')
const paths = JSON.parse(process.argv[1])
const ours = process.argv[2] === 'new'
if (ours) {
    const inherited = (process.env.NODE_PATH ?? '').split(path.delimiter)
    process.env.NODE_PATH = [...paths, ...inherited].filter(x => x && x !== 'undefined').join(path.delimiter)
} else {
    process.env.NODE_PATH += path.delimiter + paths.join(path.delimiter)
}
Module._initPaths()
const out = {}
for (const m of ${JSON.stringify(MODULES)}) {
    try { out[m] = require.resolve(m) } catch (err) { out[m] = 'FAILED ' + err.code }
}
console.log(JSON.stringify(out))
`

function resolveWith (nodePath, ordering) {
    const stdout = execFileSync(process.execPath, ['-e', CHILD, JSON.stringify(paths), ordering], {
        encoding: 'utf-8',
        env: { ...process.env, NODE_PATH: nodePath },
    })
    return JSON.parse(stdout)
}

function foreign (resolved) {
    return Object.entries(resolved)
        .filter(([, file]) => !file.toLowerCase().startsWith(build.toLowerCase()))
        .map(([name, file]) => `${name} → ${file}`)
}

let failed = 0
let reproduced = 0
for (const [label, nodePath] of Object.entries(ENVIRONMENTS)) {
    const wrong = foreign(resolveWith(nodePath, 'old'))
    if (wrong.length) {
        reproduced++
    }
    const right = foreign(resolveWith(nodePath, 'new'))
    if (right.length) {
        console.error(`FAIL  ${label}: ${right.join(', ')}`)
        failed++
    } else {
        console.log(`ok    ${label}: all four builtins came from the build itself`
            + (wrong.length ? ` (the old ordering got ${wrong.length} of them elsewhere)` : ''))
    }
}

// Without this the run proves only that nothing is broken on a machine where
// nothing was ever wrong.
if (!reproduced) {
    console.error('FAIL  no environment reproduced the fault — this machine cannot prove the fix')
    failed++
}

process.exitCode = failed ? 1 : 0
