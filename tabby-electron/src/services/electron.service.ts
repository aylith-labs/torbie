import { Injectable } from '@angular/core'
import { App, IpcRenderer, Shell, Dialog, GlobalShortcut, Screen, AutoUpdater, TouchBar, BrowserWindow, Menu, MenuItem, PowerSaveBlocker, NativeTheme } from 'electron'
import * as remote from '@electron/remote'

export interface MessageBoxResponse {
    response: number
    checkboxChecked?: boolean
}

@Injectable({ providedIn: 'root' })
export class ElectronService {
    app: App
    ipcRenderer: IpcRenderer
    shell: Shell
    dialog: Dialog
    clipboard: { readText: () => string, availableFormats: () => string[], write: (content: { text: string, html?: string }) => void }
    globalShortcut: GlobalShortcut
    screen: Screen
    process: any
    autoUpdater: AutoUpdater
    powerSaveBlocker: PowerSaveBlocker
    nativeTheme: NativeTheme
    TouchBar: typeof TouchBar
    BrowserWindow: typeof BrowserWindow
    Menu: typeof Menu
    MenuItem: typeof MenuItem

    /** @hidden */
    private constructor () {
        const electron = require('electron')
        this.shell = electron.shell
        const callClipboard = (operation: string, content?: { text: string, html?: string }) => {
            const result = electron.ipcRenderer.sendSync('torbie:clipboard', operation, content)
            if (result.error) {
                throw new Error(result.error)
            }
            return result.value
        }
        this.clipboard = {
            readText: () => callClipboard('readText'),
            availableFormats: () => callClipboard('availableFormats'),
            write: content => callClipboard('write', content),
        }
        this.ipcRenderer = electron.ipcRenderer

        this.process = remote.getGlobal('process')
        this.app = remote.app
        this.screen = remote.screen
        this.dialog = remote.dialog
        this.globalShortcut = remote.globalShortcut
        this.autoUpdater = remote.autoUpdater
        this.powerSaveBlocker = remote.powerSaveBlocker
        this.TouchBar = remote.TouchBar
        this.BrowserWindow = remote.BrowserWindow
        this.Menu = remote.Menu
        this.MenuItem = remote.MenuItem
        this.nativeTheme = remote.nativeTheme
    }
}
