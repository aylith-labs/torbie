/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import deepEqual from 'deep-equal'
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker'

import { Component, Inject, Input, ChangeDetectionStrategy, ChangeDetectorRef, HostBinding } from '@angular/core'
import { ConfigService, PlatformService, TerminalColorScheme, TranslateService } from 'tabby-core'
import { TerminalColorSchemeProvider } from '../api/colorSchemeProvider'
import { schemeTone } from '../colorSchemeTone'
import {
    SchemePreviewPosition, SchemeToneFilter,
    getPreviewPosition, getShowSwatches, getToneFilter,
    setPreviewPosition, setShowSwatches, setToneFilter,
} from '../colorSchemeViewPrefs'

_('Search color schemes')
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
    @Input() filter = ''
    @Input() editing = false
    colorIndexes = [...new Array(16).keys()]

    /** How the list is shown. Remembered per machine, not in the config. */
    toneFilter: SchemeToneFilter = getToneFilter()
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
        this.stockColorSchemes = (await Promise.all(this.config.enabledServices(this.colorSchemeProviders).map(x => x.getSchemes()))).reduce((a, b) => a.concat(b))
        this.stockColorSchemes.sort((a, b) => a.name.localeCompare(b.name))
        this.customColorSchemes = this.config.store.terminal.customColorSchemes
        this.changeDetector.markForCheck()

        this.update()
    }

    ngOnChanges () {
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
        const needle = this.filter.trim().toLowerCase()
        this.visibleSchemes = this.allColorSchemes.filter(scheme => {
            if (this.toneFilter !== 'all' && schemeTone(scheme) !== this.toneFilter) {
                return false
            }
            return !needle || scheme.name.toLowerCase().includes(needle)
        })
    }

    /** Every one of these is a write the next visit has to see. */
    setToneFilter (value: SchemeToneFilter) {
        this.toneFilter = value
        setToneFilter(value)
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

    onFilterChange () {
        this.applyFilters()
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
