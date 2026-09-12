<script lang="ts">
 import { onMount } from 'svelte';
 let parked = $state(false);
 let open = $state(false);
 let hint = $state('Pick something you’re curious about. I’ll show you around.');
 let title = $state('A little help?');
 let x = $state(0); let y = $state(0); let ready = $state(false);
 let gazeX = $state(0); let gazeY = $state(0);
 let following = $state(false);
 let host: HTMLDivElement;
 onMount(() => {
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let tx = innerWidth - 92; let ty = innerHeight - 100; x = tx; y = ty; ready = true;
  let frame = 0; let timer: ReturnType<typeof setTimeout>; let target: Element | null = null;
  try { parked = localStorage.getItem('torbie-guide-parked') === 'true'; } catch {}
  function tick() { x += (tx-x)*.16; y += (ty-y)*.16; if (Math.abs(tx-x)+Math.abs(ty-y)>.4) frame=requestAnimationFrame(tick); else { x=tx; y=ty; frame=0; } }
  function move(e: PointerEvent) {
   if (e.pointerType !== 'mouse' || !fine.matches || motion.matches || document.documentElement.dataset.motion === 'off' || parked || open || host?.matches(':hover') || document.activeElement?.closest('.companion')) return;
   const bounds=host.getBoundingClientRect();
   const distance=Math.hypot(Math.max(bounds.left-e.clientX,0,e.clientX-bounds.right),Math.max(bounds.top-e.clientY,0,e.clientY-bounds.bottom));
   // Stop before the pointer reaches us, including any already queued frame.
   if(distance<88){cancelAnimationFrame(frame);frame=0;tx=x;ty=y;return;}
   following=true; tx=Math.min(innerWidth-80,Math.max(16,e.clientX+42)); ty=Math.min(innerHeight-88,Math.max(16,e.clientY+36));
   gazeX=Math.max(-2,Math.min(2,(e.clientX-x)/30)); gazeY=Math.max(-2,Math.min(2,(e.clientY-y)/30));
   if(!frame) frame=requestAnimationFrame(tick);
  }
  function inspect(e: Event) {
   const element=(e.target as Element)?.closest('[data-guide]');
   if (!element || element===target) return;
   target=element; clearTimeout(timer);
   const update=()=>{hint=element.getAttribute('data-guide') || '';title=element.getAttribute('data-guide-title') || 'Let’s take a closer look';};
   if(e.type==='focusin') update(); else timer=setTimeout(update,220);
  }
  function reset() {following=false;tx=innerWidth-92;ty=innerHeight-100;if(!frame)frame=requestAnimationFrame(tick);}
  function keys(e: KeyboardEvent) {if(e.key==='Escape'){if(open) closeGuide();reset();}}
  function preference(){cancelAnimationFrame(frame);frame=0;following=false;x=innerWidth-92;y=innerHeight-100;}
  window.addEventListener('pointermove',move);document.addEventListener('pointerover',inspect);document.addEventListener('focusin',inspect);window.addEventListener('keydown',keys);window.addEventListener('resize',preference);motion.addEventListener('change',preference);
  return ()=>{cancelAnimationFrame(frame);clearTimeout(timer);window.removeEventListener('pointermove',move);document.removeEventListener('pointerover',inspect);document.removeEventListener('focusin',inspect);window.removeEventListener('keydown',keys);window.removeEventListener('resize',preference);motion.removeEventListener('change',preference);};
 });
 function closeGuide(){open=false;following=false;host?.querySelector('button')?.focus({preventScroll:true});}
 function togglePark(){parked=!parked;following=false;try{localStorage.setItem('torbie-guide-parked',String(parked));}catch{}}
</script>
<div role="complementary" aria-label="Torbie guide control" hidden={!ready} bind:this={host} class="companion" class:ready class:fixed={parked || open || !following} style:left={`${x}px`} style:top={`${y}px`}>
 <span class="companion-label">{title}</span>
 <button class="creature" aria-label={open ? 'Close Torbie guide' : 'Open Torbie guide'} aria-expanded={open} aria-controls="guide-panel" onclick={()=>{open=!open;}}>
  <span aria-hidden="true" class="ear left"></span><span aria-hidden="true" class="ear right"></span><span aria-hidden="true" class="face"><span class="eyes" style:transform={`translate(${gazeX}px,${gazeY}px)`}><i></i><i></i></span><span class="nose"></span></span>
 </button>
</div>
{#if open}
 <aside id="guide-panel" class="guide-panel" aria-label="Torbie guide">
  <div class="guide-heading"><span class="guide-status"></span><span>Torbie’s field guide</span><button aria-label="Close guide" onclick={closeGuide}>×</button></div>
  <h2>{title}</h2><p>{hint}</p>
  <div class="guide-bottom"><span>Explore a feature, then ask me.</span><button aria-pressed={parked} onclick={togglePark}>{parked ? 'Let me follow' : 'Park me here'}</button></div>
 </aside>
{/if}
<style>
 .companion{position:fixed;z-index:30;width:58px;height:58px;opacity:0;pointer-events:none}.companion.ready{opacity:1}.companion-label{position:absolute;bottom:66px;right:0;width:max-content;max-width:210px;background:var(--canvas);color:var(--ink);border:1px solid var(--line);border-radius:10px 10px 2px 10px;padding:7px 10px;font-size:11px;box-shadow:0 4px 12px #0001;opacity:0}.companion.fixed:not(:has(.creature[aria-expanded=true])) .companion-label,.companion:has(.creature:hover) .companion-label,.companion:has(.creature:focus-visible) .companion-label{opacity:1}.companion.fixed{left:auto!important;top:auto!important;right:28px;bottom:28px}.creature{pointer-events:auto;position:relative;display:block;width:58px;height:58px;border:0;background:none;cursor:pointer;padding:0;filter:drop-shadow(0 7px 9px #35231530)}
 .face{position:absolute;inset:12px 3px 2px;border-radius:48% 48% 43% 43%;overflow:hidden;background:radial-gradient(ellipse at 78% 78%,#382a26 0 23%,transparent 25%),radial-gradient(ellipse at 18% 15%,#332923 0 36%,transparent 38%),radial-gradient(ellipse at 86% 12%,#5b3828 0 18%,transparent 20%),radial-gradient(circle at 55% 40%,#e3ab70,#bd7545 65%,#8e5135);box-shadow:inset 0 -2px 3px #78412c40,inset 0 2px 2px #fff9}.ear{position:absolute;top:3px;width:21px;height:28px;background:#c38960;border:3px solid #e5b286;border-radius:5px 16px 5px 5px}.ear.left{left:4px;transform:rotate(-13deg);background:#302824;border-color:#654735}.ear.right{right:4px;transform:rotate(13deg);border-radius:16px 5px 5px 5px}.eyes{position:absolute;left:13px;top:17px;display:flex;gap:13px}.eyes i{width:5px;height:8px;background:#e8c77c;border-radius:50%;box-shadow:inset 0 0 0 1px #3b2923;position:relative}.nose{position:absolute;left:24px;top:29px;width:5px;height:3px;background:#8c4f3b;border-radius:50%}.creature:active{transform:scale(.95)}
 .eyes i::after{content:"";position:absolute;left:2px;top:1px;width:2px;height:5px;border-radius:50%;background:#241d19}.face::before{content:"";position:absolute;left:22px;top:-3px;width:3px;height:13px;background:#583526;border-radius:0 0 70% 40%;transform:rotate(13deg);box-shadow:6px -2px #583526,12px -4px #583526}.nose{background:#e6ae96;box-shadow:0 1px 1px #35251e}
 @keyframes blink{0%,42%,46%,48%,52%,100%{transform:scaleY(1)}44%,50%{transform:scaleY(.08)}}
 @keyframes ear-flick{0%,65%,73%,100%{transform:rotate(13deg)}68%{transform:rotate(23deg)}70%{transform:rotate(8deg)}}
 @keyframes breathe{0%,100%{translate:0 0}50%{translate:0 -1.5px}}
 @media(prefers-reduced-motion:no-preference){:global(html[data-motion=on]) .eyes i{animation:blink 5.6s infinite;transform-origin:center}:global(html[data-motion=on]) .ear.right{animation:ear-flick 8.3s infinite;transform-origin:bottom left}:global(html[data-motion=on]) .face{animation:breathe 3.8s ease-in-out infinite}}
 .guide-panel{position:fixed;right:28px;bottom:104px;z-index:31;width:min(340px,calc(100vw - 32px));max-height:calc(100dvh - 140px);overflow:auto;padding:20px;background:var(--canvas);border:1px solid var(--line);border-radius:20px;box-shadow:0 16px 70px #0002;transform-origin:bottom right}.guide-heading{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:12px}.guide-heading button{margin-left:auto;font-size:24px;border:0;background:none;color:var(--ink);width:36px;height:36px;cursor:pointer}.guide-status{width:6px;height:6px;border-radius:50%;background:#62976b}.guide-panel h2{font-size:22px;margin:14px 0 12px}.guide-panel p{font-size:15px;line-height:1.6;margin-bottom:20px}.guide-bottom{border-top:1px solid var(--line);padding-top:12px;display:flex;align-items:center;gap:14px;font-size:11px;color:var(--muted)}.guide-bottom button{border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:8px;font:inherit;padding:8px;min-height:40px;white-space:nowrap;cursor:pointer}
 @media(prefers-reduced-motion:no-preference){.guide-panel{transition:opacity 160ms ease-out,transform 180ms cubic-bezier(.23,1,.32,1);@starting-style{opacity:0;transform:translateY(6px) scale(.97)}}.creature{transition:transform 120ms ease-out}}
 @media(max-width:650px){.companion.fixed{right:18px;bottom:18px}.guide-panel{right:16px;bottom:92px}}
</style>
