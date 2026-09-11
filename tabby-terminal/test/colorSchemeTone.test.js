// Tone detection and dark/light pairing, against the real scheme catalogue.
//
// No app and no bundle: the module under test is pure, and the schemes are read
// from `tabby-community-color-schemes`' own Xresources files, which is what the
// settings page lists. Run with: node tabby-terminal/test/colorSchemeTone.test.js
const path = require('path')
const fs = require('fs')
const Module = require('module')

const REPO = path.resolve(__dirname, '../..')

// `tabby-core` is an external in every plugin build; the module under test only
// takes a type from it, so a stub is enough to let Node follow the import.
const stubs = { 'tabby-core': new Proxy({}, { get: () => class Stub {} }) }
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
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
    }).outputText
    module._compile(js, filename)
}

const tone = require(path.join(REPO, 'tabby-terminal/src/colorSchemeTone.ts'))

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

console.log('\n-- names --')
check('trailing word', tone.toneWordOf('Solarized Dark'), 'dark')
check('leading word', tone.toneWordOf('Light Owl'), 'light')
check('night means dark', tone.toneWordOf('Night Owl'), 'dark')
check('day means light', tone.toneWordOf('3024 Day'), 'light')
check('hyphenated', tone.toneWordOf('base2tone-heath-dark'), 'dark')
check('no tone word', tone.toneWordOf('AdventureTime'), null)
// "Daylight" must not match "day", or every scheme with the substring pairs up.
check('a word that merely contains one does not count', tone.toneWordOf('Daylighting'), null)
check('stem drops the word', tone.schemeStem('Solarized Dark'), 'solarized')
check('stem normalises separators', tone.schemeStem('base2tone-heath-dark'), 'base2tone heath')
check('stem of a leading word', tone.schemeStem('Night Owl'), 'owl')

console.log('\n-- pairing, against the real catalogue --')
// The catalogue ships as Xresources, not JSON — the same `*.key: value` lines
// `tabby-community-color-schemes` reads, parsed here the same way so this test
// measures what the settings page actually lists.
const dir = path.join(REPO, 'tabby-community-color-schemes/schemes')
const schemes = fs.readdirSync(dir).map(file => {
    const values = {}
    for (const line of fs.readFileSync(path.join(dir, file), 'utf8').split('\n')) {
        if (!line.startsWith('*.')) { continue }
        const [key, value] = line.substring(2).split(':').map(x => x.trim())
        values[key] = value
    }
    return { name: file.trim(), foreground: values.foreground, background: values.background, colors: [] }
}).filter(s => s.background && s.foreground)
console.log(`       ${schemes.length} schemes on disk`)
check('the catalogue is big enough to be worth pairing', schemes.length > 100, true)

const pairs = tone.pairColorSchemes(schemes)
console.log(`       ${pairs.length} pairs: ${pairs.map(p => p.name).join(', ')}`)
check('every pair is one dark and one light', pairs.every(p =>
    tone.schemeTone(p.dark) === 'dark' && tone.schemeTone(p.light) === 'light'), true)
check('no scheme is both halves of its own pair', pairs.every(p => p.dark.name !== p.light.name), true)
check('the designs this catalogue actually ships in pairs are found',
    pairs.map(p => p.name.toLowerCase()).sort(),
    ['3024', 'base2tone heath', 'belafonte', 'owl', 'solarized', 'violet'])

console.log('\n-- a design with two darks produces no pair, rather than a wrong one --')
check('two darks', tone.pairColorSchemes([
    { name: 'Fake Dark', background: '#000', foreground: '#fff', colors: [] },
    { name: 'Fake Light', background: '#111', foreground: '#eee', colors: [] },
]).length, 0)
check('one of each pairs', tone.pairColorSchemes([
    { name: 'Fake Dark', background: '#000', foreground: '#fff', colors: [] },
    { name: 'Fake Light', background: '#fff', foreground: '#222', colors: [] },
]).map(p => p.name), ['Fake'])

console.log(`\n${passed} passed, ${failed} failed`)
process.exitCode = failed ? 1 : 0
