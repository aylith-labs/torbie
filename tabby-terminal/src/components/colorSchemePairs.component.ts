/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import deepEqual from 'deep-equal'
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker'

import { Component, Inject, Input, ChangeDetectionStrategy, ChangeDetectorRef, HostBinding } from '@angular/core'
import { ConfigService, TerminalColorScheme } from 'tabby-core'
import { TerminalColorSchemeProvider } from '../api/colorSchemeProvider'
import { ColorSchemePair, pairColorSchemes } from '../colorSchemeTone'
import { getShowSwatches, setShowSwatches } from '../colorSchemeViewPrefs'

_('No paired color schemes match')

/**
 * Designs that ship both halves, chosen once.
 *
 * The other two tabs each set one of `terminal.colorScheme` and
 * `terminal.lightColorScheme`; this sets both at once, which is the whole
 * point — picking Solarized here means the Dark tab shows Solarized Dark and
 * the Light tab shows Solarized Light, with nothing else to do.
 *
 * A design with more than two variants is listed as its own pair and then one
 * row per other variant, each set against the design's other half — Tomorrow,
 * then Tomorrow Night Blue with Tomorrow, and so on — so every combination the
 * design intends is one click, with its preview, and nothing else is offered.
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
    /**
     * The page's search, shared with the other two tabs. The page owns it
     * because this component is destroyed whenever another tab is selected.
     */
    @Input() filter = ''
    pairs: ColorSchemePair[] = []
    visiblePairs: ColorSchemePair[] = []
    /** Worked out when the pairs or the selection change, not twice per row per pass. */
    activePair: ColorSchemePair|null = null
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
        this.activePair = this.pairs.find(pair => this.isActive(pair)) ?? null
        this.applyFilter()
        this.changeDetector.markForCheck()
    }

    ngOnChanges () {
        this.applyFilter()
        this.changeDetector.markForCheck()
    }

    applyFilter () {
        const needle = (this.filter ?? '').trim().toLowerCase()
        this.visiblePairs = needle
            ? this.pairs.filter(pair => [pair.name, pair.design, pair.dark.name, pair.light.name]
                .some(name => name.toLowerCase().includes(needle)))
            : this.pairs
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
        this.activePair = pair
        this.changeDetector.markForCheck()
    }

    isActive (pair: ColorSchemePair): boolean {
        return deepEqual(this.config.store.terminal.colorScheme, pair.dark)
            && deepEqual(this.config.store.terminal.lightColorScheme, pair.light)
    }

    /**
     * Both halves, because a name alone is no longer unique: a design's own
     * row and each of its variants share a half.
     */
    pairTrackBy (_index: number, pair: ColorSchemePair) {
        return `${pair.dark.name}\n${pair.light.name}`
    }
}
