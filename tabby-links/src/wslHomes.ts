/**
 * The home directory of a WSL distribution's default user, for Lintel's
 * `~/...` rule (paths/README.md, rule 6): `~` means the home of whoever printed
 * it, and in a WSL tab that is the distribution's user, not the Windows one.
 *
 * Found the way the Windows Terminal fork finds it (`Utils::WslHomeDirectory`
 * in Mullion's `src/types/utils.cpp`), without starting a shell or `wsl.exe` —
 * Lintel forbids spawning to resolve a hover:
 *
 * 1. the distribution's `DefaultUid`, a DWORD under
 *    `HKCU\Software\Microsoft\Windows\CurrentVersion\Lxss\{guid}` whose
 *    `DistributionName` matches. Absent means the distribution logs in as root,
 *    uid 0. Read in-process through `windows-native-registry`, the module
 *    `LinkTargetService` already uses for the default distro.
 * 2. that uid's sixth field in `\\wsl.localhost\<distro>\etc\passwd`, read over
 *    the file system, asynchronously.
 *
 * Only successes are cached, keyed case-insensitively: a read that failed (the
 * distribution was mid-start, the share was slow) is tried again next time.
 */
import * as fs from 'fs/promises'

const LXSS = 'Software\\Microsoft\\Windows\\CurrentVersion\\Lxss'

/** The registry calls this needs, so a test can hand in its own. */
export interface RegistryReader {
    subkeys (path: string): string[]
    values (path: string): Record<string, { value: any }> | null
}

function nativeRegistry (): RegistryReader | null {
    try {
        const wnr = require('windows-native-registry')
        return {
            subkeys: p => wnr.listRegistrySubkeys(wnr.HK.CU, p) ?? [],
            values: p => wnr.getRegistryKey(wnr.HK.CU, p),
        }
    } catch {
        return null
    }
}

/** The uid a distribution logs in as, or null when no such distribution is registered. */
export function wslDefaultUid (distro: string, registry: RegistryReader | null): number | null {
    if (!distro || !registry) {
        return null
    }
    try {
        const wanted = distro.toLowerCase()
        for (const key of registry.subkeys(LXSS).slice(0, 32)) {
            const values = registry.values(`${LXSS}\\${key}`)
            const name = values?.DistributionName?.value
            if (typeof name !== 'string' || name.toLowerCase() !== wanted) {
                continue
            }
            const uid = values?.DefaultUid?.value
            return typeof uid === 'number' ? uid : 0
        }
    } catch {
        // No WSL, or a shape we don't recognise: the home is simply not known.
    }
    return null
}

/** That uid's home in `/etc/passwd` text (`name:x:uid:gid:gecos:home:shell`), or ''. */
export function homeFromPasswd (passwd: string, uid: number): string {
    const wanted = String(uid)
    for (const raw of passwd.split('\n')) {
        const fields = raw.replace(/\r$/, '').split(':')
        if (fields.length >= 6 && fields[2] === wanted && fields[5].startsWith('/')) {
            return fields[5]
        }
    }
    return ''
}

export class WslHomes {
    private homes = new Map<string, string>()
    private reading = new Map<string, Promise<string>>()

    constructor (
        private registry: () => RegistryReader | null = nativeRegistry,
        private readPasswd: (distro: string) => Promise<string> =
        distro => fs.readFile(`\\\\wsl.localhost\\${distro}\\etc\\passwd`, 'utf8'),
    ) { }

    /** The home if it is already known, without touching anything. */
    known (distro: string): string | undefined {
        return this.homes.get(distro.toLowerCase())
    }

    /** The home, reading it if it is not known yet; '' when it cannot be found. */
    load (distro: string): Promise<string> {
        const key = distro.toLowerCase()
        const cached = this.homes.get(key)
        if (cached !== undefined) {
            return Promise.resolve(cached)
        }
        let pending = this.reading.get(key)
        if (!pending) {
            pending = this.read(distro).then(home => {
                if (home) {
                    this.homes.set(key, home)
                }
                return home
            }, () => '').finally(() => this.reading.delete(key))
            this.reading.set(key, pending)
        }
        return pending
    }

    /**
     * The home within `timeoutMs`, or undefined when it is not known by then.
     * The read carries on regardless, so a later hover finds it cached.
     */
    async within (distro: string, timeoutMs: number): Promise<string | undefined> {
        const known = this.known(distro)
        if (known !== undefined) {
            return known
        }
        let timer: ReturnType<typeof setTimeout> | undefined
        const timeout = new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), timeoutMs) })
        try {
            return await Promise.race([this.load(distro), timeout]) || undefined
        } finally {
            clearTimeout(timer)
        }
    }

    private async read (distro: string): Promise<string> {
        // Yield first, so even the one synchronous registry read is never on
        // the caller's stack.
        await Promise.resolve()
        const uid = wslDefaultUid(distro, this.registry())
        if (uid === null) {
            return ''
        }
        return homeFromPasswd(await this.readPasswd(distro), uid)
    }
}
