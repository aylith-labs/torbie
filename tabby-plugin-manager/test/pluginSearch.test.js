// Search and sort on the Plugins page, and what a registry search result becomes.
//
// No app, no bundle, no network. `src/pluginSearch.ts` is pure, so it is
// transpiled here with the repo's TypeScript, and its one import — a type from
// `tabby-core` — is stubbed. The registry entries are shaped like real
// `-/v1/search` results, trimmed to a handful of packages.
//
// Run with: node tabby-plugin-manager/test/pluginSearch.test.js
const path = require('path')
const fs = require('fs')
const Module = require('module')

const REPO = path.resolve(__dirname, '../..')

// `tabby-core` is an external in every plugin build, and only a type is taken from it.
const stubs = { 'tabby-core': {} }
const originalResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
    return stubs[request] ? request : originalResolve.call(this, request, ...rest)
}
const originalLoad = Module._load
Module._load = function (request, ...rest) {
    return stubs[request] ?? originalLoad.call(this, request, ...rest)
}

const ts = require(path.join(REPO, 'node_modules/typescript'))
Module._extensions['.ts'] = function (module, filename) {
    const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
    }).outputText
    module._compile(js, filename)
}

const {
    DEFAULT_SORT,
    OFFICIAL_NPM_ACCOUNT,
    arrangeAvailable,
    arrangeInstalled,
    fromRegistry,
    matchRank,
    parseSortState,
    queryTerms,
} = require(path.join(REPO, 'tabby-plugin-manager/src/pluginSearch.ts'))

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
const names = plugins => plugins.map(p => p.name)
const pick = (object, keys) => Object.fromEntries(keys.map(key => [key, object[key]]))

/** One registry search result: the fields that are read, and some that are not. */
function entry (name, fields = {}) {
    const {
        description = '',
        keywords = ['tabby-plugin'],
        monthly = 0,
        date = '2026-01-01T00:00:00.000Z',
        score = 10,
        maintainer = 'someone',
        publisher = 'GitHub Actions',
        version = '1.0.0',
    } = fields
    return {
        downloads: { monthly, weekly: Math.round(monthly / 4) },
        dependents: 0,
        updated: date,
        searchScore: score,
        package: {
            name,
            keywords,
            version,
            description,
            sanitized_name: name,
            publisher: { email: 'npm@example.com', username: publisher },
            maintainers: [{ email: 'npm@example.com', username: maintainer }],
            license: 'MIT',
            date,
            links: { homepage: `https://github.com/example/${name}#readme`, npm: `https://www.npmjs.com/package/${name}` },
        },
        score: { final: score, detail: { popularity: 1, quality: 1, maintenance: 1 } },
        flags: { insecure: 0 },
    }
}

// One `keywords:tabby-plugin` page, in the order the registry returned it:
// highest search score first. Every other order below differs from this one.
//
// Ties are deliberate, and each has one pair whose registry order is the reverse
// of alphabetical, so a sort that broke ties by name would be caught rather than
// agreeing by accident: sftp-plus and mux-helper share the `sidebar` keyword,
// mux-helper and better-tmux-bar share a download count, and sftp-plus and
// highlight share a publish date.
const page = [
    entry('tabby-asciinema-helper', { description: 'Record terminal sessions, even inside tmux', keywords: ['tabby-plugin', 'recording'], monthly: 300, date: '2025-12-01T00:00:00.000Z', score: 45 }),
    entry('tabby-sftp-plus', { description: 'SFTP file manager with bookmarks', keywords: ['tabby-plugin', 'sftp', 'file-manager', 'sidebar'], monthly: 3232, date: '2026-09-03T11:53:06.980Z', score: 44 }),
    entry('tabby-mux-helper', { description: 'Pane helpers', keywords: ['tabby-plugin', 'tmux', 'panes', 'sidebar'], monthly: 150, date: '2026-03-10T00:00:00.000Z', score: 40 }),
    entry('tabby-better-tmux-bar', { description: 'A status bar', monthly: 150, date: '2026-09-12T00:55:58.537Z', score: 38 }),
    entry('tabby-tmux-restore', { description: 'Restore layouts after a restart', monthly: 200, date: '2026-05-01T00:00:00.000Z', score: 35 }),
    entry('tabby-tmux', { description: 'Attach to tmux sessions', keywords: ['tabby-plugin', 'terminal-multiplexer'], monthly: 1645, date: '2026-09-12T00:55:58.537Z', score: 30, maintainer: 'ruanimal' }),
    entry('tabby-highlight', { description: 'Highlight patterns in output', monthly: 1362, date: '2026-09-03T11:53:06.980Z', score: 25, maintainer: 'Grzegorz' }),
    // A placeholder package, flagged on the package's own keywords.
    entry('tabby-transition-dummy', { keywords: ['tabby-plugin', 'tabby-dummy-transition-plugin'], score: 24 }),
    // The flag on the search result rather than the package, which is where the
    // guard used to look. The registry never puts keywords there.
    Object.assign(entry('tabby-sync-config', { description: 'Sync settings to a gist', monthly: 480, date: '2026-01-15T00:00:00.000Z', score: 22 }), { keywords: ['tabby-dummy-transition-plugin'] }),
    // Tagged tabby-plugin, but named for the other prefix.
    entry('terminus-title-control', { score: 21 }),
    entry('tabby-clickable-links', { score: 21 }),
    entry('tabby-docker', { description: 'Connect to Docker containers', keywords: ['tabby-plugin', 'docker'], monthly: 900, date: '2024-02-02T00:00:00.000Z', score: 20, maintainer: 'eugenepankov', publisher: OFFICIAL_NPM_ACCOUNT }),
]
const REGISTRY_ORDER = ['asciinema-helper', 'sftp-plus', 'mux-helper', 'better-tmux-bar', 'tmux-restore', 'tmux', 'highlight', 'sync-config', 'docker']

console.log('\n-- a registry page becomes plugins --')
const available = fromRegistry(page, 'tabby-', ['tabby-clickable-links'])
check('prefix stripped, registry order kept', names(available), REGISTRY_ORDER)
check('a package flagged tabby-dummy-transition-plugin on its keywords is dropped', available.some(p => p.packageName === 'tabby-transition-dummy'), false)
check('the flag on the search result instead of the package is not the flag', available.some(p => p.packageName === 'tabby-sync-config'), true)
check('a package named for another prefix is dropped', available.some(p => p.packageName === 'terminus-title-control'), false)
check('a blacklisted package is dropped', available.some(p => p.packageName === 'tabby-clickable-links'), false)
const FIELDS = ['name', 'packageName', 'description', 'version', 'author', 'isOfficial', 'isBuiltin', 'isLegacy', 'searchScore', 'keywords', 'monthlyDownloads', 'published']
check('fields are read from the package and the result', pick(available.find(p => p.name === 'tmux'), FIELDS), {
    name: 'tmux',
    packageName: 'tabby-tmux',
    description: 'Attach to tmux sessions',
    version: '1.0.0',
    author: 'ruanimal',
    isOfficial: false,
    isBuiltin: false,
    isLegacy: false,
    searchScore: 30,
    keywords: ['tabby-plugin', 'terminal-multiplexer'],
    monthlyDownloads: 1645,
    published: '2026-09-12T00:55:58.537Z',
})
check('homepage comes from the package links', available.find(p => p.name === 'tmux').homepage, 'https://github.com/example/tabby-tmux#readme')
check('the official account marks a plugin official', available.filter(p => p.isOfficial).map(p => p.name), ['docker'])

const legacy = fromRegistry([
    entry('terminus-sync-config', { keywords: ['terminus-plugin'] }),
    entry('tabby-quick-cmds', { keywords: ['terminus-plugin'] }),
    entry('terminus-clickable-links', { keywords: ['terminus-plugin'] }),
], 'terminus-', ['terminus-clickable-links'])
check('a terminus page keeps only terminus- names, marked legacy', legacy.map(p => [p.name, p.isLegacy]), [['sync-config', true]])

const [bare] = fromRegistry([{ package: { name: 'tabby-bare', version: '0.1.0' } }], 'tabby-', [])
check('a result missing every optional field still maps', pick(bare, ['name', 'description', 'author', 'isOfficial', 'keywords', 'monthlyDownloads', 'published']), {
    name: 'bare', description: '', author: '', isOfficial: false, keywords: [], monthlyDownloads: 0, published: null,
})
check('and has no homepage', bare.homepage, undefined)

console.log('\n-- query terms --')
check('lowercased and split on whitespace', queryTerms('  TMUX   Restore '), ['tmux', 'restore'])
check('an empty query has no terms', queryTerms(''), [])
check('a blank query has no terms', queryTerms(' \t '), [])

console.log('\n-- how one plugin matches --')
const tmux = available.find(p => p.name === 'tmux')
const sftp = available.find(p => p.name === 'sftp-plus')
check('no terms matches, at the best rank', matchRank(tmux, []), 0)
check('exact name ranks 0', matchRank(tmux, ['tmux']), 0)
check('name prefix ranks 1', matchRank(sftp, ['sftp']), 1)
check('name contains ranks 2', matchRank(available.find(p => p.name === 'better-tmux-bar'), ['tmux']), 2)
check('package name contains ranks 2', matchRank(sftp, ['tabby-sftp']), 2)
check('a keyword ranks 3', matchRank(sftp, ['file-manager']), 3)
check('the description ranks 4', matchRank(sftp, ['bookmarks']), 4)
check('the author ranks 4', matchRank(tmux, ['ruanimal']), 4)
check('a term matching nothing is no match', matchRank(tmux, ['zzzqqqxx']), null)
check('a plugin ranks as its weakest term', matchRank(sftp, ['sftp', 'bookmarks']), 4)
check('every term has to match somewhere', matchRank(tmux, ['tmux', 'zzzqqqxx']), null)

console.log('\n-- search, Available --')
const arrange = (query, sort = 'relevance') => names(arrangeAvailable(available, query, sort))
check('relevance with no query is the registry order', arrange(''), REGISTRY_ORDER)
check('a blank query is no query', arrange('   '), REGISTRY_ORDER)
check('relevance ranks exact, prefix, contains, keyword, description', arrange('tmux'), ['tmux', 'tmux-restore', 'better-tmux-bar', 'mux-helper', 'asciinema-helper'])
check('equal ranks keep registry order, not name order', arrange('sidebar'), ['sftp-plus', 'mux-helper'])
check('every term must match, across fields', arrange('docker containers'), ['docker'])
check('two terms in one name', arrange('tmux restore'), ['tmux-restore'])
check('by package name', arrange('tabby-sftp'), ['sftp-plus'])
check('by keyword', arrange('recording'), ['asciinema-helper'])
check('by author', arrange('ruanimal'), ['tmux'])
check('query case does not matter', arrange('TMUX'), arrange('tmux'))
check('data case does not matter', arrange('grzegorz'), ['highlight'])
check('mixed case on both sides', arrange('DOCKER Containers'), ['docker'])
check('a query matching nothing shows nothing', arrange('zzzqqqxx'), [])
check('a second term matching nothing shows nothing', arrange('tmux zzzqqqxx'), [])
check('an empty catalogue shows nothing', names(arrangeAvailable([], 'tmux', 'name')), [])

console.log('\n-- sorting, Available --')
check('most downloaded, ties in registry order', arrange('', 'downloads'), ['sftp-plus', 'tmux', 'highlight', 'docker', 'sync-config', 'asciinema-helper', 'tmux-restore', 'mux-helper', 'better-tmux-bar'])
check('recently published, ties in registry order', arrange('', 'published'), ['better-tmux-bar', 'tmux', 'sftp-plus', 'highlight', 'tmux-restore', 'mux-helper', 'sync-config', 'asciinema-helper', 'docker'])
check('name', arrange('', 'name'), ['asciinema-helper', 'better-tmux-bar', 'docker', 'highlight', 'mux-helper', 'sftp-plus', 'sync-config', 'tmux', 'tmux-restore'])
check('a query and a sort combine', arrange('tmux', 'downloads'), ['tmux', 'asciinema-helper', 'tmux-restore', 'mux-helper', 'better-tmux-bar'])
const withBare = [...available, bare]
check('no download count sorts last', names(arrangeAvailable(withBare, '', 'downloads')).pop(), 'bare')
check('no publish date sorts last', names(arrangeAvailable(withBare, '', 'published')).pop(), 'bare')
const before = names(available)
for (const sort of ['relevance', 'downloads', 'published', 'name']) {
    arrangeAvailable(available, 'tmux', sort)
}
check('arranging never reorders the catalogue it was given', names(available), before)

console.log('\n-- Installed --')
const installed = [
    { name: 'core', packageName: 'tabby-core', isBuiltin: true, isLegacy: false, version: '0.1.0', description: 'Torbie core', author: 'Aylith Labs', info: { keywords: ['tabby-builtin-plugin'] } },
    { name: 'backslash-newline', packageName: 'tabby-backslash-newline', isBuiltin: false, isLegacy: false, version: '1.2.0', description: 'Type a backslash-newline', author: 'someone', info: { keywords: ['tabby-plugin', 'Keyboard'] } },
    { name: 'ssh', packageName: 'tabby-ssh', isBuiltin: true, isLegacy: false, version: '0.1.0', description: 'SSH connections for Torbie', author: 'Aylith Labs', info: { keywords: ['tabby-builtin-plugin'] } },
    { name: 'mcp-server', packageName: 'tabby-mcp-server', isBuiltin: false, isLegacy: false, version: '1.4.0', description: 'Model Context Protocol server', author: 'thuanpham', info: { keywords: ['tabby-plugin', 'mcp'] } },
    { name: 'auto-sudo-password', packageName: 'tabby-auto-sudo-password', isBuiltin: true, isLegacy: false, version: '0.1.0', description: 'Offers to paste a saved sudo password', author: 'Aylith Labs' },
]
const disabled = new Set(['ssh', 'mcp-server'])
const isEnabled = plugin => !disabled.has(plugin.name)
const arrangeHere = (query, sort = 'name') => names(arrangeInstalled(installed, query, sort, isEnabled))
check('name', arrangeHere(''), ['auto-sudo-password', 'backslash-newline', 'core', 'mcp-server', 'ssh'])
check('third-party first, then name', arrangeHere('', 'thirdParty'), ['backslash-newline', 'mcp-server', 'auto-sudo-password', 'core', 'ssh'])
check('disabled first, then name', arrangeHere('', 'disabled'), ['mcp-server', 'ssh', 'auto-sudo-password', 'backslash-newline', 'core'])
check('by author, case-insensitive', arrangeHere('AYLITH'), ['auto-sudo-password', 'core', 'ssh'])
check('by a keyword from package.json', arrangeHere('keyboard'), ['backslash-newline'])
check('by package name', arrangeHere('tabby-mcp'), ['mcp-server'])
check('a query and a sort combine', arrangeHere('aylith', 'disabled'), ['ssh', 'auto-sudo-password', 'core'])
check('a query matching nothing shows nothing', arrangeHere('zzzz'), [])
check('arranging never reorders the list it was given', names(installed), ['core', 'backslash-newline', 'ssh', 'mcp-server', 'auto-sudo-password'])

console.log('\n-- the stored sort --')
check('defaults are the orders the lists had before', DEFAULT_SORT, { available: 'relevance', installed: 'name' })
check('nothing stored', parseSortState(null), DEFAULT_SORT)
check('not an object', parseSortState('downloads'), DEFAULT_SORT)
check('an array', parseSortState(['downloads']), DEFAULT_SORT)
check('valid choices are kept', parseSortState({ available: 'downloads', installed: 'disabled' }), { available: 'downloads', installed: 'disabled' })
check('an unknown choice falls back for that list only', parseSortState({ available: 'popularity', installed: 'thirdParty' }), { available: 'relevance', installed: 'thirdParty' })
check('a missing list falls back', parseSortState({ available: 'name' }), { available: 'name', installed: 'name' })
const parsed = parseSortState(null)
parsed.available = 'name'
check('a parsed state is a copy, not the defaults', DEFAULT_SORT.available, 'relevance')

console.log(`\n${passed} passed, ${failed} failed`)
process.exitCode = failed ? 1 : 0
