// What the renderer makes of the updater's events, and what the Application
// page then says. Pure logic: no app, no bundle.
//
//   node tabby-electron/test/updaterState.test.js
//
// The bug this pins: "Check for updates" disabled itself for good. The main
// process's error reached the renderer, `check()` rejected, and the settings
// page awaited it with nothing after the await to re-enable the button — so a
// failed check and a check still running looked identical, forever. Now every
// event lands in one state, `check()` resolves whatever happens, and every
// state with an outcome has a line to show.
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

// The translation marker is an identity function; stand it in so this needs
// nothing beyond the checkout.
const resolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
    if (request === '@biesbjerg/ngx-translate-extract-marker') {
        return path.join(__dirname, '__marker__')
    }
    return resolve.call(this, request, ...rest)
}
require.cache[path.join(__dirname, '__marker__')] = { id: '__marker__', filename: '__marker__', loaded: true, exports: { marker: x => x } }

const { reduceUpdaterState, summarizeUpdaterError } = require(path.join(REPO, 'tabby-electron/src/updaterState.ts'))
const { describeUpdaterState } = require(path.join(REPO, 'tabby-settings/src/updateStatus.ts'))

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

const run = (events, start = { kind: 'idle' }) => events.reduce(reduceUpdaterState, start)
const t = (text, params) => text.replace(/\{(\w+)\}/g, (_, k) => params?.[k] ?? `{${k}}`)
const say = state => describeUpdaterState(state, t)

// The message the installed 1.0.0 actually logged, headers and all.
const REAL_404 = [
    'Cannot find latest.yml in the latest release artifacts (https://github.com/aylith-labs/torbie/releases/download/v1.0.1/latest.yml): HttpError: 404 ',
    '"method: GET url: https://github.com/aylith-labs/torbie/releases/download/v1.0.1/latest.yml\\n\\nPlease double check that your authentication token is correct. Due to security reasons, actual status maybe not reported, but 404.\\n"',
    'Headers: {',
    '  "access-control-allow-origin": "",',
    '  "x-github-request-id": "C0DE:1234"',
    '}',
    '    at createHttpError (…\\builder-util-runtime\\out\\httpExecutor.js:17:12)',
].join('\n')

// --- the reported sequence -------------------------------------------------
{
    const s = run([{ type: 'check' }, { type: 'error', message: REAL_404 }])
    check('a failed check ends in error, not in checking', s.kind, 'error')
    check('the error shown is its first line', s.message,
        'Cannot find latest.yml in the latest release artifacts (https://github.com/aylith-labs/torbie/releases/download/v1.0.1/latest.yml): HttpError: 404')
    check('and the page says so', say(s).startsWith('Could not check for updates: Cannot find latest.yml'), true)
    check('a check after an error starts again', run([{ type: 'check' }], s).kind, 'checking')
}

// --- no update --------------------------------------------------------------
{
    const s = run([{ type: 'check' }, { type: 'not-available' }])
    check('no update is its own state', s, { kind: 'not-available' })
    check('and says so', say(s), 'Torbie is up to date.')
    check('checking says so', say({ kind: 'checking' }), 'Checking for updates…')
    check('idle says nothing', say({ kind: 'idle' }), '')
}

// --- an update: available, progress, downloaded ------------------------------
{
    const available = run([{ type: 'check' }, { type: 'available', version: '1.0.2' }])
    check('an available update is downloading, percent unknown', available, { kind: 'downloading', version: '1.0.2', percent: null })
    check('which names the version', say(available), 'Downloading 1.0.2…')
    const half = run([{ type: 'progress', percent: 48.7 }], available)
    check('progress keeps the version', half, { kind: 'downloading', version: '1.0.2', percent: 48.7 })
    check('progress is clamped', run([{ type: 'progress', percent: 140 }], available).percent, 100)
    check('a check during a download changes nothing', run([{ type: 'check' }], half), half)
    const done = run([{ type: 'downloaded', version: '1.0.2' }], half)
    check('downloaded carries the version', done, { kind: 'downloaded', version: '1.0.2' })
    check('and offers to install it', say(done), 'Torbie 1.0.2 is ready to install.')
    check('a later check does not hide the install button', run([{ type: 'check' }], done), done)
    check('nor does a later "no update"', run([{ type: 'not-available' }], done), done)
    check('nor a late progress event', run([{ type: 'progress', percent: 99 }], done), done)
    check('downloaded without a version borrows the one being downloaded',
        run([{ type: 'downloaded', version: null }], half), { kind: 'downloaded', version: '1.0.2' })
    check('progress before available still shows a download', run([{ type: 'progress', percent: 5 }]), { kind: 'downloading', version: null, percent: 5 })
    check('an unnamed download still says something', say({ kind: 'downloading', version: null, percent: null }), 'Downloading the update…')
    check('an error during the download surfaces', run([{ type: 'error', message: 'sha512 checksum mismatch' }], half),
        { kind: 'error', message: 'sha512 checksum mismatch' })
}

// --- the fallback path ------------------------------------------------------
check('external names the version', say({ kind: 'external', version: '1.0.2' }), 'Torbie 1.0.2 is available.')

// --- error summaries ----------------------------------------------------------
check('an empty error still says something', summarizeUpdaterError(''), 'Unknown error')
check('null too', summarizeUpdaterError(null), 'Unknown error')
check('leading blank lines are skipped', summarizeUpdaterError('\n\n  net::ERR_INTERNET_DISCONNECTED\n  at x'), 'net::ERR_INTERNET_DISCONNECTED')
check('a very long line is cut', summarizeUpdaterError('x'.repeat(1000)).length, 240)

// --- the service listens the way IPC calls ----------------------------------
{
    const src = fs.readFileSync(path.join(REPO, 'tabby-electron/src/services/updater.service.ts'), 'utf8')
    // An ipcRenderer listener's first argument is the event. The old code took
    // it for the payload: `on('updater:error', err => …)` logged the event.
    const payloadListeners = [...src.matchAll(/ipc\.on\('updater:(update-available|download-progress|error|update-downloaded)', \((\w+)/g)]
    check('every payload listener takes the event first', payloadListeners.map(m => m[2]), ['_event', '_event', '_event', '_event'])
    check('check() never rejects', /reject\(/.test(src), false)
    check('the check has a timeout', /setTimeout\(/.test(src), true)
    const pug = fs.readFileSync(path.join(REPO, 'tabby-settings/src/components/settingsTab.component.pug'), 'utf8')
    check('the page draws the updater message', pug.includes('{{updateMessage}}'), true)
    check('the page offers Install and restart', pug.includes('Install and restart'), true)
    check('the check button is disabled only while checking', pug.includes(`[disabled]='updaterState.kind === "checking"'`), true)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
