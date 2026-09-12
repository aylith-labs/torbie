import 'zone.js';
import {load as loadYaml} from 'js-yaml';
Object.assign(window,{setImmediate:setTimeout,clearImmediate:clearTimeout,pluginModules:[]});
import 'core-js/proposals/reflect-metadata';
import '@angular/compiler';
import {Component,Injector,NgModule,enableProdMode} from '@angular/core';
import {platformBrowserDynamic} from '@angular/platform-browser-dynamic';
import {take} from 'rxjs';
import {CommonModule} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {NgbModule} from '@ng-bootstrap/ng-bootstrap';
import CoreModule,{AppService,ConfigService,ProfileProvider,Logger,bootstrap,TabsService,SplitTabComponent,TabRecoveryProvider,TabRecoveryService} from 'tabby-core';
import TerminalModule,{BaseSession,BaseTerminalTabComponent,BaseTerminalProfile} from 'tabby-terminal';
import SettingsModule,{SettingsTabComponent} from 'tabby-settings';
import WebModule from 'tabby-web';
import {getRootModule} from '../../app/src/app.module';
import '../../app/src/global.scss';
import '../../app/src/toastr.scss';
import '@fortawesome/fontawesome-free/css/all.css';
import 'source-sans-pro/source-sans-pro.css';
import 'source-code-pro/source-code-pro.css';

import {DemoSession} from './session';
import {sessions} from './claude-services';
import {WebPlatformService} from '../../tabby-web/src/platform';
// Browser-only service boundary: plugin connection tests use seeded responses.
window.fetch=async(input)=>{if(String(input)==='https://demo.invalid/api/agents')return new Response(JSON.stringify({agents:sessions}),{headers:{'Content-Type':'application/json'}});throw new Error('Network services are unavailable in this demo')};
WebPlatformService.prototype.openExternal=async(url:string)=>{
 const target=new URL(url,location.href);
 if(target.origin==='https://github.com'&&/^\/aylith-labs\/torbie(?:\/|$)/.test(target.pathname)){window.open(target.href,'_blank','noopener,noreferrer');return;}
window.parent.postMessage({type:'torbie-demo-tool',tool:'open_external',result:'External session links are available in the desktop app. This preview uses local demo sessions.'},location.origin)};
import {demos} from './scenarios';
import {DemoPluginModule,enableClaude,pluginState} from './plugin';
const CONFIG_KEY='torbie-preview-config-v1',TABS_KEY='torbie-preview-tabs-v1';
if(new URLSearchParams(location.search).has('reset')){sessionStorage.removeItem(CONFIG_KEY);sessionStorage.removeItem(TABS_KEY);}
let parentTheme:'light'|'dark'=document.documentElement.dataset.previewTheme==='dark'?'dark':'light';
WebPlatformService.prototype.getTheme=()=>parentTheme;
SettingsTabComponent.prototype.showReleaseNotes=function(){window.open('https://github.com/aylith-labs/torbie/releases/tag/v1.0.0','_blank','noopener,noreferrer')};
// Keep the real recovery pipeline, but never consume desktop recovery tokens or
// leak demo state across browser tabs. A demo terminal has its own provider below.
TabRecoveryService.prototype.saveTabs=async function(tabs){
 if(!this.enabled)return;
 const tokens=await Promise.all(tabs.map(tab=>this.getFullRecoveryToken(tab,{includeState:true})));
 sessionStorage.setItem(TABS_KEY,JSON.stringify(tokens.filter(Boolean)));
};
TabRecoveryService.prototype.recoverTabs=async function(){
 try{const tokens=JSON.parse(sessionStorage.getItem(TABS_KEY)||'[]');
  return (await Promise.all(tokens.map(token=>this.recoverTab(token)))).filter(Boolean);
 }catch{return [];}
};

@Component({standalone:false,selector:'demo-terminal',template:BaseTerminalTabComponent.template,styles:BaseTerminalTabComponent.styles,animations:BaseTerminalTabComponent.animations})
class DemoTerminal extends BaseTerminalTabComponent<BaseTerminalProfile>{
 session:DemoSession|null=null;
 constructor(injector:Injector){super(injector)}
 ngOnInit(){this.logger=this.log.create('demo');this.session=new DemoSession(this.logger,(this.profile as any)?.options?.demo || 'claude');super.ngOnInit();setTimeout(()=>this.setTitle(this.profile?.name || 'Claude Code'))}
 async getRecoveryToken(){return {type:'torbie-browser-terminal',profile:this.profile,kind:this.session?.kind || (this.profile as any)?.options?.demo}}
 protected onFrontendReady(){this.session!.start();this.attachSessionHandlers(true);super.onFrontendReady()}
 ngOnDestroy(){super.ngOnDestroy();this.session?.destroy()}
}
class DemoRecovery extends TabRecoveryProvider<DemoTerminal>{async applicableTo(token:any){return token.type==='torbie-browser-terminal'}async recover(token:any){const profile={...token.profile,options:{...token.profile?.options,demo:token.kind}};return {type:DemoTerminal,inputs:{profile}}}}
class DemoProfiles extends ProfileProvider<any>{id='demo';name='Demo';configDefaults={options:{}};async getBuiltinProfiles(){return demos.map(d=>({id:'demo:'+d.id,type:'demo',name:d.name,icon:d.icon,isBuiltin:true,options:{demo:d.id}}))};async getNewTabParameters(profile:any){return{type:DemoTerminal,inputs:{profile}}};getDescription(){return 'Browser demo'}}
@NgModule({imports:[CoreModule,TerminalModule,SettingsModule,WebModule,DemoPluginModule,CommonModule,FormsModule,NgbModule],declarations:[DemoTerminal],providers:[{provide:ProfileProvider,useClass:DemoProfiles,multi:true},{provide:TabRecoveryProvider,useClass:DemoRecovery,multi:true}]})
class DemoModule{
 constructor(app:AppService,config:ConfigService,tabs:TabsService,recovery:TabRecoveryService){
  app.tabsChanged$.subscribe(()=>{void recovery.saveTabs(app.tabs)});
  const openDemo=(id:string)=>{
   const d=demos.find(d=>d.id===id)||demos[0];
   const existing=app.tabs.find((tab:any)=>tab.getAllTabs?.().some((pane:any)=>pane.profile?.options?.demo===d.id));
   if(existing){app.selectTab(existing);return (existing as any).getAllTabs().find((pane:any)=>pane.profile?.options?.demo===d.id)}
   return app.openNewTab({type:DemoTerminal,inputs:{profile:{id:'demo:'+d.id,type:'demo',name:d.name,options:{demo:d.id}}}});
  };
  const settings=(id:string)=>{const old=app.tabs.find(t=>t instanceof SettingsTabComponent);if(old instanceof SettingsTabComponent){old.activeTab=id;app.selectTab(old)}else app.openNewTabRaw({type:SettingsTabComponent,inputs:{activeTab:id}})};
  app.ready$.subscribe(async()=>{
   // Core readiness can precede its asynchronous recovery transaction.
   while(!recovery.enabled)await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
   await Promise.all(app.tabs.filter(tab=>tab instanceof SplitTabComponent).map(tab=>(tab as SplitTabComponent).initialized$.toPromise()));
   for(const root of app.tabs){if(root instanceof SplitTabComponent&&root.getAllTabs()[0])root.focus(root.getAllTabs()[0]);}
   const tab=openDemo('claude');
   if(config.store.sidePanel.enabled&&config.store.sidePanel.activePanel==='claude')void enableClaude(config,true);
   tab.frontendReady$.pipe(take(1)).subscribe(()=>requestAnimationFrame(()=>{window.parent.postMessage({type:'torbie-demo-ready'},location.origin);window.parent.postMessage({type:'torbie-demo-config',tabsLocation:config.store.appearance.tabsLocation},location.origin)}));
   window.addEventListener('message',async event=>{
    if(event.source!==window.parent||event.origin!==location.origin||!event.data||typeof event.data!=='object')return;
    const {type,theme,action,scenario}=event.data;
    if(type==='torbie-action'&&action==='tab-location'&&['left','right','top','bottom'].includes(event.data.value)){config.store.appearance.tabsLocation=event.data.value;await config.save();window.parent.postMessage({type:'torbie-demo-config',tabsLocation:config.store.appearance.tabsLocation},location.origin);return}
    if(type==='torbie-theme'&&['light','dark'].includes(theme)){parentTheme=theme;document.documentElement.dataset.previewTheme=theme;document.documentElement.style.colorScheme=theme;if(config.store.appearance.colorSchemeMode==='auto')await config.save();return}
    if(type==='torbie-scenario'&&typeof scenario==='string'){
     if(scenario==='plugins')settings('demo-plugins');else if(scenario==='appearance')settings('terminal-appearance');else openDemo(scenario);return;
    }
    if(type!=='torbie-action')return;
    if(action==='plugins'){settings('demo-plugins');return}
    if(action==='claude'){await enableClaude(config,!pluginState.enabled);return}
    if(action==='split'){
     const current=openDemo('claude');const parent=current.parent as SplitTabComponent;
     if(parent?.getAllTabs().length>=4){window.parent.postMessage({type:'torbie-demo-tool',tool:'split_tab',result:'This demo supports four panes per tab. Reset the demo to start a fresh layout.'},location.origin);return;}
     const kind=event.data.kind==='claude'?'claude':'tests',direction=event.data.direction==='b'?'b':'r';
     const pane=tabs.create({type:DemoTerminal,inputs:{profile:{id:'demo:'+kind,type:'demo',name:kind==='claude'?'Claude Code':'Playwright',options:{demo:kind}}}});
     await parent.addTab(pane,current,direction);
     window.parent.postMessage({type:'torbie-demo-tool',tool:'split_tab',result:`${kind==='claude'?'An agent':'A test'} pane opened ${direction==='b'?'below':'beside'} the agent.`},location.origin);
    }
    if(action==='test'){
     const active:any=app.activeTab;const panes=active instanceof SplitTabComponent?active.getAllTabs():[];
     const pane=panes.find((p:any)=>p.profile?.options?.demo==='tests')||openDemo('tests');
     pane.session?.write(Buffer.from('npm test\r'));
     window.parent.postMessage({type:'torbie-demo-tool',tool:'exec_command',result:'18 demo checks passed. Read the output in the test pane.'},location.origin);
    }
    if(action==='list')window.parent.postMessage({type:'torbie-demo-tool',tool:'list_tabs',result:app.tabs.map(t=>t.title).join(' · ')},location.origin);
   });
  });
 }
}
const defaults={version:7,recoverTabs:true,enableWelcomeTab:false,appearance:{tabsLocation:'left',sideTabBarWidth:innerWidth<700?110:200,colorSchemeMode:'auto'},terminal:{font:'monospace',fontSize:14,ligatures:false},profiles:[],pluginBlacklist:[],web:{preventAccidentalTabClosure:false}};
let config=defaults;try{const saved=loadYaml(sessionStorage.getItem(CONFIG_KEY)||'null');if(saved)config={...defaults,...saved,appearance:{...defaults.appearance,...saved.appearance,sideTabBarWidth:innerWidth<700?110:200}}}catch{}
const plugins=[CoreModule,TerminalModule,SettingsModule,WebModule,DemoPluginModule,DemoModule].map((m:any)=>m.forRoot?m.forRoot():m);
plugins[0].bootstrap=bootstrap;
(window as any).pluginModules=plugins;
const root=getRootModule(plugins);
const bootstrapData={config,executable:'/demo',isMainWindow:true,windowID:1,installedPlugins:[],userPluginsPath:''};
enableProdMode();
platformBrowserDynamic([{provide:'BOOTSTRAP_DATA',useValue:bootstrapData},{provide:'WEB_CONNECTOR',useValue:{loadConfig:async()=>JSON.stringify(config),saveConfig:async(value:string)=>{sessionStorage.setItem(CONFIG_KEY,value)},getAppVersion:()=> '1.0.0 demo'}}]).bootstrapModule(root).then(ref=>{(window as any).demo={app:ref.injector.get(AppService),config:ref.injector.get(ConfigService)}}).catch(error=>{console.error(error);document.body.dataset.error=String(error);window.parent.postMessage({type:'torbie-demo-error'},location.origin)});
