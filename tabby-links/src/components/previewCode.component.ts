import { AfterViewInit, ChangeDetectorRef, Component, ElementRef, Input, OnChanges, OnDestroy, ViewChild } from '@angular/core'
import { PlatformService } from 'tabby-core'
import { highlightSource, SourceToken } from '../filePreview'

@Component({
    standalone: false,
    selector: 'preview-code',
    template: `
        <pre #viewport [class.wrapped]="wrapped"><code #code><span *ngFor="let token of tokens" [class]="'syntax-' + token.kind">{{token.text}}</span></code></pre>
        <div class="actions">
            <button *ngIf="overflow" (click)="wrapped = !wrapped" [attr.aria-pressed]="wrapped" [title]="wrapped ? 'Turn off wrap' : 'Turn on wrap'" aria-label="Wrap code"><i class="fas fa-align-left"></i></button>
            <button (click)="copy()" title="Copy code" aria-label="Copy code"><i class="far fa-copy"></i></button>
        </div>`,
    styles: [`
        :host { display: block; position: relative; min-width: 0; margin: 8px 0; border: 1px solid #80808050; border-radius: 5px; background: #80808016; }
        pre { margin: 0; padding: 12px; overflow: auto; color: inherit; font: 13px/1.5 monospace; white-space: pre; }
        code { display: inline-block; font: inherit; color: inherit; padding: 0; background: none; }
        pre.wrapped { white-space: pre-wrap; overflow-wrap: anywhere; }
        pre.wrapped code { display: block; }
        .actions { position: absolute; right: 6px; top: 6px; display: flex; gap: 4px; opacity: 0; pointer-events: none; }
        :host:hover .actions, :host:focus-within .actions { opacity: 1; pointer-events: auto; }
        button { color: inherit; background: var(--theme-bg, #444); border: 1px solid #80808080; border-radius: 4px; padding: 5px 8px; cursor: pointer; }
        .syntax-keyword { color: #b77bd0; } .syntax-string { color: #bd7455; } .syntax-number { color: #669c7b; }
        .syntax-comment { color: #729455; } .syntax-key { color: #558fb7; } .syntax-markup { color: #739cc0; }
        @media (forced-colors: active) { span { color: CanvasText !important; } }
    `],
})
export class PreviewCodeComponent implements OnChanges, AfterViewInit, OnDestroy {
    @Input() text = ''
    @Input() language = ''
    @ViewChild('viewport') viewport?: ElementRef<HTMLElement>
    @ViewChild('code') code?: ElementRef<HTMLElement>
    tokens: SourceToken[] = []
    wrapped = false
    overflow = false
    private naturalWidth = 0
    private observer?: ResizeObserver

    constructor (private platform: PlatformService, private changes: ChangeDetectorRef) { }

    ngOnChanges (): void {
        this.tokens = highlightSource(this.text, this.language)
        this.wrapped = false
    }

    ngAfterViewInit (): void {
        this.observer = new ResizeObserver(() => {
            if (!this.wrapped) this.naturalWidth = this.code?.nativeElement.getBoundingClientRect().width ?? 0
            const next = this.naturalWidth > (this.viewport?.nativeElement.clientWidth ?? 0) - 24 + 1
            if (this.overflow !== next) { this.overflow = next; this.changes.detectChanges() }
        })
        if (this.viewport) this.observer.observe(this.viewport.nativeElement)
        if (this.code) this.observer.observe(this.code.nativeElement)
    }

    copy (): void { this.platform.setClipboard({ text: this.text }) }
    ngOnDestroy (): void { this.observer?.disconnect() }
}
