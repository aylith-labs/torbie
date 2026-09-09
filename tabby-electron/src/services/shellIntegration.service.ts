import * as path from 'path'
import * as fs from 'mz/fs'
import { execFile } from 'mz/child_process'
import { Injectable } from '@angular/core'
import { HostAppService, Platform } from 'tabby-core'
import { ElectronService } from '../services/electron.service'

/* eslint-disable block-scoped-var */

try {
    var wnr = require('windows-native-registry') // eslint-disable-line @typescript-eslint/no-var-requires, no-var
} catch (_) { }

@Injectable({ providedIn: 'root' })
export class ShellIntegrationService {
    private automatorWorkflows = ['Open Torbie here.workflow', 'Paste path into Torbie.workflow']
    private automatorWorkflowsLocation: string
    private automatorWorkflowsDestination: string
    private registryKeys = [
        {
            path: 'Software\\Classes\\Directory\\Background\\shell\\Torbie',
            value: 'Open Torbie here',
            command: 'open "%V"',
        },
        {
            path: 'SOFTWARE\\Classes\\Directory\\shell\\Torbie',
            value: 'Open Torbie here',
            command: 'open "%V"',
        },
        {
            path: 'Software\\Classes\\*\\shell\\Torbie',
            value: 'Paste path into Torbie',
            command: 'paste "%V"',
        },
    ]

    /**
     * Keys written under a previous name, swept on every install.
     *
     * A renamed integration does not remove its old registry key: it just
     * stops managing it, so the user is left with a context-menu entry
     * pointing at an executable that may no longer exist and no switch
     * anywhere that turns it off. Two names were already being cleaned up
     * here; `Tabby` joins them.
     */
    private staleRegistryKeys = [
        'Software\\Classes\\Directory\\Background\\shell\\Open Tabby here',
        'Software\\Classes\\*\\shell\\Paste path into Tabby',
        'Software\\Classes\\Directory\\Background\\shell\\Tabby',
        'SOFTWARE\\Classes\\Directory\\shell\\Tabby',
        'Software\\Classes\\*\\shell\\Tabby',
    ]

    private constructor (
        private electron: ElectronService,
        private hostApp: HostAppService,
    ) {
        if (this.hostApp.platform === Platform.macOS) {
            this.automatorWorkflowsLocation = path.join(
                path.dirname(path.dirname(this.electron.app.getPath('exe'))),
                'Resources',
                'extras',
                'automator-workflows',
            )
            this.automatorWorkflowsDestination = path.join(process.env.HOME!, 'Library', 'Services')
        }
        this.updatePaths()
    }

    async isInstalled (): Promise<boolean> {
        if (this.hostApp.platform === Platform.macOS) {
            return fs.exists(path.join(this.automatorWorkflowsDestination, this.automatorWorkflows[0]))
        } else if (this.hostApp.platform === Platform.Windows) {
            return !!wnr.getRegistryKey(wnr.HK.CU, this.registryKeys[0].path)
        }
        return true
    }

    async install (): Promise<void> {
        const exe: string = process.env.PORTABLE_EXECUTABLE_FILE ?? this.electron.app.getPath('exe')
        if (this.hostApp.platform === Platform.macOS) {
            for (const wf of this.automatorWorkflows) {
                await execFile('cp', ['-r', path.join(this.automatorWorkflowsLocation, wf), this.automatorWorkflowsDestination])
            }
        } else if (this.hostApp.platform === Platform.Windows) {
            for (const registryKey of this.registryKeys) {
                wnr.createRegistryKey(wnr.HK.CU, registryKey.path)
                wnr.createRegistryKey(wnr.HK.CU, registryKey.path + '\\command')
                wnr.setRegistryValue(wnr.HK.CU, registryKey.path, '', wnr.REG.SZ, registryKey.value)
                wnr.setRegistryValue(wnr.HK.CU, registryKey.path, 'Icon', wnr.REG.SZ, exe)
                wnr.setRegistryValue(wnr.HK.CU, registryKey.path + '\\command', '', wnr.REG.SZ, exe + ' ' + registryKey.command)
            }

            for (const stale of this.staleRegistryKeys) {
                if (wnr.getRegistryKey(wnr.HK.CU, stale)) {
                    wnr.deleteRegistryKey(wnr.HK.CU, stale)
                }
            }
        }
    }

    async remove (): Promise<void> {
        if (this.hostApp.platform === Platform.macOS) {
            for (const wf of this.automatorWorkflows) {
                await execFile('rm', ['-rf', path.join(this.automatorWorkflowsDestination, wf)])
            }
        } else if (this.hostApp.platform === Platform.Windows) {
            for (const registryKey of this.registryKeys) {
                wnr.deleteRegistryKey(wnr.HK.CU, registryKey.path)
            }
        }
    }

    private async updatePaths (): Promise<void> {
        // Update paths in case of an update
        if (this.hostApp.platform === Platform.Windows) {
            if (await this.isInstalled()) {
                await this.install()
            }
        }
    }
}
