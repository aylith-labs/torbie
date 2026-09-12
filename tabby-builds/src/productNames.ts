/**
 * The names a build can carry on disk — this app's, and the Tabby it was
 * forked from.
 *
 * Four separate places in this package recognise a build by its name: the
 * well-known install roots, the executable sitting beside `resources`, a
 * source checkout's `package.json`, and the window title that says a renderer
 * never got past the splash. Each of those is one half of a pair whose other
 * half lives in `electron-builder.yml` or `app/package.json`, and **renaming
 * one half breaks nothing loudly** — the scan just stops finding a build, or
 * the doctor calls every stuck build healthy. Naming them once, here, is what
 * makes that class of drift impossible rather than merely unlikely.
 *
 * Tabby's names stay in every list deliberately. This page inventories every
 * build on the machine and an installed upstream Tabby is one of them; so is a
 * Tabby checkout sitting in another directory. Dropping them would not be a
 * rename, it would be a loss of coverage.
 */

/** This app. */
export const PRODUCT_NAME = 'Torbie'

/** The GitHub repository releases of this app are published from. */
export const PRODUCT_REPO = 'aylith-labs/torbie'

/** Upstream, still recognised wherever a build is being identified. */
export const UPSTREAM_NAME = 'Tabby'

/** Upstream's repository, for a build that is one of theirs. */
export const UPSTREAM_REPO = 'Eugeny/tabby'

/** Display names, this app's first. */
export const PRODUCT_NAMES = [PRODUCT_NAME, UPSTREAM_NAME]

/** `package.json` `name` values that mark a checkout of this app or its parent. */
export const SOURCE_PACKAGE_NAMES = PRODUCT_NAMES.map(n => n.toLowerCase())

/**
 * Executable file names to look for inside an application directory, for every
 * platform at once — a scan does not know which layout it is about to find,
 * and probing a name that cannot exist costs one `access`.
 */
export function executableNames (): string[] {
    const names: string[] = []
    for (const name of PRODUCT_NAMES) {
        names.push(`${name}.exe`, name.toLowerCase())
    }
    return names
}

/** Which product a build with this name or path belongs to. */
export function isUpstreamBuild (nameOrPath: string): boolean {
    const lower = nameOrPath.toLowerCase()
    return lower.includes(UPSTREAM_NAME.toLowerCase()) && !lower.includes(PRODUCT_NAME.toLowerCase())
}

/**
 * The product an executable belongs to, read off its file name: `Torbie.exe`,
 * `torbie` and `Torbie.app/Contents/MacOS/Torbie` all answer Torbie. Null for
 * anything else, `electron.exe` included, which names no product; a source
 * build asks its checkout instead.
 */
export function productFromExecutable (file: string): string | null {
    const stem = (file.split(/[\\/]/).pop() ?? '').replace(/\.exe$/i, '').toLowerCase()
    return PRODUCT_NAMES.find(name => name.toLowerCase() === stem) ?? null
}

/** The product a `package.json` name, or an artifact's name prefix, belongs to. */
export function productFromPackageName (name: string | null | undefined): string | null {
    const lower = (name ?? '').toLowerCase()
    return PRODUCT_NAMES.find(product => product.toLowerCase() === lower) ?? null
}

/**
 * Is this the title a window carries before it has opened a tab?
 *
 * A booted window is named after its active tab; one still on the splash is
 * named after the app. That difference is the only external signal that
 * catches a boot which stalled, since Windows reports such a process as
 * responding throughout.
 */
export function isSplashTitle (title: string): boolean {
    const trimmed = title.trim().toLowerCase()
    return !trimmed || PRODUCT_NAMES.some(name => trimmed === name.toLowerCase())
}
