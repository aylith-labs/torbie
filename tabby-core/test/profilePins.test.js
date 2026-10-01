// Pinned profiles, as pure logic.
//
//   node tabby-core/test/profilePins.test.js
//
// `profilePins.ts` is transpiled on the fly, the way selectAll.test.js does it,
// so this runs on a clean checkout.
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

const { normalizePins, isPinned, withPin, withoutPin, pinnedAmong, pinnedFirst } = require(path.join(REPO, 'tabby-core/src/profilePins.ts'))

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

const names = list => list.map(x => x.name)
const profiles = [
    { id: 'a', name: 'A' },
    { id: 'b', name: 'B' },
    { id: 'c', name: 'C' },
    { name: 'no id' },
]

// ── what is stored ──────────────────────────────────────────────────────────

check('absent key', normalizePins(undefined), [])
check('not an array', normalizePins('a'), [])
check('drops non-strings, empties and repeats', normalizePins(['a', 1, '', null, 'b', 'a']), ['a', 'b'])

check('pinned', isPinned(['a'], 'a'), true)
check('not pinned', isPinned(['a'], 'b'), false)
check('a profile with no id is never pinned', isPinned(['a'], undefined), false)

// ── pinning ─────────────────────────────────────────────────────────────────

const pins = ['a']
check('a new pin goes last', withPin(pins, 'b'), ['a', 'b'])
check('pinning twice is one pin', withPin(pins, 'a'), ['a'])
check('pinning returns a new array', withPin(pins, 'a') !== pins, true)
check('unpin', withoutPin(['a', 'b'], 'a'), ['b'])
check('unpinning what is not pinned', withoutPin(['a'], 'z'), ['a'])
check('the input is left alone', pins, ['a'])

// ── reading them back ───────────────────────────────────────────────────────

check('pin order, not list order', names(pinnedAmong(profiles, ['c', 'a'])), ['C', 'A'])
check('a stale pin yields nothing', names(pinnedAmong(profiles, ['gone', 'b'])), ['B'])
check('no pins', pinnedAmong(profiles, []), [])
check('two profiles sharing an id pin once', names(pinnedAmong([{ id: 'a', name: 'first' }, { id: 'a', name: 'second' }], ['a'])), ['first'])

check('pinned first, the rest in order', names(pinnedFirst(profiles, ['c'])), ['C', 'A', 'B', 'no id'])
check('nothing pinned changes nothing', names(pinnedFirst(profiles, [])), ['A', 'B', 'C', 'no id'])
check('nothing is lost or repeated', pinnedFirst(profiles, ['b', 'gone', 'a']).length, profiles.length)

console.log(`${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
