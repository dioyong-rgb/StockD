// 샘플 미션을 사용자 행동으로 수행하여 진행도, 배지, 데이터 의미와 접근성을 검증합니다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { chromium } = require('C:/Users/dioyongPC/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const root = path.resolve(__dirname, '..');
const htmlPath = path.join(root, 'preview', 'index.html');
const screenshotPath = path.join(root, 'preview', 'screenshots');
const results = [];
const errors = [];
const requests = [];
const views = ['dashboard', 'inventory', 'orders', 'mapping', 'alerts', 'connections'];
const mappingIds = ['c2', 'c3', 'n5'];

async function check(name, action) {
  try {
    await action();
    results.push({ name, status: '통과' });
  } catch (error) {
    results.push({ name, status: '실패', error: error.message });
  }
}

function contains(value, expected) {
  assert.ok(value.includes(expected), `문구 누락: ${expected}`);
}

async function nav(page, view) {
  await page.locator(`.nav button[data-view="${view}"]`).click();
}

async function openPractice(page) {
  const practice = page.locator('#samplePractice');
  if (await practice.count() && !(await practice.evaluate(element => element.open))) await practice.locator('summary').click();
}

async function expectProgress(page, completed) {
  await nav(page, 'dashboard');
  await openPractice(page);
  const progress = page.locator('#reviewProgress');
  assert.equal(await progress.count(), 1, '검토 진행 막대가 하나여야 합니다.');
  assert.equal(await progress.evaluate(element => element.tagName), 'PROGRESS', '진행도를 접근 가능한 기본 progress 요소로 제공합니다.');
  assert.equal(await progress.evaluate(element => element.max), 3);
  assert.equal(await progress.evaluate(element => element.value), completed);
  const text = await page.locator('#reviewProgressText').innerText();
  assert.match(text, new RegExp(`${completed}\\s*/\\s*3`), `진행도 문구 불일치: ${text}`);
}

async function expectBadge(page, id, acquired) {
  await nav(page, 'dashboard');
  const badge = page.locator(`[data-badge="${id}"]`);
  assert.equal(await badge.count(), 1, `${id} 배지는 하나만 표시해야 합니다.`);
  const text = `${await badge.innerText()} ${await badge.getAttribute('aria-label') || ''}`;
  if (acquired) {
    assert.match(text, /획득|달성/, `배지 획득을 읽을 수 없습니다: ${text}`);
    assert.doesNotMatch(text, /미획득|미달성|아직 획득/);
  } else {
    assert.match(text, /미획득|미달성|아직|대기|잠김/, `배지 미획득을 읽을 수 없습니다: ${text}`);
  }
}

async function closeDialog(page) {
  if (await page.locator('dialog[open]').count()) await page.keyboard.press('Escape');
}

async function reviewMission(page, id) {
  await nav(page, 'dashboard');
  await openPractice(page);
  const trigger = page.locator(`[data-action="mission-open"][data-id="${id}"]`);
  await trigger.click();
  const review = page.locator(`dialog[open] [data-action="mission-review"][data-id="${id}"]`);
  assert.equal(await review.count(), 1, `${id} 검토 기록 버튼이 열린 상세 안에 있어야 합니다.`);
  if (!(await review.isDisabled())) await review.click();
  await closeDialog(page);
}

async function approveMapping(page, id) {
  await nav(page, 'mapping');
  const select = page.locator(`[data-mapping-id="${id}"]`);
  const options = await select.locator('option').evaluateAll(elements => elements.map(element => element.value));
  assert.ok(options.length > 0, `${id}의 내부 SKU 후보가 없습니다.`);
  // 후보를 직접 선택한 뒤 승인하는 실제 시연 흐름을 수행합니다.
  await select.selectOption(options[options.length - 1]);
  await page.locator(`[data-action="mapping-approve"][data-id="${id}"]`).click();
  const row = page.locator(`.mapping-table tr:has(button[data-id="${id}"])`);
  contains(await row.innerText(), options[options.length - 1]);
  contains(await row.innerText(), '샘플 연결됨');
}

async function resetSample(page) {
  await closeDialog(page);
  await nav(page, 'connections');
  await page.locator('[data-action="sample-reset"]').click();
  await expectProgress(page, 0);
}

async function keyboardActivate(page, selector) {
  // main 초점에서 실제 Tab 이동으로 버튼에 도달하여 Enter로 실행합니다.
  await nav(page, 'dashboard');
  assert.equal(await page.evaluate(() => document.activeElement.id), 'main');
  let reached = false;
  for (let index = 0; index < 60; index += 1) {
    await page.keyboard.press('Tab');
    reached = await page.locator(selector).evaluate(element => element === document.activeElement);
    if (reached) break;
  }
  assert.ok(reached, `키보드로 미션 버튼에 도달하지 못했습니다: ${selector}`);
  const focus = await page.locator(selector).evaluate(element => {
    const style = getComputedStyle(element);
    return { visible: element.matches(':focus-visible'), outline: style.outlineStyle, shadow: style.boxShadow };
  });
  assert.ok(focus.visible && (focus.outline !== 'none' || focus.shadow !== 'none'), '키보드 초점 표시가 필요합니다.');
  await page.keyboard.press('Enter');
}

async function expectQuietMotion(page) {
  const animated = await page.evaluate(() => document.getAnimations().filter(animation => {
    const duration = animation.effect?.getComputedTiming().duration;
    return animation.playState === 'running' && typeof duration === 'number' && duration > 0;
  }).length);
  assert.equal(animated, 0, '효과를 줄이는 설정에서는 움직이는 축하 효과를 표시하지 않습니다.');
}

async function expectDataMeaning(page) {
  await nav(page, 'inventory');
  const zero = page.locator('.inventory-table tr:has(button[data-id="n2"])');
  contains(await zero.innerText(), '품절');
  assert.equal((await zero.locator('td.number').innerText()).trim(), '0');
  const stale = page.locator('.inventory-table tr:has(button[data-id="c2"])');
  contains(await stale.innerText(), '이전 수량 유지 · 최근 조회 실패');
  contains(await stale.innerText(), '09:02');
  contains(await stale.innerText(), '09:39');
  assert.equal((await stale.locator('td.number').innerText()).trim(), '7');
  const failed = page.locator('.inventory-table tr:has(button[data-id="r2"])');
  contains(await failed.innerText(), '조회 실패');
  contains(await failed.innerText(), '이전 성공값 없음');
  assert.equal((await failed.locator('td.number').innerText()).trim(), '—');
  for (const [id, label] of [['n3', '관리 미사용'], ['n4', '미지원 예시'], ['c3', '지원 미확인']]) {
    const row = page.locator(`.inventory-table tr:has(button[data-id="${id}"])`);
    contains(await row.innerText(), label);
    assert.equal((await row.locator('td.number').innerText()).trim(), '—');
  }
  await nav(page, 'connections');
  assert.equal(await page.locator('.status-dot').count(), 2);
  for (const label of await page.locator('.status-dot').allTextContents()) assert.equal(label, '실제 미연결');
  assert.equal(await page.locator('input[type="password"]').count(), 0);
  await nav(page, 'orders');
  contains(await page.locator('main .notice').first().innerText(), '출고 이후');
  const rg = page.locator('.orders-table tr:has(button[data-id="DEMO-RO-301"])');
  contains(await rg.innerText(), '상태 미확인');
  contains(await rg.innerText(), '지원 미확인');
}

async function run() {
  fs.mkdirSync(screenshotPath, { recursive: true });
  const html = fs.readFileSync(htmlPath, 'utf8');
  await check('단일 HTML·인라인 자산·외부 호출 없음', async () => {
    assert.match(html, /<html lang="ko">/);
    assert.match(html, /<style>/);
    assert.doesNotMatch(html, /<script\b[^>]*\bsrc\s*=|<link\b[^>]*\brel\s*=\s*["'](?:stylesheet|preload|prefetch|modulepreload)|<(?:img|iframe|video|audio)\b[^>]*\bsrc\s*=\s*["']https?:/i);
    assert.doesNotMatch(html, /(?:@import\s+|url\(\s*["']?https?:|\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b)/);
    const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
    assert.ok(scripts.length);
    scripts.forEach((script, index) => new vm.Script(script[1], { filename: `inline-${index}.js` }));
  });
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'ko-KR' });
    // 외부 주소로 요청이 발생하면 기록하고 차단합니다. 이 검증은 file:// 시안만 엽니다.
    await context.route(/^https?:/, async route => {
      requests.push(route.request().url());
      await route.abort();
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('websocket', socket => requests.push(socket.url()));
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle' });

    await check('처음 진행 0/3·샘플 범위·미획득 배지', async () => {
      contains(await page.locator('.preview-strip').innerText(), '샘플 데이터 · 실제 API 미연동');
      assert.equal(await page.locator('.nav button').count(), 6);
      await expectProgress(page, 0);
      await expectBadge(page, 'first-link', false);
      await expectBadge(page, 'review-round', false);
      const text = await page.locator('main').innerText();
      contains(text, '샘플');
      contains(text, '검토');
      assert.equal(await page.locator('[data-action="mission-open"]').count(), 3);
      for (const id of ['stock', 'sync', 'mapping']) assert.equal(await page.locator(`[data-action="mission-open"][data-id="${id}"]`).count(), 1);
    });

    await check('6개 화면 방문은 추가 샘플 연습 완료로 계산하지 않음', async () => {
      for (const view of views) {
        await nav(page, view);
        assert.equal(await page.locator('.nav [aria-current="page"]').getAttribute('data-view'), view);
        assert.equal(await page.evaluate(() => document.activeElement.id), 'main');
        contains(await page.locator('.preview-strip').innerText(), '샘플 데이터 · 실제 API 미연동');
      }
      await expectProgress(page, 0);
    });

    await check('알림을 모두 읽어도 미션 진행·배지 없음', async () => {
      await nav(page, 'alerts');
      for (const id of ['a1', 'a2', 'a3', 'a4', 'a5']) await page.locator(`[data-action="alert-acknowledge"][data-id="${id}"]`).click();
      assert.equal(await page.locator('#alertCount').innerText(), '0');
      await expectProgress(page, 0);
      await expectBadge(page, 'first-link', false);
      await expectBadge(page, 'review-round', false);
    });

    await check('재고 미션 키보드 열기·ESC 닫기·초점 복귀·미완료', async () => {
      const selector = '[data-action="mission-open"][data-id="stock"]';
      await keyboardActivate(page, selector);
      assert.equal(await page.locator('dialog[open]').count(), 1);
      const detail = await page.locator('dialog[open]').innerText();
      contains(detail, '샘플');
      contains(detail, '재고');
      assert.equal(await page.locator('dialog[open] [data-action="mission-review"][data-id="stock"]').count(), 1);
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('dialog[open]').count(), 0);
      assert.equal(await page.locator(selector).evaluate(element => element === document.activeElement), true);
      await expectProgress(page, 0);
    });

    await check('재고 명시적 검토 기록은 1/3·재검토 중복 증가 없음', async () => {
      await reviewMission(page, 'stock');
      await expectProgress(page, 1);
      await reviewMission(page, 'stock');
      await expectProgress(page, 1);
      await expectBadge(page, 'review-round', false);
    });

    await check('조회 실패 상세 열기만으로 추가 진행 없음', async () => {
      await nav(page, 'dashboard');
      const trigger = page.locator('[data-action="mission-open"][data-id="sync"]');
      await trigger.click();
      const detail = await page.locator('dialog[open]').innerText();
      contains(detail, '샘플');
      contains(detail, '조회');
      await page.keyboard.press('Escape');
      assert.equal(await trigger.evaluate(element => element === document.activeElement), true);
      await expectProgress(page, 1);
    });

    await check('조회 실패 명시적 검토는 2/3·재검토 중복 증가 없음', async () => {
      await reviewMission(page, 'sync');
      await expectProgress(page, 2);
      await reviewMission(page, 'sync');
      await expectProgress(page, 2);
      await expectBadge(page, 'review-round', false);
    });

    await check('연결 미션 진입·후보 선택만으로 진행 없음', async () => {
      await nav(page, 'dashboard');
      await page.locator('[data-action="mission-open"][data-id="mapping"]').click();
      assert.equal(await page.locator('.nav [aria-current="page"]').getAttribute('data-view'), 'mapping');
      for (const id of mappingIds) {
        const select = page.locator(`[data-mapping-id="${id}"]`);
        assert.equal(await select.count(), 1);
        const value = await select.locator('option').last().getAttribute('value') || await select.locator('option').last().innerText();
        await select.selectOption(value);
      }
      await expectProgress(page, 2);
      await expectBadge(page, 'first-link', false);
    });

    await check('첫 샘플 연결 승인만 첫 연결 배지 획득·진행 2/3', async () => {
      await approveMapping(page, 'c2');
      assert.equal(await page.locator('#mappingCount').innerText(), '2');
      await expectProgress(page, 2);
      await expectBadge(page, 'first-link', true);
      await expectBadge(page, 'review-round', false);
    });

    await check('연결 2개까지 미완료·3개 승인하면 3/3 및 한바퀴 배지', async () => {
      await approveMapping(page, 'c3');
      await expectProgress(page, 2);
      await expectBadge(page, 'first-link', true);
      await approveMapping(page, 'n5');
      assert.equal(await page.locator('#mappingCount').innerText(), '0');
      await expectProgress(page, 3);
      await expectBadge(page, 'first-link', true);
      await expectBadge(page, 'review-round', true);
      const text = await page.locator('main').innerText();
      contains(text, '샘플');
      assert.match(text, /당시|획득 시점/, '배지가 현재 운영 상태가 아닌 당시 성취임을 표시해야 합니다.');
    });

    await check('완료 후에도 품절·실패·이전 성공수량·실제 미연결 보존', async () => {
      await expectDataMeaning(page);
      await expectProgress(page, 3);
      contains(await page.locator('main').innerText(), '수량은 합산하지 않습니다');
      assert.doesNotMatch((await page.locator('main h1, main h2, main h3').allTextContents()).join(' '), /건강\s*점수|운영\s*점수|재고\s*건강/);
    });

    await check('연결 해제는 2/3로 감소·배지는 당시 성취로 유지', async () => {
      await nav(page, 'mapping');
      await page.locator('[data-action="mapping-release"][data-id="c2"]').click();
      assert.equal(await page.locator('#mappingCount').innerText(), '1');
      await expectProgress(page, 2);
      await expectBadge(page, 'first-link', true);
      await expectBadge(page, 'review-round', true);
      assert.match(await page.locator('main').innerText(), /당시|획득 시점/);
      await approveMapping(page, 'c2');
      await expectProgress(page, 3);
      assert.equal(await page.locator('[data-badge="first-link"]').count(), 1);
      assert.equal(await page.locator('[data-badge="review-round"]').count(), 1);
    });

    await check('샘플 초기화가 검토·배지·연결·알림을 초기 상태로 복원', async () => {
      await resetSample(page);
      await expectBadge(page, 'first-link', false);
      await expectBadge(page, 'review-round', false);
      assert.equal(await page.locator('#mappingCount').innerText(), '3');
      assert.equal(await page.locator('#alertCount').innerText(), '5');
      await nav(page, 'mapping');
      for (const id of mappingIds) assert.equal(await page.locator(`[data-action="mapping-approve"][data-id="${id}"]`).count(), 1);
      await reviewMission(page, 'stock');
      await expectProgress(page, 1);
    });

    await check('새로고침 시 검토·배지·샘플 연결 상태 초기화', async () => {
      await approveMapping(page, 'c2');
      await expectBadge(page, 'first-link', true);
      await page.reload({ waitUntil: 'networkidle' });
      await expectProgress(page, 0);
      await expectBadge(page, 'first-link', false);
      await expectBadge(page, 'review-round', false);
      assert.equal(await page.locator('#mappingCount').innerText(), '3');
      assert.equal(await page.locator('#alertCount').innerText(), '5');
    });

    await check('효과 끄기에서도 진행·배지 동작·축하 움직임 없음', async () => {
      await nav(page, 'connections');
      const toggle = page.locator('#motionToggle');
      assert.equal(await toggle.count(), 1);
      assert.equal(await toggle.getAttribute('type'), 'checkbox');
      assert.ok((await toggle.evaluate(element => [...element.labels].map(label => label.innerText).join(' '))).trim(), '효과 설정의 읽을 수 있는 레이블이 필요합니다.');
      await toggle.uncheck();
      assert.equal(await toggle.isChecked(), false);
      await reviewMission(page, 'stock');
      await expectProgress(page, 1);
      await expectQuietMotion(page);
      await approveMapping(page, 'c2');
      await expectBadge(page, 'first-link', true);
      await expectQuietMotion(page);
      await reviewMission(page, 'sync');
      await approveMapping(page, 'c3');
      await approveMapping(page, 'n5');
      await expectProgress(page, 3);
      await expectBadge(page, 'review-round', true);
      await expectQuietMotion(page);
    });

    await check('시스템 reduced-motion에서도 정상 완료·축하 움직임 없음', async () => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.reload({ waitUntil: 'networkidle' });
      assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
      await reviewMission(page, 'stock');
      await reviewMission(page, 'sync');
      for (const id of mappingIds) await approveMapping(page, id);
      await expectProgress(page, 3);
      await expectBadge(page, 'review-round', true);
      await expectQuietMotion(page);
      await page.emulateMedia({ reducedMotion: 'no-preference' });
    });

    await check('음악·스트릭·순위 및 외부 쓰기 조작 없음', async () => {
      assert.equal(await page.locator('audio, video').count(), 0);
      assert.doesNotMatch(html, /\bAudioContext\b|\bwebkitAudioContext\b|\bnew\s+Audio\s*\(/);
      for (const view of views) {
        await nav(page, view);
        assert.doesNotMatch(await page.locator('main').innerText(), /스트릭|연속\s*(출석|접속|달성)|리더보드|순위표/);
        const buttons = await page.locator('main button').allTextContents();
        assert.ok(buttons.every(label => !/^(재고 수정|발송 처리|주문 상태 변경|취소 처리|반품 승인)$/.test(label.trim())));
        assert.equal(await page.locator('input[type="password"]').count(), 0);
      }
    });

    await check('1440·768·360 폭의 6개 화면·미션 상세·완료 화면 캡처', async () => {
      for (const [name, width, height] of [['desktop', 1440, 1000], ['tablet', 768, 1024], ['mobile', 360, 800]]) {
        await page.setViewportSize({ width, height });
        for (const view of views) {
          await nav(page, view);
          const sizes = await page.evaluate(() => ({ body: document.body.scrollWidth, doc: document.documentElement.scrollWidth }));
          assert.ok(sizes.body <= width + 1 && sizes.doc <= width + 1, `${name}/${view} 페이지 가로 넘침: ${JSON.stringify(sizes)}`);
          if (['inventory', 'orders', 'mapping'].includes(view)) {
            const wrap = page.locator('main .table-wrap').first();
            const overflow = await wrap.evaluate(element => ({ scroll: element.scrollWidth, client: element.clientWidth, mode: getComputedStyle(element).overflowX }));
            assert.equal(overflow.mode, 'auto');
            if (width < 1000) assert.ok(overflow.scroll > overflow.client, `${name}/${view} 표를 가로로 이동할 수 있어야 합니다.`);
          }
        }
        await expectProgress(page, 3);
        await page.locator('[data-action="mission-open"][data-id="sync"]').click();
        const bounds = await page.locator('dialog[open]').boundingBox();
        assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1, `${name} 미션 상세가 화면을 넘칩니다.`);
        await page.keyboard.press('Escape');
        await page.screenshot({ path: path.join(screenshotPath, `gamification-${name}.png`), fullPage: true });
      }
    });

    await check('브라우저 오류·자동 외부 요청 없음', async () => {
      assert.deepEqual(errors, []);
      assert.deepEqual(requests, []);
    });
  } finally {
    await browser.close();
  }
  const failed = results.filter(result => result.status === '실패');
  const report = {
    checkedAt: new Date().toISOString(),
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.length,
    viewports: [{ width: 1440, height: 1000 }, { width: 768, height: 1024 }, { width: 360, height: 800 }],
    errors,
    requests,
    results
  };
  fs.writeFileSync(path.join(screenshotPath, 'gamification-verification.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report, null, 2));
  if (failed.length) process.exitCode = 1;
}

run().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
