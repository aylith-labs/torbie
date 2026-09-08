import { Injectable } from '@angular/core'
import { SettingsTabProvider } from 'tabby-settings'

import { ResumeSettingsTabComponent } from './components/resumeSettingsTab.component'

/** @hidden */
@Injectable()
export class ResumeSettingsTabProvider extends SettingsTabProvider {
    id = 'resume'
    icon = 'rotate-left'
    title = 'Resume'
    // This whole page is the fork's, so the mark goes on the nav entry
    // once rather than on each of its rows.
    forkAdded = true

    getComponentType (): any {
        return ResumeSettingsTabComponent
    }
}
