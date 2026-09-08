import deepClone from 'clone-deep'
import { Injectable, EnvironmentInjector, createComponent } from '@angular/core'
import { BaseTabComponent } from '../components/baseTab.component'
import { TabRecoveryService } from './tabRecovery.service'

export interface TabComponentType<T extends BaseTabComponent> {
    // eslint-disable-next-line @typescript-eslint/prefer-function-type
    new (...args: any[]): T
}

export interface NewTabParameters<T extends BaseTabComponent> {
    /**
     * Component type to be instantiated
     */
    type: TabComponentType<T>

    /**
     * Component instance inputs
     */
    inputs?: Record<string, any>
}

@Injectable({ providedIn: 'root' })
export class TabsService {
    /** @hidden */
    private constructor (
        private injector: EnvironmentInjector,
        private tabRecovery: TabRecoveryService,
    ) { }

    /**
     * Instantiates a tab component and assigns given inputs
     */
    create <T extends BaseTabComponent> (params: NewTabParameters<T>): T {
        // `ComponentFactoryResolver` was removed in Angular 22. The standalone
        // `createComponent` replaces it and wants an `EnvironmentInjector`, which
        // is what a root-provided service's own injector already is.
        const componentRef = createComponent(params.type, { environmentInjector: this.injector })
        const tab = componentRef.instance
        tab.hostView = componentRef.hostView
        tab.destroyed$.subscribe(() => componentRef.destroy())
        Object.assign(tab, params.inputs ?? {})
        return tab
    }

    /**
     * Duplicates an existing tab instance (using the tab recovery system)
     */
    async duplicate (tab: BaseTabComponent): Promise<BaseTabComponent|null> {
        const token = await this.tabRecovery.getFullRecoveryToken(tab)
        if (!token) {
            return null
        }
        const dup = await this.tabRecovery.recoverTab(deepClone(token))
        if (dup) {
            return this.create(dup)
        }
        return null
    }
}
