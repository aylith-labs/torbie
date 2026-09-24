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

type Build = Pick<TabbyBuild, 'id' | 'kind' | 'product' | 'executable' | 'builtAt'> & {
    git?: TabbyBuild['git']
}

/** The commit a build was compiled from, when it records one. */
export function builtFromCommit (build: Build): string | null {
    return build.git?.builtFrom ?? null
}

/**
 * Whether two recorded commits are the same one. Builds record them at
 * different lengths — a slot's `BUILD-INFO.txt` in full, `build-info.json`
 * cut to eight — so the shorter is compared as a prefix of the longer.
 */
export function sameCommit (a: string | null, b: string | null): boolean {
    if (!a || !b) {
        return false
    }
    const n = Math.min(a.length, b.length)
    return n >= 7 && a.slice(0, n).toLowerCase() === b.slice(0, n).toLowerCase()
}

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
 * Every build that might be offered in place of `current`, newest first.
 *
 * Only the same product: build times say nothing about whether an upstream
 * Tabby should replace a Torbie, and a build whose product cannot be named
 * gets no offer. A build of the commit already running is not newer however
 * recently it was copied: cutting a slot twice from one commit, or copying
 * one, gives a later file time and the same code. Whether a *different*
 * commit is ahead or behind takes git, so that is the caller's to ask.
 */
export function newerBuildCandidates<T extends Build> (current: T, builds: T[]): T[] {
    if (!watchesForNewerBuilds(current) || !current.product) {
        return []
    }
    const commit = builtFromCommit(current)
    return builds
        .filter(x => LANDS_ON.has(x.kind) && !!x.executable && !!x.builtAt)
        .filter(x => x.id !== current.id && x.product === current.product)
        .filter(x => (x.builtAt ?? 0) > (current.builtAt ?? 0))
        .filter(x => !sameCommit(builtFromCommit(x), commit))
        .sort((a, b) => (b.builtAt ?? 0) - (a.builtAt ?? 0))
}

/**
 * The newest build worth offering in place of `current`, or null.
 *
 * `notAhead` names candidates known not to be ahead of `current` — in
 * practice, those whose commit git says is an ancestor of the running one: an
 * old commit rebuilt today is still old code.
 */
export function newerBuild<T extends Build> (
    current: T,
    builds: T[],
    notAhead: (candidate: T) => boolean = () => false,
): T | null {
    return newerBuildCandidates(current, builds).find(x => !notAhead(x)) ?? null
}

/**
 * How a build is described in the offer. Two builds of one release both say
 * 1.0.0, so the version alone told the reader nothing about which was newer;
 * the commit and the build time do.
 */
export function describeBuild (build: Build & Pick<TabbyBuild, 'name' | 'version'>): string {
    const parts = [build.version ?? '?']
    const commit = builtFromCommit(build)
    if (commit) {
        parts.push(`commit ${commit.slice(0, 8)}`)
    }
    if (build.builtAt) {
        const d = new Date(build.builtAt)
        const pad = (n: number) => String(n).padStart(2, '0')
        parts.push(`built ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`)
    }
    return `${build.name} (${parts.join(', ')})`
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
