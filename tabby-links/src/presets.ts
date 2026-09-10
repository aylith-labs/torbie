import { presetCatalog } from './presets.generated'
import { IntegrationManifest, IntegrationMatcher, LinkFileTypeGroup, LinkMatchKind, LinkTooltipRule, newRule } from './api'

/**
 * Preset metadata is generated from Lintel's canonical catalog. Integration
 * patterns are selected from installed manifests by example, requiring exactly
 * one match. Run Lintel's sync-presets.mjs to update both hosts together.
 */

export interface RulePreset {
    id: string
    /** Menu label. */
    name: string
    /** One line under it, and the item's tooltip. */
    description: string
    match: LinkMatchKind
    schemes: string[]
    pattern: string
    fileTypeGroup: LinkFileTypeGroup
    extensions: string[]
    integration: string
    preview: boolean
    /**
     * A string this preset claims to match: the URI or text for a pattern, a
     * file name for a file-type preset. It selects the manifest matcher, and it
     * is what the test holds the preset to.
     */
    example: string
}

export function matcherForExample (
    matchers: IntegrationMatcher[],
    kind: LinkMatchKind,
    example: string,
): IntegrationMatcher | null {
    const claimed = matchers.filter(matcher => {
        if ((matcher.kind ?? 'link') !== kind || !matcher.pattern) {
            return false
        }
        try {
            return new RegExp(matcher.pattern).test(example)
        } catch {
            return false
        }
    })
    return claimed.length === 1 ? claimed[0] : null
}

/** What the integration presets need from an integration, and no more. */
export interface PresetIntegration {
    id: string
    name: string
    manifest: IntegrationManifest
}

/**
 * Every preset on offer, given the integrations that are installed.
 *
 * Built-in manifests are always present, so the manifest-backed presets are
 * always there in practice; a user manifest is never asked for one, because a
 * preset needs a name and a description this file has no way to invent.
 */
export function rulePresets (integrations: PresetIntegration[]): RulePreset[] {
    const out: RulePreset[] = []
    for (const entry of presetCatalog) {
        const p = entry as { id: string, integration: string, label: string, description: string, match: LinkMatchKind, example: string, preview: boolean, pattern?: string, schemes?: readonly string[], fileTypeGroup?: LinkFileTypeGroup, extensions?: readonly string[] }
        const integration = integrations.find(x => x.id === p.integration)
        const matcher = integration ? matcherForExample(integration.manifest.matchers ?? [], p.match, p.example) : null
        if (p.integration && !matcher) continue
        out.push({
            id: p.id,
            name: integration ? `${integration.name}: ${matcher?.description || p.label}` : p.label,
            description: p.description,
            match: p.match,
            schemes: [...(p.schemes ?? [])],
            pattern: matcher?.pattern ?? p.pattern ?? '',
            fileTypeGroup: p.fileTypeGroup ?? 'none',
            extensions: [...(p.extensions ?? [])],
            integration: p.integration,
            preview: p.preview,
            example: p.example,
        })
    }
    return out
}

/**
 * Write a preset over a rule — a fresh one by default.
 *
 * Everything the preset describes is replaced, and the overrides and button
 * suppression go back to "inherit", because a preset is an answer to *what to
 * match*, not to how long the card should wait. Custom actions are left alone:
 * they are the one thing on a rule that is unambiguously the user's own work,
 * and silently dropping them would make "apply preset" a destructive click.
 *
 * The arrays are copied. Two rules made from one preset must not share a
 * `schemes` array — editing one would edit the other, and the config file would
 * be written with a YAML anchor pointing at it.
 */
export function applyPreset (preset: RulePreset, rule: LinkTooltipRule = newRule()): LinkTooltipRule {
    rule.name = preset.name
    rule.enabled = true
    rule.match = preset.match
    rule.schemes = [...preset.schemes]
    rule.pattern = preset.pattern
    rule.fileTypeGroup = preset.fileTypeGroup
    rule.extensions = [...preset.extensions]
    rule.integration = preset.integration
    rule.preview = preset.preview
    rule.showDelay = null
    rule.hideDelay = null
    rule.maxWidth = null
    rule.suppressOpen = false
    rule.suppressCopyLink = false
    rule.suppressCopyPath = false
    rule.suppressReveal = false
    rule.suppressShowInPane = false
    rule.primaryAction = ''
    rule.alternativeAction = ''
    return rule
}

/**
 * Is this rule this preset?
 *
 * Name first, pattern as the fallback. The name is what identifies a preset in
 * the menu, and a rule whose pattern has since been hand-edited — or which was
 * added before the preset's own pattern changed — is still that preset to the
 * person reading the list. A pattern-only comparison is right about the regex
 * and wrong about the question being asked, which is "is this already in my
 * list". Measured: three of the shipped presets take their pattern from a
 * manifest, and those manifests move.
 *
 * The pattern fallback is what still recognises a renamed rule.
 */
export function ruleIsPreset (rule: LinkTooltipRule, preset: RulePreset): boolean {
    if (rule.name && rule.name === preset.name) {
        return true
    }
    if (preset.pattern) {
        return rule.match === preset.match && rule.pattern === preset.pattern
    }
    // The two file-type presets have no pattern of their own; the group is the
    // whole of what they say.
    return rule.match === preset.match
        && !rule.pattern
        && rule.fileTypeGroup === preset.fileTypeGroup
        && [...rule.extensions].sort().join(',') === [...preset.extensions].sort().join(',')
        && [...rule.schemes].sort().join(',') === [...preset.schemes].sort().join(',')
}

/** The preset a rule came from, or null. */
export function presetForRule (rule: LinkTooltipRule, presets: RulePreset[]): RulePreset | null {
    return presets.find(preset => ruleIsPreset(rule, preset)) ?? null
}

/** Whether any rule in the list already is this preset. */
export function presetInUse (preset: RulePreset, rules: LinkTooltipRule[]): boolean {
    return rules.some(rule => ruleIsPreset(rule, preset))
}
