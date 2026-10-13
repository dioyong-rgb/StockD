'use strict'

// 화면+서버 통합 시험 (T5).
// 실제 server.cjs(createApp)를 가짜 키 + 로컬 가짜 쿠팡 서버(stub)에 연결해 띄우고,
// Playwright 로 실제 public/ 화면을 360/768/1440 폭에서 열어 흐름을 확인한다.
// - 쿠팡 실서버는 호출하지 않는다. 키는 test/fixtures/fake-api.txt(가짜)만 쓴다.
// - 서버 시계는 createApp 의 clock 주입으로, 브라우저 시계는 Date.now 오프셋(초기화 스크립트)으로 함께 앞당겨
//   60초 잠금·해제 대기를 실제로 기다리지 않고 확인한다. 화면 코드(app.js)는 수정하지 않는다.
// - 수집한 응답 본문·요청 헤더·console·DOM·저장소에 가짜 키·서명·세션 토큰(헤더 외)이 없는지 검사한다.
// 실행: node tools/coupang-inventory-test/test/e2e-ui.cjs  (STOCKD_PLAYWRIGHT_MODULE 로 playwright 경로 지정 가능)

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { createApp } = require(path.join(__dirname, '..', 'server.cjs'))
const { createStub } = require(path.join(__dirname, 'fake-coupang-stub.cjs'))

const FAKE_FILE = path.join(__dirname, 'fixtures', 'fake-api.txt')
const SHOT_DIR = path.join(__dirname, 'screenshots')
const RESULT_FILE = path.join(__dirname, 'e2e-results.json')
const VIEWPORTS = [
  { name: '360', width: 360, height: 800 },
  { name: '768', width: 768, height: 1024 },
  { name: '1440', width: 1440, height: 900 }
]

// ---- 가짜 키 (런타임에 가짜 파일에서 읽음) ----
function readFakeKeys() {
  const lines = fs.readFileSync(FAKE_FILE, 'utf8').split(/\r?\n/)
  const pick = (label) => {
    const line = lines.find((l) => l.startsWith(label))
    return line ? line.slice(label.length).trim() : ''
  }
  return { access: pick('Access Key:'), secret: pick('Secret Key:') }
}

// ---- Playwright 로딩 (scripts/verify-ui.cjs 와 같은 방식) ----
function loadPlaywright() {
  const tried = []
  const fromEnv = process.env.STOCKD_PLAYWRIGHT_MODULE
  if (fromEnv) {
    try {
      return require(fromEnv)
    } catch (err) {
      tried.push('STOCKD_PLAYWRIGHT_MODULE -> ' + err.message.split('\n')[0])
    }
  }
  try {
    return require('playwright')
  } catch (err) {
    tried.push("require('playwright') -> " + err.message.split('\n')[0])
  }
  const fallback = path.join(os.homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'node_modules', 'playwright')
  try {
    return require(fallback)
  } catch (err) {
    tried.push('fallback -> ' + err.message.split('\n')[0])
  }
  throw new Error('playwright 모듈을 불러오지 못했습니다.\n' + tried.join('\n'))
}

async function launchBrowser(chromium) {
  const env = process.env
  const candidates = [{ label: 'default', executablePath: undefined }]
  if (env.STOCKD_BROWSER_PATH) candidates.unshift({ label: 'env', executablePath: env.STOCKD_BROWSER_PATH })
  const extra = [
    env.ProgramFiles && path.join(env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    env['ProgramFiles(x86)'] && path.join(env['ProgramFiles(x86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    env.ProgramFiles && path.join(env.ProgramFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    env['ProgramFiles(x86)'] && path.join(env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe')
  ].filter(Boolean)
  extra.forEach((p) => {
    if (fs.existsSync(p)) candidates.push({ label: p, executablePath: p })
  })
  const errors = []
  for (const c of candidates) {
    try {
      return await chromium.launch({ headless: true, executablePath: c.executablePath })
    } catch (err) {
      errors.push(c.label + ' -> ' + err.message.split('\n')[0])
    }
  }
  throw new Error('브라우저를 실행하지 못했습니다.\n' + errors.join('\n'))
}

// ---- 결과 기록 ----
const results = []
let currentViewport = '-'
function check(id, name, pass, detail) {
  results.push({ id, viewport: currentViewport, name, pass: Boolean(pass), detail: pass ? '' : String(detail || '') })
  console.log((pass ? 'PASS ' : 'FAIL ') + '[' + currentViewport + '] ' + id + ' ' + name + (pass ? '' : '  <- ' + String(detail || '')))
}

// ---- 브라우저 수집물 ----
const corpus = {
  responses: [], // { viewport, url, path, status, headers, body }
  requests: [], // { viewport, url, headers, postData }
  consoles: [], // { viewport, type, text }
  snapshots: [], // { viewport, label, dom, storage, cookies, windowDump }
  serverLogs: [], // 서버 로그 줄
  stubSeen: [] // stub 이 받은 Authorization·signature
}
const pending = []
const tokens = {} // 뷰포트별 세션 토큰(서버가 뷰포트마다 새로 뜸)

function attachCollectors(page, viewport) {
  page.on('response', (res) => {
    pending.push(
      (async () => {
        let body = ''
        try {
          body = await res.text()
        } catch (err) {
          body = ''
        }
        const url = new URL(res.url())
        corpus.responses.push({ viewport, url: res.url(), path: url.pathname, status: res.status(), headers: res.headers(), body })
      })()
    )
  })
  page.on('request', (req) => {
    pending.push(
      (async () => {
        let headers = {}
        try {
          headers = await req.allHeaders()
        } catch (err) {
          headers = req.headers()
        }
        if (!tokens[viewport] && headers['x-session-token']) tokens[viewport] = headers['x-session-token']
        corpus.requests.push({ viewport, url: req.url(), headers, postData: req.postData() || '' })
      })()
    )
  })
  page.on('console', (msg) => corpus.consoles.push({ viewport, type: msg.type(), text: msg.text() }))
  page.on('pageerror', (err) => corpus.consoles.push({ viewport, type: 'pageerror', text: String(err && err.message) }))
}

async function snapshot(page, viewport, label) {
  const data = await page.evaluate(() => {
    const dump = {}
    const frame = document.createElement('iframe')
    frame.style.display = 'none'
    document.body.append(frame)
    const baseline = new Set(Object.getOwnPropertyNames(frame.contentWindow))
    frame.remove()
    for (const key of Object.getOwnPropertyNames(window)) {
      if (baseline.has(key)) continue
      try {
        dump[key] = JSON.stringify(window[key]) || String(window[key])
      } catch (err) {
        dump[key] = '[unserializable]'
      }
    }
    let lexical = ''
    try {
      lexical = JSON.stringify({ state, hasMeta: Boolean(document.querySelector('meta[name="session-token"]')) })
    } catch (err) {
      lexical = '[no state]'
    }
    const store = {}
    try {
      store.local = JSON.stringify(Object.assign({}, window.localStorage))
      store.session = JSON.stringify(Object.assign({}, window.sessionStorage))
    } catch (err) {
      store.local = store.session = '[blocked]'
    }
    return {
      dom: document.documentElement.outerHTML,
      cookieString: document.cookie,
      store,
      windowDump: JSON.stringify(dump),
      lexical,
      metaCount: document.querySelectorAll('meta[name="session-token"]').length
    }
  })
  const cookies = await page.context().cookies()
  corpus.snapshots.push({ viewport, label, ...data, cookies: JSON.stringify(cookies) })
}

// ---- 화면 도우미 ----
async function settle(page) {
  await page.waitForFunction(() => {
    const el = document.getElementById('progress')
    return el && el.hidden === true
  }, null, { timeout: 15000 })
  await page.waitForTimeout(120)
}

const text = async (page, id) => ((await page.locator('#' + id).textContent()) || '').trim()
const visible = (page, id) => page.locator('#' + id).isVisible()
const disabled = (page, id) => page.locator('#' + id).isDisabled()

async function tableRows(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('#result-body tr')).map((tr) =>
      Array.from(tr.children).map((td) => (td.textContent || '').replace(/\s+/g, ' ').trim())
    )
  )
}

async function advanceTime(ctx, ms) {
  ctx.clockState.offset += ms
  await ctx.page.evaluate((delta) => {
    window.__skewMs = (window.__skewMs || 0) + delta
  }, ms)
}

async function failOnce(ctx) {
  const { page } = ctx
  await page.click('#btn-check')
  await settle(page)
}

// ---- 스텁 응답 구성 ----
function buildOverride(mode) {
  return (info) => {
    if (mode.forbidden) {
      return { status: 403, body: { code: 403, message: 'forbidden' } }
    }
    if (/\/seller-products$/.test(info.path)) {
      const hasToken = /nextToken=/.test(info.query)
      const makeRow = (n) => ({
        sellerProductId: 1000000 + n,
        sellerProductName: '가짜 상품 ' + n,
        statusName: '승인완료',
        vendorId: 'A0001234',
        mdId: 'must-not-appear'
      })
      if (/maxPerPage=1(&|$)/.test(info.query)) {
        return { status: 200, body: { code: 200, message: 'OK', data: [makeRow(1)], nextToken: '' } }
      }
      if (hasToken) {
        const rows = [21, 22, 23, 24, 25].map(makeRow)
        return { status: 200, body: { code: 200, message: 'OK', data: rows, nextToken: '' } }
      }
      const rows = []
      for (let n = 1; n <= 20; n += 1) rows.push(makeRow(n))
      return { status: 200, body: { code: 200, message: 'OK', data: rows, nextToken: 'page2' } }
    }
    const detail = /\/seller-products\/(\d+)$/.exec(info.path)
    if (detail) {
      return {
        status: 200,
        body: {
          code: 200,
          message: 'OK',
          data: {
            sellerProductId: Number(detail[1]),
            sellerProductName: '가짜 상품 ' + (Number(detail[1]) - 1000000),
            statusName: '승인완료',
            items: [
              { sellerProductItemId: 1, vendorItemId: 90000001, itemName: '옵션 정상', salePrice: 1000 },
              { sellerProductItemId: 2, vendorItemId: 90000002, itemName: '옵션 형식오류', salePrice: 1000 },
              { sellerProductItemId: 3, vendorItemId: 90000003, itemName: '옵션 품절', salePrice: 1000 },
              { sellerProductItemId: 4, vendorItemId: 90000004, itemName: '옵션 서버오류', salePrice: 1000 },
              { sellerProductItemId: 5, vendorItemId: null, itemName: '임시저장 옵션', salePrice: 1000 }
            ]
          }
        }
      }
    }
    const inv = /\/vendor-items\/(\d+)\/inventories$/.exec(info.path)
    if (inv) {
      const id = Number(inv[1])
      const ok = (amount) => ({ status: 200, body: { code: 'SUCCESS', message: 'OK', data: { sellerItemId: 1, amountInStock: amount, onSale: true, salePrice: 1 } } })
      if (id === 90000001) return ok(5)
      if (id === 90000002) return ok('abc')
      if (id === 90000003) return ok(0)
      if (id === 90000004) return { status: 500, body: { code: 500, message: 'upstream error' } }
    }
    return null
  }
}

// ---- 시나리오 ----
async function startContext(browser, vp, keys) {
  const clockState = { offset: 0 }
  const clock = { now: () => Date.now() + clockState.offset }
  const stub = createStub({ fakeAccess: keys.access, fakeSecret: keys.secret })
  const baseUrl = await stub.start()
  const mode = { forbidden: false }
  stub.setOverride(buildOverride(mode))
  const app = createApp({ port: 0, keyFile: FAKE_FILE, baseUrl, clock, logger: (line) => corpus.serverLogs.push(line) })
  const info = await app.listen()
  const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } })
  await context.addInitScript(() => {
    window.__skewMs = 0
    const realNow = Date.now.bind(Date)
    Date.now = () => realNow() + (window.__skewMs || 0)
  })
  const page = await context.newPage()
  const dialogs = []
  page.on('dialog', (dialog) => {
    dialogs.push(dialog.message())
    dialog.accept().catch(() => {})
  })
  attachCollectors(page, vp.name)
  return { vp, clockState, stub, mode, app, info, context, page, dialogs }
}

async function stopContext(ctx) {
  corpus.stubSeen.push(...ctx.stub.state.seenSecrets)
  await ctx.context.close()
  await ctx.app.close()
  await ctx.stub.stop()
}

async function mainFlow(ctx) {
  const { page, stub, info, vp } = ctx
  await page.goto(info.url + '/')
  await page.waitForFunction(() => document.getElementById('st-key').textContent !== '확인 중…', null, { timeout: 10000 })

  // 1) 상태 카드
  check('E-STATUS', '상태 카드: 키 파일 로드됨 / vendorId 파일 없음(직접 입력) / 잠금 없음',
    (await text(page, 'st-key')) === '로드됨' && (await text(page, 'st-vendor')) === '없음(직접 입력)' && (await text(page, 'st-lock')) === '없음',
    [await text(page, 'st-key'), await text(page, 'st-vendor'), await text(page, 'st-lock')].join(' | '))
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  check('E-LAYOUT-1', '가로 스크롤 없음(초기 화면)', overflow <= 1, 'overflow=' + overflow)

  // 2) vendorId 입력 + 연결 확인
  await page.fill('#vendor-id', 'A0001234')
  const before = stub.count()
  await page.click('#btn-check')
  await settle(page)
  const checkText = await text(page, 'check-result')
  check('E-CHECK', '연결 확인 성공 문구 + 쿠팡 호출 1회', checkText.includes('연결 확인 성공') && stub.count() - before === 1, checkText + ' calls=' + (stub.count() - before))

  // 3) 상품 목록 20건 + 다음 페이지
  await page.click('#btn-products')
  await settle(page)
  const radios = await page.locator('#products-list input[type="radio"]').count()
  check('E-PRODUCTS-1', '상품 20건 표시 + 다음 페이지 버튼 보임', radios === 20 && (await visible(page, 'btn-products-next')), 'radios=' + radios)
  check('E-PRODUCTS-2', '상품 목록 메타에 다음 페이지 있음', (await text(page, 'products-meta')).includes('다음 페이지 있음'), await text(page, 'products-meta'))
  await page.click('#btn-products-next')
  await settle(page)
  const radios2 = await page.locator('#products-list input[type="radio"]').count()
  check('E-PRODUCTS-3', '다음 페이지: 5건, 마지막 페이지, 다음 버튼 숨김', radios2 === 5 && (await text(page, 'products-meta')).includes('마지막 페이지') && !(await visible(page, 'btn-products-next')), 'radios=' + radios2)
  const dom1 = await page.evaluate(() => document.body.innerHTML)
  check('E-PROJECTION', '화면에 projection 밖 필드(mdId 값) 없음', !dom1.includes('must-not-appear'), '')

  // 4) 옵션 선택
  await page.locator('#products-list input[type="radio"]').first().check()
  await page.click('#btn-items')
  await settle(page)
  const boxes = await page.locator('#items-list input[type="checkbox"]').count()
  const disabledBoxes = await page.locator('#items-list input[type="checkbox"]:disabled').count()
  check('E-OPTIONS', '옵션 5개 중 승인 전 1개는 선택 불가', boxes === 5 && disabledBoxes === 1, 'boxes=' + boxes + ' disabled=' + disabledBoxes)
  const inventoryDisabledBefore = await disabled(page, 'btn-inventory')
  const enabledBoxes = page.locator('#items-list input[type="checkbox"]:not(:disabled)')
  const n = await enabledBoxes.count()
  for (let i = 0; i < n; i += 1) await enabledBoxes.nth(i).check()
  check('E-INV-BTN', '옵션 미선택일 땐 재고 조회 버튼 비활성, 선택하면 활성', inventoryDisabledBefore && !(await disabled(page, 'btn-inventory')), 'before=' + inventoryDisabledBefore)

  // 5) 재고 표
  await page.click('#btn-inventory')
  await settle(page)
  let rows = await tableRows(page)
  const find = (arr, id) => arr.find((r) => r[2] === id)
  const normal = find(rows, '90000001')
  const bad = find(rows, '90000002')
  const zero = find(rows, '90000003')
  const server = find(rows, '90000004')
  check('E-INV-NORMAL', '정상 숫자: 수량 5 + 정상 조회 배지', normal && normal[4] === '5' && normal[6].includes('정상 조회'), JSON.stringify(normal))
  check('E-INV-ZERO', '정상 0: 수량 0 + 품절 배지(조회 실패 아님)', zero && zero[4] === '0' && zero[6].includes('품절') && !zero[6].includes('조회 실패'), JSON.stringify(zero))
  check('E-INV-FAIL-SERVER', '조회 실패(5xx): 수량 — + 조회 실패 + 쿠팡 서버 오류 원인', server && server[4] === '—' && server[6].includes('조회 실패') && server[6].includes('쿠팡 서버 오류'), JSON.stringify(server))
  check('E-INV-FAIL-PARSE', '조회 실패(수량 형식): 수량 — + 조회 실패 + 형식 오류 원인(5xx 원인과 구분)', bad && bad[4] === '—' && bad[6].includes('조회 실패') && bad[6].includes('응답 해석 실패') && !bad[6].includes('쿠팡 서버 오류'), JSON.stringify(bad))
  check('E-INV-KIND', '판매자배송 행은 수량 종류 "채널 등록 재고"', normal && normal[3] === '채널 등록 재고', JSON.stringify(normal))

  // 6) 로켓그로스
  await page.click('#btn-rg')
  await settle(page)
  rows = await tableRows(page)
  const rg = rows.find((r) => r[0] === '로켓그로스')
  check('E-RG', '로켓그로스 행: 주문가능 재고 7 + 정상 조회', rg && rg[3] === '주문가능 재고' && rg[4] === '7' && rg[6].includes('정상 조회'), JSON.stringify(rg))
  const sameIdBoth = rows.filter((r) => r[2] === '90000001').length === 2
  check('E-RG-SEPARATE', '같은 옵션 ID 의 판매자배송·로켓그로스 값이 별도 행(덮어쓰지 않음)', sameIdBoth, JSON.stringify(rows.map((r) => r[0] + r[2])))

  // 7) 합계 없음
  const sumInfo = await page.evaluate(() => {
    const table = document.getElementById('result-table')
    return {
      tfoot: table.querySelectorAll('tfoot').length,
      rowCount: table.querySelectorAll('tbody tr').length,
      sumText: /합계|총합|총계|Total/i.test(table.textContent || '')
    }
  })
  check('E-NO-SUM', '합계 행·합계 문구 없음(행 수=조회 건수 5)', sumInfo.tfoot === 0 && !sumInfo.sumText && sumInfo.rowCount === 5, JSON.stringify(sumInfo))

  // 8) 호출 로그
  const logRows = await page.evaluate(() =>
    Array.from(document.querySelectorAll('#log-body tr')).map((tr) => Array.from(tr.children).map((td) => (td.textContent || '').trim()))
  )
  const allowedNames = ['seller.products', 'seller.product', 'seller.inventory', 'rg.inventory']
  const logOk = logRows.length > 0 && logRows.every((r) => r.length === 4 && allowedNames.includes(r[1]) && /^\d{3}$/.test(r[2]) && /^\d+$/.test(r[3]))
  const logPanelText = await page.locator('#log-table').textContent()
  const logLeak = /A0001234|vendor-items|seller-products|\/v2|\?|nextToken|9000000/.test(logPanelText || '')
  check('E-LOG', '호출 로그: 이름·상태·시간만(경로·vendorId·ID·쿼리 없음)', logOk && !logLeak, JSON.stringify(logRows.slice(0, 3)) + ' leak=' + logLeak)

  const overflow2 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  check('E-LAYOUT-2', '가로 스크롤 없음(결과 표 표시 후)', overflow2 <= 1, 'overflow=' + overflow2)
  await snapshot(page, vp.name, 'after-main-flow')
  fs.mkdirSync(SHOT_DIR, { recursive: true })
  await page.screenshot({ path: path.join(SHOT_DIR, 'e2e-' + vp.name + '.png'), fullPage: true })
}

async function lockFlow(ctx) {
  const { page, stub, mode, vp } = ctx
  const lockNames = ['btn-check', 'btn-products', 'btn-rg', 'btn-rg-one']

  // A) 403 -> 시간 잠금
  mode.forbidden = true
  await failOnce(ctx)
  const lockVisible = await visible(page, 'lock-alert')
  const title = await text(page, 'lock-title')
  const cause = await text(page, 'lock-cause')
  const sec1 = Number((/(\d+)초 동안/.exec(title) || [])[1])
  check('E-LOCK-1', '403 후 잠금 안내: 제목에 N초, 원인에 공인 IP 가능성', lockVisible && Number.isFinite(sec1) && cause.includes('공인 IP'), title + ' | ' + cause)
  check('E-LOCK-2', '상태 카드 잠금: "N초 남음"', /초 남음/.test(await text(page, 'st-lock')), await text(page, 'st-lock'))
  const disabledAll = (await Promise.all(lockNames.map((id) => disabled(page, id)))).every(Boolean)
  check('E-LOCK-3', '잠금 중 쿠팡 호출 버튼(연결 확인·상품·RG) 비활성', disabledAll, '')
  const countBefore = stub.count()
  await page.locator('#btn-check').click({ force: true, timeout: 1500 }).catch(() => {})
  await page.waitForTimeout(300)
  check('E-LOCK-4', '비활성 버튼을 강제 클릭해도 쿠팡 호출 0회', stub.count() === countBefore, 'extra=' + (stub.count() - countBefore))
  await page.waitForTimeout(2200)
  const sec2 = Number((/(\d+)초 동안/.exec(await text(page, 'lock-title')) || [])[1])
  check('E-LOCK-5', '카운트다운 감소', Number.isFinite(sec2) && sec2 < sec1, sec1 + ' -> ' + sec2)
  check('E-LOCK-6', '오류 카드에 403 문구', (await text(page, 'error-message')).includes('403'), await text(page, 'error-message'))

  // B) 시간 경과 -> 자동 해제
  await advanceTime(ctx, 61000)
  let released = true
  try {
    await page.waitForFunction(() => document.getElementById('lock-alert').hidden === true, null, { timeout: 6000 })
  } catch (err) {
    released = false
  }
  check('E-LOCK-7', '60초 경과 후 잠금 안내 자동 사라짐 + 버튼 다시 활성', released && !(await disabled(page, 'btn-check')), 'released=' + released)

  // C) 연속 2회 실패 -> 수동 잠금
  await failOnce(ctx)
  const manualTitle = await text(page, 'lock-title')
  check('E-MANUAL-1', '연속 실패 2회: 수동 잠금 안내 + 잠금 해제 버튼 표시', manualTitle.includes('연속 실패') && (await visible(page, 'lock-actions')) && (await text(page, 'st-lock')) === '수동 해제 필요', manualTitle)
  check('E-MANUAL-2', '해제 대기(UNLOCK_WAIT) 안내 배너 표시 + 잠금 해제 버튼 비활성', (await visible(page, 'cooldown-alert')) && (await disabled(page, 'btn-unlock')), 'cooldown=' + (await text(page, 'cooldown-text')))
  const cdText = await text(page, 'cooldown-text')
  check('E-MANUAL-3', '대기 안내에 남은 초(약 N초) 포함', /약 \d+초/.test(cdText), cdText)
  const unlockCountBefore = stub.count()
  await page.locator('#btn-unlock').click({ force: true, timeout: 1500 }).catch(() => {})
  check('E-MANUAL-4', '대기 중 해제 버튼 강제 클릭: 확인창·호출 없음', ctx.dialogs.length === 0 && stub.count() === unlockCountBefore, 'dialogs=' + ctx.dialogs.length)

  // D) 60초 경과 -> 해제 #1
  await advanceTime(ctx, 61000)
  let unlockEnabled = true
  try {
    await page.waitForFunction(() => !document.getElementById('btn-unlock').disabled, null, { timeout: 6000 })
  } catch (err) {
    unlockEnabled = false
  }
  check('E-UNLOCK-1', '60초 경과 후 잠금 해제 버튼 활성, 대기 배너 사라짐', unlockEnabled && !(await visible(page, 'cooldown-alert')), 'enabled=' + unlockEnabled)
  await page.click('#btn-unlock')
  await settle(page)
  const dlg1 = ctx.dialogs[ctx.dialogs.length - 1] || ''
  check('E-UNLOCK-2', '해제 #1 성공: 확인창 표시(경고 문구 없음), 잠금 안내 사라짐', !(await visible(page, 'lock-alert')) && dlg1.includes('잠금을 해제') && !dlg1.includes('[경고]'), dlg1.slice(0, 40))

  // E) 다시 수동 잠금 -> 해제 #2
  mode.forbidden = true
  await failOnce(ctx)
  await advanceTime(ctx, 61000)
  await page.waitForFunction(() => document.getElementById('lock-alert').hidden === true, null, { timeout: 6000 })
  await failOnce(ctx)
  check('E-UNLOCK-3', '해제 후 다시 연속 2회 실패 -> 수동 잠금', (await text(page, 'lock-title')).includes('연속 실패'), await text(page, 'lock-title'))
  await advanceTime(ctx, 61000)
  await page.waitForFunction(() => !document.getElementById('btn-unlock').disabled, null, { timeout: 6000 })
  await page.click('#btn-unlock')
  await settle(page)
  const dlg2 = ctx.dialogs[ctx.dialogs.length - 1] || ''
  check('E-UNLOCK-4', '해제 #2 성공: 확인창에 이미 1회 해제 경고', !(await visible(page, 'lock-alert')) && dlg2.includes('[경고]'), dlg2.slice(0, 30))

  // F) 세 번째 수동 잠금 -> UNLOCK_LIMIT
  await failOnce(ctx)
  await advanceTime(ctx, 61000)
  await page.waitForFunction(() => document.getElementById('lock-alert').hidden === true, null, { timeout: 6000 })
  await failOnce(ctx)
  await advanceTime(ctx, 61000)
  await page.waitForFunction(() => !document.getElementById('btn-unlock').disabled, null, { timeout: 6000 })
  await page.click('#btn-unlock')
  await settle(page)
  const errMsg = await text(page, 'error-message')
  const errHint = await text(page, 'error-hint')
  const allText = await page.locator('main').innerText()
  check('E-LIMIT-1', 'UNLOCK_LIMIT: 오류 카드에 해제 횟수 소진 문구', errMsg.includes('해제 횟수') , errMsg)
  check('E-LIMIT-2', 'UNLOCK_LIMIT: "서버를 다시 실행하세요" 안내 표시', allText.includes('서버를 다시 실행'), errHint)
  const stillLocked = await visible(page, 'lock-alert')
  check('E-LIMIT-3', 'UNLOCK_LIMIT 후에도 수동 잠금 유지(호출 버튼 비활성)', stillLocked && (await disabled(page, 'btn-check')), '')
  const unlockBtnDisabled = await disabled(page, 'btn-unlock')
  check('E-LIMIT-4', 'UNLOCK_LIMIT 후 "잠금 해제" 버튼이 꺼짐(비활성)', unlockBtnDisabled, 'btn-unlock disabled=' + unlockBtnDisabled)
  const lockDetail = await text(page, 'lock-detail')
  check('E-LIMIT-5', 'UNLOCK_LIMIT 후 잠금 안내 영역(lock-alert)에도 서버 재실행 안내', lockDetail.includes('서버를 다시 실행') || (await text(page, 'lock-title')).includes('서버를 다시 실행'), lockDetail.slice(0, 60))
  await snapshot(page, vp.name, 'after-lock-flow')
}

// ---- 유출 검사 ----
function leakScan(keys) {
  const needles = [
    { label: 'FAKE_ACCESS', value: keys.access },
    { label: 'FAKE_SECRET', value: keys.secret },
    { label: 'CEA algorithm', value: 'CEA algorithm' },
    { label: 'signature=', value: 'signature=' }
  ]
  const stubValues = Array.from(new Set(corpus.stubSeen)).filter((v) => v && v.length >= 16)
  const findings = []
  const scanText = (where, haystack) => {
    if (!haystack) return
    for (const n of needles) {
      if (n.value && haystack.includes(n.value)) findings.push(where + ' <- ' + n.label)
    }
    for (const v of stubValues) {
      if (haystack.includes(v)) findings.push(where + ' <- stub 이 받은 Authorization/서명 값')
    }
    for (const t of Object.values(tokens)) {
      if (haystack.includes(t)) findings.push(where + ' <- 세션 토큰')
    }
  }
  let scanned = 0
  let tokenInIndex = 0
  for (const r of corpus.responses) {
    scanned += 1
    const hdr = JSON.stringify(r.headers)
    const isIndex = r.path === '/' && /text\/html/.test(r.headers['content-type'] || '')
    if (isIndex) {
      // 문서 응답(GET /)에는 토큰이 meta 로 들어가는 것이 설계. 토큰 외 항목만 검사하고 토큰 위치 수를 센다.
      let stripped = r.body
      for (const t of Object.values(tokens)) {
        tokenInIndex += stripped.split(t).length - 1
        stripped = stripped.split(t).join('')
      }
      scanText('응답본문 ' + r.path + ' [' + r.viewport + ']', stripped)
    } else {
      scanText('응답본문 ' + r.path + ' [' + r.viewport + ']', r.body)
    }
    scanText('응답헤더 ' + r.path + ' [' + r.viewport + ']', hdr)
  }
  for (const q of corpus.requests) {
    scanned += 1
    // 요청: 세션 토큰은 X-Session-Token 헤더에만 있어야 한다
    const headers = Object.assign({}, q.headers)
    delete headers['x-session-token']
    scanText('요청헤더 ' + q.url.replace(/^https?:\/\/[^/]+/, '') + ' [' + q.viewport + ']', JSON.stringify(headers))
    scanText('요청본문/URL ' + q.url.replace(/^https?:\/\/[^/]+/, '') + ' [' + q.viewport + ']', q.postData + ' ' + q.url)
  }
  for (const c of corpus.consoles) {
    scanned += 1
    scanText('console(' + c.type + ') [' + c.viewport + ']', c.text)
  }
  for (const s of corpus.snapshots) {
    scanned += 1
    scanText('DOM outerHTML [' + s.viewport + ' ' + s.label + ']', s.dom)
    scanText('localStorage/sessionStorage [' + s.viewport + ' ' + s.label + ']', JSON.stringify(s.store))
    scanText('cookie [' + s.viewport + ' ' + s.label + ']', s.cookieString + ' ' + s.cookies)
    scanText('window 전역 [' + s.viewport + ' ' + s.label + ']', s.windowDump)
    scanText('앱 state [' + s.viewport + ' ' + s.label + ']', s.lexical)
    if (s.metaCount !== 0) findings.push('DOM 에 session-token meta 가 남아 있음 [' + s.viewport + ' ' + s.label + ']')
  }
  for (const line of corpus.serverLogs) {
    scanned += 1
    scanText('서버 로그', line)
    if (/A0001234|vendor/i.test(line)) findings.push('서버 로그에 vendorId/vendor 문자열')
  }
  return { findings: Array.from(new Set(findings)), scanned, tokenInIndex, tokenCaptured: Object.keys(tokens).length === VIEWPORTS.length }
}

async function main() {
  const keys = readFakeKeys()
  const pw = loadPlaywright()
  const browser = await launchBrowser(pw.chromium)
  try {
    for (const vp of VIEWPORTS) {
      currentViewport = vp.name
      const ctx = await startContext(browser, vp, keys)
      try {
        await mainFlow(ctx)
        await lockFlow(ctx)
      } catch (err) {
        check('E-ABORT', '시나리오 중단(예외)', false, String(err && err.message).split('\n')[0])
      } finally {
        await stopContext(ctx)
      }
    }
    await Promise.all(pending)
    currentViewport = '-'
    const leak = leakScan(keys)
    check('L-BROWSER-1', '브라우저 수집물(응답·요청·console·DOM·저장소·쿠키·window·state·서버 로그)에 가짜 키·서명·세션 토큰(헤더 외) 없음',
      leak.findings.length === 0, leak.findings.join(' ; '))
    check('L-BROWSER-2', '세션 토큰은 GET / 응답의 meta 1곳에만 있고 DOM·window·저장소에는 남지 않음', leak.tokenCaptured && leak.tokenInIndex === VIEWPORTS.length, 'tokenInIndex=' + leak.tokenInIndex)
    check('L-BROWSER-3', 'DOM 에서 session-token meta 제거됨', corpus.snapshots.every((s) => s.metaCount === 0), '')
    const consoleCount = corpus.consoles.length
    results.push({ id: 'INFO', viewport: '-', name: '수집 규모', pass: true, detail: '', info: { scannedItems: leak.scanned, responses: corpus.responses.length, requests: corpus.requests.length, console: consoleCount, snapshots: corpus.snapshots.length, serverLogLines: corpus.serverLogs.length, consoleKinds: Array.from(new Set(corpus.consoles.map((c) => c.type + ': ' + c.text.replace(/https?:\/\/\S+/g, '<url>').slice(0, 90)))) } })
    console.log('수집: 응답 ' + corpus.responses.length + ' / 요청 ' + corpus.requests.length + ' / console ' + consoleCount + ' / DOM 스냅샷 ' + corpus.snapshots.length + ' / 서버 로그 ' + corpus.serverLogs.length + ' / 검사 항목 ' + leak.scanned)
  } finally {
    await browser.close()
  }
  const checks = results.filter((r) => r.id !== 'INFO')
  const failed = checks.filter((r) => !r.pass)
  fs.writeFileSync(RESULT_FILE, JSON.stringify({ at: new Date().toISOString(), total: checks.length, passed: checks.length - failed.length, failed: failed.length, results }, null, 2) + '\n', 'utf8')
  console.log('\n통과 ' + (checks.length - failed.length) + ' / 실패 ' + failed.length + ' / 전체 ' + checks.length)
  process.exit(failed.length === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('통합 시험 실행 실패: ' + String(err && err.message).split('\n')[0])
  process.exit(2)
})
