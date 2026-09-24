// Arborist is npm's own install engine, used in-process so we don't have to bundle the 18 MB npm CLI
// and run it via ELECTRON_RUN_AS_NODE. reify() resolves and installs the full dependency tree.
//
// Required on first use, never at startup. It is ~1,660 modules (pacote, sigstore,
// npm-registry-fetch and the rest), and this file is imported by app.ts, so a top-level
// import made every launch load all of them before `app.ready` — measured at 55% of the main
// process's startup script time on a warm dev build (1.0s of 1.86s), and several seconds on a
// cold packaged one, for a feature used only when someone installs a plugin.
function arborist (): any {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const module = require('@npmcli/arborist')
    return module.default ?? module
}

export class PluginManager {
    async install (targetPath: string, name: string, version: string): Promise<void> {
        const Arborist = arborist()
        await new Arborist({ path: targetPath, save: false, audit: false, fund: false })
            .reify({ add: [`${name}@${version}`] })
    }

    async uninstall (targetPath: string, name: string): Promise<void> {
        const Arborist = arborist()
        await new Arborist({ path: targetPath, save: false })
            .reify({ rm: [name] })
    }
}

export const pluginManager = new PluginManager()
