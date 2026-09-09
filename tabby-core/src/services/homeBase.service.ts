import { Injectable, Inject } from '@angular/core'
import { ConfigService } from './config.service'
import { PlatformService, BOOTSTRAP_DATA, BootstrapData, HostAppService } from '../api'

/** Where this build sends people who click Source code or Report a problem. */
export const PROJECT_URL = 'https://github.com/aylith-labs/torbie'

@Injectable({ providedIn: 'root' })
export class HomeBaseService {
    appVersion: string

    /** @hidden */
    private constructor (
        private config: ConfigService,
        private platform: PlatformService,
        private hostApp: HostAppService,
        @Inject(BOOTSTRAP_DATA) private bootstrapData: BootstrapData,
    ) {
        // The compiled-in version, for the same reason as the build tooltip:
        // this string is what the settings header shows and what a bug report
        // leads with, and `app.getVersion()` answers differently in a source
        // build than in a packaged one built from the identical commit.
        this.appVersion = process.env.TABBY_BUILD_VERSION ?? platform.getAppVersion()
    }

    openGitHub (): void {
        this.platform.openExternal(PROJECT_URL)
    }

    reportBug (): void {
        let body = `Version: ${this.appVersion}\n`
        body += `Platform: ${this.hostApp.platform} ${process.arch} ${this.platform.getOSRelease()}\n`
        const plugins = this.bootstrapData.installedPlugins.filter(x => !x.isBuiltin).map(x => x.name)
        body += `Plugins: ${plugins.join(', ') || 'none'}\n`
        body += `Frontend: ${this.config.store.terminal?.frontend}\n\n`
        this.platform.openExternal(`${PROJECT_URL}/issues/new?body=${encodeURIComponent(body)}`)
    }
}
