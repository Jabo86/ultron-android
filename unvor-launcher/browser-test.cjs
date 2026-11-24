const {chromium}=require('playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH || undefined,args:['--no-sandbox']});
 const errors=[],results=[];
 for(const viewport of [{width:393,height:852},{width:360,height:740},{width:412,height:915}]){
  const page=await browser.newPage({viewport,deviceScaleFactor:1});page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{window.testActions=[];window.UltronNative={action(a,p){window.testActions.push({action:a,payload:JSON.parse(p)});if(a==='ready')window.UltronReceive('state',{device:'PIXEL 8',ram:46,battery:87,disk:18,weatherApp:'Meteo',alarm:'Nessuna sveglia visibile'});if(a==='voice')window.UltronReceive('voice','listening');if(a==='apps')window.UltronReceive('apps',[{label:'UNVOR Chat',pkg:'com.ultron.messenger.pilot',activity:'MainActivity',icon:''}]);if(a==='weather')window.UltronReceive('pick','weather');}};});
  await page.goto('http://127.0.0.1:8933/');await page.waitForFunction(()=>document.querySelector('#ram-value').textContent==='46%');
  await page.screenshot({path:`unvor-launcher/test-${viewport.width}.png`});
  const bounds=await page.locator('#home [data-action]').evaluateAll(els=>els.map(e=>{const r=e.getBoundingClientRect();return{action:e.dataset.action,x:r.x,y:r.y,w:r.width,h:r.height};}));
  for(const r of bounds){assert.ok(r.x>=0&&r.y>=0&&r.x+r.w<=viewport.width+1&&r.y+r.h<=viewport.height+1,JSON.stringify(r));assert.ok(r.w>=44&&r.h>=44,`Small target ${JSON.stringify(r)}`);}
  const overlap=[];
  for(let i=0;i<bounds.length;i++)for(let j=i+1;j<bounds.length;j++){const a=bounds[i],b=bounds[j];if(a.x<b.x+b.w-1&&b.x<a.x+a.w-1&&a.y<b.y+b.h-1&&b.y<a.y+a.h-1)overlap.push([a.action,b.action]);}
  assert.deepEqual(overlap,[],`Overlapping controls at ${viewport.width}`);
  for(const selector of ['[data-action="alarms"]','[data-action="files"]','[data-action="settings"]','[data-action="network"]','[data-action="contacts"]','[data-action="ultron"]','[data-action="browser"]'])await page.locator(selector).first().click();
  await page.locator('[data-action="tools"]').click();assert.ok(await page.locator('#dialog-content').innerText().then(t=>t.includes('Agenda UNVOR')));await page.locator('#close').click();
  await page.locator('[data-action="privacy"]').click();assert.ok((await page.locator('#dialog-content').innerText()).includes('Non invia'));await page.locator('#close').click();
  await page.locator('#toggle-search').click();await page.locator('#query').fill('prova & sicurezza');await page.locator('#query').press('Enter');
  await page.locator('#globe-voice-button').click();
  assert.equal(await page.locator('#voice-label').innerText(),'IN ASCOLTO');
  await page.evaluate(()=>{window.UltronReceive('voice','speaking');window.UltronReceive('voiceBeat',1);});
  assert.equal(await page.locator('#voice-label').innerText(),'UNVOR PARLA');
  await page.waitForTimeout(650);
  await page.screenshot({path:`unvor-launcher/active-${viewport.width}.png`});
  await page.evaluate(()=>window.UltronReceive('voice','idle'));
  assert.equal(await page.locator('body').evaluate(el=>el.classList.contains('voice-active')),false);
  const actions=await page.evaluate(()=>window.testActions);assert.ok(actions.some(x=>x.action==='search'&&x.payload.query==='prova & sicurezza'));
  assert.equal((await page.locator('#home').innerText()).includes('ULTRON'),false);
  results.push({viewport,controls:bounds.length,overlap:false});await page.close();
 }
 assert.deepEqual(errors,[]);fs.writeFileSync('unvor-launcher/UI-VERIFICHE.json',JSON.stringify({passed:true,results,physicalDeviceTest:false},null,2));
 await browser.close();console.log(JSON.stringify(results));
})().catch(e=>{console.error(e);process.exit(1);});
