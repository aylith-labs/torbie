import { Injectable } from '@angular/core'
import { ConfigService, LogService, Logger } from 'tabby-core'

import { StithService } from './stith.service'

/**
 * One pane of a herdr / shefrd multiplexer, as stith reports it.
 *
 * Only the fields this package reads are declared. The endpoint carries a good
 * deal more — labels, tokens, join state — and a pane row is stith's shape
 * rather than ours, so it is deliberately not mirrored wholesale.
 */
export interface HerdrPane {
    paneId: string
    workspaceId: string
    tabId: string
    /** The Claude session running in the pane, when one is. This is the join. */
    sessionId: string | null
    agent: string | null
    agentStatus: string | null
    focused: boolean
    cwd: string
    terminalTitle: string | null
}

/** What a focus attempt did, so the caller can decide what to fall back to. */
export type FocusOutcome = 'focused' | 'no-pane' | 'unavailable' | 'failed'

/**
 * Focusing a Claude session that is running in a herdr / shefrd pane.
 *
 * **Everything goes through stith, and nothing here invokes a binary.** stith
 * already holds a socket to every multiplexer server, so the same two calls
 * work from Windows, from WSL and from inside a pane — which is what makes this
 * reachable from an Electron renderer at all. `tabby-links`' `shefrd.json`
 * manifest talks to exactly these two endpoints for exactly that reason, and
 * the addresses are kept identical to it on purpose: one of them moving and the
 * other not is the silent-divergence shape this repo keeps finding.
 *
 * It is a separate service from `StithService` because that one documents, at
 * the top of the file, that it never mutates stith state. `POST /focus` does.
 */
@Injectable({ providedIn: 'root' })
export class HerdrService {
    private logger: Logger

    /**
     * The last pane listing, and when it was taken.
     *
     * A click is a user gesture, so a round trip is affordable — but a click
     * that misses should not cost a second one, and the panel asks whether a
     * session *has* a pane while rendering rows. Two seconds is long enough to
     * cover a render pass and short enough that a pane closed a moment ago is
     * not still being offered.
     */
    private cached: HerdrPane[] = []
    private cachedAt = 0
    private inFlight: Promise<HerdrPane[]> | null = null

    /** Set when the endpoint says herdr itself is not running. */
    private unavailableReason: string | null = null

    constructor (
        private config: ConfigService,
        private stith: StithService,
        log: LogService,
    ) {
        this.logger = log.create('claude-herdr')
    }

    /** Whether the user has asked for pane focusing at all. */
    get enabled (): boolean {
        return this.config.store.claude?.shefrd?.enabled !== false
    }

    /**
     * The pane running `sessionId`, from the cache when it is fresh.
     *
     * Synchronous by design: it is asked during a render pass, where an
     * unresolved promise would mean a row that flickers its affordance in a
     * frame or two after everything else has drawn.
     */
    cachedPaneFor (sessionId: string): HerdrPane | null {
        return this.cached.find(x => x.sessionId === sessionId) ?? null
    }

    /**
     * Populate the cache in the background, cheaply.
     *
     * Called from the panel's render, which runs on every session poll — at the
     * default 2s interval, refreshing on each one would double this window's
     * traffic to stith for data only a click and a context menu ever read. Ten
     * seconds keeps the labels honest without that.
     */
    warm (): void {
        if (!this.enabled || Date.now() - this.cachedAt < 10000 || this.inFlight) {
            return
        }
        void this.panes().catch(() => {
            // Already logged, and there is nobody to tell: this is a
            // speculative fetch for a label nobody has asked for yet.
        })
    }

    async paneFor (sessionId: string): Promise<HerdrPane | null> {
        const panes = await this.panes()
        return panes.find(x => x.sessionId === sessionId) ?? null
    }

    async panes (): Promise<HerdrPane[]> {
        if (Date.now() - this.cachedAt < 2000) {
            return this.cached
        }
        // Single-flighted: several rows asking at once must not become several
        // requests, which is the shape that makes a hover feel expensive.
        this.inFlight ??= this.fetchPanes().finally(() => { this.inFlight = null })
        return this.inFlight
    }

    /**
     * Raise the pane running this session.
     *
     * Returns what happened rather than a boolean, because the caller's
     * fallback differs: no pane at all means "this session is somewhere else,
     * open it in stith", while a failed request means the pane is real and
     * something transient went wrong — worth saying so rather than silently
     * opening a browser.
     */
    async focus (sessionId: string): Promise<FocusOutcome> {
        if (!this.enabled) {
            return 'no-pane'
        }
        let pane: HerdrPane | null
        try {
            pane = await this.paneFor(sessionId)
        } catch (err) {
            this.logger.debug('pane lookup failed', err)
            return 'failed'
        }
        if (!pane) {
            return this.unavailableReason ? 'unavailable' : 'no-pane'
        }
        return this.focusPane(pane)
    }

    async focusPane (pane: HerdrPane): Promise<FocusOutcome> {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
        try {
            const response = await fetch(`${this.stith.baseURL}/api/herdr/focus`, {
                method: 'POST',
                signal: controller.signal,
                headers: { accept: 'application/json', 'content-type': 'application/json' },
                body: JSON.stringify({ kind: 'pane', id: pane.paneId }),
            })
            if (!response.ok) {
                this.logger.debug(`focus ${pane.paneId}: HTTP ${response.status}`)
                return 'failed'
            }
            // The pane moved under us, so anything cached about which pane is
            // focused is now wrong. Cheaper to drop it than to patch it.
            this.cachedAt = 0
            return 'focused'
        } catch (err) {
            this.logger.debug(`focus ${pane.paneId} failed`, err)
            return 'failed'
        } finally {
            clearTimeout(timeout)
        }
    }

    /**
     * Deliberately not `claude.requestTimeoutMs`.
     *
     * That one is the *poll's* budget and is tuned against a 2s interval — a
     * poll that overruns has another one along shortly, so failing fast is
     * right there. Neither call here is a poll: one answers a click and the
     * other is a command that makes a multiplexer switch workspaces. Sharing
     * the number would mean retuning the poll silently retunes these, and an
     * aborted focus looks to the user exactly like a click that did nothing.
     *
     * Measured on this machine: the listing is 45–110 ms for 44 panes and the
     * focus POST 120 ms, so this is roughly 70× headroom rather than a guess at
     * a typical time.
     */
    private readonly timeoutMs = 8000

    private async fetchPanes (): Promise<HerdrPane[]> {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
        try {
            const response = await fetch(`${this.stith.baseURL}/api/herdr/panes`, {
                signal: controller.signal,
                headers: { accept: 'application/json' },
            })
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`)
            }
            const type = response.headers.get('content-type') ?? ''
            if (!type.includes('json')) {
                // stith serves its SPA as a catch-all, so a wrong path comes
                // back 200 text/html. Reading that as data would report "no
                // panes" for ever instead of an error.
                throw new Error(`expected JSON, got ${type || 'nothing'}`)
            }
            const body = await response.json() as {
                available?: boolean
                unavailableReason?: string | null
                rows?: any[]
            }
            this.unavailableReason = body.available === false
                ? body.unavailableReason ?? 'herdr is not running'
                : null
            this.cached = (body.rows ?? []).map(row => ({
                paneId: String(row.paneId ?? ''),
                workspaceId: String(row.workspaceId ?? ''),
                tabId: String(row.tabId ?? ''),
                sessionId: row.sessionId ? String(row.sessionId) : null,
                agent: row.agent ? String(row.agent) : null,
                agentStatus: row.agentStatus ? String(row.agentStatus) : null,
                focused: !!row.focused,
                cwd: String(row.cwd ?? ''),
                terminalTitle: row.terminalTitle ? String(row.terminalTitle) : null,
            })).filter(x => x.paneId)
            this.cachedAt = Date.now()
            return this.cached
        } catch (err) {
            // Keep whatever was cached rather than blanking it: herdr being
            // briefly unreachable should not make every row lose its pane
            // affordance mid-session.
            this.cachedAt = Date.now() - 1500
            throw err
        } finally {
            clearTimeout(timeout)
        }
    }
}
