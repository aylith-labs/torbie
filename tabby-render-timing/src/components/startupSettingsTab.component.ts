import { Component, OnDestroy } from '@angular/core'
import { PlatformService } from 'tabby-core'

import { fetchLifecycle, LaunchRecord, LifecycleSnapshot } from '../lifecycle'
import { bootEnd, buildRows, formatMs, median, stages, StageSpan, WaterfallRow } from '../waterfall'

interface HistoryRow {
    record: LaunchRecord
    current: boolean
    when: Date
    stages: StageSpan[]
    total: number | undefined
    shown: number | undefined
    ready: number | undefined
    output: number | undefined
}

interface Summary {
    label: string
    hint: string
    value: number | undefined
    median: number | undefined
}

/**
 * Settings → Startup: this run's whole lifecycle as a waterfall, and the
 * launches before it for comparison.
 *
 * Everything drawn here comes from `lifecycle:get` (`app/lib/lifecycle.ts`),
 * which merges the main process's timeline with every renderer's. The page
 * reads, it never measures, so opening it costs one IPC round trip and one
 * read of `launch-history.json`.
 */
@Component({
    standalone: false,
    selector: 'startup-settings-tab',
    templateUrl: './startupSettingsTab.component.pug',
    styleUrls: ['./startupSettingsTab.component.scss'],
})
export class StartupSettingsTabComponent implements OnDestroy {
    snapshot: LifecycleSnapshot | null = null
    loading = true
    unavailable = false
    selected: LaunchRecord | null = null
    scope: 'boot' | 'all' = 'boot'
    showPlugins = false
    rows: WaterfallRow[] = []
    scale = 1
    ticks: number[] = []
    summaries: Summary[] = []
    history: HistoryRow[] = []
    historyScale = 1
    later: WaterfallRow[] = []

    formatMs = formatMs

    private refreshTimer: any = null

    constructor (private platform: PlatformService) {
        void this.refresh()
        // Later lifecycle events keep arriving while the page is open.
        this.refreshTimer = setInterval(() => {
            if (this.selected?.id === this.snapshot?.current.id) {
                void this.refresh(true)
            }
        }, 5000)
    }

    ngOnDestroy (): void {
        clearInterval(this.refreshTimer)
    }

    async refresh (quiet = false): Promise<void> {
        if (!quiet) {
            this.loading = true
        }
        const snapshot = await fetchLifecycle()
        this.loading = false
        if (!snapshot) {
            this.unavailable = true
            return
        }
        const keepSelection = this.selected && this.selected.id !== snapshot.current.id
            ? snapshot.history.find(x => x.id === this.selected!.id) ?? null
            : null
        this.snapshot = snapshot
        this.selected = keepSelection ?? snapshot.current
        this.buildHistory()
        this.rebuild()
    }

    select (record: LaunchRecord): void {
        this.selected = record
        this.rebuild()
    }

    setScope (scope: 'boot' | 'all'): void {
        this.scope = scope
        this.rebuild()
    }

    togglePlugins (): void {
        this.showPlugins = !this.showPlugins
        this.rebuild()
    }

    get isCurrent (): boolean {
        return !!this.selected && this.selected.id === this.snapshot?.current.id
    }

    private previous (): LaunchRecord[] {
        const currentId = this.snapshot?.current.id
        return (this.snapshot?.history ?? []).filter(x => x.id !== currentId && x.id !== this.selected?.id)
    }

    private rebuild (): void {
        const record = this.selected
        if (!record) {
            return
        }
        const all = buildRows(record, { scope: 'all', showPlugins: this.showPlugins })
        const end = bootEnd(record)
        this.rows = this.scope === 'boot' ? all.filter(x => x.start <= end + 250) : all
        this.later = buildRows(record, { scope: 'all', showPlugins: false })
            .filter(x => x.start > end + 250)
            .reverse()
        const max = Math.max(1, ...this.rows.map(x => x.end))
        this.scale = max
        this.ticks = niceTicks(max)

        const m = record.milestones ?? {}
        const prev = this.previous()
        const med = (kind: string) => median(prev.map(x => x.milestones?.[kind]).filter(x => typeof x === 'number'))
        const shownKind = shownMilestone(record)
        this.summaries = [
            { label: 'Electron ready', hint: 'process start → app ready event', value: m['app-ready'], median: med('app-ready') },
            { label: 'Window on screen', hint: shownKind === 'window-shown' ? 'the window is shown, splash and all' : 'page loaded — a hidden launch is never shown', value: m[shownKind], median: med(shownKind) },
            { label: 'App ready', hint: 'Angular booted, app:ready', value: m['window-ready'] ?? m.ready, median: med('window-ready') },
            { label: 'First output', hint: 'the first terminal printed', value: m['first-terminal-output'], median: med('first-terminal-output') },
        ]
    }

    private buildHistory (): void {
        const snapshot = this.snapshot!
        const list = [...snapshot.history.filter(x => x.id !== snapshot.current.id), snapshot.current]
            .sort((a, b) => b.startedAt - a.startedAt)
        this.history = list.map(record => {
            const m = record.milestones ?? {}
            const spans = stages(record)
            return {
                record,
                current: record.id === snapshot.current.id,
                when: new Date(record.startedAt),
                stages: spans,
                total: spans.length ? Math.max(...spans.map(x => x.start + x.duration)) : undefined,
                shown: m[shownMilestone(record)],
                ready: m['window-ready'] ?? m.ready,
                output: m['first-terminal-output'],
            }
        })
        this.historyScale = Math.max(1, ...this.history.map(x => x.total ?? 0))
    }

    delta (summary: Summary): string {
        if (summary.value === undefined || summary.median === undefined) {
            return ''
        }
        const diff = summary.value - summary.median
        const sign = diff >= 0 ? '+' : '−'
        return `${sign}${formatMs(Math.abs(diff))} vs median`
    }

    deltaClass (summary: Summary): string {
        if (summary.value === undefined || summary.median === undefined) {
            return ''
        }
        const ratio = summary.value / Math.max(1, summary.median)
        return ratio > 1.25 ? 'worse' : ratio < 0.8 ? 'better' : ''
    }

    left (value: number, scale = this.scale): string {
        return `${Math.max(0, Math.min(100, value / scale * 100))}%`
    }

    width (row: { duration: number }, scale = this.scale): string {
        return `${Math.max(0, Math.min(100, row.duration / scale * 100))}%`
    }

    at (row: WaterfallRow): string {
        return `+${formatMs(row.start)}`
    }

    clock (row: WaterfallRow): string {
        if (!this.selected) {
            return ''
        }
        return new Date(this.selected.startedAt + row.start).toLocaleTimeString()
    }

    process (row: WaterfallRow): string {
        if (row.role === 'main') {
            return 'main'
        }
        return row.window !== undefined ? `window ${row.window}` : 'renderer'
    }

    trackRow (index: number, row: WaterfallRow): string {
        return `${index}:${row.kind}:${row.start}`
    }

    trackHistory (_index: number, row: HistoryRow): string {
        return row.record.id
    }

    copy (): void {
        if (this.selected) {
            this.platform.setClipboard({ text: JSON.stringify(this.selected, null, 2) })
        }
    }
}

/** When the window appeared, or for a hidden launch, when it would have. */
function shownMilestone (record: LaunchRecord): string {
    return typeof record.milestones?.['window-shown'] === 'number' ? 'window-shown' : 'did-finish-load'
}

/** Gridlines at a round step, about six of them. */
function niceTicks (max: number): number[] {
    const raw = max / 6
    const magnitude = 10 ** Math.floor(Math.log10(Math.max(1, raw)))
    const step = [1, 2, 5, 10].map(x => x * magnitude).find(x => x >= raw) ?? magnitude * 10
    const out: number[] = []
    for (let t = step; t < max; t += step) {
        out.push(t)
    }
    return out
}
