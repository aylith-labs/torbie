import { Injectable, NgZone } from '@angular/core'

import { Logger, LogService, ConfigService, UpdaterService, PlatformService, TranslateService } from 'tabby-core'
import { ElectronService } from '../services/electron.service'
import { reduceUpdaterState, UpdaterEvent } from '../updaterState'

const UPDATES_URL = 'https://api.github.com/repos/aylith-labs/torbie/releases/latest'

/**
 * How long a check may take before the UI gives up on an answer. The main
 * process always answers now (see `checkForUpdates` in app/lib/window.ts), so
 * this only catches a main process that never received the request.
 */
const CHECK_TIMEOUT = 60_000

@Injectable()
export class ElectronUpdaterService extends UpdaterService {
    private logger: Logger
    private downloaded: Promise<boolean>
    private electronUpdaterAvailable = true
    private updateURL: string

    constructor (
        log: LogService,
        config: ConfigService,
        private translate: TranslateService,
        private platform: PlatformService,
        private electron: ElectronService,
        private zone: NgZone,
    ) {
        super()
        this.logger = log.create('updater')

        if (process.platform === 'linux' || process.env.PORTABLE_EXECUTABLE_FILE) {
            this.electronUpdaterAvailable = false
            return
        }

        // Every IPC listener's first argument is the event, not the payload —
        // the old `on('updater:error', err => …)` logged the IpcRendererEvent
        // and handed it to `reject`.
        const ipc = this.electron.ipcRenderer
        ipc.on('updater:update-available', (_event, version: string|null) => {
            this.logger.info('Update available', version)
            this.apply({ type: 'available', version: version ?? null })
        })
        ipc.on('updater:update-not-available', () => {
            this.logger.info('No updates')
            this.apply({ type: 'not-available' })
        })
        ipc.on('updater:download-progress', (_event, progress: { percent?: number }|null) => {
            this.apply({ type: 'progress', percent: progress?.percent ?? null })
        })
        ipc.on('updater:error', (_event, message: string) => {
            this.logger.error('Update failed:', message)
            this.apply({ type: 'error', message })
        })
        ipc.on('updater:update-downloaded', (_event, version: string|null) => {
            this.logger.info('Update downloaded', version)
            this.apply({ type: 'downloaded', version: version ?? null })
        })

        this.downloaded = new Promise<boolean>(resolve => {
            ipc.once('updater:update-downloaded', () => resolve(true))
        })

        config.ready$.toPromise().then(() => {
            if (config.store.enableAutomaticUpdates && !process.env.TABBY_DEV) {
                this.logger.debug('Checking for updates')
                this.check()
            }
        })
    }

    async check (): Promise<boolean> {
        if (!this.electronUpdaterAvailable) {
            return this.checkThroughGitHub()
        }
        if (this.state.kind === 'downloading' || this.state.kind === 'downloaded') {
            return true
        }
        this.apply({ type: 'check' })
        const ipc = this.electron.ipcRenderer
        return new Promise<boolean>(resolve => {
            // eslint-disable-next-line @typescript-eslint/init-declarations, prefer-const
            let timer: any
            const done = (available: boolean) => {
                clearTimeout(timer)
                ipc.off('updater:error', onError)
                ipc.off('updater:update-not-available', onNoUpdate)
                ipc.off('updater:update-available', onUpdate)
                resolve(available)
            }
            const onNoUpdate = () => done(false)
            const onUpdate = () => done(true)
            const onError = () => done(false)
            ipc.on('updater:error', onError)
            ipc.on('updater:update-not-available', onNoUpdate)
            ipc.on('updater:update-available', onUpdate)
            timer = setTimeout(() => {
                this.apply({ type: 'error', message: this.translate.instant('No answer from the updater') })
                done(false)
            }, CHECK_TIMEOUT)
            try {
                ipc.send('updater:check-for-updates')
            } catch (e) {
                this.logger.error('Could not ask for an update check', e)
                this.apply({ type: 'error', message: String(e?.message ?? e) })
                done(false)
            }
        })
    }

    /** Linux and portable builds: compare against the latest release and offer its page. */
    private async checkThroughGitHub (): Promise<boolean> {
        this.logger.debug('Checking for updates through fallback method.')
        this.state$.next({ kind: 'checking' })
        try {
            const response = await fetch(UPDATES_URL)
            if (!response.ok) {
                throw new Error(`GitHub answered ${response.status} ${response.statusText}`)
            }
            const data = await response.json()
            const version = data.tag_name.substring(1)
            if (this.electron.app.getVersion() !== version) {
                this.logger.info('Update available')
                this.updateURL = data.html_url
                this.state$.next({ kind: 'external', version })
                return true
            }
            this.logger.info('No updates')
            this.state$.next({ kind: 'not-available' })
            return false
        } catch (e) {
            this.logger.error('Update check failed', e)
            this.state$.next({ kind: 'error', message: String(e?.message ?? e) })
            return false
        }
    }

    async update (): Promise<void> {
        if (!this.electronUpdaterAvailable) {
            if (this.updateURL) {
                await this.electron.shell.openExternal(this.updateURL)
            }
            return
        }
        if ((await this.platform.showMessageBox(
            {
                type: 'warning',
                message: this.translate.instant('Installing the update will close all tabs and restart Torbie.'),
                buttons: [
                    this.translate.instant('Install and restart'),
                    this.translate.instant('Cancel'),
                ],
                defaultId: 0,
                cancelId: 1,
            },
        )).response === 0) {
            await this.downloaded
            this.electron.ipcRenderer.send('updater:quit-and-install')
        }
    }

    /** IPC callbacks arrive outside Angular's zone; re-enter it so the settings page redraws. */
    private apply (event: UpdaterEvent): void {
        const next = reduceUpdaterState(this.state, event)
        if (next !== this.state) {
            this.zone.run(() => this.state$.next(next))
        }
    }
}
