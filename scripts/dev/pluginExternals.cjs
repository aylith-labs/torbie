// What a compiled plugin `require`s at runtime, and whether a *packaged* app
// can answer each one.
//
// Why this exists: v1.0.1 never booted once installed. `@ngx-translate/core`
// 18 — bundled into `tabby-core` — imports `@angular/core/rxjs-interop`,
// `webpack.plugin.config.mjs` marks `/^@angular/` external, so the bundle says
// `require("@angular/core/rxjs-interop")` — and the shared module map in
// `app/src/plugins.ts`, which is the only thing that serves `@angular/*` to a
// packaged plugin, had no such key. `@angular` is a devDependency of the root,
// so it is nowhere in `app.asar` or `builtin-plugins`. tabby-core failed to
// load, the splash stayed up, and the watchdog quit after 60s.
//
// A source launch cannot see this: the repo's own `node_modules` sits on the
// resolution path and answers anything the map forgets. So the check is done
// here, against a model of what a packaged app actually has:
//
//   - the shared module map (the `cachedBuiltinModules` keys in plugins.ts);
//   - Node's builtins, and `electron`;
//   - the production closure of `app/package.json` — what electron-builder
//     puts in `app.asar/node_modules`, reached through NODE_PATH;
//   - each plugin's own production dependencies — `prepackage-plugins.mjs`
//     installs those with `--production` beside it;
//   - the builtin plugins themselves, by name, from `builtin-plugins`.
//
// Pure functions over strings, so the fast tier can test them without a build.
const fs = require('fs')
const path = require('path')
const nodeModule = require('module')

/**
 * Every string-literal `require(...)` in a compiled bundle.
 *
 * Bundled libraries document themselves with `require('x')` in comments
 * (winston, colors, require-in-the-middle all do), and some generate code as
 * strings (`require("${e}")`); neither is a runtime require. A match on a
 * comment line, or whose specifier is a template or format placeholder, is
 * skipped.
 */
function extractRequires (source) {
    const found = new Set()
    const re = /(?<![\w$.])require\(\s*(["'])([^"'\n]+)\1\s*\)/g
    let m
    while ((m = re.exec(source))) {
        const lineStart = source.lastIndexOf('\n', m.index) + 1
        const before = source.slice(lineStart, m.index)
        if (/^\s*(\/\/|\/?\*)/.test(before) || /\/\/[^'"`]*$/.test(before)) {
            continue
        }
        if (/[\s${}%…]/.test(m[2])) {
            continue
        }
        found.add(m[2])
    }
    return found
}

/** The keys of `cachedBuiltinModules` and the extra names in `builtinModules`. */
function sharedModuleKeys (pluginsTs) {
    const block = /const cachedBuiltinModules\s*=\s*\{([\s\S]*?)\n\}/.exec(pluginsTs)
    if (!block) {
        throw new Error('could not find `const cachedBuiltinModules = {` in plugins.ts')
    }
    const keys = new Set()
    for (const line of block[1].split('\n')) {
        const m = /^\s*(?:(["'])([^"']+)\1|([A-Za-z_$][\w$]*))\s*:/.exec(line)
        if (m) {
            keys.add(m[2] ?? m[3])
        }
    }
    const list = /const builtinModules\s*=\s*\[([\s\S]*?)\]/.exec(pluginsTs)
    if (list) {
        for (const m of list[1].matchAll(/(["'])([^"']+)\1/g)) {
            keys.add(m[2])
        }
    }
    return keys
}

/** `@scope/name/sub/path` → `@scope/name`; `name/sub` → `name`. */
function packageRoot (spec) {
    const parts = spec.split('/')
    return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

/**
 * yarn v1 lockfile → Map(name → { dependencies: string[] }). Only what is
 * needed to walk a closure; versions are ignored, because anything the lockfile
 * resolved is installed under that name somewhere reachable.
 */
function parseYarnLock (text) {
    const packages = new Map()
    let current = null
    let inDeps = false
    for (const raw of text.split(/\r?\n/)) {
        if (!raw.trim() || raw.startsWith('#')) {
            continue
        }
        if (!raw.startsWith(' ')) {
            const first = raw.replace(/:$/, '').split(',')[0].trim().replace(/^"|"$/g, '')
            const name = first.slice(0, first.lastIndexOf('@') > 0 ? first.lastIndexOf('@') : undefined)
            current = packages.get(name) ?? { dependencies: [] }
            packages.set(name, current)
            inDeps = false
            continue
        }
        if (/^ {2}\S/.test(raw)) {
            inDeps = /^ {2}(dependencies|optionalDependencies):\s*$/.test(raw)
            continue
        }
        if (inDeps && current && /^ {4}\S/.test(raw)) {
            const dep = raw.trim().split(/\s+/)[0].replace(/^"|"$/g, '')
            current.dependencies.push(dep)
        }
    }
    return packages
}

/** Names reachable from `roots` through the lockfile. */
function closure (roots, lock) {
    const seen = new Set()
    const queue = [...roots]
    while (queue.length) {
        const name = queue.pop()
        if (seen.has(name)) {
            continue
        }
        seen.add(name)
        for (const dep of lock.get(name)?.dependencies ?? []) {
            queue.push(dep)
        }
    }
    return seen
}

const NODE_BUILTINS = new Set(nodeModule.builtinModules)

/**
 * How a packaged app answers `spec` when `bundle` asks for it, or null.
 *
 * `ctx`: { shared: Set, appPackages: Set, pluginPackages: Map(bundle → Set),
 * builtinPlugins: Set }. `bundle` is a plugin name (`tabby-core`) or `app`.
 */
function resolveIn (spec, bundle, ctx) {
    if (spec.startsWith('.') || path.isAbsolute(spec)) {
        return 'relative'
    }
    const bare = spec.replace(/^node:/, '')
    if (NODE_BUILTINS.has(bare) || NODE_BUILTINS.has(bare.split('/')[0])) {
        return 'node-builtin'
    }
    if (spec === 'electron' || spec.startsWith('electron/')) {
        return 'electron'
    }
    // The map is consulted by exact key, before any resolution: a subpath of a
    // mapped package is *not* served by it. That is the whole of the v1.0.1
    // bug — `@angular/core` was there, `@angular/core/rxjs-interop` was not.
    if (bundle !== 'app' && ctx.shared.has(spec)) {
        return 'shared-map'
    }
    const root = packageRoot(spec)
    if (ctx.appPackages.has(root)) {
        return 'app.asar'
    }
    if (bundle !== 'app' && ctx.pluginPackages.get(bundle)?.has(root)) {
        return 'plugin-dependency'
    }
    if (bundle !== 'app' && ctx.builtinPlugins.has(root)) {
        return 'builtin-plugin'
    }
    return null
}

/** Build the resolution context from the tree at `root`, from sources alone. */
function packagedContext (root, builtinPlugins) {
    const read = rel => fs.readFileSync(path.join(root, rel), 'utf8')
    const shared = sharedModuleKeys(read('app/src/plugins.ts'))

    const appPkg = JSON.parse(read('app/package.json'))
    const appLock = parseYarnLock(read('app/yarn.lock'))
    const appPackages = closure([
        ...Object.keys(appPkg.dependencies ?? {}),
        ...Object.keys(appPkg.optionalDependencies ?? {}),
    ], appLock)

    const pluginPackages = new Map()
    for (const plugin of builtinPlugins) {
        const pkgFile = path.join(root, plugin, 'package.json')
        if (!fs.existsSync(pkgFile)) {
            continue
        }
        const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'))
        const lockFile = path.join(root, plugin, 'yarn.lock')
        const lock = fs.existsSync(lockFile) ? parseYarnLock(fs.readFileSync(lockFile, 'utf8')) : new Map()
        pluginPackages.set(plugin, closure([
            ...Object.keys(pkg.dependencies ?? {}),
            ...Object.keys(pkg.optionalDependencies ?? {}),
        ], lock))
    }
    return { shared, appPackages, pluginPackages, builtinPlugins: new Set(builtinPlugins) }
}

/** `{ bundle: [spec…] }` → `[{ bundle, spec }]` for every spec nothing serves. */
function unresolved (requiresByBundle, ctx) {
    const missing = []
    for (const [bundle, specs] of Object.entries(requiresByBundle)) {
        for (const spec of specs) {
            if (!resolveIn(spec, bundle, ctx)) {
                missing.push({ bundle, spec })
            }
        }
    }
    return missing
}

module.exports = {
    extractRequires,
    sharedModuleKeys,
    packageRoot,
    parseYarnLock,
    closure,
    resolveIn,
    packagedContext,
    unresolved,
}
