import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker'
import { Component, ElementRef, EventEmitter, Input, Output, ViewChild } from '@angular/core'
import { TranslatePipe } from '@ngx-translate/core'

import { SelectAllState, selectAllState, selectAllTarget } from '../selectAll'

let nextId = 0

/**
 * A "Select all" checkbox for a group of checkboxes: ticked when every box in
 * the group is, clear when none is, and `indeterminate` in between.
 *
 * It is a real `<input type=checkbox>` with a real `<label>`, so Space toggles
 * it, it sits in the tab order, and a screen reader announces the mixed state
 * from `indeterminate` (which is aria-checked="mixed" without a second source
 * of truth that could disagree with it).
 *
 * It owns no data. The parent says how many of how many are selected and gets
 * back the value to apply to all of them:
 *
 *     select-all-checkbox(
 *         [selected]='onCount', [total]='allCount',
 *         (selectAll)='setAll($event)',
 *     )
 *
 * Standalone, so a plugin imports it into its own module rather than
 * `tabby-core`'s NgModule growing another declaration.
 */
@Component({
    standalone: true,
    selector: 'select-all-checkbox',
    imports: [TranslatePipe],
    template: `
        <div class="form-check select-all-checkbox">
            <input
                #input
                type="checkbox"
                class="form-check-input"
                [id]="id"
                [checked]="state === 'all'"
                [indeterminate]="state === 'mixed'"
                [disabled]="disabled"
                [attr.aria-label]="ariaLabel || null"
                (change)="onChange()"
            >
            <label class="form-check-label" [for]="id">{{ text || (defaultText | translate) }}</label>
        </div>
    `,
    styles: [`
        :host { display: inline-block; }
        .form-check { margin-bottom: 0; white-space: nowrap; }
        .form-check-label { cursor: pointer; }
        .form-check-input:disabled ~ .form-check-label { cursor: default; }
    `],
})
export class SelectAllCheckboxComponent {
    /** How many of the group's boxes are ticked. */
    @Input() selected = 0
    /** How many boxes the group has. */
    @Input() total = 0
    @Input() disabled = false
    /** Visible label; "Select all" when unset. */
    @Input() text = ''
    /** Accessible name when the visible label alone would be ambiguous. */
    @Input() ariaLabel = ''
    /** The value to give every box in the group. */
    @Output() selectAll = new EventEmitter<boolean>()

    @ViewChild('input', { static: true }) input: ElementRef<HTMLInputElement>

    readonly id = `select-all-${++nextId}`
    readonly defaultText = _('Select all')

    get state (): SelectAllState {
        return selectAllState(this.selected, this.total)
    }

    onChange (): void {
        const target = selectAllTarget(this.state)
        // The browser has already flipped the box on its own terms (a mixed box
        // clicked becomes plain checked). Pin it to what the group is about to
        // be, so the box is right even if the parent's counts arrive a change
        // detection later — or never, if it ignores the event.
        const el = this.input.nativeElement
        el.indeterminate = false
        el.checked = target
        this.selectAll.emit(target)
    }
}
