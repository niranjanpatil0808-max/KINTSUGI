// Replies (button on a computer, swipe on a phone), the phone "More" sheet, pinned messages, the Memory tab, dropping a file,
// keyboard shortcuts and the model list. Runs on a desktop and on a phone.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const BASE = process.env.BASE_URL || 'http://127.0.0.1:8804';
const SHOTS = process.env.SHOTS || '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--no-sandbox'] });
  const errs = [];
  for (const [label, opts] of [['pc', { viewport: { width: 1280, height: 800 } }], ['phone', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }]]) {
    const phone = label === 'phone';
    const ctx = await b.newContext(opts); const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(label + ' pageerror ' + e.message));
    p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push(label + ' console ' + m.text()); });
    await p.goto(BASE + '/#token=tok123'); await p.waitForSelector('#msg', { state: 'attached' }); await sleep(700);
    const shot = (n) => SHOTS ? p.screenshot({ path: `${SHOTS}/v2-${label}-${n}.png` }) : null;
    // a message to work with
    const tag = label + '-' + Date.now() % 100000;
    await p.fill('#msg', 'plan for ' + tag); await p.keyboard.press('Enter');
    await p.waitForSelector('.row:not(.me):has(.who-line:has-text("alice"))', { timeout: 15000 });
    const reply = p.locator('.row:not(.me):has(.who-line:has-text("alice"))').last();
    // 1. reply
    if (phone) {
      // the rarer buttons live under More on a phone
      if (await reply.locator('button[aria-label="Share this message to a room"]').isVisible()) errs.push('phone: Share should be inside More');
      if (!(await reply.locator('button.more-btn').isVisible())) errs.push('phone: no More button');
      await reply.locator('button.more-btn').click();
      await p.waitForSelector('.dialog .sheet-list');
      const items = await p.locator('.dialog .sheet-list .item').allInnerTexts();
      for (const want of ['Share', 'Pin']) if (!items.some(t => t.includes(want))) errs.push('phone: More sheet lacks ' + want + ': ' + items.join(','));
      await shot('more-sheet');
      await p.keyboard.press('Escape'); await sleep(200);
      // swipe right on the message to reply
      const box = await reply.boundingBox(); const cdp = await ctx.newCDPSession(p);
      const pt = (x, y) => [{ x, y }];
      const y = box.y + 20, x0 = box.x + 60;
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(x0, y) });
      for (let dx = 10; dx <= 90; dx += 10) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(x0 + dx, y + 1) }); await sleep(16); }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await reply.hover(); await reply.locator('button[aria-label="Reply to this message"]').click();
    }
    await p.waitForSelector('#reply-bar:not([hidden]):has-text("alice")', { timeout: 4000 }).catch(() => errs.push(label + ': no reply bar'));
    await shot('reply-bar');
    await p.fill('#msg', 'answering that ' + tag); await p.keyboard.press('Enter');
    await p.waitForSelector(`.row.me:has-text("answering that ${tag}") .quote`, { timeout: 8000 }).catch(() => errs.push(label + ': the sent reply has no quote'));
    if (await p.locator('#reply-bar:not([hidden])').count()) errs.push(label + ': reply bar stayed after sending');
    const raw = await p.locator(`.row.me:has-text("answering that ${tag}")`).innerText();
    if (/\*\*|> ↩/.test(raw)) errs.push(label + ': raw quote markdown shows: ' + raw.slice(0, 80));
    await shot('reply-sent');
    // 2. pin, the pinned strip, unpin
    const mine = p.locator(`.row.me:has-text("answering that ${tag}")`);
    if (phone) { await mine.locator('.bubble').click(); await mine.locator('button.more-btn').click(); await p.click('.dialog .sheet-list .item:has-text("Pin")'); }
    else { await mine.locator('.bubble').click(); await mine.locator('button[aria-label="Pin this message"]').click(); }
    await p.waitForSelector('#pin-strip:not([hidden]) .pin-count', { timeout: 6000 }).catch(() => errs.push(label + ': no pinned strip'));
    await shot('pinned');
    await p.click('#pin-strip .pin-open'); await p.waitForSelector('.dialog .pin-card');
    await p.click('.dialog .pin-card button:has-text("Unpin")');
    await p.waitForFunction(() => { const s = document.querySelector('#pin-strip'); return !s || s.hidden; }, null, { timeout: 6000 }).catch(() => errs.push(label + ': strip stayed after unpin'));
    // 3. Memory tab: the agent remembers something, it shows up, and can be forgotten (owner sees the drawer)
    await p.fill('#msg', '@alice note this down ' + tag); await p.keyboard.press('Enter');
    await sleep(2500);
    await p.click('#topbar button:has-text("Details")'); await p.waitForSelector('#drawer .tab:has-text("Memory")');
    await p.click('#drawer .tab:has-text("Memory")');
    await p.waitForSelector('#drawer .note-card:has-text("short answers")', { timeout: 8000 }).catch(() => errs.push(label + ': memory note not shown'));
    await shot('memory');
    const before = await p.locator('#drawer .note-card').count();
    await p.locator('#drawer .note-card button:has-text("Forget")').first().click(); await p.click('.overlay:last-child .btn.primary');
    await p.waitForFunction((n) => document.querySelectorAll('#drawer .note-card').length < n, before, { timeout: 6000 }).catch(() => errs.push(label + ': note not forgotten'));
    await p.evaluate(() => toggleDrawer(false));
    // 4. no sideways scroll anywhere we went
    if (await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) errs.push(label + ': sideways scroll');
    if (!phone) {
      // 5. drop a file onto the chat
      await p.evaluate(() => {
        const dt = new DataTransfer(); dt.items.add(new File(['meeting notes'], 'notes.txt', { type: 'text/plain' }));
        document.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true }));
        document.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
      });
      await p.waitForFunction(() => document.querySelector('#msg').value.includes('notes.txt'), null, { timeout: 6000 }).catch(() => errs.push('pc: dropped file not given'));
      await p.fill('#msg', '');
      // 6. keyboard shortcuts
      await p.click('#thread'); await p.keyboard.press('Shift+Slash');
      await p.waitForSelector('.dialog:has-text("Keyboard shortcuts")', { timeout: 3000 }).catch(() => errs.push('pc: ? does not open shortcuts'));
      await p.keyboard.press('Escape');
      // 7. a failed model test offers the models as buttons (wizard)
      await p.evaluate(() => {
        const real = window.api; window.__realApi = real;
        window.api = async (path, body) => { if (path === '/api/providers/save') return {}; if (path === '/api/providers/test') return body.model === 'good-model' ? { ok: true, models: ['good-model'], reply: 'OK' } : { ok: false, error: 'model not found', models: ['good-model', 'other-model'] }; return real(path, body); };
      });
      await p.evaluate(() => setupWizard()); await p.locator('.wizard .pcard').first().click();
      await p.fill('.wizard input[aria-label="API key"]', 'sk-test-1234567890');
      await p.click('.wizard button:has-text("Test and continue")');
      await p.waitForSelector('.wizard .model-chips .chip:has-text("good-model")', { timeout: 4000 }).catch(() => errs.push('pc: wizard offers no model buttons'));
      await shot('wizard-models');
      await p.click('.wizard .model-chips .chip:has-text("good-model")');
      await p.waitForSelector('.wizard :text("It works")', { timeout: 4000 }).catch(() => errs.push('pc: choosing a model did not retest'));
      await p.evaluate(() => { window.api = window.__realApi; });
    }
    await ctx.close();
  }
  console.log(errs.length ? 'PROBLEMS:\n' + errs.join('\n') : 'no errors');
  await b.close();
})().catch(e => { console.error('FAILED', e.message); process.exit(1); });
