<script lang="ts">
 import '../app.css';
 import { base } from '$app/paths';
 import { onMount } from 'svelte';
 let { children } = $props();
 let theme = $state('system');
 onMount(() => { try { theme = localStorage.getItem('theme') || 'system'; } catch {} });
 function setTheme() { if (theme === 'system') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = theme; try { localStorage.setItem('theme', theme); } catch {} }
</script>
<a class="skip" href="#main">Skip to content</a>
<header class="site-header wrap"><a class="wordmark" href={`${base}/`} aria-label="Torbie home"><img src={`${base}/favicon.svg`} alt="" width="32" height="32" />Torbie</a><nav aria-label="Main"><a href={`${base}/features/`}>Features</a><a href={`${base}/download/`}>Download</a></nav></header>
<main id="main" tabindex="-1">{@render children()}</main>
<footer class="wrap"><a href="https://aylith.com">An Aylith project</a><span>© {new Date().getFullYear()} The Aylith Authors</span><label>Theme <select bind:value={theme} onchange={setTheme}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label><a href="https://github.com/aylith-labs/torbie">Source</a></footer>
