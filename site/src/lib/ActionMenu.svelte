<script lang="ts">
 import {autoUpdate,computePosition,offset,flip,shift} from '@floating-ui/dom';
 import Icon from './Icon.svelte';
 let {label,options,onchange,disabled=false,caretOnly=false,placement='top-start'}:{label:string;options:{value:string;label:string}[];onchange:(value:string)=>void;disabled?:boolean;caretOnly?:boolean;placement?:'top-start'|'bottom-end'}=$props();
 let open=$state(false),trigger:HTMLButtonElement,root:HTMLDivElement;let panel=$state<HTMLDivElement>();
 function toggle(){open=!open}
 function close(focus=false){open=false;if(focus)trigger.focus()}
 function anchor(node:HTMLElement){let mounted=true,positioned=false;const cleanup=autoUpdate(trigger,node,()=>{void computePosition(trigger,node,{strategy:'fixed',placement,middleware:[offset(8),flip({padding:12}),shift({padding:12})]}).then(({x,y})=>{if(mounted){Object.assign(node.style,{left:`${x}px`,top:`${y}px`,visibility:'visible'});if(!positioned){positioned=true;node.querySelector('button')?.focus()}}})});return {destroy(){mounted=false;cleanup()}}}
 function key(e:KeyboardEvent){if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close(true)}if(e.key==='Tab')close();if(['ArrowDown','ArrowUp','Home','End'].includes(e.key)){e.preventDefault();const items=[...panel?.querySelectorAll('button')||[]],i=items.indexOf(document.activeElement as HTMLButtonElement);items[e.key==='Home'?0:e.key==='End'?items.length-1:(i+(e.key==='ArrowDown'?1:-1)+items.length)%items.length]?.focus()}}
</script>
<svelte:window onpointerdown={e=>{if(open&&!root.contains(e.target as Node))close()}}/>
<div bind:this={root} class="action-menu" class:caret-only={caretOnly} onfocusout={e=>{if(!root.contains(e.relatedTarget as Node))close()}}>
 <button bind:this={trigger} {disabled} aria-label={label} aria-haspopup="menu" aria-expanded={open} onclick={toggle} onkeydown={e=>{if(open)key(e)}}>{#if !caretOnly}{label}{/if}<Icon name="chevron"/></button>
 {#if open}<div use:anchor bind:this={panel} class="menu" role="menu" aria-label={label} tabindex="-1" onkeydown={key}>{#each options as option}<button role="menuitem" onclick={()=>{close(true);onchange(option.value)}}>{option.label}</button>{/each}</div>{/if}
</div>
<style>
 .action-menu{display:inline-flex}button{display:inline-flex;align-items:center;justify-content:center;gap:8px;height:38px;min-height:38px;line-height:18px;padding:9px 12px;border:1px solid var(--line);border-radius:8px;background:var(--canvas);color:var(--ink);font:inherit;font-size:12px;cursor:pointer;white-space:nowrap}.caret-only>button{width:36px;padding:0;border-radius:0 8px 8px 0;border-left:0}button:disabled{opacity:.55;cursor:wait}.menu{position:fixed;visibility:hidden;z-index:80;width:210px;padding:5px;background:var(--canvas);border:1px solid var(--line);border-radius:10px;box-shadow:0 10px 35px #0002}.menu button{width:100%;justify-content:flex-start;border:0;background:none}.menu button:hover,.menu button:focus-visible{background:var(--panel)}
</style>
