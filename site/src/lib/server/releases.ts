export interface Asset { name: string; browser_download_url: string; size: number; platform: string; arch: string; format: string }
export const releasesUrl = 'https://github.com/aylith-labs/torbie/releases';
export async function latestRelease() {
 try {
  const response = await fetch('https://api.github.com/repos/aylith-labs/torbie/releases/latest', { headers: { Accept: 'application/vnd.github+json', ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Release API returned ${response.status}`);
  const release = await response.json();
  const assets: Asset[] = release.assets.filter((a: Asset) => /\.(exe|zip|dmg|AppImage|deb|rpm|pacman|tar\.gz)$/.test(a.name)).map((a: Asset) => ({ name: a.name, browser_download_url: a.browser_download_url, size: a.size, platform: a.name.includes('macos') ? 'macOS' : a.name.includes('linux') ? 'Linux' : 'Windows', arch: a.name.includes('arm64') ? 'arm64' : a.name.includes('armv7l') ? 'armv7l' : 'x64', format: a.name.endsWith('.tar.gz') ? 'tar.gz' : a.name.split('.').pop() }));
  return { version: release.tag_name as string, url: release.html_url as string, assets, available: true };
 } catch (error) { console.warn('Release API unavailable; linking to releases.', error instanceof Error ? error.message : 'Unknown error'); return { version: '', url: releasesUrl, assets: [] as Asset[], available: false }; }
}
