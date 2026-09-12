import {chromium,expect} from '@playwright/test';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
const url=process.env.REVIEW_URL||'http://127.0.0.1:5870/torbie/';
import {mkdir} from 'node:fs/promises';
await mkdir('.review',{recursive:true});
const results=[];
for(const width of [1440,390]){
 const page=await browser.newPage({viewport:{width,height:1000},colorScheme:'light'});const errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>{if(!r.failure()?.errorText.includes('ERR_ABORTED'))errors.push(r.url()+': '+r.failure()?.errorText)});page.on('request',r=>requests.push(r.url()));
 const start=Date.now();await page.goto(url,{waitUntil:'domcontentloaded'});await expect(page.locator('h1')).toContainText('Give your agents room');
 await page.locator('.live-preview').scrollIntoViewIfNeeded();const enable=page.getByRole('button',{name:'Enable Claude Code',exact:true});await expect(enable).toBeEnabled({timeout:30000});const readyMs=Date.now()-start;
 const frame=page.frameLocator('.preview-window iframe');await expect(frame.locator('demo-terminal')).toHaveCount(1);
 await page.getByRole('button',{name:'Shefrd',exact:true}).click();await expect(frame.locator('body')).toContainText('SHEFRD');
 await frame.locator('demo-terminal').last().click();await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');await expect(frame.locator('body')).toContainText('Selected agent: Codex');
 for(const name of ['Polygit','Neovim','btop','Vite dev server','Playwright','Codex','Claude Code']){await page.getByRole('button',{name,exact:true}).click()}
 await enable.click();await expect(frame.locator('body')).toContainText('Build the workspace');await expect(page.getByRole('button',{name:'Disable Claude Code',exact:true})).toBeVisible();
 await page.screenshot({path:`.review/angular-integrated-${width}-light.png`});
 await page.getByRole('button',{name:'Disable Claude Code',exact:true}).click();
 await page.getByRole('button',{name:'Split a test pane',exact:false}).click();await expect(frame.locator('demo-terminal')).toHaveCount(9);
 await page.getByRole('button',{name:'Run checks',exact:false}).click();await expect(frame.locator('body')).toContainText('18 passed');
 await page.getByRole('button',{name:'Plugins',exact:false}).click();const toggle=frame.getByRole('switch',{name:'Enable Claude Code',exact:true});await expect(toggle).toBeVisible();await expect.poll(()=>toggle.evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth})).toBe(true);await toggle.click();await expect(page.getByRole('button',{name:'Disable Claude Code',exact:true})).toBeVisible();
 await page.evaluate(()=>document.documentElement.dataset.theme='dark');await expect.poll(()=>frame.locator('body').evaluate(e=>getComputedStyle(e).backgroundColor)).not.toBe('rgb(255, 255, 255)');await page.waitForTimeout(400);
 await page.getByRole('button',{name:'Claude Code',exact:true}).click();await page.screenshot({path:`.review/angular-integrated-${width}-dark.png`});
 const state=await frame.locator('body').evaluate(()=>({theme:window.demo.config.store.appearance.colorSchemeMode,tabs:window.demo.app.tabs.length,overflow:document.documentElement.scrollWidth>innerWidth}));
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
 results.push({width,readyMs,state,overflow,errors,externalRequests:requests.filter(u=>!u.startsWith(new URL(url).origin)&&!u.startsWith('data:'))});
 await page.close();
}
console.log(JSON.stringify(results,null,2));await browser.close();
if(results.some(r=>r.overflow||r.errors.length||r.externalRequests.length||r.state.theme!=='auto'))process.exitCode=1;
