import * as url from 'url'
const __dirname = url.fileURLToPath(new URL('.', import.meta.url))

import config from '../webpack.plugin.config.mjs'

export default () => {
    const c = config({
        name: 'links',
        dirname: __dirname,
    })
    // The integration logos. Added here rather than in the shared plugin config
    // because that config builds a fresh object per call, so this leaks into no
    // other package — and editing the shared file would be rebase surface on an
    // upstream build file for the sake of one package's assets.
    //
    // `asset/inline` (a data URI), deliberately, and not the other two:
    //
    //   `asset/resource` emits a separate file and a URL resolved against
    //   webpack's `publicPath`, which under this bundle's `target: 'node'` is a
    //   filesystem path rather than a `file://` URL. That lands in an <img src>
    //   as a broken image, with nothing logged and no build failure.
    //
    //   Bare `asset` chooses between the two at an 8 KB threshold, so today's
    //   four icons (1.5-2.8 KB) would inline and a larger fifth one would
    //   silently switch to the broken case. There is no cliff here.
    c.module.rules.push({
        test: /\.png$/,
        type: 'asset/inline',
    })
    return c
}
