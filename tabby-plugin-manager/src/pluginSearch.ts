import { PluginInfo } from 'tabby-core'

/**
 * Searching and ordering the Plugins page's two lists.
 *
 * Search happens here, on the client, because the registry does not do it.
 * `-/v1/search?text=keywords:tabby-plugin tmux` returns the same 149 packages
 * as `keywords:tabby-plugin` alone, only re-ranked — measured 2026-09-12 with a
 * nonsense term, a term that names one package, and the term placed before the
 * qualifier. Only a bare `tmux` filters, and that searches all of npm. So a
 * query sent to the registry could reorder the list and never shorten it, which
 * is what "search does not work" was.
 */

/** What the registry says about a plugin beyond PluginInfo. */
export interface AvailablePluginInfo extends PluginInfo {
    isOfficial: boolean
    keywords: string[]
    /** Downloads over the last month, as the search endpoint reports them. */
    monthlyDownloads: number
    /** When the listed version was published, ISO 8601, or null. */
    published: string|null
}

/**
 * Only what the search response actually varies on. It also carries
 * `dependents` and `score.detail`, and both were useless when measured: every
 * one of 180 packages had 0 dependents and the identical score breakdown.
 */
export type AvailableSort = 'relevance'|'downloads'|'published'|'name'
/** An installed plugin carries no dates and no download counts. */
export type InstalledSort = 'name'|'thirdParty'|'disabled'

export const AVAILABLE_SORTS: readonly AvailableSort[] = ['relevance', 'downloads', 'published', 'name']
export const INSTALLED_SORTS: readonly InstalledSort[] = ['name', 'thirdParty', 'disabled']

export interface SortState {
    available: AvailableSort
    installed: InstalledSort
}

/**
 * The order each list had before it could be sorted: the registry's own score
 * for Available, the service's name order for Installed.
 */
export const DEFAULT_SORT: Readonly<SortState> = { available: 'relevance', installed: 'name' }

/** Any stored value in, a valid state out — localStorage outlives the options it was written with. */
export function parseSortState (raw: unknown): SortState {
    const stored = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
    const available = AVAILABLE_SORTS.find(x => x === stored.available)
    const installed = INSTALLED_SORTS.find(x => x === stored.installed)
    return {
        available: available ?? DEFAULT_SORT.available,
        installed: installed ?? DEFAULT_SORT.installed,
    }
}

export function queryTerms (query: string): string[] {
    return query.toLowerCase().split(/\s+/).filter(term => term.length > 0)
}

// How one term matched, best first.
const NAME_EXACT = 0
const NAME_PREFIX = 1
const NAME_CONTAINS = 2
const KEYWORD = 3
const TEXT = 4

function keywordsOf (plugin: PluginInfo): string[] {
    // An available plugin carries the registry's keywords; an installed one has
    // its package.json in `info`.
    const keywords: unknown = (plugin as Partial<AvailablePluginInfo>).keywords ?? plugin.info?.keywords
    return Array.isArray(keywords) ? keywords.filter(k => typeof k === 'string').map(k => k.toLowerCase()) : []
}

/**
 * How well a plugin matches, lower being better, or null when some term matches
 * nothing. Every term has to match somewhere, and the plugin ranks as its
 * weakest term does. No terms at all matches everything, equally.
 */
export function matchRank (plugin: PluginInfo, terms: string[]): number|null {
    if (!terms.length) {
        return NAME_EXACT
    }
    const name = plugin.name.toLowerCase()
    const packageName = plugin.packageName.toLowerCase()
    const keywords = keywordsOf(plugin)
    const text = `${plugin.description ?? ''}\n${plugin.author ?? ''}`.toLowerCase()
    let rank = NAME_EXACT
    for (const term of terms) {
        let best: number
        if (name === term) {
            best = NAME_EXACT
        } else if (name.startsWith(term)) {
            best = NAME_PREFIX
        } else if (name.includes(term) || packageName.includes(term)) {
            best = NAME_CONTAINS
        } else if (keywords.some(keyword => keyword.includes(term))) {
            best = KEYWORD
        } else if (text.includes(term)) {
            best = TEXT
        } else {
            return null
        }
        rank = Math.max(rank, best)
    }
    return rank
}

interface Ranked<T> {
    plugin: T
    rank: number
}

const publishedAt = (plugin: AvailablePluginInfo): number => (plugin.published && Date.parse(plugin.published)) || 0

// Array.prototype.sort is stable, so every tie keeps the incoming order — the
// registry's score, highest first — and relevance with no query is exactly the
// order this list has always had.
const AVAILABLE_ORDER: Record<AvailableSort, (a: Ranked<AvailablePluginInfo>, b: Ranked<AvailablePluginInfo>) => number> = {
    relevance: (a, b) => a.rank - b.rank,
    downloads: (a, b) => b.plugin.monthlyDownloads - a.plugin.monthlyDownloads,
    published: (a, b) => publishedAt(b.plugin) - publishedAt(a.plugin),
    name: (a, b) => a.plugin.name.localeCompare(b.plugin.name),
}

/** The Available list: what matches the query, in the chosen order. Never mutates its input. */
export function arrangeAvailable (plugins: readonly AvailablePluginInfo[], query: string, sort: AvailableSort): AvailablePluginInfo[] {
    const terms = queryTerms(query)
    const matched: Ranked<AvailablePluginInfo>[] = []
    for (const plugin of plugins) {
        const rank = matchRank(plugin, terms)
        if (rank !== null) {
            matched.push({ plugin, rank })
        }
    }
    return matched.sort(AVAILABLE_ORDER[sort]).map(x => x.plugin)
}

/** The Installed list: what matches the query, in the chosen order. Never mutates its input. */
export function arrangeInstalled (
    plugins: readonly PluginInfo[],
    query: string,
    sort: InstalledSort,
    isEnabled: (plugin: PluginInfo) => boolean,
): PluginInfo[] {
    const terms = queryTerms(query)
    const byName = (a: PluginInfo, b: PluginInfo) => a.name.localeCompare(b.name)
    const first = (predicate: (plugin: PluginInfo) => boolean) =>
        (a: PluginInfo, b: PluginInfo) => Number(predicate(b)) - Number(predicate(a)) || byName(a, b)
    const order: Record<InstalledSort, (a: PluginInfo, b: PluginInfo) => number> = {
        name: byName,
        thirdParty: first(plugin => !plugin.isBuiltin),
        disabled: first(plugin => !isEnabled(plugin)),
    }
    return plugins.filter(plugin => matchRank(plugin, terms) !== null).sort(order[sort])
}
