import { Injectable } from '@angular/core'
import { ConfigService } from 'tabby-core'

/** Set on `<body>` while the filled mark is shown. */
export const FORK_MARK_CLASS = 'show-fork-marks'
/** Set on `<body>` while the hollow mark is shown. */
export const CONFIG_ONLY_MARK_CLASS = 'show-config-only-marks'

/**
 * Whether the provenance marks are drawn.
 *
 * App-wide state on `<body>` rather than an input threaded through every
 * settings page's component: the rows that carry a mark live in a dozen
 * packages and have nothing else to do with this. `ThemesService` already
 * toggles `no-animations` the same way, so this is the house pattern rather
 * than a new one.
 */
@Injectable({ providedIn: 'root' })
export class ForkMarksService {
    constructor (private config: ConfigService) {
        this.config.ready$.subscribe(() => this.apply())
        // A window whose config was reloaded — including by another window —
        // has to follow.
        this.config.changed$.subscribe(() => this.apply())
    }

    /**
     * Apply the current setting, or the values given.
     *
     * The switch passes its own values because `config.save()` awaits the disk
     * before `changed$` fires, so a handler that only saved would leave the
     * mark a visible moment behind the switch that controls it. The accent
     * colour picker in `windowSettingsTab.component.ts` already documents the
     * same trap. Reading the event rather than the store also avoids the
     * reference fork's own bug here, where the handler saw the value the
     * two-way binding had not written back yet and the mark never appeared.
     */
    apply (fork?: boolean, configOnly?: boolean): void {
        const store = this.config.store?.upstream
        document.body.classList.toggle(
            FORK_MARK_CLASS, fork ?? store?.showForkMarks === true)
        document.body.classList.toggle(
            CONFIG_ONLY_MARK_CLASS, configOnly ?? store?.showConfigOnlyMarks === true)
    }
}
