import { Inject, Injectable } from '@angular/core'
import { Subject, Observable } from 'rxjs'
import Color, { type ColorInstance } from 'color'
import { ConfigService } from '../services/config.service'
import { TerminalColorScheme, Theme } from '../api/theme'
import { PlatformService, PlatformTheme } from '../api/platform'
import { NewTheme } from '../theme'

/**
 * Contrast floor for the chrome's derived tints: colours that mark something
 * rather than spell it out, like the scrollbar thumb or a focused input's
 * border. A higher `terminal.minimumContrastRatio` raises it.
 *
 * The terminal grid defaults to no adjustment at all, so it cannot be the only
 * thing keeping derived UI colours visible. 4 is what the terminal setting used
 * to default to, and raising that setting still raises this one with it.
 *
 * It used to floor every derived pair, text included, which let words sit at
 * 4:1 — a secondary button's label measured 4.30. A pair whose foreground is
 * read as text floors at TEXT_CONTRAST_RATIO now; the pairs in
 * applyThemeVariables say which is which.
 */
const UI_MINIMUM_CONTRAST_RATIO = 4

/**
 * What a boundary needs against its surroundings to be seen: WCAG's figure for
 * the edge of a component. An alert's border has to reach it, and a badge whose
 * fill does not reach it is given an outline that does.
 */
const EDGE_CONTRAST_RATIO = 3

/**
 * How much of a theme colour an alert's fill carries over the page. The fill
 * is computed here rather than with color-mix() in the stylesheet, so that the
 * text and the border drawn on it can be measured against it.
 */
const ALERT_TINT = 0.14

/**
 * What text has to reach: WCAG AA for body-sized text.
 *
 * Deliberately not UI_MINIMUM_CONTRAST_RATIO. That floor is for colours that are
 * quiet by design and mostly decorate. This one is for colours that carry words
 * somebody has to read — `--theme-muted-fg`, which holds a settings row's
 * explanation or a profile's address, and the label on a badge.
 */
const TEXT_CONTRAST_RATIO = 4.5

/**
 * State layers: how much of a surface's own ink is laid over it while it is
 * hovered or pressed — Material's state-layer model. Being a share of the ink
 * rather than a fixed grey, the step goes toward the text in a light scheme
 * and in a dark one alike, on a neutral row as on a filled button, and on the
 * selected segment of a group as on the others.
 */
export const HOVER_LAYER = 0.1
export const PRESSED_LAYER = 0.18

/**
 * The least a filled control's hover may move it. A layer is mixed in RGB, and
 * on a few saturated fills (Homebrew's pure blue under a white label) ten
 * percent moved the luminance by 0.2% — a hover nobody could see.
 */
const MIN_STATE_STEP = 1.08

/** `fill` with `ink` laid over it at `layer`, in whole channels. */
export function stateFill (fill: ColorInstance, ink: ColorInstance, layer: number): ColorInstance {
    return fill.alpha(1).mix(ink.alpha(1), layer).rgb().round()
}

/**
 * The layer to use on `fill`: `layer`, or more if that is not a visible step.
 * Capped at half, which is still unmistakably the same control.
 */
export function visibleLayer (fill: ColorInstance, ink: ColorInstance, layer: number): number {
    const rest = fill.alpha(1).rgb().round()
    while (layer < 0.5 && stateFill(fill, ink, layer).contrast(rest) < MIN_STATE_STEP) {
        layer += 0.02
    }
    return layer
}

@Injectable({ providedIn: 'root' })
export class ThemesService {
    get themeChanged$ (): Observable<Theme> { return this.themeChanged }
    private themeChanged = new Subject<Theme>()

    private styleElement: HTMLElement|null = null
    private rootElementStyleBackup = ''

    /** @hidden */
    private constructor (
        private config: ConfigService,
        private standardTheme: NewTheme,
        private platform: PlatformService,
        @Inject(Theme) private themes: Theme[],
    ) {
        this.rootElementStyleBackup = document.documentElement.style.cssText
        this.applyTheme(standardTheme)
        this.applyThemeVariables()
        config.ready$.toPromise().then(() => {
            this.applyCurrentTheme()
            this.applyThemeVariables()
            platform.themeChanged$.subscribe(() => {
                this.applyCurrentTheme()
                this.applyThemeVariables()
            })
            config.changed$.subscribe(() => {
                this.applyCurrentTheme()
                this.applyThemeVariables()
            })
        })
    }

    private getConfigStoreOrDefaults (): any {
        /// Theme service is active before the vault is unlocked and config is available
        return this.config.store ?? this.config.getDefaults()
    }

    private applyThemeVariables () {
        if (!this.findCurrentTheme().followsColorScheme) {
            document.documentElement.style.cssText = this.rootElementStyleBackup
        }

        const theme = this._getActiveColorScheme()
        const isDark = Color(theme.background).luminosity() < Color(theme.foreground).luminosity()

        function more (some, factor) {
            if (isDark) {
                return Color(some).darken(factor)
            }
            return Color(some).lighten(factor)
        }

        function less (some, factor) {
            if (!isDark) {
                return Color(some).darken(factor)
            }
            return Color(some).lighten(factor)
        }

        // Elevated background surfaces need their own ladder. more() moves a
        // colour away from the foreground, which on a light scheme means
        // lightening — a no-op on white, collapsing --theme-bg-more(-2) into the
        // page. Those back --bs-border-color, --bs-form-control-bg, the vertical
        // tab bar and the title bar, so controls lose their borders entirely.
        // Decide the direction once from the scheme background (so the ladder
        // stays monotonic) and step gently on light schemes, where darkening
        // moves much further per unit than it does on an already-dark colour.
        const backgroundLightness = Color(theme.background).lightness()
        const bgGoesDarker = backgroundLightness >= 92 || isDark && backgroundLightness > 8
        const bgFactor = backgroundLightness >= 92 ? 0.3 : 1

        // The mirror of bgMore, stepping toward the foreground. Without the
        // gentler light-scheme factor this darkens white by a full 50% for
        // --theme-bg-less-2, which backs the profile list hover — a mid-grey
        // row under the cursor on a white page.
        function bgLess (some, factor) {
            const color = Color(some)
            return isDark
                ? color.lighten(factor * bgFactor)
                : color.darken(factor * bgFactor)
        }

        function bgMore (some, factor) {
            const color = Color(some)
            if (bgGoesDarker) {
                return color.darken(factor * bgFactor)
            }
            if (color.lightness() <= 8) {
                // lighten() scales HSL lightness, so it cannot move #000 at all.
                // Step additively for near-black schemes.
                return color.lightness(color.lightness() + factor * 20)
            }
            return color.lighten(factor * bgFactor)
        }

        let background = Color(theme.background)
        if (this.getConfigStoreOrDefaults().appearance.vibrancy) {
            background = background.fade(0.6)
        }
        // const background = theme.background
        const backgroundMore = bgMore(background.string(), 0.25).string()
        // const backgroundMore =more(theme.background, 0.25).string()
        const accentIndex = 4
        const vars: Record<string, string> = {}
        // Each derived pair is floored by what its foreground is used for.
        // `text`: somewhere in the tree it colours words — body text, tab
        // titles, nav links and their hover, --bs-emphasis-color, <code> via
        // the accent, the active nav pill, an alert's text on its -fg fill, and
        // formerly a pressed button's label. `tint`: it only marks something —
        // --theme-fg-more-2 is the scrollbar thumb, a focused input's border and
        // a fork mark's outline.
        const text = this.textMinimumContrastRatio()
        const tint = this.uiMinimumContrastRatio()
        const contrastPairs: [string, string, number][] = []

        vars['--body-bg'] = background.string()
        if (this.findCurrentTheme().followsColorScheme) {
            vars['--bs-body-bg'] = theme.background
            vars['--bs-body-color'] = theme.foreground
            vars['--bs-black'] = theme.colors[0]
            vars['--bs-red'] = theme.colors[1]
            vars['--bs-green'] = theme.colors[2]
            vars['--bs-yellow'] = theme.colors[3]
            vars['--bs-blue'] = theme.colors[4]
            vars['--bs-purple'] = theme.colors[5]
            vars['--bs-cyan'] = theme.colors[6]
            vars['--bs-gray'] = theme.colors[7]
            vars['--bs-gray-dark'] = theme.colors[8]
            // vars['--bs-red'] = theme.colors[9]
            // vars['--bs-green'] = theme.colors[10]
            // vars['--bs-yellow'] = theme.colors[11]
            // vars['--bs-blue'] = theme.colors[12]
            // vars['--bs-purple'] = theme.colors[13]
            // vars['--bs-cyan'] = theme.colors[14]

            contrastPairs.push(['--bs-body-bg', '--bs-body-color', text])

            vars['--theme-fg-more-2'] = more(theme.foreground, 0.5).string()
            vars['--theme-fg-more'] = more(theme.foreground, 0.25).string()
            vars['--theme-fg'] = theme.foreground
            vars['--theme-fg-less'] = less(theme.foreground, 0.25).string()
            vars['--theme-fg-less-2'] = less(theme.foreground, 0.5).string()

            vars['--theme-bg-less-2'] = bgLess(theme.background, 0.5).string()
            vars['--theme-bg-less'] = bgLess(theme.background, 0.25).string()
            vars['--theme-bg'] = theme.background
            vars['--theme-bg-more'] = backgroundMore
            vars['--theme-bg-more-2'] = bgMore(backgroundMore, 0.25).string()

            contrastPairs.push(['--theme-bg', '--theme-fg', text])
            contrastPairs.push(['--theme-bg-less', '--theme-fg-less', text])
            contrastPairs.push(['--theme-bg-less-2', '--theme-fg-less-2', text])
            contrastPairs.push(['--theme-bg-more', '--theme-fg-more', text])
            contrastPairs.push(['--theme-bg-more-2', '--theme-fg-more-2', tint])

            const surfaces = this.textSurfaces(vars)

            const themeColors = {
                primary: theme.colors[accentIndex],
                secondary: isDark
                    ? less(theme.background, 0.5).string()
                    : less(theme.background, 0.125).string(),
                tertiary: more(theme.background, 0.75).string(),
                warning: theme.colors[3],
                danger: theme.colors[1],
                success: theme.colors[2],
                info: theme.colors[4],
                dark: more(theme.background, 0.75).string(),
                light: more(theme.foreground, 0.5).string(),
                link: theme.colors[8], // for .btn-link
            }

            for (const [key, color] of Object.entries(themeColors)) {
                vars[`--bs-${key}-bg`] = more(color, 0.5).string()
                vars[`--bs-${key}-color`] = less(color, 0.5).string()
                vars[`--bs-${key}`] = color
                vars[`--bs-${key}-rgb`] = Color(color).rgb().array().join(', ')
                vars[`--theme-${key}-more-2`] = more(color, 1).string()
                vars[`--theme-${key}-more`] = more(color, 0.5).string()
                vars[`--theme-${key}`] = color
                vars[`--theme-${key}-less`] = less(color, 0.25).string()
                vars[`--theme-${key}-less-2`] = less(color, 0.75).string()
                vars[`--theme-${key}-fg`] = more(color, 3).string()

                vars[`--theme-${key}-active-bg`] = less(color, 1).string()
                vars[`--theme-${key}-active-fg`] = more(color, 1).string()

                // Text on this colour as a filled background: .text-bg-*,
                // .badge.bg-*, and a .btn-* label at rest, hovered and pressed,
                // each measured against its own fill. Bootstrap picks
                // .text-bg-*'s text colour at build time, against its own default
                // palette, so it is #fff or #000 whatever this runtime colour
                // turns out to be: white on AtomOneLight's pale grey "secondary"
                // measured 1.4:1. The -fg variables above are floored at the
                // chrome's 4, which left button labels at 4.3.
                const ink = Color(theme.foreground)
                const paper = Color(theme.background)
                vars[`--theme-${key}-contrast-fg`] = this.contrastingForeground(
                    Color(color), ink, paper,
                ).string()
                // Hovered and pressed: the fill with its own label laid over
                // it as a state layer, so the step is the same size and the
                // same direction as the label on every colour and in every
                // scheme. It used to be --theme-*-less, a fixed ladder step:
                // a light scheme's grey button jumped from #dadada to #a3a3a3
                // under the pointer, and the primary one went to black when
                // pressed. Each label is measured against its own state fill.
                //
                // Where laying the label over the fill would cost the label its
                // floor — AtomOneLight's blue under white went to 4.0:1 when
                // pressed and the label flipped to black — the layer goes the
                // other way, away from the label, so the label stays put.
                const label = Color(vars[`--theme-${key}-contrast-fg`])
                const labelRgb = label.rgb().round()
                const towardLabel = stateFill(Color(color), label, PRESSED_LAYER).contrast(labelRgb) >= text
                const layerInk = towardLabel ? label : Color(label.isLight() ? '#000' : '#fff')
                const hoverLayer = visibleLayer(Color(color), layerInk, HOVER_LAYER)
                const pressedLayer = Math.max(PRESSED_LAYER, hoverLayer + PRESSED_LAYER - HOVER_LAYER)
                for (const [state, layer] of [['hover', hoverLayer], ['pressed', pressedLayer]] as const) {
                    const fill = stateFill(Color(color), layerInk, layer)
                    vars[`--theme-${key}-${state}-bg`] = fill.string()
                    vars[`--theme-${key}-${state}-contrast-fg`] = (fill.contrast(labelRgb) >= text
                        ? labelRgb
                        : this.contrastingForeground(fill, ink, paper)).string()
                }
                vars[`--theme-${key}-active-contrast-fg`] = this.contrastingForeground(
                    Color(vars[`--theme-${key}-active-bg`]), ink, paper,
                ).string()

                // An alert's fill: this colour at ALERT_TINT over the page.
                const alertFill = Color(theme.background).mix(Color(color), ALERT_TINT).rgb().round()
                vars[`--theme-${key}-alert-bg`] = alertFill.string()
                const keySurfaces = [...surfaces, alertFill]

                // This colour as text on the page: .text-*, the label and
                // outline of .btn-outline-*, and an alert's text and links. A
                // terminal palette is picked for a terminal background, not for
                // the app's grey panels, and AtomOneLight's green measured 3.6:1
                // on its own page. Moved toward black or white only as far as
                // every surface needs, this colour's alert fill included.
                vars[`--theme-${key}-text`] = this.nearestMeetingContrast(
                    Color(color),
                    Color(isDark ? '#fff' : '#000'),
                    keySurfaces,
                    text,
                ).string()

                // This colour as a boundary: the colour nearest to it that
                // reaches 3:1 on every surface, the alert fill included. It is
                // an alert's border, and a faint badge's outline.
                const fill = Color(color).rgb().round()
                const border = this.nearestMeetingContrast(fill, Color(isDark ? '#fff' : '#000'), keySurfaces, EDGE_CONTRAST_RATIO)
                vars[`--theme-${key}-border`] = border.string()

                // A badge fill within 3:1 of any surface it can sit on has no
                // visible edge. AtomOneLight's "dark" is white, so a
                // .text-bg-dark badge on a white page read as a loose word.
                // Such a fill is outlined in the border colour; any other fill
                // gets no outline.
                vars[`--theme-${key}-edge`] = surfaces.every(s => fill.contrast(s) >= EDGE_CONTRAST_RATIO)
                    ? 'transparent'
                    : border.string()

                contrastPairs.push([`--theme-${key}`, `--theme-${key}-fg`, text])
                contrastPairs.push([`--theme-${key}-active-bg`, `--theme-${key}-active-fg`, text])
            }

            // .btn-link reads Bootstrap's --bs-link-color, which the loop above
            // happens to define for the `link` key as a lightened palette colour
            // that nothing measured: #787878 on Afterglow's panels, 3.98:1.
            // Plain anchors read --bs-link-color-rgb, which is left alone.
            vars['--bs-link-color'] = vars['--theme-link-text']
            vars['--bs-link-hover-color'] = vars['--theme-fg']

            const switchBackground = less(theme.colors[accentIndex], 0.25).string()
            vars['--bs-form-switch-bg'] = `url("data:image/svg+xml,%3csvg xmlns=%27http://www.w3.org/2000/svg%27 viewBox=%27-4 -4 8 8%27%3e%3ccircle r=%273%27 fill=%27${switchBackground}%27/%3e%3c/svg%3e")`
        }

        // Bootstrap paints <code> in its own pink, which belongs to no scheme in
        // this app and was the one hardcoded accent left in the UI — it shows up
        // wherever a path, a commit or an identifier is rendered. It follows the
        // color scheme instead, unless the user picked a colour.
        //
        // Parsed before it is used: this runs on every keystroke in the settings
        // box, so a half-typed `#ab` would otherwise throw out of Color() and
        // take every other variable in this pass with it.
        vars['--theme-accent'] = this.parseColor(
            this.getConfigStoreOrDefaults().appearance.accentColor,
        ) ?? theme.colors[accentIndex]
        contrastPairs.push(['--body-bg', '--theme-accent', text])

        vars['--spaciness'] = this.getConfigStoreOrDefaults().appearance.spaciness

        for (const [bg, fg, minimum] of contrastPairs) {
            // Judged in whole channels, which is what gets painted, but walked
            // from the colour as written: rounding hsl(40, 49%, 100%) to white
            // first throws its hue away, and the walk comes back grey.
            const colorBg = Color(vars[bg]).rgb().round()
            const colorFg = Color(vars[fg])
            if (colorBg.contrast(colorFg.rgb().round()) < minimum) {
                vars[fg] = this.ensureContrast(colorFg, colorBg, minimum).string()
            }
        }

        if (this.findCurrentTheme().followsColorScheme) {
            // Text is read on a hovered row as much as on a resting one, and a
            // hover lays the text colour itself over the row, which takes a
            // little contrast away. So the text is floored against the page
            // and its panels as they look hovered — in 47 of the bundled
            // schemes it would otherwise have dipped under 4.5:1 there.
            for (const key of ['--theme-fg', '--bs-body-color']) {
                vars[key] = this.readableUnderHover(Color(vars[key]), this.hoverableSurfaces(vars), isDark).string()
            }

            // Secondary text used to be the foreground at half opacity, which
            // is a different colour on every surface it lands on — about 2.5:1
            // on a light scheme's grey panels. This is one colour, quieter than
            // the foreground, that is measured against every background that
            // secondary text sits on: the page, the raised panels, and the two
            // hover fills a row can be wearing. Derived after the pairs above,
            // so it follows the foreground they may have adjusted.
            vars['--theme-muted-fg'] = this.mutedForeground(
                Color(vars['--theme-fg']),
                Color(theme.background),
                isDark,
                this.textSurfaces(vars),
            ).string()

            this.applyStateVariables(vars, Color(theme.background), isDark)
        }

        for (const [key, value] of Object.entries(vars)) {
            document.documentElement.style.setProperty(key, value)
        }

        document.body.classList.toggle('no-animations', !this.getConfigStoreOrDefaults().accessibility.animations)
    }

    /** A colour string, or null if it is not one — a half-typed value included. */
    private parseColor (value: string | null | undefined): string | null {
        if (!value) {
            return null
        }
        try {
            return Color(value).string()
        } catch {
            return null
        }
    }

    private uiMinimumContrastRatio (): number {
        return Math.max(
            UI_MINIMUM_CONTRAST_RATIO,
            this.getConfigStoreOrDefaults().terminal.minimumContrastRatio,
        )
    }

    /** AA for text, or higher if the terminal setting asks for more. */
    private textMinimumContrastRatio (): number {
        return Math.max(TEXT_CONTRAST_RATIO, this.uiMinimumContrastRatio())
    }

    /**
     * Text for a filled background: what Bootstrap's `color-contrast()` does at
     * build time, done against the colour actually painted.
     *
     * The scheme's own ink and paper are tried first, so a badge reads in the
     * scheme's colours rather than in pure black and white. Whichever reads
     * better is pushed toward black or white only as far as the text ratio
     * needs; if it still cannot get there, the other one is tried. Black or
     * white always reaches at least 4.58:1 on any colour, so the fallback at
     * the end is only reached when the terminal setting demands more than that.
     */
    private contrastingForeground (background: ColorInstance, foreground: ColorInstance, schemeBackground: ColorInstance): ColorInstance {
        const minimum = this.textMinimumContrastRatio()
        const [dark, light] = foreground.luminosity() <= schemeBackground.luminosity()
            ? [foreground, schemeBackground]
            : [schemeBackground, foreground]
        const towardBlack = this.nearestMeetingContrast(dark, Color('#000'), [background], minimum)
        const towardWhite = this.nearestMeetingContrast(light, Color('#fff'), [background], minimum)
        const [first, second] = dark.contrast(background) >= light.contrast(background)
            ? [towardBlack, towardWhite]
            : [towardWhite, towardBlack]
        if (first.contrast(background) >= minimum) {
            return first
        }
        if (second.contrast(background) >= minimum) {
            return second
        }
        return first.contrast(background) >= second.contrast(background) ? first : second
    }

    /**
     * The backgrounds that text in the chrome is measured against: the page,
     * the two raised panels, and the two fills a hovered row can wear. The
     * vibrancy fade is dropped from the page, since what shows through it is
     * the desktop and cannot be known here.
     */
    private textSurfaces (vars: Record<string, string>): ColorInstance[] {
        const surfaces = [
            '--body-bg', '--theme-bg', '--theme-bg-more', '--theme-bg-more-2',
            '--theme-bg-less', '--theme-bg-less-2',
        ].map(key => Color(vars[key]).alpha(1))
        // And the page and its panels under the hover layer, since a row's
        // secondary text is still read while the pointer is on it.
        const ink = Color(vars['--theme-fg'])
        return [...surfaces, ...this.hoverableSurfaces(vars).map(s => stateFill(s, ink, HOVER_LAYER))]
    }

    /** The surfaces a row or a control is hovered on: the page and its panels. */
    private hoverableSurfaces (vars: Record<string, string>): ColorInstance[] {
        // In whole channels, as painted: the layer is composited over the
        // surface the browser parsed, not over its unrounded HSL.
        return ['--body-bg', '--theme-bg', '--theme-bg-more', '--theme-bg-more-2'].map(key => Color(vars[key]).alpha(1).rgb().round())
    }

    /**
     * `text`, moved toward black or white only as far as it needs to reach the
     * text ratio on each of `surfaces` with a hover layer of itself over it.
     */
    private readableUnderHover (text: ColorInstance, surfaces: ColorInstance[], isDark: boolean): ColorInstance {
        const minimum = this.textMinimumContrastRatio()
        const end = Color(isDark ? '#fff' : '#000')
        const at = (t: number) => text.mix(end, t).rgb().round()
        const passes = (c: ColorInstance) => surfaces.every(s => c.contrast(stateFill(s, c, HOVER_LAYER)) >= minimum)
        if (passes(at(0)) || !passes(at(1))) {
            return passes(at(0)) ? at(0) : at(1)
        }
        let lo = 0
        let hi = 1
        for (let i = 0; i < 16; i++) {
            const mid = (lo + hi) / 2
            if (passes(at(mid))) {
                hi = mid
            } else {
                lo = mid
            }
        }
        return at(hi)
    }

    /**
     * The state-layer contract: what every hover, press, selection and focus
     * ring in the chrome is drawn with. See "State layers" in AGENTS.md.
     *
     * Neutral surfaces get a translucent layer of the text colour, so one
     * value works over the page, a panel, a menu or a modal alike. The
     * selected segment of a group is the scheme inverted — the text colour as
     * the fill — which keeps it unmistakable next to a hovered neighbour, and
     * hovering it lays its own label over it rather than washing it out.
     */
    private applyStateVariables (vars: Record<string, string>, paper: ColorInstance, isDark: boolean): void {
        const ink = Color(vars['--theme-fg']).rgb().round()
        const channels = ink.array().slice(0, 3).join(', ')
        vars['--theme-state-ink'] = channels
        vars['--theme-hover-layer'] = `${HOVER_LAYER * 100}%`
        vars['--theme-pressed-layer'] = `${PRESSED_LAYER * 100}%`
        vars['--theme-hover-bg'] = `rgba(${channels}, ${HOVER_LAYER})`
        vars['--theme-pressed-bg'] = `rgba(${channels}, ${PRESSED_LAYER})`

        const selected = ink
        const selectedFg = this.contrastingForeground(selected, ink, paper)
        const selectedHover = stateFill(selected, selectedFg, HOVER_LAYER)
        vars['--theme-selected-bg'] = selected.string()
        vars['--theme-selected-fg'] = selectedFg.string()
        vars['--theme-selected-hover-bg'] = selectedHover.string()
        vars['--theme-selected-hover-fg'] = (selectedHover.contrast(selectedFg) >= this.textMinimumContrastRatio()
            ? selectedFg
            : this.contrastingForeground(selectedHover, ink, paper)).string()

        // A focus ring is a boundary: the accent, moved only as far as 3:1 on
        // every surface it can be drawn over needs. Bootstrap's is its own
        // compiled blue at 25%, which belongs to no scheme here.
        vars['--theme-focus-ring'] = this.nearestMeetingContrast(
            Color(vars['--theme-accent']),
            Color(isDark ? '#fff' : '#000'),
            this.textSurfaces(vars),
            EDGE_CONTRAST_RATIO,
        ).string()
    }

    /**
     * A secondary-text colour: as far toward the background as it can go while
     * still reaching the secondary-text ratio against every surface.
     *
     * Starts at a mix of foreground and background, then walks back toward the
     * foreground only as far as the worst surface demands. A scheme whose own
     * foreground falls short keeps walking, toward black or white.
     */
    private mutedForeground (foreground: ColorInstance, background: ColorInstance, isDark: boolean, surfaces: ColorInstance[]): ColorInstance {
        const minimum = this.textMinimumContrastRatio()
        const start = foreground.mix(background, 0.45)
        const towardForeground = this.nearestMeetingContrast(start, foreground, surfaces, minimum)
        if (surfaces.every(s => towardForeground.contrast(s) >= minimum)) {
            return towardForeground
        }
        return this.nearestMeetingContrast(foreground, Color(isDark ? '#fff' : '#000'), surfaces, minimum)
    }

    /**
     * The colour closest to `from`, on the straight line to `to`, whose contrast
     * against each of `surfaces` reaches `minimum` — or `to` if nothing before
     * it does. The search keeps `hi` passing throughout, so whatever it returns
     * passes whenever `to` does.
     */
    private nearestMeetingContrast (from: ColorInstance, to: ColorInstance, surfaces: ColorInstance[], minimum: number): ColorInstance {
        // Each candidate is rounded to whole channels before it is judged,
        // because that is what the CSS string carries and what gets painted.
        // Judged unrounded, a colour found at exactly 4.500:1 rendered at 4.487.
        const at = (t: number) => from.mix(to, t).rgb().round()
        const passes = (c: ColorInstance) => surfaces.every(s => c.contrast(s) >= minimum)
        if (passes(at(0))) {
            return at(0)
        }
        if (!passes(at(1))) {
            return at(1)
        }
        let lo = 0
        let hi = 1
        for (let i = 0; i < 16; i++) {
            const mid = (lo + hi) / 2
            if (passes(at(mid))) {
                hi = mid
            } else {
                lo = mid
            }
        }
        return at(hi)
    }

    /**
     * `color`, lightened or darkened until it reaches `minimum` against
     * `against`. Judged and returned in whole channels, which is what gets
     * painted.
     */
    private ensureContrast (color: ColorInstance, against: ColorInstance, minimum: number): ColorInstance {
        const a = this.increaseContrast(color, against, 1.1, minimum)
        const b = this.increaseContrast(color, against, 0.9, minimum)
        return a.contrast(against) > b.contrast(against) ? a : b
    }

    private increaseContrast (color: ColorInstance, against: ColorInstance, step: number, minimum: number): ColorInstance {
        color = color.hsl()
        color = color.lightness(Math.max(color.lightness(), 0.01))
        while (
            (step < 1 && color.lightness() > 1 ||
             step > 1 && color.lightness() < 99) &&
             color.rgb().round().contrast(against) < minimum) {
            color = color.lightness(color.lightness() * step)
        }
        return color.rgb().round()
    }

    findTheme (name: string): Theme|null {
        return this.config.enabledServices(this.themes).find(x => x.name === name) ?? null
    }

    findCurrentTheme (): Theme {
        return this.findTheme(this.getConfigStoreOrDefaults().appearance.theme) ?? this.standardTheme
    }

    /// @hidden
    _getActiveColorScheme (): TerminalColorScheme {
        let theme: PlatformTheme = 'dark'
        if (this.getConfigStoreOrDefaults().appearance.colorSchemeMode === 'light') {
            theme = 'light'
        } else if (this.getConfigStoreOrDefaults().appearance.colorSchemeMode === 'auto') {
            theme = this.platform.getTheme()
        }

        if (theme === 'light') {
            return this.getConfigStoreOrDefaults().terminal.lightColorScheme as TerminalColorScheme
        } else {
            return this.getConfigStoreOrDefaults().terminal.colorScheme as TerminalColorScheme
        }
    }

    applyTheme (theme: Theme): void {
        if (!this.styleElement) {
            this.styleElement = document.createElement('style')
            this.styleElement.setAttribute('id', 'theme')
            document.querySelector('head')!.appendChild(this.styleElement)
        }
        this.styleElement.textContent = theme.css
        document.querySelector('style#custom-css')!.innerHTML = this.getConfigStoreOrDefaults().appearance.css
        this.themeChanged.next(theme)
    }

    private applyCurrentTheme (): void {
        this.applyTheme(this.findCurrentTheme())
    }
}
