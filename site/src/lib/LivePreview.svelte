<script lang="ts">
 import Icon from '$lib/Icon.svelte';
 import ActionMenu from '$lib/ActionMenu.svelte';
 import SelectMenu from '$lib/SelectMenu.svelte';
 import {onMount,tick} from 'svelte';
 import {base} from '$app/paths';
 let {scenario='claude',compact=false}: {scenario?:string;compact?:boolean}=$props();
 let host:HTMLElement;let frame:HTMLIFrameElement;
 let timer:ReturnType<typeof setTimeout>;
 function startTimer(){clearTimeout(timer);timer=setTimeout(()=>{if(!ready)failed=true},30000)}
 let view=$state<'inline'|'fullscreen'|'immersive'>('inline'),activity=$state(false),resetId=$state(0);
 const expanded=$derived(view!=='inline');
 const activityId=$props.id();
 let returnFocus:HTMLElement|null=null;
 let detachFrameKeys=()=>{};
 function activate(){if(!active){active=true;startTimer()}}
 export async function openFullScreen(){
  if(view==='inline')returnFocus=document.activeElement as HTMLElement;
  activate();view='fullscreen';activity=false;
  await tick();host.querySelector<HTMLButtonElement>('.fullscreen-toggle')?.focus({preventScroll:true});
 }
 function focusApp(){
  frame?.focus({preventScroll:true});
  const doc=frame?.contentDocument,current=doc?.activeElement;
  const input=current?.matches('.xterm-helper-textarea')&&current.closest('.content-tab-active')?current as HTMLElement:doc?.querySelector<HTMLElement>('.content-tab-active .xterm-helper-textarea');
  input?.focus({preventScroll:true});
 }
 async function openImmersive(){
  if(view==='inline')returnFocus=document.activeElement as HTMLElement;
  activate();view='immersive';activity=false;
  await tick();if(view==='immersive')focusApp();
 }
 async function exitView(){
  view='inline';
  await tick();if(view==='inline')returnFocus?.focus({preventScroll:true});
 }
 function handleEscape(event:KeyboardEvent){
  if(event.key!=='Escape')return;
  activity=false;
  if(expanded){event.preventDefault();void exitView()}
 }
 function bindFrameKeys(){
  detachFrameKeys();
  const doc=frame?.contentDocument;
  // Terminal programs need plain Escape (for example Neovim's normal mode).
  const exitShortcut=(event:KeyboardEvent)=>{if(expanded&&event.shiftKey&&event.key==='Escape'){event.stopPropagation();handleEscape(event)}};
  doc?.addEventListener('keydown',exitShortcut,true);
  detachFrameKeys=()=>doc?.removeEventListener('keydown',exitShortcut,true);
 }
 function resetDemo(){ready=false;failed=false;plugin=false;chosen=scenario;lastTool='';toolResult='';resetId++;startTimer()}
 $effect(()=>{
  if(!expanded)return;
  const before=document.body.style.overflow;document.body.style.overflow='hidden';
  const root=document.documentElement,rootOverflow=root.style.overflow,gutter=root.style.scrollbarGutter;root.style.overflow='hidden';root.style.scrollbarGutter='auto';
  const siblings:{element:HTMLElement;inert:boolean}[]=[];
  for(let branch:HTMLElement|null=host;branch?.parentElement;branch=branch.parentElement){
   for(const element of branch.parentElement.children){if(element!==branch&&element instanceof HTMLElement){siblings.push({element,inert:element.inert});element.inert=true;}}
  }
  return()=>{document.body.style.overflow=before;root.style.overflow=rootOverflow;root.style.scrollbarGutter=gutter;for(const {element,inert} of siblings)element.inert=inert;};
 });
 let active=$state(false),ready=$state(false),failed=$state(false),plugin=$state(false);
 let theme=$state('light'),chosen=$state('claude'),pending=$state(''),lastTool=$state(''),toolResult=$state('');
 const logos:Record<string,string>={claude:'claude.svg',codex:'codex.svg',shefrd:'shefrd.svg',polygit:'polygit.svg',neovim:'neovim.svg',btop:'btop.png',logs:'vite.svg',tests:'playwright.png'};
 let tabLocation=$state('left');
 function split(direction='r'){send({type:'torbie-action',action:'split',direction})}
 const examples=[['claude','Claude Code'],['codex','Codex'],['shefrd','Shefrd'],['polygit','Polygit'],['neovim','Neovim'],['btop','btop'],['logs','Vite dev server'],['tests','Playwright']];
 function send(message:Record<string,unknown>){frame?.contentWindow?.postMessage(message,location.origin)}
 function choose(id:string){pending=id;send({type:'torbie-scenario',scenario:id})}
 $effect(()=>{if(ready)choose(scenario)});
 function action(action:string){send({type:'torbie-action',action})}
 function retry(){failed=false;ready=false;active=false;requestAnimationFrame(()=>{active=true;startTimer()})}
 onMount(()=>{

  chosen=scenario;
  // A terminal's delayed autofocus must not dismiss an open page menu.
  const menuObserver=new MutationObserver(()=>{
   const menuOpen=!!host.querySelector('[role="listbox"],[role="menu"]');
   frame.inert=menuOpen;
   if(frame.contentDocument)frame.contentDocument.documentElement.inert=menuOpen;
  });
  menuObserver.observe(host,{childList:true,subtree:true});
  const openRequested=()=>void openFullScreen();
  window.addEventListener('torbie-open-preview',openRequested);
  bindFrameKeys();
  window.addEventListener('keydown',handleEscape);
  const preference=matchMedia('(prefers-color-scheme: dark)');
  const sync=()=>{theme=document.documentElement.dataset.theme || (preference.matches?'dark':'light');if(ready)send({type:'torbie-theme',theme})};sync();
  const mutation=new MutationObserver(sync);mutation.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});preference.addEventListener('change',sync);
  const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){active=true;observer.disconnect();startTimer()}},{rootMargin:'160px'});observer.observe(host);
  const receive=(event:MessageEvent)=>{if(event.origin!==location.origin||event.source!==frame?.contentWindow||!event.data)return;
   if(event.data.type==='torbie-demo-ready'){ready=true;failed=false;clearTimeout(timer);send({type:'torbie-theme',theme});choose(chosen);if(view==='immersive')requestAnimationFrame(focusApp)}
   if(event.data.type==='torbie-demo-scenario'){chosen=event.data.scenario;if(pending===chosen)pending='';}
   if(event.data.type==='torbie-demo-config')tabLocation=event.data.tabsLocation;
   if(event.data.type==='torbie-demo-plugin')plugin=event.data.enabled===true;
   if(event.data.type==='torbie-demo-tool'){lastTool=event.data.tool;toolResult=event.data.result}
   if(event.data.type==='torbie-demo-error'){failed=true;clearTimeout(timer)}
  };window.addEventListener('message',receive);
  return()=>{menuObserver.disconnect();if(frame){frame.inert=false;if(frame.contentDocument)frame.contentDocument.documentElement.inert=false;}detachFrameKeys();window.removeEventListener('torbie-open-preview',openRequested);window.removeEventListener('keydown',handleEscape);clearTimeout(timer);observer.disconnect();mutation.disconnect();preference.removeEventListener('change',sync);window.removeEventListener('message',receive)};
 });
</script>
<section class="live-preview" class:compact class:expanded class:immersive={view==='immersive'} data-view={view} role={expanded?'dialog':undefined} aria-modal={expanded?true:undefined} bind:this={host} aria-label="Interactive Torbie preview">
 <div class="preview-heading"><div><span class="eyebrow">Try the real interface</span><h2>{compact?'Explore this workspace.':'Your agents. Your terminal.'}</h2></div><div class="preview-tools"><span class="demo-label"><i></i>Real Torbie UI · mock sessions</span><div class="view-split"><button class="view-toggle fullscreen-toggle" onclick={()=>view==='fullscreen'?exitView():openFullScreen()}>{view==='fullscreen'?'Exit full screen':'Full screen'} <Icon name={view==='fullscreen'?'compress':'expand'}/></button><ActionMenu label="View options" caretOnly placement="bottom-end" options={[{value:'fullscreen',label:'Full screen · viewport'},{value:'inline',label:'Inline · on the page'},{value:'immersive',label:'Immersive · app only'}]} onchange={value=>value==='inline'?exitView():value==='immersive'?openImmersive():openFullScreen()} /></div></div></div>
 <div class="preview-apps" aria-label="Terminal applications">{#each examples as [id,label]}<button aria-pressed={chosen===id} aria-busy={pending===id} disabled={!ready} onclick={()=>choose(id)}><img src={`${base}/scenario-logos/${logos[id]}`} alt="" width="20" height="20" class:monochrome={['claude','codex','neovim'].includes(id)} />{label}</button>{/each}</div>
 {#if view==='immersive'}<button class="view-toggle exit-immersive" aria-keyshortcuts="Shift+Escape" title="Exit immersive view (Shift+Escape)" onclick={exitView}>Exit immersive view <Icon name="close"/></button>{/if}
 <div class="preview-window">
  <iframe bind:this={frame} onload={bindFrameKeys} src={`${base}/preview/${active?'index':'loading'}.html${resetId?`?reset=${resetId}`:''}`} title="Torbie — interactive Angular terminal demo" style="color-scheme:inherit" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"></iframe>
  {#if failed}<div class="preview-error"><p>The preview couldn’t finish loading.</p><button onclick={retry}>Try again</button><a href={`${base}/download/`}>Get the desktop app</a></div>{/if}
 </div>
 <div class="preview-actions" aria-label="Agent actions">
  <div class="split-button"><button disabled={!ready} onclick={()=>split()}><Icon name="split"/> Split pane</button><ActionMenu label="More split options" caretOnly disabled={!ready} options={[{value:'r',label:'Split right'},{value:'b',label:'Split below'}]} onchange={split}/></div>
  <div class="tab-location"><SelectMenu label="Tab bar" inlineLabel value={tabLocation} disabled={!ready} options={[{value:'left',label:'Left'},{value:'right',label:'Right'},{value:'top',label:'Top'},{value:'bottom',label:'Bottom'}]} onchange={value=>send({type:'torbie-action',action:'tab-location',value})} /></div>
  <ActionMenu label="Actions" disabled={!ready} options={[{value:'test',label:'Run Playwright checks'},{value:'claude',label:`${plugin?'Disable':'Enable'} Claude Code`},{value:'list',label:'List open tabs'}]} onchange={action}/>
  <div class="plugin-actions"><button disabled={!ready} onclick={()=>action('plugins')}><Icon name="plugins"/> Plugins</button><button class="reset-demo" title="Reset demo" aria-label="Reset demo" disabled={!ready} onclick={resetDemo}><Icon name="reset"/></button></div>
 </div>
 <div class="preview-footnote"><span aria-live="polite">{failed?'Preview unavailable.':ready?'Click a tab, type help, or try an agent action.':'Loading Torbie…'}</span><div class="activity" role="group" aria-label="MCP activity controls" onpointerenter={()=>activity=true} onpointerleave={()=>activity=false} onfocusin={()=>activity=true} onfocusout={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))activity=false}}>
 <button class="activity-trigger" aria-expanded={activity} aria-controls={activityId} onclick={()=>activity=true}>MCP activity {#if lastTool}<span>· {lastTool}</span>{/if}</button>
 {#if activity}<div class="activity-popover" id={activityId} role="region" aria-label="MCP activity"><p>{toolResult || 'Agents can list tabs, split panes and run commands. Try an action to see its result here.'}</p><small>Demo sessions · no host shell or live MCP connection</small></div>{/if}
 </div></div>
</section>
<style>
 .live-preview{margin:0 auto;width:100%;max-width:1200px}
 .preview-heading{display:flex;justify-content:space-between;align-items:flex-end;gap:20px;margin-bottom:22px}
 .preview-heading h2{font-size:clamp(26px,4vw,40px);letter-spacing:-.05em;margin:10px 0 0}
 .preview-tools{display:flex;align-items:center;gap:14px}.demo-label{font-size:11px;color:var(--muted);display:flex;align-items:center;gap:6px;white-space:nowrap}.demo-label i{height:5px;width:5px;border-radius:50%;background:#728c59}
 .view-toggle{border:1px solid var(--line);background:var(--canvas);color:var(--ink);padding:9px 12px;border-radius:8px;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}
 .preview-apps{display:flex;gap:4px;overflow-x:auto;padding:6px;background:var(--panel);border:1px solid var(--line);border-radius:14px 14px 0 0}
 .preview-apps button{display:flex;align-items:center;gap:8px;border:0;padding:10px 14px;background:none;color:var(--muted);border-radius:8px;font:inherit;font-size:12px;white-space:nowrap;cursor:pointer}
 .preview-apps button[aria-busy=true]{box-shadow:inset 0 -2px var(--accent)}.preview-apps button[aria-pressed=true]{background:var(--canvas);color:var(--ink);box-shadow:0 1px 4px #0001}.preview-apps img{object-fit:contain;flex-shrink:0}
 :global(html[data-theme=dark]) .monochrome{filter:invert(1)}
 @media(prefers-color-scheme:dark){:global(html:not([data-theme=light])) .monochrome{filter:invert(1)}}
 .preview-window{height:640px;border:1px solid var(--line);border-top:0;background:var(--canvas);position:relative}.preview-window iframe{border:0;display:block;width:100%;height:100%;background:var(--canvas)}
 .preview-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:14px;background:var(--panel);border:1px solid var(--line);border-top:0;border-radius:0 0 14px 14px}
 .preview-actions button,.preview-error button{font:inherit;font-size:12px;padding:9px 12px;background:var(--canvas);color:var(--ink);border:1px solid var(--line);border-radius:8px;cursor:pointer;min-height:38px}button:disabled{cursor:wait;opacity:.55}
 .split-button,.view-split{display:inline-flex;align-items:stretch}.split-button>button,.view-split>button{border-radius:8px 0 0 8px}
 .tab-location{width:155px}.tab-location :global(.select-trigger){height:38px;min-height:38px;line-height:18px;padding:9px 12px;font-size:12px}.plugin-actions{display:flex;gap:8px;margin-left:auto}.preview-actions button,.view-toggle{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:38px;min-height:38px;line-height:18px}.reset-demo{width:38px;padding:0!important}
 .preview-footnote{display:flex;justify-content:space-between;gap:20px;color:var(--muted);font-size:11px;padding:14px 3px}.activity{position:relative}.activity-trigger{border:0;background:none;color:var(--muted);font:inherit;cursor:pointer;min-height:28px;padding:0 4px}
 .activity-popover{position:absolute;bottom:calc(100% + 8px);right:0;width:min(360px,calc(100vw - 40px));padding:18px;background:var(--canvas);border:1px solid var(--line);border-radius:12px;box-shadow:0 10px 36px #0002;z-index:45}.activity-popover::after{content:"";position:absolute;top:100%;height:12px;left:0;right:0}.activity-popover p{font-size:13px;line-height:1.6;margin:0 0 10px}
 .preview-error{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;background:var(--canvas)}.preview-error p{margin:0}
 .compact{margin:32px 0 42px}.compact .preview-heading h2{font-size:26px}.compact .preview-window{height:540px}
 .live-preview.expanded{position:fixed;inset:0;width:100vw;max-width:none;height:100dvh;margin:0;padding:18px 24px;background:var(--canvas);z-index:60;display:flex;flex-direction:column}.expanded .preview-heading{margin:0 0 12px;align-items:center}.expanded .preview-heading h2{font-size:22px;margin:0}.expanded .eyebrow{display:none}.expanded .preview-window{height:auto;min-height:100px;flex:1}.expanded .preview-heading,.expanded .preview-apps,.expanded .preview-actions,.expanded .preview-footnote{flex-shrink:0}.expanded .preview-footnote{padding-bottom:0}
 @media(max-width:650px){
  .preview-heading{display:block}.preview-tools{margin-top:12px;justify-content:space-between;flex-wrap:wrap}.demo-label{margin-top:12px}.preview-window,.compact .preview-window{height:540px}.preview-actions{gap:6px}.preview-actions button{font-size:11px}.preview-footnote{display:block}.activity{margin-top:10px}.preview-apps button{padding:10px 12px}.preview-heading h2{font-size:30px}
  .live-preview.expanded{padding:10px}.expanded .preview-heading h2,.expanded .demo-label,.expanded .preview-footnote>span{display:none}.expanded .preview-tools{margin-top:0}.expanded .activity{margin-top:0}.expanded .preview-actions{padding:8px}.expanded .preview-window{height:auto}
 }
 .live-preview.immersive{padding:0}
 .immersive .preview-heading,.immersive .preview-apps,.immersive .preview-actions,.immersive .preview-footnote{display:none}
 .immersive .preview-window{height:100%;min-height:0;border:0;border-radius:0}
 .exit-immersive{position:absolute;z-index:2;top:max(10px,env(safe-area-inset-top));right:max(10px,env(safe-area-inset-right));min-height:36px;box-shadow:0 2px 12px #0002}

</style>
