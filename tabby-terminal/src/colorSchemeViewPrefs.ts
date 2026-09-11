/**
 * How the colour scheme list is *shown* — not what it contains.
 *
 * `localStorage`, deliberately, in the shape `linkTooltipGroupCollapsed` and
 * `profileGroupCollapsed` already use: these are view state, they belong to
 * this machine rather than to a synced `config.yaml`, and putting them in the
 * config would mean a `configDefaults.yaml` line and a fork mark for every one
 * — which is rebase surface bought for a preference about where a preview sits.
 *
 * Every read falls back to the intended default rather than to whatever an
 * absent key coerces to, and every write is wrapped: storage can be
 * unavailable or full, and forgetting where the preview goes is not worth
 * failing the page over.
 */

export type SchemeToneFilter = 'all' | 'dark' | 'light'
export type SchemePreviewPosition = 'bottom' | 'right'

const TONE_KEY = 'colorSchemeToneFilter'
const SWATCH_KEY = 'colorSchemeShowSwatches'
const POSITION_KEY = 'colorSchemePreviewPosition'

function read (key: string): string | null {
    try {
        return window.localStorage[key] ?? null
    } catch {
        return null
    }
}

function write (key: string, value: string): void {
    try {
        window.localStorage[key] = value
    } catch {
        // Storage unavailable or full. The preference is lost, the page is not.
    }
}

export function getToneFilter (): SchemeToneFilter {
    const stored = read(TONE_KEY)
    return stored === 'dark' || stored === 'light' ? stored : 'all'
}

export function setToneFilter (value: SchemeToneFilter): void {
    write(TONE_KEY, value)
}

export function getShowSwatches (): boolean {
    // Absent means the swatches were never turned off, so they are on — which
    // is how the page has always looked.
    return read(SWATCH_KEY) !== 'false'
}

export function setShowSwatches (value: boolean): void {
    write(SWATCH_KEY, String(value))
}

export function getPreviewPosition (): SchemePreviewPosition {
    return read(POSITION_KEY) === 'right' ? 'right' : 'bottom'
}

export function setPreviewPosition (value: SchemePreviewPosition): void {
    write(POSITION_KEY, value)
}
