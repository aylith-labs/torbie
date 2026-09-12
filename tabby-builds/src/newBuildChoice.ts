import type { TabbyBuild } from './api'

/**
 * What a running build is offered when a newer one appears, and whether the
 * offer may delete it.
 *
 * Pure, so each rule can be held by a test: every one of them is here because
 * the looser version offered something that went wrong when accepted. The
 * reported case was an installed 1.0.0 offering `tabby (win-unpacked)`, the
 * checkout's electron-builder output, with a button that would have deleted
 * the install.
 */

type Build = Pick<TabbyBuild, 'id' | 'kind' | 'product' | 'executable' | 'builtAt'>

/**
 * Where a switch may land: a portable build, which keeps its own profile, or
 * an installed one.
 *
 * `packaged` is left out. An unpacked directory without a `data` folder uses
 * the same `%APPDATA%` profile as the installed app of its name, and Electron's
 * single-instance lock is keyed on that directory, so launching it while the
 * installed app runs hands the launch back to the running process; the switch
 * then closes this window and nothing is left open. It is also what
 * electron-builder leaves in a checkout's dist folder for `make-slot.mjs` to
 * copy into a slot, and the slot is the build worth switching to.
 */
const LANDS_ON: ReadonlySet<string> = new Set(['portable', 'installed'])

/**
 * Whether a running build looks for newer ones at all.
 *
 * Not from an installed build. That is a release, and a release is replaced by
 * the next release rather than by whatever build happens to sit on this disk.
 * The watcher is for the in-place loop, where a slot is cut while an older one
 * is running. A build with no build time cannot be called out of date either.
 */
export function watchesForNewerBuilds (current: Build): boolean {
    return current.kind !== 'installed' && !!current.builtAt
}

/**
 * The newest build worth offering in place of `current`, or null.
 *
 * Only the same product: build times say nothing about whether an upstream
 * Tabby should replace a Torbie, and a build whose product cannot be named
 * gets no offer.
 */
export function newerBuild<T extends Build> (current: T, builds: T[]): T | null {
    if (!watchesForNewerBuilds(current) || !current.product) {
        return null
    }
    const candidates = builds
        .filter(x => LANDS_ON.has(x.kind) && !!x.executable && !!x.builtAt)
        .filter(x => x.id !== current.id && x.product === current.product)
        .filter(x => (x.builtAt ?? 0) > (current.builtAt ?? 0))
        .sort((a, b) => (b.builtAt ?? 0) - (a.builtAt ?? 0))
    return candidates[0] ?? null
}

/**
 * Whether switching away may also delete the build being left.
 *
 * Only a slot that is not the active build. An installed build has an
 * uninstaller, which also removes its registry entries and shortcuts; removing
 * the directory would leave both pointing at nothing. A source build is more
 * than its root: deleting `app/dist` alone leaves every plugin bundle behind.
 * `isActive` is the caller's to establish, because a build straight from
 * `scan()` always says false.
 */
export function mayDeleteOnSwitch (current: Build, isActive: boolean): boolean {
    return current.kind === 'portable' && !isActive
}
