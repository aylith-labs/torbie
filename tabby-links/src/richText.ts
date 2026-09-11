// Like the runtime service, this walks JSON a remote server produced. `any` is
// honestly what that is; `unknown` would only move the casts around.
/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
/**
 * Turning a tab's body into something a card can draw.
 *
 * Two formats arrive here, both from a remote server: Atlassian Document Format
 * (a JSON document) and Markdown. Neither is ever converted to HTML — the
 * parser produces plain data that the template renders through interpolation, so
 * there is no sanitising to get wrong and no `innerHTML` anywhere. That matters
 * more than usual: this is a Jira description or a GitHub comment, written by
 * whoever opened the ticket.
 *
 * Everything is capped. A comment thread can be enormous and this is a hover
 * card, not a document viewer.
 */

/** Past this, a body is truncated. A card cannot show more than a screen. */
export const MAX_BODY_CHARS = 4000
/** ADF nests arbitrarily; this stops a pathological document from spinning. */
const MAX_ADF_DEPTH = 24
const MAX_BLOCKS = 120
const MAX_SPANS_PER_BLOCK = 60

export interface InlineSpan {
    text: string
    bold?: boolean
    italic?: boolean
    code?: boolean
    /** Set when the span is a link. */
    href?: string
}

export interface MarkdownBlock {
    language?: string
    kind: 'p' | 'h' | 'li' | 'code' | 'quote'
    /** Heading level, 1-6. */
    level?: number
    /** For `li`: part of a numbered list rather than a bulleted one. */
    ordered?: boolean
    ordinal?: number
    spans: InlineSpan[]
}

function truncate (text: string): string {
    return text.length > MAX_BODY_CHARS ? `${text.slice(0, MAX_BODY_CHARS)}…` : text
}

// ── Atlassian Document Format ───────────────────────────────────────────────

/** Node types whose content is a block and should end with a line break. */
const ADF_BLOCKS = new Set([
    'paragraph', 'heading', 'blockquote', 'codeBlock', 'rule',
    'listItem', 'bulletList', 'orderedList', 'panel', 'mediaGroup', 'mediaSingle',
    'taskList', 'taskItem', 'decisionList', 'decisionItem', 'expand',
])

/**
 * Flatten an ADF document to text.
 *
 * ADF is a tree of typed nodes where only `text` carries characters; everything
 * else is structure. Unknown node types are descended into rather than dropped,
 * because the format grows and a node we have never heard of usually still has
 * readable text underneath it.
 */
export function flattenAdf (node: any, depth = 0, markdown = false): string {
    if (node === null || node === undefined || depth > MAX_ADF_DEPTH) {
        return ''
    }
    if (typeof node === 'string') {
        return node
    }
    if (Array.isArray(node)) {
        return node.map(x => flattenAdf(x, depth + 1, markdown)).join('')
    }
    if (typeof node !== 'object') {
        return ''
    }

    const type = typeof node.type === 'string' ? node.type : ''
    if (type === 'text') {
        const text = typeof node.text === 'string' ? node.text : ''
        if (!markdown || !text) return text
        const marks = Array.isArray(node.marks) ? node.marks.filter(mark => mark && typeof mark === 'object') : []
        if (marks.some(mark => mark.type === 'code')) return '`' + text + '`'
        let styled = text
        if (marks.some(mark => mark.type === 'strong')) styled = `**${styled}**`
        if (marks.some(mark => mark.type === 'em')) styled = `_${styled}_`
        const link = marks.find(mark => mark.type === 'link' && typeof mark.attrs?.href === 'string')
        return link ? `[${styled}](${link.attrs.href})` : styled
    }
    if (type === 'hardBreak') {
        return '\n'
    }
    // These carry their readable form in attrs rather than in a child.
    if (type === 'emoji') {
        return String(node.attrs?.text ?? node.attrs?.shortName ?? '')
    }
    if (type === 'mention') {
        return String(node.attrs?.text ?? '')
    }
    if (type === 'inlineCard' || type === 'blockCard') {
        return String(node.attrs?.url ?? '')
    }
    if (type === 'media') {
        const alt = node.attrs?.alt ?? node.attrs?.id ?? ''
        return alt ? `[${alt}]` : ''
    }
    if (type === 'rule') {
        return '\n———\n'
    }

    if (markdown && (type === 'bulletList' || type === 'orderedList')) {
        const start = Number.isInteger(node.attrs?.order) ? node.attrs.order : 1
        return (Array.isArray(node.content) ? node.content : []).map((item, index) =>
            `${type === 'orderedList' ? `${start + index}.` : '-'} ${flattenAdf(item, depth + 1, true).trim()}\n`).join('') + '\n'
    }
    if (markdown && type === 'codeBlock') {
        const language = String(node.attrs?.language ?? '').replace(/[^\w#+-]/g, '')
        return '```' + language + '\n' + flattenAdf(node.content, depth + 1).trimEnd() + '\n```\n\n'
    }
    const inner = flattenAdf(node.content, depth + 1, markdown)
    if (markdown && type === 'heading') return `${'#'.repeat(Math.max(1, Math.min(6, Number(node.attrs?.level) || 1)))} ${inner}\n\n`
    if (markdown && type === 'blockquote') return inner.trim().split('\n').map(line => `> ${line}`).join('\n') + '\n\n'
    if (type === 'listItem') {
        return markdown ? inner : `• ${inner.trim()}\n`
    }
    if (ADF_BLOCKS.has(type)) {
        return `${inner}${markdown ? '\n\n' : '\n'}`
    }
    return inner
}

/** The whole pipeline for an ADF value: flatten, tidy blank runs, cap. */
export function adfToText (value: any): string {
    const text = flattenAdf(value)
        .replace(/\r/g, '')
        // ADF's block nodes nest, so a paragraph inside a list item inside a
        // list produces a run of newlines that means nothing.
        .replace(/\n{3,}/g, '\n\n')
        .trim()
    return truncate(text)
}

/** Preserve Jira's rich text while keeping the renderer's input as data, never HTML. */
export function adfToMarkdown (value: any): string {
    return truncate(flattenAdf(value, 0, true).replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim())
}

// ── Markdown ────────────────────────────────────────────────────────────────

/**
 * Inline spans within one line: code, bold, italic and links.
 *
 * Deliberately small. This renders a comment in a hover card, not a document —
 * the goal is that `**important**` and `` `--flag` `` read correctly, not that
 * every CommonMark edge case is honoured. Code is matched first, and its
 * contents are never re-scanned, which is what stops `` `a_b_c` `` from
 * sprouting italics.
 */
export function parseInline (line: string): InlineSpan[] {
    const spans: InlineSpan[] = []
    // One pass, alternation ordered so the longest/most specific wins.
    const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*\n]+\*)|(_[^_\n]+_)|(\[[^\]]*\]\([^)\s]+\))|(<https?:\/\/[^>\s]+>)|(https?:\/\/[^\s<>()]+)/g
    let last = 0
    let match: RegExpExecArray | null = null
    while ((match = pattern.exec(line)) !== null) {
        if (spans.length >= MAX_SPANS_PER_BLOCK) {
            break
        }
        if (match.index > last) {
            spans.push({ text: line.slice(last, match.index) })
        }
        const token = match[0]
        if (token.startsWith('`')) {
            spans.push({ text: token.slice(1, -1), code: true })
        } else if (token.startsWith('**') || token.startsWith('__')) {
            spans.push({ text: token.slice(2, -2), bold: true })
        } else if (token.startsWith('[')) {
            const split = token.indexOf('](')
            spans.push({ text: token.slice(1, split), href: token.slice(split + 2, -1) })
        } else if (token.startsWith('<')) {
            const url = token.slice(1, -1)
            spans.push({ text: url, href: url })
        } else if (token.startsWith('http')) {
            spans.push({ text: token, href: token })
        } else {
            spans.push({ text: token.slice(1, -1), italic: true })
        }
        last = match.index + token.length
    }
    if (last < line.length) {
        spans.push({ text: line.slice(last) })
    }
    return spans.length ? spans : [{ text: line }]
}

/**
 * Block structure: headings, list items, fenced code and quotes, with
 * consecutive plain lines joined into a paragraph.
 */
export function parseMarkdown (source: string, maxChars = MAX_BODY_CHARS, maxBlocks = MAX_BLOCKS): MarkdownBlock[] {
    const blocks: MarkdownBlock[] = []
    const lines = source.replace(/\r/g, '').slice(0, maxChars).split('\n')
    let paragraph: string[] = []
    let inFence = false
    let fenceLanguage = ''
    let fence: string[] = []

    const flushParagraph = () => {
        if (paragraph.length) {
            blocks.push({ kind: 'p', spans: parseInline(paragraph.join(' ')) })
            paragraph = []
        }
    }

    for (const line of lines) {
        if (blocks.length >= maxBlocks) {
            break
        }
        if (/^\s*```/.test(line)) {
            if (inFence) {
                blocks.push({ kind: 'code', ...(fenceLanguage ? { language: fenceLanguage } : {}), spans: [{ text: fence.join('\n'), code: true }] })
                fence = []
                inFence = false
            } else {
                flushParagraph()
                inFence = true
                fenceLanguage = line.trim().slice(3).trim().split(/\s/)[0]
            }
            continue
        }
        if (inFence) {
            fence.push(line)
            continue
        }
        const heading = /^(#{1,6})\s+(.*)$/.exec(line)
        if (heading) {
            flushParagraph()
            blocks.push({ kind: 'h', level: heading[1].length, spans: parseInline(heading[2]) })
            continue
        }
        const bullet = /^\s*[-*+]\s+(.*)$/.exec(line)
        if (bullet) {
            flushParagraph()
            blocks.push({ kind: 'li', spans: parseInline(bullet[1]) })
            continue
        }
        const ordered = /^\s*(\d+)[.)]\s+(.*)$/.exec(line)
        if (ordered) {
            flushParagraph()
            blocks.push({ kind: 'li', ordered: true, ordinal: Number(ordered[1]), spans: parseInline(ordered[2]) })
            continue
        }
        const quote = /^\s*>\s?(.*)$/.exec(line)
        if (quote) {
            flushParagraph()
            blocks.push({ kind: 'quote', spans: parseInline(quote[1]) })
            continue
        }
        if (!line.trim()) {
            flushParagraph()
            continue
        }
        paragraph.push(line.trim())
    }
    if (inFence && fence.length) {
        blocks.push({ kind: 'code', ...(fenceLanguage ? { language: fenceLanguage } : {}), spans: [{ text: fence.join('\n'), code: true }] })
    }
    flushParagraph()
    return blocks
}

/** Plain text, capped — for `format: "text"` and as the fallback everywhere. */
export function plainText (value: any): string {
    if (value === null || value === undefined) {
        return ''
    }
    return truncate(String(typeof value === 'object' ? adfToText(value) : value).replace(/\r/g, '').trim())
}
