import { Injectable } from '@angular/core'
import { ToolbarButtonProvider, ToolbarButton, AppService, HostAppService, HotkeysService, TranslateService, SplitTabComponent } from 'tabby-core'

import { SettingsTabComponent } from './components/settingsTab.component'

/** @hidden */
@Injectable()
export class ButtonProvider extends ToolbarButtonProvider {
    constructor (
        hostApp: HostAppService,
        hotkeys: HotkeysService,
        private app: AppService,
        private translate: TranslateService,
    ) {
        super()
        hostApp.settingsUIRequest$.subscribe(() => this.open())

        hotkeys.hotkey$.subscribe(async (hotkey) => {
            if (hotkey === 'settings') {
                this.open()
            }
        })
    }

    provide (): ToolbarButton[] {
        return [{
            icon: require('./icons/cog.svg'),
            title: this.translate.instant('Settings'),
            touchBarNSImage: 'NSTouchBarComposeTemplate',
            weight: 10,
            click: (): void => this.open(),
        }]
    }

    open (): void {
        // A Settings tab that has been split lives inside a container, so the
        // top-level list alone would miss it and open a second one.
        for (const tab of this.app.tabs) {
            if (tab instanceof SettingsTabComponent) {
                this.app.selectTab(tab)
                return
            }
            if (tab instanceof SplitTabComponent) {
                const inner = tab.getAllTabs().find(x => x instanceof SettingsTabComponent)
                if (inner) {
                    this.app.selectTab(tab)
                    tab.focus(inner)
                    return
                }
            }
        }
        this.app.openNewTabRaw({ type: SettingsTabComponent })
    }
}
