import { Injectable } from '@angular/core'
import { interval } from 'rxjs'
import { BaseTerminalTabComponent } from './api/baseTerminalTab.component'
import { TerminalDecorator } from './api/decorator'
import { BaseSession } from './session'

/**
 * Keeps the PTY's size equal to the terminal's.
 *
 * A program draws for the size its PTY reports. When that falls behind the
 * terminal — measured on a live pane: ConPTY at 150 columns, xterm at 162 —
 * every full row ConPTY writes relies on a wrap at 150 that xterm does not
 * make, so the next row's text lands on the same line, and the columns past
 * 150 are never cleared by anything. It reads as stale glyphs, and no repaint
 * fixes it, because the buffer really holds that text.
 *
 * Nothing re-sent a size once one was lost: `baseTerminalTab` sends on
 * `resize$` and nowhere else, and drops the send while the session is not yet
 * open. So this records what was actually sent and re-sends the terminal's
 * size whenever the two disagree, and writes a `pty-size-resynced` record
 * saying by how much — the next occurrence names its own circumstances.
 */

export interface TermSize {
    columns: number
    rows: number
}

/** Long enough for `resize$`'s 100 ms audit to have delivered the latest size. */
export const RESYNC_GRACE_MS = 750
export const RESYNC_CHECK_MS = 2000

/**
 * Whether the PTY needs the terminal's size again. `sent` is null until
 * anything has been sent, and the spawn size is the frontend's own at the time,
 * so "never sent" is judged from how long the session has been open.
 */
export function needsResync (
    term: TermSize|null,
    sent: TermSize|null,
    msSinceSent: number,
): boolean {
    if (!term || !(term.columns > 0) || !(term.rows > 0)) {
        return false
    }
    if (msSinceSent < RESYNC_GRACE_MS) {
        return false
    }
    if (!sent) {
        return false
    }
    return sent.columns !== term.columns || sent.rows !== term.rows
}

interface Tracked {
    session: BaseSession
    original: (columns: number, rows: number) => any
    sent: TermSize|null
    sentAt: number
}

@Injectable()
export class PTYSizeGuardDecorator extends TerminalDecorator {
    private tracked = new Map<BaseTerminalTabComponent<any>, Tracked>()

    attach (tab: BaseTerminalTabComponent<any>): void {
        this.track(tab, tab.session)
        this.subscribeUntilDetached(tab, tab.sessionChanged$.subscribe(session => this.track(tab, session)))
        this.subscribeUntilDetached(tab, tab.focused$.subscribe(() => this.check(tab, 'focus')))
        this.subscribeUntilDetached(tab, interval(RESYNC_CHECK_MS).subscribe(() => this.check(tab, 'poll')))
    }

    detach (tab: BaseTerminalTabComponent<any>): void {
        this.untrack(tab)
        super.detach(tab)
    }

    private track (tab: BaseTerminalTabComponent<any>, session: BaseSession|null): void {
        if (this.tracked.get(tab)?.session === session) {
            return
        }
        this.untrack(tab)
        if (!session) {
            return
        }
        const original = session.resize
        const entry: Tracked = {
            session,
            original,
            // The PTY was spawned at the frontend's size of that moment.
            sent: tab.size ? { columns: tab.size.columns, rows: tab.size.rows } : null,
            sentAt: Date.now(),
        }
        // An own property over the prototype's method, so untracking is a delete.
        session.resize = (columns: number, rows: number) => {
            entry.sent = { columns, rows }
            entry.sentAt = Date.now()
            return original.call(session, columns, rows)
        }
        this.tracked.set(tab, entry)
    }

    private untrack (tab: BaseTerminalTabComponent<any>): void {
        const entry = this.tracked.get(tab)
        if (entry) {
            delete (entry.session as any).resize
            this.tracked.delete(tab)
        }
    }

    private check (tab: BaseTerminalTabComponent<any>, trigger: string): void {
        const entry = this.tracked.get(tab)
        const xterm = (tab.frontend as any)?.xterm
        if (!entry || !xterm || !entry.session.open) {
            return
        }
        const term = { columns: xterm.cols, rows: xterm.rows }
        const msSinceSent = Date.now() - entry.sentAt
        if (!needsResync(term, entry.sent, msSinceSent)) {
            return
        }
        const was = entry.sent
        entry.session.resize(term.columns, term.rows)
        ;(window as any).__tabbyDiagnostics?.report?.('pty-size-resynced', {
            trigger,
            terminal: `${term.columns}x${term.rows}`,
            pty: was ? `${was.columns}x${was.rows}` : null,
            msSinceSent,
            title: tab.title,
        })
    }
}
