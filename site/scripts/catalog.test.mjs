import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
test('catalogue provides unique routes and commit evidence', () => {
 const sandbox={window:{}}; vm.createContext(sandbox);
 for(const file of ['features.js','feature-details.js']) vm.runInContext(readFileSync(`../docs/${file}`,'utf8'),sandbox);
 const {FEATURES,FEATURE_DETAILS}=sandbox.window;
 assert.equal(new Set(FEATURES.map(f=>f.id)).size,FEATURES.length);
 for(const f of FEATURES) { assert.match(f.id,/^[a-z0-9-]+$/); assert.ok(f.commits.length); assert.ok(FEATURE_DETAILS[f.id]); }
});

test('release lookup filters metadata and identifies all platforms', async () => {
 const { latestRelease } = await import('../src/lib/server/releases.ts');
 const original=globalThis.fetch;
 try {
  globalThis.fetch=async()=>new Response(JSON.stringify({tag_name:'test',html_url:'https://github.com/aylith-labs/torbie/releases',assets:['torbie-test-linux-armv7l.tar.gz','torbie-test-macos-arm64.dmg','torbie-test-setup-x64.exe','latest.yml','torbie-test-setup-x64.exe.blockmap'].map(name=>({name,size:100,browser_download_url:`https://github.com/aylith-labs/torbie/releases/download/test/${name}`}))}));
  const release=await latestRelease();
  assert.equal(release.assets.length,3);
  assert.deepEqual(release.assets.map(a=>[a.platform,a.arch,a.format]),[['Linux','armv7l','tar.gz'],['macOS','arm64','dmg'],['Windows','x64','exe']]);
 } finally { globalThis.fetch=original; }
});
test('release API failures retain the public recovery link', async () => {
 const { latestRelease,releasesUrl }=await import('../src/lib/server/releases.ts');
 const original=globalThis.fetch;
 try { globalThis.fetch=async()=>new Response('',{status:503});const release=await latestRelease();assert.equal(release.available,false);assert.equal(release.url,releasesUrl);assert.deepEqual(release.assets,[]); } finally { globalThis.fetch=original; }
});
