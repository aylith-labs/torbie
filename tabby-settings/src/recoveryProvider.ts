import { Injectable } from '@angular/core'
import { NewTabParameters, RecoveryToken, TabRecoveryProvider } from 'tabby-core'
import { SettingsTabComponent } from './components/settingsTab.component'

export const SETTINGS_TAB_TOKEN_TYPE = 'app:settings'

/**
 * Rebuilds a Settings tab from its token.
 *
 * A tab with no recovery token cannot be duplicated, and duplicating is how a
 * tab is split and how it is handed to another window — so Split did nothing
 * for Settings and "Open in new window" closed nothing and opened nothing. The
 * token is the page that was open, which is all the state the tab has.
 */
/** @hidden */
@Injectable()
export class SettingsTabRecoveryProvider extends TabRecoveryProvider<SettingsTabComponent> {
    async applicableTo (recoveryToken: RecoveryToken): Promise<boolean> {
        return recoveryToken.type === SETTINGS_TAB_TOKEN_TYPE
    }

    async recover (recoveryToken: RecoveryToken): Promise<NewTabParameters<SettingsTabComponent>> {
        return {
            type: SettingsTabComponent,
            inputs: typeof recoveryToken.activeTab === 'string' ? { activeTab: recoveryToken.activeTab } : {},
        }
    }
}
