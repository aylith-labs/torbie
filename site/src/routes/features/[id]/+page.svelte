<script lang="ts">import { base } from '$app/paths'; let { data } = $props(); const f = $derived(data.feature); const d = $derived(data.detail);</script>
<svelte:head><title>{f.title} · Torbie</title><meta name="description" content={f.desc} /></svelte:head>
<article class="wrap detail"><a href={`${base}/features/`}>All features</a><h1>{f.title}</h1><p class="lead">{f.desc}</p><div class="diffstat"><span>{f.catLabel}</span><span>Added {f.dateAdded}</span><span>{f.files} {f.files === 1 ? 'file' : 'files'}</span><span>+{f.ins.toLocaleString('en')} / −{f.del.toLocaleString('en')} lines</span></div>
{#if d.problem}<section><h2>The problem</h2><p>{@html d.problem}</p></section>{/if}
{#if d.how}<section><h2>How it works</h2><p>{@html d.how}</p></section>{/if}
{#if d.steps?.length}<section><h2>Try it</h2><ol>{#each d.steps as step}<li>{@html step}</li>{/each}</ol></section>{/if}
{#if d.settings?.length}<section><h2>Settings</h2><ul>{#each d.settings as setting}<li><code>{setting.key}</code>: <code>{setting.def}</code>{#if setting.note}<p>{@html setting.note}</p>{/if}</li>{/each}</ul></section>{/if}
{#if d.sample}<section><h2>{d.sample.label}</h2><pre>{d.sample.text}</pre></section>{/if}
{#if d.notes?.length}<section><h2>Details</h2><ul>{#each d.notes as note}<li>{@html note}</li>{/each}</ul></section>{/if}
<section class="caveats"><h2>What this does not claim</h2><ul>{#each d.caveats || [] as caveat}<li>{@html caveat}</li>{:else}<li>The source catalogue records no separate caveats for this entry. The implementation and evidence above define its scope.</li>{/each}</ul></section>
{#if d.upstream}<section><h2>In upstream Tabby</h2><p>{@html d.upstream}</p></section>{/if}
<section><h2>Source commits</h2><div class="commits">{#each f.commits as sha}<a href={`https://github.com/aylith-labs/torbie/commit/${sha}`}><code>{sha}</code></a>{/each}</div></section></article>
