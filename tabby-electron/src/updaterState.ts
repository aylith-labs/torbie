import type { UpdaterState } from 'tabby-core'

/**
 * What the main process says about an update, reduced to one state for the
 * UI. Pure, so `tabby-electron/test/updaterState.test.js` can run it without
 * an app.
 */
export type UpdaterEvent =
    | { type: 'check' }
    | { type: 'available', version: string|null }
    | { type: 'progress', percent: number|null }
    | { type: 'not-available' }
    | { type: 'downloaded', version: string|null }
    | { type: 'error', message: string }

const MAX_ERROR_LENGTH = 240

/**
 * The line of an updater error worth showing. electron-updater's messages run
 * to a stack and a dump of response headers after the first line — "Cannot
 * find latest.yml in the latest release artifacts (<url>): HttpError: 404"
 * then twenty lines of `x-github-request-id` — so the UI gets the first.
 */
export function summarizeUpdaterError (message: unknown): string {
    const text = String(message ?? '').trim()
    const first = text.split(/\r?\n/).find(line => line.trim())?.trim() ?? ''
    if (!first) {
        return 'Unknown error'
    }
    return first.length > MAX_ERROR_LENGTH ? `${first.slice(0, MAX_ERROR_LENGTH - 1)}…` : first
}

export function reduceUpdaterState (state: UpdaterState, event: UpdaterEvent): UpdaterState {
    switch (event.type) {
        case 'check':
            // A check while a download runs or waits to be installed changes
            // nothing the user can act on; do not hide the progress or the
            // install button behind a spinner.
            if (state.kind === 'downloading' || state.kind === 'downloaded') {
                return state
            }
            return { kind: 'checking' }
        case 'available':
            if (state.kind === 'downloaded') {
                return state
            }
            return {
                kind: 'downloading',
                version: event.version ?? (state.kind === 'downloading' ? state.version : null),
                percent: state.kind === 'downloading' ? state.percent : null,
            }
        case 'progress':
            if (state.kind === 'downloaded') {
                return state
            }
            return {
                kind: 'downloading',
                version: state.kind === 'downloading' ? state.version : null,
                percent: event.percent == null ? null : Math.max(0, Math.min(100, event.percent)),
            }
        case 'downloaded':
            return {
                kind: 'downloaded',
                version: event.version ?? (state.kind === 'downloading' ? state.version : null),
            }
        case 'not-available':
            if (state.kind === 'downloaded') {
                return state
            }
            return { kind: 'not-available' }
        case 'error':
            return { kind: 'error', message: summarizeUpdaterError(event.message) }
    }
}
