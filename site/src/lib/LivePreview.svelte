<script lang="ts">
 import {onMount} from 'svelte';
 import {base} from '$app/paths';
 let {scenario='claude',compact=false}: {scenario?:string;compact?:boolean}=$props();
 let host:HTMLElement;let frame:HTMLIFrameElement;
 let timer:ReturnType<typeof setTimeout>;
 function startTimer(){clearTimeout(timer);timer=setTimeout(()=>{if(!ready)failed=true},30000)}
 let active=$state(false),ready=$state(false),failed=$state(false),plugin=$state(false);
 let theme=$state('light'),chosen=$state('claude'),lastTool=$state(''),toolResult=$state('');
 const examples=[['claude','Claude Code'],['codex','Codex'],['shefrd','Shefrd'],['lazygit','LazyGit'],['neovim','Neovim'],['btop','btop'],['logs','Logs'],['tests','Tests']];
 function send(message:Record<string,unknown>){frame?.contentWindow?.postMessage(message,location.origin)}
 function choose(id:string){chosen=id;send({type:'torbie-scenario',scenario:id})}
 $effect(()=>{if(ready)choose(scenario)});
 function action(action:string){send({type:'torbie-action',action})}
 function retry(){failed=false;ready=false;active=false;requestAnimationFrame(()=>{active=true;startTimer()})}
 onMount(()=>{

  chosen=scenario;
  const preference=matchMedia('(prefers-color-scheme: dark)');
  const sync=()=>{theme=document.documentElement.dataset.theme || (preference.matches?'dark':'light');if(ready)send({type:'torbie-theme',theme})};sync();
  const mutation=new MutationObserver(sync);mutation.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});preference.addEventListener('change',sync);
  const observer=new IntersectionObserver(entries=>{if(entries.some(e=>e.isIntersecting)){active=true;observer.disconnect();startTimer()}},{rootMargin:'160px'});observer.observe(host);
  const receive=(event:MessageEvent)=>{if(event.origin!==location.origin||event.source!==frame?.contentWindow||!event.data)return;
   if(event.data.type==='torbie-demo-ready'){ready=true;failed=false;clearTimeout(timer);send({type:'torbie-theme',theme});choose(chosen)}
   if(event.data.type==='torbie-demo-plugin')plugin=event.data.enabled===true;
   if(event.data.type==='torbie-demo-tool'){lastTool=event.data.tool;toolResult=event.data.result}
   if(event.data.type==='torbie-demo-error'){failed=true;clearTimeout(timer)}
  };window.addEventListener('message',receive);
  return()=>{clearTimeout(timer);observer.disconnect();mutation.disconnect();preference.removeEventListener('change',sync);window.removeEventListener('message',receive)};
 });
</script>
<section class="live-preview" class:compact bind:this={host} aria-label="Interactive Torbie preview">
 <div class="preview-heading"><div><span class="eyebrow">Try the real interface</span><h2>{compact?'Explore this workspace.':'Your agents. Your terminal.'}</h2></div><span class="demo-label"><i></i>Real Torbie UI · mock sessions</span></div>
 <div class="preview-apps" aria-label="Terminal applications">{#each examples as [id,label]}<button aria-pressed={chosen===id} disabled={!ready} onclick={()=>choose(id)}>{label}</button>{/each}</div>
 <div class="preview-window">
  <iframe bind:this={frame} src={`${base}/preview/${active?'index':'loading'}.html`} title="Torbie — interactive Angular terminal demo" style:color-scheme={theme} sandbox="allow-scripts allow-same-origin" allow="fullscreen"></iframe>
  {#if failed}<div class="preview-error"><p>The preview couldn’t finish loading.</p><button onclick={retry}>Try again</button><a href={`${base}/download/`}>Get the desktop app</a></div>{/if}
 </div>
 <div class="preview-actions" aria-label="Agent actions">
  <span>Let an agent…</span><button disabled={!ready} onclick={()=>action('split')}>Split a test pane <span aria-hidden="true">↗</span></button><button disabled={!ready} onclick={()=>action('test')}>Run checks <span aria-hidden="true">↗</span></button><button disabled={!ready} aria-pressed={plugin} onclick={()=>action('claude')}>{plugin?'Disable':'Enable'} Claude Code</button><button disabled={!ready} onclick={()=>action('plugins')}>Plugins <span aria-hidden="true">⚙</span></button>
 </div>
 <div class="preview-footnote"><span aria-live="polite">{failed?'Preview unavailable.':ready?'Click a tab, type help, or try an agent action.':'Preparing your workspace…'}</span><details><summary>MCP activity {#if lastTool}<span>· {lastTool}</span>{/if}</summary><p>{toolResult || 'The desktop MCP plugin lets agents list tabs, split panes and run commands. These demo actions call the same Torbie layout and terminal APIs with seeded data.'}</p><small>Browser demo · no host shell or live MCP connection</small></details></div>
</section>
<style>
 .live-preview{margin:0 auto;width:100%;max-width:1200px}.preview-heading{display:flex;justify-content:space-between;align-items:flex-end;gap:20px;margin-bottom:22px}.preview-heading h2{font-size:clamp(26px,4vw,40px);letter-spacing:-.05em;margin:10px 0 0}.demo-label{font-size:11px;color:var(--muted);display:flex;align-items:center;gap:6px;white-space:nowrap}.demo-label i{height:5px;width:5px;border-radius:50%;background:#728c59}.preview-apps{display:flex;gap:4px;overflow-x:auto;padding:6px;background:var(--panel);border:1px solid var(--line);border-radius:14px 14px 0 0}.preview-apps button{border:0;padding:10px 14px;background:none;color:var(--muted);border-radius:8px;font:inherit;font-size:12px;white-space:nowrap;cursor:pointer}.preview-apps button[aria-pressed=true]{background:var(--canvas);color:var(--ink);box-shadow:0 1px 4px #0001}.preview-window{height:640px;border:1px solid var(--line);border-top:0;background:var(--canvas);position:relative}.preview-window iframe{border:0;display:block;width:100%;height:100%;background:var(--canvas)}.preview-actions{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:14px;background:var(--panel);border:1px solid var(--line);border-top:0;border-radius:0 0 14px 14px}.preview-actions>span{color:var(--muted);font-size:12px;margin-right:4px}.preview-actions button,.preview-error button{font:inherit;font-size:12px;padding:9px 12px;background:var(--canvas);color:var(--ink);border:1px solid var(--line);border-radius:8px;cursor:pointer;min-height:38px}.preview-actions button span{margin-left:8px;color:var(--accent)}button:disabled{cursor:wait;opacity:.55}.preview-footnote{display:flex;justify-content:space-between;gap:20px;color:var(--muted);font-size:11px;padding:14px 3px}.preview-footnote details{max-width:430px}.preview-footnote summary{cursor:pointer;min-height:24px}.preview-footnote p{font-size:13px;line-height:1.6;margin:12px 0}.preview-error{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;background:var(--canvas)}.preview-error p{margin:0}.compact{margin:32px 0 42px}.compact .preview-heading h2{font-size:26px}.compact .preview-window{height:540px}
 @media(max-width:650px){.preview-heading{display:block}.demo-label{margin-top:12px}.preview-window,.compact .preview-window{height:540px}.preview-actions{gap:6px}.preview-actions>span{flex-basis:100%;margin-bottom:4px}.preview-actions button{font-size:11px}.preview-footnote{display:block}.preview-footnote details{margin-top:10px}.preview-apps button{padding:10px 12px}.preview-heading h2{font-size:30px}}
</style>
