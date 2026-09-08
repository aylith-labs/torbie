import { Component } from '@angular/core'
import { NG_VALUE_ACCESSOR } from '@angular/forms'
import { CheckboxComponent } from './checkbox.component'

/** @hidden */
@Component({
    standalone: false,
    selector: 'toggle',
    template: `
    <div class="form-check form-switch">
      <input type="checkbox" class="form-check-input" [(ngModel)]='model'>
      <label class="cform-check-label"></label>
    </div>
    `,
    styleUrls: ['./toggle.component.scss'],
    providers: [
        // biome-ignore lint/correctness/noInvalidUseBeforeDeclaration: the decorator factory runs after the class binding exists — this is Angular's own ControlValueAccessor registration
        { provide: NG_VALUE_ACCESSOR, useExisting: ToggleComponent, multi: true },
    ],
})
export class ToggleComponent extends CheckboxComponent {
}
