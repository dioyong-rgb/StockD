// 일일 확인 완료로 열리는 연재 이야기의 누적 기록과 접근 범위, 저장 예외를 검증합니다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { chromium } = require('C:/Users/dioyongPC/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const root = path.resolve(__dirname, '..');
const htmlPath = path.join(root, 'preview', 'index.html');
const screenshotPath = path.join(root, 'preview', 'screenshots');
const dailyKey = 'stockd.daily-checks.v1';
const storyKey = 'stockd.story-progress.v1';
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

async function closeDialog(page) {
  if (await page.locator('dialog[open]').count()) await page.keyboard.press('Escape');
}

async function storyRecord(page) {
  return page.evaluate(key => JSON.parse(localStorage.getItem(key)), storyKey);
}

async function expectStoryProgress(page, completed) {
  await closeDialog(page);
  await nav(page, 'dashboard');
  assert.equal(await page.locator('#storyPanel').count(), 1);
  await page.waitForFunction(expected => {
    const text = document.getElementById('storyProgressText')?.textContent || '';
    return new RegExp(`${expected}\\s*/\\s*15`).test(text);
  }, completed);
  assert.match(await page.locator('#storyProgressText').innerText(), new RegExp(`${completed}\\s*/\\s*15`));
  assert.equal(await page.locator('[data-action="story-open"]').count(), 1);
  assert.equal(await page.locator('[data-action="story-open"]').isDisabled(), completed === 0);
  assert.match(await page.locator('.preview-strip').innerText(), /샘플 데이터.*실제 API 미연동/);
}

async function expectStoryDates(page, dates) {
  const saved = await storyRecord(page);
  assert.equal(saved.version, 1);
  assert.deepEqual([...saved.unlockedDates].sort(), [...dates].sort());
  assert.equal(new Set(saved.unlockedDates).size, dates.length);
  assert.ok(Number.isInteger(saved.lastViewed) && saved.lastViewed >= 0 && saved.lastViewed <= dates.length);
}

async function completeDay(page) {
  await closeDialog(page);
  await nav(page, 'inventory');
  assert.ok(await page.locator('.inventory-table tbody tr').count());
  await nav(page, 'orders');
  assert.ok(await page.locator('.orders-table tbody tr').count());
  // 확인 완료는 작업 화면을 유지하고 이야기를 자동으로 열지 않습니다.
  assert.equal(await page.locator('dialog[open]').count(), 0);
  assert.equal(await page.locator('.nav [aria-current="page"]').getAttribute('data-view'), 'orders');
}

async function changeDate(page, date) {
  await page.clock.setFixedTime(`${date}T01:00:00Z`);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
}

async function expectScene(page, index) {
  const open = page.locator('dialog[open]');
  assert.equal(await open.count(), 1);
  assert.ok((await open.locator('#storySceneTitle').innerText()).trim());
  assert.ok((await open.locator('#storySceneText').innerText()).trim());
  assert.equal(await open.locator('#storySceneArt').evaluate(element => element.tagName.toLowerCase()), 'svg');
  assert.equal(await open.locator('#storySceneArt').getAttribute('aria-hidden'), 'true');
  assert.equal((await storyRecord(page)).lastViewed, index);
}

async function openStory(page) {
  await closeDialog(page);
  await nav(page, 'dashboard');
  await page.locator('[data-action="story-open"]').click();
}

async function newContext(browser, seed = {}, init) {
  // UTC 브라우저에서도 업무 날짜는 한국 날짜를 사용해야 합니다.
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'ko-KR', timezoneId: 'UTC' });
  await context.route(/^https?:/, async route => { requests.push(route.request().url()); await route.abort(); });
  context.on('page', page => {
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('websocket', socket => requests.push(socket.url()));
    page.setDefaultTimeout(5000);
  });
  if (Object.keys(seed).length) {
    await context.addInitScript(values => {
      // about:blank의 저장소 오류와 새로고침 때 fixture 재주입을 피합니다.
      if (location.protocol !== 'file:' || localStorage.getItem('stockd.story-test-seeded')) return;
      for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value);
      localStorage.setItem('stockd.story-test-seeded', 'true');
    }, seed);
  }
  if (init) await context.addInitScript(init);
  return context;
}

async function openPage(context, time = fixedTime) {
  const page = await context.newPage();
  await page.clock.setFixedTime(time);
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle' });
  return page;
}

function dayRecord(opened = true, inventory = true, orders = true) {
  return { opened, inventory, orders };
}

function fixture(value) { return JSON.stringify(value); }

async function keyboardOpenStory(page) {
  await nav(page, 'dashboard');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'main');
  let reached = false;
  for (let index = 0; index < 100; index += 1) {
    await page.keyboard.press('Tab');
    reached = await page.locator('[data-action="story-open"]').evaluate(element => element === document.activeElement);
    if (reached) break;
  }
  assert.ok(reached, '키보드로 이야기 열기 버튼에 도달해야 합니다.');
  const focus = await page.locator('[data-action="story-open"]').evaluate(element => {
    const style = getComputedStyle(element);
    return { visible: element.matches(':focus-visible'), outline: style.outlineStyle, shadow: style.boxShadow };
  });
  assert.ok(focus.visible && (focus.outline !== 'none' || focus.shadow !== 'none'));
  await page.keyboard.press('Enter');
}

async function expectDataMeaning(page) {
  await closeDialog(page);
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
}

async function run() {
  fs.mkdirSync(screenshotPath, { recursive: true });
  const html = fs.readFileSync(htmlPath, 'utf8');
  await check('인라인 이야기 자산·스크립트 문법·외부 호출 없음', async () => {
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

    await check('처음 열기는 일일 1/3·이야기 0/15·열기 잠김', async () => {
      await expectStoryProgress(page, 0);
      assert.equal(await page.locator('#dailyProgress').evaluate(element => element.value), 1);
    });

    await check('재고만 확인하면 이야기 없음·주문까지 3/3이면 첫 1컷 자동 해금', async () => {
      await nav(page, 'inventory');
      await expectStoryProgress(page, 0);
      await nav(page, 'orders');
      assert.equal(await page.locator('dialog[open]').count(), 0);
      assert.equal(await page.locator('.nav [aria-current="page"]').getAttribute('data-view'), 'orders');
      await expectStoryProgress(page, 1);
      assert.equal(await page.locator('#dailyProgress').evaluate(element => element.value), 3);
      await expectStoryDates(page, [today]);
    });

    await check('같은날 반복 확인은 1컷 유지·작업 방해 팝업 없음', async () => {
      for (let index = 0; index < 3; index += 1) await completeDay(page);
      await expectStoryProgress(page, 1);
      await expectStoryDates(page, [today]);
    });

    await check('키보드 열기·첫 장면 SVG와 글·ESC 초점 복귀', async () => {
      await keyboardOpenStory(page);
      await expectScene(page, 1);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('dialog[open]').count(), 0);
      assert.equal(await page.locator('[data-action="story-open"]').evaluate(element => element === document.activeElement), true);
    });

    await check('15컷 목록·잠긴 선택 및 다음 버튼은 접근할 수 없음', async () => {
      await openStory(page);
      const choices = page.locator('dialog[open] [data-action="story-select"]');
      assert.equal(await choices.count(), 15);
      for (let index = 1; index <= 15; index += 1) {
        const choice = page.locator(`dialog[open] [data-action="story-select"][data-story-index="${index}"]`);
        assert.equal(await choice.count(), 1);
        assert.equal(await choice.isDisabled(), index > 1);
      }
      assert.equal(await page.locator('dialog[open] [data-action="story-prev"]').isDisabled(), true);
      assert.equal(await page.locator('dialog[open] [data-action="story-next"]').isDisabled(), true);
      const before = await page.locator('#storySceneText').innerText();
      // 잠긴 버튼의 이벤트를 직접 보내도 표시 범위를 넘어가면 안 됩니다.
      await page.locator('[data-action="story-select"][data-story-index="15"]').evaluate(element => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      await page.locator('[data-action="story-next"]').evaluate(element => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      await expectScene(page, 1);
      assert.equal(await page.locator('#storySceneText').innerText(), before);
      await closeDialog(page);
    });

    await check('다음 한국 날짜를 완료하면 2컷·이전 다음과 마지막 본 컷 기억', async () => {
      await changeDate(page, '2026-10-06');
      await expectStoryProgress(page, 1);
      assert.equal(await page.locator('#dailyProgress').evaluate(element => element.value), 1);
      await completeDay(page);
      await expectStoryProgress(page, 2);
      await expectStoryDates(page, [today, '2026-10-06']);
      await openStory(page);
      await expectScene(page, 1);
      assert.equal(await page.locator('[data-action="story-next"]').isDisabled(), false);
      await page.locator('[data-action="story-next"]').click();
      await expectScene(page, 2);
      assert.equal(await page.locator('[data-action="story-next"]').isDisabled(), true);
      await page.locator('[data-action="story-prev"]').click();
      await expectScene(page, 1);
      await page.locator('[data-action="story-select"][data-story-index="2"]').click();
      await expectScene(page, 2);
      await closeDialog(page);
      await openStory(page);
      await expectScene(page, 2);
      await closeDialog(page);
    });

    await check('새로고침·동일 브라우저 재열기에서 누적과 마지막 본 컷 유지', async () => {
      await page.reload({ waitUntil: 'networkidle' });
      await expectStoryProgress(page, 2);
      await openStory(page);
      await expectScene(page, 2);
      await page.close();
      page = await openPage(context, '2026-10-06T01:00:00Z');
      await expectStoryProgress(page, 2);
      await openStory(page);
      await expectScene(page, 2);
      await closeDialog(page);
    });

    await check('샘플 초기화·일일 기록 삭제가 연재 성취와 열람 위치를 지우지 않음', async () => {
      await nav(page, 'connections');
      await page.locator('[data-action="sample-reset"]').click();
      await expectStoryProgress(page, 2);
      await nav(page, 'connections');
      await page.locator('[data-action="daily-reset"]').click();
      await expectStoryProgress(page, 2);
      assert.equal(await page.locator('#dailyProgress').evaluate(element => element.value), 1);
      await expectStoryDates(page, [today, '2026-10-06']);
      assert.equal((await storyRecord(page)).lastViewed, 2);
    });

    await check('일일 기록 삭제 후 같은날 재완료해도 추가 컷 중복 없음', async () => {
      await completeDay(page);
      await expectStoryProgress(page, 2);
      await expectStoryDates(page, [today, '2026-10-06']);
    });

    await check('쉬는 날 새 페이지 열기·새로고침은 누적 성취 유지', async () => {
      await changeDate(page, '2026-10-08');
      await expectStoryProgress(page, 2);
      assert.equal(await page.locator('#dailyProgress').evaluate(element => element.value), 1);
      await page.reload({ waitUntil: 'networkidle' });
      await expectStoryProgress(page, 2);
      await expectStoryDates(page, [today, '2026-10-06']);
    });
    await context.close();

    await check('기존 최근 90일의 3/3 완료 기록만 이야기로 마이그레이션', async () => {
      const migration = await newContext(browser, { [dailyKey]: fixture({ version: 1, days: {
        '2026-10-04': dayRecord(),
        '2026-10-03': dayRecord(true, true, false),
        '2026-10-02': dayRecord(),
        '2026-01-01': dayRecord(),
        '2026-10-07': dayRecord()
      } }) });
      try {
        const migratedPage = await openPage(migration);
        await expectStoryProgress(migratedPage, 2);
        await expectStoryDates(migratedPage, ['2026-10-02', '2026-10-04']);
        await migratedPage.reload({ waitUntil: 'networkidle' });
        await expectStoryProgress(migratedPage, 2);
      } finally { await migration.close(); }
    });

    await check('90일 이전 이야기 성취는 일일 기록이 정리되어도 유지', async () => {
      const historical = await newContext(browser, {
        [storyKey]: fixture({ version: 1, unlockedDates: ['2026-01-01'], lastViewed: 1 }),
        [dailyKey]: fixture({ version: 1, days: { '2026-01-01': dayRecord() } })
      });
      try {
        const oldPage = await openPage(historical);
        await expectStoryProgress(oldPage, 1);
        await expectStoryDates(oldPage, ['2026-01-01']);
        assert.equal(await oldPage.evaluate(key => JSON.parse(localStorage.getItem(key)).days['2026-01-01'], dailyKey), undefined);
        await completeDay(oldPage);
        await expectStoryProgress(oldPage, 2);
        await expectStoryDates(oldPage, ['2026-01-01', today]);
      } finally { await historical.close(); }
    });

    await check('미래·잘못된 날짜·중복 성취·잘못된 열람 위치를 정리', async () => {
      const malformed = await newContext(browser, { [storyKey]: fixture({ version: 1, unlockedDates: [
        '2026-10-04', '2026-10-04', '2026-10-07', '2026-02-30', 'bad-date', 1, null
      ], lastViewed: 99 }) });
      try {
        const malformedPage = await openPage(malformed);
        await expectStoryProgress(malformedPage, 1);
        await expectStoryDates(malformedPage, ['2026-10-04']);
        await openStory(malformedPage);
        await expectScene(malformedPage, 1);
      } finally { await malformed.close(); }
    });

    await check('깨진 이야기 JSON에도 정상 시작과 첫 컷 저장', async () => {
      const corrupt = await newContext(browser, { [storyKey]: '{broken JSON' });
      try {
        const corruptPage = await openPage(corrupt);
        await expectStoryProgress(corruptPage, 0);
        await completeDay(corruptPage);
        await expectStoryProgress(corruptPage, 1);
        await expectStoryDates(corruptPage, [today]);
      } finally { await corrupt.close(); }
    });

    await check('이야기를 연 채 한국 날짜가 바뀌어도 ESC는 새 열기 버튼으로 초점 복귀', async () => {
      const rollover = await newContext(browser, {
        [dailyKey]: fixture({ version: 1, days: { [today]: dayRecord() } }),
        [storyKey]: fixture({ version: 1, unlockedDates: [today], lastViewed: 1 })
      });
      try {
        const rolloverPage = await openPage(rollover);
        await openStory(rolloverPage);
        await expectScene(rolloverPage, 1);
        await changeDate(rolloverPage, '2026-10-06');
        assert.equal(await rolloverPage.locator('dialog[open]').count(), 1);
        await expectScene(rolloverPage, 1);
        await rolloverPage.keyboard.press('Escape');
        assert.equal(await rolloverPage.locator('dialog[open]').count(), 0);
        const trigger = rolloverPage.locator('[data-action="story-open"]');
        assert.equal(await trigger.evaluate(element => element === document.activeElement), true);
        assert.equal(await rolloverPage.locator('#dailyProgress').evaluate(element => element.value), 1);
        await trigger.press('Enter');
        await expectScene(rolloverPage, 1);
      } finally { await rollover.close(); }
    });

    await check('다른 탭 새 컷 해금은 열린 읽기창·버튼만 갱신하고 장면·초점 유지·저장 반복 없음', async () => {
      const liveReader = await newContext(browser, {
        [dailyKey]: fixture({ version: 1, days: { [today]: dayRecord() } }),
        [storyKey]: fixture({ version: 1, unlockedDates: [today], lastViewed: 1 })
      }, () => {
        window.__storyWriteCount = 0;
        window.__storyEventCount = 0;
        const original = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, ...values) {
          if (key === 'stockd.story-progress.v1') window.__storyWriteCount += 1;
          return original.call(this, key, ...values);
        };
        window.addEventListener('storage', event => {
          if (event.key === 'stockd.story-progress.v1') window.__storyEventCount += 1;
        });
      });
      try {
        const first = await openPage(liveReader);
        const second = await openPage(liveReader);
        await openStory(first);
        const current = first.locator('[data-action="story-select"][data-story-index="1"]');
        await current.focus();
        assert.equal(await current.evaluate(element => element === document.activeElement), true);
        const beforeText = await first.locator('#storySceneText').innerText();
        const countWrites = pageToRead => pageToRead.evaluate(() => ({ writes: window.__storyWriteCount, events: window.__storyEventCount }));
        const before = await Promise.all([countWrites(first), countWrites(second)]);
        // 같은 기기의 두 탭은 같은 날짜이며, 각 탭의 날짜 감시도 먼저 갱신합니다.
        await changeDate(first, '2026-10-06');
        await changeDate(second, '2026-10-06');
        await completeDay(second);
        await first.waitForFunction(() => /열린\s*2\s*\/\s*15/.test(document.querySelector('dialog[open] .dialog-heading p')?.textContent || ''));
        await expectScene(first, 1);
        assert.equal(await first.locator('#storySceneText').innerText(), beforeText);
        assert.equal(await current.getAttribute('aria-current'), 'step');
        assert.equal(await current.evaluate(element => element === document.activeElement), true);
        assert.equal(await first.locator('[data-action="story-next"]').isDisabled(), false);
        assert.equal(await first.locator('[data-action="story-select"][data-story-index="2"]').isDisabled(), false);
        await expectStoryDates(first, [today, '2026-10-06']);
        // 비동기 저장 이벤트가 정착한 뒤 횟수가 계속 늘지 않아야 합니다.
        await first.waitForTimeout(250);
        const settled = await Promise.all([countWrites(first), countWrites(second)]);
        await first.waitForTimeout(500);
        const later = await Promise.all([countWrites(first), countWrites(second)]);
        assert.deepEqual(later, settled, '이야기 갱신 뒤 저장 이벤트가 반복됩니다.');
        const addedWrites = settled.reduce((sum, value, index) => sum + value.writes - before[index].writes, 0);
        const addedEvents = settled.reduce((sum, value, index) => sum + value.events - before[index].events, 0);
        assert.ok(addedWrites <= 8 && addedEvents <= 8, `과도한 이야기 저장/이벤트: ${addedWrites}/${addedEvents}`);
        await first.locator('[data-action="story-next"]').click();
        await expectScene(first, 2);
      } finally { await liveReader.close(); }
    });

    await check('여러 탭의 날짜별 성취를 합치고 오래된 덮어쓰기에서 복원', async () => {
      const parallel = await newContext(browser);
      try {
        const first = await openPage(parallel);
        const second = await openPage(parallel);
        await completeDay(first);
        await second.waitForFunction(() => /1\s*\/\s*15/.test(document.getElementById('storyProgressText')?.textContent || ''));
        await expectStoryProgress(second, 1);
        await changeDate(first, '2026-10-06');
        await changeDate(second, '2026-10-06');
        await completeDay(second);
        await expectStoryProgress(first, 2);
        await expectStoryProgress(second, 2);
        await expectStoryDates(first, [today, '2026-10-06']);
        await second.evaluate(({ key, date }) => localStorage.setItem(key, JSON.stringify({ version: 1, unlockedDates: [date], lastViewed: 0 })), { key: storyKey, date: today });
        await first.waitForFunction(key => JSON.parse(localStorage.getItem(key)).unlockedDates.length === 2, storyKey);
        await expectStoryProgress(first, 2);
        await expectStoryProgress(second, 2);
        await expectStoryDates(first, [today, '2026-10-06']);
      } finally { await parallel.close(); }
    });

    await check('이야기 저장 차단에도 현재 열기에서 완료·열람 유지와 안내', async () => {
      const blocked = await newContext(browser, {}, () => {
        for (const method of ['getItem', 'setItem', 'removeItem']) {
          const original = Storage.prototype[method];
          Storage.prototype[method] = function (key, ...values) {
            if (key === 'stockd.story-progress.v1') throw new DOMException('테스트: 이야기 저장 차단', 'SecurityError');
            return original.call(this, key, ...values);
          };
        }
      });
      try {
        const blockedPage = await openPage(blocked);
        await expectStoryProgress(blockedPage, 0);
        await completeDay(blockedPage);
        await expectStoryProgress(blockedPage, 1);
        assert.match(await blockedPage.locator('#storyPanel').innerText(), /현재.*열기|저장.*없|브라우저.*저장/s);
        await openStory(blockedPage);
        assert.ok((await blockedPage.locator('#storySceneText').innerText()).trim());
        await closeDialog(blockedPage);
        await expectStoryProgress(blockedPage, 1);
      } finally { await blocked.close(); }
    });

    await check('15컷 상한·3에피소드의 모든 컷 열람·마지막 다음 잠김과 완결 안내', async () => {
      const dates = Array.from({ length: 18 }, (_, index) => `2026-09-${String(index + 1).padStart(2, '0')}`);
      const capped = await newContext(browser, { [storyKey]: fixture({ version: 1, unlockedDates: dates, lastViewed: 0 }) });
      try {
        const cappedPage = await openPage(capped);
        await expectStoryProgress(cappedPage, 15);
        assert.equal((await storyRecord(cappedPage)).unlockedDates.length, 15);
        await completeDay(cappedPage);
        await expectStoryProgress(cappedPage, 15);
        assert.equal((await storyRecord(cappedPage)).unlockedDates.length, 15);
        await openStory(cappedPage);
        const texts = [];
        for (let index = 1; index <= 15; index += 1) {
          const choice = cappedPage.locator(`[data-action="story-select"][data-story-index="${index}"]`);
          assert.equal(await choice.isDisabled(), false);
          await choice.click();
          await expectScene(cappedPage, index);
          texts.push(await cappedPage.locator('#storySceneText').innerText());
        }
        assert.equal(new Set(texts).size, 15, '모든 열린 컷은 서로 다른 이야기여야 합니다.');
        assert.equal(await cappedPage.locator('[data-action="story-next"]').isDisabled(), true);
        assert.match(await cappedPage.locator('dialog[open]').innerText(), /완결|마지막|모든 이야기|모두.*열|끝/s);
        await closeDialog(cappedPage);

        await check('이야기 해금 뒤에도 품절 0·오류 —·이전 수량 7·실제 미연결 보존', async () => {
          await expectDataMeaning(cappedPage);
          await expectStoryProgress(cappedPage, 15);
        });

        await check('reduced-motion에서도 이야기 선택·읽기 정상과 움직임 없음', async () => {
          await cappedPage.emulateMedia({ reducedMotion: 'reduce' });
          await openStory(cappedPage);
          await cappedPage.locator('[data-action="story-select"][data-story-index="1"]').click();
          await expectScene(cappedPage, 1);
          const animated = await cappedPage.evaluate(() => document.getAnimations().filter(animation => {
            const duration = animation.effect?.getComputedTiming().duration;
            return animation.playState === 'running' && typeof duration === 'number' && duration > 0;
          }).length);
          assert.equal(animated, 0);
          await closeDialog(cappedPage);
        });

        await check('1440·768·360 이야기 모달 가로 넘침 없음·장면 캡처', async () => {
          for (const [name, width, height] of [['desktop', 1440, 1000], ['tablet', 768, 1024], ['mobile', 360, 800]]) {
            await cappedPage.setViewportSize({ width, height });
            await openStory(cappedPage);
            await cappedPage.locator('[data-action="story-select"][data-story-index="1"]').click();
            const bounds = await cappedPage.locator('dialog[open]').boundingBox();
            assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1, `${name} 이야기 모달이 화면을 넘칩니다.`);
            const sizes = await cappedPage.evaluate(() => ({ body: document.body.scrollWidth, doc: document.documentElement.scrollWidth }));
            assert.ok(sizes.body <= width + 1 && sizes.doc <= width + 1, `${name} 페이지 가로 넘침: ${JSON.stringify(sizes)}`);
            await cappedPage.locator('#toast').waitFor({ state: 'hidden', timeout: 4500 });
            await cappedPage.screenshot({ path: path.join(screenshotPath, `story-${name}.png`), fullPage: true });
            await closeDialog(cappedPage);
          }
        });
      } finally { await capped.close(); }
    });

    await check('브라우저 실행 오류·자동 외부 요청 없음', async () => {
      assert.deepEqual(errors, []);
      assert.deepEqual(requests, []);
    });
  } finally { await browser.close(); }
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
  fs.writeFileSync(path.join(screenshotPath, 'story-missions-verification.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report, null, 2));
  if (failed.length) process.exitCode = 1;
}

run().catch(error => { console.error(error); process.exitCode = 1; });
