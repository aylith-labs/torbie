// The herdr/shefrd focus path, driven against a fake stith.
//
// No app and no bundle: `HerdrService` only needs a config store, a logger and
// `fetch`, all of which are stubbed here, and the endpoints are served by an
// HTTP server this test owns. Never point it at the real stith — the whole
// point of the service is that it issues a command that moves someone's
// desktop, which is not a thing a test suite may do as a side effect.
//
// Run with: node tabby-claude/test/herdr.test.js
const path = require('path')
const fs = require('fs')
const http = require('http')
const Module = require('module')

const REPO = path.resolve(__dirname, '../..')

// `tabby-core` is an external in every plugin build. The service takes
// `ConfigService` and `LogService` as types and calls only `log.create`.
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

const { HerdrService } = require(path.join(REPO, 'tabby-claude/src/services/herdr.service.ts'))

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

/** A stith whose answers this test decides, and which counts what it was asked. */
function fakeStith () {
    const state = {
        requests: [],
        focusBody: null,
        panes: {
            available: true,
            unavailableReason: null,
            rows: [
                { paneId: 'w1:pA', workspaceId: 'w1', tabId: 'w1:t1', sessionId: 'sess-a', agent: 'claude', agentStatus: 'idle', focused: true, cwd: '/home/x/a', terminalTitle: 'a' },
                { paneId: 'w1:pB', workspaceId: 'w1', tabId: 'w1:t2', sessionId: 'sess-b', agent: 'claude', agentStatus: 'busy', focused: false, cwd: '/home/x/b', terminalTitle: 'b' },
                // A pane with no session at all: real listings carry these, and
                // they must never be joined to anything.
                { paneId: 'w1:pC', workspaceId: 'w1', tabId: 'w1:t3', sessionId: null, focused: false, cwd: '/home/x/c' },
            ],
        },
        focusStatus: 200,
        panesStatus: 200,
        panesContentType: 'application/json',
    }
    const server = http.createServer((req, res) => {
        state.requests.push(`${req.method} ${req.url}`)
        if (req.url === '/api/herdr/panes') {
            res.writeHead(state.panesStatus, { 'content-type': state.panesContentType })
            res.end(JSON.stringify(state.panes))
            return
        }
        if (req.url === '/api/herdr/focus') {
            let body = ''
            req.on('data', c => { body += c })
            req.on('end', () => {
                state.focusBody = body
                res.writeHead(state.focusStatus, { 'content-type': 'application/json' })
                res.end('{"ok":true}')
            })
            return
        }
        res.writeHead(404)
        res.end('no')
    })
    return { server, state }
}

function makeService (baseURL, config = {}) {
    const store = { claude: { shefrd: { enabled: true }, ...config } }
    return new HerdrService(
        { store },
        { baseURL },
        { create: () => ({ debug () {}, info () {}, error () {} }) },
    )
}

async function main () {
    const { server, state } = fakeStith()
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
    const baseURL = `http://127.0.0.1:${server.address().port}`

    try {
        console.log('\n── the join is sessionId, and only a pane that has one ──')
        let herdr = makeService(baseURL)
        const panes = await herdr.panes()
        check('every pane with an id is kept', panes.length, 3)
        check('a pane running a session is found by it', (await herdr.paneFor('sess-b')).paneId, 'w1:pB')
        check('a session with no pane resolves to nothing', await herdr.paneFor('sess-zzz'), null)
        // The paneless row is the trap: `undefined === undefined` would match it
        // for any session whose id is missing.
        check('and a paneless row is never the answer for a missing id', await herdr.paneFor(undefined), null)

        console.log('\n── focusing sends the command the manifest documents ──')
        state.requests.length = 0
        check('focus reports what it did', await herdr.focus('sess-b'), 'focused')
        check('as one POST', state.requests.filter(r => r.startsWith('POST')), ['POST /api/herdr/focus'])
        check('carrying the pane id, not the session id', JSON.parse(state.focusBody), { kind: 'pane', id: 'w1:pB' })

        console.log('\n── and says which way it failed, because the fallbacks differ ──')
        check('a session nothing is running is "no-pane"', await herdr.focus('sess-zzz'), 'no-pane')
        state.focusStatus = 500
        herdr = makeService(baseURL)
        check('a rejected command is "failed", not "no-pane"', await herdr.focus('sess-b'), 'failed')
        state.focusStatus = 200

        console.log('\n── the cache spares the listing, and a command drops it ──')
        herdr = makeService(baseURL)
        state.requests.length = 0
        await herdr.panes()
        await herdr.panes()
        await herdr.panes()
        check('three reads in a row cost one request', state.requests.filter(r => r.includes('panes')).length, 1)
        // Several rows asking at once must not become several requests.
        herdr = makeService(baseURL)
        state.requests.length = 0
        await Promise.all([herdr.panes(), herdr.panes(), herdr.panes(), herdr.panes()])
        check('and four at once cost one too', state.requests.filter(r => r.includes('panes')).length, 1)

        state.requests.length = 0
        await herdr.focus('sess-b')
        const afterFocus = state.requests.filter(r => r.includes('panes')).length
        await herdr.panes()
        check('after a focus the listing is re-read, since a pane moved',
            state.requests.filter(r => r.includes('panes')).length, afterFocus + 1)

        console.log('\n── the switch is honoured, and the default is on ──')
        check('absent config means enabled', makeService(baseURL, { shefrd: undefined }).enabled, true)
        check('explicitly off means off', makeService(baseURL, { shefrd: { enabled: false } }).enabled, false)
        check('and a disabled service refuses to focus', await makeService(baseURL, { shefrd: { enabled: false } }).focus('sess-b'), 'no-pane')

        console.log('\n── an HTML answer is an error, not an empty pane list ──')
        // stith serves its SPA as a catch-all, so a moved endpoint comes back
        // 200 text/html. Reading that as data would report "no panes" for ever.
        state.panesContentType = 'text/html'
        herdr = makeService(baseURL)
        let threw = null
        try { await herdr.panes() } catch (e) { threw = String(e.message) }
        check('it throws', /expected JSON/.test(threw ?? ''), true)
        check('and focus turns that into "failed"', await makeService(baseURL).focus('sess-b'), 'failed')
        state.panesContentType = 'application/json'

        console.log('\n── cachedPaneFor never blocks, and never lies before a read ──')
        herdr = makeService(baseURL)
        check('nothing is claimed before the first listing', herdr.cachedPaneFor('sess-b'), null)
        await herdr.panes()
        check('and after it, the same answer as the async form', herdr.cachedPaneFor('sess-b').paneId, 'w1:pB')

        console.log('\n── warm() is speculative and must never throw ──')
        state.panesStatus = 503
        herdr = makeService(baseURL)
        herdr.warm()
        await new Promise(r => setTimeout(r, 200))
        check('a failing warm leaves the service usable', herdr.cachedPaneFor('sess-b'), null)
        state.panesStatus = 200
    } finally {
        await new Promise(resolve => server.close(resolve))
    }

    console.log(`\n${passed} passed, ${failed} failed`)
    if (failed) { process.exitCode = 1 }
}

main().catch(e => { console.error(e); process.exitCode = 1 })
