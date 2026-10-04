// The Config file page's two views, as pure logic: a YAML tokenizer for the
// highlighted raw editor, and the tree the structured view draws, annotated
// against the defaults and the fork's own keys. No Angular, no DOM, no js-yaml
// (the component parses), so tabby-settings/test/configView.test.js runs it on
// a clean checkout.
//
// tsconfig targets es2016: no named capture groups, no lookbehind.

// ── Tokenizer ────────────────────────────────────────────────────────────

export type YamlTokenType =
    | 'text'      // whitespace and anything not worth colouring
    | 'key'
    | 'string'
    | 'number'
    | 'boolean'
    | 'null'
    | 'comment'
    | 'punct'     // list dashes, the colon after a key, flow brackets, document markers
    | 'meta'      // anchors, aliases, tags, block scalar indicators

export interface YamlToken {
    type: YamlTokenType
    text: string
}

const NUMBER_RE = /^[-+]?(?:\d[\d_]*(?:\.\d*)?(?:[eE][-+]?\d+)?|\.\d+(?:[eE][-+]?\d+)?|0x[0-9a-fA-F_]+|0o[0-7_]+|0b[01_]+|\.(?:inf|Inf|INF)|\.(?:nan|NaN|NAN))$/
const BOOLEAN_RE = /^(?:true|True|TRUE|false|False|FALSE|yes|Yes|YES|no|No|NO|on|On|ON|off|Off|OFF)$/
const NULL_RE = /^(?:null|Null|NULL|~)$/
// A mapping key: quoted, or plain up to the first `: ` / `:` at end of line.
const KEY_RE = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s'"#\-?:,[\]{}&*!|>%@`][^#]*?|-[^\s#][^#]*?|\?)(\s*)(:)(?=\s|$)/
const BLOCK_SCALAR_RE = /^[|>][-+0-9]*$/

/** What a plain (unquoted) scalar is, the way js-yaml's default schema reads it. */
export function scalarType (text: string): 'number'|'boolean'|'null'|'string' {
    if (NULL_RE.test(text)) {
        return 'null'
    }
    if (BOOLEAN_RE.test(text)) {
        return 'boolean'
    }
    if (NUMBER_RE.test(text)) {
        return 'number'
    }
    return 'string'
}

function indentOf (line: string): number {
    let i = 0
    while (i < line.length && (line[i] === ' ' || line[i] === '\t')) {
        i++
    }
    return i
}

/** Index of a ` #` comment outside quotes, or -1. `start` is where the value begins. */
function commentStart (line: string, start: number): number {
    let quote: string|null = null
    for (let i = start; i < line.length; i++) {
        const c = line[i]
        if (quote) {
            if (quote === '"' && c === '\\') {
                i++
            } else if (c === quote) {
                if (quote === '\'' && line[i + 1] === '\'') {
                    i++
                } else {
                    quote = null
                }
            }
        } else if ((c === '"' || c === '\'') && (i === start || /[\s[{,:]/.test(line[i - 1]))) {
            quote = c
        } else if (c === '#' && (i === start || /\s/.test(line[i - 1]))) {
            return i
        }
    }
    return -1
}

/** Where a double-quoted string opened at `from` closes, or -1 when it runs past the line. */
function closingDoubleQuote (s: string, from: number): number {
    for (let i = from; i < s.length; i++) {
        if (s[i] === '\\') {
            i++
        } else if (s[i] === '"') {
            return i
        }
    }
    return -1
}

function closingSingleQuote (s: string, from: number): number {
    for (let i = from; i < s.length; i++) {
        if (s[i] === '\'') {
            if (s[i + 1] === '\'') {
                i++
            } else {
                return i
            }
        }
    }
    return -1
}

interface TokState {
    /** Inside a `|` / `>` block: lines indented past this are string content. */
    blockIndent: number|null
    /** Inside a quoted scalar that has not closed yet. */
    openQuote: '"'|'\''|null
}

function push (out: YamlToken[], type: YamlTokenType, text: string): void {
    if (!text) {
        return
    }
    const last = out[out.length - 1]
    if (last && last.type === type) {
        last.text += text
    } else {
        out.push({ type, text })
    }
}

/** A value: everything after `key:` or `- `, comment excluded. */
function tokenizeValue (out: YamlToken[], value: string, state: TokState, ownerIndent: number): void {
    const lead = /^\s*/.exec(value)![0]
    push(out, 'text', lead)
    let rest = value.slice(lead.length)
    // Anchors, aliases and tags come first, each followed by space.
    for (;;) {
        const m = /^([&*!][^\s,[\]{}]*)(\s*)/.exec(rest)
        if (!m?.[1]) {
            break
        }
        push(out, 'meta', m[1])
        push(out, 'text', m[2])
        rest = rest.slice(m[0].length)
    }
    const trimmed = rest.replace(/\s+$/, '')
    const trailing = rest.slice(trimmed.length)
    if (!trimmed) {
        push(out, 'text', rest)
        return
    }
    if (BLOCK_SCALAR_RE.test(trimmed)) {
        push(out, 'meta', trimmed)
        push(out, 'text', trailing)
        state.blockIndent = ownerIndent
        return
    }
    if (trimmed[0] === '"' || trimmed[0] === '\'') {
        const end = trimmed[0] === '"' ? closingDoubleQuote(trimmed, 1) : closingSingleQuote(trimmed, 1)
        if (end === -1) {
            push(out, 'string', rest)
            state.openQuote = trimmed[0] as '"'|'\''
            return
        }
        push(out, 'string', trimmed.slice(0, end + 1))
        push(out, 'text', trimmed.slice(end + 1) + trailing)
        return
    }
    if (trimmed[0] === '[' || trimmed[0] === '{') {
        tokenizeFlow(out, trimmed)
        push(out, 'text', trailing)
        return
    }
    const type = scalarType(trimmed)
    push(out, type, trimmed)
    push(out, 'text', trailing)
}

/** `[a, b]` / `{k: v}` on one line: brackets and commas are punctuation, the rest scalars. */
function tokenizeFlow (out: YamlToken[], s: string): void {
    let i = 0
    while (i < s.length) {
        const c = s[i]
        if ('[]{},'.includes(c)) {
            push(out, 'punct', c)
            i++
        } else if (c === ' ' || c === '\t') {
            push(out, 'text', c)
            i++
        } else if (c === '"' || c === '\'') {
            const end = c === '"' ? closingDoubleQuote(s, i + 1) : closingSingleQuote(s, i + 1)
            const stop = end === -1 ? s.length : end + 1
            push(out, 'string', s.slice(i, stop))
            i = stop
        } else {
            let j = i
            while (j < s.length && !'[]{},'.includes(s[j])) {
                j++
            }
            const chunk = s.slice(i, j)
            const kv = /^([^:]*?)(\s*:)(\s|$)/.exec(chunk)
            if (kv?.[1]) {
                push(out, 'key', kv[1])
                push(out, 'punct', kv[2])
                const rest = chunk.slice(kv[1].length + kv[2].length)
                const lead = /^\s*/.exec(rest)![0]
                push(out, 'text', lead)
                const v = rest.slice(lead.length)
                const vt = v.replace(/\s+$/, '')
                if (vt) {
                    push(out, scalarType(vt), vt)
                }
                push(out, 'text', v.slice(vt.length))
            } else {
                const t = chunk.replace(/\s+$/, '')
                if (t) {
                    push(out, scalarType(t), t)
                }
                push(out, 'text', chunk.slice(t.length))
            }
            i = j
        }
    }
}

function tokenizeLine (out: YamlToken[], line: string, state: TokState): void {
    const indent = indentOf(line)

    if (state.openQuote) {
        push(out, 'text', line.slice(0, indent))
        const close = state.openQuote === '"' ? closingDoubleQuote(line, indent) : closingSingleQuote(line, indent)
        if (close === -1) {
            push(out, 'string', line.slice(indent))
            return
        }
        push(out, 'string', line.slice(indent, close + 1))
        state.openQuote = null
        const rest = line.slice(close + 1)
        const hash = commentStart(rest, 0)
        if (hash === -1) {
            push(out, 'text', rest)
        } else {
            push(out, 'text', rest.slice(0, hash))
            push(out, 'comment', rest.slice(hash))
        }
        return
    }

    if (state.blockIndent !== null) {
        if (line.trim() === '' || indent > state.blockIndent) {
            push(out, 'text', line.slice(0, Math.min(indent, line.length)))
            push(out, 'string', line.slice(indent))
            return
        }
        state.blockIndent = null
    }

    push(out, 'text', line.slice(0, indent))
    let pos = indent
    let ownerIndent = indent

    if (line[pos] === '#') {
        push(out, 'comment', line.slice(pos))
        return
    }
    if (pos === 0 && /^(?:---|\.\.\.)(?=\s|$)/.test(line)) {
        push(out, 'punct', line.slice(0, 3))
        pos = 3
        const rest = line.slice(pos)
        const hash = commentStart(rest, 0)
        if (hash === -1) {
            tokenizeValue(out, rest, state, -1)
        } else {
            tokenizeValue(out, rest.slice(0, hash), state, -1)
            push(out, 'comment', rest.slice(hash))
        }
        return
    }

    // `- ` dashes, possibly several (`- - x`). Each one is an owner of what follows.
    for (;;) {
        const m = /^-(\s+|$)/.exec(line.slice(pos))
        if (!m) {
            break
        }
        ownerIndent = pos
        push(out, 'punct', '-')
        push(out, 'text', m[1])
        pos += m[0].length
    }

    const rest = line.slice(pos)
    const hash = commentStart(rest, 0)
    const body = hash === -1 ? rest : rest.slice(0, hash)
    const comment = hash === -1 ? '' : rest.slice(hash)

    const km = KEY_RE.exec(body)
    if (km) {
        // A key after a dash belongs to the dash's item, so block content is
        // indented past the key, which sits where the dash's content starts.
        ownerIndent = pos
        push(out, 'key', km[1])
        push(out, 'text', km[2])
        push(out, 'punct', km[3])
        tokenizeValue(out, body.slice(km[0].length), state, ownerIndent)
    } else {
        tokenizeValue(out, body, state, ownerIndent)
    }
    push(out, 'comment', comment)
}

/**
 * Tokens for a YAML document. Concatenating every token's text gives back the
 * input exactly — the highlighted layer sits under the textarea character for
 * character, so anything else would misalign the caret.
 */
export function tokenizeYaml (text: string): YamlToken[] {
    const out: YamlToken[] = []
    const state: TokState = { blockIndent: null, openQuote: null }
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i]
        let cr = ''
        if (line.endsWith('\r')) {
            cr = '\r'
            line = line.slice(0, -1)
        }
        tokenizeLine(out, line, state)
        push(out, 'text', cr + (i < lines.length - 1 ? '\n' : ''))
    }
    return out
}

export function escapeHtml (s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** The highlighted layer as one HTML string: `<span class="y-key">…</span>`, everything escaped. */
export function highlightYamlHtml (text: string): string {
    let html = ''
    for (const t of tokenizeYaml(text)) {
        html += t.type === 'text' ? escapeHtml(t.text) : `<span class="y-${t.type}">${escapeHtml(t.text)}</span>`
    }
    return html
}

// ── Tree ─────────────────────────────────────────────────────────────────

export type ConfigValueType = 'map'|'list'|'string'|'number'|'boolean'|'null'|'other'

/**
 * How a value stands against the defaults. Only asked where the defaults have
 * a map to look in: a profile in a list has no default to differ from, and
 * calling every one "not in the defaults" would be noise.
 */
export type ConfigDiff = 'same'|'changed'|'added'

export interface ConfigNode {
    /** The key, or `[3]` for a list item. */
    label: string
    /** `terminal.font`, `profiles[2].name`. Unique; the expand state is keyed on it. */
    path: string
    depth: number
    type: ConfigValueType
    /** The value itself, for a scalar. */
    value?: any
    children: ConfigNode[]
    /** For a list item that is a map: its `name` or `id`, so a collapsed profile says which. */
    hint?: string
    diff?: ConfigDiff
    /** Stringified default, when `diff` is `changed`. */
    defaultText?: string
    /** Descendant values that differ from or are absent in the defaults. */
    changedCount: number
    /** Upstream Tabby has no such key; only the topmost fork key in a branch is marked. */
    forkAdded: boolean
    /** Why a key upstream gives no control is worth knowing about. */
    configOnlyNote?: string
}

export interface ConfigMarks {
    forkAdded?: string[]
    configOnly?: { key: string, why: string }[]
}

export function valueType (v: any): ConfigValueType {
    if (v === null || v === undefined) {
        return 'null'
    }
    if (Array.isArray(v)) {
        return 'list'
    }
    switch (typeof v) {
        case 'string': return 'string'
        case 'number': return 'number'
        case 'boolean': return 'boolean'
        case 'object': return v instanceof Date ? 'string' : 'map'
        default: return 'other'
    }
}

export function deepEqual (a: any, b: any): boolean {
    if (a === b) {
        return true
    }
    if (a instanceof Date && b instanceof Date) {
        return a.getTime() === b.getTime()
    }
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
        return false
    }
    if (Array.isArray(a) !== Array.isArray(b)) {
        return false
    }
    const ka = Object.keys(a)
    const kb = Object.keys(b)
    if (ka.length !== kb.length) {
        return false
    }
    return ka.every(k => Object.hasOwn(b, k) && deepEqual(a[k], b[k]))
}

/** A value in one line, for a default or a collapsed preview. */
export function inlineValue (v: any, max = 80): string {
    let s: string
    if (v === undefined) {
        s = 'undefined'
    } else if (typeof v === 'string') {
        s = JSON.stringify(v)
    } else if (v instanceof Date) {
        s = v.toISOString()
    } else {
        try {
            s = JSON.stringify(v) ?? String(v)
        } catch {
            s = String(v)
        }
    }
    return s.length > max ? s.slice(0, max - 1) + '…' : s
}

const isMap = (v: any): boolean => valueType(v) === 'map'

/**
 * The parsed config as a tree. `defaults` is `ConfigService.getDefaults()`;
 * pass null to draw a tree with no comparison (the defaults themselves).
 */
export function buildConfigTree (value: any, defaults: any, marks: ConfigMarks = {}): ConfigNode[] {
    const fork = new Set(marks.forkAdded ?? [])
    const configOnly = new Map((marks.configOnly ?? []).map(e => [e.key, e.why]))

    function build (label: string, path: string, keyPath: string|null, v: any, depth: number, def: { has: boolean, value: any }|null, parentFork: boolean): ConfigNode {
        const type = valueType(v)
        const node: ConfigNode = { label, path, depth, type, children: [], changedCount: 0, forkAdded: false }
        if (keyPath !== null) {
            const isFork = fork.has(keyPath)
            node.forkAdded = isFork && !parentFork
            parentFork = parentFork || isFork
            const why = configOnly.get(keyPath)
            if (why) {
                node.configOnlyNote = why
            }
        }

        if (def) {
            if (!def.has) {
                node.diff = 'added'
            } else if (type !== 'map' || !isMap(def.value)) {
                node.diff = deepEqual(v, def.value) ? 'same' : 'changed'
                if (node.diff === 'changed') {
                    node.defaultText = inlineValue(def.value, 120)
                }
            }
        }

        if (type === 'map') {
            const defMap = def?.has && isMap(def.value) ? def.value : null
            for (const k of Object.keys(v)) {
                const childDef = defMap ? { has: Object.hasOwn(defMap, k), value: defMap[k] } : null
                const childKeyPath = keyPath === null ? null : keyPath ? `${keyPath}.${k}` : k
                node.children.push(build(k, path ? `${path}.${k}` : k, childKeyPath, v[k], depth + 1, childDef, parentFork))
            }
        } else if (type === 'list') {
            v.forEach((item: any, i: number) => {
                const child = build(`[${i}]`, `${path}[${i}]`, null, item, depth + 1, null, parentFork)
                if (isMap(item)) {
                    const h = item.name ?? item.id ?? item.type
                    if (typeof h === 'string' || typeof h === 'number') {
                        child.hint = String(h)
                    }
                }
                node.children.push(child)
            })
        } else {
            node.value = v
        }

        // A changed leaf counts once; a branch counts what changed inside it,
        // or once if it is wholly absent from the defaults.
        for (const c of node.children) {
            const own = c.diff === 'changed' || c.diff === 'added'
            node.changedCount += c.changedCount || (own ? 1 : 0)
        }
        return node
    }

    const root = build('', '', '', value, -1, defaults === null || defaults === undefined ? null : { has: true, value: defaults }, false)
    if (root.type !== 'map' && root.type !== 'list') {
        return [root]
    }
    return root.children
}

/** "12 keys", "1 item". */
export function countLabel (node: ConfigNode): string {
    const n = node.children.length
    if (node.type === 'list') {
        return n === 1 ? '1 item' : `${n} items`
    }
    return n === 1 ? '1 key' : `${n} keys`
}

export const LONG_VALUE_CHARS = 100

/** A string too long, or too many lines, to draw in full on its row. */
export function isLongValue (v: any): boolean {
    return typeof v === 'string' && (v.length > LONG_VALUE_CHARS || v.includes('\n'))
}

/** The first line of a long string, cut to fit, and what was left out. */
export function previewValue (v: string): { text: string, detail: string } {
    const lines = v.split('\n')
    let first = lines[0]
    if (first.length > LONG_VALUE_CHARS) {
        first = first.slice(0, LONG_VALUE_CHARS)
    }
    const parts = [`${v.length} chars`]
    if (lines.length > 1) {
        parts.push(`${lines.length} lines`)
    }
    return { text: first + '…', detail: parts.join(', ') }
}

/** Every path that has children: what Expand all opens. */
export function containerPaths (nodes: ConfigNode[], out: string[] = []): string[] {
    for (const n of nodes) {
        if (n.children.length) {
            out.push(n.path)
            containerPaths(n.children, out)
        }
    }
    return out
}

export interface ConfigRow {
    node: ConfigNode
    expanded: boolean
    /** Whether this row is itself a filter match, rather than shown as the way to one. */
    matched: boolean
}

/**
 * Does the filter find this node by its own name? A term with a dot is
 * matched against the whole path (`terminal.font`); a bare term against the
 * node's own key and a scalar's value, so `font` does not also match every
 * descendant of a key that happens to contain it.
 */
export function nodeMatches (node: ConfigNode, query: string): boolean {
    const q = query.trim().toLowerCase()
    if (!q) {
        return true
    }
    if (q.includes('.') || q.includes('[')) {
        if (node.path.toLowerCase().includes(q)) {
            return true
        }
    }
    if (node.label.toLowerCase().includes(q)) {
        return true
    }
    if (node.hint?.toLowerCase().includes(q)) {
        return true
    }
    if (node.children.length === 0 && node.type !== 'map' && node.type !== 'list') {
        return String(node.value).toLowerCase().includes(q)
    }
    return false
}

/**
 * The rows to draw. Without a filter, a node's children show when it is
 * expanded. With one, only matches and the ancestors leading to them show,
 * those ancestors open regardless; a match's own children still follow
 * `expanded`, so the user can look inside one. `collapsed` is what the user
 * shut while filtering: it beats the filter's hold, or a chevron on a branch
 * the filter opened would do nothing.
 */
export function flattenTree (nodes: ConfigNode[], expanded: Set<string>, query = '', collapsed: Set<string> = new Set()): ConfigRow[] {
    const rows: ConfigRow[] = []
    const q = query.trim()

    if (!q) {
        const walk = (list: ConfigNode[]) => {
            for (const n of list) {
                const open = n.children.length > 0 && expanded.has(n.path)
                rows.push({ node: n, expanded: open, matched: false })
                if (open) {
                    walk(n.children)
                }
            }
        }
        walk(nodes)
        return rows
    }

    // Post-order: does this subtree hold a match?
    const holds = new Map<ConfigNode, boolean>()
    const mark = (n: ConfigNode): boolean => {
        let any = nodeMatches(n, q)
        for (const c of n.children) {
            any = mark(c) || any
        }
        holds.set(n, any)
        return any
    }
    nodes.forEach(mark)

    // `showAll`: an ancestor that matched was opened by hand, so everything
    // under it shows, not only the way to further matches.
    const walk = (list: ConfigNode[], showAll: boolean) => {
        for (const n of list) {
            if (!showAll && !holds.get(n)) {
                continue
            }
            const self = nodeMatches(n, q)
            const userOpen = expanded.has(n.path)
            const leads = n.children.some(c => holds.get(c))
            const open = n.children.length > 0 && !collapsed.has(n.path) && (userOpen || leads)
            rows.push({ node: n, expanded: open, matched: self })
            if (open) {
                walk(n.children, userOpen && (self || showAll))
            }
        }
    }
    walk(nodes, false)
    return rows
}

export type ConfigFileView = 'structured'|'raw'

export const CONFIG_VIEW_STORAGE_KEY = 'configFileView'

export function parseStoredView (v: string|null|undefined): ConfigFileView {
    return v === 'raw' ? 'raw' : 'structured'
}
