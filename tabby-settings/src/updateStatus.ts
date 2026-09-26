import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker'
import type { UpdaterState } from 'tabby-core'

/**
 * What the Application page says about an update. Every state that has a
 * result says it — the old page had a spinning button and nothing else, so a
 * failed check and a check still running looked the same, for ever.
 */
export function describeUpdaterState (state: UpdaterState, t: (text: string, params?: Record<string, string>) => string): string {
    switch (state.kind) {
        case 'checking':
            return t(_('Checking for updates…'))
        case 'not-available':
            return t(_('Torbie is up to date.'))
        case 'downloading':
            return state.version
                ? t(_('Downloading {version}…'), { version: state.version })
                : t(_('Downloading the update…'))
        case 'downloaded':
            return state.version
                ? t(_('Torbie {version} is ready to install.'), { version: state.version })
                : t(_('The update is ready to install.'))
        case 'external':
            return state.version
                ? t(_('Torbie {version} is available.'), { version: state.version })
                : t(_('An update is available.'))
        case 'error':
            return t(_('Could not check for updates: {message}'), { message: state.message })
        default:
            return ''
    }
}
