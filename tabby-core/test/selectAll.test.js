// The tri-state "Select all" over a group of checkboxes, as pure logic.
//
//   node tabby-core/test/selectAll.test.js
//
// `selectAll.ts` is transpiled on the fly, the way navGroups.test.js does it,
// so this runs on a clean checkout. The component that draws it
// (`selectAllCheckbox.component.ts`) is driven in a real window by
// tabby-links/test/selectAll.cdp.js.
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

const { selectAllState, selectAllStateOf, selectAllTarget } = require(path.join(REPO, 'tabby-core/src/selectAll.ts'))

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

// ── the state ───────────────────────────────────────────────────────────────

check('none of 13', selectAllState(0, 13), 'none')
check('one of 13 is mixed', selectAllState(1, 13), 'mixed')
check('12 of 13 is mixed', selectAllState(12, 13), 'mixed')
check('13 of 13', selectAllState(13, 13), 'all')
check('one of one', selectAllState(1, 1), 'all')
// An empty group has nothing to be "all" of; a ticked header over no boxes
// would claim something that is not there.
check('empty group is none', selectAllState(0, 0), 'none')
// Defensive: a count that outran the total (a field removed from a manifest
// while still stored as chosen) is still "all", not a fourth state.
check('more than total is all', selectAllState(5, 3), 'all')
check('negative is none', selectAllState(-1, 3), 'none')

check('of values: mixed', selectAllStateOf([true, false, true]), 'mixed')
check('of values: all', selectAllStateOf([true, true]), 'all')
check('of values: none', selectAllStateOf([false, false]), 'none')
check('of values: empty', selectAllStateOf([]), 'none')

// ── what a click does ───────────────────────────────────────────────────────

check('none -> select all', selectAllTarget('none'), true)
check('mixed -> select all, never clear', selectAllTarget('mixed'), true)
check('all -> deselect all', selectAllTarget('all'), false)

// ── a click, applied to a group, round-trips ────────────────────────────────

function click (values) {
    const target = selectAllTarget(selectAllStateOf(values))
    return values.map(() => target)
}
const mixed = [true, false, false, true]
check('mixed click -> all on', click(mixed), [true, true, true, true])
check('second click -> all off', click(click(mixed)), [false, false, false, false])
check('third click -> all on again', click(click(click(mixed))), [true, true, true, true])
check('state after mixed click', selectAllStateOf(click(mixed)), 'all')

console.log(`${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
