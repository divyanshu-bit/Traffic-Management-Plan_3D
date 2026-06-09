const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.toString()));
  try {
    await page.goto('http://localhost:3000');
    console.log('Page loaded, waiting for trigger button...');
    await page.waitForSelector('.initial-trigger-btn', {timeout: 5000});
    console.log('Button found, clicking...');
    await page.click('.initial-trigger-btn');
    await new Promise(r => setTimeout(r, 2000));
    console.log('Waiting for login card...');
    await page.waitForSelector('.login-card-v2', {timeout: 5000});
    console.log('Login card found, clicking authorize...');
    await page.click('.technical-btn-v2');
    await new Promise(r => setTimeout(r, 2000));
  } catch (e) {
    console.log('SCRIPT ERROR:', e);
  }
  await browser.close();
})();
