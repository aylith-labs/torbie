import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
const root=resolve(process.argv[2] || 'build');
const base=process.env.BASE_PATH ?? '/torbie';
function walk(dir) {return readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(join(dir,e.name)):[join(dir,e.name)]);}
const failures=[];
for(const file of walk(root).filter(f=>f.endsWith('.html')&&!f.endsWith('404.html'))) {
 const html=readFileSync(file,'utf8');
 for(const match of html.matchAll(/(?:href|src)="([^"#]+)"/g)) {
  const raw=match[1];if(!raw.startsWith('/'))continue;
  if(base && raw!==base && !raw.startsWith(`${base}/`)) {failures.push(`${file}: missing base: ${raw}`);continue;}
  const path=decodeURIComponent(raw.split(/[?#]/)[0].slice(base.length));
  const target=join(root,path);
  if(!existsSync(target)&&!existsSync(join(target,'index.html')))failures.push(`${file}: missing ${raw}`);
 }
}
if(failures.length){console.error(failures.join('\n'));process.exitCode=1;} else console.log('All prerendered internal links and assets exist.');
