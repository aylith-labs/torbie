/**
 * Telling an app whether the terminal is light or dark, and telling it again
 * when that changes: the colour-scheme reports of contour's spec, which kitty,
 * Ghostty, foot and WezTerm implement.
 *
 * - `CSI ? 996 n` asks; the answer is `CSI ? 997 ; 1 n` (dark) or
 *   `CSI ? 997 ; 2 n` (light).
 * - DEC private mode 2031 (`CSI ? 2031 h` / `l`) asks for that same report,
 *   unsolicited, whenever the scheme changes. `CSI ? 2031 $ p` asks whether
 *   the mode is set.
 *
 * xterm.js 6.0 implements none of it: 996 is swallowed by its own DSR handler
 * and 2031 is an unknown mode. An app can still ask for the background with
 * `OSC 11 ; ?`, which xterm does answer, but on Windows every local and WSL
 * pane runs through the inbox ConPTY, and that never forwards an OSC 10/11
 * query to the terminal at all. It does forward 996 and 2031, and the replies
 * back, so these are what a theme that follows the terminal (shefrd's
 * `theme.auto_switch`, Neovim's `background`) can actually reach here.
 *
 * Kept free of Angular and xterm so the fast test tier can load it.
 */

export type Appearance = 'dark' | 'light'

/** The mode number, and the DSR code that asks for the report. */
export const COLOR_SCHEME_MODE = 2031
export const COLOR_SCHEME_QUERY = 996

/** `CSI ? 997 ; 1|2 n` */
export function colorSchemeReport (appearance: Appearance): string {
    return `\x1b[?997;${appearance === 'dark' ? 1 : 2}n`
}

/**
 * Light or dark, from a background colour as a scheme or xterm's theme holds
 * it: `#rgb`, `#rrggbb`, `#rrggbbaa`, `rgb(…)` or `rgba(…)`. Null when it
 * cannot say, and for a fully transparent background, which shows whatever is
 * behind the window rather than this colour. The weights and the midpoint are
 * the ones apps apply to an `OSC 11` answer, so the two questions get the same
 * answer.
 */
export function appearanceOf (background: string | null | undefined): Appearance | null {
    const rgb = channels(background?.trim() ?? '')
    if (!rgb) {
        return null
    }
    const [r, g, b] = rgb
    return r * 299 + g * 587 + b * 114 >= 128_000 ? 'light' : 'dark'
}

function channels (color: string): [number, number, number] | null {
    const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(color)?.[1]
    if (hex) {
        const full = hex.length === 3 ? [...hex].map(c => c + c).join('') : hex
        if (full.length === 8 && full.slice(6, 8) === '00') {
            return null
        }
        return [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16)) as [number, number, number]
    }
    const fn = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(color)
    if (fn) {
        if (fn[4] !== undefined && parseFloat(fn[4]) === 0) {
            return null
        }
        return [fn[1], fn[2], fn[3]].map(x => Math.min(255, parseInt(x, 10))) as [number, number, number]
    }
    return null
}

export class ColorSchemeReportState {
    private reporting = false
    private appearance: Appearance | null = null

    get enabled (): boolean {
        return this.reporting
    }

    get current (): Appearance | null {
        return this.appearance
    }

    /** `CSI ? 996 n`: the report, or null while the appearance is unknown. */
    query (): string | null {
        return this.appearance ? colorSchemeReport(this.appearance) : null
    }

    setReporting (on: boolean): void {
        this.reporting = on
    }

    /** `CSI ? 2031 $ p`: 1 set, 2 reset. */
    modeReport (): string {
        return `\x1b[?${COLOR_SCHEME_MODE};${this.reporting ? 1 : 2}$y`
    }

    /**
     * The terminal's colours were (re)applied. Returns the unsolicited report
     * to send, or null: nothing is sent unless mode 2031 is set and the
     * appearance actually changed, so re-applying the same scheme on every
     * config save is silent. The first appearance learned is never pushed —
     * an app that set the mode before it was known asks with 996 anyway.
     */
    update (appearance: Appearance | null): string | null {
        if (!appearance || appearance === this.appearance) {
            return null
        }
        const previous = this.appearance
        this.appearance = appearance
        return this.reporting && previous ? colorSchemeReport(appearance) : null
    }

    /** RIS or DECSTR. The appearance is the terminal's, so it survives. */
    reset (): void {
        this.reporting = false
    }
}

/** A CSI parameter list as xterm's parser hands it over: numbers, or sub-parameter arrays. */
export type CsiParams = (number | number[])[]

function params (list: CsiParams): number[] {
    return list.map(p => Array.isArray(p) ? p[0] : p)
}

/** The slice of xterm's parser API this needs, so the fast tests can drive it without xterm. */
export interface CsiParserLike {
    registerCsiHandler (id: { prefix?: string, intermediates?: string, final: string }, callback: (params: CsiParams) => boolean): { dispose (): void }
    registerEscHandler (id: { intermediates?: string, final: string }, callback: () => boolean): { dispose (): void }
}

/**
 * Wire the state to a parser; `reply` sends to the session. Every handler
 * that sees a sequence it does not own returns false, so xterm's own DSR,
 * DECSET and DECRQM handling is untouched for everything else.
 */
export function attachColorSchemeReports (
    parser: CsiParserLike,
    state: ColorSchemeReportState,
    reply: (data: string) => void,
): { dispose (): void }[] {
    const setMode = (on: boolean) => (list: CsiParams): boolean => {
        // Observed, never consumed: `CSI ? 2031 ; 1000 h` sets both, and
        // xterm still has to see the 1000. It ignores 2031 itself.
        if (params(list).includes(COLOR_SCHEME_MODE)) {
            state.setReporting(on)
        }
        return false
    }
    return [
        parser.registerCsiHandler({ prefix: '?', final: 'n' }, list => {
            const p = params(list)
            if (p.length !== 1 || p[0] !== COLOR_SCHEME_QUERY) {
                return false
            }
            const report = state.query()
            if (report) {
                reply(report)
            }
            return true
        }),
        parser.registerCsiHandler({ prefix: '?', final: 'h' }, setMode(true)),
        parser.registerCsiHandler({ prefix: '?', final: 'l' }, setMode(false)),
        parser.registerCsiHandler({ prefix: '?', intermediates: '$', final: 'p' }, list => {
            if (params(list)[0] !== COLOR_SCHEME_MODE) {
                return false
            }
            reply(state.modeReport())
            return true
        }),
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
