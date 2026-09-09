// Draw SVGs into a canvas at exact pixel sizes and hand back PNG bytes.
//
// Run by `make-icons.mjs`, never on its own. Electron because the skill that
// owns the studio's marks is explicit that ImageMagick mis-renders SVG strokes
// and clip paths — Chromium is the renderer that gets them right, and this repo
// already has one. `jumpListIcons.service.ts` draws the jump list's icons the
// same way, for the same reason.
//
// A canvas rather than `capturePage`: a captured window is composited against
// something, and these have to be transparent. Reading `toDataURL` from a
// canvas the SVG was drawn into keeps the alpha exactly as authored.
const { app, BrowserWindow } = require('electron')
const fs = require('fs')

const payloadPath = process.argv[2]
const { requests, out } = JSON.parse(fs.readFileSync(payloadPath, 'utf8'))

app.disableHardwareAcceleration()

app.whenReady().then(async () => {
    const win = new BrowserWindow({
        show: false,
        width: 64,
        height: 64,
        webPreferences: { offscreen: true },
    })
    await win.loadURL('data:text/html,<body style="margin:0">')

    const results = []
    for (const { svg, size } of requests) {
        const dataUrl = await win.webContents.executeJavaScript(`
            new Promise((resolve, reject) => {
                const svg = ${JSON.stringify(svg)}
                const size = ${size}
                const img = new Image()
                // A blob URL rather than a data: URL — a data: URL of SVG is
                // subject to the page's CSP, and this one has none only by
                // accident.
                const blob = new Blob([svg], { type: 'image/svg+xml' })
                const src = URL.createObjectURL(blob)
                img.onload = () => {
                    const canvas = document.createElement('canvas')
                    canvas.width = size
                    canvas.height = size
                    const ctx = canvas.getContext('2d')
                    ctx.clearRect(0, 0, size, size)
                    ctx.drawImage(img, 0, 0, size, size)
                    URL.revokeObjectURL(src)
                    // A mark that drew nothing is the failure this whole set is
                    // most likely to produce silently, so it is caught here
                    // rather than shipped as a blank tile.
                    const data = ctx.getImageData(0, 0, size, size).data
                    let opaque = 0
                    for (let i = 3; i < data.length; i += 4) {
                        if (data[i] > 8) { opaque++ }
                    }
                    if (!opaque) {
                        reject(new Error('rendered ' + size + 'px blank'))
                        return
                    }
                    resolve(canvas.toDataURL('image/png'))
                }
                img.onerror = () => reject(new Error('could not decode the SVG'))
                img.src = src
            })
        `)
        results.push(dataUrl.replace(/^data:image\/png;base64,/, ''))
        process.stderr.write(`    ${String(size).padStart(4)}px ok\n`)
    }

    fs.writeFileSync(out, JSON.stringify(results))
    app.exit(0)
}).catch(err => {
    process.stderr.write(String(err?.message ?? err) + '\n')
    app.exit(1)
})
