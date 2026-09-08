#!/usr/bin/env node
// Hold the provenance marks to what the tree actually says.
//
//   node scripts/dev/check-fork-marks.mjs
//
// Two claims are made in the settings window and neither is self-maintaining:
// a filled diamond means "upstream Tabby does not have this setting", and a
// hollow one means "it does, and gives you no control for it". Both go stale
// the moment a rebase brings a key upstream, or the fork adds one — silently,
// and in the direction that makes the app *lie* rather than merely omit.
//
// So the fork-added list is recomputed here from git rather than trusted:
// keys(working tree) - keys(upstream/master). Same shape as `check-docs.mjs`,
// which recomputes its numbers from git for the same reason: collect every
// failure, then exit 1.
//
// The config-only list cannot be computed — see `configOnly` in
// `fork-settings.json` — so it is reviewed by hand and this only refuses to let
// it drift unnoticed.
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as url from 'node:url'

const REPO = path.resolve(url.fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const DATA = path.join(REPO, 'scripts', 'dev', 'fork-settings.json')

const failures = []
const warnings = []
function fail (message) { failures.push(message) }
function warn (message) { warnings.push(message) }

function git (args) {
    return execFileSync('git', ['-C', REPO, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

/**
 * Every tracked file, from git rather than from the filesystem.
 *
 * This is not a style preference. `builtin-plugins/` and every `dist/` are
 * gitignored build output containing a bundled copy of every config default and
 * every compiled template — a filesystem walk finds each key a dozen times over
 * and concludes that everything has a UI.
 */
function tracked (pattern) {
    return git(['ls-files', pattern]).split('\n').filter(Boolean)
}

function readAt (ref, file) {
    try {
        return git(['show', `${ref}:${file}`])
    } catch {
        return null
    }
}

// ── the declared keys ───────────────────────────────────────────────────────

/**
 * Config keys declared by a YAML defaults file or a `ConfigProvider`.
 *
 * Indentation-based rather than a real parse, and that is enough here because
 * both shapes are hand-written in one house style — but it means the result is
 * a set of *leaf paths under a top-level section*, which is exactly the
 * granularity the marks work at.
 */
function keysFromYaml (text) {
    const keys = new Set()
    const stack = []
    for (const raw of text.split('\n')) {
        if (!raw.trim() || raw.trim().startsWith('#')) { continue }
        const indent = raw.search(/\S/)
        const match = /^\s*([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/.exec(raw)
        if (!match) { continue }
        while (stack.length && stack[stack.length - 1].indent >= indent) { stack.pop() }
        const p = [...stack.map(s => s.key), match[1]].join('.')
        keys.add(p)
        if (!match[2]) { stack.push({ indent, key: match[1] }) }
    }
    return keys
}

/** The same, for the `defaults = { … }` literal in a ConfigProvider. */
function keysFromProvider (text) {
    const keys = new Set()
    const start = text.indexOf('defaults = {')
    if (start < 0) { return keys }
    const stack = []
    for (const raw of text.slice(start).split('\n').slice(1)) {
        const indent = raw.search(/\S/)
        if (indent < 0) { continue }
        // The literal ends when we return to the class body's indentation.
        if (indent <= 4 && raw.trim().startsWith('}')) { break }
        const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(raw)
        if (!match) { continue }
        while (stack.length && stack[stack.length - 1].indent >= indent) { stack.pop() }
        const p = [...stack.map(s => s.key), match[1]].join('.')
        keys.add(p)
        if (match[2].startsWith('{')) { stack.push({ indent, key: match[1] }) }
    }
    return keys
}

/**
 * Every config key this build declares.
 *
 * `ref` of null means the working tree, which is what the fork side is read
 * from: the useful question is whether the marks match what you are about to
 * commit, not what you committed last time. `master` is read from git, since
 * it is a ref by definition.
 *
 * `platformDefaults` is deliberately not parsed — its keys are computed
 * (`[Platform.Windows]`) and would come out as nonsense paths. See knownGaps
 * in fork-settings.json for what that leaves unaccounted.
 */
function declaredKeys (ref) {
    const keys = new Set()
    const read = file => ref === null
        ? fs.readFileSync(path.join(REPO, file), 'utf8')
        : readAt(ref, file)
    for (const file of tracked('*configDefaults*.yaml')) {
        const text = read(file)
        if (text) { for (const k of keysFromYaml(text)) { keys.add(k) } }
    }
    for (const file of tracked('*/src/config.ts')) {
        const text = read(file)
        if (text) { for (const k of keysFromProvider(text)) { keys.add(k) } }
    }
    return keys
}

// ── the settings templates ──────────────────────────────────────────────────

/**
 * Every settings row, with the key it edits and the marks it carries.
 *
 * A key counts as *edited* by a row only when it appears on a line that also
 * carries a model binding. A `*ngIf` that reads a setting to decide whether to
 * show something is not a control for it, and counting it as one is half of how
 * a naive sweep gets this wrong in both directions.
 */
const BINDING = /ngModel|ngModelChange|\[value\]|\[ngValue\]|\[checked\]/
function rows () {
    const out = []
    for (const file of tracked('*.pug')) {
        const lines = fs.readFileSync(path.join(REPO, file), 'utf8').split('\n')
        for (let i = 0; i < lines.length; i++) {
            // `.ms-5.form-line` is how the docking sub-settings are indented,
            // so the class may not be first in the chain. Matching only a
            // leading `.form-line` made six rows that plainly have controls
            // look as though they had none.
            const m = /^(\s*)\.[\w.-]*\bform-line\b/.exec(lines[i])
            if (!m) { continue }
            const indent = m[1].length
            let j = i + 1
            while (j < lines.length) {
                const line = lines[j]
                if (!line.trim()) { j++; continue }
                const at = line.search(/\S/)
                if (at > indent) { j++; continue }
                // A control is not always *inside* its row: "Custom CSS" puts
                // its textarea after the `.form-line` as a sibling. So a line at
                // the same depth still belongs to the row unless it starts a new
                // row or a heading.
                if (at === indent && !/^\s*\.[\w.-]*\bform-line\b/.test(line) && !/^\s*h[1-6]\b/.test(line)) {
                    j++
                    continue
                }
                break
            }
            const body = lines.slice(i, j)
            const titleLine = body.find(l => l.includes('.title'))
            const keys = new Set()
            for (const line of body) {
                if (!BINDING.test(line)) { continue }
                for (const hit of line.matchAll(/config\.store\.([A-Za-z0-9_.]+)/g)) {
                    keys.add(hit[1].replace(/\.$/, ''))
                }
            }
            out.push({
                file,
                line: i + 1,
                title: titleLine ? titleLine.replace(/^\s*\.title[^)]*\)?\s*/, '').trim() : '(untitled)',
                fork: !!titleLine && /\.title[\w.-]*\.fork-mark\b|\.fork-mark[\w.-]*\.title\b/.test(titleLine),
                configOnly: !!titleLine && titleLine.includes('config-only-mark'),
                keys: [...keys],
            })
        }
    }
    return out
}

// ── the checks ──────────────────────────────────────────────────────────────

const data = JSON.parse(fs.readFileSync(DATA, 'utf8'))

// 1. The fork-added set, recomputed. This is the check that fires when a
//    cherry-pick from upstream brings a key we had marked as ours.
//
//    Compared against `upstream/master` itself rather than a local mirror
//    branch. This fork used to keep `master` as a pristine copy for exactly
//    this purpose; it has a single `main` now, so the remote-tracking ref is
//    both the only answer available and the more honest one — it is upstream,
//    not our record of it.
const UPSTREAM_REF = process.env.TABBY_UPSTREAM_REF || 'upstream/master'
const localKeys = declaredKeys(null)
let upstreamKeys
try {
    git(['rev-parse', '--verify', '--quiet', `${UPSTREAM_REF}^{commit}`])
    upstreamKeys = declaredKeys(UPSTREAM_REF)
} catch {
    console.log(`FAIL  ${UPSTREAM_REF} is not reachable — the fork-added set cannot be computed.`)
    console.log('      Add the remote and fetch it:')
    console.log('        git remote add upstream https://github.com/Eugeny/tabby')
    console.log('        git fetch upstream')
    console.log('      Or name another ref with TABBY_UPSTREAM_REF.')
    process.exit(1)
}
const derived = [...localKeys].filter(k => !upstreamKeys.has(k)).sort()
const recorded = [...data.forkAdded].sort()
const missing = derived.filter(k => !recorded.includes(k))
const gaps = data.knownGaps.map(e => e.key)
const extra = recorded.filter(k => !derived.includes(k) && !gaps.includes(k))

// `--write` rewrites the derived half of the data file. That list is git's
// answer rather than an opinion, so retyping it by hand is only a chance to get
// it wrong — but it stays checked in, so a rebase that carries a key upstream
// shows up as a reviewable diff instead of a silently different answer.
if (process.argv.includes('--write')) {
    const updated = { ...data, forkAdded: [...new Set([...derived, ...gaps])].sort() }
    fs.writeFileSync(DATA, JSON.stringify(updated, null, 2) + '\n')
    console.log(`wrote ${updated.forkAdded.length} fork-added keys to ${path.relative(REPO, DATA)}`)
    process.exit(0)
}
if (missing.length) {
    fail(`fork-added keys not in ${path.basename(DATA)}: ${missing.join(', ')}`)
}
if (extra.length) {
    fail(`keys recorded as fork-added that master now has too (upstream took them, or they were removed): ${extra.join(', ')}`)
}

const allRows = rows()
const forkPages = new Set(data.forkAddedPages)

// 2 & 3. Every marked row is one of ours, and every one of ours that has a row
// is marked. Both directions, so the mark can neither over- nor under-claim.
const switchRows = new Set(data.switchRows)
for (const row of allRows) {
    if (!row.fork) { continue }
    if (switchRows.has(row.title)) { continue }
    const claimed = row.keys.filter(k => derived.includes(k))
    if (!claimed.length) {
        fail(`${row.file}:${row.line} "${row.title}" carries the fork mark but edits no fork-added key (${row.keys.join(', ') || 'no key found'})`)
    }
}
const rowsByKey = new Map()
for (const row of allRows) {
    for (const k of row.keys) {
        if (!rowsByKey.has(k)) { rowsByKey.set(k, []) }
        rowsByKey.get(k).push(row)
    }
}
for (const key of derived) {
    const owning = (rowsByKey.get(key) ?? []).filter(r => !forkPages.has(r.file))
    if (!owning.length) { continue }
    if (!owning.some(r => r.fork)) {
        const where = owning.map(r => `${r.file}:${r.line}`).join(', ')
        fail(`fork-added key "${key}" has a row on a shared page but no fork mark (${where})`)
    }
}

// 4. A row carries at most one mark. Which one wins is settled in the
// stylesheet; a row asserting both is a decision nobody made.
for (const row of allRows) {
    if (row.fork && row.configOnly) {
        fail(`${row.file}:${row.line} "${row.title}" carries both marks`)
    }
}

// 5. The noise rule: a page that is entirely ours is marked once, on its nav
// entry, and its rows carry nothing.
for (const row of allRows) {
    if (!forkPages.has(row.file)) { continue }
    if (row.fork && !switchRows.has(row.title)) {
        fail(`${row.file}:${row.line} "${row.title}" is on a fork-added page, which is marked on its nav entry — the row should carry no mark`)
    }
}

// 6. Every fork-added page says so, and no upstream one does.
for (const file of tracked('*/src/providers.ts').concat(tracked('*/src/settings.ts'))) {
    const text = fs.readFileSync(path.join(REPO, file), 'utf8')
    if (!text.includes('extends SettingsTabProvider')) { continue }
    // Against upstream, not a local mirror branch — the fork has a single
    // `main` now, and asking a branch that no longer exists answers "absent"
    // for every file, which makes every upstream settings page look like ours.
    const isFork = readAt(UPSTREAM_REF, file) === null
    // Counted, not merely present: `tabby-links/src/providers.ts` declares two
    // settings pages, and a substring test is satisfied by either of them — so
    // dropping `forkAdded` from one left its nav entry unmarked and the check
    // green. Measured, while verifying the check could fail at all.
    const providers = (text.match(/extends SettingsTabProvider\b/g) ?? []).length
    const declared = (text.match(/forkAdded = true/g) ?? []).length
    if (isFork && declared < providers) {
        fail(`${file} declares ${providers} settings page(s) but only ${declared} set forkAdded = true`)
    }
    if (!isFork && declared) {
        fail(`${file} is upstream's but claims forkAdded`)
    }
}

// 7. The config-only list still holds, in both directions.
for (const entry of data.configOnly) {
    const owning = rowsByKey.get(entry.key) ?? []
    if (!owning.length) {
        warn(`config-only key "${entry.key}" has no row, so its hollow mark is not drawn anywhere`)
        continue
    }
    if (!owning.some(r => r.configOnly)) {
        fail(`config-only key "${entry.key}" has a row but no hollow mark (${owning.map(r => `${r.file}:${r.line}`).join(', ')})`)
    }
    if (derived.includes(entry.key)) {
        fail(`"${entry.key}" is recorded as config-only but is fork-added — the filled mark wins, and it should be in forkAdded`)
    }
}
for (const row of allRows) {
    if (!row.configOnly) { continue }
    if (switchRows.has(row.title)) { continue }
    const known = row.keys.some(k => data.configOnly.some(e => e.key === k))
    if (!known) {
        fail(`${row.file}:${row.line} "${row.title}" carries the hollow mark but no key of its own is recorded as config-only`)
    }
}

// A new key upstream hides is a decision for a person, not something to let
// pass in silence — so any unexposed upstream key not already accounted for is
// reported. The sweep is a review gate and not an oracle: `excluded` names the
// subtrees it cannot reason about, each with a reason.
const excluded = data.excluded.map(e => e.prefix)
const accountedExact = new Set([...data.configOnly.map(e => e.key), ...derived])
// Prefixes, so one entry accounts for a subtree — terminal.searchOptions covers
// its three sub-keys without three near-identical notes beside it.
const accountedPrefixes = [
    ...data.notSettings.map(e => e.key),
    ...data.knownGaps.map(e => e.key),
    ...data.configOnlyUnexposed.map(e => e.key),
]
const accounted = key => accountedExact.has(key)
    || accountedPrefixes.some(prefix => key === prefix || key.startsWith(prefix + '.'))
for (const key of [...upstreamKeys].sort()) {
    if (accounted(key)) { continue }
    if (excluded.some(p => key === p || key.startsWith(p + '.'))) { continue }
    if (!key.includes('.')) { continue }
    if (rowsByKey.has(key)) { continue }
    warn(`upstream key "${key}" has no control anywhere and is in neither configOnly nor notSettings — decide which it is`)
}

// 8. The mechanism itself. Each of these is a single line whose absence makes
// every mark above silently draw nothing.
const scss = fs.readFileSync(path.join(REPO, 'tabby-upstream/src/forkMarks.scss'), 'utf8')
for (const needed of ['show-fork-marks', 'show-config-only-marks', '.fork-mark::after', '.config-only-mark::after']) {
    if (!scss.includes(needed)) { fail(`forkMarks.scss no longer defines ${needed}`) }
}
if (!fs.readFileSync(path.join(REPO, 'tabby-upstream/src/index.ts'), 'utf8').includes("'./forkMarks.scss'")) {
    fail('tabby-upstream/src/index.ts no longer imports forkMarks.scss, so no mark is ever drawn')
}
const upstreamConfig = fs.readFileSync(path.join(REPO, 'tabby-upstream/src/config.ts'), 'utf8')
for (const key of ['showForkMarks: false', 'showConfigOnlyMarks: false']) {
    if (!upstreamConfig.includes(key)) { fail(`tabby-upstream/src/config.ts no longer declares ${key}`) }
}

// ── report ──────────────────────────────────────────────────────────────────

console.log(`fork-added keys: ${derived.length}, marked rows: ${allRows.filter(r => r.fork).length}, `
    + `hollow rows: ${allRows.filter(r => r.configOnly).length}, fork-added pages: ${forkPages.size}`)
for (const w of warnings) { console.log(`warn  ${w}`) }
for (const f of failures) { console.log(`FAIL  ${f}`) }
if (failures.length) {
    console.log(`\n${failures.length} failed`)
    process.exit(1)
}
console.log(`\nok${warnings.length ? ` (${warnings.length} warnings)` : ''}`)
