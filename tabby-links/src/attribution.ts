import { LinkTooltipRule } from './api'

/**
 * Naming the rule a hover card came from.
 *
 * The card already knows which rule produced it — `EffectiveTooltipSettings`
 * has carried `rule` all along — and used to throw it away, so "why is this
 * link not previewed the way I set it up" had no answer anywhere in the UI.
 *
 * Pure, and taking the index rather than looking it up, so the whole decision
 * is testable without an app.
 */

/** What the card should say, and whether it can open anything. */
export interface RuleAttribution {
    text: string
    /** Position in `linkTooltip.rules`, or -1 when there is nothing to open. */
    index: number
    /** Checked against the index at open time, since rules can be edited meanwhile. */
    name: string
}

export const NO_RULE = 'No rule matched'
export const UNNAMED_RULE = 'Unnamed rule'

export function ruleAttribution (
    rule: LinkTooltipRule | null,
    /** Where the rule sits in the stored list; -1 if it is not in it. */
    index: number,
    /** Whether this is a synthetic rule built from an integration's `detectPatterns`. */
    synthetic: boolean,
    /** The integration's display name, for the synthetic case. */
    integrationName: string,
): RuleAttribution {
    if (!rule) {
        // The useful half. The defaults applied, which is exactly what someone
        // who wrote a rule and expected it to fire needs to be told.
        return { text: NO_RULE, index: -1, name: '' }
    }
    if (synthetic) {
        // An integration's own `detectPatterns`. It is a rule in the matching
        // pool but not in anyone's rule list, so there is no editor to open —
        // and calling it "no rule matched" would be untrue.
        const who = integrationName || rule.integration || 'unknown'
        return { text: `Detected by the ${who} integration`, index: -1, name: '' }
    }
    const name = rule.name || UNNAMED_RULE
    // A rule that is not in the stored list was deleted while the card was up.
    // Still worth naming; not worth offering to open.
    return { text: `Matched by ${name}`, index, name: rule.name }
}

/**
 * Find the rule a card asked to open.
 *
 * Index first, because it is exact at the moment the card was built; the name
 * as a check, because the settings can be edited while a card is up. Failing
 * both, `null` — which lands on the rules list rather than opening some
 * unrelated rule that has since moved into that slot.
 */
export function resolveRuleTarget (
    rules: LinkTooltipRule[],
    target: { index: number, name: string },
): LinkTooltipRule | null {
    // Bounds-checked explicitly: the index comes from a card that was built
    // against a list which may since have shrunk, and TypeScript types an array
    // read as always present.
    const atIndex = target.index >= 0 && target.index < rules.length ? rules[target.index] : null
    if (atIndex && atIndex.name === target.name) {
        return atIndex
    }
    // The list moved under us. A name is not unique and is not required, so
    // this is a best effort and an empty name is not searched for at all.
    if (target.name) {
        return rules.find(rule => rule.name === target.name) ?? null
    }
    return null
}
