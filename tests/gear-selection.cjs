const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');const fs=require('node:fs');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:8642');await page.waitForSelector('#raid-preset');
 const items=await(await page.request.get('http://127.0.0.1:8642/api/gear?slot=off_hand&class=warrior&spec=fury&q=Venom-Cursed%20Claymore')).json();
 const profile=(await(await import('./reference.mjs')).referenceProfile('Warrior_Fury',{stripActions:true}))+`\n### Gear from Bags\n# Click test sword\n# main_hand=,id=${items[0].id}\n`;
 await page.fill('#profile',profile);await page.click('#import');await page.waitForFunction(()=>document.querySelectorAll('[data-imported-card]').length===2);await page.click('[data-mode="compare"]');
 const card=page.locator('[data-imported-card]').nth(1);await card.click({position:{x:8,y:8}});assert.match(await card.getAttribute('class'),/selected/);assert.match(await page.locator('[data-field="text"]').inputValue(),/^off_hand=/);assert.equal(await card.locator('button').getAttribute('aria-pressed'),'true');
 await card.click({position:{x:8,y:8}});assert.equal(await page.locator('.variant').count(),0);assert.equal(await card.locator('button').getAttribute('aria-pressed'),'false');
 await card.focus();await page.keyboard.press('Enter');assert.equal(await page.locator('.variant').count(),1);await page.keyboard.press('Space');assert.equal(await page.locator('.variant').count(),0);
 await card.click({position:{x:8,y:8}});await page.locator('[data-remove]').click();assert.equal(await card.locator('button').getAttribute('aria-pressed'),'false');
 await page.locator('.catalog-tools summary').click();await page.selectOption('#gear-slot','off_hand');await page.fill('#gear-query','Venom-Cursed Claymore');await page.click('#gear-search');await page.waitForSelector('[data-search-card]');assert.ok(await page.locator('[data-search-card]').count());assert.deepEqual(errors,[]);
 console.log('PASS: Fury off-hand cards and search, full-card select/deselect, keyboard toggling and removal synchronization.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exit(1);});
