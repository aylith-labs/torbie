// Shared from Lintel paths/. Run conformance/sync-paths.mjs to update.
/** Lintel path policy. Hosts supply registered distributions and home directories, and perform I/O. */
export type PathKind = 'windows' | 'unc' | 'posix' | 'home' | 'none'
export interface PathCandidate { path: string; distro: string | null }
/** Home directories the host knows, by distribution. The key '' is the host's own home: the Windows profile directory on Windows, the local POSIX home elsewhere. */
export type PathHomes = Readonly<Record<string, string>>
export function pathKind (text: string): PathKind {
    if (/^[a-z]:[\\/]/i.test(text)) return 'windows'
    if (text.startsWith('\\\\') || text.startsWith('//')) return 'unc'
    if (text.startsWith('~/')) return 'home'
    return text.startsWith('/') ? 'posix' : 'none'
}
function findHome (homes: PathHomes, distro: string): string | null {
    const home = homes[distro]
    if (!home) return null
    return home.length > 1 ? home.replace(/[\\/]+$/, '') || home[0] : home
}
export function pathCandidates (text: string, onWindows: boolean, sourceDistro: string | null, distros: readonly string[] = [], homes: PathHomes = {}): PathCandidate[] {
    const kind = pathKind(text)
    if (kind === 'none') return []
    if (kind === 'home') {
        // "~" means the home of whoever printed it, which the host has to know.
        // Never probe other distributions for it, and never guess a home.
        const rest = text.slice(1)
        if (!onWindows || !sourceDistro) {
            const home = findHome(homes, '')
            return home ? [{ path: home + (onWindows ? rest.replace(/\//g, '\\') : rest), distro: null }] : []
        }
        const home = findHome(homes, sourceDistro)
        if (!home || pathKind(home) !== 'posix') return []
        return pathCandidates(home === '/' ? rest : home + rest, true, sourceDistro)
    }
    if (!onWindows || kind === 'windows' || kind === 'unc') return [{ path: text, distro: null }]
    const mount = /^\/mnt\/([a-zA-Z])(?:\/|$)/.exec(text)
    if (mount) return [{ path: mount[1].toUpperCase() + ':\\' + text.slice(mount[0].length).replace(/\//g, '\\'), distro: null }]
    // The producing distribution is authoritative. Never open a same-named file
    // from another distribution just because the source file was removed.
    const names = sourceDistro ? [sourceDistro] : [...new Set(distros.filter(Boolean))]
    return names.map(distro => ({ path: '\\\\wsl.localhost\\' + distro + text.replace(/\//g, '\\'), distro }))
}
export function selectPathCandidate (candidates: readonly PathCandidate[], exists: readonly boolean[]): PathCandidate | null {
    const found = candidates.filter((_, index) => exists[index])
    return found.length === 1 ? found[0] : null
}
