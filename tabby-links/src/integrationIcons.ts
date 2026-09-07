/**
 * Resolving a manifest's `icon` to something an `<img src>` can load.
 *
 * The built-in manifests are held byte-for-byte to the Windows Terminal fork's
 * copies (see `test/logic.test.js`), and that fork writes its logos as
 * `ms-appx:///IntegrationIcons/<file>.png` — the URI scheme its MSIX package
 * resolves. Rather than diverge the JSON, the *host* resolves the scheme: there
 * it goes to `IconPathConverter`, here the file name is looked up in a map of
 * PNGs webpack has inlined into this bundle. One manifest, both terminals.
 *
 * Deliberately pure and asset-map-injected, so `logic.test.js` can drive the
 * whole truth table with no bundle and no webpack.
 */

/** The prefix the reference fork's built-in manifests use. */
const MS_APPX_PREFIX = 'ms-appx:///IntegrationIcons/'

/**
 * Schemes an `<img>` in the renderer can actually load. A user manifest is told
 * by INTEGRATIONS.md to give a URI, and these are the ones that mean anything
 * here. Angular's sanitiser passes all of them; only `javascript:` is refused,
 * and it is not on this list.
 */
const LOADABLE = /^(?:https?|data|file):/i

/**
 * `icon` → a value for `<img src>`, or `''` for "draw no icon".
 *
 * `''` rather than a placeholder or the original string is the whole safety
 * property: the template guards the `<img>` with `*ngIf`, so an unresolvable
 * icon renders no element at all instead of a broken-image glyph. `onUnknown`
 * is where it stops being silent — that is the difference between this and
 * passing `manifest.icon` straight through, which is what used to happen and
 * would put a bare Segoe glyph into `src`.
 */
export function resolveIntegrationIcon (
    icon: string | undefined,
    assets: Record<string, string>,
    onUnknown?: (reason: string) => void,
): string {
    const value = (icon ?? '').trim()
    if (!value) {
        // No icon asked for. Not a problem, and not worth a log line.
        return ''
    }
    if (value.startsWith(MS_APPX_PREFIX)) {
        const file = value.slice(MS_APPX_PREFIX.length)
        const asset = assets[file]
        if (asset) {
            return asset
        }
        onUnknown?.(`no bundled icon named "${file}"`)
        return ''
    }
    if (LOADABLE.test(value)) {
        return value
    }
    // A relative path, another package scheme, or a bare glyph such as the
    // U+E82D that the reference fork's github.json carried before it grew a
    // logo. None of them is loadable here. Named by codepoint rather than
    // pasted in: it is a private-use character, so a literal would depend on
    // this file's encoding surviving every editor that ever opens it.
    onUnknown?.(`unsupported icon value "${value}"`)
    return ''
}
