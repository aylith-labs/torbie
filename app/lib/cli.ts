import { app } from 'electron'

interface YargsOption {
    type?: 'string' | 'number' | 'boolean' | 'array'
    alias?: string
    describe?: string
    default?: any
    choices?: string[]
}

interface CommandConfig {
    command: string | string[]
    description: string
    options?: Record<string, YargsOption>
    positionals?: Record<string, YargsOption>
}

interface ParserConfig {
    usage: string
    commands: CommandConfig[]
    options: Record<string, YargsOption>
    version: string
}

export function createParserConfig (cwd: string): ParserConfig {
    return {
        usage: 'torbie [command] [arguments]',
        commands: [
            {
                command: 'open [directory]',
                description: 'open a shell in a directory',
                options: {
                    directory: { type: 'string', 'default': cwd },
                },
            },
            {
                command: ['run [command...]', '/k'],
                description: 'run a command in the terminal',
                options: {
                    command: { type: 'array' },
                },
            },
            {
                command: 'profile [profileName]',
                description: 'open a tab with specified profile',
                options: {
                    profileName: { type: 'string' },
                },
            },
            {
                command: 'paste [text]',
                description: 'paste stdin into the active tab',
                options: {
                    escape: {
                        alias: 'e',
                        type: 'boolean',
                        describe: 'Perform shell escaping',
                    },
                },
                positionals: {
                    text: { type: 'string' },
                },
            },
            {
                command: 'recent [index]',
                description: 'open a tab with a recent profile',
                options: {
                    profileNumber: { type: 'number' },
                },
            },
            {
                command: 'quickConnect <providerId> <query>',
                description: 'open a tab for specified quick connect provider',
                positionals: {
                    providerId: {
                        describe: 'The name of a quick connect profile provider',
                        type: 'string',
                    },
                    query: {
                        describe: 'The quick connect query string',
                        type: 'string',
                    },
                },
            },
        ],
        options: {
            debug: {
                alias: 'd',
                describe: 'Show DevTools on start',
                type: 'boolean',
            },
            hidden: {
                describe: 'Start minimized',
                type: 'boolean',
            },
        },
        version: app.getVersion(),
    }
}

function applyOptionsToYargs (yargsInstance: any, options: Record<string, YargsOption>, method: 'option' | 'positional') {
    return Object.entries(options).reduce(
        (yargs, [key, value]) => yargs[method](key, value),
        yargsInstance,
    )
}

function createParserFromConfig (config: ParserConfig) {
    const yargs = require('yargs/yargs')
    let parser = yargs().usage(config.usage)
    config.commands.forEach(cmd => {
        const builder = (yargsInstance: any) => {
            let instance = yargsInstance
            if (cmd.options) {
                instance = applyOptionsToYargs(instance, cmd.options, 'option')
            }
            if (cmd.positionals) {
                instance = applyOptionsToYargs(instance, cmd.positionals, 'positional')
            }
            return instance
        }
        parser = parser.command(cmd.command, cmd.description, builder)
    })
    parser = applyOptionsToYargs(parser, config.options, 'option')
    return parser.version(config.version).help('help')
}

/**
 * The launch's own arguments, without Electron's.
 *
 * A packaged build's argv is `[exe, ...args]`. A source build is started as
 * `electron.exe [switches] app [args]`, and Electron takes that first
 * non-switch argument as the app to run: it is not an argument to the app.
 * Left in, it reached the CLI handlers as a directory to open, so every source
 * launch opened a tab in `app/` and brought its window to the front, `--hidden`
 * or not. Switches may come first (`--user-data-dir` has to), so the app path
 * is found by value rather than by position.
 */
function appArguments (argv: string[], cwd: string): string[] {
    const args = argv[0].includes('node') ? argv.slice(2) : argv.slice(1)
    if (!process.defaultApp) {
        return args
    }
    const path = require('path')
    const fold = (p: string): string => process.platform === 'win32' ? p.toLowerCase() : p
    const appPath = fold(path.resolve(app.getAppPath()))
    const index = args.findIndex(arg => !arg.startsWith('-') && fold(path.resolve(cwd, arg)) === appPath)
    return index === -1 ? args : [...args.slice(0, index), ...args.slice(index + 1)]
}

export function parseArgs (argv: string[], cwd: string): any {
    const config = createParserConfig(cwd)
    const parser = createParserFromConfig(config)
    return parser.parse(appArguments(argv, cwd))
}
