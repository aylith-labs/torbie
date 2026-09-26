/**
 * The logic behind a "Select all" checkbox over a group of checkboxes, kept
 * free of Angular so the fast test tier can run it on a clean checkout.
 *
 * Three states, because two lie: a group where some boxes are ticked is
 * neither "all" nor "none", and a header box drawn as either one misreports
 * what is below it. `mixed` is what the input's `indeterminate` property shows,
 * and what assistive technology announces as aria-checked="mixed".
 */
export type SelectAllState = 'all' | 'none' | 'mixed'

/** The header's state from how many of the group's boxes are ticked. */
export function selectAllState (selected: number, total: number): SelectAllState {
    if (total <= 0 || selected <= 0) {
        return 'none'
    }
    return selected >= total ? 'all' : 'mixed'
}

/** The same, read off the boxes themselves. */
export function selectAllStateOf (values: readonly boolean[]): SelectAllState {
    return selectAllState(values.filter(x => x).length, values.length)
}

/**
 * What a click on the header does: everything on, unless everything already
 * is. A mixed group selects all rather than clearing, which is the platform
 * convention (Explorer, Gmail, macOS lists) and the safer of the two — a click
 * that wipes a hand-picked selection is the one that costs work to undo.
 */
export function selectAllTarget (state: SelectAllState): boolean {
    return state !== 'all'
}
