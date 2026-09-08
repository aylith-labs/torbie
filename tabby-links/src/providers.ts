import { Injectable } from '@angular/core'
import { SettingsTabProvider } from 'tabby-settings'

import { IntegrationsSettingsTabComponent } from './components/integrationsSettingsTab.component'
import { LinkTooltipSettingsTabComponent } from './components/linkTooltipSettingsTab.component'

@Injectable()
export class LinkTooltipSettingsTabProvider extends SettingsTabProvider {
    id = 'link-tooltip'
    icon = 'link'
    title = 'Link Tooltip'
    // This whole page is the fork's, so the mark goes on the nav entry
    // once rather than on each of its rows.
    forkAdded = true

    getComponentType (): any {
        return LinkTooltipSettingsTabComponent
    }
}

@Injectable()
export class IntegrationsSettingsTabProvider extends SettingsTabProvider {
    id = 'integrations'
    icon = 'plug'
    title = 'Integrations'
    // This whole page is the fork's, so the mark goes on the nav entry
    // once rather than on each of its rows.
    forkAdded = true

    getComponentType (): any {
        return IntegrationsSettingsTabComponent
    }
}
