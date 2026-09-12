import { TerminalColorScheme } from 'tabby-core'

/**
 * Is a scheme dark or light, and which schemes are two halves of one design.
 *
 * Kept pure and free of Angular so `test/colorSchemeTone.test.js` can measure it
 * against the real catalogue without starting a window.
 */

export type SchemeTone = 'dark' | 'light'

/** Words that say "the dark one" or "the light one", and nothing more. */
const GENERIC_TONE_WORDS = new Map<string, SchemeTone>([
    ['dark', 'dark'],
    ['night', 'dark'],
    ['light', 'light'],
    ['day', 'light'],
])

/**
 * Words that name one dark or light variant among several — Rosé Pine's Moon
 * and Dawn, Tokyo Night's Storm, Catppuccin's four flavours, GitHub's Dimmed,
 * Material's Darker and Lighter, ayu's Mirage.
 *
 * They come out of a name exactly as the generic words do, so `Rose Pine Moon`
 * is still Rosé Pine. What they change is which variant leads: a design's own
 * pair is made from its plainest names, so Rosé Pine's dark half is `Rose
 * Pine`, and `Rose Pine Moon` is offered after it as a variant.
 *
 * `morning` and `evening` are absent on purpose. Base2Tone ships Morning and
 * Evening as two designs, each with its own dark and light, and this catalogue
 * carries `base2tone-morning-light` and `base2tone-evening-dark` — which, with
 * those words taken out, would meet as a design nobody drew.
 */
const VARIANT_TONE_WORDS = new Map<string, SchemeTone>([
    ['darker', 'dark'],
    ['dimmed', 'dark'],
    ['dusk', 'dark'],
    ['frappe', 'dark'],
    ['macchiato', 'dark'],
    ['mirage', 'dark'],
    ['mocha', 'dark'],
    ['moon', 'dark'],
    ['storm', 'dark'],
    ['dawn', 'light'],
    ['latte', 'light'],
    ['lighter', 'light'],
])

// Maps rather than object literals: a scheme with a word like `constructor` in
// its name must not find a tone on Object.prototype.
const TONE_WORDS = new Map<string, SchemeTone>([...GENERIC_TONE_WORDS, ...VARIANT_TONE_WORDS])

const SEPARATOR = /[^\p{L}\p{M}\p{N}]/u
const TRAILING_SEPARATORS = /[^\p{L}\p{M}\p{N}]+$/u

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

/**
 * A name's words, spelled as the name spells them.
 *
 * Split on anything that is not a letter or a digit — a space, `_`, `-`,
 * ` - ` — and where lower case turns to upper, because much of this catalogue
 * runs its words together: `TokyoNight Day`, `OneHalfDark`, `MaterialDark`,
 * `AtomOneLight`. A digit is not a boundary, so `base2tone` and `Base2Tone`
 * stay one word and still meet.
 */
function words (name: string): string[] {
    return name
        .normalize('NFC')
        .replace(/(\p{Ll})(\p{Lu})/gu, '$1 $2')
        .replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, '$1 $2')
        .split(/[^\p{L}\p{M}\p{N}]+/u)
        .filter(Boolean)
}

/** Case and accents folded, so `Rosé` meets `Rose` and `Frappé` meets `frappe`. */
function fold (word: string): string {
    return word.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase()
}

/** A name's words, folded for comparison. */
export function nameTokens (name: string): string[] {
    return words(name).map(fold)
}

function designWords (tokens: string[]): string[] {
    return tokens.filter(token => !TONE_WORDS.has(token))
}

function claimedTone (tokens: string[]): SchemeTone | null {
    let claimed: SchemeTone | null = null
    for (const token of tokens) {
        claimed = TONE_WORDS.get(token) ?? claimed
    }
    return claimed
}

/**
 * The tone a name claims, if it claims one.
 *
 * The last tone word decides, because a design's own name can carry one:
 * `TokyoNight Day` is Tokyo Night's day variant, not a night scheme.
 */
export function toneWordOf (name: string): SchemeTone | null {
    return claimedTone(nameTokens(name))
}

/** What is left of a name once its tone words are taken out, folded. */
export function schemeStem (name: string): string {
    return designWords(nameTokens(name)).join(' ')
}

export interface ColorSchemePair {
    /** What the row is called: the design, for its own pair; the variant's name, for a variant. */
    name: string
    /** The design the pair belongs to — the same for its own pair and for every variant of it. */
    design: string
    /** False for a design's own pair; true for another of its variants set against the other half. */
    variant: boolean
    dark: TerminalColorScheme
    light: TerminalColorScheme
}

/** One scheme, read for pairing. */
interface Candidate {
    scheme: TerminalColorScheme
    /** Measured from the colours; the name only ever has to agree with it. */
    tone: SchemeTone
    /** The name's words, minus its tone words. */
    stem: string[]
    /** The stem run together — what two names have to agree on to be one design. */
    key: string
    /** Whether the name carries a tone word at all. */
    toned: boolean
    /** Whether one of those is a variant word rather than a generic one. */
    named: boolean
    order: number
}

interface Design {
    name: string
    dark: Candidate
    light: Candidate
    variants: Candidate[]
}

/**
 * A scheme as a possible half, or null when it cannot be one: its name is
 * nothing but tone words, or it claims a tone its colours do not have. A
 * `Foo Light` that measures dark is not the light half of Foo, whatever else
 * it is.
 */
function candidate (scheme: TerminalColorScheme, order: number): Candidate | null {
    const tokens = nameTokens(scheme.name)
    const stem = designWords(tokens)
    const tone = schemeTone(scheme)
    const claimed = claimedTone(tokens)
    if (!stem.length || (claimed !== null && claimed !== tone)) {
        return null
    }
    return {
        scheme,
        tone,
        stem,
        key: stem.join(''),
        toned: claimed !== null,
        named: tokens.some(token => VARIANT_TONE_WORDS.has(token)),
        order,
    }
}

/**
 * Which of two candidates for the same half leads a design: a plain name
 * before one with a variant word, then the more decided tone — the darkest
 * background for the dark half, the lightest for the light — then the order
 * they arrived in.
 */
function leads (a: Candidate, b: Candidate): number {
    if (a.named !== b.named) {
        return a.named ? 1 : -1
    }
    const difference = luminance(a.scheme.background) - luminance(b.scheme.background)
    if (difference) {
        return a.tone === 'dark' ? difference : -difference
    }
    return a.order - b.order
}

/** Whether a word of `name` ends at `index`. */
function endsWord (name: string, index: number): boolean {
    if (index >= name.length) {
        return true
    }
    const before = name[index - 1]
    const after = name[index]
    return SEPARATOR.test(before) || SEPARATOR.test(after) || (/\p{Ll}/u.test(before) && /\p{Lu}/u.test(after))
}

/**
 * The design as its own names spell it: the longest start the two halves
 * share that ends on a word and still means the design — `TokyoNight` from
 * `TokyoNight` and `TokyoNight Day`, `base2tone-heath` from its two halves.
 * When they share no such start, as `Night Owl` and `Light Owl` do not, it is
 * the dark half's name with its tone words taken out.
 */
function designName (dark: Candidate, light: Candidate): string {
    const a = dark.scheme.name
    const b = light.scheme.name
    let end = 0
    while (end < a.length && end < b.length && a[end] === b[end]) {
        end++
    }
    for (; end > 0; end--) {
        if (!endsWord(a, end) || !endsWord(b, end)) {
            continue
        }
        const shared = a.slice(0, end).replace(TRAILING_SEPARATORS, '')
        if (shared && designWords(nameTokens(shared)).join('') === dark.key) {
            return shared
        }
    }
    return words(a).filter(word => !TONE_WORDS.has(fold(word))).join(' ')
}

function compareNames (a: string, b: string): number {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

/**
 * Schemes that ship as a dark/light pair of one design, and the variants of
 * each.
 *
 * **The name finds the design; the colours decide the halves.** Two schemes
 * are one design when their names agree once tone words, case, accents and
 * separators are set aside — `Solarized Dark` and `Solarized Light`, `ayu` and
 * `ayu_light`, `TokyoNight` and `TokyoNight Day`. A design is paired when it
 * has a scheme that measures dark and one that measures light, and at least
 * one of the two names says which half it is. A name never makes a half on
 * its own: a scheme that claims the other tone from its colours is left out,
 * so a design that ships two darks produces no pair rather than a wrong one.
 *
 * **A design with more than two variants** leads with its plainest dark and
 * plainest light (see `leads`), and every other variant is set against the
 * other half as a row of its own: `Rose Pine Moon` with `Rose Pine Dawn`. A
 * scheme whose name *extends* a paired design and carries a tone word joins it
 * the same way — `Tomorrow Night Eighties`, `Solarized Dark Higher Contrast`.
 * The tone word is required, because a name that merely starts the same way is
 * not a variant: `Solarized Darcula` is Darcula.
 *
 * The first of two schemes with the same name wins, which is how a custom
 * scheme saved under a stock name is the one used: the page lists custom first.
 */
export function pairColorSchemes (schemes: TerminalColorScheme[]): ColorSchemePair[] {
    const seen = new Set<string>()
    const candidates: Candidate[] = []
    const families = new Map<string, Candidate[]>()
    for (const [order, scheme] of schemes.entries()) {
        if (!scheme?.name || seen.has(scheme.name)) {
            continue
        }
        seen.add(scheme.name)
        const found = candidate(scheme, order)
        if (!found) {
            continue
        }
        candidates.push(found)
        const family = families.get(found.key)
        if (family) {
            family.push(found)
        } else {
            families.set(found.key, [found])
        }
    }

    const designs = new Map<string, Design>()
    for (const [key, family] of families) {
        const darks = family.filter(x => x.tone === 'dark').sort(leads)
        const lights = family.filter(x => x.tone === 'light').sort(leads)
        if (!darks.length || !lights.length || (!darks[0].toned && !lights[0].toned)) {
            continue
        }
        designs.set(key, {
            name: designName(darks[0], lights[0]),
            dark: darks[0],
            light: lights[0],
            variants: [...darks.slice(1), ...lights.slice(1)],
        })
    }

    // A variant whose name extends a design's: the longest design it extends
    // takes it, and only when its own name did not already make a pair.
    for (const found of candidates) {
        if (!found.toned || designs.has(found.key)) {
            continue
        }
        let prefix = ''
        let extended: Design | undefined
        for (const word of found.stem.slice(0, -1)) {
            prefix += word
            extended = designs.get(prefix) ?? extended
        }
        extended?.variants.push(found)
    }

    const pairs: ColorSchemePair[] = []
    for (const design of [...designs.values()].sort((a, b) => compareNames(a.name, b.name))) {
        pairs.push({
            name: design.name,
            design: design.name,
            variant: false,
            dark: design.dark.scheme,
            light: design.light.scheme,
        })
        pairs.push(...design.variants
            .map(variant => ({
                name: variant.scheme.name,
                design: design.name,
                variant: true,
                dark: variant.tone === 'dark' ? variant.scheme : design.dark.scheme,
                light: variant.tone === 'light' ? variant.scheme : design.light.scheme,
            }))
            .sort((a, b) => compareNames(a.name, b.name)))
    }
    return pairs
}
