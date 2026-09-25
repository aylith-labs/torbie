import type { IpcMain, IpcMainEvent, Clipboard, ClipboardItem } from 'electron'

/** Keep Tabby's synchronous plugin API while Electron 44 reads asynchronously.
 * The main process continues running while sendSync waits in the renderer.
 */
export function installClipboardBridge (
    ipc: IpcMain,
    clipboard: Clipboard,
    Item: typeof ClipboardItem,
    trusted: (event: IpcMainEvent) => boolean,
): void {
    ipc.on('torbie:clipboard', (event, operation: string, content?: { text: string, html?: string }) => {
        if (!trusted(event)) {
            event.returnValue = { error: 'Clipboard access denied' }
            return
        }
        const run = async () => {
            switch (operation) {
                case 'readText': return clipboard.readText()
                case 'availableFormats': return [...new Set((await clipboard.read()).flatMap(item => item.types))]
                case 'write': {
                    if (!content || typeof content.text !== 'string' || (content.html !== undefined && typeof content.html !== 'string')) {
                        throw new Error('Invalid clipboard content')
                    }
                    const data: Record<string, Blob> = { 'text/plain': new Blob([content.text], { type: 'text/plain' }) }
                    if (content.html !== undefined) {
                        data['text/html'] = new Blob([content.html], { type: 'text/html' })
                    }
                    await clipboard.write([new Item(data)])
                    return null
                }
                default: throw new Error('Unknown clipboard operation')
            }
        }
        void run().then(value => { event.returnValue = { value } }, error => {
            event.returnValue = { error: String(error.message ?? error) }
        })
    })
}
