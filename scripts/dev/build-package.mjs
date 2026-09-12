#!/usr/bin/env node
// Build one package, or a few, instead of the whole tree.
//
//   node scripts/dev/build-package.mjs tabby-builds [tabby-links ...]
//
// `yarn run build` compiles typings, the app and every package back to back,
// which is the right thing for a release and the wrong thing while iterating on
// one settings page — and when several people (or agents) are each working on a
// different package in one checkout, a full build is one of them rewriting
// everyone else's bundles underneath their running instances. This runs the
// same webpack config `scripts/build-modules.mjs` runs, for the names given.
import webpack from 'webpack'
import { promisify } from 'node:util'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as url from 'node:url'

const root = path.resolve(url.fileURLToPath(new URL('.', import.meta.url)), '..', '..')
const names = process.argv.slice(2)
if (!names.length) {
    console.error('usage: node scripts/dev/build-package.mjs <package> [<package> ...]')
    process.exit(2)
}

for (const name of names) {
    const configPath = path.join(root, name, 'webpack.config.mjs')
    if (!fs.existsSync(configPath)) {
        console.error(`${name}: no webpack.config.mjs at ${configPath}`)
        process.exit(2)
    }
    const started = Date.now()
    const config = (await import(url.pathToFileURL(configPath).href)).default()
    const stats = await promisify(webpack)(config)
    const info = stats.toJson({ all: false, errors: true, warnings: true })
    for (const error of info.errors ?? []) {
        console.error(error.message ?? error)
    }
    const seconds = ((Date.now() - started) / 1000).toFixed(1)
    console.log(`${name}: ${stats.hasErrors() ? 'FAILED' : 'ok'} in ${seconds}s (${info.warnings?.length ?? 0} warnings)`)
    if (stats.hasErrors()) {
        process.exit(1)
    }
}
