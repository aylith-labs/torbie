import {chromium,expect} from '@playwright/test';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
const url=process.env.REVIEW_URL||'http://127.0.0.1:5870/torbie/';
try {
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
 page.on('pageerror',e=>{errors.push(e.message);console.error(e.stack)});
 await page.goto(url);const cat=page.locator('.companion');
 await expect(cat).not.toHaveClass(/parked/);
 await page.mouse.move(600,160);const start=await cat.boundingBox();
 await expect.poll(async()=>{const r=await cat.boundingBox();return Math.hypot(r.x-start.x,r.y-start.y)}).toBeGreaterThan(100);
 await page.getByRole('button',{name:'Open Torbie guide',exact:true}).click();
 const panel=page.getByRole('complementary',{name:'Torbie guide',exact:true});await expect(panel).toBeVisible();
 const c=await cat.boundingBox(),p=await panel.boundingBox();
 expect(Math.min(Math.abs(c.y-p.y-p.height),Math.abs(p.y-c.y-c.height))).toBeLessThan(20);
 expect(p.x).toBeGreaterThanOrEqual(12);expect(p.x+p.width).toBeLessThanOrEqual(1428);
 await expect(panel).not.toContainText('workspace above');await expect(panel.getByRole('link',{name:'Explore features'})).toHaveAttribute('href',/\/features\/$/);
 await page.mouse.move(200,800);await page.mouse.wheel(0,300);await page.waitForTimeout(200);expect(await cat.boundingBox()).toEqual(c);
 await page.getByRole('button',{name:'Try Torbie in your browser',exact:true}).click();await expect(page.locator('.live-preview')).toHaveAttribute('data-view','fullscreen');await expect(panel).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Plugins',exact:true})).toBeEnabled({timeout:30000});
 const frame=page.frameLocator('.preview-window iframe');
 const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
 const times=[];
 for(const name of ['Shefrd','Polygit','Codex','Neovim','btop','Claude Code','Shefrd']){
  const t=Date.now();await page.getByRole('button',{name,exact:true}).click();
  await expect(page.getByRole('button',{name,exact:true})).toHaveAttribute('aria-pressed','true',{timeout:2000});
  await expect.poll(()=>frame.locator('body').evaluate(()=>window.demo.app.activeTab.title),{timeout:2000}).toContain(name);
  times.push({name,ms:Date.now()-t});
 }
 await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});
 // Use the actual close control as soon as a newly opened tab exposes it.
 // Calling AppService.closeTab before Angular creates the view is not a UI action.
 async function closeLastTab(){const header=frame.locator('tab-header').last();await header.hover();await header.locator('.buttons button').last().click();}
 while(await frame.locator('tab-header').count())await closeLastTab();
 for(let i=0;i<8;i++){
  await page.getByRole('button',{name:i%2?'Codex':'Claude Code',exact:true}).click();
  await expect(frame.locator('tab-header')).toHaveCount(1);await closeLastTab();
  await expect(frame.locator('tab-header')).toHaveCount(0);
 }
 await page.waitForTimeout(1200);await expect(frame.locator('demo-terminal')).toHaveCount(0);
 const controls=await page.locator('.preview-actions button:visible').evaluateAll(nodes=>nodes.map(n=>({height:n.getBoundingClientRect().height,center:n.getBoundingClientRect().y+n.getBoundingClientRect().height/2})));
 expect(controls.length).toBe(6);for(const r of controls){expect(r.height).toBe(38);expect(Math.abs(r.center-controls[0].center)).toBeLessThan(1)}
 await page.getByRole('button',{name:'Exit full screen',exact:true}).click();
 // Sample actual painted positions during large scroll changes. No single frame may teleport.
 const maxStep=await page.evaluate(async()=>{
  const el=document.querySelector('.companion');let previous=el.getBoundingClientRect(),max=0;
  for(let i=0;i<100;i++){
   if(i%15===0)window.scrollTo(0,i%30===0?0:document.body.scrollHeight);
   await new Promise(requestAnimationFrame);const r=el.getBoundingClientRect();max=Math.max(max,Math.hypot(r.x-previous.x,r.y-previous.y));previous=r;
  }return max;
 });expect(maxStep).toBeLessThanOrEqual(11);
 await page.evaluate(()=>window.scrollTo(0,0));await page.getByRole('button',{name:'Open Torbie guide',exact:true}).click();await page.getByRole('button',{name:'Park here',exact:true}).click();
 await page.reload();await expect(cat).toHaveClass(/parked/);
 expect(errors).toEqual([]);console.log(JSON.stringify({scenarioLatency4xCPU:times,maxGuideStep:maxStep,toolbar:'six aligned controls',guide:'anchored, frozen while open, follow default, parked preference persists'},null,2));
 await page.close();
}finally{await browser.close()}
