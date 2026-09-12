import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker'

import { Component } from '@angular/core'
import { ConfigService } from 'tabby-core'

import { StithHealth } from '../api'
import { HerdrService } from '../services/herdr.service'
import { StithService } from '../services/stith.service'

/** One dependent switch under a master, so the template is a loop not a wall. */
interface PanelRow {
    key: string
    label: string
    description?: string
}

/** Where the collapse state of the settings groups is kept. */
const GROUP_STATE_KEY = 'claudeGroupCollapsed'

/**
 * Which groups start closed. Panel contents is what this page is mostly for —
 * the registry URL is set once and never touched again — so that one is open.
 */
const DEFAULT_COLLAPSED: Record<string, boolean | undefined> = {
    registry: true,
    clicking: true,
    panel: false,
    hover: true,
}

/**
 * The six sections the panel renders *inside* the active-session block.
 *
 * They are a table rather than six near-identical template blocks because the
 * thing that matters about them is that they are one group: they are governed
 * by one switch, and every one of them was previously a control that silently
 * did nothing whenever that switch was off.
 */
const ACTIVE_SESSION_ROWS: PanelRow[] = [
    { key: 'showStatus', label: _('Status') },
    { key: 'showContext', label: _('Context window') },
    { key: 'showStats', label: _('Counters'), description: _('Turns, tool calls, compactions and subagents') },
    { key: 'showLastPrompt', label: _('Last prompt') },
    { key: 'showQueued', label: _('Queued prompts') },
    { key: 'showBookmark', label: _('Bookmark'), description: _('Notes and links saved against the session in stith') },
]

/** The same shape for the hover card, whose four rows hang off `enabled`. */
const HOVER_ROWS: PanelRow[] = [
    { key: 'showStatus', label: _('Status') },
    { key: 'showContext', label: _('Context window') },
    { key: 'showStats', label: _('Counters') },
    { key: 'showLastPrompt', label: _('Last prompt') },
]

/** @hidden */
@Component({
    standalone: false,
    selector: 'claude-settings-tab',
    templateUrl: './claudeSettingsTab.component.pug',
})
export class ClaudeSettingsTabComponent {
    health: StithHealth = 'never-tried'
    /** Result of the manual connection test, shown next to the URL field. */
    testResult: string | null = null
    testing = false

    readonly activeSessionRows = ACTIVE_SESSION_ROWS
    readonly hoverRows = HOVER_ROWS

    constructor (
        public config: ConfigService,
        private herdr: HerdrService,
        private stith: StithService,
    ) { }

    /**
     * Test on arrival. The connection state is the first thing anyone opens
     * this page to find out, and making them press a button to learn it —
     * while the panel three inches away already knows — is a page asking a
     * question it can answer itself.
     */
    ngOnInit (): void {
        void this.testConnection()
    }

    saveConfiguration (): void {
        this.config.save()
    }

    /**
     * Explicit connection test. The panel already reports reachability, but a
     * user editing the URL needs an answer without opening the panel and
     * waiting for a poll.
     *
     * It reports the pane count as well as the session count, because the two
     * come from different services behind the same address — stith answering
     * while herdr is not running is a real state, and one that makes pane
     * focusing silently fall back to the browser.
     */
    async testConnection (): Promise<void> {
        this.testing = true
        this.testResult = null
        try {
            const response = await fetch(`${this.stith.baseURL}/api/agents`, {
                headers: { accept: 'application/json' },
            })
            if (!response.ok) {
                this.testResult = `HTTP ${response.status}`
                return
            }
            const data = await response.json()
            const count = Array.isArray(data.agents) ? data.agents.length : 0
            let panes = ''
            if (this.config.store.claude.shefrd?.enabled) {
                try {
                    const rows = await this.herdr.panes()
                    panes = `, ${rows.filter(x => x.sessionId).length} pane(s)`
                } catch {
                    panes = ', panes unavailable'
                }
            }
            this.testResult = `OK — ${count} session(s)${panes}`
        } catch (err) {
            this.testResult = String(err)
        } finally {
            this.testing = false
            this.stith.refreshNow()
        }
    }

    /**
     * Whether a settings group is closed.
     *
     * View state, so it has no business in `config.yaml` — but it does have to
     * outlive this component, which is rebuilt far more often than it looks:
     * `ngbNav` destroys the content of a hidden settings tab, so navigating away
     * and back constructs the page from scratch, and every `saveConfiguration()`
     * fires `config.changed$` underneath it. localStorage, in the shape
     * `linkTooltipGroupCollapsed` and `profileGroupCollapsed` already use.
     */
    collapsed (id: string): boolean {
        const stored = this.groupState()[id]
        // Absent means "whatever this group's author intended", not "open".
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

    trackKey (index: number, row: PanelRow): string {
        return row.key
    }

    private groupState (): Record<string, boolean> {
        try {
            return JSON.parse(window.localStorage[GROUP_STATE_KEY] ?? '{}')
        } catch {
            return {}
        }
    }
}
