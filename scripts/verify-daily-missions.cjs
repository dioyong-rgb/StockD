// 매일 페이지 열기·재고 확인·주문 확인 기록과 날짜 경계, 저장 예외를 검증합니다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { chromium } = require('C:/Users/dioyongPC/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const root = path.resolve(__dirname, '..');
const htmlPath = path.join(root, 'preview', 'index.html');
const screenshotPath = path.join(root, 'preview', 'screenshots');
const storageKey = 'stockd.daily-checks.v1';
const today = '2026-10-05';
const fixedTime = '2026-10-05T01:00:00Z';
const results = [];
const errors = [];
const requests = [];

async function check(name, action) {
  try {
    await action();
    results.push({ name, status: '통과' });
  } catch (error) {
    results.push({ name, status: '실패', error: error instanceof Error ? error.message : String(error) });
  }
}

async function nav(page, view) {
  await page.locator(`.nav button[data-view="${view}"]`).click();
}

async function expectProgress(page, completed) {
  await nav(page, 'dashboard');
  await page.waitForFunction(expected => document.getElementById('dailyProgress')?.value === expected, completed);
  const progress = page.locator('#dailyProgress');
  assert.equal(await progress.count(), 1);
  assert.equal(await progress.evaluate(element => element.tagName), 'PROGRESS');
  assert.equal(await progress.evaluate(element => element.max), 3);
  assert.equal(await progress.evaluate(element => element.value), completed);
  assert.match(await page.locator('#dailyProgressText').innerText(), new RegExp(`${completed}\\s*/\\s*3`));
  assert.match(await page.locator('.preview-strip').innerText(), /샘플 데이터.*실제 API 미연동/);
}

async function expectTasks(page, expected) {
  for (const task of ['opened', 'inventory', 'orders']) {
    const row = page.locator(`[data-daily-task="${task}"]`);
    assert.equal(await row.count(), 1, `${task} 일일 항목이 하나 있어야 합니다.`);
    const text = await row.innerText();
    assert.match(text, expected[task] ? /완료/ : /확인 전/, `${task} 확인 상태 불일치: ${text}`);
  }
}

async function record(page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
}

async function expectDay(page, date, expected) {
  const saved = await record(page);
  assert.equal(saved.version, 1);
  assert.ok(saved.days && typeof saved.days === 'object');
  const day = saved.days[date];
  assert.ok(day, `${date} 저장 기록이 없습니다.`);
  for (const task of ['opened', 'inventory', 'orders']) assert.equal(day[task] === true, expected[task], `${date}/${task} 저장 상태 불일치`);
}

async function newContext(browser, init) {
  // 브라우저 시간대를 UTC로 두어 서울 날짜 계산이 기기 시간대에 의존하지 않는지도 확인합니다.
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'ko-KR', timezoneId: 'UTC' });
  await context.route(/^https?:/, async route => {
    requests.push(route.request().url());
    await route.abort();
  });
  context.on('page', page => {
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('websocket', socket => requests.push(socket.url()));
    page.setDefaultTimeout(5000);
  });
  if (init) await context.addInitScript(init);
  return context;
}

async function openPage(context, time = fixedTime) {
  const page = await context.newPage();
  await page.clock.setFixedTime(time);
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle' });
  return page;
}

async function expectDataMeaning(page) {
  await nav(page, 'inventory');
  const zero = page.locator('.inventory-table tr:has(button[data-id="n2"])');
  assert.match(await zero.innerText(), /품절/);
  assert.equal((await zero.locator('td.number').innerText()).trim(), '0');
  const stale = page.locator('.inventory-table tr:has(button[data-id="c2"])');
  assert.match(await stale.innerText(), /이전 수량 유지.*최근 조회 실패/s);
  assert.equal((await stale.locator('td.number').innerText()).trim(), '7');
  const failed = page.locator('.inventory-table tr:has(button[data-id="r2"])');
  assert.match(await failed.innerText(), /이전 성공값 없음/);
  assert.equal((await failed.locator('td.number').innerText()).trim(), '—');
  await nav(page, 'connections');
  assert.deepEqual(await page.locator('.status-dot').allTextContents(), ['실제 미연결', '실제 미연결']);
  assert.equal(await page.locator('input[type="password"]').count(), 0);
  await nav(page, 'orders');
  assert.match(await page.locator('main .notice').first().innerText(), /출고 이후/);
  assert.match(await page.locator('.orders-table tr:has(button[data-id="DEMO-RO-301"])').innerText(), /상태 미확인/);
}

async function midnightScenario(browser, activeView, expectedCount) {
  const context = await newContext(browser);
  try {
    const page = await context.newPage();
    await page.clock.install({ time: '2026-10-05T14:59:40Z' });
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle' });
    await page.clock.pauseAt('2026-10-05T14:59:50Z');
    await nav(page, 'inventory');
    await nav(page, 'orders');
    await nav(page, activeView);
    await expectDay(page, today, { opened: true, inventory: true, orders: true });
    // 자정 직후 날짜 감시 타이머가 작동할 시간을 가상으로 넘깁니다.
    await page.clock.fastForward(70000);
    const next = '2026-10-06';
    const expected = { opened: true, inventory: activeView === 'inventory', orders: activeView === 'orders' };
    // 대시보드 이동 전에 현재 화면에서 새날 확인이 반영되었는지 저장 기록을 검사합니다.
    await expectDay(page, next, expected);
    await expectDay(page, today, { opened: true, inventory: true, orders: true });
    await expectProgress(page, expectedCount);
    await expectTasks(page, expected);
  } finally {
    await context.close();
  }
}

async function run() {
  fs.mkdirSync(screenshotPath, { recursive: true });
  const html = fs.readFileSync(htmlPath, 'utf8');
  await check('인라인 스크립트 문법·자산 외부 호출 없음', async () => {
    assert.match(html, /<html lang="ko">/);
    assert.doesNotMatch(html, /<script\b[^>]*\bsrc\s*=|<link\b[^>]*\brel\s*=\s*["'](?:stylesheet|preload|prefetch|modulepreload)/i);
    assert.doesNotMatch(html, /(?:@import\s+|url\(\s*["']?https?:|\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b)/);
    const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
    assert.ok(scripts.length);
    scripts.forEach((script, index) => new vm.Script(script[1], { filename: `inline-${index}.js` }));
  });
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  try {
    const context = await newContext(browser);
    let page = await openPage(context);

    await check('첫 페이지 열기만 자동 1/3·서울 날짜·샘플 표시', async () => {
      await expectProgress(page, 1);
      await expectTasks(page, { opened: true, inventory: false, orders: false });
      await expectDay(page, today, { opened: true, inventory: false, orders: false });
      assert.equal(await page.locator('#samplePractice').evaluate(element => element.tagName), 'DETAILS');
      assert.equal(await page.locator('#samplePractice').evaluate(element => element.open), false);
    });

    await check('재고표 확인 자동 2/3·주문표 확인 자동 3/3·반복 중복 없음', async () => {
      await nav(page, 'inventory');
      assert.ok(await page.locator('.inventory-table tbody tr').count());
      await expectProgress(page, 2);
      await expectTasks(page, { opened: true, inventory: true, orders: false });
      await nav(page, 'orders');
      assert.ok(await page.locator('.orders-table tbody tr').count());
      await expectProgress(page, 3);
      await expectTasks(page, { opened: true, inventory: true, orders: true });
      for (let index = 0; index < 3; index += 1) {
        await nav(page, 'inventory');
        await nav(page, 'orders');
      }
      await expectProgress(page, 3);
      await expectDay(page, today, { opened: true, inventory: true, orders: true });
    });

    await check('최근 7일 기록에 오늘 완료와 기록 없는 날 구분', async () => {
      const cells = page.locator('[data-daily-date]');
      assert.equal(await cells.count(), 7);
      const current = page.locator(`[data-daily-date="${today}"]`);
      assert.match(await current.innerText(), /완료/);
      assert.ok(await current.getAttribute('title'));
      const absent = page.locator('[data-daily-date="2026-10-04"]');
      assert.match(await absent.getAttribute('aria-label'), /기록 없음/);
      assert.match(await absent.getAttribute('title'), /기록 없음/);
    });

    await check('새로고침과 같은 브라우저 페이지 재열기 기록 유지', async () => {
      await page.reload({ waitUntil: 'networkidle' });
      await expectProgress(page, 3);
      await page.close();
      page = await openPage(context);
      await expectProgress(page, 3);
      await expectDay(page, today, { opened: true, inventory: true, orders: true });
    });

    await check('샘플 초기화가 일일 기록을 지우지 않음', async () => {
      await nav(page, 'connections');
      await page.locator('[data-action="sample-reset"]').click();
      await expectProgress(page, 3);
      await expectDay(page, today, { opened: true, inventory: true, orders: true });
    });

    await check('연결 설정 안 별도 일일 기록 삭제는 오늘 페이지 열기 1/3로 복원', async () => {
      await nav(page, 'connections');
      const reset = page.locator('[data-action="daily-reset"]');
      assert.equal(await reset.count(), 1);
      await reset.click();
      await expectProgress(page, 1);
      await expectTasks(page, { opened: true, inventory: false, orders: false });
      await expectDay(page, today, { opened: true, inventory: false, orders: false });
    });

    await check('다른 탭 확인이 storage 이벤트로 반영되고 기록을 합침', async () => {
      const other = await openPage(context);
      try {
        await expectProgress(other, 1);
        await nav(page, 'inventory');
        // 탭을 다시 탐색하지 않아도 이미 열린 대시보드가 갱신되어야 합니다.
        await other.waitForFunction(() => document.getElementById('dailyProgress')?.value === 2);
        await expectTasks(other, { opened: true, inventory: true, orders: false });
        await nav(other, 'orders');
        await expectProgress(page, 3);
        await expectProgress(other, 3);
        await expectDay(page, today, { opened: true, inventory: true, orders: true });
        // 이전 상태를 가진 탭이 덮어써도 이미 확인한 참값을 잃지 않아야 합니다.
        await other.evaluate(({ key, date }) => localStorage.setItem(key, JSON.stringify({ version: 1, days: { [date]: { opened: true, inventory: false, orders: true } } })), { key: storageKey, date: today });
        await page.waitForFunction(({ key, date }) => JSON.parse(localStorage.getItem(key)).days[date].inventory === true, { key: storageKey, date: today });
        await expectProgress(page, 3);
        await expectProgress(other, 3);
        await expectDay(page, today, { opened: true, inventory: true, orders: true });
      } finally {
        await other.close();
      }
    });

    await check('미션 완료 후에도 품절 0·실패 —·이전 수량 7·실제 미연결 보존', async () => {
      await expectDataMeaning(page);
      await expectProgress(page, 3);
    });

    await check('1440·768·360 화면 넘침 없음·오늘 완료 화면 캡처', async () => {
      for (const [name, width, height] of [['desktop', 1440, 1000], ['tablet', 768, 1024], ['mobile', 360, 800]]) {
        await page.setViewportSize({ width, height });
        await expectProgress(page, 3);
        const sizes = await page.evaluate(() => ({ body: document.body.scrollWidth, doc: document.documentElement.scrollWidth }));
        assert.ok(sizes.body <= width + 1 && sizes.doc <= width + 1, `${name} 가로 넘침: ${JSON.stringify(sizes)}`);
        await page.locator('#toast').waitFor({ state: 'hidden', timeout: 4500 });
        await page.screenshot({ path: path.join(screenshotPath, `daily-${name}.png`), fullPage: true });
      }
    });
    await context.close();

    await check('서울 자정 이후 대시보드는 새날 1/3·이전 기록 유지', async () => midnightScenario(browser, 'dashboard', 1));
    await check('서울 자정 이후 재고 화면은 새날 열기+재고 2/3', async () => midnightScenario(browser, 'inventory', 2));
    await check('서울 자정 이후 주문 화면은 새날 열기+주문 2/3', async () => midnightScenario(browser, 'orders', 2));

    await check('깨진 JSON을 읽어도 정상 열기·확인·재저장', async () => {
      const corrupt = await newContext(browser, () => {
        // 새 탭의 about:blank에서는 저장소에 접근할 수 없으므로 대상 문서에서만 준비합니다.
        if (location.protocol === 'file:') localStorage.setItem('stockd.daily-checks.v1', '{broken JSON');
      });
      try {
        const brokenPage = await openPage(corrupt);
        await expectProgress(brokenPage, 1);
        await nav(brokenPage, 'inventory');
        await nav(brokenPage, 'orders');
        await expectProgress(brokenPage, 3);
        await expectDay(brokenPage, today, { opened: true, inventory: true, orders: true });
      } finally {
        await corrupt.close();
      }
    });

    await check('과거 90일 범위 기록만 읽고 오늘은 새로 시작', async () => {
      const historical = await newContext(browser, () => {
        if (location.protocol !== 'file:') return;
        localStorage.setItem('stockd.daily-checks.v1', JSON.stringify({ version: 1, days: {
          '2026-10-04': { opened: true, inventory: true, orders: true },
          '2026-01-01': { opened: true, inventory: true, orders: true }
        } }));
      });
      try {
        const historyPage = await openPage(historical);
        await expectProgress(historyPage, 1);
        await expectDay(historyPage, '2026-10-04', { opened: true, inventory: true, orders: true });
        assert.match(await historyPage.locator('[data-daily-date="2026-10-04"]').innerText(), /완료/);
        assert.equal((await record(historyPage)).days['2026-01-01'], undefined);
      } finally {
        await historical.close();
      }
    });

    await check('저장소 접근 차단에도 현재 페이지 확인과 초기화 정상', async () => {
      const blocked = await newContext(browser, () => {
        // 브라우저가 저장을 허용하지 않는 경우를 재현합니다.
        for (const method of ['getItem', 'setItem', 'removeItem']) {
          Storage.prototype[method] = function () { throw new DOMException('테스트: 저장소 차단', 'SecurityError'); };
        }
      });
      try {
        const blockedPage = await openPage(blocked);
        await expectProgress(blockedPage, 1);
        await nav(blockedPage, 'inventory');
        await nav(blockedPage, 'orders');
        await expectProgress(blockedPage, 3);
        await nav(blockedPage, 'connections');
        await blockedPage.locator('[data-action="daily-reset"]').click();
        await expectProgress(blockedPage, 1);
      } finally {
        await blocked.close();
      }
    });

    await check('브라우저 실행 오류·자동 외부 요청 없음', async () => {
      assert.deepEqual(errors, []);
      assert.deepEqual(requests, []);
    });
  } finally {
    await browser.close();
  }
  const failed = results.filter(result => result.status === '실패');
  const report = {
    checkedAt: new Date().toISOString(),
    browserTimeZone: 'UTC',
    recordTimeZone: 'Asia/Seoul',
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    viewports: [{ width: 1440, height: 1000 }, { width: 768, height: 1024 }, { width: 360, height: 800 }],
    errors,
    requests,
    results
  };
  fs.writeFileSync(path.join(screenshotPath, 'daily-missions-verification.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report, null, 2));
  if (failed.length) process.exitCode = 1;
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
