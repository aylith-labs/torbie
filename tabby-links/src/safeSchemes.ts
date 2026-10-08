import { schemeOf } from './services/linkRules.service'

/**
 * The URI schemes a click opens without asking, before the user adds any.
 *
 * `PlatformService.openExternal` has always opened the first four silently.
 * `stith` is here because a stith link is a terminal session asking to be
 * brought forward (`stith://focus/<id>`), answered by a local protocol handler
 * rather than a website — a confirmation on every click would make the link
 * pointless.
 */
export const DEFAULT_SAFE_SCHEMES: readonly string[] = ['http', 'https', 'ftp', 'mailto', 'stith']

/** The built-in list plus the user's own, from the Link Tooltip page. */
export function safeSchemeList (configured: readonly string[] | undefined): string[] {
    const extra = (configured ?? []).map(x => x.trim().toLowerCase()).filter(x => x)
    return [...new Set([...DEFAULT_SAFE_SCHEMES, ...extra])]
}

/**
 * Whether an OSC 8 link may be hovered and clicked.
 *
 * xterm drops every OSC 8 link that is not http(s) unless the link handler sets
 * `allowNonHttpProtocols`, and that flag is all-or-nothing. So the flag is set
 * and this decides instead, against the built-in list only: OSC 8 is text any
 * program can print, so a scheme the user trusted for links they hover
 * deliberately is not thereby one click away from untrusted output. `file:`,
 * `javascript:`, `ms-*` and everything else neither show a card nor open —
 * though xterm still underlines them on hover, since the flag is what decides
 * that.
 */
export function isOsc8LinkAllowed (uri: string): boolean {
    return DEFAULT_SAFE_SCHEMES.includes(schemeOf(uri))
}
