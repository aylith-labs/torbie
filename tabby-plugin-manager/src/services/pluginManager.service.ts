import { compare as semverCompare } from 'semver'
import { Observable, defer, from, map, of } from 'rxjs'
import { Injectable, Inject } from '@angular/core'
import { Logger, LogService, PlatformService, BOOTSTRAP_DATA, BootstrapData, PluginInfo } from 'tabby-core'
import { PLUGIN_BLACKLIST } from '../../../app/src/pluginBlacklist'
import { AvailablePluginInfo, RegistrySearchObject, arrangeAvailable, fromRegistry, matchRank, queryTerms } from '../pluginSearch'

/**
 * The search endpoint's largest page. Search runs over the whole catalogue now
 * (see pluginSearch.ts), so a catalogue cut off after one page would make
 * whatever sorts past it unfindable. 149 `tabby-plugin` packages on 2026-09-12.
 */
const REGISTRY_PAGE_SIZE = 250
/** A bound, not an expectation: 2000 packages per keyword. */
const REGISTRY_MAX_PAGES = 8
/** Reopening the page within this long reuses the list rather than asking again. */
const CATALOGUE_TTL_MS = 5 * 60 * 1000


@Injectable({ providedIn: 'root' })
export class PluginManagerService {
    logger: Logger
    userPluginsPath: string
    installedPlugins: PluginInfo[]

    private catalogue: Promise<AvailablePluginInfo[]>|null = null
    private catalogueRequestedAt = 0

    private constructor (
        log: LogService,
        private platform: PlatformService,
        @Inject(BOOTSTRAP_DATA) bootstrapData: BootstrapData,
    ) {
        this.logger = log.create('pluginManager')
        this.installedPlugins = [...bootstrapData.installedPlugins]
        this.installedPlugins.sort((a, b) => a.name.localeCompare(b.name))
        this.userPluginsPath = bootstrapData.userPluginsPath
    }

    /**
     * Every plugin the registry lists, highest npm search score first — the
     * order the Available list has always had.
     *
     * Two requests when the page opens, where typing used to cost four per
     * pause: the query went to the registry, which ignores it, and each `async`
     * pipe in the template subscribed to its own copy of the stream. Shared for
     * CATALOGUE_TTL_MS. A failure is not kept, so the next call asks again.
     */
    getCatalogue (refresh = false): Promise<AvailablePluginInfo[]> {
        let catalogue = this.catalogue
        if (refresh || !catalogue || Date.now() - this.catalogueRequestedAt > CATALOGUE_TTL_MS) {
            const pending = this.fetchCatalogue()
            pending.catch(() => {
                if (this.catalogue === pending) {
                    this.catalogue = null
                }
            })
            this.catalogue = pending
            this.catalogueRequestedAt = Date.now()
            catalogue = pending
        }
        return catalogue
    }

    listAvailable (query?: string): Observable<AvailablePluginInfo[]> {
        return defer(() => from(this.getCatalogue())).pipe(
            map(plugins => arrangeAvailable(plugins, query ?? '', 'relevance')),
        )
    }

    listInstalled (query: string): Observable<PluginInfo[]> {
        const terms = queryTerms(query)
        return of(this.installedPlugins.filter(plugin => matchRank(plugin, terms) !== null))
    }

    private async fetchCatalogue (): Promise<AvailablePluginInfo[]> {
        const lists = await Promise.all([
            this._listAvailableInternal('tabby-', 'tabby-plugin'),
            this._listAvailableInternal('terminus-', 'terminus-plugin'),
        ])
        const names = new Set<string>()
        return lists.flat()
            .filter(plugin => {
                if (names.has(plugin.name)) {
                    return false
                }
                names.add(plugin.name)
                return true
            })
            .sort((a, b) => b.searchScore! - a.searchScore!)
    }

    async _listAvailableInternal (namePrefix: string, keyword: string): Promise<AvailablePluginInfo[]> {
        // No query in the text: the registry does not filter by one alongside a
        // `keywords:` qualifier, it only re-ranks (see pluginSearch.ts).
        const objects: RegistrySearchObject[] = []
        for (let page = 0; page < REGISTRY_MAX_PAGES; page++) {
            const response = await fetch(`https://registry.npmjs.com/-/v1/search?text=keywords%3A${keyword}&size=${REGISTRY_PAGE_SIZE}&from=${page * REGISTRY_PAGE_SIZE}`)
            // A refusal still has a JSON body — a 429 is `{"code":"E429",…}` — so
            // this used to parse it, read `.objects` off it and throw a TypeError
            // inside the stream. That ended the stream, and search with it, for as
            // long as the page stayed open, with the spinner still turning.
            if (!response.ok) {
                throw new Error(`The npm registry answered HTTP ${response.status}`)
            }
            const body = await response.json()
            if (!Array.isArray(body?.objects)) {
                throw new Error('The npm registry answered without a list of packages')
            }
            objects.push(...body.objects)
            if (body.objects.length < REGISTRY_PAGE_SIZE || objects.length >= body.total) {
                break
            }
        }

        const versions: Record<string, AvailablePluginInfo[]> = {}
        for (const plugin of fromRegistry(objects, namePrefix, PLUGIN_BLACKLIST)) {
            // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
            versions[plugin.name] ??= []
            versions[plugin.name].push(plugin)
        }
        return Object.values(versions)
            .map(list => list.sort((a, b) => -semverCompare(a.version, b.version))[0])
            .sort((a, b) => a.name.localeCompare(b.name))
    }

    async installPlugin (plugin: PluginInfo): Promise<void> {
        try {
            await this.platform.installPlugin(plugin.packageName, plugin.version)
            this.installedPlugins = this.installedPlugins.filter(x => x.packageName !== plugin.packageName)
            this.installedPlugins.push(plugin)
        } catch (err) {
            this.logger.error(err)
            throw err
        }
    }

    async uninstallPlugin (plugin: PluginInfo): Promise<void> {
        try {
            await this.platform.uninstallPlugin(plugin.packageName)
            this.installedPlugins = this.installedPlugins.filter(x => x.packageName !== plugin.packageName)
        } catch (err) {
            this.logger.error(err)
            throw err
        }
    }
}
