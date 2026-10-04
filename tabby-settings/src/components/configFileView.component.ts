import * as yaml from 'js-yaml'
import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges } from '@angular/core'
import { ConfigService } from 'tabby-core'

import {
    buildConfigTree,
    CONFIG_VIEW_STORAGE_KEY,
    ConfigFileView,
    ConfigMarks,
    ConfigNode,
    parseStoredView,
} from '../configView'

/**
 * Which keys are the fork's own, and which upstream keys have no control —
 * the list `check-fork-marks.mjs` holds the settings pages to. It is derived
 * from git and checked in CI, so reading it here costs nothing and cannot
 * drift without that check failing first. Bundled at build time; a plugin
 * build that cannot find it simply draws no fork marks.
 */
function loadMarks (): ConfigMarks {
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const data = require('../../../scripts/dev/fork-settings.json')
        return { forkAdded: data.forkAdded ?? [], configOnly: data.configOnly ?? [] }
    } catch {
        return {}
    }
}

const MARKS = loadMarks()

/**
 * The Config file page's editor area: a structured, read-only tree of the
 * parsed config (the default) or the raw text, highlighted and editable, with
 * the choice remembered. Saving, validity and "Show config file" stay with
 * the settings tab, exactly as before; this only replaces the textareas.
 */
@Component({
    standalone: false,
    selector: 'config-file-view',
    templateUrl: './configFileView.component.pug',
    styleUrls: ['./configFileView.component.scss'],
})
export class ConfigFileViewComponent implements OnChanges {
    @Input() text = ''
    @Output() textChange = new EventEmitter<string>()
    @Input() showDefaults = false

    view: ConfigFileView = 'structured'
    defaultsText: string
    tree: ConfigNode[] = []
    defaultsTree: ConfigNode[] = []
    parseError: string|null = null

    private defaults: Record<string, any>
    private builtFrom: string|null = null

    constructor (config: ConfigService) {
        this.defaults = config.getDefaults()
        this.defaultsText = yaml.dump(this.defaults)
        this.defaultsTree = buildConfigTree(this.defaults, null, MARKS)
        try {
            this.view = parseStoredView(window.localStorage.getItem(CONFIG_VIEW_STORAGE_KEY))
        } catch {
            this.view = 'structured'
        }
    }

    ngOnChanges (changes: SimpleChanges): void {
        if (changes.text && this.view === 'structured') {
            this.rebuild()
        }
    }

    setView (view: ConfigFileView): void {
        this.view = view
        try {
            window.localStorage.setItem(CONFIG_VIEW_STORAGE_KEY, view)
        } catch { }
        if (view === 'structured') {
            this.rebuild()
        }
    }

    onTextChange (text: string): void {
        this.text = text
        this.textChange.emit(text)
    }

    /** Parsing is skipped while the raw view is up: typing there must not pay for a tree nobody sees. */
    private rebuild (): void {
        const text = this.text ?? ''
        if (text === this.builtFrom) {
            return
        }
        this.builtFrom = text
        try {
            const parsed = yaml.load(text)
            this.tree = buildConfigTree(parsed ?? {}, this.defaults, MARKS)
            this.parseError = null
        } catch (e: any) {
            this.tree = []
            this.parseError = e?.message ?? String(e)
        }
    }
}
