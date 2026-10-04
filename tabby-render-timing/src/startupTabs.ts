/**
 * The Startup page's inner tabs, and which one it opens on.
 *
 * Which tab was last open is view state, so it lives in localStorage — which
 * can throw (blocked storage) or hold anything (an older build's value, a
 * hand edit). Both fall back to the waterfall rather than to an empty page.
 */
export type StartupTab = 'launch' | 'after' | 'history'

export const STARTUP_TABS: readonly StartupTab[] = ['launch', 'after', 'history']
export const STARTUP_TAB_KEY = 'startupSettingsTab'

export function parseStartupTab (value: unknown): StartupTab {
    return STARTUP_TABS.includes(value as StartupTab) ? value as StartupTab : 'launch'
}

export function loadStartupTab (storage: Pick<Storage, 'getItem'> | undefined): StartupTab {
    try {
        return parseStartupTab(storage?.getItem(STARTUP_TAB_KEY))
    } catch {
        return 'launch'
    }
}

export function saveStartupTab (storage: Pick<Storage, 'setItem'> | undefined, tab: StartupTab): void {
    try {
        storage?.setItem(STARTUP_TAB_KEY, tab)
    } catch {
        // View state only: a page that cannot remember its tab still works.
    }
}
