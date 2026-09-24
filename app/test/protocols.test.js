// Which launches may register the torbie:// and tabby:// URL schemes.
//
//   node app/test/protocols.test.js
//
// Plain node, nothing running and nothing written: the real decision in
// `app/lib/protocols.ts`, transpiled, fed the facts of each kind of launch.
//
// The bug this pins: every launch called `setAsDefaultProtocolClient`, and a
// source launch passed `process.argv[1]` as the app path — `--user-data-dir=…`
// whenever switches come first. Measured on this machine, both schemes had
// been left pointing at
//   "…\torbie\node_modules\electron\dist\electron.exe" "--user-data-dir=…\Temp\tabby-render-xterm-9230" "%1"
// a command that cannot start the app, taking torbie:// from the installed
// Torbie and tabby:// from the installed Tabby. Only the installed build may
// register now, and tabby:// never away from a Tabby.
const path = require('path')
const fs = require('fs')
const Module = require('module')

const REPO = path.resolve(__dirname, '../..')

let passed = 0
let failed = 0
function check (name, actual, expected) {
    const a = JSON.stringify(actual)
    const e = JSON.stringify(expected)
    if (a === e) {
        passed++
        console.log(`ok    ${name}`)
    } else {
        failed++
        console.log(`FAIL  ${name}\n      expected ${e}\n      got      ${a}`)
    }
}

const ts = require(path.join(REPO, 'node_modules/typescript'))
Module._extensions['.ts'] = function (module, filename) {
    const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2019,
            esModuleInterop: true,
        },
        fileName: filename,
    }).outputText
    module._compile(js, filename)
}

const P = require(path.join(REPO, 'app/lib/protocols.ts'))

const LOCAL = 'C:\\Users\\u\\AppData\\Local'
const INSTALLED = `${LOCAL}\\Programs\\Torbie\\Torbie.exe`
const UNINSTALLER = `${LOCAL}\\Programs\\Torbie\\Uninstall Torbie.exe`
const TABBY = `${LOCAL}\\Programs\\Tabby\\Tabby.exe`
const ELECTRON = 'C:\\Users\\u\\projects\\torbie\\node_modules\\electron\\dist\\electron.exe'
const SLOT = 'C:\\Users\\u\\Torbie\\builds\\dev\\Torbie.exe'
const DEV_COMMAND = `"${ELECTRON}" "--user-data-dir=C:\\Users\\u\\AppData\\Local\\Temp\\tabby-render-xterm-9230" "%1"`

function facts (over, files) {
    const present = new Set((files ?? []).map(f => f.toLowerCase()))
    return {
        platform: 'win32',
        defaultApp: false,
        isPackaged: true,
        execPath: INSTALLED,
        argv: [INSTALLED],
        env: { LOCALAPPDATA: LOCAL, ProgramFiles: 'C:\\Program Files' },
        exists: p => present.has(p.toLowerCase()),
        ...over,
    }
}
const handler = command => () => command

// --- builds that must never register --------------------------------------

check('source build (electron.exe app) registers nothing',
    P.schemesToRegister(facts({
        defaultApp: true, isPackaged: false, execPath: ELECTRON,
        argv: [ELECTRON, '--user-data-dir=C:\\tmp\\p', 'app'],
    }, [UNINSTALLER]), handler(null)), [])

check('hidden test launch of a source build registers nothing',
    P.schemesToRegister(facts({
        defaultApp: true, isPackaged: false, execPath: ELECTRON,
        argv: [ELECTRON, '--remote-debugging-port=9251', 'app', '--hidden'],
    }), handler(null)), [])

check('a build slot (packaged, no uninstaller) registers nothing',
    P.schemesToRegister(facts({ execPath: SLOT, argv: [SLOT] }), handler(null)), [])

check('the installed exe on a scratch --user-data-dir registers nothing',
    P.schemesToRegister(facts({ argv: [INSTALLED, '--user-data-dir=C:\\tmp\\p'] }, [UNINSTALLER]), handler(null)), [])

check('the installed exe with --dev registers nothing',
    P.schemesToRegister(facts({ argv: [INSTALLED, '--dev'] }, [UNINSTALLER]), handler(null)), [])

// --- the installed build ---------------------------------------------------

check('installed, Tabby installed, tabby:// held by a dev build: torbie only',
    P.schemesToRegister(facts({}, [UNINSTALLER, TABBY, ELECTRON]), handler(DEV_COMMAND)), ['torbie'])

check('installed, Tabby installed, tabby:// held by Tabby: torbie only',
    P.schemesToRegister(facts({}, [UNINSTALLER, TABBY]), handler(`"${TABBY}" "%1"`)), ['torbie'])

check('installed, tabby:// already this exe: keeps both',
    P.schemesToRegister(facts({}, [UNINSTALLER, TABBY]), handler(`"${INSTALLED.toLowerCase()}" "%1"`)), ['torbie', 'tabby'])

check('installed, no Tabby, no handler: both',
    P.schemesToRegister(facts({}, [UNINSTALLER]), handler(null)), ['torbie', 'tabby'])

check('installed, no Tabby, handler a dead dev build: both',
    P.schemesToRegister(facts({}, [UNINSTALLER]), handler(DEV_COMMAND)), ['torbie', 'tabby'])

check('installed, no Tabby in Programs, but a live Tabby.exe elsewhere holds it: torbie only',
    P.schemesToRegister(facts({}, [UNINSTALLER, 'D:\\Apps\\Tabby\\Tabby.exe']), handler('"D:\\Apps\\Tabby\\Tabby.exe" "%1"')), ['torbie'])

check('per-machine Tabby counts as installed',
    P.schemesToRegister(facts({}, [UNINSTALLER, 'C:\\Program Files\\Tabby\\Tabby.exe']), handler(null)), ['torbie'])

check('packaged on Linux keeps upstream behaviour',
    P.schemesToRegister(facts({ platform: 'linux', execPath: '/opt/Torbie/torbie', argv: ['/opt/Torbie/torbie'] }), handler(null)), ['torbie', 'tabby'])

// --- parsing a handler -----------------------------------------------------

check('command executable: quoted', P.commandExecutable(DEV_COMMAND), ELECTRON)
check('command executable: bare', P.commandExecutable('C:\\x\\a.exe "%1"'), 'C:\\x\\a.exe')
check('command executable: empty', P.commandExecutable(''), null)

// --- nothing else in the main process registers a scheme -------------------

const libDir = path.join(REPO, 'app/lib')
const callers = fs.readdirSync(libDir)
    .filter(f => f.endsWith('.ts'))
    .filter(f => /setAsDefaultProtocolClient\s*\(/.test(fs.readFileSync(path.join(libDir, f), 'utf8')))
check('setAsDefaultProtocolClient is called only from index.ts', callers, ['index.ts'])
const index = fs.readFileSync(path.join(libDir, 'index.ts'), 'utf8')
check('index.ts registers only what schemesToRegister returns, with no app-path argument',
    [...index.matchAll(/setAsDefaultProtocolClient\(([^)]*)\)/g)].map(m => m[1]), ['scheme'])
check('index.ts iterates schemesToRegister', /for \(const scheme of schemesToRegister\(/.test(index), true)

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
