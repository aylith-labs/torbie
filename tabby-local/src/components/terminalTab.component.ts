import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker'
import { Component, Input, Injector, Inject, Optional } from '@angular/core'
import { BaseTabProcess, DiagnosticsService, WIN_BUILD_CONPTY_SUPPORTED, isWindowsBuild, GetRecoveryTokenOptions } from 'tabby-core'
import { BaseTerminalTabComponent } from 'tabby-terminal'
import { filter, first } from 'rxjs'
import { LocalProfile, SessionOptions, UACService } from '../api'
import { Session } from '../session'

/** @hidden */
@Component({
    standalone: false,
    selector: 'terminalTab',
    template: BaseTerminalTabComponent.template,
    styles: BaseTerminalTabComponent.styles,
    animations: BaseTerminalTabComponent.animations,
})
export class TerminalTabComponent extends BaseTerminalTabComponent<LocalProfile> {
    @Input() sessionOptions: SessionOptions // Deprecated
    session: Session|null = null
    /** When this tab was created, for the tab-open phases on the launch timeline. */
    private openedAt = Date.now()

    // eslint-disable-next-line @typescript-eslint/no-useless-constructor
    constructor (
        injector: Injector,
        @Optional() @Inject(UACService) private uac: UACService|undefined,
    ) {
        super(injector)
    }

    ngOnInit (): void {
        this.sessionOptions = this.profile.options

        this.logger = this.log.create('terminalTab')

        const isConPTY = isWindowsBuild(WIN_BUILD_CONPTY_SUPPORTED) && this.config.store.terminal.useConPTY

        this.subscribeUntilDestroyed(this.hotkeys.hotkey$, hotkey => {
            if (!this.hasFocus) {
                return
            }
            switch (hotkey) {
                case 'home':
                    this.sendInput(isConPTY ? '\x1b[H' : '\x1bOH')
                    break
                case 'end':
                    this.sendInput(isConPTY ? '\x1b[F' : '\x1bOF')
                    break
            }
        })

        super.ngOnInit()
    }

    protected onFrontendReady (): void {
        this.injector.get(DiagnosticsService).timed('tab-frontend-ready', Date.now() - this.openedAt, { profile: this.profile.name })
        this.initializeSession(this.size.columns, this.size.rows)
        this.savedStateIsLive = this.profile.options.restoreFromPTYID === this.session?.getID()
        super.onFrontendReady()
    }

    initializeSession (columns: number, rows: number): void {

        const session = new Session(this.injector)

        if (this.profile.options.runAsAdministrator && this.uac?.isAvailable) {
            this.profile = {
                ...this.profile,
                options: this.uac.patchSessionOptionsForUAC(this.profile.options),
            }
        }

        // Tab-open phases, per tab, on the launch timeline (Settings → Startup
        // & lifecycle): spawn requested → PTY spawned → first output on
        // screen. The main process records its own half (`pty-spawned`,
        // `pty-first-data`), so a slow shell and a renderer too busy to take
        // its output apart are told apart. Always recorded, not only when
        // slow: "fast" is an answer too.
        const diagnostics = this.injector.get(DiagnosticsService)
        const profile = this.profile.name
        const spawnStarted = Date.now()
        // Non-empty: attaching the session releases its initial buffer, and
        // that emits even when the process has printed nothing yet.
        session.binaryOutput$.pipe(filter(data => data.length > 0), first()).subscribe(() => {
            const now = Date.now()
            diagnostics.timed('tab-first-output', now - this.openedAt, { profile, afterSpawnMs: now - spawnStarted })
        })

        session.start({
            ...this.profile.options,
            width: columns,
            height: rows,
        }).then(() => {
            // No rejection handler on purpose: a failed start stays the
            // unhandled rejection it always was, and is reported as one.
            diagnostics.timed('tab-pty-spawned', Date.now() - spawnStarted, { profile })
        })

        this.setSession(session)
        this.recoveryStateChangedHint.next()
    }

    async getRecoveryToken (options?: GetRecoveryTokenOptions): Promise<any> {
        const cwd = this.session ? await this.session.getWorkingDirectory() : null
        return {
            type: 'app:local-tab',
            profile: {
                ...this.profile,
                options: {
                    ...this.profile.options,
                    cwd: cwd ?? this.profile.options.cwd,
                    restoreFromPTYID: options?.includeState && this.session?.getID(),
                },
            },
            savedState: options?.includeState && this.frontend?.saveState(),
        }
    }

    async getCurrentProcess (): Promise<BaseTabProcess|null> {
        const children = await this.session?.getChildProcesses()
        if (!children?.length) {
            return null
        }
        return {
            name: children[0].command,
        }
    }

    async canClose (): Promise<boolean> {
        // Timed apart from the prompt below, because only this half is the
        // app's own doing: it walks the whole process tree through a native
        // module on every single tab close, and the answer is usually "no
        // children" — a cost paid to learn nothing.
        const walk = this.injector.get(DiagnosticsService).span('tab:close:getChildProcesses')
        const children = await this.session?.getChildProcesses()
        walk.end({ children: children?.length ?? 0 })
        if (!children?.length) {
            return true
        }
        return (await this.platform.showMessageBox(
            {
                type: 'warning',
                message: this.translate.instant(
                    _('"{command}" is still running. Close?'),
                    children[0],
                ),
                buttons: [
                    this.translate.instant(_('Kill')),
                    this.translate.instant(_('Cancel')),
                ],
                defaultId: 0,
                cancelId: 1,
            },
        )).response === 0
    }

    ngOnDestroy (): void {
        super.ngOnDestroy()
        this.session?.destroy()
    }

    /**
     * Return true if the user explicitly exit the session.
     * Always return true for terminalTab as the session can only be ended by the user
     */
    protected isSessionExplicitlyTerminated (): boolean {
        return true
    }
}
