// Exercise the same findPlugins() entry point the renderer uses, with a
// throwaway plugin directory. No Electron window or real user profile needed.
const fs = require('fs')
const os = require('os')
const path = require('path')
const Module = require('module')

const root = path.resolve(__dirname, '../..')
const ts = require(path.join(root, 'node_modules/typescript'))
const originalTs = Module._extensions['.ts']
Module._extensions['.ts'] = (module, filename) => {
    const source = fs.readFileSync(filename, 'utf8')
    const js = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
    }).outputText
    module._compile(js, filename)
}

const originalLoad = Module._load
const angular = {
    Component: metadata => metadata,
    Directive: metadata => metadata,
    Pipe: metadata => metadata,
    ChangeDetectionStrategy: { Eager: 1 },
}
Module._load = function (request, ...rest) {
    if (request === 'mz/fs') {
        return { ...fs.promises, exists: async file => fs.existsSync(file) }
    }
    if (request === '@electron/remote') {
        return { app: { getAppPath: () => root } }
    }
    if (request === '@angular/core') {
        return angular
    }
    if (request.startsWith('@angular/') || request.startsWith('@ng-bootstrap/') ||
        request === 'ngx-toastr' || request === 'rxjs' || request.startsWith('rxjs/') ||
        request.startsWith('zone.js')) {
        return {}
    }
    return originalLoad.call(this, request, ...rest)
}

const originalGlobalRequire = global.require
const originalPaths = Module.globalPaths.slice()
const originalDev = process.env.TABBY_DEV
const cache = process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), '.cache')
fs.mkdirSync(cache, { recursive: true })
const fixture = fs.mkdtempSync(path.join(cache, 'torbie-plugin-discovery-'))

async function main () {
    try {
        process.env.TABBY_DEV = '1'
        global.require = () => ({})
        const { findPlugins } = require('../src/plugins.ts')
        const plugins = path.join(fixture, 'node_modules')
        const dir = path.join(plugins, 'tabby-no-author')
        fs.mkdirSync(dir, { recursive: true })
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
            name: 'tabby-no-author', version: '1.0.0', keywords: ['tabby-plugin'],
        }))
        Module.globalPaths.splice(0, Module.globalPaths.length, plugins)

        const discovered = await findPlugins()
        const plugin = discovered.find(item => item.packageName === 'tabby-no-author')
        if (plugin?.author !== '') {
            throw new Error(`valid plugin without author was not discovered: ${JSON.stringify(plugin)}`)
        }
        console.log('ok  valid Tabby plugin without author is discovered')
    } finally {
        Module.globalPaths.splice(0, Module.globalPaths.length, ...originalPaths)
        Module._load = originalLoad
        Module._extensions['.ts'] = originalTs
        global.require = originalGlobalRequire
        if (originalDev === undefined) delete process.env.TABBY_DEV
        else process.env.TABBY_DEV = originalDev
        fs.rmSync(fixture, { recursive: true, force: true })
    }
}

main().catch(error => { console.error(error); process.exitCode = 1 })
