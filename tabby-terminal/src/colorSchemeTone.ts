import { TerminalColorScheme } from 'tabby-core'

/**
 * Is a scheme dark or light, and which schemes are two halves of one design.
 *
 * Kept pure and free of Angular so `test/colorSchemeTone.test.js` can measure it
 * against the real 193-scheme catalogue without starting a window.
 */

export type SchemeTone = 'dark' | 'light'

/** The tone words a scheme name uses to say which half it is. */
const TONE_WORDS: Record<string, SchemeTone> = {
    light: 'light',
    day: 'light',
    dark: 'dark',
    night: 'dark',
}

// Word-ish boundaries rather than `\b`, because half of these names separate
// with a hyphen or an underscore — `base2tone-heath-dark` has to split the same
// way `Solarized Dark` does.
const TONE_PATTERN = new RegExp(`(^|[\\s_-])(${Object.keys(TONE_WORDS).join('|')})($|[\\s_-])`, 'i')

/** sRGB relative luminance, 0..1, from `#rgb` or `#rrggbb`. */
export function luminance (color: string | undefined): number {
    if (!color) {
        return 0
    }
    let hex = color.trim().replace(/^#/, '')
    if (hex.length === 3) {
        hex = hex.split('').map(c => c + c).join('')
    }
    if (!/^[0-9a-f]{6}$/i.test(hex)) {
        return 0
    }
    const channel = (i: number) => {
        const v = parseInt(hex.slice(i * 2, i * 2 + 2), 16) / 255
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
    }
    return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2)
}

/**
 * Decided by the colours, never by the name.
 *
 * The same comparison `ThemesService` makes to pick the app's own chrome: a
 * scheme is dark when its background is darker than its foreground. A name is
 * a hint about *intent* and is wrong often enough to be worth ignoring here —
 * `pairColorSchemes` uses the name only to find candidates, and then asks this.
 */
export function schemeTone (scheme: Pick<TerminalColorScheme, 'background'|'foreground'>): SchemeTone {
    return luminance(scheme.background) < luminance(scheme.foreground) ? 'dark' : 'light'
}

/** The tone word a name carries, if it carries one. */
export function toneWordOf (name: string): SchemeTone | null {
    const match = TONE_PATTERN.exec(name)
    return match ? TONE_WORDS[match[2].toLowerCase()] : null
}

/** What is left of a name once its tone word is taken out. */
export function schemeStem (name: string): string {
    return name
        .replace(TONE_PATTERN, '$1$3')
        .replace(/[\s_-]+/g, ' ')
        .trim()
        .toLowerCase()
}

export interface ColorSchemePair {
    /** The design both halves belong to, shown to the reader. */
    name: string
    dark: TerminalColorScheme
    light: TerminalColorScheme
}

/**
 * Schemes that ship as a dark/light pair of one design.
 *
 * Candidates come from the name — the stem left after a tone word is removed,
 * so `Solarized Dark` and `Solarized Light` meet at `solarized`, and
 * `base2tone-heath-dark` meets its sibling the same way. **Whether they really
 * are a pair is then decided by the colours**: exactly one candidate must read
 * dark and exactly one light. A design that ships two dark variants under
 * light-sounding names produces no pair rather than a wrong one.
 */
export function pairColorSchemes (schemes: TerminalColorScheme[]): ColorSchemePair[] {
    const byStem = new Map<string, TerminalColorScheme[]>()
    for (const scheme of schemes) {
        if (!toneWordOf(scheme.name)) {
            continue
        }
        const stem = schemeStem(scheme.name)
        if (!stem) {
            continue
        }
        const bucket = byStem.get(stem)
        if (bucket) {
            bucket.push(scheme)
        } else {
            byStem.set(stem, [scheme])
        }
    }

    const pairs: ColorSchemePair[] = []
    for (const [stem, bucket] of byStem) {
        const darks = bucket.filter(x => schemeTone(x) === 'dark')
        const lights = bucket.filter(x => schemeTone(x) === 'light')
        if (darks.length === 1 && lights.length === 1) {
            pairs.push({ name: displayStem(stem, bucket), dark: darks[0], light: lights[0] })
        }
    }
    pairs.sort((a, b) => a.name.localeCompare(b.name))
    return pairs
}

/**
 * The stem as a reader would write it, taken from one of the real names rather
 * than title-cased blindly — `base2tone-heath` should not become `Base2Tone
 * Heath` when neither half spells it that way.
 */
function displayStem (stem: string, bucket: TerminalColorScheme[]): string {
    for (const scheme of bucket) {
        const withoutTone = scheme.name.replace(TONE_PATTERN, '$1$3').replace(/[\s_-]+/g, ' ').trim()
        if (withoutTone.toLowerCase() === stem) {
            return withoutTone
        }
    }
    return stem
}
