const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const page=await browser.newPage({viewport:{width:1500,height:1050}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:8642/?test=english');await page.waitForFunction(()=>document.querySelector('#engine-badge').textContent==='Live build verified');
 assert.equal(await page.locator('html').getAttribute('lang'),'en');assert.ok(!/Siminnstillinger|Importer karakter|Kjør simulering|Nåværende|Sammenlign|Historikk/.test(await page.locator('body').innerText()));
 await page.click('#example');await page.waitForFunction(()=>document.querySelector('#talent-status').textContent.includes('tree validated'));
 await page.click('[data-mode="enchants"]');assert.equal(await page.locator('#older').count(),0);assert.ok(await page.locator('[data-enchant="8021"]').count()>0);assert.equal(await page.locator('[data-enchant="6109"]').count(),0);
 await page.click('[data-mode="compare"]');await page.locator('.catalog-tools summary').click();await page.selectOption('#gear-slot','finger1');await page.fill('#gear-query','Charged Sandstone');await page.click('#gear-search');await page.waitForFunction(()=>document.querySelector('#gear-choice').textContent.includes('No matching'));
 await page.fill('#gear-query','Signet of Snarling');await page.click('#gear-search');await page.waitForFunction(()=>document.querySelector('#gear-choice').textContent.includes('Signet of Snarling'));await page.click('#gear-add');assert.match(await page.locator('[data-field="text"]').first().inputValue(),/251136/);
 await page.selectOption('#gem-slot','finger1');await page.selectOption('#gem-choice','240908');await page.click('#gem-add');assert.equal(await page.locator('.variant').count(),2);
 await page.click('[data-mode="talents"]');await page.selectOption('#talent-budget','16');await page.selectOption('#iterations','1000');await page.fill('#duration','20');await page.fill('#threads','2');await page.selectOption('#target-error','0');
 await page.click('#run');await page.waitForFunction(()=>document.querySelector('#job-status').textContent==='Complete',null,{timeout:90000});assert.equal(await page.locator('.result-table tbody tr').count(),17);assert.ok(await page.locator('[data-copy-talent]').count()>0);assert.ok((await page.locator('textarea[aria-label="Best talent export"]').first().inputValue()).length>50);
 await page.screenshot({path:'data/talent-search-results.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
 console.log('PASS: English interface, strict Midnight choices, gear/gem selectors, 17 real talent simulations, winner export, mobile layout and no JavaScript errors.');
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
