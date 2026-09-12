<script lang="ts">
 import SelectMenu from '$lib/SelectMenu.svelte';
 import {onMount,tick} from 'svelte';
 import {base} from '$app/paths';
 let {scenario='claude',compact=false}: {scenario?:string;compact?:boolean}=$props();
 let host:HTMLElement;let frame:HTMLIFrameElement;
 let timer:ReturnType<typeof setTimeout>;
 function startTimer(){clearTimeout(timer);timer=setTimeout(()=>{if(!ready)failed=true},30000)}
 let immersive=$state(false),activity=$state(false),resetId=$state(0);
 const activityId=$props.id();
 let expandButton:HTMLButtonElement;
 export function openImmersive(){if(!active){active=true;startTimer()}if(!immersive)void toggleImmersive()}
 async function toggleImmersive(){if(immersive){if(document.fullscreenElement===host)await document.exitFullscreen();immersive=false;expandButton?.focus();}else{immersive=true;try{await host.requestFullscreen()}catch{}}}
 function resetDemo(){ready=false;failed=false;plugin=false;chosen=scenario;lastTool='';toolResult='';resetId++;startTimer()}
 $effect(()=>{if(!immersive)return;const before=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{document.body.style.overflow=before}});
 let active=$state(false),ready=$state(false),failed=$state(false),plugin=$state(false);
 let theme=$state('light'),chosen=$state('claude'),lastTool=$state(''),toolResult=$state('');
 const logos:Record<string,string>={claude:'claude.svg',codex:'codex.svg',shefrd:'shefrd.svg',polygit:'polygit.svg',neovim:'neovim.svg',btop:'btop.png',logs:'vite.svg',tests:'playwright.png'};
 let tabLocation=$state('left'),splitOpen=$state(false);
 let splitControl:HTMLDivElement;let splitCaret:HTMLButtonElement;
 async function toggleSplits(){splitOpen=!splitOpen;if(splitOpen){await tick();splitControl.querySelector<HTMLButtonElement>('[role=menuitem]')?.focus()}}
 function split(kind='tests',direction='r'){splitOpen=false;send({type:'torbie-action',action:'split',kind,direction})}
 const examples=[['claude','Claude Code'],['codex','Codex'],['shefrd','Shefrd'],['polygit','Polygit'],['neovim','Neovim'],['btop','btop'],['logs','Vite dev server'],['tests','Playwright']];
 function send(message:Record<string,unknown>){frame?.contentWindow?.postMessage(message,location.origin)}
 function choose(id:string){chosen=id;send({type:'torbie-scenario',scenario:id})}
 $effect(()=>{if(ready)choose(scenario)});
 function action(action:string){send({type:'torbie-action',action})}
 function retry(){failed=false;ready=false;active=false;requestAnimationFrame(()=>{active=true;startTimer()})}
 onMount(()=>{

  chosen=scenario;
  const fullscreen=()=>{immersive=document.fullscreenElement===host};
  const handleEscape=(event:KeyboardEvent)=>{if(event.key==='Escape'){activity=false;if(immersive&&!document.fullscreenElement){immersive=false;expandButton?.focus()}}};
  document.addEventListener('fullscreenchange',fullscreen);window.addEventListener('keydown',handleEscape);
  const preference=matchMedia('(prefers-color-scheme: dark)');
  const sync=()=>{theme=document.documentElement.dataset.theme || (preference.matches?'dark':'light');if(ready)send({type:'torbie-theme',theme})};sync();
  const mutation=new MutationObserver(sync);mutation.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});preference.addEventListener('change',sync);
  const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){active=true;observer.disconnect();startTimer()}},{rootMargin:'160px'});observer.observe(host);
  const receive=(event:MessageEvent)=>{if(event.origin!==location.origin||event.source!==frame?.contentWindow||!event.data)return;
   if(event.data.type==='torbie-demo-ready'){ready=true;failed=false;clearTimeout(timer);send({type:'torbie-theme',theme});choose(chosen)}
   if(event.data.type==='torbie-demo-config')tabLocation=event.data.tabsLocation;
   if(event.data.type==='torbie-demo-plugin')plugin=event.data.enabled===true;
   if(event.data.type==='torbie-demo-tool'){lastTool=event.data.tool;toolResult=event.data.result}
   if(event.data.type==='torbie-demo-error'){failed=true;clearTimeout(timer)}
  };window.addEventListener('message',receive);
  return()=>{document.removeEventListener('fullscreenchange',fullscreen);window.removeEventListener('keydown',handleEscape);clearTimeout(timer);observer.disconnect();mutation.disconnect();preference.removeEventListener('change',sync);window.removeEventListener('message',receive)};
 });
</script>
<svelte:window onpointerdown={event=>{if(splitOpen&&!splitControl?.contains(event.target as Node))splitOpen=false}} />
<section class="live-preview" class:compact class:immersive bind:this={host} aria-label="Interactive Torbie preview">
 <div class="preview-heading"><div><span class="eyebrow">Try the real interface</span><h2>{compact?'Explore this workspace.':'Your agents. Your terminal.'}</h2></div><div class="preview-tools"><span class="demo-label"><i></i>Real Torbie UI · mock sessions</span><button bind:this={expandButton} class="immersive-toggle" aria-pressed={immersive} onclick={toggleImmersive}>{immersive ? 'Exit immersive view' : 'Immersive view'} <span aria-hidden="true">{immersive ? '↙' : '↗'}</span></button></div></div>
 <div class="preview-apps" aria-label="Terminal applications">{#each examples as [id,label]}<button aria-pressed={chosen===id} disabled={!ready} onclick={()=>choose(id)}><img src={`${base}/scenario-logos/${logos[id]}`} alt="" width="20" height="20" class:monochrome={['claude','codex','neovim'].includes(id)} />{label}</button>{/each}</div>
 <div class="preview-window">
  <iframe bind:this={frame} src={`${base}/preview/${active?'index':'loading'}.html${resetId?`?reset=${resetId}`:''}`} title="Torbie — interactive Angular terminal demo" style="color-scheme:inherit" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox" allow="fullscreen"></iframe>
  {#if failed}<div class="preview-error"><p>The preview couldn’t finish loading.</p><button onclick={retry}>Try again</button><a href={`${base}/download/`}>Get the desktop app</a></div>{/if}
 </div>
 <div class="preview-actions" aria-label="Agent actions">
  <span>Let an agent…</span><div class="split-button"><button disabled={!ready} onclick={()=>split()}>Split a test pane <span aria-hidden="true">↗</span></button><div class="split-options" bind:this={splitControl}><button class="split-caret" bind:this={splitCaret} disabled={!ready} aria-label="More split options" aria-haspopup="menu" aria-expanded={splitOpen} onclick={toggleSplits}>⌄</button>{#if splitOpen}<div class="split-menu" role="menu" tabindex="-1" aria-label="Split options" onkeydown={event=>{if(event.key==='Escape'){splitOpen=false;splitCaret.focus()}if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();const buttons=[...event.currentTarget.querySelectorAll('button')];const index=buttons.indexOf(document.activeElement as HTMLButtonElement);buttons[(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus()}}}>
{#each [['tests','r','Test pane to the right'],['tests','b','Test pane below'],['claude','r','Agent pane to the right'],['claude','b','Agent pane below']] as [kind,direction,label]}<button role="menuitem" onclick={()=>split(kind,direction)}>{label}</button>{/each}</div>{/if}</div></div><button disabled={!ready} onclick={()=>action('test')}>Run checks <span aria-hidden="true">↗</span></button><button disabled={!ready} aria-pressed={plugin} onclick={()=>action('claude')}>{plugin?'Disable':'Enable'} Claude Code</button><div class="tab-location"><SelectMenu label="Tab bar" value={tabLocation} disabled={!ready} options={[{value:'left',label:'Left'},{value:'right',label:'Right'},{value:'top',label:'Top'},{value:'bottom',label:'Bottom'}]} onchange={value=>send({type:'torbie-action',action:'tab-location',value})} /></div><div class="plugin-actions"><button disabled={!ready} onclick={()=>action('plugins')}>Plugins <span aria-hidden="true">⚙</span></button><button class="reset-demo" disabled={!ready} onclick={resetDemo}>Reset demo <span aria-hidden="true">↻</span></button></div>
 </div>
 <div class="preview-footnote"><span aria-live="polite">{failed?'Preview unavailable.':ready?'Click a tab, type help, or try an agent action.':'Preparing your workspace…'}</span><div class="activity" role="group" aria-label="MCP activity controls" onpointerenter={()=>activity=true} onpointerleave={()=>activity=false} onfocusin={()=>activity=true} onfocusout={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))activity=false}}>
 <button class="activity-trigger" aria-expanded={activity} aria-controls={activityId} onclick={()=>activity=true}>MCP activity {#if lastTool}<span>· {lastTool}</span>{/if}</button>
 {#if activity}<div class="activity-popover" id={activityId} role="region" aria-label="MCP activity"><p>{toolResult || 'Agents can list tabs, split panes and run commands. Try an action to see its result here.'}</p><small>Demo sessions · no host shell or live MCP connection</small></div>{/if}
 </div></div>
</section>
<style>
 .live-preview{margin:0 auto;width:100%;max-width:1200px}
 .preview-heading{display:flex;justify-content:space-between;align-items:flex-end;gap:20px;margin-bottom:22px}
 .preview-heading h2{font-size:clamp(26px,4vw,40px);letter-spacing:-.05em;margin:10px 0 0}
 .preview-tools{display:flex;align-items:center;gap:14px}.demo-label{font-size:11px;color:var(--muted);display:flex;align-items:center;gap:6px;white-space:nowrap}.demo-label i{height:5px;width:5px;border-radius:50%;background:#728c59}
 .immersive-toggle{border:1px solid var(--line);background:var(--canvas);color:var(--ink);padding:9px 12px;border-radius:8px;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}
 .preview-apps{display:flex;gap:4px;overflow-x:auto;padding:6px;background:var(--panel);border:1px solid var(--line);border-radius:14px 14px 0 0}
 .preview-apps button{display:flex;align-items:center;gap:8px;border:0;padding:10px 14px;background:none;color:var(--muted);border-radius:8px;font:inherit;font-size:12px;white-space:nowrap;cursor:pointer}
 .preview-apps button[aria-pressed=true]{background:var(--canvas);color:var(--ink);box-shadow:0 1px 4px #0001}.preview-apps img{object-fit:contain;flex-shrink:0}
 :global(html[data-theme=dark]) .monochrome{filter:invert(1)}
 @media(prefers-color-scheme:dark){:global(html:not([data-theme=light])) .monochrome{filter:invert(1)}}
 .preview-window{height:640px;border:1px solid var(--line);border-top:0;background:var(--canvas);position:relative}.preview-window iframe{border:0;display:block;width:100%;height:100%;background:var(--canvas)}
 .preview-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:14px;background:var(--panel);border:1px solid var(--line);border-top:0;border-radius:0 0 14px 14px}.preview-actions>span{color:var(--muted);font-size:12px;margin-right:4px}
 .preview-actions button,.preview-error button{font:inherit;font-size:12px;padding:9px 12px;background:var(--canvas);color:var(--ink);border:1px solid var(--line);border-radius:8px;cursor:pointer;min-height:38px}.preview-actions button span{margin-left:8px;color:var(--accent)}button:disabled{cursor:wait;opacity:.55}
 .split-button{display:flex;align-items:stretch}.split-button>button{border-radius:8px 0 0 8px}.split-options{position:relative;margin-left:-1px}.preview-actions .split-caret{padding:9px 10px;border-radius:0 8px 8px 0}
 .split-menu{position:absolute;bottom:calc(100% + 8px);left:0;width:220px;padding:5px;background:var(--canvas);border:1px solid var(--line);border-radius:10px;box-shadow:0 10px 35px #0002;z-index:45}.split-menu button{display:block;width:100%;text-align:left;border:0;background:none}.split-menu button:hover{background:var(--panel)}
 .tab-location{width:112px}.tab-location :global(.select-label){font-size:10px;margin-bottom:1px}.tab-location :global(.select-trigger){min-height:30px;padding:5px 10px;font-size:12px}.plugin-actions{display:flex;gap:8px;margin-left:auto}
 .preview-footnote{display:flex;justify-content:space-between;gap:20px;color:var(--muted);font-size:11px;padding:14px 3px}.activity{position:relative}.activity-trigger{border:0;background:none;color:var(--muted);font:inherit;cursor:pointer;min-height:28px;padding:0 4px}
 .activity-popover{position:absolute;bottom:calc(100% + 8px);right:0;width:min(360px,calc(100vw - 40px));padding:18px;background:var(--canvas);border:1px solid var(--line);border-radius:12px;box-shadow:0 10px 36px #0002;z-index:45}.activity-popover::after{content:"";position:absolute;top:100%;height:12px;left:0;right:0}.activity-popover p{font-size:13px;line-height:1.6;margin:0 0 10px}
 .preview-error{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;background:var(--canvas)}.preview-error p{margin:0}
 .compact{margin:32px 0 42px}.compact .preview-heading h2{font-size:26px}.compact .preview-window{height:540px}
 .live-preview.immersive{position:fixed;inset:0;width:100vw;max-width:none;height:100dvh;margin:0;padding:18px 24px;background:var(--canvas);z-index:60;display:flex;flex-direction:column}.immersive .preview-heading{margin:0 0 12px;align-items:center}.immersive .preview-heading h2{font-size:22px;margin:0}.immersive .eyebrow{display:none}.immersive .preview-window{height:auto;min-height:100px;flex:1}.immersive .preview-heading,.immersive .preview-apps,.immersive .preview-actions,.immersive .preview-footnote{flex-shrink:0}.immersive .preview-footnote{padding-bottom:0}
 @media(max-width:650px){
  .preview-heading{display:block}.preview-tools{margin-top:12px;justify-content:space-between;flex-wrap:wrap}.demo-label{margin-top:12px}.preview-window,.compact .preview-window{height:540px}.preview-actions{gap:6px}.preview-actions>span{flex-basis:100%;margin-bottom:4px}.preview-actions button{font-size:11px}.preview-footnote{display:block}.activity{margin-top:10px}.preview-apps button{padding:10px 12px}.preview-heading h2{font-size:30px}.split-menu{left:auto;right:0}
  .live-preview.immersive{padding:10px}.immersive .preview-heading h2,.immersive .demo-label,.immersive .preview-footnote>span,.immersive .preview-actions>span{display:none}.immersive .preview-tools{margin-top:0}.immersive .activity{margin-top:0}.immersive .preview-actions{padding:8px}.immersive .preview-window{height:auto}
 }
</style>
