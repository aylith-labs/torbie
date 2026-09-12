/** Build committed Torbie UI in isolation: never install desktop/native dependencies. */
import {mkdtemp,cp,symlink,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
const here=path.dirname(fileURLToPath(import.meta.url)),root=path.resolve(here,'../..');
const work=await mkdtemp(path.join(tmpdir(),'torbie-browser-'));
function run(command,args,cwd=work){return new Promise((resolve,reject)=>{const child=spawn(command,args,{cwd,stdio:'inherit'});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`${command} exited ${code}`)))})}
try {
 const archive=path.join(work,'source.tar');
 await run('git',['archive','--output',archive,'HEAD','app/src','app/assets','app/index.pug','tabby-core','tabby-terminal','tabby-settings','tabby-web','tabby-claude','tabby-local','tsconfig.json','locale'],root);
 await run('tar',['-xf',archive]);
 const preview=path.join(work,'site/preview');
 await cp(here,preview,{recursive:true,filter:source=>!['node_modules','dist'].includes(path.basename(source))});
 for(const folder of ['', 'site/preview','tabby-terminal','tabby-settings']) {
  await symlink(path.join(here,'node_modules'),path.join(work,folder,'node_modules'),'dir');
 }
 await run(process.execPath,[path.join(here,'node_modules/webpack/bin/webpack.js'),'--config',path.join(preview,'webpack.config.mjs')]);
 await run(process.execPath,[path.join(preview,'html.mjs')]);
 await rm(path.join(here,'dist'),{recursive:true,force:true});
 await mkdir(path.join(here,'dist'),{recursive:true});
 await cp(path.join(preview,'dist'),path.join(here,'dist'),{recursive:true});
} finally {await rm(work,{recursive:true,force:true})}
