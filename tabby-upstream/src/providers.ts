import { Injectable } from '@angular/core'
import { SettingsTabProvider } from 'tabby-settings'

import { UpstreamSettingsTabComponent } from './components/upstreamSettingsTab.component'

@Injectable()
export class UpstreamSettingsTabProvider extends SettingsTabProvider {
    id = 'upstream'
    icon = 'code-branch'
    title = 'Upstream'
    // This whole page is the fork's, so the mark goes on the nav entry
    // once rather than on each of its rows.
    forkAdded = true

    getComponentType (): any {
        return UpstreamSettingsTabComponent
    }
}
