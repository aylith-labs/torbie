// The settings nav's labelled sections, as pure logic: no app, no bundle.
//
// `settingsGroups.ts` is transpiled on the fly, the way herdr.test.js does it,
// so this runs on a clean checkout.
//
// Run with: node tabby-settings/test/navGroups.test.js
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

const { groupSettingsProviders, SETTINGS_NAV_GROUPS, DEFAULT_SETTINGS_NAV_GROUP } =
    require(path.join(REPO, 'tabby-settings/src/settingsGroups.ts'))

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

const page = (id, title, extra = {}) => Object.assign(
    { id, title, icon: 'x', weight: 0, prioritized: false, wide: false, forkAdded: false, getComponentType: () => ({}) },
    extra,
)

// Every builtin settings page, read from the providers in this tree rather
// than typed out, so a page added later without a section fails here instead
// of quietly landing under Plugins.
function builtinPages () {
    const found = []
    for (const dir of fs.readdirSync(REPO).sort()) {
        if (!dir.startsWith('tabby-')) { continue }
        for (const file of ['settings.ts', 'providers.ts']) {
            const full = path.join(REPO, dir, 'src', file)
            if (!fs.existsSync(full)) { continue }
            for (const block of fs.readFileSync(full, 'utf8').split(/\bexport class\b/).slice(1)) {
                if (!/extends SettingsTabProvider\b/.test(block.split('\n')[0])) { continue }
                const id = /\bid = '([^']+)'/.exec(block)?.[1]
                const title = /\btitle = (?:this\.translate\.instant\()?'([^']+)'/.exec(block)?.[1]
                found.push(page(id, title, { prioritized: /\bprioritized = true\b/.test(block), file: `${dir}/src/${file}` }))
            }
        }
    }
    return found
}

/** What the template draws: the first label, Application, then the loop, then Config file. */
function render (groups) {
    const out = [`#${groups[0].id}`, 'application']
    for (const [index, group] of groups.entries()) {
        if (index) { out.push(`#${group.id}`) }
        out.push(...group.providers.map(p => p.id))
    }
    out.push('config-file')
    return out
}

const section = (groups, id) => groups.find(g => g.id === id)?.providers.map(p => p.id)

console.log('\n── the table ──')
const listed = SETTINGS_NAV_GROUPS.flatMap(g => g.pages)
check('no page is listed in two sections', listed.length, new Set(listed).size)
check('section ids are unique', SETTINGS_NAV_GROUPS.length, new Set(SETTINGS_NAV_GROUPS.map(g => g.id)).size)
check('every section has a title', SETTINGS_NAV_GROUPS.every(g => typeof g.title === 'string' && g.title.length > 0), true)
check('the default section exists', SETTINGS_NAV_GROUPS.some(g => g.id === DEFAULT_SETTINGS_NAV_GROUP), true)
// The template draws these two itself, ahead of and behind the provider loop.
check('Application opens the first section', SETTINGS_NAV_GROUPS[0].pages[0], 'application')
check('Config file closes the last section', SETTINGS_NAV_GROUPS[SETTINGS_NAV_GROUPS.length - 1].pages.slice(-1)[0], 'config-file')

console.log('\n── every builtin page this tree has ──')
const builtins = builtinPages()
check('the scan found the providers', builtins.length >= 17, true)
for (const p of builtins) {
    check(`${p.file} "${p.id}" is placed by the table`, listed.includes(p.id), true)
}
const before = builtins.map(p => p.id)
const real = groupSettingsProviders(builtins)
check('the nav, in order', render(real), [
    '#general', 'application', 'window', 'hotkeys',
    '#terminal', 'terminal', 'terminal-appearance', 'terminal-color-scheme', 'terminal-shell', 'resume',
    '#connections', 'profiles', 'ssh', 'vault',
    '#links', 'link-tooltip', 'integrations',
    '#claude', 'claude',
    '#plugins', 'plugins',
    '#development', 'builds', 'upstream',
    '#configuration', 'config-sync', 'config-file',
])
check('nothing is lost or doubled', real.flatMap(g => g.providers).length, builtins.length)
check('and the input array is left in its order', builtins.map(p => p.id), before)

console.log('\n── the three third-party plugins on this machine, by their real shapes ──')
// Read out of each plugin's published bundle: none of them has `group`.
const claudeStatus = page('claude-status', 'Claude Status', { icon: 'bell' })
const backslash = page('backslash-newline', 'Backslash Newline', { icon: 'fas fa-keyboard', weight: 10 })
const mcp = page('mcp', 'MCP', { icon: 'server' })
const withPlugins = groupSettingsProviders([...builtins, backslash, mcp, claudeStatus])
check('Claude Status sits beside Claude', section(withPlugins, 'claude'), ['claude', 'claude-status'])
check('the others land under Plugins, after the manager, by weight', section(withPlugins, 'plugins'), ['plugins', 'mcp', 'backslash-newline'])

console.log('\n── pages that say something, or nothing ──')
const odd = groupSettingsProviders([
    ...builtins,
    page('x-terminal', 'Zed', { group: 'terminal' }),
    page('x-bogus', 'Bogus', { group: 'no-such-section' }),
    page('x-number', 'Numeric', { group: 5 }),
    page('ssh-moved', 'SSH moved', {}),
    page('x-late', 'Aardvark', { weight: 5 }),
    page('x-early', 'Zebra', { prioritized: true }),
    page('x-untitled', undefined, { weight: undefined }),
])
check('a known section is honoured, after the pages it lists', section(odd, 'terminal').slice(-2), ['resume', 'x-terminal'])
check('an unknown section, a non-string one and none at all land under Plugins', section(odd, 'plugins'),
    ['plugins', 'x-early', 'x-untitled', 'x-bogus', 'x-number', 'ssh-moved', 'x-late'])
check('a page asking for a section wins over the table',
    section(groupSettingsProviders([page('ssh', 'SSH', { group: 'terminal' })]), 'terminal'), ['ssh'])

console.log('\n── sections with nothing in them ──')
const empty = groupSettingsProviders([])
check('only the two the template fills itself are drawn', empty.map(g => g.id), ['general', 'configuration'])
check('an empty middle section is not drawn',
    groupSettingsProviders([page('vault', 'Vault')]).map(g => g.id), ['general', 'connections', 'configuration'])
for (const input of [[], [page('mcp', 'MCP')], builtins, [page('x', 'X', { group: 'configuration' })]]) {
    const groups = groupSettingsProviders(input)
    check(`with ${input.length} page(s), General is first and Configuration last`,
        [groups[0].id, groups[groups.length - 1].id], ['general', 'configuration'])
}
check('a page asking for Configuration goes ahead of Config file',
    render(groupSettingsProviders([page('config-sync', 'Config sync'), page('x', 'X', { group: 'configuration' })])).slice(-3),
    ['config-sync', 'x', 'config-file'])

console.log(`\n${passed} passed, ${failed} failed`)
process.exitCode = failed ? 1 : 0
