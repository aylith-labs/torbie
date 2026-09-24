import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker'

/**
 * Settings search, as pure logic: what is matched, how it is ranked, and how a
 * long description is cut down to the part that matched. No Angular and no DOM,
 * so `test/settingsSearch.test.js` runs it on a clean checkout.
 *
 * Ranking is tiered, the way VS Code's settings search and cmdk's command-score
 * are, rather than one fuzzy number: an exact field beats a prefix, which beats
 * a match at a word start, which beats one inside a word, which beats a
 * subsequence. Only the subsequence tier is scored continuously (fzf-style:
 * consecutive characters and word starts earn, gaps cost), so a scattered
 * fuzzy hit can never outrank a real substring. Within a tier the field decides
 * — page title, page description, section, setting title, setting description —
 * and a shorter field wins a tie, so "Shell" the page beats "Shell integration".
 */

export type SettingsSearchKind = 'tab' | 'section' | 'setting'

/** Where the search jumps to. Text plus an ordinal among equal text, never a DOM path. */
export interface SettingsSearchLocator {
    /** Index of the `.accordion-item` holding the element on its page, or -1. */
    accordion: number
    /** Which of the elements with the same kind and text, in document order within that scope. */
    dup: number
    /** The label of the page's own inner tab (Builds → Options) the element is on, if not the first. */
    innerTab?: string
}

export interface SettingsSearchEntry {
    kind: SettingsSearchKind
    tabId: string
    tabTitle: string
    tabDescription?: string
    /** The nav section the page is listed under ("Terminal", "Claude"). */
    group?: string
    /** The heading a setting sits under, or a section entry's own heading. */
    section?: string
    /** The setting's title; for a tab or section, the same text as `tabTitle` / `section`. */
    title: string
    description?: string
    locator?: SettingsSearchLocator
    /** Nav order of the page, then document order within it. Breaks score ties. */
    order: number
}

export interface MatchRange {
    start: number
    /** Exclusive. */
    end: number
}

export type SettingsSearchField = 'tabTitle' | 'tabDescription' | 'group' | 'section' | 'title' | 'description'

export interface SettingsSearchResult {
    entry: SettingsSearchEntry
    score: number
    /** Ranges to highlight, per field, merged and sorted. */
    highlights: Partial<Record<SettingsSearchField, MatchRange[]>>
    /** Some term was found only as a subsequence. */
    fuzzy: boolean
}

/** Match tiers. Each is far enough from the next that no bonus crosses it. */
export const TIER = {
    exact: 1000,
    prefix: 900,
    wordStart: 800,
    substring: 600,
    fuzzy: 300,
} as const

/**
 * How much each field counts. A page outranks a setting at the same kind of
 * field — page title over setting title, page description over setting
 * description — a setting outranks the section heading it sits under, and
 * any title outranks any description: "update" should find
 * Automatic Updates before the page whose summary mentions updates. The gaps are
 * small, so a better match tier always wins over a better field.
 */
const FIELD_WEIGHT: Record<SettingsSearchField, number> = {
    tabTitle: 1,
    title: 0.95,
    section: 0.93,
    tabDescription: 0.9,
    description: 0.85,
    group: 0.6,
}

/**
 * A term that only matches a setting's surroundings — its page or section —
 * counts for this much. "terminal font" should find the font setting on the
 * Terminal page, but "terminal" alone should find the page, not all 22 rows on it.
 */
const CONTEXT_WEIGHT = 0.4

/** Subsequence matching is for short names; in a sentence almost anything is a subsequence. */
const FUZZY_FIELDS: SettingsSearchField[] = ['tabTitle', 'section', 'title']

const KIND_ORDER: Record<SettingsSearchKind, number> = { tab: 0, section: 1, setting: 2 }

/**
 * Page descriptions for the pages this app knows, by provider id, so no provider
 * file has to change (the same reason `settingsGroups.ts` places pages by id).
 * A plugin's own `SettingsTabProvider.description` wins over this table.
 */
export const SETTINGS_PAGE_DESCRIPTIONS: Record<string, string> = {
    'application': _('Language, updates, shell integration, debugging and accessibility'),
    'window': _('Theme, tabs, docking, window frame, fonts and the accent colour'),
    'hotkeys': _('Keyboard shortcuts for every command'),
    'terminal': _('Terminal behaviour: scrollback, clipboard, bell, mouse and sessions'),
    'terminal-appearance': _('Terminal font, cursor, ligatures and padding'),
    'terminal-color-scheme': _('Terminal colour schemes for light and dark mode'),
    'terminal-shell': _('Default shell and working directory'),
    'resume': _('Bring back what each pane was running after a restart'),
    'profiles': _('Profiles, groups and how new tabs start'),
    'ssh': _('SSH connections, agents, keys and X11 forwarding'),
    'vault': _('Encrypted storage for passwords and keys'),
    'link-tooltip': _('Link detection, hover cards and the preview pane'),
    'integrations': _('Accounts for GitHub, Jira, Slack and other rich links'),
    'claude': _('Claude Code sessions panel, status and pane focusing'),
    'plugins': _('Install, update and remove plugins'),
    'builds': _('Local builds of this app, slots and the active build'),
    'upstream': _('What upstream Tabby has that this fork does not, and fork marks'),
    'config-sync': _('Sync the configuration file across machines'),
    'config-file': _('Edit the raw configuration file'),
}

/**
 * Lowercase and strip diacritics one character at a time, so every index into
 * the folded string is an index into the original. `'İ'.toLowerCase()` is two
 * characters, which would shift every highlight after it.
 */
export function foldForSearch (text: string): string {
    let out = ''
    for (const ch of text) {
        // `for…of` walks code points; a surrogate pair is kept as it is so the
        // folded string stays the same length as the original.
        if (ch.length !== 1) {
            out += ch
            continue
        }
        let folded = ch.normalize('NFD')[0].toLowerCase()
        if (folded.length !== 1) {
            folded = ch
        }
        out += folded
    }
    return out
}

function isWordChar (ch: string | undefined): boolean {
    return !!ch && /[\p{L}\p{N}]/u.test(ch)
}

/** A word starts after a non-word character, or at a lower-to-upper case change (`fontSize`). */
function isWordStart (original: string, index: number): boolean {
    if (index === 0) {
        return true
    }
    const prev = original[index - 1]
    const cur = original[index]
    if (!isWordChar(prev)) {
        return true
    }
    return prev === prev.toLowerCase() && prev !== prev.toUpperCase() && cur !== cur.toLowerCase()
}

export interface TermMatch {
    score: number
    ranges: MatchRange[]
    /** Found only as a subsequence. */
    fuzzy?: boolean
}

/**
 * Best match of one folded term in one field. Null when it does not occur.
 * `allowFuzzy` turns on the subsequence tier.
 */
export function matchTerm (term: string, text: string, allowFuzzy: boolean): TermMatch | null {
    if (!term || !text) {
        return null
    }
    const folded = foldForSearch(text)
    const tightness = (term.length / Math.max(folded.length, 1)) * 50

    if (folded === term) {
        return { score: TIER.exact + 50, ranges: [{ start: 0, end: text.length }] }
    }
    let index = folded.indexOf(term)
    if (index === 0) {
        return { score: TIER.prefix + tightness, ranges: [{ start: 0, end: term.length }] }
    }
    let first = -1
    while (index !== -1) {
        if (first === -1) {
            first = index
        }
        if (isWordStart(text, index)) {
            // An earlier word scores a little higher than a later one.
            const early = 20 * (1 - index / Math.max(folded.length, 1))
            return { score: TIER.wordStart + tightness + early, ranges: [{ start: index, end: index + term.length }] }
        }
        index = folded.indexOf(term, index + 1)
    }
    if (first !== -1) {
        const early = 20 * (1 - first / Math.max(folded.length, 1))
        return { score: TIER.substring + tightness + early, ranges: [{ start: first, end: first + term.length }] }
    }
    if (allowFuzzy && term.length >= 2) {
        return fuzzyMatch(term, text, folded)
    }
    return null
}

/**
 * fzf-style subsequence alignment: dynamic programming over (term char, text
 * char), where a matched character earns more at a word start and more again
 * when it continues the previous match, and a gap costs. Returns the best
 * alignment's positions, so the highlight shows the characters that matched.
 */
function fuzzyMatch (term: string, text: string, folded: string): TermMatch | null {
    const n = term.length
    const m = folded.length
    if (n > m || m > 120) {
        return null
    }
    const NEG = -1e9
    // score[i][j]: best score with term[0..i] matched and term[i] at text[j].
    const score: number[][] = []
    const from: number[][] = []
    for (let i = 0; i < n; i++) {
        score.push(new Array(m).fill(NEG))
        from.push(new Array(m).fill(-1))
    }
    const charScore = (j: number) => isWordStart(text, j) ? 8 : 2
    for (let j = 0; j < m; j++) {
        if (folded[j] === term[0]) {
            score[0][j] = charScore(j) + (j === 0 ? 4 : 0) - Math.min(j, 10) * 0.2
        }
    }
    for (let i = 1; i < n; i++) {
        let best = NEG
        let bestAt = -1
        for (let j = i; j < m; j++) {
            // Best predecessor strictly before j, with a gap penalty.
            const k = j - 1
            if (score[i - 1][k] > NEG) {
                const gapFree = score[i - 1][k]
                if (gapFree > best) {
                    best = gapFree
                    bestAt = k
                }
            }
            if (folded[j] === term[i]) {
                const consecutive = score[i - 1][j - 1] > NEG ? score[i - 1][j - 1] + charScore(j) + 6 : NEG
                const gapped = bestAt >= 0 ? best + charScore(j) - Math.min(j - bestAt - 1, 12) * 0.5 - 1.5 : NEG
                if (consecutive >= gapped && consecutive > NEG) {
                    score[i][j] = consecutive
                    from[i][j] = j - 1
                } else if (gapped > NEG) {
                    score[i][j] = gapped
                    from[i][j] = bestAt
                }
            }
        }
    }
    let end = -1
    let top = NEG
    for (let j = 0; j < m; j++) {
        if (score[n - 1][j] > top) {
            top = score[n - 1][j]
            end = j
        }
    }
    if (end === -1) {
        return null
    }
    const positions: number[] = []
    for (let i = n - 1, j = end; i >= 0; i--) {
        positions.unshift(j)
        j = from[i][j]
    }
    // A match spread across the whole of a long name is noise, not a find.
    const span = positions[positions.length - 1] - positions[0] + 1
    if (span > n * 3 + 3) {
        return null
    }
    // It has to start where a word does ("hky" in Hotkeys, "cfs" in Config
    // sync), and come in a few pieces rather than one letter at a time.
    if (!isWordStart(text, positions[0])) {
        return null
    }
    let runs = 1
    for (let i = 1; i < positions.length; i++) {
        if (positions[i] !== positions[i - 1] + 1) {
            runs++
        }
    }
    if (runs > Math.max(3, Math.ceil(n / 2))) {
        return null
    }
    // Best possible per character is a consecutive word start: 8 + 6.
    const quality = Math.max(0, Math.min(1, top / (n * 14)))
    if (quality < 0.2) {
        return null
    }
    return { score: TIER.fuzzy + quality * 200, ranges: mergeRanges(positions.map(p => ({ start: p, end: p + 1 }))), fuzzy: true }
}

export function mergeRanges (ranges: MatchRange[]): MatchRange[] {
    const sorted = ranges.filter(r => r.end > r.start).sort((a, b) => a.start - b.start || a.end - b.end)
    const out: MatchRange[] = []
    for (const r of sorted) {
        const last = out[out.length - 1]
        if (last && r.start <= last.end) {
            last.end = Math.max(last.end, r.end)
        } else {
            out.push({ ...r })
        }
    }
    return out
}

/** The fields an entry is found by (its own), and the ones that only describe where it is. */
function fieldsOf (entry: SettingsSearchEntry): { own: SettingsSearchField[], context: SettingsSearchField[] } {
    switch (entry.kind) {
        case 'tab':
            return { own: ['tabTitle', 'tabDescription', 'group'], context: [] }
        case 'section':
            return { own: ['section'], context: ['tabTitle'] }
        default:
            return { own: ['title', 'description'], context: ['section', 'tabTitle'] }
    }
}

function fieldText (entry: SettingsSearchEntry, field: SettingsSearchField): string | undefined {
    switch (field) {
        case 'tabTitle': return entry.tabTitle
        case 'tabDescription': return entry.tabDescription
        case 'group': return entry.group
        case 'section': return entry.section
        case 'title': return entry.title
        case 'description': return entry.description
    }
}

export function splitQuery (query: string): string[] {
    return foldForSearch(query).split(/\s+/).filter(Boolean)
}

/** Score one entry against the query's terms. Null when it does not match. */
export function scoreEntry (entry: SettingsSearchEntry, terms: string[], phrase?: string): SettingsSearchResult | null {
    if (!terms.length) {
        return null
    }
    const { own, context } = fieldsOf(entry)
    const highlights: SettingsSearchResult['highlights'] = {}
    let total = 0
    let ownHits = 0
    let fuzzy = false

    for (const term of terms) {
        let best: { score: number, field: SettingsSearchField, match: TermMatch } | null = null
        for (const field of [...own, ...context]) {
            const text = fieldText(entry, field)
            if (!text) {
                continue
            }
            const match = matchTerm(term, text, FUZZY_FIELDS.includes(field))
            if (!match) {
                continue
            }
            const weight = own.includes(field) ? FIELD_WEIGHT[field] : FIELD_WEIGHT[field] * CONTEXT_WEIGHT
            const score = match.score * weight
            if (!best || score > best.score) {
                best = { score, field, match }
            }
        }
        if (!best) {
            return null
        }
        if (own.includes(best.field)) {
            ownHits++
        }
        total += best.score
        fuzzy ||= !!best.match.fuzzy
        highlights[best.field] = [...highlights[best.field] ?? [], ...best.match.ranges]
        // The score comes from the best field, but the reader looks at all of
        // them: "update" should light up in the description of Automatic
        // Updates as well as in its title.
        for (const field of [...own, ...context]) {
            const text = field === best.field ? undefined : fieldText(entry, field)
            const plain = text ? matchTerm(term, text, false) : null
            if (plain) {
                highlights[field] = [...highlights[field] ?? [], ...plain.ranges]
            }
        }
    }
    // Something about the entry itself has to match, or every row on a page
    // would come back for the page's name.
    if (!ownHits) {
        return null
    }

    let score = total / terms.length
    // The whole query, spaces and all, in one of the entry's own fields.
    if (phrase && terms.length > 1) {
        for (const field of own) {
            const text = fieldText(entry, field)
            const index = text ? foldForSearch(text).indexOf(phrase) : -1
            if (index !== -1) {
                score += 100 * FIELD_WEIGHT[field]
                highlights[field] = [...highlights[field] ?? [], { start: index, end: index + phrase.length }]
                break
            }
        }
    }
    for (const key of Object.keys(highlights) as SettingsSearchField[]) {
        highlights[key] = mergeRanges(highlights[key]!)
    }
    return { entry, score, highlights, fuzzy }
}

export function searchSettings (entries: SettingsSearchEntry[], query: string, limit = 60): SettingsSearchResult[] {
    const terms = splitQuery(query)
    if (!terms.length) {
        return []
    }
    const phrase = foldForSearch(query.trim()).replace(/\s+/g, ' ')
    let results: SettingsSearchResult[] = []
    for (const entry of entries) {
        const result = scoreEntry(entry, terms, phrase)
        if (result) {
            results.push(result)
        }
    }
    // Subsequence matches are a fallback, as in VS Code's settings search:
    // "clau" finding "The pin currently launches" is noise beside the Claude
    // page, and only worth showing when nothing matches more plainly.
    if (results.some(r => !r.fuzzy)) {
        results = results.filter(r => !r.fuzzy)
    }
    results.sort((a, b) => b.score - a.score
        || KIND_ORDER[a.entry.kind] - KIND_ORDER[b.entry.kind]
        || a.entry.order - b.entry.order)
    return results.slice(0, limit)
}

export interface SnippetSegment {
    text: string
    match: boolean
}

export interface Snippet {
    segments: SnippetSegment[]
    /** Text was cut before the start; draw a leading ellipsis. */
    leading: boolean
    /** Text was cut after the end; draw a trailing ellipsis. */
    trailing: boolean
}

/**
 * Cut `text` to at most `max` characters around its first match, centred on it
 * and moved to word boundaries where that costs little, and split it into
 * highlighted and plain runs. With no match it keeps the start.
 */
export function makeSnippet (text: string, ranges: MatchRange[] = [], max = 110): Snippet {
    const merged = mergeRanges(ranges).filter(r => r.start < text.length)
    let start = 0
    let end = text.length
    if (text.length > max) {
        const anchor = merged[0]
        if (!anchor) {
            end = max
        } else {
            // Keep the whole of the first match, even when it alone is longer than max.
            const matchLength = Math.min(anchor.end, text.length) - anchor.start
            const room = Math.max(max - matchLength, 0)
            start = Math.max(0, anchor.start - Math.floor(room / 2))
            end = Math.min(text.length, start + Math.max(max, matchLength))
            start = Math.max(0, Math.min(start, end - max))
        }
        // Snap inward to a word boundary if one is close and it keeps the match.
        const slack = Math.min(14, Math.floor(max / 6))
        if (start > 0) {
            const space = text.indexOf(' ', start)
            const limit = merged[0] ? merged[0].start : end
            if (space !== -1 && space - start <= slack && space < limit) {
                start = space + 1
            }
        }
        if (end < text.length) {
            const space = text.lastIndexOf(' ', end)
            const limit = merged[0] ? Math.min(merged[0].end, text.length) : start
            if (space !== -1 && end - space <= slack && space >= limit) {
                end = space
            }
        }
    }

    const segments: SnippetSegment[] = []
    let cursor = start
    for (const r of merged) {
        const s = Math.max(r.start, start)
        const e = Math.min(r.end, end)
        if (e <= s) {
            continue
        }
        if (s > cursor) {
            segments.push({ text: text.slice(cursor, s), match: false })
        }
        segments.push({ text: text.slice(s, e), match: true })
        cursor = e
    }
    if (cursor < end) {
        segments.push({ text: text.slice(cursor, end), match: false })
    }
    // Trim the cut edges so the ellipsis sits against a character, not a space.
    if (start > 0 && segments.length && !segments[0].match) {
        segments[0].text = segments[0].text.replace(/^\s+/, '')
    }
    const last = segments[segments.length - 1]
    if (end < text.length && last && !last.match) {
        last.text = last.text.replace(/[\s,;:.]+$/, '')
    }
    return {
        segments: segments.filter(s => s.text.length),
        leading: start > 0,
        trailing: end < text.length,
    }
}
