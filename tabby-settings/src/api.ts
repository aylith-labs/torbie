/**
 * Extend to add your own settings tabs
 */
export abstract class SettingsTabProvider {
    id: string
    icon: string
    title: string
    weight = 0
    prioritized = false
    /**
     * Drop the 600px reading-width cap for this tab. For a settings form that
     * cap is the point; for a tab that shows data — a table, a wide list — it
     * just throws the width away.
     */
    wide = false
    /**
     * Whether this whole page is one the fork added.
     *
     * The mark then goes on the nav entry once, rather than on every row of a
     * page where every row is ours — six such pages carry about 85 rows between
     * them, and marking all of them would be noise rather than information.
     */
    forkAdded = false

    getComponentType (): any {
        return null
    }
}
