/**
 * The machine-wide resources this app can want at the same time as another
 * running Tabby or Torbie — the MCP server's port, the global hotkey and the
 * Claude hook spool — and what to say when both want one.
 *
 * Pure logic over snapshots, and deliberately so. Everything here is something
 * the service has already read off the machine: processes, listening sockets,
 * another app's `config.yaml`, heartbeat files, and what Electron says this app
 * registered. Nothing below starts a process, opens a socket or reads a file,
 * so the fast-tier test can hold every rule to a snapshot, on any platform.
 *
 * Detection reports. It never stops, restarts or reconfigures the other app:
 * every action offered here changes this app's own settings.
 */
import * as path from 'path'

import { PRODUCT_NAME, productFromExecutable } from './productNames'

/** tabby-mcp-server as `PluginInfo.name` and `pluginBlacklist` spell it. */
export const MCP_PLUGIN = 'mcp-server'
/** …and as its directory in a plugins folder is named. */
export const MCP_PACKAGE = 'tabby-mcp-server'
/** `port || config.store.mcp?.port || 3001`, in the plugin's own `startServer`. */
export const MCP_DEFAULT_PORT = 3001
/**
 * Where a free port is looked for. The default is never offered: it is the
 * port every other copy of the plugin wants, which is the whole problem.
 */
export const MCP_PORT_SEARCH_FROM = 3002
export const MCP_PORT_SEARCH_TO = 3200

/** tabby-claude-status's own `STALE_MS`: an older heartbeat is a window that has gone. */
export const HEARTBEAT_FRESH_MS = 8000
/** Under `os.tmpdir()`. Read, never written. */
export const HEARTBEAT_DIRECTORY = 'tabby-claude-status.windows'

export type AppKind = 'installed' | 'portable' | 'packaged' | 'source'

/** A process the build probe found, before it is grouped into an app. */
export interface ProcessRow {
    pid: number
    /** Normalized for comparison — the grouping key. */
    executable: string
    /** The same path as the OS reported it, for display. */
    displayExecutable?: string
}

/** What another running app is, as far as can be told from outside it. */
export interface AppIdentity {
    executable: string
    displayExecutable: string
    /** `Torbie` or `Tabby`; null for an `electron.exe`. */
    product: string | null
    kind: AppKind
    /** What it is called: the product, or `Electron` for a build that is neither. */
    base: string
    /** What sets it apart from the installed app of that name: `portable`, `unpacked`, `source build`. */
    qualifier: string | null
    /** Both, as a sentence names it: "Tabby", "Torbie (portable)". */
    name: string
    /** Where its `config.yaml` lives, or null when that cannot be known. */
    configDirectory: string | null
}

/** The parts of another app's settings that decide whether it collides. */
export interface OtherAppConfig {
    /** tabby-mcp-server is in its user plugins directory. */
    mcpInstalled: boolean
    pluginBlacklist: string[]
    /** Null means unset, which the plugin reads as 3001. */
    mcpPort: number | null
    mcpStartOnBoot: boolean
    /** `hotkeys['toggle-window']` as stored, or the default when it is not. */
    toggleWindow: unknown
    /** `hacks.globalHotkey`; true disables registration, as in `app/lib/app.ts`. */
    globalHotkeyHack: boolean | null
}

export interface OtherApp extends AppIdentity {
    pids: number[]
    /** Null when the config directory is unknown or its config would not read. */
    config: OtherAppConfig | null
}

/** One TCP socket out of `netstat -ano`. */
export interface SocketRow {
    port: number
    remotePort: number
    pid: number
}

export interface Sockets {
    listening: SocketRow[]
    connected: SocketRow[]
}

/** An MCP server Claude Code is configured to reach over loopback HTTP. */
export interface ClaudeServerEntry {
    name: string
    /** `user`, or `local` plus the project it belongs to. */
    scope: string
    /** Origin and path only: a query string can carry a token. */
    url: string
    port: number
}

/** One file from the heartbeat directory, parsed or not. */
export interface HeartbeatFile {
    file: string
    content: unknown
}

/** An app that has a live tabby-claude-status window. */
export interface ClaudeReader {
    key: string
    name: string
    pids: number[]
    self: boolean
    /** Drains the spool. A legacy heartbeat always counts as draining it. */
    consuming: boolean
    /** Written by a tabby-claude-status that does not report `app` or `consuming`. */
    legacy: boolean
}

export type ConflictActionId = 'mcp-use-free-port' | 'mcp-stop-on-boot' | 'hotkey-clear' | 'hotkey-settings'

export interface ConflictAction {
    id: ConflictActionId
    label: string
}

export interface Conflict {
    /** Stable across checks while the conflict persists: the toast key. */
    id: string
    resource: 'mcp' | 'hotkey' | 'claude'
    /** Names the other app. */
    title: string
    /** What goes wrong, in one sentence. */
    consequence: string
    /** Says what the chips are, when there are any. */
    itemsLabel: string | null
    items: string[]
    /** The other app's executable, when there is one to name. */
    location: string | null
    hint: string | null
    actions: ConflictAction[]
}

export interface ConflictInput {
    platform: string
    now: number
    self: {
        /** Normalized `process.execPath`. */
        executable: string
        /** This renderer and every probed process sharing this executable. */
        pids: number[]
        mcp: {
            /** In `installedPlugins` and not blacklisted when this window booted. */
            loaded: boolean
            port: number | null
            startOnBoot: boolean
        }
        hotkey: {
            /** False when `hacks.globalHotkey` stops registration, so there is nothing to ask. */
            enabled: boolean
            accelerators: { accelerator: string, registered: boolean | null }[]
        }
    }
    others: OtherApp[]
    processes: ProcessRow[]
    /** Null when no socket table was read — not Windows, or MCP is not loaded here. */
    sockets: Sockets | null
    /** Image names for listening PIDs that are not a Tabby or Torbie. */
    holderNames: Record<number, string>
    /** Null when the Claude Code config could not be read; empty when it has no such entries. */
    claudeServers: ClaudeServerEntry[] | null
    heartbeats: HeartbeatFile[]
}

export interface ConflictReport {
    checkedAt: number
    others: OtherApp[]
    conflicts: Conflict[]
    claudeReaders: ClaudeReader[]
}

// ── Apps ────────────────────────────────────────────────────────────────────

function pathFor (platform: string): typeof path.posix {
    return platform === 'win32' ? path.win32 : path.posix
}

/** The comparison key for an executable: what `BuildProcessesService.normalize` produces. */
export function normalizeExecutable (executable: string, platform: string): string {
    const normalized = pathFor(platform).normalize(executable)
    return platform === 'win32' ? normalized.toLowerCase() : normalized
}

/** Processes that are not this app, one entry per executable. */
export function groupOtherProcesses (rows: ProcessRow[], selfExecutable: string): { executable: string, displayExecutable: string, pids: number[] }[] {
    const groups = new Map<string, { executable: string, displayExecutable: string, pids: number[] }>()
    for (const row of rows) {
        if (row.executable === selfExecutable) {
            continue
        }
        let group = groups.get(row.executable)
        if (!group) {
            group = { executable: row.executable, displayExecutable: row.displayExecutable ?? row.executable, pids: [] }
            groups.set(row.executable, group)
        }
        group.pids.push(row.pid)
    }
    return [...groups.values()].map(group => ({ ...group, pids: [...group.pids].sort((a, b) => a - b) }))
}

export interface IdentifyOptions {
    platform: string
    env: Record<string, string | undefined>
    /** `<exe dir>/data` exists — exactly the test `app/lib/portable.ts` applies. */
    hasPortableData: boolean
}

/**
 * Name an executable and say where its settings are.
 *
 * A `data` directory beside the executable wins whatever the executable is
 * called, because that is the whole of `portable.ts`'s rule. An `electron.exe`
 * without one is a source build, and its profile is whatever `--user-data-dir`
 * it was started with, which a process listing does not show — so that is
 * reported as unknown rather than guessed. A packaged Torbie or Tabby otherwise
 * uses Electron's default profile, `%APPDATA%\<name>`.
 */
export function identifyApp (displayExecutable: string, options: IdentifyOptions): AppIdentity {
    const p = pathFor(options.platform)
    const directory = p.dirname(displayExecutable)
    const product = productFromExecutable(displayExecutable)
    const executable = normalizeExecutable(displayExecutable, options.platform)
    const same = (a: string, b: string) => normalizeExecutable(a, options.platform) === normalizeExecutable(b, options.platform)
    const named = (kind: AppKind, base: string, qualifier: string | null, configDirectory: string | null): AppIdentity => ({
        executable,
        displayExecutable,
        product,
        kind,
        base,
        qualifier,
        name: qualifier ? `${base} (${qualifier})` : base,
        configDirectory,
    })

    if (options.hasPortableData) {
        return named('portable', product ?? 'Electron', 'portable', p.join(directory, 'data'))
    }
    if (!product) {
        return named('source', 'Electron', 'source build', null)
    }
    if (options.platform !== 'win32' || !options.env.APPDATA) {
        // Only the Windows profile locations have been checked on a real
        // machine; elsewhere the answer would be a guess.
        return named('packaged', product, null, null)
    }
    const roots = [
        options.env.LOCALAPPDATA ? p.join(options.env.LOCALAPPDATA, 'Programs', product) : null,
        options.env.ProgramFiles ? p.join(options.env.ProgramFiles, product) : null,
        options.env['ProgramFiles(x86)'] ? p.join(options.env['ProgramFiles(x86)']!, product) : null,
    ].filter((x): x is string => !!x)
    const installed = roots.some(root => same(root, directory))
    return named(
        installed ? 'installed' : 'packaged',
        product,
        installed ? null : 'unpacked',
        p.join(options.env.APPDATA, product.toLowerCase()),
    )
}

/**
 * An app's name with a PID folded into its parenthesis — "Tabby (PID 5716)",
 * "Torbie (portable, PID 812)" — rather than a second pair beside the first.
 */
export function appLabel (app: Pick<AppIdentity, 'base' | 'qualifier' | 'name'>, pid?: number): string {
    if (pid === undefined) {
        return app.name
    }
    return `${app.base} (${app.qualifier ? `${app.qualifier}, ` : ''}PID ${pid})`
}

/** The settings that matter, out of a parsed `config.yaml`. */
export function readOtherAppConfig (raw: unknown, mcpInstalled: boolean, defaultToggleWindow: unknown): OtherAppConfig {
    const store: any = raw && typeof raw === 'object' ? raw : {}
    const hotkeys: any = store.hotkeys && typeof store.hotkeys === 'object' ? store.hotkeys : {}
    const mcp: any = store.mcp && typeof store.mcp === 'object' ? store.mcp : {}
    const port = Number(mcp.port)
    return {
        mcpInstalled,
        pluginBlacklist: Array.isArray(store.pluginBlacklist)
            ? store.pluginBlacklist.filter((x: unknown) => typeof x === 'string')
            : [],
        mcpPort: Number.isInteger(port) && port > 0 ? port : null,
        mcpStartOnBoot: mcp.startOnBoot !== false,
        toggleWindow: 'toggle-window' in hotkeys ? hotkeys['toggle-window'] : defaultToggleWindow,
        globalHotkeyHack: typeof store.hacks?.globalHotkey === 'boolean' ? store.hacks.globalHotkey : null,
    }
}

/** Would this app start an MCP server on `port` at boot? */
function servesMcpOn (config: OtherAppConfig, port: number): boolean {
    return config.mcpInstalled
        && !config.pluginBlacklist.includes(MCP_PLUGIN)
        && config.mcpStartOnBoot
        && (config.mcpPort || MCP_DEFAULT_PORT) === port
}

/** `app/lib/app.ts`'s `shouldRegisterGlobalHotkeys`, as far as a config file says. */
function registersHotkeys (config: OtherAppConfig): boolean {
    return config.globalHotkeyHack === null ? true : !config.globalHotkeyHack
}

// ── The hotkey ──────────────────────────────────────────────────────────────

/**
 * The accelerators `registerGlobalHotkey` in `tabby-electron/src/index.ts`
 * sends to the main process, converted exactly the way it converts them: a
 * string is one binding, a sequence registers only its first stroke, and an
 * entry that throws is skipped.
 */
export function toggleWindowAccelerators (value: unknown): string[] {
    let items: any = value || []
    if (typeof items === 'string') {
        items = [items]
    }
    if (!Array.isArray(items)) {
        // `forEach` on anything else throws there, and nothing registers.
        return []
    }
    const specs: string[] = []
    for (let item of items) {
        item = typeof item === 'string' ? [item] : item
        try {
            let spec = item[0]
            spec = spec.replaceAll('Meta', 'Super')
            spec = spec.replaceAll('⌘', 'Command')
            spec = spec.replaceAll('⌥', 'Alt')
            spec = spec.replaceAll('-', '+')
            specs.push(spec)
        } catch {
            // Skipped there too.
        }
    }
    return specs
}

const MODIFIERS: Record<string, string> = {
    ctrl: 'ctrl',
    control: 'ctrl',
    alt: 'alt',
    option: 'alt',
    altgr: 'altgr',
    shift: 'shift',
    super: 'super',
    meta: 'super',
    cmd: 'command',
    command: 'command',
    cmdorctrl: 'commandorcontrol',
    commandorcontrol: 'commandorcontrol',
}

/** One spelling per chord, so `Control+Space` and `ctrl+space` compare equal. */
export function canonicalAccelerator (accelerator: string, platform: string): string {
    const parts = accelerator.split('+').map(x => x.trim().toLowerCase()).filter(x => !!x)
    const key = parts.pop()
    if (!key) {
        return ''
    }
    const modifiers = parts.map(part => {
        const modifier = MODIFIERS[part] ?? part
        if (modifier === 'commandorcontrol') {
            return platform === 'darwin' ? 'command' : 'ctrl'
        }
        return modifier
    })
    return [...[...new Set(modifiers)].sort(), key].join('+')
}

// ── Sockets and Claude Code ─────────────────────────────────────────────────

function portOf (address: string): number {
    const at = address.lastIndexOf(':')
    return at < 0 ? NaN : parseInt(address.slice(at + 1), 10)
}

/**
 * TCP rows of `netstat -ano`, both address families.
 *
 * A listening socket is recognised by its remote port being 0, not by the
 * word LISTENING: the state column is translated on a localized Windows, and
 * the remote column is not. `-p TCP` alone would miss a listener bound only to
 * an IPv6 address, so the whole table is read.
 */
export function parseNetstat (stdout: string): Sockets {
    const listening: SocketRow[] = []
    const connected: SocketRow[] = []
    for (const line of stdout.split(/\r?\n/)) {
        const match = /^\s*TCP\s+(\S+)\s+(\S+)\s+(?:.*?\s+)?(\d+)\s*$/i.exec(line)
        if (!match) {
            continue
        }
        const port = portOf(match[1])
        const remotePort = portOf(match[2])
        const pid = parseInt(match[3], 10)
        if (!Number.isFinite(port) || !Number.isFinite(remotePort)) {
            continue
        }
        const row = { port, remotePort, pid }
        if (remotePort === 0) {
            listening.push(row)
        } else {
            connected.push(row)
        }
    }
    return { listening, connected }
}

/** The first ports worth trying to bind, in order. Never the default port. */
export function candidatePorts (sockets: Sockets | null, from = MCP_PORT_SEARCH_FROM, to = MCP_PORT_SEARCH_TO): number[] {
    const taken = new Set((sockets?.listening ?? []).map(x => x.port))
    const out: number[] = []
    for (let port = Math.max(from, 1); port <= to; port++) {
        if (port !== MCP_DEFAULT_PORT && !taken.has(port)) {
            out.push(port)
        }
    }
    return out
}

export function claudeAddCommand (port: number): string {
    return `claude mcp add --transport http ${PRODUCT_NAME.toLowerCase()}-mcp http://localhost:${port}/mcp`
}

const LOOPBACK = ['localhost', '127.0.0.1', '[::1]', '::1', '0.0.0.0']

/**
 * HTTP MCP servers on this machine in a parsed Claude Code config
 * (`.claude.json`): the user-scope `mcpServers`, and each project's
 * local-scope ones. Only the name, scope, origin and path are kept — headers
 * and query strings can hold credentials, and none of that is needed to say
 * which entry uses a port.
 *
 * "This machine" is loopback plus `localAddresses`, the addresses of this
 * machine's own interfaces. The MCP server listens on every interface, and an
 * entry naming the host's WSL adapter address (`http://172.22.144.1:3001/mcp`,
 * measured on the machine this was written on) reaches it exactly as
 * `localhost` does.
 */
export function claudeServers (json: unknown, localAddresses: string[] = []): ClaudeServerEntry[] {
    const local = new Set([
        ...LOOPBACK,
        ...localAddresses.map(x => x.toLowerCase()),
        ...localAddresses.filter(x => x.includes(':')).map(x => `[${x.toLowerCase()}]`),
    ])
    const out: ClaudeServerEntry[] = []
    const add = (servers: unknown, scope: string) => {
        if (!servers || typeof servers !== 'object') {
            return
        }
        for (const [name, definition] of Object.entries(servers as Record<string, any>)) {
            const url = definition?.url
            if (typeof url !== 'string') {
                continue
            }
            let parsed: URL
            try {
                parsed = new URL(url)
            } catch {
                continue
            }
            if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
                continue
            }
            if (!local.has(parsed.hostname.toLowerCase())) {
                continue
            }
            const port = parsed.port ? parseInt(parsed.port, 10) : parsed.protocol === 'https:' ? 443 : 80
            out.push({ name, scope, url: `${parsed.protocol}//${parsed.host}${parsed.pathname}`, port })
        }
    }
    const root: any = json && typeof json === 'object' ? json : {}
    add(root.mcpServers, 'user')
    if (root.projects && typeof root.projects === 'object') {
        for (const [project, value] of Object.entries(root.projects as Record<string, any>)) {
            add(value?.mcpServers, `local, ${project}`)
        }
    }
    return out
}

// ── Claude events ───────────────────────────────────────────────────────────

/**
 * Which apps have a live tabby-claude-status window, and whether each drains
 * the spool.
 *
 * A heartbeat carrying `app` names its own executable. One without it comes
 * from a plugin that predates coordination: its owner is the PID in its id
 * (`<pid>-<rand>`), found in the process probe, and it counts as consuming —
 * which every copy of the plugin did until it learned not to.
 */
export function claudeReaders (input: ConflictInput): ClaudeReader[] {
    const readers = new Map<string, ClaudeReader>()
    const selfPids = new Set(input.self.pids)
    for (const heartbeat of input.heartbeats) {
        const content: any = heartbeat.content
        if (!content || typeof content.id !== 'string' || typeof content.ts !== 'number') {
            continue
        }
        if (input.now - content.ts >= HEARTBEAT_FRESH_MS) {
            continue
        }
        const legacy = !content.app || typeof content.app !== 'object'
        const pid = legacy ? parseInt(content.id.split('-')[0], 10) : Number(content.app.pid)
        let executable: string | null = null
        if (!legacy && typeof content.app.exe === 'string' && content.app.exe) {
            executable = normalizeExecutable(content.app.exe, input.platform)
        } else {
            executable = input.processes.find(row => row.pid === pid)?.executable ?? null
        }
        const self = executable ? executable === input.self.executable : selfPids.has(pid)
        const key = self ? 'self' : executable ?? `pid:${pid}`
        const other = executable ? input.others.find(app => app.executable === executable) : undefined
        const name = self
            ? 'This app'
            : other?.name ?? (typeof content.app?.name === 'string' && content.app.name ? content.app.name : `PID ${pid}`)
        const consuming = typeof content.consuming === 'boolean' ? content.consuming : true
        const reader = readers.get(key)
        if (reader) {
            if (Number.isFinite(pid) && !reader.pids.includes(pid)) {
                reader.pids.push(pid)
            }
            reader.consuming ||= consuming
            reader.legacy ||= legacy
        } else {
            readers.set(key, { key, name, pids: Number.isFinite(pid) ? [pid] : [], self, consuming, legacy })
        }
    }
    return [...readers.values()]
        .map(reader => ({ ...reader, pids: [...reader.pids].sort((a, b) => a - b) }))
        .sort((a, b) => Number(b.self) - Number(a.self) || a.name.localeCompare(b.name))
}

// ── Conflicts ───────────────────────────────────────────────────────────────

const MCP_ACTIONS: ConflictAction[] = [
    { id: 'mcp-use-free-port', label: 'Use a free port here' },
    { id: 'mcp-stop-on-boot', label: 'Don\'t start MCP here' },
]

const HOTKEY_ACTIONS: ConflictAction[] = [
    { id: 'hotkey-clear', label: 'Clear this hotkey here' },
    { id: 'hotkey-settings', label: 'Open Hotkeys' },
]

function systemName (platform: string): string {
    return platform === 'win32' ? 'Windows' : platform === 'darwin' ? 'macOS' : 'The system'
}

function joinNames (names: string[]): string {
    return names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

function plural (count: number, one: string, many: string): string {
    return `${count} ${count === 1 ? one : many}`
}

function mcpConflicts (input: ConflictInput): Conflict[] {
    const { self, sockets } = input
    if (!self.mcp.loaded || !sockets) {
        return []
    }
    const selfPids = new Set(self.pids)
    const entriesOn = (port: number) => (input.claudeServers ?? []).filter(entry => entry.port === port)
    const entryChips = (port: number) => entriesOn(port).map(entry => `${entry.name} · ${entry.scope}`)
    const entriesLabel = (port: number) => entriesOn(port).length
        ? `Claude Code ${entriesOn(port).length === 1 ? 'entry' : 'entries'} on port ${port}`
        : null
    const entriesSentence = (port: number) => input.claudeServers === null
        ? 'The Claude Code config could not be read, so which of its entries use this port is unknown.'
        : entriesOn(port).length ? null : `No Claude Code entry in .claude.json points at port ${port}.`
    const conflicts: Conflict[] = []

    // This app holds a port another app is set to serve MCP on. Asked of the
    // other app's port rather than this one's configured port, so a port this
    // app was moved off but still holds until its server restarts still counts.
    for (const other of input.others) {
        if (!other.config) {
            continue
        }
        const port = other.config.mcpPort || MCP_DEFAULT_PORT
        if (!servesMcpOn(other.config, port)) {
            continue
        }
        if (!sockets.listening.some(row => row.port === port && selfPids.has(row.pid))) {
            continue
        }
        conflicts.push({
            id: `mcp-blocks|${other.executable}|${port}`,
            resource: 'mcp',
            title: `${other.name} cannot start its MCP server`,
            consequence: `This app holds port ${port}, which ${other.name} is also set to serve MCP on, so its server fails to start while this app runs.`,
            itemsLabel: entriesLabel(port),
            items: entryChips(port),
            location: other.displayExecutable,
            hint: [`Claude Code sessions pointed at port ${port} reach this app.`, entriesSentence(port)]
                .filter(x => !!x).join(' '),
            actions: MCP_ACTIONS,
        })
    }

    // Another process holds the port this app's server was meant to start on.
    const port = self.mcp.port || MCP_DEFAULT_PORT
    const holders = [...new Set(sockets.listening.filter(row => row.port === port).map(row => row.pid))]
    if (!self.mcp.startOnBoot || !holders.length || holders.some(pid => selfPids.has(pid))) {
        return conflicts
    }
    const pid = holders[0]
    const app = input.others.find(other => other.pids.includes(pid))
    const clients = sockets.connected.filter(row => row.port === port && holders.includes(row.pid)).length
    const hint = [
        clients ? `${plural(clients, 'client connection is', 'client connections are')} open to it now.` : null,
        entriesSentence(port),
    ].filter(x => !!x).join(' ') || null
    if (app) {
        conflicts.push({
            id: `mcp-held|${app.executable}|${port}`,
            resource: 'mcp',
            title: `${appLabel(app, pid)} serves MCP on port ${port}`,
            consequence: `This app's MCP server did not start, so Claude Code sessions pointed at port ${port} reach ${app.name}, not this app.`,
            itemsLabel: entriesLabel(port),
            items: entryChips(port),
            location: app.displayExecutable,
            hint,
            actions: MCP_ACTIONS,
        })
    } else {
        const holder = input.holderNames[pid] ?? 'Another process'
        conflicts.push({
            id: `mcp-held|pid:${pid}|${port}`,
            resource: 'mcp',
            title: `${holder} (PID ${pid}) holds port ${port}`,
            consequence: `This app's MCP server did not start, because the port it is set to use was already taken.`,
            itemsLabel: entriesLabel(port),
            items: entryChips(port),
            location: null,
            hint,
            actions: MCP_ACTIONS,
        })
    }
    return conflicts
}

function hotkeyConflicts (input: ConflictInput): Conflict[] {
    const { hotkey } = input.self
    if (!hotkey.enabled) {
        return []
    }
    const conflicts: Conflict[] = []
    const seen = new Set<string>()
    for (const { accelerator, registered } of hotkey.accelerators) {
        const chord = canonicalAccelerator(accelerator, input.platform)
        if (!chord || seen.has(chord) || registered === null) {
            continue
        }
        seen.add(chord)
        const binders = input.others.filter(other => other.config
            && registersHotkeys(other.config)
            && toggleWindowAccelerators(other.config.toggleWindow)
                .some(spec => canonicalAccelerator(spec, input.platform) === chord))

        if (!registered) {
            if (binders.length) {
                const names = joinNames(binders.map(other => other.name))
                conflicts.push({
                    id: `hotkey-held|${chord}|${binders.map(other => other.executable).join(',')}`,
                    resource: 'hotkey',
                    title: `${names} likely ${binders.length === 1 ? 'holds' : 'hold'} ${accelerator}`,
                    consequence: `This app could not register its toggle-window hotkey, so ${accelerator} brings up ${names} instead.`,
                    itemsLabel: null,
                    items: [],
                    location: binders[0].displayExecutable,
                    hint: `${systemName(input.platform)} does not say which application holds a hotkey. ${names} ${binders.length === 1 ? 'is' : 'are'} named because ${binders.length === 1 ? 'its settings bind' : 'their settings bind'} the same keys.`,
                    actions: HOTKEY_ACTIONS,
                })
            } else {
                conflicts.push({
                    id: `hotkey-held|${chord}|unknown`,
                    resource: 'hotkey',
                    title: `Another application holds ${accelerator}`,
                    consequence: `This app could not register its toggle-window hotkey, so ${accelerator} does nothing here.`,
                    itemsLabel: null,
                    items: [],
                    location: null,
                    hint: `${systemName(input.platform)} does not report which application holds it, and no running Tabby or Torbie binds it.`,
                    actions: HOTKEY_ACTIONS,
                })
            }
            continue
        }
        for (const other of binders) {
            conflicts.push({
                id: `hotkey-blocks|${chord}|${other.executable}`,
                resource: 'hotkey',
                title: `${other.name} cannot use ${accelerator}`,
                consequence: `This app holds ${accelerator} as its toggle-window hotkey, so the same hotkey does nothing in ${other.name} while this app runs.`,
                itemsLabel: null,
                items: [],
                location: other.displayExecutable,
                hint: null,
                actions: HOTKEY_ACTIONS,
            })
        }
    }
    return conflicts
}

function claudeConflicts (readers: ClaudeReader[]): Conflict[] {
    if (!readers.some(reader => reader.self && reader.consuming)) {
        return []
    }
    return readers
        .filter(reader => !reader.self && reader.consuming)
        .map(reader => ({
            id: `claude-both|${reader.key}`,
            resource: 'claude' as const,
            title: `${reader.name} and this app both read Claude events`,
            consequence: 'The hook spool is consume-and-delete, so each event reaches whichever app reads it first and the other never sees it.',
            itemsLabel: null,
            items: reader.pids.map(pid => `PID ${pid}`),
            location: null,
            hint: reader.legacy
                ? `${reader.name} runs a tabby-claude-status that does not say whether it reads the spool, so it is counted as reading it.`
                : null,
            actions: [],
        }))
}

/**
 * Everything worth saying about this app and the others running beside it.
 *
 * With no other Tabby or Torbie running there is nothing to collide with, and
 * the report is empty whatever else the snapshot holds.
 */
export function computeConflicts (input: ConflictInput): ConflictReport {
    if (!input.others.length) {
        return { checkedAt: input.now, others: [], conflicts: [], claudeReaders: [] }
    }
    const readers = claudeReaders(input)
    return {
        checkedAt: input.now,
        others: input.others,
        conflicts: [...mcpConflicts(input), ...hotkeyConflicts(input), ...claudeConflicts(readers)],
        claudeReaders: readers,
    }
}

/** One line for a toast: the title names the other app, and this says where to act. */
export function toastMessage (conflict: Conflict): string {
    return `${conflict.title}. Settings → Builds says what to do about it.`
}
