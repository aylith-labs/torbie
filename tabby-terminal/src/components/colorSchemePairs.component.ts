/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import deepEqual from 'deep-equal'
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker'

import { Component, Inject, ChangeDetectionStrategy, ChangeDetectorRef, HostBinding } from '@angular/core'
import { ConfigService, TerminalColorScheme } from 'tabby-core'
import { TerminalColorSchemeProvider } from '../api/colorSchemeProvider'
import { ColorSchemePair, pairColorSchemes } from '../colorSchemeTone'
import { getShowSwatches, setShowSwatches } from '../colorSchemeViewPrefs'

_('Search color scheme pairs')
_('No paired color schemes match')

/**
 * Designs that ship both halves, chosen once.
 *
 * The other two tabs each set one of `terminal.colorScheme` and
 * `terminal.lightColorScheme`; this sets both at once, which is the whole
 * point — picking Solarized here means the Dark tab shows Solarized Dark and
 * the Light tab shows Solarized Light, with nothing else to do.
 *
 * @hidden
 */
@Component({
    standalone: false,
    selector: 'color-scheme-pairs',
    templateUrl: './colorSchemePairs.component.pug',
    styleUrls: ['./colorSchemePairs.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ColorSchemePairsComponent {
    filter = ''
    pairs: ColorSchemePair[] = []
    visiblePairs: ColorSchemePair[] = []
    colorIndexes = [...new Array(16).keys()]
    showSwatches = getShowSwatches()

    @HostBinding('class.content-box') true

    constructor (
        @Inject(TerminalColorSchemeProvider) private colorSchemeProviders: TerminalColorSchemeProvider[],
        private changeDetector: ChangeDetectorRef,
        public config: ConfigService,
    ) { }

    async ngOnInit () {
        const stock = (await Promise.all(
            this.config.enabledServices(this.colorSchemeProviders).map(x => x.getSchemes()),
        )).reduce((a, b) => a.concat(b), [] as TerminalColorScheme[])
        const custom: TerminalColorScheme[] = this.config.store.terminal.customColorSchemes ?? []
        this.pairs = pairColorSchemes(custom.concat(stock))
        this.applyFilter()
        this.changeDetector.markForCheck()
    }

    applyFilter () {
        const needle = this.filter.trim().toLowerCase()
        this.visiblePairs = needle
            ? this.pairs.filter(p => p.name.toLowerCase().includes(needle)
                || p.dark.name.toLowerCase().includes(needle)
                || p.light.name.toLowerCase().includes(needle))
            : this.pairs
    }

    onFilterChange () {
        this.applyFilter()
        this.changeDetector.markForCheck()
    }

    setShowSwatches (value: boolean) {
        this.showSwatches = value
        setShowSwatches(value)
        this.changeDetector.markForCheck()
    }

    /**
     * Both halves in one write, then one save.
     *
     * Saving between the two would leave a moment where the dark scheme is the
     * new design and the light one is still the old — and `config.save()`
     * awaits the disk, so that moment is long enough for `config.changed$` to
     * fire and repaint the window half-way through.
     */
    selectPair (pair: ColorSchemePair) {
        this.config.store.terminal.colorScheme = { ...pair.dark }
        this.config.store.terminal.lightColorScheme = { ...pair.light }
        this.config.save()
        this.changeDetector.markForCheck()
    }

    isActive (pair: ColorSchemePair): boolean {
        return deepEqual(this.config.store.terminal.colorScheme, pair.dark)
            && deepEqual(this.config.store.terminal.lightColorScheme, pair.light)
    }

    pairTrackBy (_index: number, pair: ColorSchemePair) {
        return pair.name
    }
}
