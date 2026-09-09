#!/usr/bin/env node
// Generate every Torbie icon asset from one definition of the mark.
//
//   node scripts/dev/make-icons.mjs            # write them
//   node scripts/dev/make-icons.mjs --dry-run  # say what would change
//
// The mark is `>T` — a prompt closing on the crossbar of a T, whose stem is a
// git-branch trunk with a commit at its foot and one at the end of the bar. The
// geometry lives in `MARK` below and **nowhere else**: every PNG, the .ico, the
// .icns and all three SVGs are rendered from it, so they cannot drift the way a
// hand-exported set does.
//
// Conventions come from aylith-com's `aylith-brand-mark` skill, which owns the
// studio's marks:
//
// - viewBox `0 0 256 256`, **transparent**, no background rect.
// - Palette only: ink `#1c1a16` <-> cream `#f3efe7`, copper `#c97a3a`,
//   bronze `#9a6432`.
// - **Two treatments over one geometry.** *Theme-aware* flips ink to cream via
//   `prefers-color-scheme` and is what the SVGs ship. *Bronze duotone* is what
//   every raster bakes, because a PNG cannot flip and the Windows taskbar takes
//   its colour from `SystemUsesLightTheme` rather than from the app.
// - **Rasterize with Chromium, never ImageMagick**, which mis-renders SVG
//   strokes. Here that is Electron's own renderer, drawing each SVG into a
//   canvas at the exact pixel size — the same approach `jumpListIcons.service.ts`
//   uses to draw profile icons.
import * as fs from 'fs'
import * as path from 'path'
import * as url from 'url'
import { execFileSync } from 'child_process'

const __dirname = url.fileURLToPath(new URL('.', import.meta.url))
const repo = path.resolve(__dirname, '..', '..')
const dryRun = process.argv.includes('--dry-run')

const INK = '#1c1a16'
const CREAM = '#f3efe7'
const COPPER = '#c97a3a'
const BRONZE = '#9a6432'

/**
 * The locked geometry.
 *
 * Each shape declares its *role* rather than a colour, so the two treatments
 * are two ways of resolving the same list and cannot drift apart. The prompt is
 * drawn first, so the crossbar's round cap closes over its vertex.
 *
 * `offset` centres the ink on the 256 grid: the raw coordinates put the
 * bounding box at x 26..216, y 26..222 — 7px left and 4px high of centre, which
 * reads as a misalignment in a dock.
 */
const MARK = {
    offset: [7, 4],
    shapes: [
        { role: 'accent', stroke: 'M 38 38 L 72 72 L 38 106', width: 24, join: 'round' },
        { role: 'body', stroke: 'M 72 72 L 184 72', width: 24 },
        { role: 'body', circle: [196, 72, 20] },
        { role: 'body', stroke: 'M 128 72 L 128 176', width: 24 },
        { role: 'body', circle: [128, 200, 22] },
    ],
}

/**
 * @param paint given a shape's role, returns the attributes that colour it —
 * either literal `fill`/`stroke`, or a class the document's own stylesheet
 * resolves.
 */
function shapes (paint) {
    return MARK.shapes.map(s => {
        if (s.circle) {
            const [cx, cy, r] = s.circle
            return `<circle cx="${cx}" cy="${cy}" r="${r}" ${paint(s.role, 'fill')}/>`
        }
        const join = s.join ? ` stroke-linejoin="${s.join}"` : ''
        return `<path d="${s.stroke}" fill="none" ${paint(s.role, 'stroke')}`
            + ` stroke-width="${s.width}" stroke-linecap="round"${join}/>`
    }).join('')
}

function wrap (inner, extra = '') {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">'
        + extra
        + `<g transform="translate(${MARK.offset[0]} ${MARK.offset[1]})">${inner}</g>`
        + '</svg>\n'
}

/**
 * Ink that becomes cream on a dark ground. Used for every SVG that ships.
 *
 * The colour comes from a class rather than a presentation attribute, and the
 * stylesheet sets `fill:none` on the stroked shapes itself — CSS beats a
 * presentation attribute, so a `fill="none"` left on the element would be
 * overridden by the rule and the open chevron path would fill as a triangle.
 */
function themeAwareSVG () {
    const style = '<style>'
        + `.s{fill:none;stroke:${INK}}.f{fill:${INK}}`
        + `@media (prefers-color-scheme:dark){.s{stroke:${CREAM}}.f{fill:${CREAM}}}`
        + '</style>'
    return wrap(shapes((role, kind) => {
        if (role === 'accent') {
            return kind === 'fill' ? `fill="${COPPER}"` : `stroke="${COPPER}"`
        }
        return kind === 'fill' ? 'class="f"' : 'class="s"'
    }), style)
}

/** One tone that reads on both grounds. Everything rasterized bakes this. */
function duotoneSVG () {
    return wrap(shapes((role, kind) => {
        const colour = role === 'accent' ? COPPER : BRONZE
        return `${kind}="${colour}"`
    }))
}

/**
 * Black plus alpha, nothing else — a macOS *template* image, which the OS
 * recolours itself for the menu bar. A coloured template renders as a solid
 * blob, so the accent goes black here rather than being merely dimmed.
 */
function templateSVG () {
    return wrap(shapes((role, kind) => `${kind}="#000000"`))
}

// ── Raster, through Chromium ──────────────────────────────────────────────

/**
 * Draw each request into a canvas at its exact pixel size and hand back the
 * PNG bytes. One Electron process for the whole set: starting a renderer costs
 * far more than every draw put together.
 */
function rasterize (requests) {
    const script = path.join(repo, 'scripts', 'dev', 'rasterize-icons.cjs')
    const payload = path.join(repo, 'app', 'dist', '.icon-requests.json')
    const out = path.join(repo, 'app', 'dist', '.icon-output.json')
    fs.mkdirSync(path.dirname(payload), { recursive: true })
    fs.writeFileSync(payload, JSON.stringify({ requests, out }))
    const electron = path.join(repo, 'node_modules', 'electron', 'dist',
        process.platform === 'win32' ? 'electron.exe' : 'electron')
    execFileSync(electron, [script, payload], { stdio: ['ignore', 'pipe', 'inherit'] })
    const result = JSON.parse(fs.readFileSync(out, 'utf8'))
    fs.rmSync(payload, { force: true })
    fs.rmSync(out, { force: true })
    return result.map(x => Buffer.from(x, 'base64'))
}

// ── Containers ────────────────────────────────────────────────────────────

/**
 * The `.ico` container, written by hand — nothing in this stack encodes one.
 * A directory plus one PNG per size, which has been legal since Vista. Same
 * shape as `jumpListIcons.service.ts`, which draws the jump list's icons.
 */
function buildIco (images) {
    const directory = Buffer.alloc(6 + 16 * images.length)
    directory.writeUInt16LE(0, 0)
    directory.writeUInt16LE(1, 2)
    directory.writeUInt16LE(images.length, 4)
    let offset = directory.length
    images.forEach((image, i) => {
        const at = 6 + i * 16
        // 256 is stored as 0 — the field is one byte.
        directory.writeUInt8(image.size >= 256 ? 0 : image.size, at)
        directory.writeUInt8(image.size >= 256 ? 0 : image.size, at + 1)
        directory.writeUInt8(0, at + 2)
        directory.writeUInt8(0, at + 3)
        directory.writeUInt16LE(1, at + 4)
        directory.writeUInt16LE(32, at + 6)
        directory.writeUInt32LE(image.png.length, at + 8)
        directory.writeUInt32LE(offset, at + 12)
        offset += image.png.length
    })
    return Buffer.concat([directory, ...images.map(i => i.png)])
}

/**
 * The `.icns` container, also by hand: `icns`, a big-endian total length, then
 * one `type + length + PNG` record each. Only the PNG-capable modern type
 * codes are used — `ic04`/`ic05` are ARGB rather than PNG, so the 16pt and
 * 32pt slots are filled by their @2x forms and macOS scales down.
 */
function buildIcns (entries) {
    const records = entries.map(({ type, png }) => {
        const header = Buffer.alloc(8)
        header.write(type, 0, 4, 'ascii')
        header.writeUInt32BE(png.length + 8, 4)
        return Buffer.concat([header, png])
    })
    const body = Buffer.concat(records)
    const header = Buffer.alloc(8)
    header.write('icns', 0, 4, 'ascii')
    header.writeUInt32BE(body.length + 8, 4)
    return Buffer.concat([header, body])
}

// ── What gets written ─────────────────────────────────────────────────────

const themeAware = themeAwareSVG()
const duotone = duotoneSVG()
const template = templateSVG()

const PNG_SIZES = [16, 32, 48, 64, 128, 256, 512, 1024]

const requests = [
    ...PNG_SIZES.map(size => ({ svg: duotone, size })),
    { svg: template, size: 16 },
    { svg: template, size: 32 },
]

console.log(`rasterizing ${requests.length} images through Chromium`)
const raster = dryRun ? requests.map(() => Buffer.alloc(0)) : rasterize(requests)
const duo = {}
PNG_SIZES.forEach((size, i) => { duo[size] = raster[i] })
const tpl = { 16: raster[PNG_SIZES.length], 32: raster[PNG_SIZES.length + 1] }

const files = [
    // Theme-aware SVGs — these ship as vectors and flip with the OS.
    ['app/assets/logo.svg', Buffer.from(themeAware)],
    ['build/icons/icon.svg', Buffer.from(themeAware)],
    ['docs/favicon.svg', Buffer.from(themeAware)],

    // Linux, and the generic set electron-builder reads.
    ['build/icons/16x16.png', duo[16]],
    ['build/icons/32x32.png', duo[32]],
    ['build/icons/64x64.png', duo[64]],
    ['build/icons/128x128.png', duo[128]],
    ['build/icons/256x256.png', duo[256]],
    ['build/icons/512x512.png', duo[512]],
    ['build/icons/Icon-MacOS-512x512@2x.png', duo[1024]],

    ['build/windows/icon.ico', buildIco([16, 32, 48, 64, 128, 256].map(
        size => ({ size, png: duo[size] })))],

    ['build/mac/icon.icns', buildIcns([
        { type: 'ic11', png: duo[32] },    // 16pt @2x
        { type: 'ic12', png: duo[64] },    // 32pt @2x
        { type: 'ic07', png: duo[128] },
        { type: 'ic13', png: duo[256] },   // 128pt @2x
        { type: 'ic08', png: duo[256] },
        { type: 'ic14', png: duo[512] },   // 256pt @2x
        { type: 'ic09', png: duo[512] },
        { type: 'ic10', png: duo[1024] },  // 512pt @2x
    ])],

    // Tray. macOS wants black-and-alpha templates it can recolour; every other
    // platform gets the duotone.
    ['app/assets/tray.png', duo[32]],
    ['app/assets/tray-darwinTemplate.png', tpl[16]],
    ['app/assets/tray-darwinTemplate@2x.png', tpl[32]],
    ['app/assets/tray-darwinHighlightTemplate.png', tpl[16]],
    ['app/assets/tray-darwinHighlightTemplate@2x.png', tpl[32]],
]

for (const [rel, data] of files) {
    const target = path.join(repo, rel)
    const before = fs.existsSync(target) ? fs.statSync(target).size : 0
    if (dryRun) {
        console.log(`  would write ${rel.padEnd(46)} (was ${before} bytes)`)
        continue
    }
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, data)
    console.log(`  ${rel.padEnd(46)} ${before} -> ${data.length} bytes`)
}

// Squirrel is the old Windows updater; nothing in this tree references it.
const squirrel = path.join(repo, 'build', 'windows', 'squirrel.gif')
if (fs.existsSync(squirrel)) {
    if (dryRun) {
        console.log('  would delete build/windows/squirrel.gif')
    } else {
        fs.rmSync(squirrel)
        console.log('  build/windows/squirrel.gif                      deleted')
    }
}

console.log(dryRun ? '\ndry run — nothing written' : '\ndone')
