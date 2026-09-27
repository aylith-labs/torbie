/**
 * Modified Enter for apps that can tell it apart from Enter: Shift+Enter as a
 * newline in Claude Code, without a plugin.
 *
 * A legacy terminal sends CR for Enter and for Shift+Enter alike, so an app
 * cannot see the difference. Two standard ways out exist, and an app opts in
 * to either:
 *
 * - the kitty keyboard protocol: the app queries (`CSI ? u`) and pushes flags
 *   (`CSI > flags u`); with the "disambiguate" flag, Shift+Enter is
 *   `CSI 13 ; 2 u`.
 * - xterm's modifyOtherKeys: at level 2 (`CSI > 4 ; 2 m`), Shift+Enter is
 *   `CSI 27 ; 2 ; 13 ~`.
 *
 * xterm.js 6.0 implements neither (kitty keyboard only arrives in 6.1, still
 * beta), so this is that subset: Enter with Shift, Ctrl, Alt or Meta, and
 * nothing else. Every other key keeps xterm's legacy encoding, which every app
 * that negotiates these modes still decodes.
 *
 * One deliberate step past the spec, and why: on Windows a pane's output runs
 * through the inbox ConPTY, which answers the app's DA1 sentinel (`CSI c`)
 * itself and at once, so the app reads that before this terminal's answer to
 * its `CSI ? u` and concludes there is no kitty support. Claude Code does
 * exactly this and never pushes flags. An app that asks `CSI ? u` decodes the
 * answer's encoding, so asking arms CSI-u for modified Enter until the app
 * resets the keyboard modes again (`CSI > 4 m`, which Claude Code writes on
 * exit), pops what it pushed, or the terminal is reset.
 *
 * Kept free of Angular and xterm so the fast test tier can load it.
 */

/** Kitty's "disambiguate escape codes", the only flag implemented. */
export const KITTY_DISAMBIGUATE = 1
const SUPPORTED_FLAGS = KITTY_DISAMBIGUATE
/** Kitty asks for a bounded stack; the oldest entry is dropped past this. */
const STACK_LIMIT = 16

export interface EnterModifiers {
    shift: boolean
    alt: boolean
    ctrl: boolean
    meta: boolean
}

export type ScreenKind = 'normal' | 'alternate'

/** How modified Enter is being encoded, for the test harnesses and the log. */
export type EnterEncoding = 'kitty' | 'modifyOtherKeys' | 'asked' | 'legacy'

/** Kitty and xterm share this encoding: 1 + shift(1) + alt(2) + ctrl(4) + super(8). */
export function modifierParam (m: EnterModifiers): number {
    return 1 + (m.shift ? 1 : 0) + (m.alt ? 2 : 0) + (m.ctrl ? 4 : 0) + (m.meta ? 8 : 0)
}

export class KeyboardProtocolState {
    /** Kitty keeps a separate stack for each screen. */
    private stacks: Record<ScreenKind, number[]> = { normal: [], alternate: [] }
    private modifyOtherKeys = 0
    private asked = false

    flags (screen: ScreenKind): number {
        const stack = this.stacks[screen]
        return stack.length ? stack[stack.length - 1] : 0
    }

    /** `CSI ? u`: the reply, which is the current flags as far as they are implemented. */
    query (screen: ScreenKind): string {
        this.asked = true
        return `\x1b[?${this.flags(screen)}u`
    }

    /** `CSI > flags u` */
    push (screen: ScreenKind, flags: number): void {
        const stack = this.stacks[screen]
        stack.push(flags & SUPPORTED_FLAGS)
        if (stack.length > STACK_LIMIT) {
            stack.shift()
        }
    }

    /** `CSI < n u`. Emptying the stack resets everything, as kitty specifies. */
    pop (screen: ScreenKind, count: number): void {
        const stack = this.stacks[screen]
        stack.splice(Math.max(0, stack.length - Math.max(1, count)))
        if (!stack.length) {
            this.asked = false
        }
    }

    /** `CSI = flags ; mode u`: 1 replaces, 2 sets bits, 3 clears bits. */
    set (screen: ScreenKind, flags: number, mode: number): void {
        const stack = this.stacks[screen]
        const current = this.flags(screen)
        const next = mode === 2 ? current | flags : mode === 3 ? current & ~flags : flags
        if (stack.length) {
            stack[stack.length - 1] = next & SUPPORTED_FLAGS
        } else {
            stack.push(next & SUPPORTED_FLAGS)
        }
    }

    /**
     * `CSI > Pp ; Pv m` (XTMODKEYS). Only resource 4, modifyOtherKeys, is
     * kept; a missing value resets it, and a reset is an app handing the
     * keyboard back, so it also disarms "asked".
     */
    setModifyOtherKeys (resource: number, value: number | undefined): void {
        if (resource !== 4) {
            return
        }
        this.modifyOtherKeys = value ?? 0
        if (!this.modifyOtherKeys) {
            this.asked = false
        }
    }

    /** RIS or DECSTR. */
    reset (): void {
        this.stacks = { normal: [], alternate: [] }
        this.modifyOtherKeys = 0
        this.asked = false
    }

    encoding (screen: ScreenKind): EnterEncoding {
        if (this.flags(screen) & KITTY_DISAMBIGUATE) {
            return 'kitty'
        }
        if (this.modifyOtherKeys >= 2) {
            return 'modifyOtherKeys'
        }
        return this.asked ? 'asked' : 'legacy'
    }

    /**
     * What Enter with these modifiers sends, or null for xterm's own bytes.
     * Plain Enter is always CR: kitty keeps it legacy even when disambiguating,
     * so a shell left in a mode by a crashed app still runs commands.
     */
    encodeEnter (screen: ScreenKind, m: EnterModifiers): string | null {
        const mods = modifierParam(m)
        if (mods === 1) {
            return null
        }
        switch (this.encoding(screen)) {
            case 'kitty':
            case 'asked':
                return `\x1b[13;${mods}u`
            case 'modifyOtherKeys':
                return `\x1b[27;${mods};13~`
            default:
                return null
        }
    }
}

/** A CSI parameter list as xterm's parser hands it over: numbers, or sub-parameter arrays. */
export type CsiParams = (number | number[])[]

function param (params: CsiParams, index: number): number | undefined {
    const value = params[index]
    const n = Array.isArray(value) ? value[0] : value
    // xterm reports an omitted parameter as 0, which is also what these sequences default to.
    return n === undefined || n < 0 ? undefined : n
}

/** The slice of xterm's parser API this needs, so the fast tests can drive it without xterm. */
export interface CsiParserLike {
    registerCsiHandler (id: { prefix?: string, intermediates?: string, final: string }, callback: (params: CsiParams) => boolean): { dispose (): void }
    registerEscHandler (id: { intermediates?: string, final: string }, callback: () => boolean): { dispose (): void }
}

/**
 * Wire the state to a parser. `reply` sends to the session, `screen` names the
 * active buffer, and `enabled` is read on every sequence so the setting takes
 * effect without reopening the tab. Disabled, nothing is answered or kept.
 * Handlers return false where another handler may also want the sequence.
 */
export function attachKeyboardProtocol (
    parser: CsiParserLike,
    state: KeyboardProtocolState,
    reply: (data: string) => void,
    screen: () => ScreenKind,
    enabled: () => boolean,
): { dispose (): void }[] {
    return [
        parser.registerCsiHandler({ prefix: '?', final: 'u' }, () => {
            if (!enabled()) {
                return false
            }
            reply(state.query(screen()))
            return true
        }),
        parser.registerCsiHandler({ prefix: '>', final: 'u' }, params => {
            if (!enabled()) {
                return false
            }
            state.push(screen(), param(params, 0) ?? 0)
            return true
        }),
        parser.registerCsiHandler({ prefix: '<', final: 'u' }, params => {
            if (!enabled()) {
                return false
            }
            state.pop(screen(), param(params, 0) ?? 1)
            return true
        }),
        parser.registerCsiHandler({ prefix: '=', final: 'u' }, params => {
            if (!enabled()) {
                return false
            }
            state.set(screen(), param(params, 0) ?? 0, param(params, 1) || 1)
            return true
        }),
        parser.registerCsiHandler({ prefix: '>', final: 'm' }, params => {
            if (!enabled()) {
                return false
            }
            // `CSI > 4 m` arrives as [4]; `CSI > 4 ; 2 m` as [4, 2].
            state.setModifyOtherKeys(param(params, 0) ?? 0, params.length > 1 ? param(params, 1) : undefined)
            return true
        }),
        // Observed, never consumed: xterm does the actual resets.
        parser.registerEscHandler({ final: 'c' }, () => {
            state.reset()
            return false
        }),
        parser.registerCsiHandler({ intermediates: '!', final: 'p' }, () => {
            state.reset()
            return false
        }),
    ]
}
