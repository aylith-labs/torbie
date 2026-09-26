/**
 * Where the auto-updater looks for a newer release, per platform and arch.
 *
 * The release carries one update manifest per platform *and* arch, because
 * `scripts/build-{windows,macos,linux}.mjs` publish with
 * `channel: latest-${ARCH}`: `latest-x64.yml`, `latest-arm64.yml`,
 * `latest-x86_64-mac.yml`, `latest-arm64-mac.yml`, and the Linux ones.
 *
 * electron-updater's stock `GitHubProvider` never asks for any of them. It
 * ignores `channel` from `app-update.yml` on GitHub ("Not applicable for
 * GitHub") and requests `getDefaultChannelName()` — plain `latest`, plus
 * `-mac` on macOS and nothing at all on Windows — so an installed 1.0.0 asked
 * for `releases/download/v1.0.1/latest.yml`, got a 404, and the update check
 * failed on every Windows install since the first release. Upstream Tabby has
 * the same layout and the same failure; its renderer falls back to opening the
 * release page, which is why nobody there notices.
 *
 * The fix keeps the GitHub provider — its tag-pinned download URLs are what
 * make the NSIS blockmap (differential) download find the *old* version's
 * blockmap — and changes only the one thing it gets wrong: the channel name.
 * A generic provider at `releases/latest/download` would also find the file,
 * but every URL there resolves against "latest", so the old blockmap would
 * 404 and every update would be a full download.
 *
 * Pure apart from the base class handed in, so `app/test/updateFeed.test.js`
 * can run it against electron-updater's real provider in plain node.
 */

export const UPDATE_OWNER = 'aylith-labs'
export const UPDATE_REPO = 'torbie'

/**
 * The channel a build publishes under: `latest-${ARCH}` with the ARCH each
 * build script uses — `process.arch`, except macOS says `x86_64` for x64 and
 * Linux says `armv7l` for arm.
 */
export function updateChannel (platform: string, arch: string): string {
    if (platform === 'darwin' && arch === 'x64') {
        return 'latest-x86_64'
    }
    if (platform === 'linux' && arch === 'arm') {
        return 'latest-armv7l'
    }
    return `latest-${arch}`
}

/**
 * The manifest file electron-updater will request for that channel: the
 * channel plus `Provider.getChannelFilePrefix()` — nothing on Windows, `-mac`
 * on macOS, `-linux[-arch]` on Linux (x64 has no arch suffix, arm is `-arm`).
 * Written out independently of electron-updater so the test can hold the two
 * against each other and against the file names electron-builder publishes.
 */
export function updateManifestName (platform: string, arch: string): string {
    const channel = updateChannel(platform, arch)
    if (platform === 'darwin') {
        return `${channel}-mac.yml`
    }
    if (platform === 'linux') {
        return `${channel}-linux${arch === 'x64' ? '' : `-${arch}`}.yml`
    }
    return `${channel}.yml`
}

/**
 * `GitHubProvider` with the channel name replaced. `getDefaultChannelName()`
 * is what `GitHubProvider.getLatestVersion()` asks for when prereleases are
 * off (they are — see `feedOptions`), and it is the fallback when they are on.
 */
export function archGitHubProvider<T extends new (...args: any[]) => any> (GitHubProvider: T, channel: string): T {
    return class ArchGitHubProvider extends GitHubProvider {
        getDefaultChannelName (): string {
            return (this as any).getCustomChannelName(channel)
        }
    }
}

/** What `autoUpdater.setFeedURL()` gets: a `custom` provider pointing at this repository. */
export function feedOptions (GitHubProvider: new (...args: any[]) => any, platform: string, arch: string): Record<string, any> {
    return {
        provider: 'custom',
        updateProvider: archGitHubProvider(GitHubProvider, updateChannel(platform, arch)),
        owner: UPDATE_OWNER,
        repo: UPDATE_REPO,
    }
}
