<script lang="ts">
 import SelectMenu from '$lib/SelectMenu.svelte';
 import { browser } from '$app/environment'; import { base } from '$app/paths'; import { page } from '$app/state'; import { goto } from '$app/navigation';
 let { data } = $props();
 const categories = $derived([...new Map(data.features.map(f => [f.cat, f.catLabel])).entries()]);
 const query = $derived((browser ? page.url.searchParams.get('q') : '') || ''); const category = $derived((browser ? page.url.searchParams.get('category') : '') || ''); const sort = $derived((browser ? page.url.searchParams.get('sort') : '') || 'newest');
 const matches = $derived(data.features.filter(f => `${f.title} ${f.desc}`.toLowerCase().includes(query.toLowerCase())));
 const categoryOptions = $derived([{value:'',label:'All categories',count:matches.length}, ...categories.map(([value,label]) => ({value,label,count:matches.filter(f => f.cat === value).length}))]);
 const filtered = $derived(data.features.filter(f => (!category || f.cat === category) && `${f.title} ${f.desc}`.toLowerCase().includes(query.toLowerCase())).sort((a,b) => sort === 'title' ? a.title.localeCompare(b.title) : sort === 'oldest' ? a.dateAdded.localeCompare(b.dateAdded) : b.dateAdded.localeCompare(a.dateAdded)));
 function change(key: string, value: string) { const url = new URL(page.url); if (value) url.searchParams.set(key, value); else url.searchParams.delete(key); goto(url, { replaceState: true, noScroll: true, keepFocus: true }); }
</script>
<svelte:head><title>Features · Torbie</title><meta name="description" content="Every Torbie feature, with its source commits, diffstat and stated limits." /></svelte:head>
<div class="wrap index-page"><h1>Features, with evidence.</h1><p>{data.features.length} features across {categories.length} categories. Every entry links to the commits that shipped it.</p>
<form class="filters" onsubmit={event => event.preventDefault()} role="search"><label>Search features<input name="q" type="search" value={query} oninput={event => change('q',event.currentTarget.value)} placeholder="Search by name or behaviour" /></label><SelectMenu label="Category" value={category} options={categoryOptions} onchange={value => change('category',value)} /><SelectMenu label="Sort" value={sort} options={[{value:'newest',label:'Newest first'},{value:'oldest',label:'Oldest first'},{value:'title',label:'Title A–Z'}]} onchange={value => change('sort',value)} /></form>
<p aria-live="polite" class="result-count">{filtered.length} {filtered.length === 1 ? 'feature' : 'features'}</p>
<div class="feature-list">{#each filtered as feature}<article><div><h2><a href={`${base}/features/${feature.id}/`}>{feature.title}</a></h2><details class="feature-peek" data-guide-title={feature.title} data-guide={feature.desc}><summary>Quick look <span aria-hidden="true">+</span></summary><p>{feature.desc}</p></details></div><span>{feature.catLabel}</span></article>{:else}<div class="empty"><h2>No features match.</h2><p>Try a different phrase or clear the filters.</p><a href={`${base}/features/`}>Clear filters</a></div>{/each}</div></div>
