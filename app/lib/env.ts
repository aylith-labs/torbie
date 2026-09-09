/**
 * `TABBY_*` and `TORBIE_*` name the same thing.
 *
 * The old prefix is documented (HACKING.md), used by every test and script in
 * this repo, and — this is the part that matters — is already sitting in
 * people's shell profiles, launch scripts and Windows shortcuts. Renaming it
 * outright would break those silently: an unset variable is not an error, it is
 * a default.
 *
 * So neither prefix is retired. Every variable under one is mirrored to the
 * other before anything reads either, which means a caller can use whichever
 * name it likes and code can go on reading the name it already reads. One pass
 * over `process.env` at startup, rather than a `??` at each of forty sites that
 * would each have to be remembered.
 *
 * Exported into child processes as a side effect of being on `process.env`, so
 * a shell opened inside the app sees both spellings too.
 */
const PREFIXES: [string, string][] = [
    ['TABBY_', 'TORBIE_'],
    ['TORBIE_', 'TABBY_'],
]

export function syncEnvAliases (): void {
    // A snapshot: assigning into `process.env` while iterating it would have
    // the second pass read the aliases the first one just wrote.
    const entries = Object.entries(process.env)
    for (const [from, to] of PREFIXES) {
        for (const [key, value] of entries) {
            if (value === undefined || !key.startsWith(from)) {
                continue
            }
            const alias = to + key.slice(from.length)
            if (process.env[alias] === undefined) {
                process.env[alias] = value
            }
        }
    }
}
