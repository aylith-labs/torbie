import {chromium,expect} from '@playwright/test';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
const url=process.env.REVIEW_URL||'http://127.0.0.1:5870/torbie/';
const page=await browser.newPage({viewport:{width:1440,height:1000},colorScheme:'light'});
page.setDefaultTimeout(15000);
const errors=[];page.on('pageerror',error=>errors.push(error.message));
const frame=page.frameLocator('.preview-window iframe');
const ready=()=>expect(page.getByRole('button',{name:'Plugins',exact:true})).toBeEnabled({timeout:30000});
try {
 await page.goto(url);
 await page.getByRole('button',{name:'Try it here'}).click();
 await expect(page.locator('.live-preview')).toHaveClass(/immersive/);await ready();
 const bounds=await page.locator('.live-preview').boundingBox();expect(bounds.height).toBe(1000);
 await expect(page.locator('.preview-footnote')).toBeInViewport();
 await page.getByRole('button',{name:'MCP activity',exact:true}).hover();await expect(page.getByRole('region',{name:'MCP activity'})).toBeVisible();
 for(const name of ['Polygit','Shefrd','Codex'])await page.getByRole('button',{name,exact:true}).click();
 for(const value of ['Right','Bottom','Top']){
  await page.locator('.tab-location button').click();await page.getByRole('option',{name:value,exact:true}).click();
  await expect.poll(()=>frame.locator('body').evaluate(()=>window.demo.config.store.appearance.tabsLocation)).toBe(value.toLowerCase());
 }
 await page.getByRole('button',{name:'More split options'}).click();await page.getByRole('menuitem',{name:'Test pane below',exact:true}).click();await expect(frame.locator('demo-terminal')).toHaveCount(5);
 await page.getByRole('button',{name:'Exit immersive view'}).click();await expect(page.locator('.live-preview')).not.toHaveClass(/immersive/);
 await page.getByRole('button',{name:'Plugins',exact:true}).click();await expect(frame.locator('demo-plugins')).toContainText('Plugins 13');
 await expect.poll(()=>page.evaluate(()=>JSON.parse(sessionStorage.getItem('torbie-preview-tabs-v1')||'[]').length)).toBe(4);
 await page.goto(new URL('features/torbie/',url).href);await page.locator('.live-preview').scrollIntoViewIfNeeded();await ready();
 await expect(frame.locator('demo-terminal')).toHaveCount(5);
 for(const name of ['Polygit','Shefrd','Codex','Claude Code'])await expect(frame.locator('tab-header').filter({hasText:name}).first()).toBeVisible();
 await expect(page.locator('.tab-location button')).toContainText('Top');
 await expect(page.getByText('There is no version gate',{exact:false}).first()).not.toBeVisible();
 await page.locator('summary').filter({hasText:'Technical background'}).click();await expect(page.locator('details[open]')).toContainText('tabby-');
 await page.evaluate(()=>document.documentElement.dataset.theme='dark');await expect.poll(()=>frame.locator('html').getAttribute('data-preview-theme')).toBe('dark');
 await page.evaluate(()=>document.documentElement.dataset.theme='light');await expect.poll(()=>frame.locator('html').getAttribute('data-preview-theme')).toBe('light');
 await page.getByRole('button',{name:'Reset demo'}).click();await ready();await expect(frame.locator('demo-terminal')).toHaveCount(1);await expect(page.locator('.tab-location button')).toContainText('Left');
 // The restored feature settings view must have a real content pane.
 await expect(frame.locator('settings-tab .tab-content')).not.toBeEmpty();
 await frame.locator('settings-tab a').filter({hasText:/^Application$/}).click();
 await page.context().route('https://github.com/**',route=>route.fulfill({body:'Destination verified without submitting anything.'}));
 for(const [label,path] of [['GitHub','/aylith-labs/torbie'],['Report a problem','/aylith-labs/torbie/issues/new'],["What's new",'/aylith-labs/torbie/releases/tag/v1.0.0']]){
  const [popup]=await Promise.all([page.waitForEvent('popup'),frame.locator('settings-tab button').filter({hasText:new RegExp(`^${label}`)}).click()]);
  expect(new URL(popup.url()).pathname).toBe(path);await popup.close();
 }
 await frame.locator('body').evaluate(async()=>{for(const tab of [...window.demo.app.tabs])await window.demo.app.closeTab(tab)});
 for(const theme of ['light','dark']){
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  await expect.poll(()=>frame.locator('html').getAttribute('data-preview-theme')).toBe(theme);
  await expect(frame.locator('start-page footer')).toHaveCSS('background-color','rgba(0, 0, 0, 0)');
 }
 await page.goto(url);await page.getByRole('button',{name:'Open Torbie guide',exact:true}).click();await page.getByRole('button',{name:'Follow pointer',exact:true}).click();
 const cat=page.locator('.companion'),start=await cat.boundingBox();await page.mouse.move(700,300);
 await expect.poll(async()=>{const end=await cat.boundingBox();return Math.hypot(end.x-start.x,end.y-start.y)}).toBeGreaterThan(100);
 const end=await cat.boundingBox();await page.mouse.move(end.x+29,end.y+29,{steps:20});await page.getByRole('button',{name:'Open Torbie guide',exact:true}).click();await page.getByRole('button',{name:'Park here',exact:true}).click();
 const parked=await cat.boundingBox();await page.mouse.move(300,100);await page.waitForTimeout(250);expect(await cat.boundingBox()).toEqual(parked);
 expect(errors).toEqual([]);console.log('Immersive entry, MCP popover, splits, tab positions, recovery, reset, disclosures, themes and guide: passed.');
} finally {await browser.close()}
