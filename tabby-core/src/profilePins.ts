/**
 * Pinned profiles, as pure logic — kept free of Angular so the fast test tier
 * can run it on a clean checkout.
 *
 * A pin is a profile id in `config.store.pinnedProfiles`, and the array's order
 * is the order pins are shown in: first pinned, first listed. Ids rather than
 * copies of the profile, which is what `recentProfiles` keeps and why a recent
 * entry goes stale when its profile is edited.
 */

interface Identified { id?: string }

/** Guards against a hand-edited config: only non-empty strings, each once. */
export function normalizePins (value: unknown): string[] {
    if (!Array.isArray(value)) {
        return []
    }
    const out: string[] = []
    for (const id of value) {
        if (typeof id === 'string' && id && !out.includes(id)) {
            out.push(id)
        }
    }
    return out
}

export function isPinned (pins: readonly string[], id: string|undefined|null): boolean {
    return !!id && pins.includes(id)
}

/** A new array either way — the config proxy only notices an assignment. */
export function withPin (pins: readonly string[], id: string): string[] {
    return pins.includes(id) ? [...pins] : [...pins, id]
}

export function withoutPin (pins: readonly string[], id: string): string[] {
    return pins.filter(x => x !== id)
}

/**
 * The pinned ones among `profiles`, in pin order. A pin whose profile is not in
 * the list (deleted, hidden, a provider that is switched off) yields nothing,
 * so a stale id never becomes an empty row.
 */
export function pinnedAmong<P extends Identified> (profiles: readonly P[], pins: readonly string[]): P[] {
    const out: P[] = []
    for (const id of pins) {
        const profile = profiles.find(x => x.id === id)
        if (profile && !out.includes(profile)) {
            out.push(profile)
        }
    }
    return out
}

/** `profiles` with the pinned ones moved to the front, the rest left in order. */
export function pinnedFirst<P extends Identified> (profiles: readonly P[], pins: readonly string[]): P[] {
    const pinned = pinnedAmong(profiles, pins)
    return [...pinned, ...profiles.filter(x => !pinned.includes(x))]
}
