import { BehaviorSubject } from 'rxjs'

/**
 * Where an update stands, for the UI to draw. `external` is the fallback
 * path (Linux, portable): the update is a release page to open, not a file
 * that was downloaded.
 */
export type UpdaterState =
    | { kind: 'idle' }
    | { kind: 'checking' }
    | { kind: 'not-available' }
    | { kind: 'downloading', version: string|null, percent: number|null }
    | { kind: 'downloaded', version: string|null }
    | { kind: 'external', version: string|null }
    | { kind: 'error', message: string }

export abstract class UpdaterService {
    /** Every change of state, starting from `idle`. Implementations that cannot update leave it there. */
    readonly state$ = new BehaviorSubject<UpdaterState>({ kind: 'idle' })

    get state (): UpdaterState {
        return this.state$.value
    }

    /**
     * Resolves true when an update is available (downloading, downloaded or
     * external), false when there is none — and false when the check failed,
     * with the reason in `state`. It does not reject, so a caller cannot be
     * left waiting on a promise that never settles.
     */
    abstract check (): Promise<boolean>
    abstract update (): Promise<void>
}
