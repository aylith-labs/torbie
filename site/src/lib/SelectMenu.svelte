<script lang="ts">
 import { tick } from 'svelte';
 let { label, value, options, onchange, disabled=false }: { label: string; value: string; disabled?:boolean; options: { value: string; label: string; count?: number; disabled?: boolean }[]; onchange: (value: string) => void } = $props();
 const id = $props.id();
 const selected = $derived(options.find(option => option.value === value) ?? options[0]);
 let open = $state(false); let above=$state(false);
 let active = $state(0);
 let root: HTMLDivElement;
 let trigger: HTMLButtonElement;
 let list = $state<HTMLUListElement>();
 let typed = ''; let typedAt = 0;
 async function show(index = Math.max(0, options.findIndex(option => option.value === value))) { if(disabled)return; const bounds=trigger.getBoundingClientRect();above=innerHeight-bounds.bottom<Math.min(320,options.length*46+16)&&bounds.top>innerHeight-bounds.bottom; active = index; open = true; await tick(); list?.focus(); }
 function close(focus = false) { open = false; if(focus) trigger?.focus(); }
 function choose(index: number) { if(options[index].disabled)return; onchange(options[index].value); close(true); }
 function key(event: KeyboardEvent) {
  if(event.key === 'Tab') { close(true); return; }
  if(event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return; }
  if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
   event.preventDefault();
   if(!open) { void show(event.key === 'End' ? options.length - 1 : undefined); return; }
   active = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (active + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
   if(options[active]?.disabled){const direction=event.key==='ArrowUp'||event.key==='End'?-1:1;for(let n=0;n<options.length&&options[active]?.disabled;n++)active=(active+direction+options.length)%options.length;}
   list?.children[active]?.scrollIntoView({block:'nearest'}); return;
  }
  if(open && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); choose(active); return; }
  if(event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && event.key !== ' ') {
   event.preventDefault(); const now = Date.now(); typed = now - typedAt > 650 ? event.key : typed + event.key; typedAt = now;
   const index = options.findIndex(option => !option.disabled && option.label.toLowerCase().startsWith(typed.toLowerCase()));
   if(index >= 0) { if(open) { active = index; list?.children[index]?.scrollIntoView({block:'nearest'}); } else void show(index); }
  }
 }
</script>
<svelte:window onpointerdown={event => { if(open && !root?.contains(event.target as Node)) close(); }} />
<div class="select-menu" bind:this={root} onfocusout={event => { if(!root?.contains(event.relatedTarget as Node)) close(); }}>
 <span id={`${id}-label`} class="select-label">{label}</span>
 <button bind:this={trigger} type="button" class="select-trigger" {disabled} aria-labelledby={`${id}-label ${id}-value`} aria-haspopup="listbox" aria-expanded={open} aria-controls={`${id}-list`} onclick={() => open ? close() : show()} onkeydown={key}>
  <span id={`${id}-value`}>{selected.label}</span>{#if selected.count !== undefined}<span class="count-badge">{selected.count}</span>{/if}
  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16"><path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
 </button>
 {#if open}
  <ul bind:this={list} id={`${id}-list`} class="select-options" class:above role="listbox" tabindex="0" aria-labelledby={`${id}-label`} aria-activedescendant={`${id}-option-${active}`} onkeydown={key}>
   {#each options as option, index}
    <li id={`${id}-option-${index}`} role="option" aria-selected={option.value === value} aria-disabled={option.disabled || undefined} class:active={active === index} onpointermove={() => active = index} onclick={() => choose(index)} onkeydown={event => { event.stopPropagation(); key(event); }}>
     <span>{option.label}</span>{#if option.count !== undefined}<span class="count-badge">{option.count}</span>{/if}<span class="selected-mark" aria-hidden="true">{option.value === value ? '✓' : ''}</span>
    </li>
   {/each}
  </ul>
 {/if}
</div>
<style>
 .select-menu{position:relative;min-width:0;font-size:14px}.select-label{display:block;margin-bottom:8px}.select-trigger{display:flex;align-items:center;gap:10px;min-height:48px;width:100%;padding:12px 14px;border:1px solid var(--line);border-radius:8px;background:var(--canvas);color:var(--ink);font:inherit;text-align:left;cursor:pointer}.select-trigger>svg{margin-left:auto;flex-shrink:0}.count-badge{display:inline-grid;place-items:center;min-width:25px;height:23px;padding:0 6px;border:1px solid var(--line);border-radius:7px;font-size:12px;font-variant-numeric:tabular-nums;color:var(--muted);background:var(--panel);line-height:1}.select-options{position:absolute;z-index:40;top:calc(100% + 6px);left:0;min-width:100%;width:max-content;max-width:calc(100vw - 40px);max-height:320px;overflow-y:auto;overscroll-behavior:contain;list-style:none;padding:5px;margin:0;background:var(--canvas);color:var(--ink);border:1px solid var(--line);border-radius:12px;box-shadow:0 12px 32px #0002}.select-options.above{top:auto;bottom:calc(100% + 6px)}.select-trigger:disabled{opacity:.55;cursor:wait}.select-options li{display:flex;align-items:center;gap:14px;min-height:42px;padding:8px 10px;border-radius:7px;cursor:pointer;font-size:14px}.select-options li[aria-disabled=true]{opacity:.5;cursor:default}.select-options li.active{background:var(--panel);outline:1px solid var(--line);outline-offset:-1px}.select-options li>span:first-child{flex:1}.selected-mark{width:14px;color:var(--accent);font-size:14px}.select-trigger:focus-visible,.select-options:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
@media(max-width:650px){.select-menu{flex:1}.select-options{width:100%;min-width:190px}.select-menu:last-child .select-options{left:auto;right:0}}
</style>
