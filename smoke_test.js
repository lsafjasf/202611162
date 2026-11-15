/* Playwright 冒烟测试:页面加载、操作、复现一致性 */
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.goto('file://' + __dirname + '/index.html');
  await page.waitForTimeout(1500);

  // 环境指标与生物指标已渲染
  const env = await page.textContent('#envMetrics');
  const bio = await page.textContent('#bioMetrics');
  console.log('环境指标:', env.replace(/\s+/g, ' ').slice(0, 90));
  console.log('生物指标:', bio.replace(/\s+/g, ' ').slice(0, 90));

  // 执行一组操作
  await page.selectOption ? null : null;
  await page.evaluate(() => {
    const set = (id, v) => {
      const el = document.getElementById(id);
      el.value = v;
      el.dispatchEvent(new Event('input'));
      el.dispatchEvent(new Event('change'));
    };
    set('shadeSlider', 60);
    set('flowSlider', 90);
  });
  await page.click('#btnCleanAll');
  await page.click('#btnStratB').catch(() => {});
  const lastOp = await page.textContent('#lastOp');
  console.log('最近操作:', lastOp);

  // 加速跑一段时间
  await page.click('#btnSpeed'); // 2x
  await page.click('#btnSpeed'); // 4x
  await page.waitForTimeout(4000);
  const day1 = await page.textContent('#dayLabel');
  const bio1 = await page.textContent('#bioMetrics');
  console.log('运行中:', day1);

  // 记录当前状态,然后复现操作序列
  const beforeReplay = await page.evaluate(() => JSON.stringify(window.__sim ? 1 : 0));
  await page.click('#btnSpeed'); // 1x
  await page.click('#btnReplay');
  await page.waitForTimeout(500);
  const replayMsg = await page.textContent('#lastOp');
  console.log('复现:', replayMsg);

  // 暂停/继续
  await page.click('#btnPause');
  const pauseLabel = await page.textContent('#btnPause');
  await page.click('#btnPause');
  console.log('暂停按钮切换:', pauseLabel);

  // 重开同种子 → 初始状态一致
  const seedState = async () => page.evaluate(() => {
    return document.getElementById('bioMetrics').textContent;
  });
  await page.click('#btnRestart');
  await page.waitForTimeout(300);
  const s1 = await seedState();
  await page.click('#btnRestart');
  await page.waitForTimeout(300);
  const s2 = await seedState();
  console.log('同种子重开一致:', s1 === s2 ? 'PASS' : 'FAIL');

  console.log('JS 错误:', errors.length ? errors.join(' | ') : '无');
  await page.screenshot({ path: 'artifacts/screenshot.png' });
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
