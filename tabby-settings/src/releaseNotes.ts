/**
 * What a release changed, as pure logic: no Angular, no network.
 *
 * GitHub's generated release body is almost always empty here — a "Full
 * Changelog" link, plus Dependabot's bumps when there were any — so the page
 * reads the commits between a release and the one before it instead, and
 * groups their conventional-commit subjects into what a reader cares about.
 */

export interface ReleaseCommit {
    sha: string
    subject: string
}

export interface ChangeEntry {
    sha: string
    scope: string|null
    text: string
    breaking: boolean
}

export type ChangeGroupId = 'feat' | 'fix' | 'perf' | 'internal' | 'deps'

export interface ChangeGroup {
    id: ChangeGroupId
    title: string
    icon: string
    /** Shown open; the rest start collapsed behind their count. */
    prominent: boolean
    entries: ChangeEntry[]
}

const GROUPS: Omit<ChangeGroup, 'entries'>[] = [
    { id: 'feat', title: 'New', icon: 'fas fa-star', prominent: true },
    { id: 'fix', title: 'Fixed', icon: 'fas fa-wrench', prominent: true },
    { id: 'perf', title: 'Faster', icon: 'fas fa-bolt', prominent: true },
    { id: 'internal', title: 'Under the hood', icon: 'fas fa-cog', prominent: false },
    { id: 'deps', title: 'Dependencies', icon: 'fas fa-cube', prominent: false },
]

const CONVENTIONAL = /^([a-zA-Z]+)(?:\(([^)]*)\))?(!)?:\s*(.+)$/

/** A commit that says nothing about the product: merges and the release bump itself. */
export function isNoise (subject: string): boolean {
    return /^Merge (branch|remote-tracking branch|pull request)\b/.test(subject)
        || /^chore\(release\)/.test(subject)
}

export function parseCommit (commit: ReleaseCommit): { group: ChangeGroupId, entry: ChangeEntry } {
    const subject = commit.subject.split('\n')[0].trim()
    const m = CONVENTIONAL.exec(subject)
    if (!m) {
        return { group: 'internal', entry: { sha: commit.sha, scope: null, text: subject, breaking: false } }
    }
    const [, rawType, rawScope, bang, rawText] = m
    const type = rawType.toLowerCase()
    const scope = rawScope?.trim() || null
    const entry: ChangeEntry = {
        sha: commit.sha,
        scope,
        text: capitalize(rawText.trim()),
        breaking: !!bang,
    }
    if (type === 'build' && scope?.startsWith('deps')) {
        return { group: 'deps', entry: { ...entry, scope: null } }
    }
    const group: ChangeGroupId = type === 'feat' || type === 'fix' || type === 'perf' ? type : 'internal'
    return { group, entry }
}

/** Commits newest first, as the compare API's are reversed; empty groups dropped. */
export function groupCommits (commits: ReleaseCommit[]): ChangeGroup[] {
    const buckets = new Map<ChangeGroupId, ChangeEntry[]>()
    for (const commit of [...commits].reverse()) {
        if (isNoise(commit.subject)) {
            continue
        }
        const { group, entry } = parseCommit(commit)
        if (!buckets.has(group)) {
            buckets.set(group, [])
        }
        buckets.get(group)!.push(entry)
    }
    return GROUPS
        .map(g => ({ ...g, entries: buckets.get(g.id) ?? [] }))
        .filter(g => g.entries.length)
}

/** "2 new · 3 fixes · 14 under the hood" — the line a collapsed release shows. */
export function summarizeGroups (groups: ChangeGroup[]): string {
    const words: Record<ChangeGroupId, [string, string]> = {
        feat: ['new', 'new'],
        fix: ['fix', 'fixes'],
        perf: ['speed-up', 'speed-ups'],
        internal: ['internal', 'internal'],
        deps: ['dependency update', 'dependency updates'],
    }
    return groups
        .map(g => `${g.entries.length} ${words[g.id][g.entries.length === 1 ? 0 : 1]}`)
        .join(' · ')
}

/**
 * The hand-written part of a release body, if there is one. GitHub's
 * generated sections — What's Changed, New Contributors, Full Changelog —
 * are dropped, because the commit list says the same thing better.
 */
export function handwrittenBody (body: string|null|undefined): string {
    if (!body) {
        return ''
    }
    const out: string[] = []
    let skipping = false
    for (const line of body.replace(/\r\n/g, '\n').split('\n')) {
        const heading = /^#{1,6}\s+(.*)$/.exec(line)
        if (heading) {
            skipping = /^(what'?s changed|new contributors)\s*$/i.test(heading[1].trim())
            if (skipping) {
                continue
            }
        }
        if (/^\s*\*\*Full Changelog\*\*/i.test(line)) {
            continue
        }
        if (skipping) {
            continue
        }
        out.push(line)
    }
    return out.join('\n').trim()
}

/** "today", "yesterday", "3 days ago", "5 weeks ago", "2 months ago". */
export function relativeDay (date: Date, now: Date = new Date()): string {
    const day = 24 * 60 * 60 * 1000
    const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
    const days = Math.round((startOf(now) - startOf(date)) / day)
    if (days <= 0) {
        return 'today'
    }
    if (days === 1) {
        return 'yesterday'
    }
    if (days < 14) {
        return `${days} days ago`
    }
    if (days < 60) {
        return `${Math.round(days / 7)} weeks ago`
    }
    if (days < 365 * 2) {
        return `${Math.round(days / 30)} months ago`
    }
    return `${Math.round(days / 365)} years ago`
}

/** `v1.0.5` and `1.0.5-nightly.3` are the same release line; compare the core. */
export function sameVersion (tag: string, appVersion: string|null|undefined): boolean {
    if (!appVersion) {
        return false
    }
    const core = (v: string) => v.replace(/^v/, '').split(/[-+]/)[0]
    return core(tag) === core(appVersion)
}

function capitalize (s: string): string {
    return s ? s[0].toUpperCase() + s.slice(1) : s
}
