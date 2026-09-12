import {Component,Injectable,NgModule} from '@angular/core';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import CoreModule,{ConfigService} from 'tabby-core';
import {pluginCatalogue} from './catalogue';
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
 <h3>Plugins <span class="badge bg-secondary">{{catalogue.length + 1}}</span></h3><p class="text-muted">Explore Torbie’s built-in plugins and supported integrations.</p>
 <div class="card"><div class="card-body d-flex align-items-center gap-3">
 <img src="../scenario-logos/claude.svg" alt="" width="28" height="28" style="filter:var(--demo-logo-filter,none)"><div class="flex-grow-1"><strong>Claude Code</strong><div class="text-muted">Session awareness, context usage and a dockable panel.</div></div>
 <button class="btn btn-secondary" role="switch" [attr.aria-checked]="state.enabled" (click)="toggle()">{{state.enabled ? 'Disable' : 'Enable'}} Claude Code</button>
 </div></div><p class="small text-muted mt-3">Claude Code is interactive here with demo sessions. Plugins marked Desktop are available in the installed app.</p><div class="plugin-catalogue"><article class="card" *ngFor="let item of catalogue"><div class="card-body"><div class="d-flex align-items-center gap-2"><i class="fas fa-fw" [ngClass]="'fa-'+item.icon" aria-hidden="true"></i><strong>{{item.name}}</strong></div><small class="text-muted d-block mt-2">{{item.scope}}</small><details class="mt-2"><summary>Details</summary><p class="small mt-2">{{item.description}}</p><a [href]="pluginURL(item)" target="_blank" rel="noopener noreferrer">{{item.external ? 'Plugin package' : 'Source & documentation'}} ↗</a></details></div></article></div>`,styles:[`.plugin-catalogue{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(230px,100%),1fr));gap:12px}.plugin-catalogue .card-body{padding:16px}.plugin-catalogue summary{cursor:pointer;font-size:12px}`]})
class DemoPluginsComponent{state=pluginState;catalogue=pluginCatalogue;pluginURL(item:any){return item.external?'https://www.npmjs.com/package/'+item.id:'https://github.com/aylith-labs/torbie/tree/main/'+item.id}constructor(private config:ConfigService){}toggle(){void enableClaude(this.config,!this.state.enabled)}}
@Injectable()
class DemoPluginSettings extends SettingsTabProvider{id='demo-plugins';icon='puzzle-piece';title='Plugins';group='plugins';getComponentType(){return DemoPluginsComponent}}
@NgModule({imports:[CoreModule,CommonModule,FormsModule,ClaudeModule],declarations:[DemoPluginsComponent],providers:[{provide:SettingsTabProvider,useClass:DemoPluginSettings,multi:true}]})
export class DemoPluginModule{}
