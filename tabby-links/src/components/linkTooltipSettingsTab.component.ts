import { Component, OnDestroy, OnInit } from '@angular/core'
import { Subscription } from 'rxjs'
import { ConfigService, PlatformService } from 'tabby-core'

import { Integration, LinkTooltipAction, LinkTooltipRule, hydrateRule, newRule } from '../api'
import { resolveRuleTarget } from '../attribution'
import {
    CLICKABLE_KINDS,
    CLICK_GESTURES,
    CLICK_MODIFIERS,
    ChordName,
    ClickGesture,
    ClickModifier,
    ClickableKind,
} from '../clickChords'
import { FILE_TYPE_GROUP_LABELS } from '../fileTypes'
import { RulePreset, applyPreset, presetForRule, presetInUse, rulePresets } from '../presets'
import { ProbeSegment, RuleProbe, probeCaptures, probeRule, probeSegments } from '../ruleProbe'
import { checkPattern } from '../regexGuard'
import { IntegrationRegistryService } from '../services/integrationRegistry.service'
import { LinkClicksService } from '../services/linkClicks.service'
import { LinkSettingsNavService, RuleTarget } from '../services/linkSettingsNav.service'

/** A comma-separated field, cleaned up. Empty entries are dropped, not stored. */
function splitList (value: string): string[] {
    return value.split(',').map(x => x.trim()).filter(x => x)
}

/**
 * A preset's pattern goes through the same guard as a typed one.
 *
 * It should never fail — `test/logic.test.js` measures every shipped preset
 * against `checkPattern` — but the pattern lands in the same box the user edits,
 * so the box's error line has to describe what is in it either way. A preset
 * that was quietly refused at compile time would otherwise look like a rule
 * that simply never fires.
 */
function checkPresetPattern (pattern: string): string {
    return pattern ? checkPattern(pattern).error : ''
}

/** Where the collapse state of the settings groups is kept. */
const GROUP_STATE_KEY = 'linkTooltipGroupCollapsed'

/**
 * Which groups start closed. The hover card is what most people opened the page
 * for, so it starts open; the rest are there when they are wanted.
 */
const DEFAULT_COLLAPSED: Record<string, boolean | undefined> = {
    card: false,
    buttons: true,
    clicking: true,
    previews: true,
}

const MODIFIER_LABELS: Record<ClickModifier, string> = {
    none: 'No modifier',
    ctrl: 'Ctrl',
    alt: 'Alt',
    shift: 'Shift',
    meta: 'Win / Cmd',
    ctrlAlt: 'Ctrl+Alt',
    ctrlShift: 'Ctrl+Shift',
    altShift: 'Alt+Shift',
    ctrlAltShift: 'Ctrl+Alt+Shift',
}

const GESTURE_LABELS: Record<ClickGesture, string> = {
    left: 'Left click',
    middle: 'Middle click',
    'double': 'Double click',
}

const KIND_LABELS: Record<ClickableKind, string> = {
    detected: 'Detected URLs and paths',
    rules: 'Text matched by a rule',
    osc8: 'Links a program marked itself',
}

@Component({
    selector: 'link-tooltip-settings-tab',
    templateUrl: './linkTooltipSettingsTab.component.pug',
    styleUrls: ['./linkTooltipSettingsTab.component.scss'],
})
export class LinkTooltipSettingsTabComponent implements OnInit, OnDestroy {
    fileTypeGroups = FILE_TYPE_GROUP_LABELS
    currentRule: LinkTooltipRule | null = null
    private navSubscription: Subscription | null = null
    patternError = ''
    /**
     * The sample the rule is tried against, and what it found.
     *
     * Not stored on the rule and not persisted — a scratch pad. `api.ts` says
     * the rule shape is deliberately identical to the Windows Terminal fork's
     * so rules can be pasted between them, and a field for a text box is not
     * worth spending that on.
     */
    sampleText = ''
    probe: RuleProbe | null = null
    probeSegments: ProbeSegment[] = []
    probeCaptures: { name: string, value: string }[] = []
    integrations: Integration[] = []
    /**
     * A field, rebuilt when the integrations change, rather than a method the
     * template calls. `*ngFor` tracks by identity, so a method handing back a
     * fresh array on every change detection pass re-creates every menu item —
     * the shape that froze the whole window on the Integrations page.
     */
    presets: RulePreset[] = []

    /**
     * Fields, not methods: `*ngFor` tracks by identity, so a method handing back
     * a fresh array would re-create every `<option>` on every change-detection
     * pass. Same reason as `presets` above.
     */
    clickModifiers = CLICK_MODIFIERS.map(value => ({ value, label: MODIFIER_LABELS[value] }))
    clickGestures = CLICK_GESTURES.map(value => ({ value, label: GESTURE_LABELS[value] }))
    clickKinds = CLICKABLE_KINDS.map(value => ({ value, label: KIND_LABELS[value] }))

    constructor (
        public config: ConfigService,
        private platform: PlatformService,
        private clicks: LinkClicksService,
        private nav: LinkSettingsNavService,
        registry: IntegrationRegistryService,
    ) {
        registry.integrations$.subscribe(list => {
            this.integrations = list
            // Presets take their patterns from the manifests, so the menu is
            // only correct once these have arrived.
            this.presets = rulePresets(list)
        })
    }

    /**
     * Two paths, because `ngbNav` destroys the content of a hidden tab: opening
     * the page *builds* this component, so a request made before it existed is
     * waiting to be collected — but a settings tab already sitting on this page
     * is not rebuilt, and only hears about it through the subscription.
     */
    ngOnInit (): void {
        const pending = this.nav.take()
        if (pending) {
            this.selectRuleTarget(pending)
        }
        this.navSubscription = this.nav.requests$.subscribe(target => this.selectRuleTarget(target))
    }

    ngOnDestroy (): void {
        this.navSubscription?.unsubscribe()
    }

    /** Open the rule a hover card named, if it is still there. */
    selectRuleTarget (target: RuleTarget): void {
        this.currentRule = resolveRuleTarget(this.rules, target)
        this.patternError = this.currentRule ? checkPresetPattern(this.currentRule.pattern) : ''
        this.seedSample(this.currentRule)
    }

    get rules (): LinkTooltipRule[] {
        // Hydrated, because these come straight out of a file a person can
        // hand-edit and may be missing any key. Completed *in place* and the
        // stored array itself returned — `.map()` here would hand back a copy,
        // and adding, deleting or reordering a rule would then mutate a
        // throwaway and never reach the config.
        const stored = this.config.store.linkTooltip.rules as Partial<LinkTooltipRule>[]
        stored.forEach(hydrateRule)
        return stored as LinkTooltipRule[]
    }

    // ── clicking ─────────────────────────────────────────────────────────────

    /** "Ctrl+Click", as the chord currently reads. */
    chordDescription (name: ChordName): string {
        return this.clicks.describe(name)
    }

    hasKind (kind: ClickableKind): boolean {
        return this.clicks.kinds().includes(kind)
    }

    /**
     * Written back as a whole array rather than mutated in place: the stored
     * value may be the default array the config provider handed out, and
     * pushing into that would edit the default for everyone.
     */
    toggleKind (kind: ClickableKind): void {
        const kinds = this.clicks.kinds()
        this.config.store.linkTooltip.clickableKinds = this.hasKind(kind)
            ? kinds.filter(x => x !== kind)
            : [...kinds, kind]
        this.saveConfiguration()
    }

    get safeSchemes (): string {
        return (this.config.store.linkTooltip.safeSchemes ?? []).join(', ')
    }

    set safeSchemes (value: string) {
        this.config.store.linkTooltip.safeSchemes = splitList(value)
        this.saveConfiguration()
    }

    saveConfiguration (): void {
        this.config.save()
        this.platform.extraSafeSchemes = this.config.store.linkTooltip.safeSchemes ?? []
    }

    // ── the rule list ────────────────────────────────────────────────────────

    addRule (): void {
        const rule = newRule()
        this.rules.push(rule)
        this.currentRule = rule
        this.patternError = ''
        this.seedSample(rule)
        this.saveConfiguration()
    }

    /** Add a rule already filled in, and open it — a preset is a starting point. */
    addRuleFromPreset (preset: RulePreset): void {
        const rule = applyPreset(preset)
        this.rules.push(rule)
        this.currentRule = rule
        this.patternError = checkPresetPattern(rule.pattern)
        this.seedSample(rule)
        this.saveConfiguration()
    }

    /**
     * Overwrite the open rule with a preset.
     *
     * Only offered from inside the editor, where what is about to be replaced is
     * on screen — the alternative, a preset picker that silently rewrites a rule
     * from the list, would be a click with no visible subject.
     */
    applyPresetToCurrent (preset: RulePreset): void {
        if (!this.currentRule) {
            return
        }
        applyPreset(preset, this.currentRule)
        this.patternError = checkPresetPattern(this.currentRule.pattern)
        this.seedSample(this.currentRule)
        this.saveConfiguration()
    }

    /**
     * Re-run the rule against the sample box.
     *
     * Cheap enough to do on every keystroke: the guard caps a single run at
     * `MATCH_BUDGET_MS`, and this builds its own regex rather than touching the
     * service's shared cache, so a slow pattern typed here cannot disable the
     * rule for the session.
     */
    runProbe (): void {
        const rule = this.currentRule
        if (!rule) {
            this.probe = null
            this.probeSegments = []
            this.probeCaptures = []
            return
        }
        const probe = probeRule(rule, this.sampleText)
        this.probe = probe
        // Built once per run, not by a method the template calls: `*ngFor`
        // tracks by identity, and a method handing back fresh objects on every
        // change-detection pass is the shape that froze the Integrations page.
        this.probeSegments = probeSegments(probe)
        this.probeCaptures = probeCaptures(probe)
        // One error line, fed from the probe rather than from a second
        // `checkPattern` call, so the box and the message cannot disagree.
        this.patternError = probe.error
    }

    /**
     * Start the sample box from the preset's own example, when the rule came
     * from one. Every shipped preset is asserted to match its example, so this
     * opens on a rule that visibly works.
     */
    private seedSample (rule: LinkTooltipRule | null): void {
        this.sampleText = rule ? presetForRule(rule, this.presets)?.example ?? '' : ''
        this.runProbe()
    }

    /** Whether this preset is already in the rule list, so it is not offered twice. */
    presetInUse (preset: RulePreset): boolean {
        return presetInUse(preset, this.rules)
    }

    /**
     * The same question for the editor's own menu, which must still offer the
     * preset the open rule already is: there it means "re-sync me", not
     * "duplicate me".
     */
    presetInUseElsewhere (preset: RulePreset): boolean {
        return presetInUse(preset, this.rules.filter(rule => rule !== this.currentRule))
    }

    // ── group state ──────────────────────────────────────────────────────────

    /**
     * Whether a settings group is closed.
     *
     * View state, so it has no business in `config.yaml` — but it does have to
     * outlive this component, which is rebuilt far more often than it looks:
     * `ngbNav` destroys the content of a hidden settings tab, so navigating away
     * and back constructs the page from scratch, and every `saveConfiguration()`
     * fires `config.changed$` underneath it. localStorage, in the same shape
     * `profileGroupCollapsed` already uses for the profile tree.
     */
    collapsed (id: string): boolean {
        const stored = this.groupState()[id]
        // Absent means "whatever this group's author intended", not "open": a
        // group added later should start where it was meant to rather than
        // wherever an older stored map happens not to mention it.
        return typeof stored === 'boolean' ? stored : DEFAULT_COLLAPSED[id] ?? false
    }

    /**
     * Only ever called from the accordion's own `(shown)`/`(hidden)`, and it
     * never assigns `collapsed` back — so restoring a group cannot re-enter and
     * start a second lap.
     */
    setCollapsed (id: string, value: boolean): void {
        const state = this.groupState()
        state[id] = value
        try {
            window.localStorage[GROUP_STATE_KEY] = JSON.stringify(state)
        } catch {
            // Storage can be unavailable or full. Forgetting which panel was
            // open is not worth failing the page over.
        }
    }

    private groupState (): Record<string, boolean> {
        try {
            return JSON.parse(window.localStorage[GROUP_STATE_KEY] ?? '{}')
        } catch {
            return {}
        }
    }

    trackPreset (index: number): number {
        return index
    }

    // Index, like every other trackBy in this package: these are rebuilt as a
    // set on each probe, so identity would re-create every node each time.
    trackSegment (index: number): number {
        return index
    }

    trackCapture (index: number): number {
        return index
    }

    editRule (rule: LinkTooltipRule): void {
        this.currentRule = this.currentRule === rule ? null : rule
        this.patternError = ''
        this.seedSample(this.currentRule)
    }

    moveRule (rule: LinkTooltipRule, delta: number): void {
        const index = this.rules.indexOf(rule)
        const target = index + delta
        if (index === -1 || target < 0 || target >= this.rules.length) {
            return
        }
        this.rules.splice(index, 1)
        this.rules.splice(target, 0, rule)
        this.saveConfiguration()
    }

    deleteRule (rule: LinkTooltipRule): void {
        const index = this.rules.indexOf(rule)
        if (index === -1) {
            return
        }
        this.rules.splice(index, 1)
        if (this.currentRule === rule) {
            this.currentRule = null
        }
        this.saveConfiguration()
    }

    /** The one-line description under a rule's name in the list. */
    summary (rule: LinkTooltipRule): string {
        if (rule.match === 'text') {
            const target = rule.integration && rule.integration !== 'none'
                ? this.integrationName(rule.integration)
                : rule.integration === 'none' ? 'no preview' : 'any integration'
            return `text: ${rule.pattern || '(no pattern)'}  →  ${target}`
        }
        const parts: string[] = []
        if (rule.schemes.length) {
            parts.push(`scheme: ${rule.schemes.join(', ')}`)
        }
        if (rule.pattern) {
            parts.push(`pattern: ${rule.pattern}`)
        }
        if (rule.fileTypeGroup !== 'none' || rule.extensions.length) {
            parts.push('file type')
        }
        return parts.join(' · ')
    }

    integrationName (id: string): string {
        return this.integrations.find(x => x.id === id)?.name ?? id
    }

    // ── the rule editor ──────────────────────────────────────────────────────

    schemesOf (rule: LinkTooltipRule): string {
        return rule.schemes.join(', ')
    }

    setSchemes (rule: LinkTooltipRule, value: string): void {
        rule.schemes = splitList(value)
        this.saveConfiguration()
    }

    extensionsOf (rule: LinkTooltipRule): string {
        return rule.extensions.join(', ')
    }

    setExtensions (rule: LinkTooltipRule, value: string): void {
        rule.extensions = splitList(value)
        this.saveConfiguration()
    }

    /**
     * Patterns are checked before they are stored. A backtracking pattern here
     * runs synchronously against whatever a remote host printed, so catching it
     * at authoring time is far better than catching it as a frozen window.
     */
    setPattern (rule: LinkTooltipRule, value: string): void {
        rule.pattern = value
        this.patternError = value ? checkPattern(value).error : ''
        this.saveConfiguration()
    }

    hasOverride (rule: LinkTooltipRule, key: 'showDelay' | 'hideDelay' | 'maxWidth'): boolean {
        return rule[key] !== null
    }

    toggleOverride (rule: LinkTooltipRule, key: 'showDelay' | 'hideDelay' | 'maxWidth'): void {
        if (this.hasOverride(rule, key)) {
            rule[key] = null
        } else {
            rule[key] = this.config.store.linkTooltip[key]
        }
        this.saveConfiguration()
    }

    addAction (rule: LinkTooltipRule): void {
        rule.actions.push({ name: '', icon: '', type: 'openUrl', value: '' })
        this.saveConfiguration()
    }

    deleteAction (rule: LinkTooltipRule, action: LinkTooltipAction): void {
        const index = rule.actions.indexOf(action)
        if (index !== -1) {
            rule.actions.splice(index, 1)
            this.saveConfiguration()
        }
    }

    trackRule (index: number): number {
        return index
    }
}
