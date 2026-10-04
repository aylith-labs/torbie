// What a release changed, as pure logic: no app, no bundle, no network.
//
// Run with: node tabby-settings/test/releaseNotes.test.js
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

const { groupCommits, summarizeGroups, handwrittenBody, parseCommit, relativeDay, sameVersion, isNoise } =
    require(path.join(REPO, 'tabby-settings/src/releaseNotes.ts'))

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

console.log('── commit subjects ──')
const c = (sha, subject) => ({ sha, subject })
check('feat with a scope', parseCommit(c('a', 'feat(profiles): pin profiles, shown above Recent')),
    { group: 'feat', entry: { sha: 'a', scope: 'profiles', text: 'Pin profiles, shown above Recent', breaking: false } })
check('a breaking change keeps its type', parseCommit(c('b', 'fix!: drop the old key')).group, 'fix')
check('  and is marked', parseCommit(c('b', 'fix!: drop the old key')).entry.breaking, true)
check('a Dependabot bump is a dependency', parseCommit(c('d', 'build(deps-dev): bump @types/node from 22 to 26')).group, 'deps')
check('  with no scope chip', parseCommit(c('d', 'build(deps): bump x')).entry.scope, null)
check('other build commits are internal', parseCommit(c('e', 'build: pin pug-html-loader')).group, 'internal')
check('docs, test, ci, chore are internal', ['docs: x', 'test(a): x', 'ci: x', 'chore: x'].map(s => parseCommit(c('f', s)).group),
    ['internal', 'internal', 'internal', 'internal'])
check('a non-conventional subject is kept, as written', parseCommit(c('g', 'fixes')).entry.text, 'fixes')
check('merges are noise', isNoise("Merge remote-tracking branch 'origin/review-60'"), true)
check('the release bump is noise', isNoise('chore(release): 1.0.5'), true)
check('an ordinary chore is not', isNoise('chore: tidy'), false)

console.log('\n── grouping (v1.0.4…v1.0.5, oldest first as GitHub returns it) ──')
const groups = groupCommits([
    c('1', 'docs: detail entry for Select all and one-line buttons'),
    c('2', 'feat(profiles): pin profiles, shown above Recent in every view'),
    c('3', 'fix(settings): the Settings tab can be split and opened in a new window'),
    c('4', 'test(profiles): pins in every view'),
    c('5', 'docs: catalogue pinned profiles'),
    c('6', 'chore(release): 1.0.5'),
    c('7', 'build(deps): bump the all group'),
])
check('groups in reading order, empty ones dropped', groups.map(g => g.id), ['feat', 'fix', 'internal', 'deps'])
check('internal is newest first', groups.find(g => g.id === 'internal').entries.map(e => e.sha), ['5', '4', '1'])
check('features and fixes are open, the rest collapsed', groups.map(g => g.prominent), [true, true, false, false])
check('the summary line', summarizeGroups(groups), '1 new · 1 fix · 3 internal · 1 dependency update')
check('nothing but a release bump is no groups', groupCommits([c('x', 'chore(release): 1.0.6')]), [])

console.log('\n── the generated body is dropped ──')
check('Full Changelog alone is empty',
    handwrittenBody('**Full Changelog**: https://github.com/aylith-labs/torbie/compare/v1.0.4...v1.0.5'), '')
check("What's Changed and New Contributors are dropped", handwrittenBody([
    "## What's Changed",
    '* build(deps): bump x by @dependabot[bot] in https://github.com/aylith-labs/torbie/pull/53',
    '',
    '## New Contributors',
    '* @dependabot[bot] made their first contribution in https://github.com/aylith-labs/torbie/pull/53',
    '',
    '**Full Changelog**: https://github.com/aylith-labs/torbie/compare/v1.0.0...v1.0.1',
].join('\r\n')), '')
check('a written section survives, the generated one beside it does not', handwrittenBody([
    '## Highlights',
    'Pinned profiles.',
    "## What's Changed",
    '* bump',
    '## Known issues',
    'Emoji width.',
].join('\n')), '## Highlights\nPinned profiles.\n## Known issues\nEmoji width.')
check('null is empty', handwrittenBody(null), '')

console.log('\n── dates and versions ──')
const now = new Date(2026, 9, 4, 12)
check('today', relativeDay(new Date(2026, 9, 4, 1), now), 'today')
check('yesterday, across midnight', relativeDay(new Date(2026, 9, 3, 23, 50), now), 'yesterday')
check('days', relativeDay(new Date(2026, 8, 26), now), '8 days ago')
check('weeks', relativeDay(new Date(2026, 8, 12), now), '3 weeks ago')
check('months', relativeDay(new Date(2026, 5, 1), now), '4 months ago')
check('a tag is the running version', sameVersion('v1.0.5', '1.0.5'), true)
check('a nightly of it counts too', sameVersion('v1.0.5', '1.0.5-nightly.3'), true)
check('a different patch does not', sameVersion('v1.0.5', '1.0.15'), false)
check('no version is no match', sameVersion('v1.0.5', null), false)

console.log(`\n${passed} passed, ${failed} failed`)
process.exitCode = failed ? 1 : 0
