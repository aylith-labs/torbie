<script lang="ts">
 import { base } from '$app/paths';
 import Shot from '$lib/Shot.svelte';
 let scene = $state(0);
 let expanded = $state(false);
 const scenes = [
  {name:'Your workspace',number:'01',title:'Everything in its place.',image:'workspace',alt:'Torbie running a split terminal workspace with public repository commands',description:'Split your terminal into panes and keep the layout. Torbie remembers supported commands and sends them to their restored shells after a restart.',link:'session-resume',point:'Panes that pick up where you left off.'},
  {name:'Links, opened',number:'02',title:'Stay beside your work.',image:'links',alt:'Torbie link preview beside a terminal',description:'Hover over a terminal link for a summary. Open the preview beside your terminal. Integration rules control what gets fetched and shown.',link:'preview-pane',point:'A link becomes a place to work.'},
  {name:'Under the hood',number:'03',title:'Less guessing. More evidence.',image:'diagnostics',alt:'Torbie terminal displaying the recorded 71.3 second stall diagnostic',description:'A recorded 71.3-second stall was attributed to synchronous file operations. Torbie records blocking work in the main process and renderers so you can inspect what happened.',link:'diagnostics-log',point:'The pause has a paper trail.'},
  {name:'Builds & doctor',number:'04',title:'Know what you’re running.',image:'builds',alt:'Torbie build inventory and doctor controls in the real application',description:'Inspect installed builds, running processes and source checkouts. The doctor checks missing plugins, provenance and builds that fail to start.',link:'builds-doctor',point:'Your builds, with a second opinion.'},
 ];
 const current = $derived(scenes[scene]);
 function select(index:number){scene=index;expanded=false;}
</script>
<svelte:head><title>Torbie · Make room for your work</title><meta name="description" content="Your terminal, your tools, a little more together. Explore Torbie’s workspaces, link previews, diagnostics and build doctor." /></svelte:head>
<div class="showcase-page">
 <section class="intro wrap">
  <a class="intro-kicker" href={`${base}/features/torbie/`} data-guide-title="A familiar starting point" data-guide="Torbie derives from Tabby and preserves its plugin API. Your existing plugin package names and module imports stay in place."><span></span>Built on Tabby. A little more curious.<span aria-hidden="true">↗</span></a>
  <h1>Make room for your <em>work.</em></h1>
  <p>Your terminal. Your tools. A little more together.</p>
  <div class="intro-actions"><a class="button" href={`${base}/download/`}>Get Torbie <span aria-hidden="true">↗</span></a><a class="quiet-action" href="#explore">Take a look <span aria-hidden="true">↓</span></a></div>
  <span class="platform-note">Windows · macOS · Linux</span>
 </section>
 <section class="workspace-tour" id="explore" aria-label="Explore Torbie">
  <div class="tour-top wrap"><span class="eyebrow">A few things to get curious about</span><span class="tour-count">{current.number} / 04</span></div>
  <div class="scene-tabs" aria-label="Product demonstrations">{#each scenes as item,i}<button class:chosen={scene===i} aria-pressed={scene===i} onclick={()=>select(i)} data-guide-title={item.title} data-guide={item.description}><span class="tab-number">{item.number}</span>{item.name}</button>{/each}</div>
  <div class="stage wrap">
   <div class="stage-light"></div><div class="stage-grid"></div>
   <div class="scene-heading"><span class="eyebrow">Torbie, up close</span><h2>{current.title}</h2></div>
   <div class="app-capture" data-scene={scene}><Shot name={current.image} alt={current.alt} eager={scene===0} /></div>
   <button class="scene-hotspot" class:expanded aria-expanded={expanded} aria-controls="scene-explanation" onclick={()=>{expanded=!expanded;}} data-guide-title={current.title} data-guide={current.description}><span aria-hidden="true">{expanded ? '−' : '+'}</span>{current.point}</button>
   <div class="stage-caption"><span><i></i>{scene === 2 ? 'Recorded log · replayed in Torbie' : 'Captured in Torbie'}</span><span>Explore the details <span aria-hidden="true">↗</span></span></div>
  </div>
  {#if expanded}<div class="scene-explanation wrap" id="scene-explanation"><p>{current.description}</p><a href={`${base}/features/${current.link}/`}>How it works <span aria-hidden="true">↗</span></a></div>{/if}
 </section>
 <section class="small-discoveries wrap" aria-labelledby="discover-title">
  <div class="section-heading"><span class="eyebrow">It’s the little things</span><h2 id="discover-title">Feels familiar.<br />Thinks a little further.</h2><a href={`${base}/features/`}>Explore every feature ↗</a></div>
  <div class="discovery-grid">
   <details class="discovery" data-guide-title="Keep your setup" data-guide="Torbie retains Tabby’s plugin API and package names. Compatibility evidence comes from loading three third-party plugins into a scratch profile."><summary><div class="plugin-visual" aria-hidden="true"><span>ssh</span><span class="plugin-center">T</span><span>git</span><span>sftp</span><span>⌘</span></div><div class="discovery-label"><h3>Your plugins.<br />Still at home.</h3><span>+</span></div></summary><p>The Tabby plugin API stays in place. Bring the tools that already fit you.</p><a href={`${base}/features/torbie/`}>Compatibility evidence ↗</a></details>
   <details class="discovery" data-guide-title="Understand a stall" data-guide="The chart visualizes a real recorded stall: 41.0 seconds reading files and 28.2 seconds unlinking files. It is a website visualization of the log, not an app screenshot."><summary><div class="diagnostic-visual" aria-hidden="true"><div class="viz-label">One stall, explained <span>71.3s</span></div><div class="timeline"><span></span><span></span><span></span></div><div class="viz-legend"><span>read · 41.0s</span><span>unlink · 28.2s</span></div><div class="viz-footer">98% synchronous I/O <span>↗</span></div></div><div class="discovery-label"><h3>Even the pauses<br />have a story.</h3><span>+</span></div></summary><p>A real recorded stall, broken down by the work that blocked it.</p><a href={`${base}/features/diagnostics-log/`}>Inspect the recorded evidence ↗</a></details>
   <details class="discovery" data-guide-title="Come back to your work" data-guide="Torbie saves detected commands with the pane layout, then sends them to restored shells. Coverage varies by command and session type; it does not resurrect the original process."><summary><div class="resume-visual" aria-hidden="true"><div><span>~/project</span><b>› npm run dev</b></div><span class="resume-bridge">↻</span><div><span>Welcome back</span><b><i></i>Command resumed</b></div></div><div class="discovery-label"><h3>Step away.<br />Pick it back up.</h3><span>+</span></div></summary><p>Restore the layout and restart supported commands in their shells.</p><a href={`${base}/features/session-resume/`}>What can be restored ↗</a></details>
  </div>
 </section>
 <section class="honest-notes wrap"><span class="eyebrow">Good to know</span><h2>A work in progress.<br />An open book.</h2><div class="notes-list">
  <details><summary>Before you install <span>+</span></summary><p>Builds are unsigned. Windows SmartScreen warns; macOS requires “Open anyway”. Linux deb/rpm packages replace tabby-terminal. Check the guidance beside your download.</p><a href={`${base}/download/`}>Choose your download ↗</a></details>
  <details><summary>A few rough edges <span>+</span></summary><p>Some emoji use the wrong cell width. Stale glyph artifacts remain unexplained. macOS has been reviewed in source, but has not been visually tested on a Mac.</p></details>
  <details><summary>Is Torbie right for you? <span>+</span></summary><p>Torbie is an Electron app. If low memory use is your first priority, consider Alacritty or WezTerm. Torbie is for keeping a flexible terminal workspace and understanding what it is doing.</p></details>
 </div></section>
 <section class="final-invitation wrap"><div class="eyebrow">A little more possibility</div><h2>Your next session<br />starts here.</h2><a class="button" href={`${base}/download/`}>Get Torbie <span aria-hidden="true">↗</span></a><p>Open source. Yours to explore.</p></section>
</div>
