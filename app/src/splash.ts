/**
 * Which build the splash belongs to — readable while the app is still booting.
 *
 * The splash is plain HTML that stays up until Angular replaces it, and a
 * splash that never goes away (v1.0.1, installed) is exactly when "which build
 * is this, from where, with which profile?" matters most — and the build
 * tooltip in the tab bar does not exist yet. So everything here comes from what
 * is there before any plugin loads: the DefinePlugin constants this bundle was
 * compiled with (the same ones `AppRootComponent`'s build tooltip reads),
 * `process.versions`, the executable path, and the environment the main
 * process hands every window.
 *
 * Runs from `preload.js`, which is loaded synchronously in `<head>`;
 * `index.pug` calls `torbieSplash()` inline once the splash markup exists, so
 * the version appears on the first paint rather than after the deferred bundle.
 */
import * as path from 'path'

export interface BuildDetails {
    version: string
    sha: string
    branch: string
    date: string
    timestamp: number | null
    channel: string
    installPath: string
    userDataPath: string
    configPath: string
    electron: string
    chrome: string
    node: string
    platform: string
}

function userDataPath (): string {
    try {
        // Synchronous IPC, so only on hover, never on the boot path.
        return require('@electron/remote').app.getPath('userData')
    } catch {
        return process.env.TABBY_CONFIG_DIRECTORY ?? 'unknown'
    }
}

export function buildDetails (): BuildDetails {
    const version = process.env.TABBY_BUILD_VERSION ?? 'unknown'
    const timestamp = parseInt(process.env.TABBY_BUILD_TIMESTAMP ?? '', 10)
    const configDir = process.env.TABBY_CONFIG_DIRECTORY
    const channel = [
        version.includes('-nightly') ? 'nightly' : 'release',
        ...process.env.TABBY_DEV ? ['source build'] : [],
    ].join(', ')
    return {
        version,
        sha: process.env.TABBY_BUILD_SHA ?? 'unknown',
        branch: process.env.TABBY_BUILD_BRANCH ?? 'unknown',
        date: process.env.TABBY_BUILD_DATE ?? 'unknown',
        timestamp: Number.isNaN(timestamp) ? null : timestamp,
        channel,
        // The executable's directory, as the About page says it: app.getAppPath()
        // points inside app.asar, which nobody can open.
        installPath: path.dirname(process.execPath),
        userDataPath: userDataPath(),
        configPath: configDir ? path.join(configDir, 'config.yaml') : 'unknown',
        electron: process.versions.electron ?? 'unknown',
        chrome: process.versions.chrome ?? 'unknown',
        node: process.versions.node ?? 'unknown',
        platform: `${process.platform} ${process.arch}`,
    }
}

/** "3 minutes ago" — the shape `AppRootComponent`'s build tooltip uses. */
export function relativeAge (then: number | null, now: number): string {
    if (then === null) {
        return 'unknown'
    }
    const s = Math.max(0, Math.round((now - then) / 1000))
    const units: [string, number][] = [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]]
    for (const [name, size] of units) {
        const n = Math.floor(s / size)
        if (n >= 1) {
            return `${n} ${name}${n === 1 ? '' : 's'} ago`
        }
    }
    return 'just now'
}

export function detailRows (d: BuildDetails, now = Date.now()): [string, string][] {
    return [
        ['Version', d.version],
        ['Commit', `${d.sha} (${d.branch})`],
        ['Built', `${d.date} · ${relativeAge(d.timestamp, now)}`],
        ['Channel', d.channel],
        ['Install', d.installPath],
        ['User data', d.userDataPath],
        ['Config', d.configPath],
        ['Electron', d.electron],
        ['Chrome', d.chrome],
        ['Node', d.node],
        ['Platform', d.platform],
    ]
}

export function detailsText (d: BuildDetails, now = Date.now()): string {
    return [`Torbie ${d.version}`, ...detailRows(d, now).map(([k, v]) => `${k}: ${v}`)].join('\n')
}

function copy (text: string): boolean {
    try {
        // The app's own bridge: Electron 44's clipboard is asynchronous and
        // main-process only, and `navigator.clipboard` wants document focus,
        // which a hover over a window in the background does not have.
        const result = require('electron').ipcRenderer.sendSync('torbie:clipboard', 'write', { text })
        if (!result?.error) {
            return true
        }
    } catch { /* fall through */ }
    try {
        void navigator.clipboard.writeText(text)
        return true
    } catch {
        return false
    }
}

const SHOW_DELAY_MS = 1000
const HIDE_DELAY_MS = 250

export function initSplash (): void {
    const name = document.querySelector<HTMLElement>('.preload-logo .torbie-name')
    const versionLine = document.querySelector<HTMLElement>('.preload-logo .torbie-version')
    const tip = document.querySelector<HTMLElement>('.preload-logo .splash-build')
    if (!name || !tip || name.dataset.ready) {
        return
    }
    name.dataset.ready = '1'

    const version = process.env.TABBY_BUILD_VERSION ?? ''
    if (versionLine) {
        versionLine.textContent = version
    }

    let showTimer: any = null
    let hideTimer: any = null
    let details: BuildDetails | null = null

    const render = () => {
        details ??= buildDetails()
        tip.textContent = ''
        const card = document.createElement('div')
        card.className = 'splash-build-card'
        tip.appendChild(card)
        const title = document.createElement('div')
        title.className = 'splash-build-title'
        title.textContent = `Torbie ${details.version}`
        card.appendChild(title)
        const table = document.createElement('dl')
        for (const [k, v] of detailRows(details)) {
            const dt = document.createElement('dt')
            dt.textContent = k
            const dd = document.createElement('dd')
            dd.textContent = v
            dd.title = v
            table.append(dt, dd)
        }
        card.appendChild(table)
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'splash-build-copy'
        button.textContent = 'Copy'
        button.addEventListener('click', () => {
            button.textContent = copy(detailsText(details!)) ? 'Copied' : 'Copy failed'
            setTimeout(() => { button.textContent = 'Copy' }, 1500)
        })
        card.appendChild(button)
    }

    /**
     * Next to the name, inside the window. Below it when the card fits there,
     * above it when it fits there instead, and otherwise as far into view as
     * the window allows (the card scrolls past `max-height`). Measured after
     * un-hiding: a hidden element has no size. Adjacent to the name either
     * way, so the pointer's way to Copy is the name, the card's bridge, then
     * the card — never a gap, and never a button below the window's edge.
     */
    const place = () => {
        // The wrapper's own padding is the gap, so it sits flush.
        const GAP = 0
        const MARGIN = 0
        const n = name.getBoundingClientRect()
        const w = tip.offsetWidth
        const h = tip.offsetHeight
        const vw = window.innerWidth
        const vh = window.innerHeight
        const left = Math.min(Math.max(MARGIN, n.left + n.width / 2 - w / 2), Math.max(MARGIN, vw - w - MARGIN))
        let top: number
        if (n.bottom + GAP + h <= vh - MARGIN) {
            top = n.bottom + GAP
        } else if (n.top - GAP - h >= MARGIN) {
            top = n.top - GAP - h
        } else {
            top = Math.max(MARGIN, vh - h - MARGIN)
        }
        tip.style.left = `${Math.round(left)}px`
        tip.style.top = `${Math.round(top)}px`
    }

    const show = () => {
        clearTimeout(hideTimer)
        if (tip.hidden) {
            render()
            tip.hidden = false
            place()
            name.setAttribute('aria-expanded', 'true')
        }
    }
    const hide = () => {
        clearTimeout(showTimer)
        tip.hidden = true
        name.setAttribute('aria-expanded', 'false')
    }
    const scheduleHide = () => {
        clearTimeout(showTimer)
        clearTimeout(hideTimer)
        hideTimer = setTimeout(hide, HIDE_DELAY_MS)
    }

    name.addEventListener('mouseenter', () => {
        clearTimeout(hideTimer)
        if (tip.hidden) {
            clearTimeout(showTimer)
            showTimer = setTimeout(show, SHOW_DELAY_MS)
        }
    })
    name.addEventListener('mouseleave', scheduleHide)
    // The tooltip stays open while the pointer travels into it, so Copy can be
    // reached; leaving it closes it the same way leaving the name does.
    tip.addEventListener('mouseenter', () => clearTimeout(hideTimer))
    tip.addEventListener('mouseleave', scheduleHide)
    name.addEventListener('focus', show)
    name.addEventListener('blur', event => {
        if (!tip.contains(event.relatedTarget as Node)) {
            scheduleHide()
        }
    })
    document.addEventListener('keydown', event => {
        if (event.key === 'Escape') {
            hide()
        }
    })
}

;(window as any).torbieSplash = initSplash
