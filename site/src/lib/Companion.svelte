<script lang="ts">
 import {onMount} from 'svelte';
 import {clearPath,distance,inside,route,safePoint,type Point,type Rect} from '$lib/guide-motion';
 let parked=$state(true),open=$state(false),ready=$state(false),visible=$state(true),canFollow=$state(false);
 let title=$state('Explore Torbie'),hint=$state('Try the workspace above, or open Features to explore what Torbie can do.');
 let x=$state(0),y=$state(0),gazeX=$state(0),gazeY=$state(0);
 let host:HTMLDivElement;
 let resume=()=>{};
 const save=()=>{try{localStorage.setItem('torbie-guide-mode',parked?'parked':'follow')}catch{}};
 function closeGuide(focus=true){open=false;if(focus)host?.querySelector('button')?.focus({preventScroll:true});}
 function togglePark(){parked=!parked;save();closeGuide(false);(document.activeElement as HTMLElement)?.blur();resume();}
 onMount(()=>{
  const fine=matchMedia('(hover: hover) and (pointer: fine)'),motion=matchMedia('(prefers-reduced-motion: reduce)');
  let pointer:Point|null=null,lastMove=0,lastTick=0,lastPlan=0,frame=0,angle=.7,approached=false;
  let blocks:Rect[]=[],path:Point[]=[];
  let area:Rect={left:42,top:42,right:innerWidth-42,bottom:innerHeight-42};
  try{parked=localStorage.getItem('torbie-guide-mode')!=='follow'}catch{}
  x=innerWidth-58;y=innerHeight-58;ready=true;
  function measure(){
   area={left:42,top:42,right:innerWidth-42,bottom:innerHeight-42};
   blocks=[...document.querySelectorAll('iframe,button,input,select,textarea,[role="listbox"],[role="menu"],[role="combobox"],.button,summary')]
    .filter(el=>!el.closest('.companion,#guide-panel')&&el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden')
    .map(el=>el.getBoundingClientRect()).filter(r=>r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth)
    .map(r=>({left:r.left-45,right:r.right+45,top:r.top-45,bottom:r.bottom+45}));
   const current={x,y};
   if(x<area.left||x>area.right||y<area.top||y>area.bottom||blocks.some(r=>inside(current,r))){
    const safe=safePoint(current,area,blocks);visible=!!safe;
    // If a menu opens underneath us, get out of its way before the next paint.
    if(safe){x=safe.x;y=safe.y;}path=[];
   }else visible=true;
  }
  function schedule(){if(!frame)frame=requestAnimationFrame(tick);}
  function tick(now:number){
   frame=0;const dt=Math.min(32,now-(lastTick||now-16));lastTick=now;
   if(!visible||open||parked||!canFollow||!pointer||approached)return;
   if(now-lastPlan>100){
    measure();lastPlan=now;
    if(now-lastMove<650)angle+=dt*.0018;
    const wanted={x:pointer.x+Math.cos(angle)*126,y:pointer.y+Math.sin(angle)*102};
    const goal=safePoint(wanted,area,blocks);
    path=goal?route({x,y},goal,area,blocks):[];
   }
   const next=path[0];
   if(next){const factor=1-Math.exp(-dt/130),position={x:x+(next.x-x)*factor,y:y+(next.y-y)*factor};
    if(clearPath({x,y},position,blocks)){x=position.x;y=position.y;}else path=[];
    if(distance({x,y},next)<2)path.shift();
   }
   if(path.length||now-lastMove<650)schedule();
  }
  resume=()=>{path=[];lastPlan=0;approached=false;measure();if(!parked&&pointer){lastMove=performance.now();schedule();}};
  function move(e:PointerEvent){
   if(e.pointerType!=='mouse')return;
   pointer={x:e.clientX,y:e.clientY};lastMove=performance.now();
   gazeX=Math.max(-2,Math.min(2,(pointer.x-x)/40));gazeY=Math.max(-2,Math.min(2,(pointer.y-y)/40));
   const near=distance(pointer,{x,y});
   if(near<105){approached=true;path=[];}
   else if(near>175)approached=false;
   if(!approached)schedule();
  }
  function inspect(e:Event){
   if(open||(e.target as Element)?.closest('.companion,#guide-panel'))return;
   const element=(e.target as Element)?.closest('[data-guide]');
   title=element?.getAttribute('data-guide-title')||'Explore Torbie';
   hint=element?.getAttribute('data-guide')||'Try the workspace above, or open Features to explore what Torbie can do.';
  }
  function preference(){canFollow=fine.matches&&!motion.matches&&document.documentElement.dataset.motion!=='off';measure();resume();}
  function geometry(){measure();lastPlan=0;schedule();}
  function keys(e:KeyboardEvent){if(e.key==='Escape'&&open)closeGuide();}
  const observer=new MutationObserver(geometry);observer.observe(document.body,{childList:true,subtree:true});
  const preferences=new MutationObserver(preference);preferences.observe(document.documentElement,{attributes:true,attributeFilter:['data-motion']});
  preference();
  window.addEventListener('pointermove',move);document.addEventListener('pointerover',inspect);document.addEventListener('focusin',inspect);window.addEventListener('scroll',geometry,{passive:true});window.addEventListener('resize',geometry);window.addEventListener('keydown',keys);motion.addEventListener('change',preference);fine.addEventListener('change',preference);
  return()=>{cancelAnimationFrame(frame);observer.disconnect();preferences.disconnect();window.removeEventListener('pointermove',move);document.removeEventListener('pointerover',inspect);document.removeEventListener('focusin',inspect);window.removeEventListener('scroll',geometry);window.removeEventListener('resize',geometry);window.removeEventListener('keydown',keys);motion.removeEventListener('change',preference);fine.removeEventListener('change',preference);};
 });
</script>
<div role="complementary" aria-label="Torbie guide control" hidden={!ready || !visible} bind:this={host} class="companion" class:ready class:parked={parked} style:left={`${x-29}px`} style:top={`${y-29}px`}>
 <span class="companion-label">Explore Torbie</span>
 <button class="creature" aria-label={open ? 'Close Torbie guide' : 'Open Torbie guide'} aria-expanded={open} aria-controls="guide-panel" onclick={()=>{open=!open;}}>
  <span aria-hidden="true" class="ear left"></span><span aria-hidden="true" class="ear right"></span><span aria-hidden="true" class="face"><span class="eyes" style:transform={`translate(${gazeX}px,${gazeY}px)`}><i></i><i></i></span><span class="nose"></span></span>
 </button>
</div>
{#if open}
 <aside id="guide-panel" class="guide-panel" aria-label="Torbie guide">
  <div class="guide-heading"><span class="guide-status"></span><span>Torbie guide</span><button aria-label="Close guide" onclick={()=>closeGuide()}>×</button></div>
  <h2>{title}</h2><p>{hint}</p>
  <div class="guide-bottom"><span>{canFollow ? (parked ? 'Stays where you leave it.' : 'Stops when you approach.') : 'Movement is off on this device.'}</span><button aria-pressed={!parked} disabled={!canFollow && parked} onclick={togglePark}>{parked ? 'Follow pointer' : 'Park here'}</button></div>
 </aside>
{/if}
<style>
 .companion{position:fixed;z-index:30;width:58px;height:58px;opacity:0;pointer-events:none}.companion.ready{opacity:1}.companion[hidden]{display:none}.companion-label{pointer-events:none;position:absolute;bottom:66px;right:0;width:max-content;max-width:210px;background:var(--canvas);color:var(--ink);border:1px solid var(--line);border-radius:10px 10px 2px 10px;padding:7px 10px;font-size:11px;box-shadow:0 4px 12px #0001;opacity:0}.companion:has(.creature:hover) .companion-label,.companion:has(.creature:focus-visible) .companion-label{pointer-events:none;opacity:1}.creature{pointer-events:auto;position:relative;display:block;width:58px;height:58px;border:0;background:none;cursor:pointer;padding:0;filter:drop-shadow(0 7px 9px #35231530)}
 .face{position:absolute;inset:12px 3px 2px;border-radius:48% 48% 43% 43%;overflow:hidden;background:radial-gradient(ellipse at 78% 78%,#382a26 0 23%,transparent 25%),radial-gradient(ellipse at 18% 15%,#332923 0 36%,transparent 38%),radial-gradient(ellipse at 86% 12%,#5b3828 0 18%,transparent 20%),radial-gradient(circle at 55% 40%,#e3ab70,#bd7545 65%,#8e5135);box-shadow:inset 0 -2px 3px #78412c40,inset 0 2px 2px #fff9}.ear{position:absolute;top:3px;width:21px;height:28px;background:#c38960;border:3px solid #e5b286;border-radius:5px 16px 5px 5px}.ear.left{left:4px;transform:rotate(-13deg);background:#302824;border-color:#654735}.ear.right{right:4px;transform:rotate(13deg);border-radius:16px 5px 5px 5px}.eyes{position:absolute;left:13px;top:17px;display:flex;gap:13px}.eyes i{width:5px;height:8px;background:#e8c77c;border-radius:50%;box-shadow:inset 0 0 0 1px #3b2923;position:relative}.nose{position:absolute;left:24px;top:29px;width:5px;height:3px;background:#8c4f3b;border-radius:50%}.creature:active{transform:scale(.95)}
 .eyes i::after{content:"";position:absolute;left:2px;top:1px;width:2px;height:5px;border-radius:50%;background:#241d19}.face::before{content:"";position:absolute;left:22px;top:-3px;width:3px;height:13px;background:#583526;border-radius:0 0 70% 40%;transform:rotate(13deg);box-shadow:6px -2px #583526,12px -4px #583526}.nose{background:#e6ae96;box-shadow:0 1px 1px #35251e}
 @keyframes blink{0%,42%,46%,48%,52%,100%{transform:scaleY(1)}44%,50%{transform:scaleY(.08)}}
 @keyframes ear-flick{0%,65%,73%,100%{transform:rotate(13deg)}68%{transform:rotate(23deg)}70%{transform:rotate(8deg)}}
 @keyframes breathe{0%,100%{translate:0 0}50%{translate:0 -1.5px}}
 @media(prefers-reduced-motion:no-preference){:global(html[data-motion=on]) .eyes i{animation:blink 5.6s infinite;transform-origin:center}:global(html[data-motion=on]) .ear.right{animation:ear-flick 8.3s infinite;transform-origin:bottom left}:global(html[data-motion=on]) .face{animation:breathe 3.8s ease-in-out infinite}}
 .guide-panel{position:fixed;right:28px;bottom:104px;z-index:31;width:min(340px,calc(100vw - 32px));max-height:calc(100dvh - 140px);overflow:auto;padding:20px;background:var(--canvas);border:1px solid var(--line);border-radius:20px;box-shadow:0 16px 70px #0002;transform-origin:bottom right}.guide-heading{display:flex;align-items:center;gap:8px;color:var(--muted);font-size:12px}.guide-heading button{margin-left:auto;font-size:24px;border:0;background:none;color:var(--ink);width:36px;height:36px;cursor:pointer}.guide-status{width:6px;height:6px;border-radius:50%;background:#62976b}.guide-panel h2{font-size:22px;margin:14px 0 12px}.guide-panel p{font-size:15px;line-height:1.6;margin-bottom:20px}.guide-bottom{border-top:1px solid var(--line);padding-top:12px;display:flex;align-items:center;gap:14px;font-size:11px;color:var(--muted)}.guide-bottom button{border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:8px;font:inherit;padding:8px;min-height:40px;white-space:nowrap;cursor:pointer}
 @media(prefers-reduced-motion:no-preference){.guide-panel{transition:opacity 160ms ease-out,transform 180ms cubic-bezier(.23,1,.32,1);@starting-style{opacity:0;transform:translateY(6px) scale(.97)}}.creature{transition:transform 120ms ease-out}}
 @media(max-width:650px){.guide-panel{right:16px;bottom:92px}}
</style>
