import { Component, ElementRef, EventEmitter, Input, NgZone, OnChanges, OnDestroy, AfterViewInit, Output, ViewChild } from '@angular/core'

import { highlightYamlHtml } from '../configView'

/**
 * A textarea with YAML highlighting, and no editor dependency.
 *
 * The textarea is the editor — caret, selection, undo, IME, clipboard all stay
 * the browser's own — with its text painted transparent over a `<pre>` holding
 * the same text in coloured spans. The two share every metric that decides
 * where a character lands (font, size, line height, padding, tab size, no
 * wrapping), and the layer is moved by `transform` rather than by scrolling
 * its own box, because the textarea's scrollbars shorten its viewport and a
 * second scrolling box would drift from it by exactly their width at the end.
 *
 * The HTML is built by `highlightYamlHtml`, which escapes every character of
 * the text, and assigned directly: Angular's sanitiser on `[innerHTML]` would
 * cost a parse per keystroke on a config that can be a few hundred KB.
 */
@Component({
    standalone: false,
    selector: 'yaml-editor',
    templateUrl: './yamlEditor.component.pug',
    styleUrls: ['./yamlEditor.component.scss'],
})
export class YamlEditorComponent implements OnChanges, AfterViewInit, OnDestroy {
    @Input() text = ''
    @Input() readonly = false
    @Output() textChange = new EventEmitter<string>()
    @ViewChild('layer') layer?: ElementRef<HTMLElement>
    @ViewChild('editor') editor?: ElementRef<HTMLTextAreaElement>

    private frame: ReturnType<typeof setTimeout>|null = null
    private painted: string|null = null

    constructor (private zone: NgZone) { }

    ngOnChanges (): void {
        this.schedulePaint()
    }

    ngAfterViewInit (): void {
        this.paint()
    }

    ngOnDestroy (): void {
        if (this.frame !== null) {
            clearTimeout(this.frame)
        }
    }

    onInput (value: string): void {
        this.text = value
        this.textChange.emit(value)
        this.schedulePaint()
    }

    syncScroll (): void {
        const ta = this.editor?.nativeElement
        const layer = this.layer?.nativeElement
        if (ta && layer) {
            layer.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`
        }
    }

    /**
     * One paint per turn of the event loop however many changes arrive in it;
     * outside the zone, since nothing Angular draws changes. A timer rather
     * than requestAnimationFrame, which a window that is not on screen runs
     * about once a second.
     */
    private schedulePaint (): void {
        if (this.frame !== null) {
            return
        }
        this.zone.runOutsideAngular(() => {
            this.frame = setTimeout(() => {
                this.frame = null
                this.paint()
            })
        })
    }

    private paint (): void {
        const layer = this.layer?.nativeElement
        if (!layer) {
            return
        }
        const text = this.text ?? ''
        if (text !== this.painted) {
            // The trailing newline gives a final empty line the height the
            // textarea gives it, so the caret's last line has a layer under it.
            layer.innerHTML = highlightYamlHtml(text) + '\n'
            this.painted = text
        }
        this.syncScroll()
    }
}
