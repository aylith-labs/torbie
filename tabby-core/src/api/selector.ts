/**
 * A button on a selector row that acts on the row without choosing it — the
 * selector stays open.
 */
export interface SelectorOptionAction<T> {
    /** A Font Awesome class. */
    icon: string
    title: string
    /** Ctrl (or Cmd) + this key runs the action on the selected row. */
    key?: string
    /** Returning a list replaces the selector's options with it. */
    callback: () => SelectorOption<T>[]|void|Promise<SelectorOption<T>[]|void>
}

export interface SelectorOption<T> {
    name: string
    description?: string
    group?: string
    result?: T
    icon?: string
    freeInputPattern?: string
    freeInputEquivalent?: string
    color?: string
    weight?: number
    callback?: (string?) => void
    actions?: SelectorOptionAction<T>[]
}
