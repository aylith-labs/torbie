import * as fs from 'fs/promises'
import * as path from 'path'
import { load } from 'js-yaml'
import { LinkPreview } from './api'
import { fileTypeOf } from './fileTypes'

export interface SourceToken { text: string, kind: string }
export interface MetadataRow { key: string, value: string, depth: number }
export interface LocalFilePreview { text: string, language: string, markdown: boolean, truncated: boolean }

export function formatFileSize (size: number): string {
    if (size < 1024) return `${size} ${size === 1 ? 'byte' : 'bytes'}`
    return size < 1048576 ? `${(size / 1024).toFixed(1)} KiB` : `${(size / 1048576).toFixed(1)} MiB`
}

export function frontmatter (source: string): { body: string, rows: MetadataRow[], error: string, yaml: string, present: boolean } {
    const result = { body: source, rows: [] as MetadataRow[], error: '', yaml: '', present: false }
    const match = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m.exec(source)
    if (match?.index !== 0) return result
    result.present = true
    result.yaml = match[1]
    result.body = source.slice(match[0].length)
    if (result.yaml.length > 65536) { result.error = 'Frontmatter exceeds the 64 KiB metadata limit. View Raw for the original.'; return result }
    let budget = 200
    const ancestors = new Set<object>()
    const visit = (value: any, key: string, depth: number) => {
        if (!budget--) return
        if (depth >= 12 || (value && typeof value === 'object' && ancestors.has(value))) {
            result.rows.push({ key, value: '[Nested metadata limit reached]', depth }); return
        }
        if (value === null || typeof value !== 'object' || value instanceof Date) {
            result.rows.push({ key, value: value instanceof Date ? value.toISOString() : String(value), depth }); return
        }
        if (key) result.rows.push({ key, value: Object.keys(value).length ? '' : Array.isArray(value) ? '[]' : '{}', depth })
        ancestors.add(value)
        for (const [name, child] of Object.entries(value)) { if (budget <= 0) break; visit(child, Array.isArray(value) ? '•' : name, depth + 1) }
        ancestors.delete(value)
    }
    try { const value = load(result.yaml); if (value !== undefined) visit(value, '', 0) } catch (error) { result.error = `Invalid YAML frontmatter: ${error}` }
    if (budget <= 0) result.rows.push({ key: '', value: '[Metadata truncated to 200 entries]', depth: 0 })
    return result
}

/** Returns text plus color categories, never executable HTML. */
export function highlightSource (source: string, language: string): SourceToken[] {
    const aliases: Record<string, string> = { ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', cs: 'csharp', 'c#': 'csharp', py: 'python', yml: 'yaml', sh: 'bash', shell: 'bash', ps1: 'powershell', pwsh: 'powershell', md: 'markdown' }
    const lang = aliases[language.toLowerCase()] ?? language.toLowerCase()
    if (!['typescript','javascript','csharp','cpp','c','java','rust','go','python','yaml','json','jsonc','bash','powershell','markdown','sql','css','xml'].includes(lang)) return [{ text: source, kind: 'plain' }]
    const hash = ['python','yaml','bash','powershell'].includes(lang)
    const slash = ['typescript','javascript','csharp','cpp','c','java','rust','go','jsonc','css'].includes(lang)
    const keywords = new Set('if else elif for foreach while do switch case break continue return yield throw try catch finally class struct enum interface namespace using import from as export default public private protected internal static const let var auto void int float double bool char string new delete this self def lambda async await function fn pub impl trait match mut use mod package func type defer select in is not and or pass with raise except extends implements readonly true false null True False None undefined nil then fi done echo select from where join on order by group limit create table insert update into values'.split(' '))
    const expression = /\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\n]*|#[^\n]*|--[^\n]*|"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?|`(?:\\.|[^`\\])*`?|\b\d[\w.]*|[$\p{L}_][$\p{L}\p{N}_-]*|[^\S\n]+|[\s\S]/gu
    const tokens: SourceToken[] = []
    let consumed = 0
    for (const match of source.matchAll(expression)) {
        if (tokens.length >= 16000) { tokens.push({ text: source.slice(consumed), kind: 'plain' }); break }
        const text = match[0]
        let kind = 'plain'
        if ((slash && text.startsWith('//')) || ((slash || lang === 'sql') && text.startsWith('/*')) || (hash && text.startsWith('#')) || (lang === 'sql' && text.startsWith('--'))) kind = 'comment'
        else if (/^["'`]/.test(text)) kind = 'string'
        else if (/^\d/.test(text)) kind = 'number'
        else if (keywords.has(lang === 'sql' ? text.toLowerCase() : text)) kind = 'keyword'
        else if (lang === 'markdown' && text.startsWith('#')) kind = 'markup'
        if (['yaml','json','jsonc'].includes(lang) && /^\s*:/.test(source.slice((match.index ?? 0) + text.length)) && /^["'\p{L}_]/u.test(text)) kind = 'key'
        if (tokens.length && tokens[tokens.length - 1].kind === kind) tokens[tokens.length - 1].text += text
        else tokens.push({ text, kind })
        consumed += text.length
    }
    return tokens
}

export async function readLocalPreview (filePath: string): Promise<LinkPreview> {
    const type = fileTypeOf(filePath)
    const preview: LinkPreview = { integrationId: 'file', integrationName: type.name, icon: type.icon, fields: [], groups: [], tabs: [], actions: [], skipped: [], error: '', link: '', html: '', data: {} }
    try {
        const stat = await fs.stat(filePath)
        if (!stat.isFile()) throw new Error('This path is not a regular file.')
        const field = (key: string, value: string, kind: 'title' | 'text') => ({ key, value, kind, label: '', iconUri: key === 'metadata' ? type.icon : '', color: '' })
        preview.fields = [field('filename', path.basename(filePath), 'title'), field('metadata', `${type.name} · ${formatFileSize(stat.size)}`, 'text')]
        preview.groups = [{ key: 'file', label: '', fields: preview.fields }]
        if (stat.size > 50 * 1024 * 1024) throw new Error('File exceeds the 50 MiB preview limit.')
        const file = await fs.open(filePath, 'r')
        let buffer: Buffer
        try { const bytes = Buffer.alloc(Math.min(stat.size, 1024 * 1024)); const read = await file.read(bytes, 0, bytes.length, 0); buffer = bytes.subarray(0, read.bytesRead) } finally { await file.close() }
        let encoding = 'utf-8'
        if (buffer[0] === 0xff && buffer[1] === 0xfe) encoding = 'utf-16le'
        else if (buffer[0] === 0xfe && buffer[1] === 0xff) encoding = 'utf-16be'
        else if (buffer.includes(0)) throw new Error('No text preview for this binary format.')
        // A capped read may end inside a character; streaming decoding omits that incomplete tail.
        const text = new TextDecoder(encoding, { fatal: true }).decode(buffer, { stream: stat.size > buffer.length })
        preview.file = { text, language: type.language, markdown: type.language === 'markdown', truncated: stat.size > buffer.length }
    } catch (error) { preview.error = `${error}`.replace(/^Error:\s*/, '') }
    return preview
}
