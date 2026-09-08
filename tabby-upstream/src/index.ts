/// <reference path="./styles.d.ts" />
import { CommonModule } from '@angular/common'
import { NgModule } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { NgbModule } from '@ng-bootstrap/ng-bootstrap'
import TabbyCoreModule, { ConfigProvider } from 'tabby-core'
import { SettingsTabProvider } from 'tabby-settings'

import { UpstreamSettingsTabComponent } from './components/upstreamSettingsTab.component'
import { UpstreamConfigProvider } from './config'
import { UpstreamSettingsTabProvider } from './providers'
import { ForkMarksService } from './services/forkMarks.service'

// Global, by way of not being named *component.scss — see the file itself. The
// rows it styles are compiled into other packages' templates, which a
// component-scoped sheet could never reach.
import './forkMarks.scss'

/** @hidden */
@NgModule({
    imports: [
        CommonModule,
        FormsModule,
        NgbModule,
        TabbyCoreModule,
    ],
    declarations: [
        UpstreamSettingsTabComponent,
    ],
    providers: [
        { provide: ConfigProvider, useClass: UpstreamConfigProvider, multi: true },
        { provide: SettingsTabProvider, useClass: UpstreamSettingsTabProvider, multi: true },
    ],
})
// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export default class UpstreamModule {
    // Resolved here so the marks are applied at startup rather than only once
    // somebody opens the Upstream page. The service is otherwise never
    // injected by anything.
    constructor (forkMarks: ForkMarksService) {
        forkMarks.apply()
    }
}
