const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const assert = require('node:assert/strict')
const ts = require('../../node_modules/typescript')
const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/sentry.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
for (const type of ['browser', 'main', 'renderer']) {
    for (const env of [{}, { TORBIE_DEV: '1', TORBIE_SENTRY_DSN: 'https://example.invalid/1' }, { TORBIE_SENTRY_DSN: 'https://example.invalid/1' }]) {
        const modules = []
        let initialized = false
        vm.runInNewContext(source, {
            process: { type, env },
            require: name => {
                modules.push(name)
                if (name === 'electron') { return { app: { getVersion: () => '1.0.0' } } }
                return { init: () => { initialized = true } }
            },
        })
        const enabled = Boolean(env.TORBIE_SENTRY_DSN && !env.TORBIE_DEV)
        assert.equal(initialized, enabled)
        if (!enabled) { assert.deepEqual(modules, []) } else {
            assert.equal(modules.at(-1), `@sentry/electron/${type === 'renderer' ? 'renderer' : 'main'}`)
        }
    }
}
console.log('Sentry: disabled and development paths load no SDK; public entry points match the process')
