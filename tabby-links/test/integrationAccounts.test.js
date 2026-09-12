// What the Integrations list costs to verify itself.
//
// The check it runs (`checkIntegrationAccount`) talks to GitHub, Jira and
// Slack; this suite never does. It replaces the module those calls live in with
// a counter, which is the only way to assert the thing that actually matters
// here — that opening a page does not become a burst of requests.
//
// Run with: node tabby-links/test/integrationAccounts.test.js
const path = require('path')
const fs = require('fs')
const Module = require('module')

const REPO = path.resolve(__dirname, '../..')

const stubs = { 'tabby-core': new Proxy({}, { get: () => class Stub {} }) }
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

// The real account check is replaced before the service is loaded, so nothing
// in this process can reach a network.
const accountModulePath = require.resolve(path.join(REPO, 'tabby-links/src/services/integrationAccount.ts'))
const calls = []
let answer = integration => ({ state: 'connected', login: `as-${integration.id}`, message: 'ok', organizations: [] })
require.cache[accountModulePath] = {
    id: accountModulePath,
    filename: accountModulePath,
    loaded: true,
    exports: {
        checkIntegrationAccount: async integration => {
            calls.push(integration.id)
            return answer(integration)
        },
        preferredOwners: () => [],
    },
}

const { IntegrationAccountsService } = require(path.join(REPO, 'tabby-links/src/services/integrationAccounts.service.ts'))

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

const integrations = ['github', 'jira', 'slack', 'stith'].map(id => ({ id }))

async function main () {
    console.log('\n── opening the page checks everything, once ──')
    let service = new IntegrationAccountsService()
    calls.length = 0
    await service.checkAll(integrations)
    check('one request per integration', calls.length, 4)
    check('and each row has an answer', integrations.map(x => service.get(x.id).state),
        ['connected', 'connected', 'connected', 'connected'])
    check('naming the account, which is the useful half', service.get('jira').login, 'as-jira')

    // The list re-emits on every settings save, so this is the path that would
    // turn typing into a request per keystroke.
    calls.length = 0
    await service.checkAll(integrations)
    await service.checkAll(integrations)
    check('re-opening inside the TTL costs nothing', calls.length, 0)

    console.log('\n── several rows asking at once are one request each ──')
    service = new IntegrationAccountsService()
    calls.length = 0
    await Promise.all([
        service.checkAll(integrations),
        service.checkAll(integrations),
        service.check(integrations[0]),
        service.check(integrations[0]),
    ])
    check('four overlapping passes, four requests', calls.length, 4)

    console.log('\n── the Re-check button forces, but never races ──')
    calls.length = 0
    await service.checkAll(integrations, true)
    check('force ignores the cache', calls.length, 4)
    calls.length = 0
    // Two forced checks of the same thing must not both go out: whichever
    // landed last would win, which is not necessarily the newer answer.
    await Promise.all([service.check(integrations[0], true), service.check(integrations[0], true)])
    check('but joins a request already out', calls.length, 1)

    console.log('\n── busy and checking describe what is actually happening ──')
    service = new IntegrationAccountsService()
    check('idle before anything is asked', [service.busy, service.checking('github')], [false, false])
    const pending = service.checkAll(integrations)
    check('busy while the pass is out', [service.busy, service.checking('github')], [true, true])
    await pending
    check('and idle again once it lands', [service.busy, service.checking('github')], [false, false])

    console.log('\n── a row never gets stuck without a verdict ──')
    service = new IntegrationAccountsService()
    answer = () => { throw new Error('kaboom') }
    await service.checkAll([{ id: 'github' }])
    check('an unanticipated throw becomes a state', service.get('github').state, 'error')
    check('carrying the reason', /kaboom/.test(service.get('github').message), true)
    check('and the service is idle, not stuck', service.busy, false)
    answer = integration => ({ state: 'connected', login: `as-${integration.id}`, message: 'ok', organizations: [] })

    console.log('\n── invalidate is what a settings edit leaves behind ──')
    service = new IntegrationAccountsService()
    await service.checkAll(integrations)
    calls.length = 0
    service.invalidate('jira')
    await service.checkAll(integrations)
    check('only the edited one is asked again', calls, ['jira'])
    service.invalidate('nope')
    check('and an unknown id is harmless', service.get('nope'), null)

    console.log(`\n${passed} passed, ${failed} failed`)
    if (failed) { process.exitCode = 1 }
}

main().catch(e => { console.error(e); process.exitCode = 1 })
