import * as fs from 'fs'
import * as path from 'path'
import { app } from 'electron'

import { recordFailure, note } from './diagnostics'

/**
 * Carry a Tabby profile forward into Torbie's config directory.
 *
 * Renaming the app moves `app.getPath('userData')`, which is where everything
 * the user owns lives — their config, their plugins, their restored tabs, the
 * credentials the Integrations page stores. Without a copy-forward the first
 * launch under the new name looks like a fresh install, which is indignity
 * enough on its own and is *destructive* in one specific way: `Local Storage`
 * holds the saved tab layout, so the panes from the last session are simply
 * gone.
 *
 * This is not a new idea here. `config.ts` still migrates `../terminus/config.yaml`
 * forward from the last time this codebase was renamed; this is the same move
 * with the rest of the profile included.
 *
 * Three rules:
 *
 * 1. **Copy, never move.** The old directory belongs to a Tabby that may still
 *    be installed and running — on this machine it holds live sessions. Nothing
 *    here opens it for writing.
 * 2. **Only into an empty new profile.** The presence of `config.yaml` under the
 *    new name means this has already run, or the user has already started
 *    fresh; either way a second copy would overwrite work.
 * 3. **Never throw.** This runs before the config is loaded and before anything
 *    that could report a failure to the user exists, so a bad copy must cost
 *    the migration and nothing else.
 */

/** What is worth carrying, in the order it is copied. */
const ENTRIES = [
    'config.yaml',
    'config.yaml.backup',
    'window.json',
    'integration-credentials.json',
    '.updaterId',
    'jumplist-icons',
    // Tab recovery, recent profiles and the vault passphrase timeout live here.
    'Local Storage',
    // Copied rather than reinstalled: it holds `package-lock.json` and compiled
    // native dependencies that a fresh `npm install` would have to rebuild.
    'plugins',
]

/**
 * Dead weight `plugins.ts` already skips when discovering plugins. Left behind
 * rather than copied — it is a backup of shadowed builtins from an install that
 * no longer exists.
 */
const SKIP_WITHIN_PLUGINS = 'shadowed-builtins-backup'

function copyRecursive (from: string, to: string): void {
    const stat = fs.lstatSync(from)
    if (stat.isSymbolicLink()) {
        // A junction here is `plugins` pointing into a build slot's shared
        // directory. Recreating the link would tie the new profile to the old
        // one's target; skipping it leaves the user to re-make it deliberately.
        return
    }
    if (stat.isDirectory()) {
        fs.mkdirSync(to, { recursive: true })
        for (const child of fs.readdirSync(from)) {
            if (child === SKIP_WITHIN_PLUGINS) {
                continue
            }
            copyRecursive(path.join(from, child), path.join(to, child))
        }
        return
    }
    fs.copyFileSync(from, to)
}

/**
 * @param legacyName the directory name the profile used to have, as a sibling
 * of the current one.
 */
export function migrateUserData (legacyName = 'tabby'): void {
    try {
        const current = app.getPath('userData')
        const legacy = path.join(path.dirname(current), legacyName)

        if (path.resolve(current) === path.resolve(legacy)) {
            return
        }
        if (!fs.existsSync(path.join(legacy, 'config.yaml'))) {
            return
        }
        if (fs.existsSync(path.join(current, 'config.yaml'))) {
            return
        }

        fs.mkdirSync(current, { recursive: true })

        const copied: string[] = []
        for (const entry of ENTRIES) {
            const from = path.join(legacy, entry)
            if (!fs.existsSync(from)) {
                continue
            }
            try {
                copyRecursive(from, path.join(current, entry))
                copied.push(entry)
            } catch (err) {
                // One unreadable entry must not cost the whole profile — a
                // locked LevelDB is the likely case, and losing the tab layout
                // is much better than losing the config with it.
                recordFailure('user-data-migration-entry-failed', `${entry}: ${err}`)
            }
        }

        if (copied.length) {
            note('user-data-migrated', { from: legacyName, copied })
            console.log(`Migrated user data from ${legacy}:`, copied.join(', '))
        }
    } catch (err) {
        recordFailure('user-data-migration-failed', err)
    }
}
