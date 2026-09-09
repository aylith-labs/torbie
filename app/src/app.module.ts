/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
import { ApplicationRef, NgModule, provideZoneChangeDetection } from '@angular/core'
import { BrowserModule } from '@angular/platform-browser'
import { ToastrModule } from 'ngx-toastr'

export function getRootModule (plugins: any[]) {
    const imports = [
        BrowserModule,
        ...plugins,
        ToastrModule.forRoot({
            positionClass: 'toast-bottom-center',
            toastClass: 'toast',
            preventDuplicates: true,
            extendedTimeOut: 1000,
        }),
    ]

    const bootstrap = [
        ...plugins.filter(x => x.bootstrap).map(x => x.bootstrap),
    ]

    if (bootstrap.length === 0) {
        throw new Error('Did not find any bootstrap components. Are there any plugins installed?')
    }

    @NgModule({
        imports,
        providers: [
            // Angular 22 defaults to **zoneless**, and the old
            // `bootstrapModule(m, { ngZone: 'zone.js' })` option no longer
            // exists — `BootstrapOptions` has no `ngZone` field, so passing it
            // is silently ignored rather than rejected. Without this the app
            // gets a `NoopNgZone`: it bootstraps, the component tree is built,
            // and then nothing ever schedules a change-detection pass, so the
            // DOM under `app-root` stays at a single element.
            //
            // This whole codebase is written for zone-based change detection —
            // no signals, no `markForCheck` discipline, and a great deal of
            // state mutated from xterm callbacks and IPC handlers. Going
            // zoneless is a real migration, not a flag; until then it is
            // requested explicitly.
            provideZoneChangeDetection(),
        ],
    }) class RootModule {
        ngDoBootstrap (appRef: ApplicationRef) {
            (window as any)['requestAnimationFrame'] = window[window['Zone'].__symbol__('requestAnimationFrame')]

            const componentDef = bootstrap[0]
            appRef.bootstrap(componentDef)
        }
    }

    return RootModule
}
