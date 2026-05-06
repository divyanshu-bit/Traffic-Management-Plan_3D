const puppeteer = require('puppeteer');

(async () => {
  const errors = [];
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  page.on('console', msg => {
    const t = msg.type();
    if (t === 'error' || t === 'warn') console.log(`[${t.toUpperCase()}]`, msg.text());
    else console.log('[LOG]', msg.text());
  });
  page.on('pageerror', error => { console.log('[PAGE ERROR]', error.message); errors.push(error.message); });

  try {
    await page.goto('http://localhost:5173', { waitUntil: 'networkidle2', timeout: 20000 });
    console.log('✓ Page loaded');

    // ── Step 1: Log in ────────────────────────────────────────────────────────
    const loginBtn = await page.$('.technical-btn');
    if (loginBtn) {
      await loginBtn.click();
      await page.waitForFunction(() => !document.querySelector('.login-screen'), { timeout: 5000 });
      console.log('✓ Logged in');
    } else {
      console.log('⚠ No login screen found — already logged in?');
    }

    // ── Step 2: Wait for map canvas ───────────────────────────────────────────
    await page.waitForSelector('.maplibregl-canvas', { timeout: 10000 });
    console.log('✓ Map canvas found');

    // ── Step 3: Click Polygon button ──────────────────────────────────────────
    const polygonBtn = await page.evaluateHandle(() => {
      const btns = [...document.querySelectorAll('.dock-btn')];
      return btns.find(b => b.textContent.includes('Polygon'));
    });
    if (polygonBtn.asElement()) {
      await polygonBtn.asElement().click();
      await new Promise(r => setTimeout(r, 1000));
      console.log('✓ Clicked Polygon button');
    } else {
      console.log('✗ Could not find Polygon button');
    }

    // ── Step 4: Check activeTool state & draw mode ────────────────────────────
    const state = await page.evaluate(() => {
      // Check if MapboxDraw is in draw mode
      const canvas = document.querySelector('.maplibregl-canvas-container');
      const cursor = canvas ? getComputedStyle(canvas).cursor : 'unknown';
      const dockActive = document.querySelector('.dock-btn.active')?.textContent?.trim();
      return { cursor, dockActive };
    });
    console.log('State after clicking Polygon:', JSON.stringify(state));

    // ── Step 5: Click on the map to place a vertex ────────────────────────────
    const mapCanvas = await page.$('.maplibregl-canvas');
    if (mapCanvas) {
      const box = await mapCanvas.boundingBox();
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      await page.mouse.click(cx, cy);
      await new Promise(r => setTimeout(r, 500));
      await page.mouse.click(cx + 50, cy + 50);
      await new Promise(r => setTimeout(r, 500));
      console.log('✓ Clicked map twice');
    }

    // ── Step 6: Check HUD ─────────────────────────────────────────────────────
    const hud = await page.evaluate(() => {
      const hudNum = document.querySelector('.draw-hud-num');
      const hudLabel = document.querySelector('.draw-hud-label');
      return {
        visible: !!hudNum,
        count: hudNum?.textContent,
        label: hudLabel?.textContent?.trim().slice(0, 60)
      };
    });
    console.log('HUD state:', JSON.stringify(hud));

    if (errors.length) {
      console.log('\n── ERRORS ──');
      errors.forEach(e => console.log(' •', e));
    } else {
      console.log('\n✓ No JS errors detected');
    }

  } catch (err) {
    console.log('[FATAL]', err.message);
  }

  await browser.close();
})();
