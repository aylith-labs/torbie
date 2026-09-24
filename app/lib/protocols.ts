/**
 * Who may register `torbie://` and `tabby://`, and the registration itself.
 *
 * A URL-scheme handler is per-user shell state: `setAsDefaultProtocolClient`
 * writes `HKCU\Software\Classes\<scheme>\shell\open\command`, and the last
 * process to call it wins for every link on the desktop. Upstream called it on
 * every launch of every build. A source launch passed `process.argv[1]` as the
 * app path, which is `--user-data-dir=…` whenever switches come first — so each
 * dev or test launch pointed both schemes at a command that cannot even start
 * the app, and took them away from the installed Torbie (and `tabby://` away
 * from an installed Tabby) until something re-registered.
 *
 * Now only the installed build registers. A source build, a build slot, a
 * portable copy or a scratch profile runs without touching either scheme.
 *
 * `tabby://` is kept for links written before the rename, but it is Tabby's
 * scheme first: Torbie claims it only while no Tabby is installed, or when the
 * handler is already this very executable. It never takes it from a Tabby.
 *
 * Everything that decides is a pure function of facts passed in, so
 * `app/test/protocols.test.js` runs it in plain node.
 */
import * as path from 'path'

export interface LaunchFacts {
    platform: string
    /** `process.defaultApp`: electron.exe running an app directory (a source build). */
    defaultApp: boolean
    isPackaged: boolean
    execPath: string
    argv: string[]
    env: Record<string, string | undefined>
    exists: (p: string) => boolean
}

/**
 * The build the installer put on this machine — the only one whose
 * per-user registrations are allowed to outlive it.
 *
 * On Windows that is a packaged build with the NSIS uninstaller beside it,
 * exactly how `tabby-builds` tells an installed build from a slot or a
 * portable copy. Launched with a scratch `--user-data-dir` or `--dev`, even the
 * installed executable is being used for something other than itself.
 */
export function isInstalledBuild (f: LaunchFacts): boolean {
    if (f.defaultApp || !f.isPackaged) {
        return false
    }
    if (f.argv.some(a => a === '--dev' || a.startsWith('--user-data-dir'))) {
        return false
    }
    if (f.platform !== 'win32') {
        return true
    }
    const product = path.win32.basename(f.execPath).replace(/\.exe$/i, '')
    return f.exists(path.win32.join(path.win32.dirname(f.execPath), `Uninstall ${product}.exe`))
}

/** The executable a `shell\open\command` value runs, or null. */
export function commandExecutable (command: string | null | undefined): string | null {
    if (!command) {
        return null
    }
    const trimmed = command.trim()
    const quoted = /^"([^"]+)"/.exec(trimmed)
    if (quoted) {
        return quoted[1]
    }
    const bare = /^(\S+)/.exec(trimmed)
    return bare ? bare[1] : null
}

const sameFile = (a: string, b: string): boolean => path.win32.resolve(a).toLowerCase() === path.win32.resolve(b).toLowerCase()

/** Where the Tabby installer puts Tabby.exe, per-user and per-machine. */
export function tabbyInstallPaths (env: Record<string, string | undefined>): string[] {
    return [
        env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, 'Programs', 'Tabby', 'Tabby.exe'),
        env.ProgramFiles && path.win32.join(env.ProgramFiles, 'Tabby', 'Tabby.exe'),
    ].filter((p): p is string => !!p)
}

/** Whether this build may take `tabby://`, given the handler it has now. */
export function mayClaimTabby (f: LaunchFacts, currentCommand: string | null): boolean {
    const current = commandExecutable(currentCommand)
    if (current && sameFile(current, f.execPath)) {
        return true
    }
    if (tabbyInstallPaths(f.env).some(f.exists)) {
        return false
    }
    if (current && f.exists(current) && path.win32.basename(current).toLowerCase() === 'tabby.exe') {
        return false
    }
    return true
}

/** The schemes this launch registers: none unless it is the installed build. */
export function schemesToRegister (f: LaunchFacts, readCommand: (scheme: string) => string | null): string[] {
    if (!isInstalledBuild(f)) {
        return []
    }
    if (f.platform !== 'win32') {
        return ['torbie', 'tabby']
    }
    return mayClaimTabby(f, readCommand('tabby')) ? ['torbie', 'tabby'] : ['torbie']
}

/** Reads a scheme's `shell\open\command` from HKCU, or null. Windows only. */
export function readProtocolCommand (scheme: string): string | null {
    try {
        const wnr = require('windows-native-registry') // eslint-disable-line @typescript-eslint/no-var-requires
        const value = wnr.getRegistryValue(wnr.HK.CU, `Software\\Classes\\${scheme}\\shell\\open\\command`, '')
        return typeof value === 'string' ? value : null
    } catch {
        return null
    }
}
