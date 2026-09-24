// Settings search ranking and snippets, as pure logic: no app, no bundle.
//
// `settingsSearch.ts` is transpiled on the fly, the way navGroups.test.js does
// it, so this runs on a clean checkout.
//
// Run with: node tabby-settings/test/settingsSearch.test.js
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

const { searchSettings, makeSnippet, matchTerm, foldForSearch, TIER } =
    require(path.join(REPO, 'tabby-settings/src/settingsSearch.ts'))

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

let order = 0
const tab = (tabId, tabTitle, extra = {}) => ({ kind: 'tab', tabId, tabTitle, title: tabTitle, order: order++, ...extra })
const setting = (tabId, tabTitle, title, description, section, extra = {}) =>
    ({ kind: 'setting', tabId, tabTitle, title, description, section, order: order++, ...extra })
const section = (tabId, tabTitle, name) => ({ kind: 'section', tabId, tabTitle, title: name, section: name, order: order++ })

const entries = [
    tab('application', 'Application', { tabDescription: 'Language, updates, shell integration, debugging and accessibility', group: 'General' }),
    setting('application', 'Application', 'Shell integration', 'Allows quickly opening a terminal in the selected folder', 'Application settings'),
    setting('application', 'Application', 'Automatic Updates', 'Enable automatic installation of updates when they become available.', 'Application settings'),
    setting('application', 'Application', 'Minimum contrast ratio', undefined, 'Accessibility'),
    section('application', 'Application', 'Accessibility'),
    tab('hotkeys', 'Hotkeys', { tabDescription: 'Keyboard shortcuts for every command', group: 'General' }),
    tab('terminal', 'Terminal', { group: 'Terminal' }),
    setting('terminal', 'Terminal', 'Font', 'The font used in the terminal', 'Appearance'),
    setting('terminal', 'Terminal', 'Scrollback', 'How many lines to keep', 'Terminal'),
    tab('terminal-shell', 'Shell', { tabDescription: 'Default shell and working directory', group: 'Terminal' }),
    tab('claude', 'Claude', { group: 'Claude' }),
    tab('claude-status', 'Claude Status', { group: 'Claude' }),
    setting('claude', 'Claude', 'Show the active session', 'Top of the Claude panel', 'Panel'),
    setting('window', 'Window', 'Hide tab close buttons', 'Close buttons appear on hover', 'Tabs'),
    setting('window', 'Window', 'Contrast floor', 'Raise low-contrast text to readable', 'Theme'),
]

const ids = (query, n = 5) => searchSettings(entries, query).slice(0, n).map(r => `${r.entry.kind}:${r.entry.title}`)

console.log('── tiers ──')
check('exact beats prefix beats word start beats substring beats fuzzy', [
    matchTerm('shell', 'Shell', true).score > matchTerm('shell', 'Shell integration', true).score,
    matchTerm('shell', 'Shell integration', true).score > matchTerm('shell', 'Default shell', true).score,
    matchTerm('shell', 'Default shell', true).score > matchTerm('hell', 'Default shell', true).score,
    matchTerm('hell', 'Default shell', true).score > matchTerm('desh', 'Default shell', true).score,
], [true, true, true, true])
check('a camelCase hump is a word start', matchTerm('size', 'fontSize', false).score >= TIER.wordStart, true)
check('no subsequence where it is not allowed', matchTerm('desh', 'Default shell', false), null)
check('a subsequence has to start at a word', matchTerm('efsh', 'Default shell', true), null)
check('and not come one letter at a time', matchTerm('update', 'client and firmware server with controlled uploads for Tabby terminal', true), null)
check('subsequence highlights the characters that matched', matchTerm('hky', 'Hotkeys', true).ranges, [{ start: 0, end: 1 }, { start: 3, end: 4 }, { start: 5, end: 6 }])
check('a scattered subsequence across a long name is refused', matchTerm('ab', 'a very long title that eventually has b', true), null)
check('folding keeps indices: diacritics', foldForSearch('Café Ünïcode'), 'cafe unicode')
check('folding keeps length for İ', foldForSearch('İstanbul').length, 'İstanbul'.length)

console.log('\n── ranking ──')
check('"shell": the Shell page, then the setting named for it, then the page describing it',
    ids('shell', 3), ['tab:Shell', 'setting:Shell integration', 'tab:Application'])
check('"update": the setting whose title says so first', ids('update', 2), ['setting:Automatic Updates', 'tab:Application'])
check('"hotkey": the Hotkeys page', ids('hotkey', 1), ['tab:Hotkeys'])
check('"clau": both Claude pages before a Claude setting, shorter first',
    ids('clau', 3), ['tab:Claude', 'tab:Claude Status', 'setting:Show the active session'])
check('"contrast": both settings, the one at a title start first',
    ids('contrast', 2), ['setting:Contrast floor', 'setting:Minimum contrast ratio'])
check('"accessibility": the section beats the page that mentions it', ids('accessibility', 2), ['section:Accessibility', 'tab:Application'])
check('a page name alone does not bring back every row on it',
    searchSettings(entries, 'terminal').filter(r => r.entry.kind === 'setting').map(r => r.entry.title).sort(),
    ['Font', 'Shell integration'])
check('but it narrows a second term to that page', ids('terminal font', 1), ['setting:Font'])
check('every term has to match somewhere', ids('shell zzz'), [])
check('an empty query finds nothing', ids('   '), [])
check('subsequences are a fallback: none while something matches plainly', searchSettings(entries, 'clau').some(r => r.fuzzy), false)
check('but found when nothing else is', ids('hky', 1), ['tab:Hotkeys'])
check('a tie in score keeps nav order', ids('claude status', 1), ['tab:Claude Status'])

console.log('\n── highlights ──')
const upd = searchSettings(entries, 'update')[0]
check('title range', upd.highlights.title, [{ start: 10, end: 16 }])
check('and the same term in the description, which scored nothing', upd.highlights.description, [{ start: 33, end: 39 }])
const multi = searchSettings(entries, 'terminal font')[0]
check('every term is highlighted wherever it appears', multi.highlights.description, [{ start: 4, end: 8 }, { start: 21, end: 29 }])
const ctx = searchSettings(entries, 'accessibility minimum')[0]
check('a term only the context has is highlighted in the context', [ctx.entry.title, ctx.highlights.section], ['Minimum contrast ratio', [{ start: 0, end: 13 }]])
check('and own terms in their own field', multi.highlights.title, [{ start: 0, end: 4 }])
const phrase = searchSettings(entries, 'shell integ')[0]
check('a phrase is one run, not two', phrase.highlights.title, [{ start: 0, end: 11 }])

console.log('\n── snippets ──')
const short = makeSnippet('Allows quickly opening a terminal', [{ start: 25, end: 33 }])
check('short text is untouched', [short.leading, short.trailing, short.segments.map(s => s.text).join('')], [false, false, 'Allows quickly opening a terminal'])
check('and split into runs', short.segments.map(s => s.match), [false, true])

const long = 'This is a rather long description that goes on and on about nothing in particular until finally it mentions the contrast floor and then keeps going for a while longer so that it has to be cut on both ends'
const at = long.indexOf('contrast')
const cut = makeSnippet(long, [{ start: at, end: at + 8 }], 60)
const shown = cut.segments.map(s => s.text).join('')
check('long text is cut on both sides', [cut.leading, cut.trailing], [true, true])
check('within the budget', shown.length <= 60, true)
check('the match survives the cut, highlighted', cut.segments.filter(s => s.match).map(s => s.text), ['contrast'])
const before = shown.indexOf('contrast')
const after = shown.length - before - 'contrast'.length
check('and sits near the centre (within a word either way)', Math.abs(before - after) <= 16, true)
check('cuts land on word boundaries', [/^\S/.test(shown), long.includes(` ${shown.split(' ')[0]} `) || long.startsWith(shown.split(' ')[0])], [true, true])

const early = makeSnippet(long, [{ start: 10, end: 16 }], 60)
check('a match near the start is not centred off the front', [early.leading, early.trailing], [false, true])
const late = makeSnippet(long, [{ start: long.length - 4, end: long.length }], 60)
check('a match at the end is not centred off the back', [late.leading, late.trailing], [true, false])
check('and is still shown', late.segments[late.segments.length - 1], { text: 'ends', match: true })
const none = makeSnippet(long, [], 40)
check('no match keeps the start', [none.leading, none.trailing, none.segments.length], [false, true, 1])
const huge = makeSnippet('x'.repeat(30) + 'y'.repeat(50) + 'z'.repeat(30), [{ start: 30, end: 80 }], 20)
check('a match longer than the budget is kept whole', huge.segments.filter(s => s.match).map(s => s.text.length), [50])

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
