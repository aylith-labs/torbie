import * as net from 'net'
import * as os from 'os'
import * as path from 'path'
import { execFile } from 'child_process'
import { Inject, Injectable, Injector } from '@angular/core'
import * as yaml from 'js-yaml'
import { ToastrService } from 'ngx-toastr'
import { Observable, Subject } from 'rxjs'
import { AppService, BOOTSTRAP_DATA, BootstrapData, ConfigService, HostWindowService } from 'tabby-core'
import { SettingsTabComponent } from 'tabby-settings'

import {
    candidatePorts,
    claudeAddCommand,
    ClaudeServerEntry,
    claudeServers,
    computeConflicts,
    ConflictActionId,
    ConflictInput,
    ConflictReport,
    groupOtherProcesses,
    HEARTBEAT_DIRECTORY,
    HeartbeatFile,
    identifyApp,
    MCP_DEFAULT_PORT,
    MCP_PACKAGE,
    MCP_PLUGIN,
    MCP_PORT_SEARCH_FROM,
    MCP_PORT_SEARCH_TO,
    OtherApp,
    OtherAppConfig,
    parseNetstat,
    readOtherAppConfig,
    Sockets,
    toastMessage,
    toggleWindowAccelerators,
} from '../conflicts'
import { fs } from '../nodeFs'
import { BuildProcessesService, normalize } from './buildProcesses.service'

/**
 * How long after config is ready the first check waits. tabby-mcp-server
 * starts its server once config has loaded, and a check that ran before it
 * had bound its port — or failed to — would find nobody listening and say
 * nothing at all.
 */
const BOOT_DELAY_MS = 15000

/** A check triggered by focus runs at most this often. */
const FOCUS_INTERVAL_MS = 30000

/**
 * A hotkey change goes renderer → config → IPC → `globalShortcut.register` in
 * the main process. Asking `isRegistered` before that round trip has landed
 * would report the old registration.
 */
const REGISTRATION_SETTLE_MS = 750

/** Toasts remembered for inspection; enough to cover any real session. */
const ANNOUNCEMENT_LOG = 100

/** The port a free-port action moved this app's MCP server to, and how to tell Claude Code. */
export interface McpMove {
    port: number
    previous: number
    command: string
}

function run (command: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
        execFile(command, args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: 15000 }, (err, stdout) => {
            if (err) {
                reject(err)
                return
            }
            resolve(stdout.toString())
        })
    })
}

function system32 (exe: string): string {
    return path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', exe)
}

async function exists (target: string): Promise<boolean> {
    try {
        await fs.access(target)
        return true
    } catch {
        return false
    }
}

/**
 * Whether tabby-mcp-server could listen on `port`. Asked with the bind it
 * makes — no host, which is the dual-stack wildcard — because a port can be
 * free in `netstat` and still refused: Windows reserves ranges for Hyper-V
 * and WSL that no socket table lists.
 */
function bindable (port: number): Promise<boolean> {
    return new Promise(resolve => {
        const server = net.createServer()
        server.once('error', () => resolve(false))
        server.listen(port, () => server.close(() => resolve(true)))
    })
}

/** This machine's own interface addresses, which reach the MCP server as well as loopback does. */
function localAddresses (): string[] {
    const out: string[] = []
    for (const addresses of Object.values(os.networkInterfaces())) {
        for (const address of addresses ?? []) {
            out.push(address.address)
        }
    }
    return out
}

/**
 * Notices when another running Tabby or Torbie wants the same machine-wide
 * resource as this one, names it, and offers what this app can do about it.
 *
 * It runs whether or not the Builds page is open, because the conflicts it
 * finds are silent everywhere else: a global hotkey that registers second
 * fails without a word, and tabby-mcp-server writes EADDRINUSE only to its own
 * log. It never touches the other app.
 */
@Injectable({ providedIn: 'root' })
export class BuildConflictsService {
    /** The last completed check; null before one has run, or while detection is off. */
    report: ConflictReport | null = null
    checking = false
    /** Set by the free-port action, so the Claude Code command stays on screen. */
    mcpMove: McpMove | null = null
    /** Every toast raised, oldest first — what the user was told, and what a test counts. */
    readonly announcements: { id: string, at: number }[] = []

    get changed$ (): Observable<void> { return this.changed }
    private changed = new Subject<void>()
    /** Conflicts already toasted and still present. One that clears and comes back is toasted again. */
    private announced = new Set<string>()
    private inFlight: Promise<ConflictReport | null> | null = null
    private lastStarted = 0
    private started = false
    private claudeCache: { file: string, mtimeMs: number, servers: ClaudeServerEntry[] } | null = null

    constructor (
        @Inject(BOOTSTRAP_DATA) private bootstrapData: BootstrapData,
        private config: ConfigService,
        private hostWindow: HostWindowService,
        private injector: Injector,
        private processes: BuildProcessesService,
        private toastr: ToastrService,
    ) { }

    /** Defensive: something may ask before config has loaded. */
    get enabled (): boolean {
        return this.config.store?.builds?.detectConflicts !== false
    }

    /** Called once config is ready. */
    start (): void {
        if (this.started) {
            return
        }
        this.started = true
        setTimeout(() => void this.check(), BOOT_DELAY_MS)
        this.hostWindow.windowFocused$.subscribe(() => {
            if (Date.now() - this.lastStarted >= FOCUS_INTERVAL_MS) {
                void this.check()
            }
        })
    }

    /**
     * Look again. Without `force` this does nothing while the window is
     * unfocused — a check costs a PowerShell spawn, and a window in the
     * background has nobody to tell. `force` is for something the user just
     * did: opening the page, pressing Recheck, taking an action.
     */
    async check (force = false): Promise<ConflictReport | null> {
        if (!this.enabled) {
            this.report = null
            return null
        }
        if (!force && !document.hasFocus()) {
            return this.report
        }
        if (this.inFlight) {
            if (!force) {
                return this.inFlight
            }
            // A forced check follows a change, so a result gathered before it
            // would describe the state the change was made to escape.
            await this.inFlight
            if (this.inFlight) {
                return this.inFlight
            }
        }
        this.lastStarted = Date.now()
        this.checking = true
        this.changed.next()
        this.inFlight = this.gather()
            .then(input => {
                const report = computeConflicts(input)
                this.report = report
                this.announce(report)
                return report
            })
            .catch(err => {
                console.warn('Conflict check failed:', err)
                return this.report
            })
            .finally(() => {
                this.inFlight = null
                this.checking = false
                this.changed.next()
            })
        return this.inFlight
    }

    /** For the Builds page opening: a fresh enough answer is shown as it is. */
    checkIfStale (): Promise<ConflictReport | null> {
        if (this.report && Date.now() - this.report.checkedAt < FOCUS_INTERVAL_MS) {
            return Promise.resolve(this.report)
        }
        return this.check(true)
    }

    // ── Actions — every one of them on this app ──────────────────────────

    async run (action: ConflictActionId): Promise<void> {
        switch (action) {
            case 'mcp-use-free-port':
                if (await this.useFreeMcpPort() === null) {
                    throw new Error(`No port between ${MCP_PORT_SEARCH_FROM} and ${MCP_PORT_SEARCH_TO} is free`)
                }
                break
            case 'mcp-stop-on-boot':
                await this.stopMcpOnBoot()
                break
            case 'hotkey-clear':
                await this.clearToggleWindowHotkey()
                break
            case 'hotkey-settings':
                this.openSettings('hotkeys')
                break
        }
    }

    /**
     * Move this app's MCP server to the first port from 3002 that nothing
     * listens on and that can actually be bound. Only the setting changes: the
     * running server keeps what it has until the MCP page restarts it or the
     * app reloads, which is why the command to point Claude Code at the new
     * port is kept on screen.
     */
    async useFreeMcpPort (): Promise<number | null> {
        const mcp = this.config.store.mcp
        if (!mcp) {
            return null
        }
        const previous = Number(mcp.port) || MCP_DEFAULT_PORT
        const sockets = process.platform === 'win32' ? await this.sockets() : null
        for (const port of candidatePorts(sockets)) {
            if (port === previous || !await bindable(port)) {
                continue
            }
            mcp.port = port
            await this.config.save()
            this.mcpMove = { port, previous, command: claudeAddCommand(port) }
            await this.check(true)
            return port
        }
        return null
    }

    async stopMcpOnBoot (): Promise<void> {
        const mcp = this.config.store.mcp
        if (!mcp) {
            return
        }
        mcp.startOnBoot = false
        await this.config.save()
        await this.check(true)
    }

    async clearToggleWindowHotkey (): Promise<void> {
        this.config.store.hotkeys['toggle-window'] = []
        await this.config.save()
        await new Promise(resolve => setTimeout(resolve, REGISTRATION_SETTLE_MS))
        await this.check(true)
    }

    /** Settings, on one page. Reuses an open settings tab rather than stacking another. */
    openSettings (page: string): void {
        // Resolved on use rather than injected: this service is built while
        // the toolbar providers are, and asking for AppService from there is
        // the kind of cycle that leaves a window on its splash screen.
        const app = this.injector.get(AppService)
        const existing = app.tabs.find(tab => tab instanceof SettingsTabComponent)
        if (existing instanceof SettingsTabComponent) {
            existing.activeTab = page
            app.selectTab(existing)
            return
        }
        app.openNewTabRaw({ type: SettingsTabComponent, inputs: { activeTab: page } })
    }

    // ── Reading the machine ──────────────────────────────────────────────

    private async gather (): Promise<ConflictInput> {
        const selfExecutable = normalize(process.execPath)
        const rows = await this.processes.list()
        const processes = rows.map(row => ({
            pid: row.pid,
            executable: row.executable,
            displayExecutable: row.displayExecutable,
        }))
        const input: ConflictInput = {
            platform: process.platform,
            now: Date.now(),
            self: {
                executable: selfExecutable,
                pids: [...new Set([process.pid, ...processes.filter(x => x.executable === selfExecutable).map(x => x.pid)])],
                mcp: this.selfMcp(),
                hotkey: { enabled: false, accelerators: [] },
            },
            others: [],
            processes,
            sockets: null,
            holderNames: {},
            claudeServers: null,
            heartbeats: [],
        }

        const groups = groupOtherProcesses(processes, selfExecutable)
        if (!groups.length) {
            // Nothing else is running to collide with, so nothing else is read.
            return input
        }

        const defaultToggleWindow = this.config.getDefaults().hotkeys?.['toggle-window']
        input.others = await Promise.all(groups.map(group => this.describe(group, defaultToggleWindow)))
        input.self.hotkey = this.selfHotkey()
        if (input.self.mcp.loaded && process.platform === 'win32') {
            input.sockets = await this.sockets()
            if (input.sockets) {
                input.holderNames = await this.holderNames(input)
            }
            input.claudeServers = await this.readClaudeServers()
        }
        input.heartbeats = await this.readHeartbeats()
        input.now = Date.now()
        return input
    }

    private async describe (
        group: { executable: string, displayExecutable: string, pids: number[] },
        defaultToggleWindow: unknown,
    ): Promise<OtherApp> {
        const hasPortableData = await exists(path.join(path.dirname(group.displayExecutable), 'data'))
        const identity = identifyApp(group.displayExecutable, {
            platform: process.platform,
            env: process.env,
            hasPortableData,
        })
        return {
            ...identity,
            executable: group.executable,
            pids: group.pids,
            config: identity.configDirectory ? await this.readConfig(identity.configDirectory, defaultToggleWindow) : null,
        }
    }

    private async readConfig (directory: string, defaultToggleWindow: unknown): Promise<OtherAppConfig | null> {
        let raw: unknown = {}
        try {
            raw = yaml.load(await fs.readFile(path.join(directory, 'config.yaml'), 'utf8'))
        } catch (err: any) {
            // No file is an app that never saved a setting, which runs on
            // defaults. Anything else — unreadable, not YAML — is not known.
            if (err?.code !== 'ENOENT') {
                return null
            }
        }
        const mcpInstalled = await exists(path.join(directory, 'plugins', 'node_modules', MCP_PACKAGE))
        return readOtherAppConfig(raw, mcpInstalled, defaultToggleWindow)
    }

    /**
     * Loaded means it was installed and not blacklisted when this window
     * booted, which is `bootstrapData`'s own copy of the config — a plugin
     * switched on or off since then does not load or unload until a restart.
     * The `mcp` store existing is the proof its ConfigProvider actually ran.
     */
    private selfMcp (): ConflictInput['self']['mcp'] {
        const installed = (this.bootstrapData.installedPlugins ?? [])
            .some(plugin => plugin.name === MCP_PLUGIN || plugin.packageName === MCP_PACKAGE)
        const blacklist: string[] = this.bootstrapData.config?.pluginBlacklist ?? []
        const mcp = installed && !blacklist.includes(MCP_PLUGIN) ? this.config.store.mcp : null
        return {
            loaded: !!mcp,
            port: Number(mcp?.port) || null,
            startOnBoot: mcp?.startOnBoot !== false,
        }
    }

    /**
     * What Electron says this app registered. `isRegistered` answers only for
     * this process, which is exactly the question: false means somebody else
     * holds the chord, and the system will not say who.
     */
    private selfHotkey (): ConflictInput['self']['hotkey'] {
        const hack = this.config.store.hacks?.globalHotkey
        // `shouldRegisterGlobalHotkeys` in app/lib/app.ts: a set hack decides
        // outright. Unset, Linux under Wayland registers only on a recent
        // enough Plasma, which is not worth a spawn to find out — so nothing is
        // claimed there.
        const enabled = hack != null ? !hack : !(process.platform === 'linux' && process.env.XDG_SESSION_TYPE === 'wayland')
        if (!enabled) {
            return { enabled, accelerators: [] }
        }
        let shortcuts: any = null
        try {
            shortcuts = require('@electron/remote').globalShortcut
        } catch {
            // Not under Electron: nothing registered, and nothing to ask.
        }
        return {
            enabled,
            accelerators: toggleWindowAccelerators(this.config.store.hotkeys?.['toggle-window']).map(accelerator => {
                let registered: boolean | null = null
                try {
                    registered = shortcuts ? !!shortcuts.isRegistered(accelerator) : null
                } catch {
                    // An accelerator Electron cannot parse was never registered either.
                }
                return { accelerator, registered }
            }),
        }
    }

    private async sockets (): Promise<Sockets | null> {
        try {
            return parseNetstat(await run(system32('NETSTAT.EXE'), ['-ano']))
        } catch {
            return null
        }
    }

    /** Image names for whatever listens on this app's MCP port without being a Tabby or Torbie. */
    private async holderNames (input: ConflictInput): Promise<Record<number, string>> {
        const port = input.self.mcp.port || MCP_DEFAULT_PORT
        const known = new Set([...input.processes.map(x => x.pid), ...input.self.pids])
        const pids = new Set((input.sockets?.listening ?? []).filter(x => x.port === port && !known.has(x.pid)).map(x => x.pid))
        const names: Record<number, string> = {}
        for (const pid of pids) {
            try {
                const out = await run(system32('tasklist.exe'), ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'])
                const match = /^"([^"]+)","(\d+)"/m.exec(out)
                if (match && parseInt(match[2], 10) === pid) {
                    names[pid] = match[1]
                }
            } catch {
                // Named as "another process" instead.
            }
        }
        return names
    }

    /**
     * The Claude Code config, where Claude Code itself looks for it:
     * `$CLAUDE_CONFIG_DIR/.claude.json` when that is set, `~/.claude.json`
     * otherwise. Parsed only when its mtime moves.
     */
    private async readClaudeServers (): Promise<ClaudeServerEntry[] | null> {
        const file = path.join(process.env.CLAUDE_CONFIG_DIR || os.homedir(), '.claude.json')
        let mtimeMs: number
        try {
            mtimeMs = (await fs.stat(file)).mtimeMs
        } catch (err: any) {
            return err?.code === 'ENOENT' ? [] : null
        }
        if (this.claudeCache?.file === file && this.claudeCache.mtimeMs === mtimeMs) {
            return this.claudeCache.servers
        }
        try {
            const servers = claudeServers(JSON.parse(await fs.readFile(file, 'utf8')), localAddresses())
            this.claudeCache = { file, mtimeMs, servers }
            return servers
        } catch {
            return null
        }
    }

    /** tabby-claude-status's heartbeats. Read only: the directory is that plugin's. */
    private async readHeartbeats (): Promise<HeartbeatFile[]> {
        const directory = path.join(os.tmpdir(), HEARTBEAT_DIRECTORY)
        let names: string[]
        try {
            names = await fs.readdir(directory)
        } catch {
            return []
        }
        const out: HeartbeatFile[] = []
        for (const name of names.filter(x => x.endsWith('.json'))) {
            try {
                out.push({ file: name, content: JSON.parse(await fs.readFile(path.join(directory, name), 'utf8')) })
            } catch {
                // Caught mid-write, or not a heartbeat.
            }
        }
        return out
    }

    // ── Telling the user ─────────────────────────────────────────────────

    private announce (report: ConflictReport): void {
        const present = new Set(report.conflicts.map(x => x.id))
        for (const id of [...this.announced]) {
            if (!present.has(id)) {
                this.announced.delete(id)
            }
        }
        for (const conflict of report.conflicts) {
            if (this.announced.has(conflict.id)) {
                continue
            }
            this.announced.add(conflict.id)
            this.announcements.push({ id: conflict.id, at: Date.now() })
            if (this.announcements.length > ANNOUNCEMENT_LOG) {
                this.announcements.splice(0, this.announcements.length - ANNOUNCEMENT_LOG)
            }
            const toast = this.toastr.warning(toastMessage(conflict), 'Conflict with another running app')
            toast.onTap.subscribe(() => this.openSettings('builds'))
        }
    }
}
