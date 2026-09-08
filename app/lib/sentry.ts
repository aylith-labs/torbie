// Crash reporting, off unless a DSN is supplied at build time.
//
// This file used to carry upstream Tabby's own DSN as a literal, which meant
// every build of this fork reported its crashes into Eugeny's Sentry project —
// under a version string that means nothing there. There is no Torbie project
// to point it at yet, so the honest default is to send nothing at all: an
// absent DSN skips `init` entirely rather than initialising a client with
// nowhere to go.
//
// `TORBIE_SENTRY_DSN` is read from `process.env` so that `webpack.DefinePlugin`
// can substitute it at build time (see `app/webpack.config.mjs`); it is
// undefined in a source build, which is what keeps a dev run silent.
const { init } = String(process.type) === 'main' ? require('@sentry/electron/dist/main') : require('@sentry/electron/dist/renderer')

const SENTRY_DSN = process.env.TORBIE_SENTRY_DSN
let release = null
try {
    release = require('electron').app.getVersion()
} catch {
    release = require('@electron/remote').app.getVersion()
}

if (SENTRY_DSN && !process.env.TABBY_DEV && !process.env.TORBIE_DEV) {
    init({
        dsn: SENTRY_DSN,
        release,
        integrations (integrations) {
            return integrations.filter(integration => integration.name !== 'Breadcrumbs')
        },
    })
}
