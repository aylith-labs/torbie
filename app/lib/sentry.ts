// Crash reporting, off unless a DSN is supplied at build time.
//
// This file used to carry upstream Tabby's own DSN as a literal, which meant
// every build of this fork reported its crashes into Eugeny's Sentry project —
// under a version string that means nothing there. There is no Torbie project
// to point it at yet, so the honest default is to send nothing at all: an
// absent DSN skips `init` entirely rather than initialising a client with
// nowhere to go.
//
// `TORBIE_SENTRY_DSN` is read from the real environment, so a build that has
// a project to report into supplies it and one that does not stays silent
// without a code change.
//
// **Nothing is required until there is a DSN.** This module is imported from
// `index.ts` and preloaded into every window, so a top-level
// `require('@sentry/electron/…')` loaded the whole client into the main process
// on every boot — for a feature that then did not initialise. Module loading is
// the documented cost here: a cold main process has been measured blocking
// 17.4s during `main-start` on `fs.readFileSync ×817`, which is exactly this
// shape. The require moves inside the guard, so the disabled path costs one
// environment-variable read.
const SENTRY_DSN = process.env.TORBIE_SENTRY_DSN

if (SENTRY_DSN && !process.env.TABBY_DEV && !process.env.TORBIE_DEV) {
    let release: string|null = null
    try {
        release = require('electron').app.getVersion()
    } catch {
        release = require('@electron/remote').app.getVersion()
    }

    const { init } = String(process.type) === 'main'
        ? require('@sentry/electron/dist/main')
        : require('@sentry/electron/dist/renderer')

    init({
        dsn: SENTRY_DSN,
        release,
        integrations (integrations) {
            return integrations.filter(integration => integration.name !== 'Breadcrumbs')
        },
    })
}
