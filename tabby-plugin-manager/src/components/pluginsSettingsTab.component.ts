/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker'
import semverGt from 'semver/functions/gt'

import { ChangeDetectorRef, Component, HostBinding, Input } from '@angular/core'
import { ConfigService, PlatformService, PluginInfo } from 'tabby-core'
import { PluginManagerService } from '../services/pluginManager.service'
import {
    AvailablePluginInfo,
    AvailableSort,
    InstalledSort,
    SortState,
    arrangeAvailable,
    arrangeInstalled,
    parseSortState,
} from '../pluginSearch'

enum BusyState { Installing = 'Installing', Uninstalling = 'Uninstalling' }

const FORCE_ENABLE = ['tabby-core', 'tabby-settings', 'tabby-electron', 'tabby-web', 'tabby-plugin-manager']

/**
 * Which order each list is in. View state, so localStorage rather than
 * `config.yaml` — the shape `linkTooltipGroupCollapsed` already uses.
 */
const SORT_STATE_KEY = 'pluginsSortOrder'

_('Search plugins')
_('Sort plugins')

function loadSortState (): SortState {
    try {
        return parseSortState(JSON.parse(window.localStorage[SORT_STATE_KEY] ?? '{}'))
    } catch {
        return parseSortState(null)
    }
}

function saveSortState (state: SortState): void {
    try {
        window.localStorage[SORT_STATE_KEY] = JSON.stringify(state)
    } catch {
        // Losing view state costs the default order and nothing else.
    }
}

function isNewer (candidate: string, installed: string): boolean {
    try {
        return semverGt(candidate, installed)
    } catch {
        return false
    }
}

/** @hidden */
@Component({
    standalone: false,
    templateUrl: './pluginsSettingsTab.component.pug',
    styleUrls: ['./pluginsSettingsTab.component.scss'],
})
export class PluginsSettingsTabComponent {
    BusyState = BusyState
    @Input() knownUpgrades: Record<string, PluginInfo|null> = {}
    @Input() busy = new Map<string, BusyState>()
    @Input() erroredPlugin: string
    @Input() errorMessage: string

    @HostBinding('class.content-box') true

    /** Every plugin the registry lists, in its own order; null until it has answered. */
    catalogue: AvailablePluginInfo[]|null = null
    catalogueLoading = false
    catalogueError: string|null = null

    /**
     * What the two lists draw. Rebuilt when something they depend on changes —
     * a query, a sort, the catalogue arriving, an install — and never by a
     * method the template calls: an `*ngFor` over a fresh array re-creates every
     * row on every change-detection pass.
     */
    availablePlugins: AvailablePluginInfo[] = []
    installedPlugins: PluginInfo[] = []

    availableFilter = ''
    installedFilter = ''
    sort = loadSortState()

    private dateFormat = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
    private numberFormat = new Intl.NumberFormat()

    constructor (
        public config: ConfigService,
        private platform: PlatformService,
        public pluginManager: PluginManagerService,
        private changeDetector: ChangeDetectorRef,
    ) {
    }

    ngOnInit () {
        this.refreshInstalled()
        this.loadCatalogue()
    }

    async loadCatalogue (refresh = false): Promise<void> {
        this.catalogueLoading = true
        this.catalogueError = null
        try {
            this.catalogue = await this.pluginManager.getCatalogue(refresh)
            for (const plugin of this.pluginManager.installedPlugins) {
                this.knownUpgrades[plugin.name] = this.catalogue.find(x => x.name === plugin.name && isNewer(x.version, plugin.version)) ?? null
            }
        } catch (err) {
            console.error('Could not load the plugin list', err)
            this.catalogueError = err instanceof Error ? err.message : String(err)
        } finally {
            this.catalogueLoading = false
            this.refreshAvailable()
            // The answer arrives on a network callback. Ask for a pass rather than
            // rely on this component being checked eagerly: Angular 22 defaults to
            // OnPush, and only app/src/plugins.ts puts the old default back.
            this.changeDetector.markForCheck()
        }
    }

    openPluginsFolder (): void {
        this.platform.openPath(this.pluginManager.userPluginsPath)
    }

    searchAvailable (query: string) {
        this.availableFilter = query
        this.refreshAvailable()
    }

    searchInstalled (query: string) {
        this.installedFilter = query
        this.refreshInstalled()
    }

    sortAvailable (order: AvailableSort) {
        this.sort = { ...this.sort, available: order }
        saveSortState(this.sort)
        this.refreshAvailable()
    }

    sortInstalled (order: InstalledSort) {
        this.sort = { ...this.sort, installed: order }
        saveSortState(this.sort)
        this.refreshInstalled()
    }

    trackPlugin (_index: number, plugin: PluginInfo): string {
        return plugin.packageName
    }

    formatCount (count: number): string {
        return this.numberFormat.format(count)
    }

    formatDate (iso: string): string {
        const time = Date.parse(iso)
        return Number.isNaN(time) ? '' : this.dateFormat.format(time)
    }

    isAlreadyInstalled (plugin: PluginInfo): boolean {
        return this.pluginManager.installedPlugins.some(x => x.name === plugin.name)
    }

    async installPlugin (plugin: PluginInfo): Promise<void> {
        this.busy.set(plugin.name, BusyState.Installing)
        try {
            await this.pluginManager.installPlugin(plugin)
            this.busy.delete(plugin.name)
            this.refreshInstalled()
            this.refreshAvailable()
            this.config.requestRestart()
        } catch (err) {
            console.error('Error installing plugin', plugin.name, err)
            this.erroredPlugin = plugin.name
            this.errorMessage = err
            this.busy.delete(plugin.name)
            throw err
        }
    }

    async uninstallPlugin (plugin: PluginInfo): Promise<void> {
        this.busy.set(plugin.name, BusyState.Uninstalling)
        try {
            await this.pluginManager.uninstallPlugin(plugin)
            this.busy.delete(plugin.name)
            this.refreshInstalled()
            this.refreshAvailable()
            this.config.requestRestart()
        } catch (err) {
            console.error('Error uninstalling plugin', plugin.name, err)
            this.erroredPlugin = plugin.name
            this.errorMessage = err
            this.busy.delete(plugin.name)
            throw err
        }
    }

    async upgradePlugin (plugin: PluginInfo): Promise<void> {
        await this.installPlugin(this.knownUpgrades[plugin.name]!)
        this.knownUpgrades[plugin.name] = null
    }

    showPluginInfo (plugin: PluginInfo) {
        this.platform.openExternal('https://www.npmjs.com/package/' + plugin.packageName)
    }

    showPluginHomepage (plugin: PluginInfo) {
        this.platform.openExternal(plugin.homepage ?? '')
    }

    isPluginEnabled (plugin: PluginInfo) {
        return !this.config.store.pluginBlacklist.includes(plugin.name)
    }

    canDisablePlugin (plugin: PluginInfo) {
        return !FORCE_ENABLE.includes(plugin.packageName)
    }

    togglePlugin (plugin: PluginInfo) {
        if (this.isPluginEnabled(plugin)) {
            this.disablePlugin(plugin)
        } else {
            this.enablePlugin(plugin)
        }
    }

    enablePlugin (plugin: PluginInfo) {
        this.config.store.pluginBlacklist = this.config.store.pluginBlacklist.filter(x => x !== plugin.name)
        this.refreshInstalled()
        this.config.save()
        this.config.requestRestart()
    }

    disablePlugin (plugin: PluginInfo) {
        this.config.store.pluginBlacklist = [...this.config.store.pluginBlacklist, plugin.name]
        this.refreshInstalled()
        this.config.save()
        this.config.requestRestart()
    }

    private refreshAvailable (): void {
        // Installed plugins belong to the other tab.
        const notInstalled = (this.catalogue ?? []).filter(plugin => !this.isAlreadyInstalled(plugin))
        this.availablePlugins = arrangeAvailable(notInstalled, this.availableFilter, this.sort.available)
    }

    private refreshInstalled (): void {
        this.installedPlugins = arrangeInstalled(
            this.pluginManager.installedPlugins,
            this.installedFilter,
            this.sort.installed,
            plugin => this.isPluginEnabled(plugin),
        )
    }
}
