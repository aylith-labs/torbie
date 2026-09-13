import {chromium,expect} from '@playwright/test';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
const url=process.env.REVIEW_URL||'http://127.0.0.1:5870/torbie/';
try {
 for(const width of [1440,390]){
  const page=await browser.newPage({viewport:{width,height:1000},colorScheme:width===390?'dark':'light'});page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{HTMLElement.prototype.requestFullscreen=async()=>{window.__nativeFullscreenCalled=true;throw new Error('Native fullscreen must not be used')}});
  await page.goto(url);const preview=page.locator('.live-preview'),frame=page.frameLocator('.preview-window iframe');
  await page.getByRole('button',{name:'Try it here'}).click();await expect(preview).toHaveAttribute('data-view','fullscreen');
  await expect(page.getByRole('button',{name:'Plugins',exact:true})).toBeEnabled({timeout:30000});
  for(const label of ['More split options','View options']){await page.getByRole('button',{name:label,exact:true}).click();await expect(page.getByRole('menuitem').first()).toBeFocused();await page.keyboard.press('Escape');await expect(page.getByRole('menu')).toHaveCount(0);await expect(preview).toHaveAttribute('data-view','fullscreen');}
  await expect(page.locator('.preview-apps')).toBeVisible();await expect(page.locator('.preview-actions')).toBeVisible();
  await frame.locator('body').evaluate(()=>{window.__viewIdentity='same running workspace'});
  await page.getByRole('button',{name:'Polygit',exact:true}).click();await expect(frame.locator('demo-terminal')).toHaveCount(2);const count=2;
  await page.getByRole('button',{name:'View options',exact:true}).click();await page.getByRole('menuitem',{name:'Immersive · app only',exact:true}).click();await expect(preview).toHaveAttribute('data-view','immersive');
  for(const selector of ['.preview-heading','.preview-apps','.preview-actions','.preview-footnote'])await expect(page.locator(selector)).toBeHidden();
  await expect(preview.locator('button:visible')).toHaveCount(1);
  const exit=page.getByRole('button',{name:'Exit immersive view'});await expect(exit).toBeVisible();await expect(page.locator('.preview-window iframe')).toBeFocused();
  const bounds=await page.locator('.preview-window iframe').boundingBox();expect(bounds).toEqual({x:0,y:0,width,height:1000});
  const button=await exit.boundingBox();expect(button.x+button.width).toBeGreaterThan(width-30);expect(button.y).toBeLessThan(30);
  expect(await frame.locator('body').evaluate(()=>window.__viewIdentity)).toBe('same running workspace');await expect(frame.locator('demo-terminal')).toHaveCount(count);
  await page.keyboard.type('help');await page.keyboard.press('Enter');await expect(frame.locator('body')).toContainText('Try: claude');
  await page.screenshot({path:`.review/immersive-${width}.png`});
  await exit.click();await expect(preview).toHaveAttribute('data-view','inline');await expect(page.getByRole('button',{name:'Try it here'})).toBeFocused();
  await page.getByRole('button',{name:'View options',exact:true}).click();await page.getByRole('menuitem',{name:'Immersive · app only',exact:true}).click();await frame.locator('demo-terminal').last().click();await page.keyboard.press('Escape');await expect(preview).toHaveAttribute('data-view','immersive');await page.keyboard.press('Shift+Escape');await expect(preview).toHaveAttribute('data-view','inline');
  await page.getByRole('button',{name:'Full screen',exact:false}).click();await expect(preview).toHaveAttribute('data-view','fullscreen');await page.getByRole('button',{name:'Exit full screen'}).click();await expect(preview).toHaveAttribute('data-view','inline');
  expect(await page.evaluate(()=>document.body.style.overflow)).not.toBe('hidden');
  expect(await frame.locator('body').evaluate(()=>window.__viewIdentity)).toBe('same running workspace');expect(await page.evaluate(()=>window.__nativeFullscreenCalled)).toBeUndefined();expect(errors).toEqual([]);await page.close();
 }
 console.log('Full screen and app-only immersive: desktop/mobile, fallback, workspace preservation, button and iframe Shift+Escape exits passed.');
} finally {await browser.close()}
