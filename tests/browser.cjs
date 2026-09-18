const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1500,height:1080}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:8642');await page.waitForFunction(()=>document.querySelector('#engine-badge').textContent==='Live build verified');
  await page.screenshot({path:path.resolve('data/preview.png'),fullPage:true});
  await page.click('#example');await page.waitForFunction(()=>!document.querySelector('#character').hidden);
  await page.click('[data-mode="enchants"]');await page.locator('[data-enchant="8021"][data-slot="finger1"]').check();await page.locator('[data-enchant="7965"][data-slot="finger1"]').check();
  await page.selectOption('#iterations','1000');await page.fill('#duration','30');await page.fill('#threads','2');await page.selectOption('#target-error','0');
  await page.click('#run');await page.waitForFunction(()=>document.querySelector('#job-status').textContent==='Complete',null,{timeout:60000});
  assert.equal(await page.locator('.result-table tbody tr').count(),3);assert.match(await page.locator('#result-content').innerText(),/Thalassian Haste/);
  const downloadPromise=page.waitForEvent('download');await page.locator('.result-table a').filter({hasText:'Input'}).first().click();const download=await downloadPromise;assert.ok(download.suggestedFilename().endsWith('.simc'));
  await page.screenshot({path:path.resolve('data/enchant-results.png'),fullPage:true});
  await page.click('[data-mode="compare"]');await page.locator('[data-field="name"]').fill('Ring Haste');await page.locator('[data-field="text"]').fill('finger1=,id=251136,enchant_id=8021');await page.click('#matrix');
  await page.click('#run');await page.waitForFunction(()=>document.querySelector('#job-status').textContent==='Complete'&&document.querySelectorAll('.result-scenario').length===3,null,{timeout:60000});assert.equal(await page.locator('.result-table tbody tr').count(),6);
  await page.click('[data-mode="history"]');await page.waitForSelector('.history-row');assert.ok(await page.locator('.history-row').count()>=2);await page.locator('.history-row').first().click();await page.waitForFunction(()=>!document.querySelector('#results').hidden);
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.resolve('data/mobile-preview.png'),fullPage:true});
  await page.setViewportSize({width:1500,height:1080});await page.click('[data-mode="quick"]');await page.fill('#profile','not a SimC profile');await page.click('#import');await page.waitForFunction(()=>!document.querySelector('#notice').hidden);assert.match(await page.locator('#notice').innerText(),/Invalid/);
  assert.deepEqual(errors,[]);console.log('PASS: import, enchant comparisons, custom gear, 3-scenario matrix, reports, history, invalid input, mobile layout and zero JS errors.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
