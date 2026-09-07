import { Injectable, NgZone } from '@angular/core'
import { Subject } from 'rxjs'
import { AppService } from 'tabby-core'
import { SettingsTabComponent } from 'tabby-settings'

/** Which rule a card asked to open, and the name it had when it asked. */
export interface RuleTarget {
    index: number
    name: string
}

/**
 * Opening the Link Tooltip settings page at one particular rule.
 *
 * The card can say which rule produced it; this is what makes that a link. It
 * exists because the settings page and the terminal decorator have no other
 * way to reach each other — the page is built by the settings tab, not by us.
 */
@Injectable({ providedIn: 'root' })
export class LinkSettingsNavService {
    /**
     * Both halves are needed, and for a structural reason: `ngbNav` destroys
     * the content of a hidden tab, so navigating to the page *builds* it and
     * `ngOnInit` can collect a pending target — but if the settings tab is
     * already open on Link Tooltip, nothing is rebuilt and only a live
     * subscriber hears about it.
     */
    private pending: RuleTarget | null = null
    readonly requests$ = new Subject<RuleTarget>()

    constructor (
        private app: AppService,
        private zone: NgZone,
    ) { }

    /** Open (or reuse) the settings tab on Link Tooltip, at this rule. */
    openRule (target: RuleTarget): void {
        this.pending = target
        // The card's buttons hang off xterm's own DOM, which is outside
        // Angular's zone; creating or selecting a tab from out there builds one
        // that nothing ever draws.
        this.zone.run(() => {
            const existing = this.app.tabs.find(tab => tab instanceof SettingsTabComponent) as
                SettingsTabComponent | undefined
            if (existing) {
                this.app.selectTab(existing)
                // `[activeId]` is a one-way binding, so assigning this
                // navigates a tab that is already open.
                existing.activeTab = 'link-tooltip'
            } else {
                this.app.openNewTabRaw({
                    type: SettingsTabComponent,
                    inputs: { activeTab: 'link-tooltip' },
                })
            }
            // For a page that is already alive and will not be rebuilt.
            this.requests$.next(target)
        })
    }

    /** Consumed by the page when it is built. */
    take (): RuleTarget | null {
        const target = this.pending
        this.pending = null
        return target
    }
}
