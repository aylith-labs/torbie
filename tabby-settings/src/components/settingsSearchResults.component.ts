import { Component, Input } from '@angular/core'

import { SettingsSearchComponent } from './settingsSearch.component'

/**
 * The results of the settings search, drawn over the page area while a query
 * is open. The box and its state live in `settings-search`, in the nav; this is
 * only the list, so it can take the page's width rather than the nav's 222px.
 */
@Component({
    standalone: false,
    selector: 'settings-search-results',
    templateUrl: './settingsSearchResults.component.pug',
    styleUrls: ['./settingsSearchResults.component.scss'],
})
export class SettingsSearchResultsComponent {
    @Input() search: SettingsSearchComponent

    trackIndex (index: number): number {
        return index
    }
}
