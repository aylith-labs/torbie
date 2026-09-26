import { app, BrowserWindow, ipcMain, powerMonitor } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

import { getTimeline, note, onTimelineEntry, TimelineEntry } from './diagnostics'

/**
 * The whole life of this run, from every process, and the runs before it.
 *
 * `diagnostics.ts` keeps a timeline per process. This merges them: the main
 * process's own entries arrive through `onTimelineEntry`, and each renderer
 * streams its entries here over `lifecycle:event` as they happen. The result
 * is served to Settings → Startup (`lifecycle:get`), and a summary of each
 * launch is kept in `<config dir>/launch-history.json` so a slow start can be
 * compared with the ones before it rather than argued about.
 *
 * Nothing here is on the startup path in any way that costs: it only appends
 * to arrays until the boot has settled, then writes one file, off the loop.
 */

export interface LifecycleEvent extends TimelineEntry {
    /** The BrowserWindow a renderer entry came from. */
    window?: number
}

export interface LaunchRecord {
    /** Stable id: process start time plus pid. */
    id: string
    startedAt: number
    pid: number
    version: string
    execPath: string
    packaged: boolean
    dev: boolean
    /** Started with `--hidden`: the window was never shown. */
    hidden: boolean
    /** Milestone offsets from process start, in ms — the comparable part. */
    milestones: Record<string, number>
    events: LifecycleEvent[]
    droppedEvents: number
    /** When this record was last written. */
    savedAt?: number
    /** True when it was written on the way out, so it is the whole run. */
    ended?: boolean
}

const HISTORY_FILE = 'launch-history.json'
const HISTORY_LIMIT = 30
/** Events kept per launch in the history file: the boot, then the latest. */
const HISTORY_HEAD = 250
const HISTORY_TAIL = 80
/** In memory: generous, since the page reads it live. */
const LIVE_LIMIT = 2000

/**
 * The milestones compared across launches, in the order they happen. Each is
 * the *first* occurrence of that kind in the merged timeline.
 */
export const MILESTONES = [
    'main-start',
    'modules-loaded',
    'config-loaded',
    'app-ready',
    'window-constructed',
    'window-shown',
    'did-finish-load',
    'renderer-start',
    'first-contentful-paint',
    'plugins-found',
    'loading-plugins',
    'bootstrapping-angular',
    'ready',
    'window-ready',
    'first-tab',
    // The first tab's own phases (every tab records them; the milestone is
    // the first of each): profile found, PTY started, the process printed,
    // and that output reached the screen.
    'tab-profile-resolved',
    'tab-pty-spawned',
    'pty-first-data',
    'first-terminal-output',
]

const events: LifecycleEvent[] = []
let dropped = 0
let saveTimer: ReturnType<typeof setTimeout> | null = null
let processStart = Date.now()

function historyPath (): string | null {
    const dir = process.env.TABBY_CONFIG_DIRECTORY
    return dir ? path.join(dir, HISTORY_FILE) : null
}

function push (entry: LifecycleEvent): void {
    events.push(entry)
    if (events.length > LIVE_LIMIT) {
        // Keep the boot; drop from just after it.
        events.splice(HISTORY_HEAD, 1)
        dropped++
    }
    // Also after the 15s fallback has already written the record: the first
    // output arriving *late* is exactly the launch worth having on disk, and
    // before this it only reached the file on quit.
    if (entry.kind === 'first-terminal-output') {
        scheduleSave(2000)
    }
}

function milestones (list: LifecycleEvent[]): Record<string, number> {
    const out: Record<string, number> = {}
    const sorted = [...list].sort((a, b) => a.t - b.t)
    for (const entry of sorted) {
        if (MILESTONES.includes(entry.kind) && !(entry.kind in out)) {
            out[entry.kind] = Math.round(entry.t - processStart)
        }
    }
    return out
}

export function currentLaunch (): LaunchRecord {
    const sorted = [...events].sort((a, b) => a.t - b.t)
    return {
        id: `${processStart}-${process.pid}`,
        startedAt: processStart,
        pid: process.pid,
        version: process.env.TABBY_BUILD_VERSION ?? app.getVersion(),
        execPath: process.execPath,
        packaged: app.isPackaged,
        dev: !!process.env.TABBY_DEV,
        hidden: process.argv.includes('--hidden'),
        milestones: milestones(sorted),
        events: sorted,
        droppedEvents: dropped,
    }
}

/** What goes to disk: the boot in full and the most recent of the rest. */
function trimmed (record: LaunchRecord): LaunchRecord {
    const list = record.events
    if (list.length <= HISTORY_HEAD + HISTORY_TAIL) {
        return record
    }
    return {
        ...record,
        events: [...list.slice(0, HISTORY_HEAD), ...list.slice(-HISTORY_TAIL)],
        droppedEvents: record.droppedEvents + list.length - HISTORY_HEAD - HISTORY_TAIL,
    }
}

function parseHistory (text: string): LaunchRecord[] {
    try {
        const parsed = JSON.parse(text)
        return Array.isArray(parsed?.launches) ? parsed.launches : []
    } catch {
        return []
    }
}

/** Off the loop: the file is up to a few hundred KB. */
export async function readHistory (): Promise<LaunchRecord[]> {
    const file = historyPath()
    if (!file) {
        return []
    }
    try {
        return parseHistory(await fs.promises.readFile(file, 'utf8'))
    } catch {
        return []
    }
}

function merged (history: LaunchRecord[], ended: boolean): string {
    const current = trimmed({ ...currentLaunch(), savedAt: Date.now(), ended })
    const launches = history.filter(x => x.id !== current.id)
    launches.push(current)
    return JSON.stringify({ version: 1, launches: launches.slice(-HISTORY_LIMIT) })
}

function save (ended = false): void {
    const file = historyPath()
    if (!file) {
        return
    }
    if (ended) {
        // On the way out there is no next tick to write in.
        try {
            let history: LaunchRecord[] = []
            try {
                history = parseHistory(fs.readFileSync(file, 'utf8'))
            } catch {
                // No history yet.
            }
            fs.writeFileSync(file, merged(history, true))
        } catch {
            // Nothing useful left to do about it.
        }
        return
    }
    void readHistory().then(history => {
        const tmp = `${file}.${process.pid}.tmp`
        fs.writeFile(tmp, merged(history, false), err => {
            if (err) {
                return
            }
            fs.rename(tmp, file, () => { /* a lost history write is not worth reporting */ })
        })
    })
}

function scheduleSave (ms: number): void {
    if (saveTimer) {
        clearTimeout(saveTimer)
    }
    saveTimer = setTimeout(() => {
        saveTimer = null
        save()
    }, ms)
}

/** Window events worth a line: what the user saw happen to the window. */
const WINDOW_EVENTS = [
    'show', 'hide', 'minimize', 'restore', 'maximize', 'unmaximize',
    'enter-full-screen', 'leave-full-screen', 'close', 'closed',
] as const

/**
 * Start collecting. Called once, straight after diagnostics are installed, so
 * the main process's own marks are all caught; anything recorded before this
 * is copied in from the timeline.
 */
export function initLifecycle (): void {
    const origin = typeof performance !== 'undefined' ? performance.timeOrigin : NaN
    processStart = Number.isFinite(origin) ? Math.round(origin) : Date.now()

    for (const entry of getTimeline().entries) {
        push(entry)
    }
    onTimelineEntry(entry => push(entry))

    ipcMain.on('lifecycle:event', (event, entry: TimelineEntry) => {
        if (!entry || typeof entry.t !== 'number' || typeof entry.kind !== 'string') {
            return
        }
        push({ ...entry, window: BrowserWindow.fromWebContents(event.sender)?.id })
    })
    ipcMain.handle('lifecycle:get', async () => ({
        current: currentLaunch(),
        history: await readHistory(),
        milestones: MILESTONES,
    }))

    app.on('browser-window-created', (_event, window) => {
        const id = window.id
        for (const name of WINDOW_EVENTS) {
            window.on(name as any, () => note(`window-${name}`, { window: id }))
        }
    })
    app.on('browser-window-focus', (_event, window) => note('window-focus', { window: window.id }))
    app.on('browser-window-blur', (_event, window) => note('window-blur', { window: window.id }))
    app.on('second-instance', () => note('second-instance'))
    app.on('before-quit', () => {
        note('before-quit')
        save(true)
    })
    app.on('will-quit', () => note('will-quit'))

    app.whenReady().then(() => {
        for (const name of ['suspend', 'resume', 'lock-screen', 'unlock-screen', 'shutdown'] as const) {
            powerMonitor.on(name as any, () => note(`power-${name}`))
        }
    }, () => { /* never rejects */ })

    // Settled: the first terminal printed something (see `push`), or long
    // enough after the first window booted that it is not going to.
    ipcMain.once('app:ready', () => scheduleSave(15000))
}
