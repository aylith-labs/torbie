import { presetCatalog } from './presets.generated'
import { IntegrationManifest, IntegrationMatcher, LinkFileTypeGroup, LinkMatchKind, LinkTooltipRule, newRule } from './api'

/**
 * Preset metadata is generated from Lintel's canonical catalog. Integration
 * patterns are selected from installed manifests by example, requiring exactly
 * one match. Run Lintel's sync-presets.mjs to update both hosts together.
 */

export interface RulePreset {
    id: string
    /**
     * The name a rule made from this preset is given, and what recognises that
     * rule afterwards (`ruleIsPreset`). It keeps its group prefix — "Jira: Issue
     * links" — because that is the name already sitting in people's rule lists,
     * and a rule list is shared with the Windows Terminal fork.
     */
    name: string
    /**
     * What the menu shows under the group's header: the name without the
     * prefix the header now says. Display only; search still reads `name`.
     */
    label: string
    /** Which header the menu lists this preset under. */
    group: string
    /** That header's text. */
    groupLabel: string
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
    legacyNames?: string[]
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
        const p = entry as { id: string, integration: string, label: string, description: string, match: LinkMatchKind, example: string, preview: boolean, pattern?: string, schemes?: readonly string[], fileTypeGroup?: LinkFileTypeGroup, extensions?: readonly string[], legacyNames?: readonly string[] }
        const integration = integrations.find(x => x.id === p.integration)
        const matcher = integration ? matcherForExample(integration.manifest.matchers ?? [], p.match, p.example) : null
        if (p.integration && !matcher) continue
        const grouping = integration
            ? { group: `integration:${integration.id}`, groupLabel: integration.name, label: matcher?.description || p.label }
            : standaloneGrouping(p)
        out.push({
            id: p.id,
            // Built from the same label the menu shows, so the two cannot
            // disagree about what follows the prefix.
            name: integration ? `${integration.name}: ${grouping.label}` : p.label,
            label: grouping.label,
            group: grouping.group,
            groupLabel: grouping.groupLabel,
            description: p.description,
            match: p.match,
            schemes: [...(p.schemes ?? [])],
            pattern: matcher?.pattern ?? p.pattern ?? '',
            fileTypeGroup: p.fileTypeGroup ?? 'none',
            extensions: [...(p.extensions ?? [])],
            integration: p.integration,
            preview: p.preview,
            example: p.example,
            legacyNames: [...(p.legacyNames ?? [])],
        })
    }
    return out
}

/**
 * Where a preset that belongs to no integration is listed.
 *
 * The catalogue carries no group field, so what the data says is asked first:
 * a preset that matches by file type is a file preset, whatever its label
 * calls it. Only then is the label read. Lintel writes "Git: Commit hashes in
 * output" for hosts that list presets flat, which is the same "<group>: "
 * convention the integration presets are named with, so that prefix is the
 * group when nothing else is. The prefix comes off the label either way,
 * since the header now says it.
 */
function standaloneGrouping (preset: {
    label: string
    fileTypeGroup?: LinkFileTypeGroup
    extensions?: readonly string[]
}): { group: string, groupLabel: string, label: string } {
    const prefixed = /^([^:]{1,32}):\s+(\S.*)$/.exec(preset.label)
    const label = prefixed ? prefixed[2] : preset.label
    if ((preset.fileTypeGroup ?? 'none') !== 'none' || preset.extensions?.length) {
        return { group: 'files', groupLabel: 'Files', label }
    }
    if (prefixed) {
        return { group: `label:${prefixed[1].toLowerCase()}`, groupLabel: prefixed[1], label }
    }
    return { group: 'other', groupLabel: 'Other', label }
}

/** One header in a preset menu, and the presets listed under it. */
export interface PresetGroup {
    key: string
    label: string
    presets: RulePreset[]
}

/**
 * What a preset menu shows for a search: the matching presets, under headers.
 *
 * A group with nothing left in it is dropped rather than drawn as a bare
 * header. Groups come in the order their first preset does, so grouping
 * reorders nothing the flat list used to show.
 *
 * Every word of the query has to appear somewhere in the preset: its full name,
 * group prefix included, so "jira" still finds a Jira preset whose label no
 * longer says so; its label, header, description, integration or id. Anything
 * the old single-substring filter found is still found.
 */
export function presetGroups (presets: RulePreset[], query = ''): PresetGroup[] {
    const words = query.toLowerCase().split(/\s+/).filter(word => word)
    const groups: PresetGroup[] = []
    const byKey = new Map<string, PresetGroup>()
    for (const preset of presets) {
        const haystack = [preset.name, preset.label, preset.groupLabel, preset.description, preset.integration, preset.id]
            .map(part => part ?? '')
            .join(' ')
            .toLowerCase()
        if (!words.every(word => haystack.includes(word))) {
            continue
        }
        let group = byKey.get(preset.group)
        if (!group) {
            group = { key: preset.group, label: preset.groupLabel, presets: [] }
            byKey.set(preset.group, group)
            groups.push(group)
        }
        group.presets.push(preset)
    }
    return groups
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
    if (rule.name && (rule.name === preset.name || preset.legacyNames?.includes(rule.name))) {
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

/** Upgrade only untouched shipped repo references; customized rules are preserved. */
export function migrateGitHubReferenceRules (rules: LinkTooltipRule[]): boolean {
    const names = ['GitHub: GitHub pull requests and issues (repo#number)', 'GitHub: Pull requests & issues (repo#number)', 'GitHub: Pull requests and issues (repo#number)']
    let changed = false
    for (const rule of rules) {
        if (rule.integration === 'github' && rule.match === 'text' && names.includes(rule.name) && rule.pattern === '^(?<repo>[A-Za-z0-9_.-]+)#(?<number>\\d+)') {
            rule.pattern = require('./integrations/github.json').matchers.find((x: any) => x.kind === 'text').pattern
            rule.name = names[2]
            changed = true
        }
    }
    return changed
}
