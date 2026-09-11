import { Injectable } from '@angular/core'
import { ConfigService } from 'tabby-core'
import type { BaseTerminalTabComponent } from 'tabby-terminal'
import type { InlineSpan, MarkdownBlock } from '../richText'
import { MAX_TEXT_INPUT } from '../regexGuard'
import { pathPatterns } from '../pathPatterns'
import { LinkRulesService } from './linkRules.service'

/** Bridge into the buffer's existing hover controller, without a component cycle. */
@Injectable({ providedIn: 'root' })
export class EmbeddedLinksService {
    show?: (anchor: HTMLElement, text: string, tab: BaseTerminalTabComponent<any>, depth: number) => () => void
    open?: (text: string, tab: BaseTerminalTabComponent<any>) => void

    constructor (private config: ConfigService, private rules: LinkRulesService) { }

    enabled (pane: boolean, depth: number): boolean {
        return this.rules.enabled && depth < 4 && (pane || this.config.store.linkTooltip.nested === true)
    }

    decorate (blocks: MarkdownBlock[]): MarkdownBlock[] {
        return blocks.map(block => ({
            ...block,
            spans: block.kind === 'code' ? block.spans : this.spans(block.spans),
            rows: block.rows?.map(row => row.map(cell => this.spans(cell))),
            children: block.children ? this.decorate(block.children) : undefined,
        }))
    }

    private spans (spans: InlineSpan[]): InlineSpan[] {
        return spans.flatMap(span => {
            if (span.href || span.code) return [span]
            const matches: { start: number, end: number, text: string, priority: number }[] = []
            const add = (start: number, text: string, priority: number) => {
                if (text) matches.push({ start, end: start + text.length, text, priority })
            }
            for (const { search } of this.rules.textRules()) {
                for (let offset = 0; offset < Math.min(span.text.length, 20000); offset += MAX_TEXT_INPUT - 128) {
                    for (const match of search?.execAll(span.text.slice(offset, offset + MAX_TEXT_INPUT)) ?? []) add(offset + match.index, match[0], 1)
                }
            }
            for (const pattern of ['\\b(?:https?|ftp|file)://[^\\s<>"\u0027`]+', pathPatterns.windows, pathPatterns.posix]) {
                let count = 0
                for (const match of span.text.slice(0, 20000).matchAll(new RegExp(pattern, 'g'))) {
                    if (++count > 64) break
                    add(match.index!, match[0], 2)
                }
            }
            matches.sort((a, b) => a.start - b.start || b.priority - a.priority || b.end - a.end)
            const out: InlineSpan[] = []
            let at = 0
            for (const match of matches) {
                if (match.start < at) continue
                if (match.start > at) out.push({ ...span, text: span.text.slice(at, match.start) })
                out.push({ ...span, text: match.text, href: match.text })
                at = match.end
            }
            if (at < span.text.length) out.push({ ...span, text: span.text.slice(at) })
            return out
        })
    }
}
