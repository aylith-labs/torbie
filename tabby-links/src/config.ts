import { ConfigProvider } from 'tabby-core'

import { CLICKABLE_KINDS, DEFAULT_CHORDS } from './clickChords'

/** @hidden */
export class LinksConfigProvider extends ConfigProvider {
    defaults = {
        linkTooltip: {
            /** Master switch for the hover card. Detection stays on. */
            enabled: true,
            /** Whether links are detected and made clickable at all. */
            detectLinks: true,
            /**
             * Whether clicking a link activates it at all. Off, links are still
             * detected, highlighted and previewed — the card's buttons are then
             * how you act on one.
             */
            clickable: true,
            /** Which kinds of link a click reaches: detected, rules, osc8. */
            clickableKinds: [...CLICKABLE_KINDS],
            /**
             * The two click chords. Each is a modifier — matched exactly, so
             * Ctrl+Shift does not satisfy a plain-Ctrl chord — plus a gesture,
             * plus the action id it runs. A rule may override either action.
             */
            primaryClickModifier: DEFAULT_CHORDS.primary.modifier,
            primaryClickGesture: DEFAULT_CHORDS.primary.gesture,
            primaryAction: DEFAULT_CHORDS.primary.action,
            alternativeClickModifier: DEFAULT_CHORDS.alternative.modifier,
            alternativeClickGesture: DEFAULT_CHORDS.alternative.gesture,
            alternativeAction: DEFAULT_CHORDS.alternative.action,
            maxWidth: 640,
            maxHeight: 720,
            nested: false,
            showDelay: 250,
            hideDelay: 400,
            /** The five built-in buttons: Open, Copy link, Copy path, Reveal, Show in pane. */
            showButtons: true,
            /**
             * Whether a rule's own custom actions are offered.
             *
             * Separate from `showButtons`, which used to govern both: a switch
             * labelled "show buttons" silently deleting user-authored actions
             * is the same destructive click `applyPreset` refuses to make.
             */
            showCustomActions: true,
            /**
             * Which edge of the card the button row sits on, named relative to
             * the *link* rather than to the card: 'near' is the edge the link is
             * on, 'far' the opposite one.
             *
             * The card flips above the hovered line when there is no room below,
             * so "bottom" is the near edge half the time and the far edge the
             * other half — which is why naming a card edge was never meaningful.
             * 'far' is the default because it is what the old always-bottom
             * behaviour produced in the common case.
             */
            actionsPlacement: 'far',
            /**
             * Whether the card says which rule produced it. Diagnostic, so off
             * by default. "No rule matched" is the useful half — it is the
             * answer to "why is this link not previewed the way I set it up",
             * which the UI otherwise gives no way to ask.
             */
            showRuleAttribution: false,
            /**
             * Whether hover cards go quiet while a preview pane is open. Both
             * halves are required — the pane and this — so closing the last
             * pane brings hovers back without anyone having to remember to turn
             * this off again.
             */
            hideTooltipsWithPane: false,
            /**
             * Whether a plugin's own `html` document is rendered. It runs in a
             * sandboxed frame with an opaque origin and a CSP that blocks the
             * network, so it can reach neither Tabby nor the outside — but it is
             * still someone else's script, so there is a switch. Off falls back
             * to the plain field list.
             */
            allowHtml: true,
            /** Extra URI schemes that open without a confirmation dialog. */
            safeSchemes: [],
            rules: [],
        },
        /**
         * Per-integration state, keyed by manifest id:
         * `{ enabled: boolean, settings: {}, fields: [] }`.
         *
         * `__nonStructural` is load-bearing, not decoration. `ConfigProxy` only
         * treats an object as structural when it has keys, so a plain `{}` default
         * falls through to `__getValue`, which hands back a fresh `deepClone` on
         * every read — writes into it are silently discarded. The flag forces the
         * leaf path, where the stored object is returned by reference and mutations
         * persist. Same reason `tabby-terminal/src/config.ts` flags `colorScheme`.
         */
        integrations: {
            __nonStructural: true,
        },
    }

    platformDefaults = { }
}
