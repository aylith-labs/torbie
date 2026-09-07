import { LinkTooltipRule } from './api'
import { matchesFileType } from './fileTypes'
import { GuardedRegex, MAX_TEXT_INPUT } from './regexGuard'
import { schemeOf } from './services/linkRules.service'

/**
 * Running a rule against a line of sample text, exactly as the terminal would.
 *
 * The rule editor used to restate the regex and nothing else, so the only way
 * to find out whether a rule worked was to make the terminal print something it
 * should match. This answers the same question in the editor.
 *
 * **Fidelity is the whole point.** A preview that claims a match the terminal
 * would refuse is worse than no preview, so this reproduces the live decision
 * rather than approximating it — the same construction, the same guard, the
 * same flags and caps, and the same criteria beyond the pattern.
 */

/** One run the rule found, and what its capture groups came out as. */
export interface ProbeSpan {
    start: number
    end: number
    text: string
    groups: Record<string, string | undefined>
}

export interface RuleProbe {
    /** Empty when the pattern compiles and passes the ReDoS guard. */
    error: string
    /** Matched runs, as offsets into the sample actually scanned. */
    spans: ProbeSpan[]
    /**
     * Set when the pattern matched but some other criterion refused, so the
     * card would still not appear. Naming it is the difference between "your
     * regex is wrong" and "your scheme list excludes this".
     */
    rejectedBy: '' | 'scheme' | 'fileType'
    /** The sample was longer than the terminal would ever hand a rule. */
    truncated: boolean
    /** How much of the sample was scanned. */
    scanned: string
}

/**
 * A `link` rule is asked about one whole link, a `text` rule scans a line — so
 * they differ in flags, in how many matches are wanted, and in whether the
 * length cap applies. Both are what `LinkRulesService` does live.
 */
export function probeRule (rule: LinkTooltipRule, sample: string, resolvedPath = ''): RuleProbe {
    const out: RuleProbe = {
        error: '', spans: [], rejectedBy: '', truncated: false, scanned: sample,
    }
    if (!sample) {
        return out
    }

    const isText = rule.match === 'text'
    if (isText) {
        // `decorator.ts` never offers a rule more than this much of a line.
        out.scanned = sample.slice(0, MAX_TEXT_INPUT)
        out.truncated = sample.length > MAX_TEXT_INPUT
    }

    if (!rule.pattern) {
        // A rule with no pattern matches on its other criteria alone; there is
        // nothing to highlight, which is not an error.
        return out
    }

    // Its own instance, never `LinkRulesService`'s. That one memoises into a
    // shared cache and is wired to disable the rule and raise a notification
    // when a pattern runs long — which, driven from a box someone is typing in,
    // would disable their rule for the session and toast on every keystroke.
    // `host` is null and nothing is cached, so a slow pattern here costs one
    // budgeted run and no side effects. The guard itself is not optional: the
    // constructor runs `checkPattern` whatever the caller wants.
    const regex = new GuardedRegex(rule.pattern, isText ? 'g' : 'i', 'rule preview', null)
    if (!regex.usable) {
        out.error = regex.error || 'This pattern cannot be used'
        return out
    }

    // Same limits as the live path: a text rule takes up to 32 matches per
    // line, a link rule only ever asks whether the one link matches.
    const matches = regex.execAll(out.scanned, isText ? 32 : 1)
    for (const match of matches) {
        out.spans.push({
            start: match.index,
            end: match.index + match[0].length,
            text: match[0],
            groups: { ...match.groups ?? {} },
        })
    }
    if (!out.spans.length) {
        return out
    }

    // A `link` rule ANDs two more criteria, and a preview that showed only the
    // pattern would claim a match the terminal refuses — the exact failure this
    // exists to prevent.
    if (!isText) {
        const schemes = rule.schemes.map(x => x.trim().toLowerCase()).filter(x => x)
        if (schemes.length && !schemes.includes(schemeOf(sample))) {
            out.rejectedBy = 'scheme'
            return out
        }
        if (rule.fileTypeGroup !== 'none' || rule.extensions.length) {
            // Only meaningful for something that resolves to a file. In the
            // editor there is no resolved path, so the sample stands in for it.
            const path = resolvedPath || sample
            if (!matchesFileType(path, rule.fileTypeGroup, rule.extensions)) {
                out.rejectedBy = 'fileType'
            }
        }
    }
    return out
}

/** One piece of the sample, for rendering: either matched or not. */
export interface ProbeSegment {
    text: string
    hit: boolean
}

/**
 * Cut the scanned sample into alternating plain and matched runs.
 *
 * Done here rather than in the template so the renderer is a single `*ngFor`
 * over data, and so the exact text of every segment is testable.
 *
 * That single `*ngFor` is also what sidesteps the whitespace hazard the Windows
 * Terminal fork hit: pug is compiled with `pretty: true`, so indentation between
 * two *literal* sibling elements becomes a real space in the rendered text — but
 * Angular inserts nothing between repeated instances of one element. Measured
 * both ways in `ruleEditor.cdp.js`; the sample renders character for character.
 */
export function probeSegments (probe: RuleProbe): ProbeSegment[] {
    const segments: ProbeSegment[] = []
    let cursor = 0
    for (const span of probe.spans) {
        if (span.start > cursor) {
            segments.push({ text: probe.scanned.slice(cursor, span.start), hit: false })
        }
        segments.push({ text: probe.scanned.slice(span.start, span.end), hit: true })
        cursor = span.end
    }
    if (cursor < probe.scanned.length) {
        segments.push({ text: probe.scanned.slice(cursor), hit: false })
    }
    return segments
}

/** The named captures across every span, flattened for display. */
export function probeCaptures (probe: RuleProbe): { name: string, value: string }[] {
    const out: { name: string, value: string }[] = []
    const seen = new Set<string>()
    for (const span of probe.spans) {
        for (const [name, value] of Object.entries(span.groups)) {
            // A group that did not participate in the match is `undefined`, and
            // showing it as blank is more honest than hiding it: the manifest
            // reads it by name either way.
            const key = `${name}=${value ?? ''}`
            if (!seen.has(key)) {
                seen.add(key)
                out.push({ name, value: value ?? '' })
            }
        }
    }
    return out
}
