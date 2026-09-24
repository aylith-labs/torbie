/**
 * Pasting an image into a terminal app that reads the clipboard itself.
 *
 * A terminal can only paste text. Claude Code (and other TUIs) paste images by
 * reading the OS clipboard on their own when they see the raw Ctrl+V byte; on
 * WSL it shells out to powershell.exe for the Windows clipboard. So when the
 * clipboard holds an image and no text, the useful thing for "paste" to do is
 * send that byte, not an empty paste.
 *
 * Kept free of Angular and xterm so the fast test tier can load it.
 */

/** What Ctrl+V sends in a terminal: 0x16, SYN, readline's quoted-insert. */
export const CTRL_V = '\x16'

/**
 * The input a paste should send instead of the clipboard text, or null to paste
 * the text as usual. Only an empty text clipboard that holds an image qualifies,
 * so text paste is untouched — including text copied together with an image.
 */
export function imagePasteInput (text: string, hasImage: boolean, enabled: boolean): string | null {
    return enabled && text === '' && hasImage ? CTRL_V : null
}
