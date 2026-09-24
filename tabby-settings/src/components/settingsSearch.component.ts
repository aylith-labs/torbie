import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker'
import {
    Component, ElementRef, EmbeddedViewRef, HostListener, Input, NgZone, OnDestroy, Optional, ViewChild, ViewContainerRef,
    ChangeDetectorRef,
} from '@angular/core'
import { NgbNav, NgbNavItem } from '@ng-bootstrap/ng-bootstrap'
import { ConfigService, TranslateService } from 'tabby-core'

import { SettingsTabProvider } from '../api'
import {
    makeSnippet, searchSettings, Snippet, SettingsSearchEntry, SettingsSearchResult, SETTINGS_PAGE_DESCRIPTIONS,
} from '../settingsSearch'
import { entryKey, innerTabLinks, isSectionAccordion, locate, normalizeText, scrapeSettingsPage } from '../settingsSearchIndex'
import { SettingsTabComponent } from './settingsTab.component'
import '../settingsSearch.scss'

/** One row of the results list, cut and split for display. */
export interface SettingsSearchResultView {
    result: SettingsSearchResult
    icon: string
    /** The page, then the section: where the result lives. */
    crumbs: Snippet[]
    title: Snippet
    description?: Snippet
}

/**
 * How long a page rendered for the index gets to draw what it draws from
 * ngOnInit. The index is built once per settings tab, on first use of the box.
 */
const INDEX_SETTLE_MS = 250
const INNER_TAB_SETTLE_MS = 120
const MAX_INNER_TABS = 6
const FLASH_MS = 1600
const LOCATE_TIMEOUT_MS = 3000

/**
 * A search box at the top of the settings nav.
 *
 * The index is built by rendering every page of the nav offscreen, the same
 * template the nav would render, and reading its rows (`settingsSearchIndex.ts`).
 * That covers a third-party plugin's page without the plugin doing anything,
 * and every string is already in the display language.
 */
@Component({
    standalone: false,
    selector: 'settings-search',
    templateUrl: './settingsSearch.component.pug',
    styleUrls: ['./settingsSearch.component.scss'],
})
export class SettingsSearchComponent implements OnDestroy {
    @Input() nav: NgbNav
    @Input() providers: SettingsTabProvider[] = []
    /** The element whose `.tab-pane.active` is the page on screen. */
    @Input() pages?: HTMLElement

    @ViewChild('input', { static: true }) input: ElementRef<HTMLInputElement>
    @ViewChild('indexHost', { read: ViewContainerRef, static: true }) indexHost: ViewContainerRef

    query = ''
    /** Results are showing. False after a result is opened, until the box is used again. */
    open = false
    indexing = false
    activeIndex = 0
    results: SettingsSearchResult[] = []
    view: SettingsSearchResultView[] = []

    private entries: SettingsSearchEntry[] = []
    private indexed = false
    private indexPromise: Promise<void> | null = null
    private destroyed = false
    private flashTimer?: any

    constructor (
        private zone: NgZone,
        private cdr: ChangeDetectorRef,
        private config: ConfigService,
        private translate: TranslateService,
        private host: ElementRef<HTMLElement>,
        /** The settings tab this sits in, so Ctrl+F only answers while it is the focused tab. */
        @Optional() private tab?: SettingsTabComponent,
    ) { }

    get placeholder (): string {
        return this.translate.instant(_('Search settings'))
    }

    ngOnDestroy (): void {
        this.destroyed = true
        clearTimeout(this.flashTimer)
    }

    /** Ctrl+F (⌘F) while this settings tab is the focused one. Nothing in the app binds it. */
    @HostListener('document:keydown', ['$event'])
    onDocumentKeyDown (event: KeyboardEvent): void {
        if (event.key.toLowerCase() !== 'f' || !(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) {
            return
        }
        if (this.tab && !this.tab.hasFocus) {
            return
        }
        if (!this.host.nativeElement.getClientRects().length) {
            return
        }
        event.preventDefault()
        event.stopPropagation()
        this.focus()
    }

    focus (): void {
        const input = this.input.nativeElement
        input.focus()
        input.select()
    }

    onFocus (): void {
        if (this.query.trim()) {
            this.open = true
        }
        void this.ensureIndex()
    }

    onQuery (): void {
        this.open = !!this.query.trim()
        this.activeIndex = 0
        void this.ensureIndex()
        this.runSearch()
    }

    onKeyDown (event: KeyboardEvent): void {
        switch (event.key) {
            case 'ArrowDown':
            case 'ArrowUp':
                // ngbNav moves between pages on the arrow keys from anywhere inside it.
                event.stopPropagation()
                event.preventDefault()
                if (!this.open && this.query.trim()) {
                    this.open = true
                    return
                }
                if (this.view.length) {
                    const step = event.key === 'ArrowDown' ? 1 : -1
                    this.activeIndex = (this.activeIndex + step + this.view.length) % this.view.length
                    this.scrollActiveIntoView()
                }
                break
            case 'Home':
            case 'End':
                event.stopPropagation()
                break
            case 'Enter':
                event.preventDefault()
                event.stopPropagation()
                if (this.open && this.view[this.activeIndex]) {
                    void this.openResult(this.activeIndex)
                }
                break
            case 'Escape':
                event.stopPropagation()
                event.preventDefault()
                if (this.query) {
                    this.clear()
                } else {
                    this.input.nativeElement.blur()
                }
                break
        }
    }

    clear (): void {
        this.query = ''
        this.open = false
        this.results = []
        this.view = []
        this.activeIndex = 0
    }

    private scrollActiveIntoView (): void {
        setTimeout(() => {
            document.getElementById(`settings-search-result-${this.activeIndex}`)?.scrollIntoView({ block: 'nearest' })
        })
    }

    private runSearch (): void {
        this.results = searchSettings(this.allEntries(), this.query)
        this.view = this.results.map(r => this.toView(r))
        if (this.activeIndex >= this.view.length) {
            this.activeIndex = 0
        }
    }

    /** Page entries are known from the nav alone, so they are searchable before the index is. */
    private allEntries (): SettingsSearchEntry[] {
        return this.indexed ? this.entries : this.tabEntries()
    }

    private toView (result: SettingsSearchResult): SettingsSearchResultView {
        const { entry, highlights } = result
        const icon = this.iconFor(entry.tabId)
        if (entry.kind === 'tab') {
            return {
                result,
                icon,
                crumbs: entry.group ? [makeSnippet(entry.group, highlights.group, 40)] : [],
                title: makeSnippet(entry.tabTitle, highlights.tabTitle, 80),
                description: entry.tabDescription ? makeSnippet(entry.tabDescription, highlights.tabDescription, 140) : undefined,
            }
        }
        const crumbs = [makeSnippet(entry.tabTitle, highlights.tabTitle, 40)]
        if (entry.kind === 'setting' && entry.section) {
            crumbs.push(makeSnippet(entry.section, highlights.section, 48))
        }
        return {
            result,
            icon,
            crumbs,
            title: makeSnippet(entry.title, entry.kind === 'section' ? highlights.section : highlights.title, 90),
            description: entry.description ? makeSnippet(entry.description, highlights.description, 140) : undefined,
        }
    }

    private iconFor (tabId: string): string {
        if (tabId === 'application') {
            return 'window-maximize'
        }
        if (tabId === 'config-file') {
            return 'code'
        }
        const icon = this.providers.find(p => p.id === tabId)?.icon ?? 'puzzle-piece'
        // A few plugins give the whole class list ("fas fa-keyboard") where the nav expects a bare name.
        return icon.replace(/^fa[srb]?\s+/, '').replace(/^fa-/, '')
    }

    // ── Index ────────────────────────────────────────────────────────────

    private navItems (): NgbNavItem[] {
        return this.nav?.items?.toArray() ?? []
    }

    /** The nav entry's own label, as drawn (translated), and the section heading above it. */
    private describeItem (item: NgbNavItem, order: number): SettingsSearchEntry | null {
        const link = document.getElementById(item.domId)
        const title = normalizeText(link?.textContent)
        if (!title) {
            return null
        }
        let group: string | undefined
        for (let li = link?.closest('li')?.previousElementSibling; li; li = li.previousElementSibling) {
            if (li.classList.contains('nav-group-label')) {
                group = normalizeText(li.textContent)
                break
            }
        }
        const id = String(item.id)
        const provider = this.providers.find(p => p.id === id) as (SettingsTabProvider & { description?: string }) | undefined
        const rawDescription = provider?.description ?? SETTINGS_PAGE_DESCRIPTIONS[id]
        const description = rawDescription ? this.translate.instant(rawDescription) : undefined
        return { kind: 'tab', tabId: id, tabTitle: title, title, tabDescription: description, group, order: order * 1000 }
    }

    private tabEntries (): SettingsSearchEntry[] {
        return this.navItems()
            .map((item, i) => this.describeItem(item, i))
            .filter((x): x is SettingsSearchEntry => !!x)
    }

    ensureIndex (): Promise<void> {
        this.indexPromise ??= this.buildIndex().catch(error => {
            console.warn('[settings-search] indexing failed', error)
            this.indexPromise = null
        })
        return this.indexPromise
    }

    /**
     * Render every page's content template into a hidden, inert host, open
     * every collapsed accordion group in it, read it, and throw it away.
     *
     * Opening a group writes its "collapsed" state to localStorage (the Link
     * Tooltip and Claude pages remember what was open), so every collapse key
     * that changes during the pass is put back afterwards.
     */
    private async buildIndex (): Promise<void> {
        const items = this.navItems()
        if (!items.length) {
            return
        }
        this.indexing = true
        this.cdr.markForCheck()
        const before = snapshotCollapseState()
        const views: { item: NgbNavItem, tab: SettingsSearchEntry, view: EmbeddedViewRef<unknown> }[] = []
        // Offscreen, inert (nothing in it can take focus — the Plugins page
        // focuses its search on open) and outside the settings nav, so nothing
        // that queries the nav's links sees another page's inner tabs.
        const stage = document.createElement('div')
        stage.className = 'settings-search-index'
        stage.setAttribute('inert', '')
        stage.setAttribute('aria-hidden', 'true')
        document.body.appendChild(stage)
        try {
            items.forEach((item, i) => {
                const tab = this.describeItem(item, i)
                const template = item.contentTpl?.templateRef
                if (!tab || !template) {
                    return
                }
                try {
                    const view = this.indexHost.createEmbeddedView(template)
                    for (const node of view.rootNodes) {
                        stage.appendChild(node)
                    }
                    view.detectChanges()
                    views.push({ item, tab, view })
                } catch (error) {
                    console.warn(`[settings-search] could not render ${tab.tabId} for the index`, error)
                }
            })

            // settings-tab-body creates its page after a setImmediate; give
            // pages a moment to draw what they draw from ngOnInit.
            await delay(INDEX_SETTLE_MS)
            this.zone.run(() => detectAll(views))
            let expanded = false
            for (const { view } of views) {
                for (const button of rootElements(view).flatMap(el => Array.from(el.querySelectorAll<HTMLElement>('.accordion-button.collapsed')))) {
                    if (!isSectionAccordion(button)) {
                        continue
                    }
                    button.click()
                    expanded = true
                }
            }
            if (expanded) {
                await delay(50)
                this.zone.run(() => detectAll(views))
            }

            const scraped = views.flatMap(({ tab, view }) => rootElements(view).map(root => {
                const links = innerTabLinks(root).slice(0, MAX_INNER_TABS)
                const original = links.find(link => link.classList.contains('active'))
                return {
                    tab,
                    root,
                    page: { tabId: tab.tabId, tabTitle: tab.tabTitle, tabDescription: tab.tabDescription, group: tab.group },
                    found: [] as SettingsSearchEntry[],
                    original,
                    others: links.filter(link => link !== original),
                }
            }))
            for (const s of scraped) {
                s.found.push(...scrapeSettingsPage(s.root, s.page, 0))
            }
            // A page with its own tabs only draws the selected one (Builds →
            // Options), so visit the rest — every page's next tab at once, so
            // the wait is paid per step rather than per tab — then go back.
            const steps = Math.max(0, ...scraped.map(s => s.others.length))
            for (let step = 0; step < steps; step++) {
                const moving = scraped.filter(s => s.others[step])
                this.zone.run(() => {
                    for (const s of moving) {
                        s.others[step].click()
                    }
                })
                await delay(INNER_TAB_SETTLE_MS)
                this.zone.run(() => detectAll(views))
                for (const s of moving) {
                    s.found.push(...scrapeSettingsPage(s.root, s.page, 0, normalizeText(s.others[step].textContent)))
                }
            }
            this.zone.run(() => {
                for (const s of scraped) {
                    if (s.original && s.others.length) {
                        s.original.click()
                    }
                }
            })

            const entries: SettingsSearchEntry[] = []
            for (const { tab } of views) {
                entries.push(tab)
                const seen = new Set<string>()
                let order = tab.order + 1
                for (const entry of scraped.filter(s => s.tab === tab).flatMap(s => s.found)) {
                    const key = entryKey(entry)
                    if (!seen.has(key)) {
                        seen.add(key)
                        entry.order = order++
                        entries.push(entry)
                    }
                }
            }
            // Pages with no template still get their nav entry.
            for (const tab of this.tabEntries()) {
                if (!entries.some(e => e.kind === 'tab' && e.tabId === tab.tabId)) {
                    entries.push(tab)
                }
            }
            this.entries = entries
            this.indexed = true
        } finally {
            for (const { view } of views) {
                try {
                    view.destroy()
                } catch { }
            }
            stage.remove()
            restoreCollapseState(before)
            this.indexing = false
            if (!this.destroyed) {
                this.runSearch()
                this.cdr.markForCheck()
            }
        }
    }

    // ── Opening a result ─────────────────────────────────────────────────

    async openResult (index: number): Promise<void> {
        const view = this.view[index]
        if (!view) {
            return
        }
        const entry = view.result.entry
        this.activeIndex = index
        this.open = false
        this.input.nativeElement.blur()
        this.nav.select(entry.tabId)
        this.cdr.detectChanges()
        if (entry.kind === 'tab') {
            this.activePane()?.parentElement?.scrollTo({ top: 0 })
            return
        }
        const target = await this.waitForTarget(entry)
        if (!target || this.destroyed) {
            return
        }
        target.scrollIntoView({
            block: 'center',
            behavior: this.config.store.accessibility?.animations === false ? 'auto' : 'smooth',
        })
        this.flash(target)
    }

    private activePane (): HTMLElement | null {
        return (this.pages ?? this.host.nativeElement.closest('settings-tab'))?.querySelector('.tab-pane.active') ?? null
    }

    /** Wait for the page to draw, open the group holding the entry if it is shut, then find the entry. */
    private async waitForTarget (entry: SettingsSearchEntry): Promise<HTMLElement | null> {
        const deadline = Date.now() + LOCATE_TIMEOUT_MS
        let clicked = false
        while (Date.now() < deadline && !this.destroyed) {
            const pane = this.activePane()
            if (pane) {
                const innerTab = entry.locator?.innerTab
                if (innerTab) {
                    const link = innerTabLinks(pane).find(l => normalizeText(l.textContent) === innerTab)
                    if (link && !link.classList.contains('active')) {
                        this.zone.run(() => link.click())
                        await delay(INNER_TAB_SETTLE_MS)
                        continue
                    }
                }
                const accordion = entry.locator?.accordion ?? -1
                if (accordion >= 0) {
                    const item = pane.querySelectorAll('.accordion-item')[accordion]
                    const button = item?.querySelector<HTMLElement>('.accordion-button')
                    if (button?.classList.contains('collapsed') && !clicked && entry.kind === 'setting') {
                        this.zone.run(() => button.click())
                        clicked = true
                    }
                }
                const found = locate(pane, entry) as HTMLElement | null
                if (found?.getClientRects().length) {
                    return found
                }
            }
            await delay(40)
        }
        return null
    }

    private flash (el: HTMLElement): void {
        for (const other of Array.from(document.querySelectorAll('.settings-search-flash'))) {
            other.classList.remove('settings-search-flash')
        }
        // Restart the animation if the same row is flashed twice.
        void el.offsetWidth
        el.classList.add('settings-search-flash')
        clearTimeout(this.flashTimer)
        this.flashTimer = setTimeout(() => el.classList.remove('settings-search-flash'), FLASH_MS)
    }
}

function delay (ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
}

function detectAll (views: { view: EmbeddedViewRef<unknown> }[]): void {
    for (const { view } of views) {
        try {
            view.detectChanges()
        } catch { }
    }
}

function rootElements (view: EmbeddedViewRef<unknown>): Element[] {
    return view.rootNodes.filter((n): n is Element => n instanceof Element)
}

/** Accordion pages remember which groups are open under keys like `claudeGroupCollapsed`. */
const COLLAPSE_KEY = /collaps|expand/i

function snapshotCollapseState (): Map<string, string | null> {
    const state = new Map<string, string | null>()
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i)
            if (key && COLLAPSE_KEY.test(key)) {
                state.set(key, localStorage.getItem(key))
            }
        }
    } catch { }
    return state
}

function restoreCollapseState (before: Map<string, string | null>): void {
    try {
        const now = snapshotCollapseState()
        for (const [key, value] of now) {
            const old = before.get(key)
            if (old === undefined) {
                localStorage.removeItem(key)
            } else if (old !== value && old !== null) {
                localStorage.setItem(key, old)
            }
        }
    } catch { }
}
