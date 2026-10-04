// `~/` paths and sentence punctuation (Lintel paths/README.md, rule 6 and the
// detection patterns), checked against the sources with no build and no app.
//
//   node tabby-links/test/homePaths.test.js
//
// `~` means the home of whoever printed it: a WSL tab's distro user, otherwise
// the host's own user. A home that is not known yet leaves the path
// unresolved — it is never swapped for the Windows one.

const fs = require('fs')
const os = require('os')
const path = require('path')
const Module = require('module')

const REPO = path.resolve(__dirname, '../..')

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

const stubs = {
    '@angular/core': new Proxy({}, { get: () => (() => (target) => target) }),
    'tabby-core': { __esModule: true, HostAppService: class {}, Platform: { Windows: 'Windows', macOS: 'macOS', Linux: 'Linux' } },
    'tabby-terminal': new Proxy({}, { get: () => class Stub {} }),
}
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
    const source = fs.readFileSync(filename, 'utf8')
    module._compile(ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
    }).outputText, filename)
}

const src = p => require(path.join(REPO, 'tabby-links/src', p))
const { pathCandidates } = src('pathResolution.ts')
const { pathPatterns } = src('pathPatterns.ts')
const { WslHomes, homeFromPasswd, wslDefaultUid } = src('wslHomes.ts')
const { LinkTargetService, filesystemPath } = src('services/linkTarget.service.ts')

const share = p => '\\\\wsl.localhost\\Ubuntu' + p.replace(/\//g, '\\')

async function main () {
    console.log('── ~/ against the policy ──')
    check('~/ with a known WSL source home is that distro\'s file',
        pathCandidates('~/a/b.md', true, 'Ubuntu', [], { Ubuntu: '/home/me' }),
        [{ path: share('/home/me/a/b.md'), distro: 'Ubuntu' }])
    check('~/ with no known home has no candidate',
        pathCandidates('~/a/b.md', true, 'Ubuntu', [], {}), [])
    check('a WSL source never borrows the Windows home',
        pathCandidates('~/a/b.md', true, 'Ubuntu', [], { '': 'C:\\Users\\me' }), [])
    check('a non-WSL source on Windows is the Windows profile',
        pathCandidates('~/a/b.md', true, null, [], { '': 'C:\\Users\\me' }),
        [{ path: 'C:\\Users\\me\\a\\b.md', distro: null }])
    check('a local POSIX host uses its own home',
        pathCandidates('~/a/b.md', false, null, [], { '': '/home/me' }),
        [{ path: '/home/me/a/b.md', distro: null }])

    check('filesystemPath: WSL tab, known home',
        filesystemPath('~/notes.md', 'Ubuntu', true, { Ubuntu: '/home/me' }), share('/home/me/notes.md'))
    check('filesystemPath: WSL tab, unknown home is unresolved',
        filesystemPath('~/notes.md', 'Ubuntu', true, {}), '')
    check('filesystemPath: not WSL, Windows home',
        filesystemPath('~/notes.md', null, true, { '': 'C:\\Users\\me' }), 'C:\\Users\\me\\notes.md')
    check('filesystemPath: an absolute path is unchanged by homes',
        filesystemPath('/etc/hosts', 'Ubuntu', true, { Ubuntu: '/home/me' }), share('/etc/hosts'))

    console.log('── detection ──')
    const detect = text => [pathPatterns.windows, pathPatterns.posix]
        .flatMap(p => [...text.matchAll(new RegExp(p, 'g'))].map(m => m[0]))
    check('a sentence-final ~/ path is detected without the dot', detect('see ~/a/b.md.'), ['~/a/b.md'])
    check('~ is kept, so it is never read as /.claude', detect('open ~/.claude/x.md now'), ['~/.claude/x.md'])
    check('a sentence-final absolute path stops before the punctuation', detect('see /a/b.md, then'), ['/a/b.md'])
    check('a question mark ends a Windows path too', detect('is it C:\\x\\y.txt?'), ['C:\\x\\y.txt'])
    check('a dot inside the name stays', detect('~/a.b/c.d'), ['~/a.b/c.d'])

    console.log('── WSL homes ──')
    const passwd = 'root:x:0:0:root:/root:/bin/bash\r\nme:x:1000:1000:Me,,,:/home/me:/bin/zsh\nodd:x:1001:1001::relative:/bin/sh\n'
    check('passwd: the uid\'s sixth field', homeFromPasswd(passwd, 1000), '/home/me')
    check('passwd: root', homeFromPasswd(passwd, 0), '/root')
    check('passwd: a relative home is not a home', homeFromPasswd(passwd, 1001), '')
    check('passwd: an absent uid', homeFromPasswd(passwd, 4242), '')

    const LXSS = 'Software\\Microsoft\\Windows\\CurrentVersion\\Lxss'
    const registry = {
        subkeys: () => ['{a}', '{b}'],
        values: p => ({
            [`${LXSS}\\{a}`]: { DistributionName: { value: 'Ubuntu' }, DefaultUid: { value: 1000 } },
            [`${LXSS}\\{b}`]: { DistributionName: { value: 'Alpine' } },
        })[p] ?? null,
    }
    check('DefaultUid is read for the named distro', wslDefaultUid('ubuntu', registry), 1000)
    check('an absent DefaultUid is root', wslDefaultUid('Alpine', registry), 0)
    check('an unregistered distro has no uid', wslDefaultUid('Debian', registry), null)
    check('no registry, no uid', wslDefaultUid('Ubuntu', null), null)

    let reads = 0
    let fail = true
    const flaky = new WslHomes(() => registry, async () => {
        reads++
        if (fail) throw new Error('share not up yet')
        return passwd
    })
    check('a failed read is unknown', await flaky.within('Ubuntu', 200), undefined)
    fail = false
    check('and is not cached: the next read succeeds', await flaky.within('Ubuntu', 200), '/home/me')
    check('a success is cached', [flaky.known('UBUNTU'), await flaky.load('Ubuntu'), reads], ['/home/me', '/home/me', 2])

    let release
    const slow = new WslHomes(() => registry, () => new Promise(resolve => { release = resolve }))
    check('a slow read is unknown for this hover', await slow.within('Ubuntu', 20), undefined)
    release(passwd)
    await new Promise(resolve => setTimeout(resolve, 10))
    check('and known by the next one', slow.known('Ubuntu'), '/home/me')

    console.log('── LinkTargetService.resolve ──')
    const onWindows = process.platform === 'win32'
    const service = (platform, homes) => {
        const s = new LinkTargetService({ platform })
        Object.defineProperty(s, 'wslHomes', { value: homes })
        s.exists = async () => true
        s.registeredDistros = () => ['Ubuntu']
        return s
    }
    const wslTab = { profile: { options: { command: 'wsl.exe', args: ['-d', 'Ubuntu'] } } }
    const known = new WslHomes(() => registry, async () => passwd)
    let resolved = await service('Windows', known).resolve('~/a/b.md', '', wslTab)
    check('a WSL tab resolves ~/ against its distro\'s home', resolved.filePath, share('/home/me/a/b.md'))
    const never = new WslHomes(() => registry, () => new Promise(() => {}))
    never.within = async () => undefined
    resolved = await service('Windows', never).resolve('~/a/b.md', 'C:\\Users\\me\\a\\b.md', wslTab)
    check('an unknown WSL home leaves ~/ unresolved, not the untildified Windows path', resolved.filePath, '')
    resolved = await service(onWindows ? 'Windows' : 'Linux', known).resolve('~/a/b.md', '', null)
    check('a tab that is not WSL resolves ~/ against the host home',
        resolved.filePath, os.homedir() + (onWindows ? '\\a\\b.md' : '/a/b.md'))
    const unnamed = service('Windows', known)
    unnamed.defaultDistroHost = () => ''
    resolved = await unnamed.resolve('~/a/b.md', '', { profile: { options: { command: 'wsl.exe', args: [] } } })
    check('a WSL tab whose distro cannot be named guesses no home', resolved.filePath, '')

    console.log(`\n${passed} passed, ${failed} failed`)
    process.exit(failed ? 1 : 0)
}

main().catch(e => {
    console.error(e)
    process.exit(1)
})
