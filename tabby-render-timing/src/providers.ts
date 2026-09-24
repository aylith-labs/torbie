import { Injectable } from '@angular/core'
import { SettingsTabProvider } from 'tabby-settings'

import { StartupSettingsTabComponent } from './components/startupSettingsTab.component'

@Injectable()
export class StartupSettingsTabProvider extends SettingsTabProvider {
    id = 'startup'
    icon = 'stopwatch'
    title = 'Startup & lifecycle'
    // Also listed in tabby-settings' section table; saying so here as well
    // keeps it under Development in a build whose table predates it.
    group = 'development'
    wide = true
    // The whole page is the fork's.
    forkAdded = true

    getComponentType (): any {
        return StartupSettingsTabComponent
    }
}
