import type { LaunchRecord, LifecycleEvent } from './lifecycle'

/**
 * Turns a launch's merged timeline into what the Startup page draws. Pure, so
 * `test/waterfall.test.js` can hold it to fixed timelines.
 */

export type RowType = 'phase' | 'timed' | 'stall' | 'moment' | 'failure'

export interface WaterfallRow {
    kind: string
    label: string
    role: 'main' | 'renderer'
    pid: number
    window?: number
    type: RowType
    /** ms from process start. */
    start: number
    end: number
    duration: number
    detail?: string
}

const LABELS: Record<string, string> = {
    'process-start': 'Process started (Electron, before any app code)',
    'main-start': 'Main process: loading modules',
    'modules-loaded': 'Main process: reading config',
    'config-loaded': 'Main process: constructing the application',
    'application-constructed': 'Main process: protocol handlers, lock',
    'single-instance-lock': 'Main process: waiting for Electron ready',
    'app-ready': 'Electron ready: first window booting',
    'watchdog-armed': 'Boot watchdog armed',
    'window-constructed': 'Window constructed, page loading',
    'navigation-start': 'Renderer: loading the app bundle',
    'renderer-start': 'Renderer: app bundle evaluated, awaiting bootstrap data',
    'start-received': 'Renderer: loading the builtin packages',
    'builtins-required': 'Renderer: finding plugins',
    'plugins-found': 'Renderer: plugins found',
    'loading-plugins': 'Renderer: loading plugins',
    'plugin-loaded': 'Plugin loaded',
    'bootstrapping-angular': 'Angular: compiling and constructing modules',
    'modules-constructed': 'Angular: creating the root component',
    'root-component-created': 'Angular: finishing bootstrap',
    'ready': 'Angular ready',
    'config-ready': 'Config ready',
    'first-paint': 'First paint (splash)',
    'first-contentful-paint': 'Splash painted',
    'dom-ready': 'DOM ready',
    'ready-to-show': 'Ready to show',
    'did-finish-load': 'Page finished loading',
    'window-shown': 'Window shown',
    'window-created': 'Main process: first window resolved',
    'window-ready': 'First window ready — app:ready',
    'window-geometry': 'Window placed',
    'first-tab': 'First tab opened',
    'first-terminal-output': 'First terminal output',
    'tab-profile-resolved': 'Tab: profile resolved',
    'tab-frontend-ready': 'Tab: terminal ready for a session',
    'tab-pty-spawned': 'Tab: PTY spawned',
    'tab-first-output': 'Tab: first output on screen',
    'pty-spawned': 'Main process: PTY process started',
    'pty-first-data': 'Main process: PTY printed',
    'stall': 'Event loop blocked',
    'render-timing': 'Render timing summary',
    'window-focus': 'Window focused',
    'window-blur': 'Window lost focus',
    'window-show': 'Window shown',
    'window-hide': 'Window hidden',
    'window-minimize': 'Window minimized',
    'window-restore': 'Window restored',
    'window-maximize': 'Window maximized',
    'window-unmaximize': 'Window unmaximized',
    'window-close': 'Window closing',
    'window-closed': 'Window closed',
    'window-unresponsive': 'Window unresponsive',
    'window-responsive': 'Window responsive again',
    'power-suspend': 'System suspended',
    'power-resume': 'System resumed',
    'power-lock-screen': 'Screen locked',
    'power-unlock-screen': 'Screen unlocked',
    'second-instance': 'Another launch handed to this process',
    'before-quit': 'Quitting',
    'will-quit': 'Quit',
    'document-hidden': 'Page hidden',
    'document-visible': 'Page visible',
    'updater-check': 'Checking for updates',
    'update-available': 'Update available',
    'update-not-available': 'No update available',
    'update-downloaded': 'Update downloaded',
    'updater-error': 'Update check failed',
}

const FAILURE_KINDS = new Set([
    'uncaughtException', 'unhandledrejection', 'renderer-error', 'render-process-gone',
    'child-process-gone', 'window-render-process-gone', 'bootstrap-failed', 'window-create-failed',
    'window-open-failed', 'second-instance-failed', 'require-failed', 'updater-error',
])

export function labelFor (event: Pick<LifecycleEvent, 'kind' | 'detail'>): string {
    if (event.kind === 'plugin-loaded') {
        const name = (event.detail as any)?.name
        return name ? `Plugin loaded: ${name}` : LABELS['plugin-loaded']
    }
    if (event.kind.startsWith('slow:')) {
        return `Slow: ${event.kind.slice(5)}`
    }
    return LABELS[event.kind] ?? event.kind
}

function describeDetail (detail: unknown): string | undefined {
    if (detail === undefined || detail === null) {
        return undefined
    }
    if (typeof detail === 'string') {
        return detail
    }
    try {
        return JSON.stringify(detail)
    } catch {
        return String(detail)
    }
}

function rowType (event: LifecycleEvent): RowType {
    if (event.kind === 'stall') {
        return 'stall'
    }
    if (FAILURE_KINDS.has(event.kind)) {
        return 'failure'
    }
    if (event.phase) {
        return 'phase'
    }
    if (event.ms !== undefined) {
        return 'timed'
    }
    return 'moment'
}

/**
 * When the boot is over: the first terminal printing, or failing that the
 * first window reaching `app:ready`, or failing that the last boot phase.
 */
export function bootEnd (record: LaunchRecord): number {
    const m = record.milestones ?? {}
    for (const kind of ['first-terminal-output', 'window-ready', 'ready']) {
        if (typeof m[kind] === 'number') {
            return m[kind]
        }
    }
    const phases = record.events.filter(x => x.phase).map(x => x.t - record.startedAt)
    return phases.length ? Math.max(...phases) : 0
}

export interface RowOptions {
    /** Boot only, or everything this launch recorded. */
    scope: 'boot' | 'all'
    showPlugins: boolean
}

export function buildRows (record: LaunchRecord, options: RowOptions): WaterfallRow[] {
    const events = [...record.events].sort((a, b) => a.t - b.t)
    const origin = record.startedAt
    const end = bootEnd(record)
    const rows: WaterfallRow[] = []

    for (let i = 0; i < events.length; i++) {
        const event = events[i]
        // A mark and a report of the same moment (`window-ready` is both)
        // are one line on the page.
        const duplicate = events.slice(Math.max(0, i - 4), i)
            .some(x => x.kind === event.kind && x.pid === event.pid && Math.abs(x.t - event.t) < 5)
        if (duplicate) {
            continue
        }
        const type = rowType(event)
        const at = event.t - origin
        if (options.scope === 'boot' && at > end + 250) {
            continue
        }
        if (!options.showPlugins && event.kind === 'plugin-loaded') {
            continue
        }
        let start = at
        let finish = at
        if (type === 'phase') {
            // A phase lasts until the next phase in the same process.
            const next = events.slice(i + 1).find(x => x.phase && x.pid === event.pid)
            finish = next ? next.t - origin : at
        } else if (event.ms !== undefined) {
            start = at - event.ms
        }
        rows.push({
            kind: event.kind,
            label: labelFor(event),
            role: event.role,
            pid: event.pid,
            window: event.window,
            type,
            start: Math.max(0, Math.round(start)),
            end: Math.round(finish),
            duration: Math.max(0, Math.round(finish - start)),
            detail: describeDetail(event.detail),
        })
    }
    return rows
}

/** The stages a launch is compared by, each between two milestones. */
export const STAGES: { id: string, label: string, from: string[], to: string[] }[] = [
    { id: 'electron', label: 'Process → Electron ready', from: [], to: ['app-ready'] },
    // A hidden launch never shows its window, and never paints either until
    // something forces a frame, so the page having loaded — which is when a
    // visible launch shows it — stands in.
    { id: 'window', label: 'Electron ready → window on screen', from: ['app-ready'], to: ['window-shown', 'did-finish-load'] },
    { id: 'boot', label: 'Window on screen → app ready', from: ['window-shown', 'did-finish-load'], to: ['window-ready', 'ready'] },
    // Split at the first tab's PTY when that was recorded (1.0.3+): opening
    // the tab and starting its process, then the shell answering and the
    // answer reaching the screen. Older records have no PTY milestone, so
    // `tab` is left out and `terminal` runs from app ready as it always did.
    { id: 'tab', label: 'App ready → first tab\'s PTY spawned', from: ['window-ready', 'ready'], to: ['tab-pty-spawned'] },
    { id: 'terminal', label: 'PTY spawned → first terminal output', from: ['tab-pty-spawned', 'window-ready', 'ready'], to: ['first-terminal-output'] },
]

function firstOf (m: Record<string, number>, kinds: string[]): number | undefined {
    for (const kind of kinds) {
        if (typeof m[kind] === 'number') {
            return m[kind]
        }
    }
    return undefined
}

export interface StageSpan {
    id: string
    label: string
    start: number
    duration: number
}

export function stages (record: Pick<LaunchRecord, 'milestones'>): StageSpan[] {
    const m = record.milestones ?? {}
    const out: StageSpan[] = []
    for (const stage of STAGES) {
        const from = stage.from.length ? firstOf(m, stage.from) : 0
        const to = firstOf(m, stage.to)
        if (from === undefined || to === undefined || to < from) {
            continue
        }
        out.push({ id: stage.id, label: stage.label, start: from, duration: to - from })
    }
    return out
}

export function median (values: number[]): number | undefined {
    const sorted = values.filter(x => Number.isFinite(x)).sort((a, b) => a - b)
    if (!sorted.length) {
        return undefined
    }
    const mid = Math.floor(sorted.length / 2)
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function formatMs (ms: number | undefined): string {
    if (ms === undefined || !Number.isFinite(ms)) {
        return '—'
    }
    if (Math.abs(ms) < 1000) {
        return `${Math.round(ms)} ms`
    }
    return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`
}
