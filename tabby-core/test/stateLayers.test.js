// The state-layer contract, in every colour scheme the app ships.
//
//   node tabby-core/test/stateLayers.test.js
//
// Plain node, nothing running: the real ThemesService, transpiled, asked for
// its variables against each of the 191 community schemes and the two
// defaults, with `document` replaced by a recorder. What it pins is the
// contract in AGENTS.md ("State layers"):
//
// - every label on a state fill — a hovered or pressed button of every key,
//   the selected segment and the selected segment hovered — reaches the text
//   floor against that fill;
// - a hover is a visible step from rest, and a quiet one;
// - the selected segment stands clearly apart from a hovered neighbour;
// - secondary text still reads on a hovered page or panel;
// - the focus ring reaches 3:1 on every surface.
//
// The bug behind it: a light scheme's grey button went from #dadada to
// #a3a3a3 on hover (a 2.4:1 jump), because hover was a fixed ladder step
// rather than a layer of the label's own colour.
const path = require('path')
const fs = require('fs')
const Module = require('module')

const REPO = path.resolve(__dirname, '../..')

const decorator = () => () => undefined
const stub = new Proxy({}, { get: () => class Stub {} })
const stubs = {
    '@angular/core': { Injectable: decorator, Inject: decorator },
    '../services/config.service': stub,
    '../api/theme': stub,
    '../api/platform': stub,
    '../theme': stub,
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
            target: ts.ScriptTarget.ES2019,
            experimentalDecorators: true,
            useDefineForClassFields: false,
            esModuleInterop: true,
        },
    }).outputText
    module._compile(js, filename)
}

const { ThemesService, HOVER_LAYER, PRESSED_LAYER } = require(path.join(REPO, 'tabby-core/src/services/themes.service.ts'))
const colorModule = require(require.resolve('color', { paths: [path.join(REPO, 'tabby-core')] }))
const Color = colorModule.default ?? colorModule

let passed = 0
let failed = 0
const failures = new Map()
function check (name, ok, detail) {
    if (ok) {
        passed++
        return
    }
    failed++
    if (!failures.has(name)) {
        failures.set(name, [])
    }
    failures.get(name).push(detail)
}

// The catalogue, parsed the way tabby-community-color-schemes' provider does.
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
    const colors = []
    for (let i = 0; i < 16; i++) {
        colors.push(values[`color${i}`])
    }
    return { name: file.trim(), foreground: values.foreground, background: values.background, colors }
}
const schemes = fs.readdirSync(SCHEME_DIR).map(readScheme).filter(s => s.foreground && s.background && s.colors.every(Boolean))

// The two defaults, lifted out of their provider without loading Angular.
const defaults = fs.readFileSync(path.join(REPO, 'tabby-terminal/src/colorSchemes.ts'), 'utf8')
for (const match of defaults.matchAll(/name: '([^']+)',\s*foreground: '([^']+)',\s*background: '([^']+)',[\s\S]*?colors: \[([^\]]+)\]/g)) {
    schemes.push({ name: match[1], foreground: match[2], background: match[3], colors: [...match[4].matchAll(/'([^']+)'/g)].map(m => m[1]) })
}

function variablesFor (scheme) {
    const recorded = {}
    global.document = {
        documentElement: { style: { cssText: '', setProperty: (k, v) => { recorded[k] = v } } },
        body: { classList: { toggle: () => undefined } },
    }
    const service = Object.create(ThemesService.prototype)
    service.rootElementStyleBackup = ''
    service.config = {
        store: {
            appearance: { vibrancy: false, accentColor: null, spaciness: 1 },
            terminal: { minimumContrastRatio: 1 },
            accessibility: { animations: true },
        },
    }
    service.findCurrentTheme = () => ({ followsColorScheme: true })
    service._getActiveColorScheme = () => scheme
    service.applyThemeVariables()
    return recorded
}

const c = s => Color(s).rgb().round()
const ratio = (a, b) => c(a).contrast(c(b))
/** A translucent layer over a solid surface, as the browser composites it. */
const over = (layer, surface) => {
    const l = Color(layer)
    return c(surface).mix(l.alpha(1), l.alpha())
}
const TEXT = 4.5
// The selected segment against a hovered neighbour, fill to fill. Its label is
// inverted as well, so this is the lesser of two differences; C64, blue on
// blue, is the closest of the catalogue at 2.1.
const SELECTION_STEP = 2
const KEYS = ['primary', 'secondary', 'warning', 'danger', 'success', 'info']

check('the layers are what the contract says', HOVER_LAYER === 0.1 && PRESSED_LAYER === 0.18, [HOVER_LAYER, PRESSED_LAYER])

let ran = 0
for (const scheme of schemes) {
    let v
    try {
        v = variablesFor(scheme)
    } catch (error) {
        check('the service runs', false, `${scheme.name}: ${error.message}`)
        continue
    }
    ran++
    const n = scheme.name

    for (const key of KEYS) {
        for (const state of ['hover', 'pressed']) {
            const bg = v[`--theme-${key}-${state}-bg`]
            const fg = v[`--theme-${key}-${state}-contrast-fg`]
            check(`a ${state} button's label reads on its fill`, ratio(bg, fg) >= TEXT, `${n} ${key}: ${fg} on ${bg} ${ratio(bg, fg).toFixed(2)}`)
            // The label keeps its side: light on a fill stays light, dark stays dark.
            const restLight = c(v[`--theme-${key}-contrast-fg`]).luminosity() > c(v[`--theme-${key}`]).luminosity()
            check(`a ${state} button's label does not flip`, (c(fg).luminosity() > c(bg).luminosity()) === restLight, `${n} ${key}`)
        }
        // Visible, and quiet: no more than a pressed step, never a jump.
        const rest = v[`--theme-${key}`]
        const step = ratio(rest, v[`--theme-${key}-hover-bg`])
        check('a button\'s hover is a step from rest', step > 1.02, `${n} ${key}: ${step.toFixed(3)}`)
        check('a button\'s hover is a quiet step', step < 1.8, `${n} ${key}: ${step.toFixed(2)}`)
        check('pressing goes further than hovering', ratio(rest, v[`--theme-${key}-pressed-bg`]) >= step, `${n} ${key}`)
    }

    check('the selected segment\'s label reads', ratio(v['--theme-selected-bg'], v['--theme-selected-fg']) >= TEXT,
        `${n}: ${ratio(v['--theme-selected-bg'], v['--theme-selected-fg']).toFixed(2)}`)
    check('the hovered selected segment\'s label reads', ratio(v['--theme-selected-hover-bg'], v['--theme-selected-hover-fg']) >= TEXT,
        `${n}: ${ratio(v['--theme-selected-hover-bg'], v['--theme-selected-hover-fg']).toFixed(2)}`)
    check('hovering the selection does not wash it out', ratio(v['--theme-selected-hover-bg'], v['--theme-secondary-hover-bg']) >= SELECTION_STEP,
        `${n}: ${ratio(v['--theme-selected-hover-bg'], v['--theme-secondary-hover-bg']).toFixed(2)}`)
    check('the selection stands apart from a hovered neighbour', ratio(v['--theme-selected-bg'], v['--theme-secondary-hover-bg']) >= SELECTION_STEP,
        `${n}: ${ratio(v['--theme-selected-bg'], v['--theme-secondary-hover-bg']).toFixed(2)}`)

    for (const surface of ['--body-bg', '--theme-bg', '--theme-bg-more', '--theme-bg-more-2']) {
        const hovered = over(v['--theme-hover-bg'], v[surface])
        const step = ratio(v[surface], hovered)
        check('a neutral hover is a visible step', step >= 1.05, `${n} ${surface}: ${step.toFixed(3)}`)
        check('a neutral hover is a quiet step', step < 1.6, `${n} ${surface}: ${step.toFixed(2)}`)
        check('text reads on a hovered surface', ratio(hovered, v['--theme-fg']) >= TEXT, `${n} ${surface}: ${ratio(hovered, v['--theme-fg']).toFixed(2)}`)
        check('secondary text reads on a hovered surface', ratio(hovered, v['--theme-muted-fg']) >= TEXT,
            `${n} ${surface}: ${ratio(hovered, v['--theme-muted-fg']).toFixed(2)}`)
        check('the focus ring is seen', ratio(v[surface], v['--theme-focus-ring']) >= 3, `${n} ${surface}: ${ratio(v[surface], v['--theme-focus-ring']).toFixed(2)}`)
    }
    check('the state ink is the text colour', c(`rgb(${v['--theme-state-ink']})`).hex() === c(v['--theme-fg']).hex(), n)
}

check('every scheme was measured', ran === schemes.length && ran > 150, `${ran} of ${schemes.length}`)

for (const [name, details] of failures) {
    console.log(`FAIL ${name} (${details.length})`)
    for (const d of details.slice(0, 8)) {
        console.log(`       ${d}`)
    }
}
console.log(`\n${passed} passed, ${failed} failed, ${ran} schemes`)
process.exitCode = failed ? 1 : 0
