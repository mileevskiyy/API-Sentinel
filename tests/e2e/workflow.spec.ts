import{test,expect}from'@playwright/test';import{fileURLToPath}from'node:url';
test('create monitor, open and acknowledge incident, recover, inspect drift and maintenance',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'Try the demo',exact:true}).click();
 await expect(page.getByRole('heading',{name:'A clearer signal. A faster response.'})).toBeVisible();
 if(!process.env.DEMO_URL)await page.screenshot({path:fileURLToPath(new URL('../../docs/sentinel-preview.png',import.meta.url)),fullPage:true});
 await page.getByRole('button',{name:'New monitor',exact:true}).click();
 const name=`Browser API ${Date.now()}`;await page.getByLabel('Monitor name',{exact:true}).fill(name);
 await page.getByRole('button',{name:'Create monitor',exact:true}).click();await expect(page.getByRole('heading',{name,exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Simulate outage',exact:true}).click();
 await page.getByRole('button',{name:/^Incidents/}).last().click();
 await expect(page.locator('.incident-list .badge')).toHaveText('open');
 await page.getByLabel('Acknowledgement note').fill('Reproduced the failed upstream response.');await page.getByRole('button',{name:'Acknowledge',exact:true}).click();
 await expect(page.locator('.incident-list .badge')).toHaveText('acknowledged');
 await page.getByRole('button',{name:'Opening evidence',exact:true}).click();
 await expect(page.getByRole('dialog',{name:'Check evidence'})).toContainText('503');
 await page.getByRole('button',{name:'Close check evidence'}).click();
 await page.getByRole('button',{name:'Restore service',exact:true}).click();await expect(page.locator('.incident-list .badge')).toHaveText('resolved');
 await page.getByLabel('Demo scenario').selectOption('drift');
 await page.getByRole('button',{name:'Run check',exact:true}).click();const evidence=page.getByRole('dialog',{name:'Check evidence'});await expect(evidence.getByRole('heading',{name:'Response shape changes'})).toBeVisible();await expect(evidence).toContainText('/data/available');
 await page.getByRole('button',{name:'Close check evidence'}).click();
 await page.getByRole('checkbox',{name:'Maintenance',exact:true}).check();await page.getByRole('button',{name:'Run check',exact:true}).click();await expect(page.getByRole('dialog',{name:'Check evidence'}).locator('.badge')).toHaveText('suppressed');await page.getByRole('button',{name:'Close check evidence'}).click();
 await page.getByRole('button',{name:'Pause monitor',exact:true}).click();await expect(page.getByRole('button',{name:'Run check',exact:true})).toBeDisabled();await page.getByRole('button',{name:'Resume monitor',exact:true}).click();
 const download=page.waitForEvent('download');await page.getByRole('link',{name:'Export monitor evidence'}).click();expect((await download).suggestedFilename()).toBe('api-sentinel-monitor.json');
 await page.getByRole('button',{name:'Back to workspace',exact:true}).click();await page.reload();await expect(page.getByRole('heading',{name:'A clearer signal. A faster response.'})).toBeVisible();
 if(!process.env.DEMO_URL){await page.setViewportSize({width:390,height:844});await page.screenshot({path:fileURLToPath(new URL('../../docs/sentinel-mobile.png',import.meta.url)),fullPage:true});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);}
});
