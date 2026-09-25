import {chromium,expect} from '@playwright/test';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
try {
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(process.env.REVIEW_URL||'http://127.0.0.1:5870/torbie/');
 await page.locator('.live-preview').scrollIntoViewIfNeeded();
 await expect(page.getByRole('button',{name:'Plugins',exact:true})).toBeEnabled({timeout:30000});
 const frame=page.frameLocator('.preview-window iframe');
 await frame.locator('body').evaluate(()=>window.demo.app.zone.run(async()=>{for(const tab of [...window.demo.app.tabs])await window.demo.app.closeTab(tab)}));
 for(const [language,label] of [['de-DE','Ein Problem melden'],['en-US','Report a problem']]){
  await frame.locator('body').evaluate((_,language)=>window.demo.app.zone.run(async()=>{window.demo.config.store.language=language;await window.demo.config.save()}),language);
  await expect(frame.locator('start-page')).toContainText(label);
 }
 const fallback=await frame.locator('body').evaluate(()=>window.demo.config.translate.instant('Hello {name}',{name:'Ada'}));expect(fallback).toBe('Hello Ada');
 expect(errors).toEqual([]);console.log('Translation migration: live German/English switching passed.');
}finally{await browser.close()}
