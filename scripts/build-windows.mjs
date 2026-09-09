#!/usr/bin/env node
/* eslint-disable @typescript-eslint/prefer-nullish-coalescing */
import { build as builder } from 'electron-builder'
import * as vars from './vars.mjs'
import { execSync } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'
import * as url from 'url'

const __dirname = url.fileURLToPath(new URL('.', import.meta.url))
const repo = path.resolve(__dirname, '..')

const isTag = (process.env.GITHUB_REF || process.env.BUILD_SOURCEBRANCH || '').startsWith('refs/tags/')
const keypair = process.env.SM_KEYPAIR_ALIAS

process.env.ARCH = process.env.ARCH || process.arch

/**
 * `build/installer.nsh` embeds the Visual C++ redistributable into the
 * installer, because node-pty needs `vcruntime140.dll` and a machine without it
 * shows the splash screen forever with no terminal (upstream #10734, #10782).
 *
 * `File` on a path that is not there is a *compile*-time NSIS failure, and what
 * it prints is `Error in macro customInstall on macroline 6` — which names
 * neither the file nor the reason. CI has always downloaded it in a separate
 * step, so a local build has never had it, and the first local installer build
 * of this project died exactly that way. Fetched here instead: one place, and
 * the same on a laptop as on a runner.
 */
async function ensureVCRedist () {
    const target = path.join(repo, 'build', 'vc_redist.exe')
    if (fs.existsSync(target) && fs.statSync(target).size > 1_000_000) {
        console.log('vc_redist.exe: already present')
        return
    }
    const source = process.env.ARCH === 'arm64'
        ? 'https://aka.ms/vs/17/release/vc_redist.arm64.exe'
        : 'https://aka.ms/vs/17/release/vc_redist.x64.exe'
    console.log(`vc_redist.exe: downloading ${source}`)
    const response = await fetch(source, { redirect: 'follow' })
    if (!response.ok) {
        throw new Error(`could not download the VC++ redistributable: HTTP ${response.status}`)
    }
    const bytes = Buffer.from(await response.arrayBuffer())
    // A redirect to an error page would otherwise be written out as a "redist"
    // that NSIS embeds happily and that installs nothing.
    if (bytes.length < 1_000_000 || bytes.subarray(0, 2).toString('latin1') !== 'MZ') {
        throw new Error(`downloaded ${bytes.length} bytes, and it is not a Windows executable`)
    }
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, bytes)
    console.log(`vc_redist.exe: ${(bytes.length / 1e6).toFixed(1)} MB`)
}

await ensureVCRedist()

console.log('Signing enabled:', !!keypair)

builder({
    dir: true,
    win: ['nsis', 'zip'],
    arm64: process.env.ARCH === 'arm64',
    config: {
        extraMetadata: {
            version: vars.version,
        },
        publish: [
            {
                provider: 'github',
                channel: `latest-${process.env.ARCH}`,
            },
        ],
        forceCodeSigning: !!keypair,
        win: {
            signtoolOptions: {
                certificateSha1: process.env.SM_CODE_SIGNING_CERT_SHA1_HASH,
                publisherName: process.env.SM_PUBLISHER_NAME,
                signingHashAlgorithms: ['sha256'],
                sign: keypair ? async function (configuration) {
                    console.log('Signing', configuration)
                    if (configuration.path) {
                        try {
                            const cmd = `smctl sign --keypair-alias=${keypair} --input "${String(configuration.path)}"`
                            console.log(cmd)
                            const out = execSync(cmd)
                            if (out.toString().includes('FAILED')) {
                                throw new Error(out.toString())
                            }
                            console.log(out.toString())
                        } catch (e) {
                            console.error(`Failed to sign ${configuration.path}`)
                            if (e.stdout) {
                                console.error('stdout:', e.stdout.toString())
                            }
                            if (e.stderr) {
                                console.error('stderr:', e.stderr.toString())
                            }
                            console.error(e)
                            process.exit(1)
                        }
                    }
                } : undefined,
            },
        },
    },

    publish: isTag ? 'always' : 'never',
}).catch(e => {
    console.error(e)
    process.exit(1)
})
