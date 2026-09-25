import {chromium,expect} from '@playwright/test';
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||undefined});
const url=process.env.REVIEW_URL||'http://127.0.0.1:5870/torbie/';
try {
 for(const theme of ['light','dark']) {
  const page=await browser.newPage({viewport:{width:1360,height:900},colorScheme:theme,deviceScaleFactor:2});
  await page.addInitScript(theme=>localStorage.setItem('theme',theme),theme);
  await page.goto(url);
  const button=page.getByRole('link',{name:'Get Torbie',exact:true}).first();
  await expect(button).toBeVisible();
  const sample=()=>button.evaluate(el=>{
   const ctx=document.createElement('canvas').getContext('2d');
   const luminance=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);const c=Array.from(ctx.getImageData(0,0,1,1).data).slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return c[0]*.2126+c[1]*.7152+c[2]*.0722};
   const s=getComputedStyle(el),fg=luminance(s.color),bg=luminance(s.backgroundColor);
   return (Math.max(fg,bg)+.05)/(Math.min(fg,bg)+.05);
  });
  const ratios=[await sample()];
  await button.hover();
  for(let i=0;i<12;i++){ratios.push(await sample());await page.waitForTimeout(20)}
  await page.mouse.move(0,0);await button.focus();
  for(let i=0;i<12;i++){ratios.push(await sample());await page.waitForTimeout(20)}
  expect(Math.min(...ratios)).toBeGreaterThanOrEqual(4.5);
  console.log(`${theme}: minimum button contrast ${Math.min(...ratios).toFixed(2)}:1 through hover and focus transitions`);
  if(process.env.CAPTURE_DIR)await page.screenshot({path:`${process.env.CAPTURE_DIR}/torbie-contrast-${theme}.png`});
  await page.close();
 }
}finally{await browser.close()}
