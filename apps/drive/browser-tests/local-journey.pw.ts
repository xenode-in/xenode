import { test, expect } from '@playwright/test';

test('Drive and Photos complete interactive Vault unlock without an opener @local', async ({page, context}, testInfo) => {
  test.skip(process.env.LOCAL_PRODUCT_JOURNEY !== '1', 'Requires a disposable local stack and an onboarded synthetic account');
  test.setTimeout(90_000);
  const email = process.env.BROWSER_TEST_EMAIL;
  const loginPassword = process.env.BROWSER_TEST_LOGIN_PASSWORD;
  const vaultPassword = process.env.BROWSER_TEST_VAULT_PASSWORD;
  if (!email || !loginPassword || !vaultPassword) throw new Error('Set BROWSER_TEST_EMAIL, BROWSER_TEST_LOGIN_PASSWORD and BROWSER_TEST_VAULT_PASSWORD for a disposable account');
  const driveOrigin = process.env.BROWSER_TEST_DRIVE_ORIGIN || 'http://localhost:3000';
  const photosOrigin = process.env.BROWSER_TEST_PHOTOS_ORIGIN || 'http://localhost:3002';
  // The two public origin knobs are restricted to loopback for this fixture.
  for (const origin of [driveOrigin, photosOrigin]) {
    if (!['localhost','127.0.0.1','[::1]'].includes(new URL(origin).hostname)) throw new Error('Local browser journeys require loopback origins');
  }
  await page.setViewportSize({width:375,height:800});
  await page.goto(`${driveOrigin}/auth/login`);
  await page.getByLabel('Email or username', {exact:true}).fill(email);
  await page.getByLabel('Password', {exact:true}).fill(loginPassword);
  await page.getByRole('button', {name:'Sign in',exact:true}).click();
  if (process.env.BROWSER_TEST_ONBOARD === '1') {
    await page.getByLabel('Create a Vault password', {exact:true}).fill(vaultPassword);
    await page.getByLabel('Confirm Vault password', {exact:true}).fill(vaultPassword);
    await expect(page.getByRole('checkbox', {name:/Trust this browser to unlock for 30 days/})).not.toBeChecked();
    await page.getByRole('button', {name:'Get started',exact:true}).click();
    await expect(page.getByRole('heading', {name:'Save your 12-word recovery phrase',exact:true})).toBeVisible();
    await expect(page.getByRole('button', {name:'Continue',exact:true})).toBeDisabled();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', {name:'Save as PDF',exact:true}).click();
    await (await downloadPromise).saveAs(testInfo.outputPath('synthetic-recovery.pdf'));
    await page.getByRole('checkbox', {name:'I’ve saved my recovery phrase somewhere safe',exact:true}).check();
    await page.getByRole('button', {name:'Continue',exact:true}).click();
    await expect(page.getByRole('heading', {name:'Choose your theme',exact:true})).toBeVisible();
    await page.getByRole('button', {name:'Continue',exact:true}).click();
    await expect(page.getByRole('heading', {name:'Choose a storage pool',exact:true})).toBeVisible();
    await page.getByRole('button', {name:"Default storage The deployment's default storage pool.",exact:true}).click();
    await page.getByRole('button', {name:'Continue',exact:true}).click();
    await expect(page.getByRole('heading', {name:'Pick an avatar',exact:true})).toBeVisible();
    await page.getByRole('button', {name:'Continue',exact:true}).click();
    await page.getByRole('button', {name:'Enter Xenode',exact:true}).click();
  } else {
    await page.getByLabel('Vault password (local only)', {exact:true}).fill(vaultPassword);
    await page.getByRole('button', {name:'Unlock and continue',exact:true}).click();
  }
  await page.waitForURL(`${driveOrigin}/dashboard`);
  expect(await page.evaluate(() => window.crossOriginIsolated)).toBe(true);
  const popupPromise = context.waitForEvent('page');
  await page.getByRole('link', {name:'Unlock in Xenode Accounts',exact:true}).click();
  const popup = await popupPromise;
  await popup.getByLabel('Vault password', {exact:true}).fill(vaultPassword);
  expect(await popup.evaluate(() => window.opener)).toBeNull();
  await popup.getByRole('button', {name:'Unlock Vault',exact:true}).click();
  await expect(popup.getByRole('status')).toHaveText('Key delivered. Return to Xenode Drive.',{timeout:20_000});
  await expect(page.getByRole('heading', {name:'Opening Drive',exact:true})).not.toBeVisible({timeout:10_000});
  await expect(page.getByRole('heading', {name:'Quick Access',exact:true})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.screenshot({path:testInfo.outputPath('drive-unlocked.png')});
  await popup.close();

  await page.goto(`${photosOrigin}/auth/login?next=/library`);
  await page.waitForURL(`${photosOrigin}/library`);
  const photosPopupPromise = context.waitForEvent('page');
  await page.getByRole('link', {name:'Unlock in Xenode Accounts',exact:true}).click();
  const photosPopup = await photosPopupPromise;
  await photosPopup.getByLabel('Vault password', {exact:true}).fill(vaultPassword);
  expect(await photosPopup.evaluate(() => window.opener)).toBeNull();
  await photosPopup.getByRole('button', {name:'Unlock Vault',exact:true}).click();
  await expect(photosPopup.getByRole('status')).toHaveText('Key delivered. Return to Xenode Photos.',{timeout:20_000});
  await expect(page.getByRole('heading', {name:'Opening Photos',exact:true})).not.toBeVisible({timeout:10_000});
  await expect(page.getByRole('heading', {name:'Your memories belong here',exact:true})).toBeVisible();
  await page.getByRole('button', {name:'Albums',exact:true}).click();
  await expect(page.getByRole('heading', {name:'Albums',exact:true})).toBeVisible();
  await page.getByRole('button', {name:'Trash',exact:true}).click();
  await expect(page.getByRole('heading', {name:'Trash',exact:true})).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await page.screenshot({path:testInfo.outputPath('photos-unlocked.png')});
});
