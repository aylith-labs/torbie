import { Injectable } from '@angular/core'

import { Integration } from '../api'
import { AccountIdentity, checkIntegrationAccount } from './integrationAccount'

/** How long a verified answer stands before the page asks again. */
const TTL_MS = 60000

/**
 * Who each integration says you are, checked when the page opens.
 *
 * The check itself already existed — `checkIntegrationAccount` — but only ever
 * ran for the integration you had clicked into, so the list said nothing about
 * whether any of them actually worked. A row reading "Not configured" and a row
 * whose saved token was revoked last week looked identical, and the only way to
 * tell was to open each one in turn.
 *
 * **This is deliberately the opposite call from the Upstream page**, which
 * refuses to fetch when it opens because network I/O on a settings page is how
 * one earns a reputation for being slow. The difference is what the answer is
 * worth: Upstream is reporting a commit count that a stale number still
 * describes usefully, while a credential either works right now or the feature
 * silently does nothing. So the checks are made, and the cost is kept down
 * instead of avoided:
 *
 * - **Only integrations that could answer.** Disabled or unconfigured is known
 *   without asking, so nothing is sent for them.
 * - **All at once**, not one after another.
 * - **Never blocking the render.** The rows draw immediately and each badge
 *   fills itself in.
 * - **Cached across page opens**, since this service outlives the component and
 *   the settings tab is rebuilt every time you navigate back to it.
 */
@Injectable({ providedIn: 'root' })
export class IntegrationAccountsService {
    private results = new Map<string, { at: number, identity: AccountIdentity }>()
    private inFlight = new Map<string, Promise<AccountIdentity>>()

    /** The last answer for an integration, without asking for a new one. */
    get (id: string): AccountIdentity | null {
        return this.results.get(id)?.identity ?? null
    }

    checking (id: string): boolean {
        return this.inFlight.has(id)
    }

    get busy (): boolean {
        return this.inFlight.size > 0
    }

    /**
     * Check one integration, reusing a fresh answer or a request already out.
     *
     * `force` is the Re-check button: it drops the cached answer but still
     * joins an in-flight request, because two checks racing would leave
     * whichever finished last on screen.
     */
    async check (integration: Integration, force = false): Promise<AccountIdentity> {
        const id = integration.id
        const existing = this.inFlight.get(id)
        if (existing) {
            return existing
        }
        const cached = this.results.get(id)
        if (!force && cached && Date.now() - cached.at < TTL_MS) {
            return cached.identity
        }
        const request = checkIntegrationAccount(integration)
            .catch((err): AccountIdentity => ({
                // `checkIntegrationAccount` resolves its own expected failures;
                // this is for the ones nothing anticipated, which must still
                // leave a row with a state rather than a spinner for ever.
                state: 'error',
                message: String(err?.message ?? err),
                organizations: [],
            }))
            .then(identity => {
                this.results.set(id, { at: Date.now(), identity })
                return identity
            })
            .finally(() => { this.inFlight.delete(id) })
        this.inFlight.set(id, request)
        return request
    }

    /**
     * Check everything worth checking, together.
     *
     * An integration that is off, or missing a required setting, is answered
     * from what is already known — `checkIntegrationAccount` returns those
     * states without a request, so this costs nothing for them and the row
     * still gets a badge rather than staying blank.
     */
    async checkAll (integrations: Integration[], force = false): Promise<void> {
        await Promise.all(integrations.map(x => this.check(x, force)))
    }

    /** Drop what is known about one integration — its settings just changed. */
    invalidate (id: string): void {
        this.results.delete(id)
    }
}
