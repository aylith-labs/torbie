import { Component } from '@angular/core'
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker'
import { ConfigService } from 'tabby-core'

_('Search color schemes')

/** @hidden */
@Component({
    standalone: false,
    templateUrl: './colorSchemeSettingsTab.component.pug',
})
export class ColorSchemeSettingsTabComponent {
    /**
     * The page opens on Pair, not on the tab for whichever mode is active.
     *
     * It is the first tab, and a strip of tabs that opens on its second or
     * third reads as a mistake. It is also the one choice that is right in both
     * modes, so the mode the OS happens to be in no longer decides where the
     * page opens. Setting the two halves separately is one click away.
     */
    activeTab = 'pair'

    /**
     * The search, for all three tabs. It lives here rather than in a list
     * because ngbNav destroys a tab's content when another tab is selected, and
     * the query has to outlive that; each list is rebuilt from it on return.
     */
    filter = ''

    constructor (public config: ConfigService) { }
}
