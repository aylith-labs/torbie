// The Config file page's two views, as pure logic: the YAML tokenizer behind
// the highlighted raw editor, and the annotated tree the structured view draws.
//
// `configView.ts` is transpiled on the fly, the way navGroups.test.js does it,
// so this runs on a clean checkout. js-yaml is the one the app parses with.
//
// Run with: node tabby-settings/test/configView.test.js
const path = require('path')
const fs = require('fs')
const Module = require('module')

const REPO = path.resolve(__dirname, '../..')

const ts = require(path.join(REPO, 'node_modules/typescript'))
Module._extensions['.ts'] = function (module, filename) {
    const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2016, useDefineForClassFields: false },
    }).outputText
    module._compile(js, filename)
}

const yaml = require(path.join(REPO, 'node_modules/js-yaml'))
const V = require(path.join(REPO, 'tabby-settings/src/configView.ts'))

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

/** Tokens as `type:text`, whitespace-only text tokens dropped, for readable expectations. */
const toks = text => V.tokenizeYaml(text).filter(t => !(t.type === 'text' && !t.text.trim())).map(t => `${t.type}:${t.text}`)

console.log('tokenizer')
check('key and string', toks('name: hello world'), ['key:name', 'punct::', 'string:hello world'])
check('number, boolean, null', toks('a: 12\nb: true\nc: null\nd: ~\ne: -1.5e3'), [
    'key:a', 'punct::', 'number:12', 'key:b', 'punct::', 'boolean:true',
    'key:c', 'punct::', 'null:null', 'key:d', 'punct::', 'null:~', 'key:e', 'punct::', 'number:-1.5e3',
])
check('quoted strings, colon inside', toks(`a: "x: y # not a comment"\nb: 'it''s'`), [
    'key:a', 'punct::', 'string:"x: y # not a comment"', 'key:b', 'punct::', 'string:\'it\'\'s\'',
])
check('comments, full line and trailing', toks('# top\na: 1 # one'), ['comment:# top', 'key:a', 'punct::', 'number:1', 'comment:# one'])
check('a # inside a word is not a comment', toks('color: a#b'), ['key:color', 'punct::', 'string:a#b'])
check('list dashes, scalar and map items', toks('l:\n  - 1\n  - name: x\n    id: y'), [
    'key:l', 'punct::', 'punct:-', 'number:1', 'punct:-', 'key:name', 'punct::', 'string:x', 'key:id', 'punct::', 'string:y',
])
check('quoted key', toks('"a b": 1'), ['key:"a b"', 'punct::', 'number:1'])
check('flow sequence and map', toks('a: [1, x, true]\nb: {}'), [
    'key:a', 'punct::', 'punct:[', 'number:1', 'punct:,', 'string:x', 'punct:,', 'boolean:true', 'punct:]',
    'key:b', 'punct::', 'punct:{}',
])
check('block scalar: content is string until dedent', toks('icon: |-\n  <svg>\n    a: 1\n\n  </svg>\nnext: 2'), [
    'key:icon', 'punct::', 'meta:|-', 'string:<svg>', 'string:a: 1', 'string:</svg>', 'key:next', 'punct::', 'number:2',
])
check('block scalar under a list item key', toks('- icon: >-\n    folded\n- 3'), [
    'punct:-', 'key:icon', 'punct::', 'meta:>-', 'string:folded', 'punct:-', 'number:3',
])
check('multi-line double-quoted string', toks('a: "one\n  two"\nb: 1'), ['key:a', 'punct::', 'string:"one', 'string:two"', 'key:b', 'punct::', 'number:1'])
check('anchors, aliases, tags', toks('a: &x 1\nb: *x\nc: !!str 5'), [
    'key:a', 'punct::', 'meta:&x', 'number:1', 'key:b', 'punct::', 'meta:*x', 'key:c', 'punct::', 'meta:!!str', 'number:5',
])
check('document marker', toks('---\na: 1'), ['punct:---', 'key:a', 'punct::', 'number:1'])
check('a URL value is not a key', toks('url: https://x.lvh.me/a'), ['key:url', 'punct::', 'string:https://x.lvh.me/a'])
check('scalarType', ['1', '0x1F', '.inf', 'yes', 'Off', 'NULL', '1.2.3', '-'].map(V.scalarType),
    ['number', 'number', 'number', 'boolean', 'boolean', 'null', 'string', 'string'])

// Round trip: the highlighted layer sits under the textarea character for
// character, so the tokens must give back the input exactly — on tricky text
// and on a real config dumped the way ConfigService.readRaw() dumps it.
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">\n  <path d="M1 1h22v22H1z" fill="#ff0"/>\n</svg>'
const realistic = yaml.dump({
    version: 9,
    appearance: { tabsLocation: 'left', accentColor: '#c48a3a', spaciness: 1 },
    hotkeys: { 'toggle-window': ['Ctrl-Space'], 'new-tab': [], copy: ['Ctrl-C', 'Ctrl-Shift-C'] },
    profiles: [
        { type: 'local', name: 'WSL: Ubuntu', icon: svg, options: { command: 'wsl.exe', args: ['-d', 'Ubuntu'], env: {} } },
        { type: 'ssh', name: 'it\'s "quoted"', options: { host: '10.0.0.1', port: 22 }, weight: -1 },
    ],
    terminal: { font: 'Cascadia Code', fontSize: 14, colorScheme: { name: 'Tabby Default', colors: ['#000', '#fff'] }, environment: null },
    long: 'x'.repeat(300),
    weird: ': - # [ ] { } & * ! | > \' " % @ `',
    date: '2026-10-04',
})
const tricky = 'a: 1\r\nb: "x\r\n  y"\r\n\r\n  - - nested\n#c\n- |\n  t\n  u\nlast'
for (const [name, text] of [['realistic dump', realistic], ['tricky input', tricky], ['empty', ''], ['trailing newline', 'a: 1\n']]) {
    check(`round trip: ${name}`, V.tokenizeYaml(text).map(t => t.text).join(''), text)
}
check('the realistic dump holds its SVG as a block or quoted string, never keys',
    V.tokenizeYaml(realistic).filter(t => t.type === 'key' && /svg|path/.test(t.text)).length, 0)

check('highlight escapes markup', V.highlightYamlHtml('a: "<b>&"'), '<span class="y-key">a</span><span class="y-punct">:</span> <span class="y-string">"&lt;b&gt;&amp;"</span>')

console.log('tree')
const defaults = {
    version: 1,
    appearance: { tabsLocation: 'top', spaciness: 1, accentColor: null },
    hotkeys: { copy: ['Ctrl-Shift-C'], paste: ['Ctrl-Shift-V'] },
    profiles: [],
    terminal: { font: 'monospace', fontSize: 14 },
    builds: { view: 'cards', searchRoots: [] },
    integrations: {},
}
const config = {
    version: 1,
    appearance: { tabsLocation: 'left', spaciness: 1 },
    hotkeys: { copy: ['Ctrl-C'] },
    profiles: [{ name: 'WSL', options: { command: 'wsl.exe' } }, 'odd'],
    terminal: { font: 'monospace', fontSize: 14, custom: 1 },
    builds: { view: 'table' },
    integrations: { jira: { enabled: true, url: 'x' } },
    plugin: { x: 1 },
}
const marks = {
    forkAdded: ['builds', 'builds.view', 'appearance.accentColor', 'integrations'],
    configOnly: [{ key: 'appearance.spaciness', why: 'no control upstream' }],
}
const tree = V.buildConfigTree(config, defaults, marks)
const find = (nodes, p) => {
    for (const n of nodes) {
        if (n.path === p) { return n }
        const f = find(n.children, p)
        if (f) { return f }
    }
    return null
}
check('top-level keys in file order', tree.map(n => n.label), Object.keys(config))
check('paths through maps and lists', find(tree, 'profiles[0].options.command')?.value, 'wsl.exe')
check('a scalar equal to its default is "same"', find(tree, 'version').diff, 'same')
check('a changed scalar is "changed" with the default', [find(tree, 'appearance.tabsLocation').diff, find(tree, 'appearance.tabsLocation').defaultText], ['changed', '"top"'])
check('a list is compared whole', [find(tree, 'hotkeys.copy').diff, find(tree, 'hotkeys.copy').defaultText], ['changed', '["Ctrl-Shift-C"]'])
check('a key the defaults lack is "added"', find(tree, 'terminal.custom').diff, 'added')
check('a whole branch the defaults lack is "added"', find(tree, 'plugin').diff, 'added')
check('a map present in defaults carries no diff of its own', find(tree, 'terminal').diff, undefined)
check('list items are not compared', find(tree, 'profiles[0]').diff, undefined)
check('children of a list item are not compared', find(tree, 'profiles[0].name').diff, undefined)
check('children of an {} default are "added"', find(tree, 'integrations.jira').diff, 'added')
check('changed count on a map', find(tree, 'appearance').changedCount, 1)
check('changed count: an added branch counts once', tree.reduce((s, n) => s + (n.changedCount || ((n.diff === 'changed' || n.diff === 'added') ? 1 : 0)), 0), 7)  // appearance, hotkeys, profiles (vs []), terminal.custom, builds.view, integrations.jira, plugin
check('profiles hint by name', find(tree, 'profiles[0]').hint, 'WSL')
check('a scalar list item has no hint', find(tree, 'profiles[1]').hint, undefined)
check('fork mark on the topmost fork key only', [find(tree, 'builds').forkAdded, find(tree, 'builds.view').forkAdded, find(tree, 'integrations').forkAdded, find(tree, 'integrations.jira').forkAdded], [true, false, true, false])
check('config-only note', find(tree, 'appearance.spaciness').configOnlyNote, 'no control upstream')
check('no defaults: no diffs at all', JSON.stringify(V.buildConfigTree(config, null)).includes('"diff"'), false)
check('a scalar document is one node', V.buildConfigTree(5, null).map(n => [n.type, n.value]), [['number', 5]])
check('countLabel', [V.countLabel(find(tree, 'appearance')), V.countLabel(find(tree, 'profiles')), V.countLabel(find(tree, 'hotkeys'))], ['2 keys', '2 items', '1 key'])
check('valueType', [{}, [], 'a', 1, true, null, undefined].map(V.valueType), ['map', 'list', 'string', 'number', 'boolean', 'null', 'null'])

console.log('long values')
check('an SVG is long', V.isLongValue(svg), true)
check('a short string is not', V.isLongValue('Cascadia Code'), false)
check('preview: first line and what was left out', V.previewValue(svg), { text: svg.split('\n')[0] + '…', detail: `${svg.length} chars, 3 lines` })
check('preview caps a long single line', V.previewValue('y'.repeat(300)).text.length, V.LONG_VALUE_CHARS + 1)

console.log('rows')
const labels = rows => rows.map(r => '  '.repeat(r.node.depth) + r.node.label + (r.expanded ? '/' : '') + (r.matched ? '*' : ''))
check('collapsed: top level only', labels(V.flattenTree(tree, new Set())), Object.keys(config))
check('expanding one map', labels(V.flattenTree(tree, new Set(['terminal']))), ['version', 'appearance', 'hotkeys', 'profiles', 'terminal/', '  font', '  fontSize', '  custom', 'builds', 'integrations', 'plugin'])
const all = new Set(V.containerPaths(tree))
check('expand all opens every container', V.flattenTree(tree, all).length, 25)
check('filter by key: ancestors opened, siblings hidden', labels(V.flattenTree(tree, new Set(), 'font')), ['terminal/', '  font*', '  fontSize*'])
check('filter by dotted path', labels(V.flattenTree(tree, new Set(), 'terminal.font')), ['terminal/', '  font*', '  fontSize*'])
check('filter by value', labels(V.flattenTree(tree, new Set(), 'wsl.exe')), ['profiles/', '  [0]/', '    options/', '      command*'])
check('filter by list item hint', labels(V.flattenTree(tree, new Set(), 'wsl')), ['profiles/', '  [0]/*', '    name*', '    options/', '      command*'])
check('a matched map stays closed until opened', labels(V.flattenTree(tree, new Set(), 'builds')), ['builds*'])
check('opening a matched map shows all of it', labels(V.flattenTree(tree, new Set(['builds']), 'builds')), ['builds/*', '  view'])
check('a branch shut while filtering stays shut', labels(V.flattenTree(tree, new Set(), 'font', new Set(['terminal']))), ['terminal'])
check('no match, no rows', V.flattenTree(tree, all, 'zzzz').length, 0)
check('blank filter is no filter', V.flattenTree(tree, new Set(), '   ').length, Object.keys(config).length)

console.log('view choice')
check('stored view', ['raw', 'structured', null, 'junk'].map(V.parseStoredView), ['raw', 'structured', 'structured', 'structured'])

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
