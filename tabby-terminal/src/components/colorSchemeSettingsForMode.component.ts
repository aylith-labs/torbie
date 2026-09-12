/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import deepEqual from 'deep-equal'
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker'

import { Component, Inject, Input, ChangeDetectionStrategy, ChangeDetectorRef, HostBinding, SimpleChanges } from '@angular/core'
import { ConfigService, PlatformService, TerminalColorScheme, TranslateService } from 'tabby-core'
import { TerminalColorSchemeProvider } from '../api/colorSchemeProvider'
import { schemeTone } from '../colorSchemeTone'
import {
    SchemePreviewPosition, SchemeToneFilter,
    getPreviewPosition, getShowSwatches, toneFilterForMode,
    setPreviewPosition, setShowSwatches,
} from '../colorSchemeViewPrefs'

_('All')
_('Dark')
_('Light')
_('Show swatches')
_('Preview on the right')

/** @hidden */
@Component({
    standalone: false,
    selector: 'color-scheme-settings-for-mode',
    templateUrl: './colorSchemeSettingsForMode.component.pug',
    styleUrls: ['./colorSchemeSettingsForMode.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ColorSchemeSettingsForModeComponent {
    @Input() configKey: 'colorScheme'|'lightColorScheme'

    @Input() stockColorSchemes: TerminalColorScheme[] = []
    @Input() customColorSchemes: TerminalColorScheme[] = []
    @Input() allColorSchemes: TerminalColorScheme[] = []
    /** The page's search, shared by all three tabs; the page owns it. */
    @Input() filter = ''
    @Input() editing = false
    colorIndexes = [...new Array(16).keys()]

    /**
     * Which tones the list shows. It opens on the tab's own tone — the Dark
     * mode tab lists dark schemes — and All or the other tone is an override
     * for this visit. See `toneFilterForMode` for why it is not remembered.
     */
    toneFilter: SchemeToneFilter = 'all'

    /** How the list is laid out. Remembered per machine, not in the config. */
    showSwatches = getShowSwatches()
    previewPosition: SchemePreviewPosition = getPreviewPosition()

    /**
     * The list after the tone filter and the search box, computed once per
     * change rather than per row: this is `OnPush`, and the template used to
     * ask `scheme.name.toLowerCase().includes(...)` for all 191 of them on
     * every pass through a `[hidden]` binding.
     */
    visibleSchemes: TerminalColorScheme[] = []

    currentStockScheme: TerminalColorScheme|null = null
    currentCustomScheme: TerminalColorScheme|null = null

    @HostBinding('class.content-box') true

    constructor (
        @Inject(TerminalColorSchemeProvider) private colorSchemeProviders: TerminalColorSchemeProvider[],
        private changeDetector: ChangeDetectorRef,
        private platform: PlatformService,
        private translate: TranslateService,
        public config: ConfigService,
    ) { }

    async ngOnInit () {
        // Before the first await, so the first render already shows this tab's
        // tone. Nothing the reader does can have happened yet.
        this.toneFilter = toneFilterForMode(this.configKey)

        this.stockColorSchemes = (await Promise.all(this.config.enabledServices(this.colorSchemeProviders).map(x => x.getSchemes()))).reduce((a, b) => a.concat(b))
        this.stockColorSchemes.sort((a, b) => a.name.localeCompare(b.name))
        this.customColorSchemes = this.config.store.terminal.customColorSchemes
        this.changeDetector.markForCheck()

        this.update()
    }

    ngOnChanges (changes: SimpleChanges) {
        if (changes.configKey && !changes.configKey.firstChange) {
            this.toneFilter = toneFilterForMode(this.configKey)
        }
        // A keystroke in the page's search changes only `filter`, and needs
        // only the list refiltered — not every scheme compared against the
        // current one again.
        if (changes.filter && Object.keys(changes).length === 1) {
            this.applyFilters()
            this.changeDetector.markForCheck()
            return
        }
        this.update()
    }

    selectScheme (scheme: TerminalColorScheme) {
        this.config.store.terminal[this.configKey] = { ...scheme }
        this.config.save()
        this.cancelEditing()
        this.update()
    }

    update () {
        this.currentCustomScheme = this.findMatchingScheme(this.config.store.terminal[this.configKey], this.customColorSchemes)
        this.currentStockScheme = this.findMatchingScheme(this.config.store.terminal[this.configKey], this.stockColorSchemes)
        this.allColorSchemes = this.customColorSchemes.concat(this.stockColorSchemes)
        this.applyFilters()
        this.changeDetector.markForCheck()
    }

    applyFilters () {
        const needle = (this.filter ?? '').trim().toLowerCase()
        this.visibleSchemes = this.allColorSchemes.filter(scheme => {
            if (this.toneFilter !== 'all' && schemeTone(scheme) !== this.toneFilter) {
                return false
            }
            return !needle || scheme.name.toLowerCase().includes(needle)
        })
    }

    /** An override for this visit, so it is deliberately not written anywhere. */
    setToneFilter (value: SchemeToneFilter) {
        this.toneFilter = value
        this.applyFilters()
        this.changeDetector.markForCheck()
    }

    setShowSwatches (value: boolean) {
        this.showSwatches = value
        setShowSwatches(value)
        this.changeDetector.markForCheck()
    }

    setPreviewPosition (value: SchemePreviewPosition) {
        this.previewPosition = value
        setPreviewPosition(value)
        this.changeDetector.markForCheck()
    }

    schemeTrackBy (_index: number, scheme: TerminalColorScheme) {
        return scheme.name
    }

    editScheme () {
        this.editing = true
    }

    saveScheme () {
        this.customColorSchemes = this.customColorSchemes.filter(x => x.name !== this.config.store.terminal[this.configKey].name)
        this.customColorSchemes.push(this.config.store.terminal[this.configKey])
        this.config.store.terminal.customColorSchemes = this.customColorSchemes
        this.config.save()
        this.cancelEditing()
        this.update()
    }

    cancelEditing () {
        this.editing = false
    }

    async deleteScheme (scheme: TerminalColorScheme) {
        if ((await this.platform.showMessageBox(
            {
                type: 'warning',
                message: this.translate.instant('Delete "{name}"?', scheme),
                buttons: [
                    this.translate.instant('Delete'),
                    this.translate.instant('Keep'),
                ],
                defaultId: 1,
                cancelId: 1,
            },
        )).response === 0) {
            this.customColorSchemes = this.customColorSchemes.filter(x => x.name !== scheme.name)
            this.config.store.terminal.customColorSchemes = this.customColorSchemes
            this.config.save()
            this.update()
        }
    }

    getCurrentSchemeName () {
        return (this.currentCustomScheme ?? this.currentStockScheme)?.name ?? 'Custom'
    }

    findMatchingScheme (scheme: TerminalColorScheme, schemes: TerminalColorScheme[]) {
        return schemes.find(x => deepEqual(x, scheme)) ?? null
    }

    colorsTrackBy (index) {
        return index
    }
}
