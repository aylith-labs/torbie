#!/usr/bin/env node
// Every runtime `require` in the compiled builtin plugins and app bundles must
// be answerable by a *packaged* app — see `pluginExternals.cjs` for the model
// and for the v1.0.1 boot failure this exists to stop recurring.
//
//   node scripts/dev/check-plugin-externals.mjs          # check (needs `yarn run build`)
//   node scripts/dev/check-plugin-externals.mjs --write  # accept a changed require set
//
// Two assertions, both against the build on disk:
//
//   1. **Nothing is unresolved.** A require nothing in the packaged app serves
//      fails here with the bundle that asked, rather than as a splash screen
//      that never goes away on somebody's machine.
//   2. **The set matches `plugin-externals.json`.** That snapshot is what the
//      fast tier checks the module map against without a build, so a
//      dependency upgrade that changes what the bundles ask for has to be
//      accepted here, with `--write`, where it is visible in review.
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as url from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const lib = require('./pluginExternals.cjs')
const root = path.resolve(url.fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const snapshotFile = path.join(root, 'scripts', 'dev', 'plugin-externals.json')
const { builtinPlugins } = await import(url.pathToFileURL(path.join(root, 'scripts', 'vars.mjs')).href)

// `tabby-web` is the browser build's plugin: never packaged, never loaded.
const plugins = builtinPlugins.filter(p => p !== 'tabby-web')
const APP_BUNDLES = ['main.js', 'preload.js', 'bundle.js', 'sentry.js']

function scan () {
    const byBundle = {}
    const missingBuilds = []
    const add = (bundle, file) => {
        const set = byBundle[bundle] ??= new Set()
        for (const spec of lib.extractRequires(fs.readFileSync(file, 'utf8'))) {
            set.add(spec)
        }
    }
    for (const plugin of plugins) {
        const dist = path.join(root, plugin, 'dist')
        const files = fs.existsSync(dist) ? fs.readdirSync(dist).filter(f => f.endsWith('.js')) : []
        if (!files.length) {
            missingBuilds.push(plugin)
            continue
        }
        for (const f of files) {
            add(plugin, path.join(dist, f))
        }
    }
    for (const f of APP_BUNDLES) {
        const file = path.join(root, 'app', 'dist', f)
        if (!fs.existsSync(file)) {
            missingBuilds.push(`app/${f}`)
            continue
        }
        add('app', file)
    }
    // Relative requires are chunk-to-chunk inside one dist; not a packaging question.
    return {
        byBundle: Object.fromEntries(Object.entries(byBundle).sort(([a], [b]) => a.localeCompare(b)).map(
            ([bundle, set]) => [bundle, [...set].filter(s => !s.startsWith('.')).sort()])),
        missingBuilds,
    }
}

const { byBundle, missingBuilds } = scan()
if (missingBuilds.length) {
    // A check that passes because there was nothing to check is the failure
    // mode this whole file is about.
    console.error(`not built: ${missingBuilds.join(', ')} — run \`yarn run build\` first`)
    process.exit(1)
}

const ctx = lib.packagedContext(root, plugins)
let failed = false

const missing = lib.unresolved(byBundle, ctx)
const total = Object.values(byBundle).reduce((n, specs) => n + specs.length, 0)
if (missing.length) {
    failed = true
    console.error(`FAIL  ${missing.length} runtime require(s) a packaged app cannot resolve:`)
    for (const { bundle, spec } of missing) {
        console.error(`        ${bundle}: require("${spec}")`)
    }
    console.error('      Add @angular/@ng-bootstrap/rxjs subpaths to `cachedBuiltinModules` in app/src/plugins.ts;')
    console.error('      anything else belongs in app/package.json `dependencies` or the plugin\'s own.')
} else {
    console.log(`ok    ${total} runtime requires across ${Object.keys(byBundle).length} bundles all resolve in a packaged app`)
}

const current = JSON.stringify(byBundle, null, 2) + '\n'
if (process.argv.includes('--write')) {
    fs.writeFileSync(snapshotFile, current)
    console.log(`wrote ${path.relative(root, snapshotFile)}`)
} else {
    const recorded = fs.existsSync(snapshotFile) ? JSON.parse(fs.readFileSync(snapshotFile, 'utf8')) : {}
    const diffs = []
    for (const bundle of new Set([...Object.keys(recorded), ...Object.keys(byBundle)])) {
        const was = new Set(recorded[bundle] ?? [])
        const now = new Set(byBundle[bundle] ?? [])
        for (const s of now) {
            if (!was.has(s)) {
                diffs.push(`+ ${bundle}: ${s}`)
            }
        }
        for (const s of was) {
            if (!now.has(s)) {
                diffs.push(`- ${bundle}: ${s}`)
            }
        }
    }
    if (diffs.length) {
        failed = true
        console.error('FAIL  the require set changed since plugin-externals.json was written:')
        for (const d of diffs) {
            console.error(`        ${d}`)
        }
        console.error('      Review it, then: node scripts/dev/check-plugin-externals.mjs --write')
    } else {
        console.log('ok    matches scripts/dev/plugin-externals.json')
    }
}

process.exit(failed ? 1 : 0)
