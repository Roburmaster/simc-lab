const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1500,height:1100}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8642');await page.waitForSelector('#raid-preset');await page.click('#example');await page.waitForFunction(()=>!document.querySelector('#character').hidden);
  await page.click('#solo-preset');assert.equal(await page.locator('[data-buff]:checked').count(),0);
  await page.locator('.environment-detail summary').filter({hasText:'Customize raid'}).click();await page.locator('[data-buff="bloodlust"]').check();await page.selectOption('#lust-mode','health');await page.fill('#lust-value','30');
  for(const key of ['food','flask','potion','augmentation','main_hand_oil','off_hand_oil'])await page.selectOption(`[data-consumable="${key}"]`,'none');
  await page.locator('.environment-detail summary').filter({hasText:'Advanced encounter'}).click();await page.fill('#fight-variation','0');
  await page.selectOption('#iterations','1000');await page.fill('#duration','20');await page.fill('#threads','2');await page.selectOption('#target-error','0');
  await page.click('#run');await page.waitForFunction(()=>['Complete','Partially complete','Failed'].includes(document.querySelector('#job-status').textContent),null,{timeout:90000});
  assert.equal(await page.locator('#job-status').innerText(),'Complete',await page.locator('#job-log').innerText());
  const inputLink=await page.locator('.result-table a').filter({hasText:'Input'}).first().getAttribute('href');const input=await (await page.request.get('http://127.0.0.1:8642'+inputLink)).text();assert.match(input,/override.arcane_intellect=0/);assert.match(input,/bloodlust_time=99999/);assert.match(input,/override.allow_potions=0/);
  await page.click('#raid-preset');for(const key of ['food','flask','potion','augmentation','main_hand_oil']){const select=page.locator(`[data-consumable="${key}"]`);const value=await select.locator('option').nth(2).getAttribute('value');await select.selectOption(value);}
  await page.click('#run');await page.waitForFunction(()=>document.querySelector('#job-status').textContent==='Running');await page.waitForFunction(()=>['Complete','Partially complete','Failed'].includes(document.querySelector('#job-status').textContent),null,{timeout:90000});assert.equal(await page.locator('#job-status').innerText(),'Complete',await page.locator('#job-log').innerText());
  await page.locator('#environment-panel').screenshot({path:'data/environment-options.png'});
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
  console.log('Buff presets, timing, no-consumable and Midnight-consumable real sims, desktop/mobile and JS checks passed.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
