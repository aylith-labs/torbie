/// <reference path="./styles.d.ts" />
import { CommonModule } from '@angular/common'
import { NgModule } from '@angular/core'
import { NgbModule } from '@ng-bootstrap/ng-bootstrap'
import TabbyCoreModule, { AppService, ConfigService } from 'tabby-core'
import { SettingsTabProvider } from 'tabby-settings'
import { TerminalDecorator } from 'tabby-terminal'
import { first } from 'rxjs'

import { StartupSettingsTabComponent } from './components/startupSettingsTab.component'
import { RenderTimingDecorator } from './decorator'
import { lifecycleNote } from './lifecycle'
import { StartupSettingsTabProvider } from './providers'

export { RenderTiming } from './timing'

/** @hidden */
@NgModule({
    imports: [
        CommonModule,
        NgbModule,
        TabbyCoreModule,
    ],
    declarations: [
        StartupSettingsTabComponent,
    ],
    providers: [
        { provide: TerminalDecorator, useClass: RenderTimingDecorator, multi: true },
        { provide: SettingsTabProvider, useClass: StartupSettingsTabProvider, multi: true },
    ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export default class RenderTimingModule {
    // The renderer's half of the launch timeline that only a plugin can see:
    // when config was ready, when the first tab opened (the first terminal's
    // output is marked by the decorator), and the page being hidden and shown.
    constructor (app: AppService, config: ConfigService) {
        config.ready$.pipe(first()).subscribe(() => lifecycleNote('config-ready'))
        app.tabOpened$.pipe(first()).subscribe(tab => lifecycleNote('first-tab', { type: tab?.constructor?.name }))
        document.addEventListener('visibilitychange', () => {
            lifecycleNote(document.hidden ? 'document-hidden' : 'document-visible')
        })
    }
}
