// Which update manifest an installed Torbie asks GitHub for, per platform and arch.
//
//   node app/test/updateFeed.test.js            # offline, fast tier
//   node app/test/updateFeed.test.js --live     # also against the real latest release
//
// Plain node. `app/lib/updateFeed.ts` is transpiled and handed electron-updater's
// real GitHubProvider through its real providerFactory — the exact object
// `autoUpdater.setFeedURL()` builds in app/lib/window.ts — and the provider is
// run against a fake HTTP executor that records every URL it asks for.
//
// The bug this pins: the stock GitHub provider requested `latest.yml` on
// Windows (and `latest-mac.yml` on macOS), while every release carries only the
// per-arch manifests the build scripts publish (`latest-x64.yml`, …). So every
// Windows check from the installed 1.0.0 (electron-updater 5.3) failed with a
// 404 — "Cannot find latest.yml in the latest release artifacts". 6.x reads
// `channel` from app-update.yml on GitHub too, but only if one is there; the
// feed built here does not depend on it. The stock provider without a channel
// is run too and must still ask for `latest.yml`, or this suite would pass
// against a fixture that no longer reproduces anything.
//
// UPDATER_NODE_MODULES=<dir> runs it against another electron-updater install,
// e.g. the one the lockfile pins when app/node_modules is stale.
const path = require('path')
const fs = require('fs')
const Module = require('module')

const REPO = path.resolve(__dirname, '../..')
const LIVE = process.argv.includes('--live')

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

const F = require(path.join(REPO, 'app/lib/updateFeed.ts'))
const APP_MODULES = process.env.UPDATER_NODE_MODULES || path.join(REPO, 'app/node_modules')
console.log(`electron-updater ${require(path.join(APP_MODULES, 'electron-updater/package.json')).version}`)
const { GitHubProvider } = require(path.join(APP_MODULES, 'electron-updater/out/providers/GitHubProvider'))
const { createClient } = require(path.join(APP_MODULES, 'electron-updater/out/providerFactory'))
const semver = require(path.join(APP_MODULES, 'semver'))

// Every platform/arch a release is built for, from .github/workflows/build.yml,
// in the arch names `process.arch` reports on the machine that runs the app.
const TARGETS = [
    ['win32', 'x64'],
    ['win32', 'arm64'],
    ['darwin', 'x64'],
    ['darwin', 'arm64'],
    ['linux', 'x64'],
    ['linux', 'arm64'],
]

// What electron-builder writes for each target, from the build scripts' own
// `channel: latest-${ARCH}` and ARCH names, and `getUpdateInfoFileName` in
// app-builder-lib: `${channel}${os suffix}${linux arch suffix}.yml`. Matches
// the six manifests on the v1.0.1 release. (Linux armv7l is not built any
// more; `updateChannel` still maps it, since build-linux.mjs does.)
const PUBLISHED = {
    'win32/x64': 'latest-x64.yml',
    'win32/arm64': 'latest-arm64.yml',
    'darwin/x64': 'latest-x86_64-mac.yml',
    'darwin/arm64': 'latest-arm64-mac.yml',
    'linux/x64': 'latest-x64-linux.yml',
    'linux/arm64': 'latest-arm64-linux-arm64.yml',
}

const TAG = 'v1.0.1'
const ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>tag:github.com,2008:Repository/1/${TAG}</id>
    <link rel="alternate" type="text/html" href="https://github.com/aylith-labs/torbie/releases/tag/${TAG}"/>
    <title>${TAG}</title>
    <content type="html">No content.</content>
  </entry>
</feed>`

function manifestFor (version, file) {
    return [
        `version: ${version}`,
        'files:',
        `  - url: ${file}`,
        '    sha512: AAAA',
        '    size: 1',
        `path: ${file}`,
        'sha512: AAAA',
        "releaseDate: '2026-09-25T10:40:35.000Z'",
        '',
    ].join('\n')
}

function urlOf (options) {
    return `${options.protocol ?? 'https:'}//${options.hostname}${options.port ? `:${options.port}` : ''}${options.path}`
}

/** An executor answering like github.com, recording what was asked. `live` forwards to the network instead. */
function executor (requested, { live = false } = {}) {
    return {
        async request (options) {
            const url = urlOf(options)
            requested.push(url)
            if (live) {
                const response = await fetch(url, { headers: options.headers, redirect: 'follow' })
                if (!response.ok) {
                    const { HttpError } = require(path.join(APP_MODULES, 'builder-util-runtime'))
                    throw new HttpError(response.status, `${response.status} ${response.statusText}`)
                }
                return response.text()
            }
            if (url.endsWith('/releases.atom')) {
                return ATOM
            }
            if (url.endsWith('/releases/latest')) {
                return JSON.stringify({ tag_name: TAG })
            }
            const file = url.split('/').pop()
            if (Object.values(PUBLISHED).includes(file)) {
                return manifestFor('1.0.1', file.replace('.yml', '.bin'))
            }
            const { HttpError } = require(path.join(APP_MODULES, 'builder-util-runtime'))
            throw new HttpError(404, `404 Not Found for ${url}`)
        },
    }
}

function fakeUpdater (version, allowPrerelease = false) {
    return {
        currentVersion: semver.parse(version),
        allowPrerelease,
        channel: null,
        fullChangelog: false,
    }
}

async function manifestRequested (options, platform, arch, updater, exec) {
    const requested = []
    const previous = process.env.TEST_UPDATER_ARCH
    process.env.TEST_UPDATER_ARCH = arch
    try {
        const provider = createClient(options, updater, { platform, executor: exec(requested) })
        try {
            const info = await provider.getLatestVersion()
            return { url: requested.find(u => u.endsWith('.yml')), info, provider, error: null }
        } catch (e) {
            return { url: requested.find(u => u.endsWith('.yml')), info: null, provider, error: e }
        }
    } finally {
        if (previous === undefined) {
            delete process.env.TEST_UPDATER_ARCH
        } else {
            process.env.TEST_UPDATER_ARCH = previous
        }
    }
}

const stock = { provider: 'github', owner: 'aylith-labs', repo: 'torbie' }
const base = `https://github.com/aylith-labs/torbie/releases/download/${TAG}`

async function main () {
    // --- the fixture still reproduces the bug --------------------------------
    {
        const r = await manifestRequested(stock, 'win32', 'x64', fakeUpdater('1.0.0'), executor)
        check('stock GitHub provider asks for latest.yml on Windows x64', r.url, `${base}/latest.yml`)
        check('and fails with the error in main-process-errors.log', r.error?.code, 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND')
        const mac = await manifestRequested(stock, 'darwin', 'arm64', fakeUpdater('1.0.0'), executor)
        check('stock GitHub provider asks for latest-mac.yml on macOS', mac.url, `${base}/latest-mac.yml`)
    }

    // --- pure mapping ----------------------------------------------------------
    for (const [platform, arch] of TARGETS) {
        check(`updateManifestName(${platform}, ${arch}) is what the build publishes`,
            F.updateManifestName(platform, arch), PUBLISHED[`${platform}/${arch}`])
    }

    // --- the provider window.ts builds asks for the published file ------------
    for (const [platform, arch] of TARGETS) {
        const options = F.feedOptions(GitHubProvider, platform, arch)
        const r = await manifestRequested(options, platform, arch, fakeUpdater('1.0.0'), executor)
        const file = PUBLISHED[`${platform}/${arch}`]
        check(`${platform}/${arch} requests ${file} from the tagged release`, r.url, `${base}/${file}`)
        check(`${platform}/${arch} resolves an update`, r.info?.version ?? String(r.error), '1.0.1')
        if (r.info) {
            // Tag-pinned, not releases/latest/download: that is what lets the
            // NSIS differential download find the old version's blockmap.
            const files = r.provider.resolveFiles(r.info).map(f => f.url.href)
            check(`${platform}/${arch} downloads from the tagged release`, files, [`${base}/${r.info.path}`])
        }
    }

    // --- options shape ----------------------------------------------------------
    {
        const options = F.feedOptions(GitHubProvider, 'win32', 'x64')
        check('feed is a custom provider on aylith-labs/torbie',
            [options.provider, options.owner, options.repo], ['custom', 'aylith-labs', 'torbie'])
        const provider = createClient(options, fakeUpdater('1.0.0'), { platform: 'win32', executor: executor([]) })
        check('the custom provider is a GitHubProvider', provider instanceof GitHubProvider, true)
        check('and does not use multi-range requests (GitHub is S3)', provider.isUseMultipleRangeRequest, false)
    }

    // --- a nightly, with prereleases off as window.ts sets them ----------------
    // (Left on, electron-updater derives them from the version and a nightly
    // hunts the feed for a "nightly" tag, which no release has.)
    {
        check('armv7l maps to what build-linux.mjs publishes', F.updateManifestName('linux', 'arm'), 'latest-armv7l-linux-arm.yml')
        const options = F.feedOptions(GitHubProvider, 'win32', 'x64')
        const off = await manifestRequested(options, 'win32', 'x64', fakeUpdater('1.0.1-nightly.5', false), executor)
        check('with them off it reads the latest release per-arch file', [off.url, off.info?.version], [`${base}/latest-x64.yml`, '1.0.1'])
    }

    // --- window.ts wires it --------------------------------------------------
    {
        const window = fs.readFileSync(path.join(REPO, 'app/lib/window.ts'), 'utf8')
        check('window.ts sets the feed from feedOptions', /autoUpdater\.setFeedURL\(feedOptions\(GitHubProvider, process\.platform, process\.arch\)\)/.test(window), true)
        check('window.ts turns prereleases off', /autoUpdater\.allowPrerelease = false/.test(window), true)
        check('window.ts never calls checkForUpdates() without handling it',
            [...window.matchAll(/\.checkForUpdates\(\)/g)].length, 1)
        check('and that one call is awaited inside try', /try \{[\s\S]*?await u\.checkForUpdates\(\)/.test(window), true)
        const webpack = fs.readFileSync(path.join(REPO, 'app/webpack.config.main.mjs'), 'utf8')
        check('the deep GitHubProvider import is a webpack external',
            webpack.includes("'electron-updater/out/providers/GitHubProvider': 'commonjs electron-updater/out/providers/GitHubProvider'"), true)
    }

    // --- the build scripts still publish under latest-${ARCH} -----------------
    const PUBLISH_CHANNEL = 'channel: `latest-' + '$' + '{process.env.ARCH}`'
    for (const script of ['build-windows.mjs', 'build-macos.mjs', 'build-linux.mjs']) {
        const text = fs.readFileSync(path.join(REPO, 'scripts', script), 'utf8')
        check(`${script} publishes channel latest-\${ARCH}`, text.includes(PUBLISH_CHANNEL), true)
    }

    // --- the real latest release, on request -----------------------------------
    if (LIVE) {
        for (const [platform, arch] of TARGETS) {
            const options = F.feedOptions(GitHubProvider, platform, arch)
            const r = await manifestRequested(options, platform, arch, fakeUpdater('1.0.0'), requested => executor(requested, { live: true }))
            check(`live: ${platform}/${arch} ${r.url}`, r.error ? String(r.error.message).split('\n')[0] : 'resolved', 'resolved')
            if (r.info) {
                const file = r.provider.resolveFiles(r.info)[0].url.href
                const head = await fetch(file, { method: 'HEAD', redirect: 'follow' })
                check(`live: ${platform}/${arch} installer ${file.split('/').pop()} answers`, head.status, 200)
            }
        }
    }

    console.log(`\n${passed} passed, ${failed} failed`)
    process.exit(failed ? 1 : 0)
}

main().catch(e => {
    console.error(e)
    process.exit(1)
})
