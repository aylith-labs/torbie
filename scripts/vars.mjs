import * as path from 'path'
import * as fs from 'fs'
import * as semver from 'semver'
import * as childProcess from 'child_process'

process.env.ARCH = ((process.env.ARCH || process.arch) === 'arm') ? 'armv7l' : (process.env.ARCH || process.arch)

import * as url from 'url'
const __dirname = url.fileURLToPath(new URL('.', import.meta.url))

const electronInfo = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../node_modules/electron/package.json')))

/**
 * The version this build calls itself. `package.json` is the only place it is
 * written down, and a tag on HEAD is what turns it from a nightly into a
 * release.
 *
 * This used to be `git describe --tags`, which had two problems that only
 * surfaced once the project moved to its own repository.
 *
 * **It threw.** The new repository has no tags — upstream's were deliberately
 * not imported, because Torbie has not released two hundred and thirty-five
 * versions — so `git describe` exits 128. This module is loaded from the
 * `postinstall` script, so that took the whole of `yarn` down with it, on the
 * first CI run. A shallow CI checkout has exactly the same shape.
 *
 * **And where it did not throw, it lied.** A clone that still carries the
 * imported upstream tags describes HEAD as `v1.0.235-113-g…`, so the same
 * commit built as `1.0.236-nightly.0` on one machine and `0.1.0-nightly.0` on
 * another. A version that depends on which tags your clone happens to have is
 * not a version. Nothing here consults a tag it did not put there.
 */
function resolveVersion () {
    const base = JSON.parse(
        fs.readFileSync(path.resolve(__dirname, '../package.json'), 'utf-8')).version
    if (!semver.valid(base)) {
        throw new Error(`package.json version is not semver: ${base}`)
    }

    let tagged = false
    try {
        // Exact match only: "is *this commit* the release?", never "which
        // release came before it".
        const tags = childProcess.execSync(`git tag --points-at HEAD`, {
            encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'],
        })
        tagged = tags.split('\n').map(t => t.trim()).includes(`v${base}`)
    } catch {
        // Not a git checkout, or git is unavailable. A nightly, then.
    }

    return tagged ? base : `${base}-nightly.${process.env.REV ?? 0}`
}

export const version = resolveVersion()

export const builtinPlugins = [
    'tabby-core',
    'tabby-settings',
    'tabby-terminal',
    'tabby-web',
    'tabby-community-color-schemes',
    'tabby-ssh',
    'tabby-serial',
    'tabby-telnet',
    'tabby-local',
    'tabby-electron',
    'tabby-plugin-manager',
    'tabby-linkifier',
    'tabby-links',
    'tabby-render-timing',
    'tabby-upstream',
    'tabby-claude',
    'tabby-resume',
    'tabby-builds',
    'tabby-auto-sudo-password',
]

export const packagesWithDocs = [
    ['.', 'tabby-core'],
    ['terminal', 'tabby-terminal'],
    ['local', 'tabby-local'],
    ['settings', 'tabby-settings'],
]

export const allPackages = [
    ...builtinPlugins,
    'web',
    'tabby-web-demo',
]

export const bundledModules = [
    '@angular',
    '@ng-bootstrap',
]
export const electronVersion = electronInfo.version

// Distribution is GitHub releases only. The Keygen account and per-arch product
// UUIDs that used to live here belong to upstream Tabby's distribution account,
// so a build of this fork authenticating against them would publish into
// somebody else's release channel. Removed rather than repointed: there is no
// Torbie Keygen account, and GitHub releases already carry the artifacts.
