import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker'

import { SettingsTabProvider } from './api'

/**
 * One labelled section of the settings nav.
 *
 * A section names its pages by provider id, rather than each provider naming
 * its section, so upstream's providers are placed without an edit to any of
 * their files — every line changed in one of those is a line a cherry-pick has
 * to land — and the fork's own are placed without touching theirs either.
 */
export interface SettingsNavGroupDefinition {
    id: string
    /** Marked for extraction here, translated where it is drawn. */
    title: string
    /** Provider ids, most relevant first. A page this does not list follows them. */
    pages: string[]
}

export interface SettingsNavGroup {
    id: string
    title: string
    providers: SettingsTabProvider[]
}

export const SETTINGS_NAV_GROUPS: SettingsNavGroupDefinition[] = [
    { id: 'general', title: _('General'), pages: ['application', 'window', 'hotkeys'] },
    {
        id: 'terminal',
        title: _('Terminal'),
        pages: ['terminal', 'terminal-appearance', 'terminal-color-scheme', 'terminal-shell', 'resume'],
    },
    { id: 'connections', title: _('Connections'), pages: ['profiles', 'ssh', 'vault'] },
    { id: 'links', title: _('Links & integrations'), pages: ['link-tooltip', 'integrations'] },
    // `claude-status` is not ours. It is the third-party tabby-claude-status
    // plugin, which still owns audio, tab decoration and session restore beside
    // tabby-claude, so it is listed with the page it complements. Where that
    // plugin is not installed the id matches nothing and costs nothing.
    { id: 'claude', title: _('Claude'), pages: ['claude', 'claude-status'] },
    { id: 'plugins', title: _('Plugins'), pages: ['plugins'] },
    { id: 'development', title: _('Development'), pages: ['builds', 'upstream'] },
    { id: 'configuration', title: _('Configuration'), pages: ['config-sync', 'config-file'] },
]

/**
 * Where a page goes when neither it nor the table above names a section. That
 * is every settings page a Tabby plugin has, since none of them know sections
 * exist — so it has to be somewhere a plugin's page reads as belonging.
 */
export const DEFAULT_SETTINGS_NAV_GROUP = 'plugins'

/**
 * The two pages the settings tab draws itself rather than through a provider.
 *
 * Their nav entries stay written out where upstream put them, Application
 * ahead of the provider loop and Config file behind it, so the template's diff
 * is the loop and nothing else. That is only right while Application opens the
 * first section and Config file closes the last, which is why a section holding
 * one of them is drawn even when no provider lands in it.
 */
const TEMPLATE_PAGES = ['application', 'config-file']

export function groupSettingsProviders (providers: SettingsTabProvider[]): SettingsNavGroup[] {
    const home = new Map<string, string>()
    const members = new Map<string, SettingsTabProvider[]>()
    for (const definition of SETTINGS_NAV_GROUPS) {
        members.set(definition.id, [])
        for (const page of definition.pages) {
            if (!home.has(page)) {
                home.set(page, definition.id)
            }
        }
    }

    for (const provider of providers) {
        // A provider's own `group` wins, but only when it names a section that
        // exists. A typo, or a section from some other build, lands in the
        // default rather than taking the page out of the nav.
        const asked = typeof provider.group === 'string' && members.has(provider.group) ? provider.group : undefined
        const id = asked ?? home.get(provider.id) ?? DEFAULT_SETTINGS_NAV_GROUP
        members.get(id)?.push(provider)
    }

    const groups: SettingsNavGroup[] = []
    for (const definition of SETTINGS_NAV_GROUPS) {
        const listed = (members.get(definition.id) ?? []).sort(byRelevance(definition.pages))
        if (listed.length || definition.pages.some(page => TEMPLATE_PAGES.includes(page))) {
            groups.push({ id: definition.id, title: definition.title, providers: listed })
        }
    }
    return groups
}

/**
 * Pages the table lists, in its order. Anything else follows, `prioritized`
 * first, then by `weight`, then by title — the two hints a plugin already had
 * for "list me early", honoured within its section.
 */
function byRelevance (pages: string[]): (a: SettingsTabProvider, b: SettingsTabProvider) => number {
    const rank = (provider: SettingsTabProvider) => {
        const index = pages.indexOf(provider.id)
        return index === -1 ? pages.length : index
    }
    return (a, b) => rank(a) - rank(b)
        || Number(!!b.prioritized) - Number(!!a.prioritized)
        || (Number(a.weight) || 0) - (Number(b.weight) || 0)
        || String(a.title ?? '').localeCompare(String(b.title ?? ''))
}
