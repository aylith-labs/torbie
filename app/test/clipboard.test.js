const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('../../node_modules/typescript')
const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../lib/clipboard.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const exportsObject = {}
vm.runInNewContext(source, { exports: exportsObject, Blob, Set, Error })
async function main () {
    let handler, reads = 0, written
    const ipc = { on: (_channel, callback) => { handler = callback } }
    const clipboard = {
        readText: async () => { reads++; return 'hello 🌍' },
        read: async () => [{ types: ['text/plain', 'image/png'] }, { types: ['image/png'] }],
        write: async items => { written = items },
    }
    class Item { constructor (data) { this.data = data } }
    exportsObject.installClipboardBridge(ipc, clipboard, Item, event => event.trusted)
    const call = (operation, content, trusted = true) => new Promise(resolve => {
        handler({ trusted, set returnValue (result) { resolve(result) } }, operation, content)
    })
    assert.equal((await call('readText')).value, 'hello 🌍')
    assert.deepEqual(Array.from((await call('availableFormats')).value), ['text/plain', 'image/png'])
    assert.match((await call('readText', undefined, false)).error, /denied/)
    assert.equal(reads, 1)
    await call('write', { text: 'hello', html: '<b>hello</b>' })
    assert.equal(await written[0].data['text/plain'].text(), 'hello')
    assert.equal(await written[0].data['text/html'].text(), '<b>hello</b>')
    assert.match((await call('write', { text: 5 })).error, /Invalid/)
    assert.match((await call('delete')).error, /Unknown/)
    clipboard.readText = async () => { throw new Error('clipboard unavailable') }
    assert.equal((await call('readText')).error, 'clipboard unavailable')
    console.log('clipboard bridge: text, image formats, rich copy, authorization and failures passed')
}
main().catch(error => { console.error(error); process.exitCode = 1 })
