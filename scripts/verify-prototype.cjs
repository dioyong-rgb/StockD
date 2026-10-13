// 단일 HTML 시안의 실제 브라우저 동작과 데이터 표시 의미를 검증합니다.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { chromium } = require('C:/Users/dioyongPC/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const root = path.resolve(__dirname, '..');
const htmlPath = path.join(root, 'preview', 'index.html');
const screenshots = path.join(root, 'preview', 'screenshots');
const results = [];
const errors = [];
const requests = [];

async function check(name, action) {
  try {
    await action();
    results.push({ name, status: '통과' });
  } catch (error) {
    results.push({ name, status: '실패', error: error.message });
  }
}
function contains(text, fragment) { assert.ok(text.includes(fragment), `문구 누락: ${fragment}`); }
async function nav(page, view) { await page.locator(`.nav button[data-view="${view}"]`).click(); }
async function rows(page, type) { return page.locator(`.${type}-table tbody tr`).count(); }
async function fillDate(page, selector, value) { await page.locator(selector).fill(value); await page.locator(selector).dispatchEvent('change'); }
async function inventoryRow(page, id) { return page.locator(`.inventory-table tbody tr:has(button[data-id="${id}"])`).innerText(); }

async function run() {
  const html = fs.readFileSync(htmlPath, 'utf8');
  fs.mkdirSync(screenshots, { recursive: true });
  await check('단일 HTML 및 외부 자산 없음', () => {
    assert.match(html, /<html lang="ko">/);
    assert.match(html, /<style>/);
    assert.doesNotMatch(html, /<script\b[^>]*\bsrc\s*=|<link\b[^>]*\brel\s*=\s*["'](?:stylesheet|preload|prefetch|modulepreload)|<(?:img|iframe|video|audio)\b[^>]*\bsrc\s*=\s*["']https?:/i);
    assert.doesNotMatch(html, /(?:@import\s+|url\(\s*["']?https?:|\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\bEventSource\b)/);
  });
  await check('인라인 JavaScript 문법', () => {
    const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
    assert.ok(scripts.length);
    scripts.forEach((script, i) => new vm.Script(script[1], { filename: `inline-${i}.js` }));
  });
  const browser = await chromium.launch({ headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'ko-KR' });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()); });
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle' });
    await check('file:// 직접 열기와 샘플 표시', async () => {
      contains(await page.locator('.preview-strip').innerText(), '샘플 데이터 · 실제 API 미연동');
      contains(await page.locator('h1').innerText(), '오늘 확인할 일');
      assert.equal(await page.locator('.nav button').count(), 6);
      contains(await page.locator('main').innerText(), '수량은 합산하지 않습니다');
    });
    await check('6개 메뉴 전환·선택 상태', async () => {
      const views = { dashboard: '오늘 확인할 일', inventory: '통합 재고', orders: '통합 주문', mapping: '상품 연결', alerts: '알림 예시', connections: '연결·설정' };
      for (const [view, title] of Object.entries(views)) {
        await nav(page, view);
        assert.equal(await page.locator('h1').innerText(), title);
        assert.equal(await page.locator('.nav [aria-current="page"]').getAttribute('data-view'), view);
        assert.equal(await page.evaluate(() => document.activeElement.id), 'main');
      }
    });
    await nav(page, 'inventory');
    await check('통합 재고 10개 및 검색', async () => {
      assert.equal(await rows(page, 'inventory'), 10);
      await page.locator('#inventorySearch').fill('코튼');
      assert.equal(await rows(page, 'inventory'), 4);
    });
    await check('재고 검색과 복수 필터 교집합', async () => {
      await page.locator('#inventoryChannel').selectOption('coupang');
      await page.locator('#inventoryFulfillment').selectOption('rocket');
      await page.locator('#inventoryStatus').selectOption('low');
      assert.equal(await rows(page, 'inventory'), 1);
      contains(await page.locator('.inventory-table').innerText(), '주문가능 재고');
      contains(await page.locator('.inventory-table').innerText(), '4');
    });
    await check('재고 빈 결과와 필터 초기화', async () => {
      await page.locator('#inventorySearch').fill('없는 상품 검색');
      assert.equal(await rows(page, 'inventory'), 0);
      contains(await page.locator('#inventoryResults').innerText(), 'API 조회 실패가 아닙니다');
      await page.locator('#inventoryResults [data-action="inventory-reset"]').click();
      assert.equal(await rows(page, 'inventory'), 10);
      assert.equal(await page.locator('#inventorySearch').inputValue(), '');
      assert.equal(await page.locator('#inventoryChannel').inputValue(), '');
    });
    await check('품절 0 및 이전 성공값 보존·시각 구분', async () => {
      const zero = await inventoryRow(page, 'n2');
      contains(zero, '품절');
      assert.equal((await page.locator('.inventory-table tr:has(button[data-id="n2"]) td.number').innerText()).trim(), '0');
      const stale = await inventoryRow(page, 'c2');
      contains(stale, '이전 수량 유지 · 최근 조회 실패');
      contains(stale, '09:02');
      contains(stale, '09:39');
      assert.equal((await page.locator('.inventory-table tr:has(button[data-id="c2"]) td.number').innerText()).trim(), '7');
    });
    await check('첫 실패·미지원·관리 미사용·미확인 수량 구분', async () => {
      for (const [id, label] of [['r2','조회 실패'],['n3','관리 미사용'],['n4','미지원 예시'],['c3','지원 미확인']]) {
        contains(await inventoryRow(page, id), label);
        assert.equal((await page.locator(`.inventory-table tr:has(button[data-id="${id}"]) td.number`).innerText()).trim(), '—');
      }
      contains(await inventoryRow(page, 'r2'), '이전 성공값 없음');
    });
    await check('재고 상세 및 ESC·초점 복귀', async () => {
      const trigger = page.locator('.inventory-table button[data-id="c2"][aria-label]');
      await trigger.click();
      assert.equal(await page.locator('dialog').evaluate(element => element.open), true);
      contains(await page.locator('dialog').innerText(), '09:02');
      contains(await page.locator('dialog').innerText(), '09:39');
      contains(await page.locator('dialog').innerText(), '마지막 성공값 7개');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('dialog').evaluate(element => element.open), false);
      assert.equal(await trigger.evaluate(element => element === document.activeElement), true);
    });
    await check('미지원 가상 사례와 관리 미사용 설명', async () => {
      await page.locator('.inventory-table button[data-id="n4"]').first().click();
      contains(await page.locator('dialog').innerText(), '네이버 API가 실제로 미지원이라는 뜻은 아닙니다');
      await page.locator('[data-action="dialog-close"]').click();
      await page.locator('.inventory-table button[data-id="n3"]').first().click();
      contains(await page.locator('dialog').innerText(), 'useStockManagement=false');
      contains(await page.locator('dialog').innerText(), '9,999');
      await page.keyboard.press('Escape');
    });
    await nav(page, 'orders');
    await check('주문 6행 및 RG 조회·클레임 제한', async () => {
      assert.equal(await rows(page, 'orders'), 6);
      contains(await page.locator('main .notice').innerText(), '출고 이후');
      contains(await page.locator('main .notice').innerText(), '미확인');
      const rg = page.locator('.orders-table tr:has(button[data-id="DEMO-RO-301"])');
      contains(await rg.innerText(), '상태 미확인');
      contains(await rg.innerText(), '지원 미확인');
      assert.ok(!(await rg.innerText()).includes('결제 완료'));
      contains(await page.locator('.orders-table tr:has(button[data-id="DEMO-NO-103"])').innerText(), '주문 3개 중 1개');
    });
    await check('주문 검색과 복수 필터·기간', async () => {
      await page.locator('#orderSearch').fill('파우치');
      await page.locator('#orderChannel').selectOption('naver');
      await page.locator('#orderFulfillment').selectOption('seller');
      await page.locator('#orderStatus').selectOption('claim');
      await fillDate(page, '#orderFrom', '2026-10-03');
      await fillDate(page, '#orderTo', '2026-10-03');
      assert.equal(await rows(page, 'orders'), 1);
      contains(await page.locator('.orders-table').innerText(), 'DEMO-NO-103');
    });
    await check('주문 빈 결과·초기화·역순 날짜 안내', async () => {
      await page.locator('#orderSearch').fill('존재하지 않는 주문');
      assert.equal(await rows(page, 'orders'), 0);
      contains(await page.locator('#orderResults').innerText(), '조건에 맞는 샘플이 없습니다');
      await page.locator('#orderResults [data-action="order-reset"]').click();
      assert.equal(await rows(page, 'orders'), 6);
      await fillDate(page, '#orderFrom', '2026-10-05');
      contains(await page.locator('#orderResults').innerText(), '시작일이 종료일보다 늦습니다');
      await page.locator('.toolbar [data-action="order-reset"]').click();
      assert.equal(await rows(page, 'orders'), 6);
    });
    await check('주문 상세와 RG 판매수량 의미', async () => {
      await page.locator('.orders-table button[data-id="DEMO-RO-301"]').first().click();
      const detail = await page.locator('dialog').innerText();
      contains(detail, 'salesQuantity 예시, 재고 아님');
      contains(detail, '출고 이후 조회');
      contains(detail, '취소·반품·교환 지원도 미확인');
      await page.keyboard.press('Escape');
    });
    await nav(page, 'mapping');
    await check('내부 SKU 후보 선택·승인·해제', async () => {
      assert.equal(await page.locator('#mappingCount').innerText(), '3');
      await page.locator('[data-mapping-id="c2"]').selectOption('MUG-WH-320');
      await page.locator('[data-action="mapping-approve"][data-id="c2"]').click();
      assert.equal(await page.locator('#mappingCount').innerText(), '2');
      const row = page.locator('.mapping-table tr:has(button[data-id="c2"])');
      contains(await row.innerText(), 'MUG-WH-320');
      contains(await row.innerText(), '샘플 연결됨');
      contains(await page.locator('.history-list').innerText(), 'MUG-WH-320 샘플 연결 승인');
      contains(await page.locator('#toast').innerText(), '현재 화면에서만 유지');
      await page.locator('[data-action="mapping-release"][data-id="c2"]').click();
      assert.equal(await page.locator('#mappingCount').innerText(), '3');
      assert.equal(await page.locator('[data-mapping-id="c2"]').inputValue(), 'MUG-WH-320');
      contains(await page.locator('.history-list').innerText(), '샘플 연결 해제');
    });
    await nav(page, 'alerts');
    await check('알림 예시 확인·전체 이력·관련 상세', async () => {
      assert.equal(await page.locator('.alert-item').count(), 5);
      await page.locator('[data-action="alert-acknowledge"][data-id="a1"]').click();
      assert.equal(await page.locator('.alert-item').count(), 4);
      assert.equal(await page.locator('#alertCount').innerText(), '4');
      await page.locator('[data-action="alert-filter"][data-filter="all"]').click();
      assert.equal(await page.locator('.alert-item').count(), 5);
      assert.equal(await page.locator('.alert-item.acknowledged').count(), 1);
      await page.locator('[data-action="alert-detail"][data-id="a3"]').click();
      contains(await page.locator('dialog').innerText(), '마지막 성공값 7개');
      await page.keyboard.press('Escape');
      for (const id of ['a2','a3','a4','a5']) await page.locator(`[data-action="alert-acknowledge"][data-id="${id}"]`).click();
      await page.locator('[data-action="alert-filter"][data-filter="open"]').click();
      contains(await page.locator('main').innerText(), '모든 알림 예시를 확인했습니다');
    });
    await nav(page, 'connections');
    await check('미연결·공식 근거·비밀값 입력 없음', async () => {
      assert.equal(await page.locator('.status-dot').count(), 2);
      for (const status of await page.locator('.status-dot').allTextContents()) assert.equal(status, '실제 미연결');
      assert.equal(await page.locator('input[type="password"]').count(), 0);
      const links = await page.locator('.connection-grid a').evaluateAll(items => items.map(item => item.href));
      assert.equal(links.length, 4);
      assert.ok(links.every(url => url.startsWith('https://apicenter.commerce.naver.com/') || url.startsWith('https://developers.coupang.com/')));
      await page.locator('[data-action="connection-detail"][data-channel="coupang"]').click();
      contains(await page.locator('dialog').innerText(), '출고 이후');
      contains(await page.locator('dialog').innerText(), '취소·반품·교환 지원은 미확인');
      await page.keyboard.press('Escape');
    });
    await check('예시 수량 기준 변경·검증 및 초기화', async () => {
      await page.locator('#thresholdInput').fill('10');
      await page.locator('#thresholdInput').dispatchEvent('change');
      await nav(page, 'inventory');
      assert.equal(await page.locator('.inventory-table tr:has(button[data-id="c2"]) td.number.low').count(), 1);
      await nav(page, 'connections');
      await page.locator('#thresholdInput').fill('-1');
      await page.locator('#thresholdInput').dispatchEvent('change');
      assert.equal(await page.locator('#thresholdInput').inputValue(), '10');
      await page.locator('[data-action="sample-reset"]').click();
      assert.equal(await page.locator('#thresholdInput').inputValue(), '5');
      assert.equal(await page.locator('#mappingCount').innerText(), '3');
      assert.equal(await page.locator('#alertCount').innerText(), '5');
    });
    await check('모든 화면의 외부 쓰기 동작 없음', async () => {
      for (const view of ['dashboard','inventory','orders','mapping','alerts','connections']) {
        await nav(page, view);
        const buttons = await page.locator('main button').allTextContents();
        assert.ok(buttons.every(label => !/^(재고 수정|발송 처리|주문 상태 변경|취소 처리|반품 승인)$/.test(label.trim())));
        const inputs = await page.locator('main input').evaluateAll(items => items.map(item => ({ id: item.id, type: item.type })));
        assert.ok(inputs.every(input => ['search','date'].includes(input.type) || input.id === 'thresholdInput' || (input.id === 'motionToggle' && input.type === 'checkbox')));
      }
    });
    await check('반응형 360×800·768×1024·1440×1000', async () => {
      for (const [name, width, height] of [['mobile',360,800],['tablet',768,1024],['desktop',1440,1000]]) {
        await page.setViewportSize({ width, height });
        for (const view of ['dashboard','inventory','orders','mapping','alerts','connections']) {
          await nav(page, view);
          const sizes = await page.evaluate(() => ({ viewport: innerWidth, body: document.body.scrollWidth, doc: document.documentElement.scrollWidth }));
          assert.ok(sizes.body <= width + 1 && sizes.doc <= width + 1, `${name}/${view} 전체 페이지 가로 넘침: ${JSON.stringify(sizes)}`);
          if (['inventory','orders','mapping'].includes(view)) {
            const wrapper = page.locator('main .table-wrap').first();
            const values = await wrapper.evaluate(element => ({ scroll: element.scrollWidth, client: element.clientWidth, overflow: getComputedStyle(element).overflowX }));
            assert.equal(values.overflow, 'auto');
            if (width < 1000) assert.ok(values.scroll > values.client);
          }
        }
        // 시연 중 생성된 토스트가 미리보기 이미지에 겹치지 않도록 초기 화면을 다시 엽니다.
        await page.reload({ waitUntil: 'networkidle' });
        await page.screenshot({ path: path.join(screenshots, `${name}.png`), fullPage: true });
      }
    });
    await check('브라우저 오류 및 자동 네트워크 요청 없음', async () => {
      assert.deepEqual(errors, []);
      assert.deepEqual(requests, []);
    });
    const httpPage = await context.newPage();
    await check('로컬 HTTP 미리보기', async () => {
      const response = await httpPage.goto('http://127.0.0.1:8765/', { waitUntil: 'networkidle' });
      assert.equal(response.status(), 200);
      contains(await httpPage.locator('.preview-strip').innerText(), '샘플 데이터 · 실제 API 미연동');
      await nav(httpPage, 'inventory');
      assert.equal(await rows(httpPage, 'inventory'), 10);
    });
    await check('새로고침 후 시연 상태 초기화', async () => {
      await page.reload({ waitUntil: 'networkidle' });
      assert.equal(await page.locator('#mappingCount').innerText(), '3');
      assert.equal(await page.locator('#alertCount').innerText(), '5');
      await nav(page, 'connections');
      assert.equal(await page.locator('#thresholdInput').inputValue(), '5');
    });
  } finally { await browser.close(); }
  const failed = results.filter(result => result.status === '실패');
  const report = { checkedAt: new Date().toISOString(), total: results.length, passed: results.length - failed.length, failed: failed.length, errors, requests, results };
  fs.writeFileSync(path.join(screenshots, 'verification.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify(report, null, 2));
  if (failed.length) process.exitCode = 1;
}
run().catch(error => { console.error(error); process.exitCode = 1; });
