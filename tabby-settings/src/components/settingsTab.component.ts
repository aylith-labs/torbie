/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker'
import * as yaml from 'js-yaml'
import { debounce } from 'utils-decorators/dist/esm/debounce/debounce'
import { Component, Inject, Input, HostBinding, Injector } from '@angular/core'
import {
    ConfigService,
    BaseTabComponent,
    HostAppService,
    Platform,
    HomeBaseService,
    UpdaterService,
    UpdaterState,
    PlatformService,
    HostWindowService,
    AppService,
    LocaleService,
    TranslateService,
} from 'tabby-core'

import { SettingsTabProvider } from '../api'
import { groupSettingsProviders, SettingsNavGroup } from '../settingsGroups'
import { ReleaseNotesComponent } from './releaseNotesTab.component'
import { describeUpdaterState } from '../updateStatus'

/** @hidden */
@Component({
    standalone: false,
    selector: 'settings-tab',
    templateUrl: './settingsTab.component.pug',
    styleUrls: [
        './settingsTab.component.scss',
    ],
})
export class SettingsTabComponent extends BaseTabComponent {
    @Input() activeTab: string
    Platform = Platform
    configDefaults: any
    configFile: string
    isShellIntegrationInstalled = false
    /** Where an update stands; drawn by the Application page under the version. */
    updaterState: UpdaterState = { kind: 'idle' }
    /** The line under the button, already translated; empty when there is nothing to say. */
    updateMessage = ''
    showConfigDefaults = false
    allLanguages = LocaleService.allLanguages
    @HostBinding('class.pad-window-controls') padWindowControls = false
    /** The nav's labelled sections. Application and Config file are drawn by the template. */
    navGroups: SettingsNavGroup[]

    constructor (
        public config: ConfigService,
        public hostApp: HostAppService,
        public hostWindow: HostWindowService,
        public homeBase: HomeBaseService,
        public platform: PlatformService,
        public locale: LocaleService,
        public updater: UpdaterService,
        private app: AppService,
        @Inject(SettingsTabProvider) public settingsProviders: SettingsTabProvider[],
        translate: TranslateService,
        injector: Injector,
    ) {
        super(injector)
        this.setTitle(translate.instant(_('Settings')))
        this.settingsProviders = config.enabledServices(this.settingsProviders)
        this.settingsProviders = this.settingsProviders.filter(x => !!x.getComponentType())
        this.settingsProviders.sort((a, b) => a.weight - b.weight + a.title.localeCompare(b.title))
        this.navGroups = groupSettingsProviders(this.settingsProviders)

        this.configDefaults = yaml.dump(config.getDefaults())

        const onConfigChange = () => {
            this.configFile = config.readRaw()
            this.padWindowControls = hostApp.platform === Platform.macOS
                && config.store.appearance.tabsLocation !== 'top'
        }

        this.subscribeUntilDestroyed(config.changed$, onConfigChange)
        onConfigChange()

        this.subscribeUntilDestroyed(updater.state$, state => {
            this.updaterState = state
            this.updateMessage = describeUpdaterState(state, (text, params) => translate.instant(text, params))
        })
    }

    async ngOnInit () {
        this.isShellIntegrationInstalled = await this.platform.isShellIntegrationInstalled()
    }

    async toggleShellIntegration () {
        if (!this.isShellIntegrationInstalled) {
            await this.platform.installShellIntegration()
        } else {
            await this.platform.uninstallShellIntegration()
        }
        this.isShellIntegrationInstalled = await this.platform.isShellIntegrationInstalled()
    }

    ngOnDestroy () {
        this.config.save()
    }

    restartApp () {
        this.hostApp.relaunch()
    }

    @debounce(500)
    saveConfiguration (requireRestart?: boolean) {
        this.config.save()
        if (requireRestart) {
            this.config.requestRestart()
        }
    }

    saveConfigFile () {
        if (this.isConfigFileValid()) {
            this.config.writeRaw(this.configFile)
        }
    }

    showConfigFile () {
        this.platform.showItemInFolder(this.platform.getConfigPath()!)
    }

    isConfigFileValid () {
        try {
            yaml.load(this.configFile)
            return true
        } catch {
            return false
        }
    }

    /** The outcome, error included, arrives through `updaterState`; `check()` never rejects. */
    async checkForUpdates () {
        await this.updater.check()
    }

    get updatePercent (): number|null {
        const state = this.updaterState
        return state.kind === 'downloading' && state.percent != null ? Math.round(state.percent) : null
    }



    showReleaseNotes () {
        this.app.openNewTabRaw({
            type: ReleaseNotesComponent,
        })
    }
}
