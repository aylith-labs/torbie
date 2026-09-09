/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import * as shellQuote from 'shell-quote'
import { Component, Input } from '@angular/core'
import { SessionOptions } from '../api'

/** @hidden */
@Component({
    standalone: false,
    selector: 'command-line-editor',
    templateUrl: './commandLineEditor.component.pug',
})
export class CommandLineEditorComponent {
    @Input() argvMode = false
    @Input() _model: SessionOptions
    command = ''

    @Input() get model (): SessionOptions {
        return this._model
    }

    set model (value: SessionOptions) {
        this._model = value
        this.updateCommand()
    }

    switchToCommand () {
        this.updateCommand()
        this.argvMode = false
    }

    switchToArgv () {
        this.argvMode = true
    }

    parseCommand () {
        // Strings only: `shell-quote` parses an operator or a comment to an
        // object, and this editor stores a program and its arguments. An
        // operator was never storable here — the older typing simply called
        // everything a string — so it is dropped rather than stringified into
        // something the profile would then try to execute.
        const args = shellQuote.parse(this.command)
            .filter((entry): entry is string => typeof entry === 'string')
        this.model.command = args[0] ?? ''
        this.model.args = args.slice(1)
    }

    updateCommand () {
        this.command = shellQuote.quote([
            this.model.command,
            ...this.model.args,
        ])
    }

    trackByIndex (index) {
        return index
    }
}
