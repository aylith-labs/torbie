import {Component,Injectable,NgModule} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import CoreModule,{ConfigService} from 'tabby-core';
import {SettingsTabProvider} from 'tabby-settings';
import ClaudeModule from 'tabby-claude';
import {ClaudeSidePanelProvider} from '../../tabby-claude/src/providers';
export const pluginState={enabled:false};
ClaudeSidePanelProvider.prototype.isAvailable=()=>pluginState.enabled;
export async function enableClaude(config:ConfigService,enabled:boolean){
 pluginState.enabled=enabled;config.store.claude.hover.enabled=enabled;
 config.store.sidePanel.enabled=enabled;config.store.sidePanel.activePanel='claude';config.store.sidePanel.side=innerWidth<700?'bottom':'right';config.store.sidePanel.size=innerWidth<700?250:310;
 await config.save();window.parent.postMessage({type:'torbie-demo-plugin',enabled},location.origin);
}
@Component({standalone:false,selector:'demo-plugins',template:`
 <h3>Plugins</h3><p class="text-muted">Try an included plugin in this browser demo.</p>
 <div class="card"><div class="card-body d-flex align-items-center gap-3">
 <i class="fas fa-robot fa-2x" aria-hidden="true"></i><div class="flex-grow-1"><strong>Claude Code</strong><div class="text-muted">Session awareness, context usage and a dockable panel.</div></div>
 <button class="btn btn-secondary" role="switch" [attr.aria-checked]="state.enabled" (click)="toggle()">{{state.enabled ? 'Disable' : 'Enable'}} Claude Code</button>
 </div></div><p class="small text-muted mt-3">The panel is Torbie’s actual Claude Code plugin. Its sessions and usage are seeded demo data.</p>`})
class DemoPluginsComponent{state=pluginState;constructor(private config:ConfigService){}toggle(){void enableClaude(this.config,!this.state.enabled)}}
@Injectable()
class DemoPluginSettings extends SettingsTabProvider{id='demo-plugins';icon='puzzle-piece';title='Plugins';group='plugins';getComponentType(){return DemoPluginsComponent}}
@NgModule({imports:[CoreModule,CommonModule,FormsModule,ClaudeModule],declarations:[DemoPluginsComponent],providers:[{provide:SettingsTabProvider,useClass:DemoPluginSettings,multi:true}]})
export class DemoPluginModule{}
