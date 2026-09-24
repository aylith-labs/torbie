/**
 * The renderer's side of the launch timeline, and the one shape both the
 * marks and the Startup page read.
 *
 * The recorder lives in the app bundle and publishes itself on the global
 * (see `app/lib/diagnostics.ts`); a plugin cannot import it, so it is looked
 * up here and every call is a no-op when it is absent — the honest state under
 * tabby-web and in tests.
 */

export interface LifecycleEvent {
    t: number
    role: 'main' | 'renderer'
    pid: number
    kind: string
    phase?: boolean
    ms?: number
    detail?: unknown
    window?: number
}

export interface LaunchRecord {
    id: string
    startedAt: number
    pid: number
    version: string
    execPath: string
    packaged: boolean
    dev: boolean
    hidden?: boolean
    milestones: Record<string, number>
    events: LifecycleEvent[]
    droppedEvents: number
    savedAt?: number
    ended?: boolean
}

export interface LifecycleSnapshot {
    current: LaunchRecord
    history: LaunchRecord[]
    milestones: string[]
}

function recorder (): any {
    return (window as any).__tabbyDiagnostics ?? null
}

/** A boot phase: it changes what a stall is attributed to. */
export function lifecycleMark (kind: string, detail?: unknown): void {
    recorder()?.mark?.(kind, detail)
}

/** A moment worth a line on the timeline. */
export function lifecycleNote (kind: string, detail?: unknown): void {
    recorder()?.note?.(kind, detail)
}

/** The merged timeline and launch history, from the main process. */
export async function fetchLifecycle (): Promise<LifecycleSnapshot | null> {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { ipcRenderer } = require('electron')
        return await ipcRenderer.invoke('lifecycle:get')
    } catch {
        return null
    }
}
