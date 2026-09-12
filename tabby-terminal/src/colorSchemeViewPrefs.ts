/**
 * How the colour scheme lists are *shown* — not what they contain.
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

/**
 * The tone filter a mode's tab opens on: that mode's own tone.
 *
 * Not stored, and that is the point. The Dark mode tab lists dark schemes every
 * time it is opened, and All or Light chosen there is an override for that
 * visit only — ngbNav destroys a tab's content when another tab is selected, so
 * the override can neither reach the Light mode tab nor survive a return to
 * this one. It used to be one remembered value shared by both tabs, which is
 * how a Light picked on the Light mode tab was still selected on the Dark one.
 */
export function toneFilterForMode (configKey: 'colorScheme' | 'lightColorScheme'): SchemeToneFilter {
    return configKey === 'lightColorScheme' ? 'light' : 'dark'
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
