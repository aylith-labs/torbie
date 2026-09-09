#!/usr/bin/env node
// Run the test suites, in tiers, and say plainly what ran and what did not.
//
//   node scripts/dev/run-tests.mjs           # the fast tier
//   node scripts/dev/run-tests.mjs --tier wsl
//   node scripts/dev/run-tests.mjs --list
//
// Why tiers rather than one command: these suites do genuinely different
// things and cost three orders of magnitude apart. The fast tier is pure
// logic — it needs a checkout and nothing else, so it is what CI gates on.
// The `*.cdp.js` suites each launch a hidden dev build and drive it over the
// debugging protocol, which takes 40-60s per launch and needs a compiled
// bundle; `*.electron.js` needs Electron's native ABI; `wslProbe` needs a real
// WSL distro. Running those on a hosted runner would mean a gate that is red
// for reasons having nothing to do with the change.
//
// The thing this replaces is worse than a slow gate: until now there was no
// `test` script in any package.json and no workflow ran any of these at all.
// Forty test files, every one of them run by hand.
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as url from 'node:url'

const root = path.resolve(url.fileURLToPath(new URL('.', import.meta.url)), '..', '..')

/**
 * Suites that need nothing but a checkout. Anything added here has to stay
 * that way: a fast-tier suite that quietly starts depending on a built bundle
 * turns the gate into a liability the first time somebody runs it on a clean
 * checkout.
 *
 * That is not hypothetical — `tabby-links/test/logic.test.js` was put here and
 * CI caught it on the first run, because it `require`s `tabby-links/dist` and
 * every developer machine already has one. It lives in BUILT now.
 */
const FAST = [
    'scripts/dev/cdp.test.cjs',
    'tabby-links/test/delimitedLinks.test.js',
    'tabby-links/test/wslPath.test.js',
    'tabby-resume/test/logic.test.js',
    'tabby-terminal/test/webSearch.test.js',
]

/**
 * Needs `yarn run build`, but no window and no Electron: it reads the compiled
 * bundle rather than driving it. Cheap once the build exists, which is why CI
 * runs it after the build step rather than skipping it.
 */
const BUILT = [
    'tabby-links/test/logic.test.js',
]

/** Consistency checks over the tree itself. `check-fork-marks` needs `upstream` fetched. */
const CHECKS = [
    'scripts/dev/check-docs.mjs',
    'scripts/dev/check-fork-marks.mjs',
]

/** Needs a real WSL distro; starts and cleans up its own panes, by pid. */
const WSL = [
    'tabby-resume/test/wslProbe.test.js',
]

/** Needs Electron's native ABI, via ELECTRON_RUN_AS_NODE. No window. */
const ELECTRON = [
    'tabby-resume/test/native.electron.js',
    'tabby-links/test/htmlPage.electron.js',
]

/**
 * Each launches a hidden dev build and drives it over CDP. Needs `yarn run
 * build` + `prepackage-plugins` first, and several need specific plugins
 * enabled — so these are listed, not run, and the list is the documentation.
 */
const CDP = [
    'app/test/jumpList.test.js',
    'app/test/moduleLookup.test.js',
    'app/test/startupFailure.test.js',
    'app/test/watchdog.test.js',
    'app/test/windowGeometry.test.js',
    'tabby-builds/test/asarDelete.cdp.js',
    'tabby-builds/test/tableView.cdp.js',
    'tabby-links/test/attribution.cdp.js',
    'tabby-links/test/card.cdp.js',
    'tabby-links/test/clicks.cdp.js',
    'tabby-links/test/credentials.cdp.js',
    'tabby-links/test/delimitedLinks.cdp.js',
    'tabby-links/test/html.cdp.js',
    'tabby-links/test/icons.cdp.js',
    'tabby-links/test/integrationsFreeze.cdp.js',
    'tabby-links/test/links.cdp.js',
    'tabby-links/test/pane.cdp.js',
    'tabby-links/test/presets.cdp.js',
    'tabby-links/test/preview.cdp.js',
    'tabby-links/test/rich.cdp.js',
    'tabby-links/test/ruleEditor.cdp.js',
    'tabby-links/test/wslPath.cdp.js',
    'tabby-resume/test/restart.cdp.js',
    'tabby-resume/test/resume.cdp.js',
    'tabby-terminal/test/glyphs.cdp.js',
    'tabby-terminal/test/webSearch.cdp.js',
    'tabby-upstream/test/forkMarks.cdp.js',
    'tabby-upstream/test/upstream.cdp.js',
]

const TIERS = { fast: FAST, built: BUILT, checks: CHECKS, wsl: WSL, electron: ELECTRON, cdp: CDP }

function arg (name, fallback) {
    const i = process.argv.indexOf(`--${name}`)
    return i === -1 ? fallback : process.argv[i + 1]
}

if (process.argv.includes('--list')) {
    for (const [tier, files] of Object.entries(TIERS)) {
        console.log(`\n${tier} (${files.length})`)
        for (const f of files) {
            console.log(`  ${f}`)
        }
    }
    process.exit(0)
}

const tier = arg('tier', 'fast')
const files = TIERS[tier]
if (!files) {
    console.error(`Unknown tier "${tier}". One of: ${Object.keys(TIERS).join(', ')}`)
    process.exit(2)
}

// The fast tier's whole value is that it needs nothing, and that claim decayed
// silently the first time it was made: a suite reading `tabby-links/dist`
// passed on every developer machine, because every one of them has a build
// sitting there, and only failed on a clean CI checkout. Grepping for the
// dependency is cruder than running it, but it fails at the moment the suite
// is *added* rather than the next time someone starts from a clean tree.
if (tier === 'fast') {
    const offenders = files.filter(file => {
        const full = path.join(root, file)
        return fs.existsSync(full) && /['"`][^'"`]*\/dist\//.test(fs.readFileSync(full, 'utf8'))
    })
    if (offenders.length) {
        console.error('These are in the fast tier but read a compiled bundle — move them to BUILT:')
        for (const file of offenders) {
            console.error(`  ${file}`)
        }
        process.exit(1)
    }
}

const failures = []
const missing = []
const started = Date.now()

for (const file of files) {
    const full = path.join(root, file)
    if (!fs.existsSync(full)) {
        // A renamed or deleted suite that silently stops running is exactly
        // the failure this script exists to prevent, so it is an error rather
        // than a skip.
        missing.push(file)
        console.log(`\n── ${file} ──  MISSING`)
        continue
    }
    console.log(`\n── ${file} ──`)
    try {
        execFileSync(process.execPath, [full], { cwd: root, stdio: 'inherit' })
    } catch {
        failures.push(file)
    }
}

const seconds = ((Date.now() - started) / 1000).toFixed(1)
console.log(`\n${tier}: ${files.length - failures.length - missing.length}/${files.length} suites passed in ${seconds}s`)
for (const file of missing) {
    console.log(`  missing  ${file}`)
}
for (const file of failures) {
    console.log(`  failed   ${file}`)
}
process.exit(failures.length + missing.length ? 1 : 0)
