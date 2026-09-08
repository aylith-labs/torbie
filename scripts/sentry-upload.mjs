#!/usr/bin/env node
import sh from 'shelljs'
import * as vars from './vars.mjs'

// Symbol upload is only meaningful once there is a Sentry project to upload
// into. There is none yet (`app/lib/sentry.ts` ships no DSN), so the workflow
// steps that call this are guarded here rather than three times in build.yml —
// one place, and it works the same on all three platforms.
if (!process.env.SENTRY_AUTH_TOKEN || !process.env.SENTRY_ORG || !process.env.SENTRY_PROJECT) {
    console.log('No Sentry credentials configured — skipping symbol upload.')
    process.exit(0)
}

const sentryCli = process.platform === 'win32' ? 'node_modules\\.bin\\sentry-cli.cmd' : 'sentry-cli'

sh.exec(`${sentryCli} releases new ${vars.version}`)

if (process.platform === 'darwin') {
    for (const path of [
        'app/node_modules/@serialport/bindings/build/Release/bindings.node',
        'app/node_modules/node-pty/build/Release/pty.node',
        'app/node_modules/fontmanager-redux/build/Release/fontmanager.node',
        'app/node_modules/macos-native-processlist/build/Release/native.node',
    ]) {
        sh.exec('dsymutil ' + path)
    }
}

sh.exec(`${sentryCli} upload-dif app/node_modules`)
sh.exec(`${sentryCli} releases set-commits --auto ${vars.version}`)
for (const p of vars.builtinPlugins) {
    sh.exec(`${sentryCli} releases files ${vars.version} upload-sourcemaps ${p}/dist -u ${p}/dist/ -d ${process.platform}-${p}`)
}
