// A stand-in for "another app", for tabby-builds/test/conflicts.cdp.js: an
// Electron process that holds a TCP port and a global shortcut, and shows
// nothing.
//
//   <electron.exe> --user-data-dir=<scratch> conflictHelper.js \
//       --port <n> --accelerators <chord>,<chord>,… --dir <scratch> --parent <pid>
//
// It holds the first chord in the list that it can register. A chord can
// already be taken by something on the machine — Ctrl+Alt+Shift+F11 was, on
// the one this was written on — and the test needs one this process really
// holds, not one it merely asked for.
//
// It reports what it holds in <dir>/status.json and takes commands from
// <dir>/control.json — files rather than stdio, which an Electron main process
// on Windows does not reliably have. It quits when the process that started it
// goes away, and after ten minutes regardless, so a test that dies cannot
// leave it holding anything.
//
// It refuses port 3001 and Ctrl+Space outright: those are the resources the
// Tabby this machine is running actually uses.
const fs = require('fs')
const net = require('net')
const path = require('path')
const { app, globalShortcut } = require('electron')

const LIFETIME_MS = 10 * 60 * 1000

function arg (name) {
    const i = process.argv.indexOf(`--${name}`)
    return i === -1 ? null : process.argv[i + 1]
}

const port = parseInt(arg('port') ?? '', 10)
const accelerators = (arg('accelerators') ?? '').split(',').map(x => x.trim()).filter(x => !!x)
const dir = arg('dir')
const parent = parseInt(arg('parent') ?? '', 10)
const status = { pid: process.pid, accelerator: null, registered: false, listening: false, seq: 0, error: null }

function report () {
    const file = path.join(dir, 'status.json')
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(status))
    fs.renameSync(`${file}.tmp`, file)
}

function quit (code) {
    try {
        globalShortcut.unregisterAll()
    } catch { /* not ready yet */ }
    app.exit(code)
}

// An uncaught error in a main process opens a dialog, and this must never put
// anything on the screen.
process.on('uncaughtException', err => {
    status.error = String(err?.stack ?? err)
    try {
        report()
    } catch { /* nowhere to say it */ }
    quit(1)
})

if (!dir || !Number.isInteger(port) || !accelerators.length) {
    quit(2)
} else if (port === 3001 || accelerators.some(x => /^(ctrl|control)\+space$/i.test(x))) {
    quit(3)
} else {
    // No windows are ever opened, so there is nothing for this to close.
    app.on('window-all-closed', () => null)
    app.whenReady().then(() => {
        for (const candidate of accelerators) {
            if (globalShortcut.register(candidate, () => null)) {
                status.accelerator = candidate
                status.registered = true
                break
            }
        }
        // No host, as tabby-mcp-server's own listen() has none.
        const server = net.createServer(socket => socket.destroy())
        server.once('error', err => {
            status.error = String(err)
            report()
        })
        server.listen(port, () => {
            status.listening = true
            report()
        })

        let handled = 0
        setInterval(() => {
            let command = null
            try {
                command = JSON.parse(fs.readFileSync(path.join(dir, 'control.json'), 'utf8'))
            } catch { /* nothing asked yet */ }
            if (command && command.seq > handled) {
                handled = command.seq
                if (command.unregister && status.accelerator) {
                    globalShortcut.unregister(status.accelerator)
                    status.registered = false
                }
                if (command.closePort) {
                    server.close()
                    status.listening = false
                }
                status.seq = command.seq
                report()
                if (command.exit) {
                    quit(0)
                    return
                }
            }
            if (parent) {
                try {
                    process.kill(parent, 0)
                } catch (err) {
                    if (err.code !== 'EPERM') {
                        quit(0)
                    }
                }
            }
        }, 200)
        setTimeout(() => quit(0), LIFETIME_MS)
        report()
    })
}
