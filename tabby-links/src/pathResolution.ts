// Shared from Lintel paths/. Run conformance/sync-paths.mjs to update.
/** Lintel path policy. Hosts supply registered distributions and perform I/O. */
export type PathKind = 'windows' | 'unc' | 'posix' | 'none'
export interface PathCandidate { path: string; distro: string | null }
export function pathKind (text: string): PathKind {
    if (/^[a-z]:[\\/]/i.test(text)) return 'windows'
    if (text.startsWith('\\\\') || text.startsWith('//')) return 'unc'
    return text.startsWith('/') ? 'posix' : 'none'
}
export function pathCandidates (text: string, onWindows: boolean, sourceDistro: string | null, distros: readonly string[] = []): PathCandidate[] {
    const kind = pathKind(text)
    if (kind === 'none') return []
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
