// Tone detection and dark/light pairing, against the real scheme catalogue.
//
// No app and no bundle: the modules under test are pure, and the schemes are
// the ones the settings page lists — `tabby-community-color-schemes`' own
// Xresources files, parsed the way its provider parses them, and the two
// defaults `tabby-terminal` ships. Run with:
//   node tabby-terminal/test/colorSchemeTone.test.js
const path = require('path')
const fs = require('fs')
const Module = require('module')

const REPO = path.resolve(__dirname, '../..')

// Both are externals in every plugin build. The tone module only takes a type
// from `tabby-core`; the default schemes are an `@Injectable`, and the
// decorator does nothing a test needs.
const stubs = {
    'tabby-core': new Proxy({}, { get: () => class Stub {} }),
    '@angular/core': { Injectable: () => target => target },
}
const originalResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
    return stubs[request] ? request : originalResolve.call(this, request, ...rest)
}
const originalLoad = Module._load
Module._load = function (request, ...rest) {
    return stubs[request] ?? originalLoad.call(this, request, ...rest)
}

const ts = require(path.join(REPO, 'node_modules/typescript'))
Module._extensions['.ts'] = function (module, filename) {
    const js = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
            // As the repo's tsconfig has them, for the decorator on the defaults.
            experimentalDecorators: true,
            useDefineForClassFields: false,
        },
    }).outputText
    module._compile(js, filename)
}

const tone = require(path.join(REPO, 'tabby-terminal/src/colorSchemeTone.ts'))
const prefs = require(path.join(REPO, 'tabby-terminal/src/colorSchemeViewPrefs.ts'))
const { DefaultColorSchemes } = require(path.join(REPO, 'tabby-terminal/src/colorSchemes.ts'))

let passed = 0
let failed = 0
function check (name, actual, expected) {
    const a = JSON.stringify(actual)
    const e = JSON.stringify(expected)
    if (a === e) {
        passed++
        console.log(`  ok   ${name}`)
    } else {
        failed++
        console.log(`  FAIL ${name}\n         expected ${e}\n         actual   ${a}`)
    }
}
function note (text) {
    console.log(`       ${text}`)
}

/** A scheme with only what tone and pairing read. */
const scheme = (name, background, foreground) => ({ name, background, foreground, colors: [] })

/** What a reader sees of each row: whose it is, what it is called, and its two halves. */
const rows = list => tone.pairColorSchemes(list).map(p => [p.variant ? 'variant' : 'design', p.name, p.dark.name, p.light.name])

// The catalogue ships as Xresources, not JSON. Parsed the way
// `tabby-community-color-schemes/src/colorSchemes.ts` parses it, `#define`s
// included: `Base16 Default Dark` names its colours through them, and reading
// the variable names as colours made it measure light.
const SCHEME_DIR = path.join(REPO, 'tabby-community-color-schemes/schemes')
function readScheme (file) {
    const lines = fs.readFileSync(path.join(SCHEME_DIR, file), 'utf8').split('\n')
    const variables = {}
    for (const line of lines.filter(x => x.startsWith('#define'))) {
        const [, name, value] = line.split(' ').map(x => x.trim())
        variables[name] = value
    }
    const values = {}
    for (const line of lines.filter(x => x.startsWith('*.'))) {
        const [key, value] = line.substring(2).split(':').map(x => x.trim())
        values[key] = variables[value] ? variables[value] : value
    }
    return { name: file.trim(), foreground: values.foreground, background: values.background, colors: [] }
}

// The rule this replaced, transcribed so that "before" is a measurement: every
// member had to carry `light`, `day`, `dark` or `night` as a separate word, the
// rest of the name had to match exactly, and a name with anything but one dark
// and one light under it was dropped.
function previousRule (list) {
    const WORD = /(^|[\s_-])(light|day|dark|night)($|[\s_-])/i
    const byStem = new Map()
    for (const s of list) {
        if (!WORD.test(s.name)) {
            continue
        }
        const stem = s.name.replace(WORD, '$1$3').replace(/[\s_-]+/g, ' ').trim().toLowerCase()
        if (stem) {
            byStem.set(stem, [...byStem.get(stem) ?? [], s])
        }
    }
    const found = []
    for (const bucket of byStem.values()) {
        const darks = bucket.filter(x => tone.schemeTone(x) === 'dark')
        const lights = bucket.filter(x => tone.schemeTone(x) === 'light')
        if (darks.length === 1 && lights.length === 1) {
            found.push([darks[0].name, lights[0].name])
        }
    }
    return found
}

async function main () {
    console.log('\n-- luminance --')
    check('black', tone.luminance('#000000'), 0)
    check('white', tone.luminance('#ffffff'), 1)
    check('short form expands', tone.luminance('#fff'), tone.luminance('#ffffff'))
    check('a missing colour is not a crash', tone.luminance(undefined), 0)
    check('nonsense is not a crash', tone.luminance('not a colour'), 0)
    check('green outweighs blue', tone.luminance('#00ff00') > tone.luminance('#0000ff'), true)

    console.log('\n-- tone is decided by the colours --')
    check('dark background', tone.schemeTone({ background: '#1c1a16', foreground: '#f3efe7' }), 'dark')
    check('light background', tone.schemeTone({ background: '#ffffff', foreground: '#333333' }), 'light')
    // A name that lies is exactly the case this must survive.
    check('a light-sounding scheme that is dark reads dark',
        tone.schemeTone({ background: '#000000', foreground: '#eeeeee' }), 'dark')

    console.log('\n-- the tone a name claims --')
    check('trailing word', tone.toneWordOf('Solarized Dark'), 'dark')
    check('leading word', tone.toneWordOf('Light Owl'), 'light')
    check('night means dark', tone.toneWordOf('Night Owl'), 'dark')
    check('day means light', tone.toneWordOf('3024 Day'), 'light')
    check('hyphenated', tone.toneWordOf('base2tone-heath-dark'), 'dark')
    check('underscored', tone.toneWordOf('ayu_light'), 'light')
    check('no tone word', tone.toneWordOf('AdventureTime'), null)
    // "Daylight" must not match "day", or every scheme with the substring pairs up.
    check('a word that merely contains one does not count', tone.toneWordOf('Daylighting'), null)
    check('nor does one that starts with one', [tone.toneWordOf('Darkside'), tone.toneWordOf('Bright Lights')], [null, null])
    check('words run together are still words', [tone.toneWordOf('OneHalfDark'), tone.toneWordOf('AtomOneLight')], ['dark', 'light'])
    check('the last tone word decides: TokyoNight Day is a day scheme', tone.toneWordOf('TokyoNight Day'), 'light')
    check('variant words carry a tone',
        ['Rose Pine Moon', 'Rose Pine Dawn', 'TokyoNight Storm', 'Catppuccin Latte', 'Catppuccin Macchiato'].map(tone.toneWordOf),
        ['dark', 'light', 'dark', 'light', 'dark'])
    check('accents are folded', tone.toneWordOf('Catppuccin Frappé'), 'dark')
    // An object literal would hand back Object.prototype.constructor here.
    check('a word every object has as a property is not a tone word',
        [tone.toneWordOf('Constructor'), tone.toneWordOf('toString')], [null, null])
    check('morning and evening are not tone words: Base2Tone uses them as designs',
        [tone.toneWordOf('Base2Tone Morning'), tone.toneWordOf('Later This Evening')], [null, null])

    console.log('\n-- the design a name belongs to --')
    check('stem drops the word', tone.schemeStem('Solarized Dark'), 'solarized')
    check('stem normalises separators', tone.schemeStem('base2tone-heath-dark'), 'base2tone heath')
    check('stem of a leading word', tone.schemeStem('Night Owl'), 'owl')
    check('stem splits words run together', [tone.schemeStem('OneHalfLight'), tone.schemeStem('MaterialDark')], ['one half', 'material'])
    check('stem drops every tone word, a brand\'s included', tone.schemeStem('TokyoNight Storm'), 'tokyo')
    check('stem folds accents', tone.schemeStem('Rosé Pine Dawn'), 'rose pine')
    check('stem keeps the words that are not tone words', tone.schemeStem('Solarized Dark - Patched'), 'solarized patched')
    check('a digit is not a word boundary',
        [tone.schemeStem('Base2Tone Heath'), tone.schemeStem('base2tone-heath-light')], ['base2tone heath', 'base2tone heath'])

    console.log('\n-- pairing, against the real catalogue --')
    const community = fs.readdirSync(SCHEME_DIR).map(readScheme)
    const defaults = await new DefaultColorSchemes().getSchemes()
    const catalogue = [...defaults, ...community]
    note(`${community.length} community schemes on disk, ${defaults.length} defaults`)
    check('the catalogue is big enough to be worth pairing', community.length > 100, true)
    check('every scheme names a background and a foreground',
        catalogue.filter(s => !s.background || !s.foreground).map(s => s.name), [])

    const before = previousRule(catalogue)
    const pairs = tone.pairColorSchemes(catalogue)
    const designs = pairs.filter(p => !p.variant)
    note(`before: ${before.length} pairs: ${before.map(([dark, light]) => `${dark} / ${light}`).join(', ')}`)
    note(`after: ${designs.length} designs, ${pairs.length} rows`)
    for (const p of pairs) {
        note(`  ${p.variant ? '  + ' : ''}${p.name}: ${p.dark.name} / ${p.light.name}`)
    }
    check('the rule this replaced found six', before.length, 6)
    check('every pair it found is still found',
        before.filter(([dark, light]) => !pairs.some(p => p.dark.name === dark && p.light.name === light)), [])
    check('every pair is one dark and one light',
        pairs.every(p => tone.schemeTone(p.dark) === 'dark' && tone.schemeTone(p.light) === 'light'), true)
    check('no two rows offer the same pair', new Set(pairs.map(p => `${p.dark.name}\n${p.light.name}`)).size, pairs.length)
    check('every variant shares exactly one half with its design\'s own pair', pairs.filter(p => p.variant).every(v => {
        const own = designs.find(d => d.design === v.design)
        return Boolean(own) && (own.dark === v.dark) !== (own.light === v.light)
    }), true)
    check('the designs this catalogue ships in pairs, and their variants', rows(catalogue), [
        ['design', '3024', '3024 Night', '3024 Day'],
        ['design', 'ayu', 'ayu', 'ayu_light'],
        ['design', 'base2tone-heath', 'base2tone-heath-dark', 'base2tone-heath-light'],
        ['design', 'Belafonte', 'Belafonte Night', 'Belafonte Day'],
        ['design', 'Material', 'MaterialDark', 'Material'],
        ['design', 'OneHalf', 'OneHalfDark', 'OneHalfLight'],
        ['design', 'Owl', 'Night Owl', 'Light Owl'],
        ['design', 'Pencil', 'PencilDark', 'PencilLight'],
        ['design', 'Rose Pine', 'Rose Pine', 'Rose Pine Dawn'],
        ['variant', 'Rose Pine Moon', 'Rose Pine Moon', 'Rose Pine Dawn'],
        ['design', 'Solarized', 'Solarized Dark', 'Solarized Light'],
        ['variant', 'Solarized Dark - Patched', 'Solarized Dark - Patched', 'Solarized Light'],
        ['variant', 'Solarized Dark Higher Contrast', 'Solarized Dark Higher Contrast', 'Solarized Light'],
        ['design', 'Tabby Default', 'Tabby Default', 'Tabby Default Light'],
        ['design', 'TokyoNight', 'TokyoNight', 'TokyoNight Day'],
        ['variant', 'TokyoNight Storm', 'TokyoNight Storm', 'TokyoNight Day'],
        ['design', 'Tomorrow', 'Tomorrow Night', 'Tomorrow'],
        ['variant', 'Tomorrow Night Blue', 'Tomorrow Night Blue', 'Tomorrow'],
        ['variant', 'Tomorrow Night Bright', 'Tomorrow Night Bright', 'Tomorrow'],
        ['variant', 'Tomorrow Night Eighties', 'Tomorrow Night Eighties', 'Tomorrow'],
        ['design', 'Violet', 'Violet Dark', 'Violet Light'],
    ])

    console.log('\n-- and the pairs it must not make --')
    const inAPair = name => pairs.some(p => p.dark.name === name || p.light.name === name)
    const paired = (a, b) => pairs.some(p => [p.dark.name, p.light.name].sort().join('\n') === [a, b].sort().join('\n'))
    // Atom One Dark is AtomOneLight's other half, and it is not bundled. `Atom`
    // is another palette altogether: its red is #fd5ff1, AtomOneLight's #de3e35.
    check('Atom is not AtomOneLight\'s dark half', paired('Atom', 'AtomOneLight'), false)
    // Spring has Tomorrow's background and foreground, and none of its colours.
    check('Spring is not Tomorrow', inAPair('Spring'), false)
    check('Base2Tone Evening and Morning are two designs', paired('base2tone-evening-dark', 'base2tone-morning-light'), false)
    check('Solarized Darcula starts like Solarized and is Darcula', inAPair('Solarized Darcula'), false)
    check('a design with only one half bundled is in no pair',
        ['AtomOneLight', 'Base16 Default Dark', 'base2tone-morning-light', 'Duotone Dark', 'Github', 'Gruvbox Dark', 'Melange Dark', 'Piatto Light'].filter(inAPair), [])
    check('two darks under one name are in no pair', ['NightLion v1', 'NightLion v2', 'Paraiso Dark', 'Parasio Dark'].filter(inAPair), [])

    console.log('\n-- families, and names that do not decide a half --')
    check('two darks', rows([scheme('Fake Dark', '#000', '#fff'), scheme('Fake Light', '#111', '#eee')]), [])
    check('one of each pairs', rows([scheme('Fake Dark', '#000', '#fff'), scheme('Fake Light', '#fff', '#222')]),
        [['design', 'Fake', 'Fake Dark', 'Fake Light']])
    check('a light-named scheme that measures dark is no light half',
        rows([scheme('Foo', '#fafafa', '#222222'), scheme('Foo Light', '#111111', '#eeeeee')]), [])
    check('two names that say nothing about which half is which are no pair',
        rows([scheme('Foo', '#000000', '#ffffff'), scheme('foo', '#ffffff', '#000000')]), [])
    check('a family of four leads with its darkest flavour and offers the rest', rows([
        scheme('Catppuccin Latte', '#eff1f5', '#4c4f69'),
        scheme('Catppuccin Frappé', '#303446', '#c6d0f5'),
        scheme('Catppuccin Macchiato', '#24273a', '#cad3f5'),
        scheme('Catppuccin Mocha', '#1e1e2e', '#cdd6f4'),
    ]), [
        ['design', 'Catppuccin', 'Catppuccin Mocha', 'Catppuccin Latte'],
        ['variant', 'Catppuccin Frappé', 'Catppuccin Frappé', 'Catppuccin Latte'],
        ['variant', 'Catppuccin Macchiato', 'Catppuccin Macchiato', 'Catppuccin Latte'],
    ])
    check('a plain name leads a variant word, even a darker one', rows([
        scheme('Foo Moon', '#000000', '#ffffff'),
        scheme('Foo', '#222222', '#ffffff'),
        scheme('Foo Dawn', '#ffffff', '#222222'),
    ]), [
        ['design', 'Foo', 'Foo', 'Foo Dawn'],
        ['variant', 'Foo Moon', 'Foo Moon', 'Foo Dawn'],
    ])
    check('a longer toned name extends the design it starts with', rows([
        scheme('GitHub Dark Dimmed', '#22272e', '#adbac7'),
        scheme('GitHub Light High Contrast', '#ffffff', '#0e1116'),
        scheme('GitHub Dark', '#0d1117', '#c9d1d9'),
        scheme('GitHub Light', '#ffffff', '#24292f'),
    ]), [
        ['design', 'GitHub', 'GitHub Dark', 'GitHub Light'],
        ['variant', 'GitHub Dark Dimmed', 'GitHub Dark Dimmed', 'GitHub Light'],
        ['variant', 'GitHub Light High Contrast', 'GitHub Dark', 'GitHub Light High Contrast'],
    ])
    const custom = scheme('Solarized Dark', '#002b36', '#93a1a1')
    check('of two schemes with one name the first is used, and the page lists custom schemes first',
        tone.pairColorSchemes([custom, scheme('Solarized Dark', '#001e27', '#708284'), scheme('Solarized Light', '#fcf4dc', '#536870')])[0].dark === custom, true)
    check('an accent does not split a design, and the design keeps it',
        rows([scheme('Rosé Pine', '#191724', '#e0def4'), scheme('Rose Pine Dawn', '#faf4ed', '#575279')]),
        [['design', 'Rosé Pine', 'Rosé Pine', 'Rose Pine Dawn']])

    console.log('\n-- the tone a mode tab opens on --')
    check('Dark mode opens on dark schemes', prefs.toneFilterForMode('colorScheme'), 'dark')
    check('Light mode opens on light schemes', prefs.toneFilterForMode('lightColorScheme'), 'light')

    console.log(`\n${passed} passed, ${failed} failed`)
    process.exitCode = failed ? 1 : 0
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
