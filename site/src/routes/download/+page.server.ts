import { latestRelease } from '$lib/server/releases';
export async function load() { return { release: await latestRelease() }; }
