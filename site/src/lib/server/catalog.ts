import { readFileSync } from 'node:fs';
import vm from 'node:vm';
export interface Feature { id: string; title: string; cat: string; catLabel: string; dateAdded: string; desc: string; files: number; ins: number; del: number; commits: string[] }
export interface Detail { problem?: string; how?: string; steps?: string[]; settings?: { key: string; def: string; note?: string }[]; sample?: { label: string; text: string }; notes?: string[]; caveats?: string[]; upstream?: string }
const sandbox = { window: {} as { FEATURES: Feature[]; FEATURE_DETAILS: Record<string, Detail> } };
vm.createContext(sandbox);
for (const file of ['features.js', 'feature-details.js']) vm.runInContext(readFileSync(`../docs/${file}`, 'utf8'), sandbox, { filename: file, timeout: 1000 });
// Normalize cross-realm objects before SvelteKit serializes them.
export const features: Feature[] = JSON.parse(JSON.stringify(sandbox.window.FEATURES));
export const details: Record<string, Detail> = JSON.parse(JSON.stringify(sandbox.window.FEATURE_DETAILS));

// Preserve the upstream history while keeping public code links in this repo.
const punctuation = details['url-punctuation'];
const punctuationCommit = features.find(feature => feature.id === 'url-punctuation')?.commits[0];
if (punctuation?.upstream && punctuationCommit) punctuation.upstream = punctuation.upstream.replace(/<a href="https:\/\/github\.com\/Eugeny\/tabby\/pull\/11383">Eugeny\/tabby#11383<\/a>/g, `upstream pull request #11383 (<a href="https://github.com/aylith-labs/torbie/commit/${punctuationCommit}">local implementation</a>)`);
