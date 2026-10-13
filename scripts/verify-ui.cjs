// StockD 정적 HTML 세트(ui/)의 브라우저 검증 스크립트
// 실행: node scripts/verify-ui.cjs
// 환경변수(선택)
//   STOCKD_PLAYWRIGHT_MODULE : playwright 모듈 경로
//   STOCKD_BROWSER_PATH      : 브라우저 실행 파일 경로
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const uiDir = path.join(root, 'ui')
const resultsDir = path.join(__dirname, 'results')

const PAGES = [
  'index', 'inventory', 'orders', 'mappings', 'alerts', 'settings', 'missions',
  'login', 'states', 'about', 'help', 'terms', 'privacy', '404'
]
const MENUS = [
  ['dashboard', 'index.html', '대시보드'],
  ['inventory', 'inventory.html', '통합 재고'],
  ['orders', 'orders.html', '통합 주문'],
  ['mappings', 'mappings.html', '상품 연결'],
  ['alerts', 'alerts.html', '알림'],
  ['settings', 'settings.html', '연결·설정'],
  ['missions', 'missions.html', '매일 확인']
]
const FOOTER_LINKS = [
  ['about.html', '회사 소개'],
  ['help.html', '도움말'],
  ['terms.html', '이용약관'],
  ['privacy.html', '개인정보처리방침']
]
const STATES = ['loading', 'empty', 'error', 'stale', 'partial', 'unauthorized']
const WIDTHS = [360, 768, 1440]
const SHOT_PAGES = ['index', 'inventory', 'orders', 'missions']
const BANNER_TEXT = '샘플 데이터 · 실제 API 미연동'
const COPYRIGHT_TEXT = '© 2026 [회사명 입력 필요]'
const KST_DAY1 = '2026-10-04T10:00:00+09:00'
const KST_DAY2 = '2026-10-05T10:00:00+09:00'
const DAILY_KEY = 'stockd.daily-checks.v1'
const STORY_KEY = 'stockd.story-progress.v1'

const results = []

function file(name) {
  return name + '.html'
}

// ───────── 검사 기록 ─────────
async function check(group, name, action) {
  const entry = { group, name, status: 'pass', evidence: '' }
  try {
    const evidence = await action()
    entry.evidence = typeof evidence === 'string' ? evidence : JSON.stringify(evidence === undefined ? 'ok' : evidence)
  } catch (error) {
    entry.status = 'fail'
    entry.evidence = String(error && error.message ? error.message : error).slice(0, 1500)
  }
  results.push(entry)
  console.log((entry.status === 'pass' ? '[통과] ' : '[실패] ') + group + ' · ' + name + (entry.status === 'fail' ? '\n        ' + entry.evidence.split('\n')[0] : ''))
}

// 문제 목록을 모았다가 한 번에 단언한다 (첫 실패에서 멈추지 않기 위함)
function expectNoProblems(problems, okMessage) {
  assert.equal(problems.length, 0, problems.join(' | '))
  return okMessage
}

// ───────── Playwright·브라우저 준비 ─────────
function safeDirOf(name) {
  try { return path.dirname(require.resolve(name + '/package.json')) } catch (error) { return null }
}

function readVersion(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).version } catch (error) { return 'unknown' }
}

function loadPlaywright() {
  const tried = []
  const fromEnv = process.env.STOCKD_PLAYWRIGHT_MODULE
  if (fromEnv) {
    try {
      return { mod: require(fromEnv), via: 'STOCKD_PLAYWRIGHT_MODULE', dir: fromEnv }
    } catch (error) {
      tried.push('STOCKD_PLAYWRIGHT_MODULE=' + fromEnv + ' -> ' + error.message.split('\n')[0])
    }
  }
  try {
    return { mod: require('playwright'), via: "require('playwright')", dir: safeDirOf('playwright') }
  } catch (error) {
    tried.push("require('playwright') -> " + error.message.split('\n')[0])
  }
  // 마지막 대체: 기존 verify-prototype.cjs 가 쓰던 Codex 런타임 위치 (홈 폴더 기준)
  const fallback = path.join(os.homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'node_modules', 'playwright')
  try {
    console.log('안내: playwright 를 기본 경로에서 찾지 못해 Codex 런타임 경로로 대체합니다. 다른 PC 에서는 STOCKD_PLAYWRIGHT_MODULE 환경변수에 playwright 경로를 지정하세요.')
    return { mod: require(fallback), via: 'fallback ' + fallback, dir: fallback }
  } catch (error) {
    tried.push('fallback ' + fallback + ' -> ' + error.message.split('\n')[0])
  }
  throw new Error('playwright 모듈을 불러오지 못했습니다. STOCKD_PLAYWRIGHT_MODULE 에 경로를 지정하거나 npm i playwright 를 실행하세요.\n' + tried.join('\n'))
}

function browserCandidates() {
  const list = []
  if (process.env.STOCKD_BROWSER_PATH) list.push({ label: 'STOCKD_BROWSER_PATH', executablePath: process.env.STOCKD_BROWSER_PATH })
  list.push({ label: 'playwright 기본 브라우저', executablePath: undefined })
  const env = process.env
  const paths = [
    env.ProgramFiles && path.join(env.ProgramFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    env['ProgramFiles(x86)'] && path.join(env['ProgramFiles(x86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
    env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    env.ProgramFiles && path.join(env.ProgramFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    env['ProgramFiles(x86)'] && path.join(env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/microsoft-edge',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
  ].filter(Boolean)
  paths.forEach(executablePath => {
    if (fs.existsSync(executablePath)) list.push({ label: executablePath, executablePath })
  })
  return list
}

async function launchBrowser(chromium) {
  const attempts = []
  for (const candidate of browserCandidates()) {
    try {
      const browser = await chromium.launch({ headless: true, executablePath: candidate.executablePath })
      return { browser, via: candidate.label, attempts }
    } catch (error) {
      attempts.push(candidate.label + ' -> ' + error.message.split('\n')[0])
    }
  }
  throw new Error('브라우저를 실행하지 못했습니다.\n' + attempts.join('\n'))
}

// ───────── 정적 서버 (ui/ 를 127.0.0.1 임의 포트로) ─────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
}

function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    let pathname = decodeURIComponent(url.pathname)
    if (pathname === '/favicon.ico') {
      // 아이콘 요청은 검증 대상이 아니므로 빈 응답으로 처리
      res.writeHead(204)
      res.end()
      return
    }
    if (pathname === '/') pathname = '/index.html'
    const target = path.normalize(path.join(uiDir, pathname))
    const inside = target.startsWith(uiDir + path.sep)
    if (inside && fs.existsSync(target) && fs.statSync(target).isFile()) {
      res.writeHead(200, { 'Content-Type': MIME[path.extname(target)] || 'application/octet-stream', 'Cache-Control': 'no-store' })
      fs.createReadStream(target).pipe(res)
      return
    }
    // 없는 주소: 정적 서버 오류 페이지(404.html)를 404 상태로 응답
    const notFound = path.join(uiDir, '404.html')
    res.writeHead(404, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' })
    if (fs.existsSync(notFound)) fs.createReadStream(notFound).pipe(res)
    else res.end('Not Found')
  })
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({ origin: 'http://127.0.0.1:' + port, close: () => new Promise(done => server.close(done)) })
    })
  })
}

// ───────── 페이지 감시 ─────────
function isLocal(url, origin) {
  return url.startsWith(origin) || url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('about:')
}

async function newContext(browser, origin, options) {
  const context = await browser.newContext(Object.assign({ viewport: { width: 1440, height: 900 }, locale: 'ko-KR', timezoneId: 'Asia/Seoul' }, options || {}))
  // 외부 호스트 요청은 실제로 보내지 않고 막는다 (기록은 monitor 가 한다)
  await context.route(url => !isLocal(url.href, origin), route => route.abort())
  return context
}

// 페이지 하나에 대한 오류·요청 감시 (페이지를 옮겨 다녀도 누적)
function monitor(page, origin) {
  const m = { consoleErrors: [], pageErrors: [], requestFailed: [], external: [], badStatus: [], requests: [], consoleTexts: [] }
  page.on('console', message => {
    m.consoleTexts.push(message.text())
    if (message.type() === 'error') m.consoleErrors.push(message.text())
  })
  page.on('pageerror', error => m.pageErrors.push(error.message))
  page.on('request', request => {
    m.requests.push(request.method() + ' ' + request.url())
    if (!isLocal(request.url(), origin)) m.external.push(request.url())
  })
  page.on('requestfailed', request => {
    if (isLocal(request.url(), origin)) m.requestFailed.push(request.url() + ' ' + (request.failure() ? request.failure().errorText : ''))
  })
  page.on('response', response => {
    if (response.status() >= 400 && isLocal(response.url(), origin)) m.badStatus.push(response.status() + ' ' + response.url())
  })
  return m
}

async function gotoPage(page, origin, target) {
  const response = await page.goto(origin + '/' + target, { waitUntil: 'load' })
  await page.waitForLoadState('networkidle').catch(() => {})
  return response
}

// ───────── 페이지 안에서 실행하는 수집 함수 ─────────
function collectInfo() {
  const text = el => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim()
  const labelOf = el => {
    const parts = []
    if (el.labels) Array.from(el.labels).forEach(label => parts.push(text(label)))
    ;['aria-label', 'placeholder', 'name', 'id', 'title'].forEach(attr => {
      const value = el.getAttribute(attr)
      if (value) parts.push(value)
    })
    const labelledby = el.getAttribute('aria-labelledby')
    if (labelledby) {
      labelledby.split(/\s+/).forEach(id => {
        const ref = document.getElementById(id)
        if (ref) parts.push(text(ref))
      })
    }
    return parts.join(' ')
  }
  const inputs = Array.from(document.querySelectorAll('input, textarea, select')).map(el => ({
    tag: el.tagName.toLowerCase(),
    type: (el.getAttribute('type') || '').toLowerCase(),
    descriptor: labelOf(el),
    hasLabel: Boolean((el.labels && el.labels.length) || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby'))
  }))
  const clickable = Array.from(document.querySelectorAll('button, a, summary, [role="button"], input[type="button"], input[type="submit"]')).map(el => ({
    tag: el.tagName.toLowerCase(),
    text: text(el) + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.getAttribute('value') || ''),
    href: el.getAttribute('href')
  }))
  const externalRefs = Array.from(document.querySelectorAll('[href], [src], [action]')).map(el => ({
    tag: el.tagName.toLowerCase(),
    value: el.getAttribute('href') || el.getAttribute('src') || el.getAttribute('action') || ''
  })).filter(item => /^(https?:)?\/\//i.test(item.value))
  const links = Array.from(document.querySelectorAll('a[href]')).map(el => ({
    raw: el.getAttribute('href'),
    abs: el.href,
    text: text(el)
  }))
  const banner = document.querySelector('.sample-banner')
  const footer = document.querySelector('footer')
  return {
    title: document.title,
    mainCount: document.querySelectorAll('main').length,
    h1Count: document.querySelectorAll('h1').length,
    bannerText: banner ? text(banner) : '',
    footerText: footer ? text(footer) : '',
    bodyText: text(document.body),
    passwordCount: document.querySelectorAll('input[type="password"]').length,
    inputs,
    clickable,
    externalRefs,
    links,
    ids: Array.from(document.querySelectorAll('[id]')).map(el => el.id)
  }
}

// 가로 스크롤 진단 (문서 폭을 넘는 요소 상위 몇 개)
function scrollInfo() {
  const doc = document.documentElement
  const offenders = []
  if (doc.scrollWidth > doc.clientWidth) {
    Array.from(document.querySelectorAll('body *')).forEach(el => {
      const rect = el.getBoundingClientRect()
      if (rect.width > 0 && rect.right > doc.clientWidth + 1) {
        const id = el.id ? '#' + el.id : ''
        const cls = typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).join('.') : ''
        offenders.push(el.tagName.toLowerCase() + id + cls + ' right=' + Math.round(rect.right))
      }
    })
  }
  return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, offenders: offenders.slice(0, 5) }
}

// 클릭 요소 크기 측정
function measureTargets() {
  const selector = 'button, a[href], summary, [role="button"], input[type="checkbox"], input[type="radio"]'
  const text = el => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30)
  const violations = []
  const exemptInline = []
  let measured = 0
  Array.from(document.querySelectorAll(selector)).forEach(el => {
    let target = el
    if (el.tagName === 'INPUT') target = (el.labels && el.labels[0]) || el
    if (el.closest('.sr-only')) return
    const style = getComputedStyle(target)
    if (style.visibility === 'hidden' || style.display === 'none') return
    const rect = target.getBoundingClientRect()
    if (rect.width <= 1 || rect.height <= 1) return
    // 화면 밖(건너뛰기 링크 등)은 측정 불가로 제외
    if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= window.innerWidth + 2000) return
    measured += 1
    if (rect.width >= 43.5 && rect.height >= 43.5) return
    const id = el.id ? '#' + el.id : ''
    const desc = el.tagName.toLowerCase() + (el.type ? '[' + el.type + ']' : '') + id + ' "' + text(target) + '" ' + Math.round(rect.width * 10) / 10 + 'x' + Math.round(rect.height * 10) / 10
    // 문장 속 인라인 링크는 WCAG 인라인 예외로 분리 기록
    const block = target.closest('p, li, dd, td, div')
    const inline = style.display === 'inline' && block && (block.innerText || '').length > (target.innerText || '').length + 8
    if (inline) exemptInline.push(desc)
    else violations.push(desc)
  })
  return { measured, violations, exemptInline }
}

// ───────── 본 검사 ─────────
async function main() {
  fs.mkdirSync(resultsDir, { recursive: true })
  const { mod: playwright, via: playwrightVia, dir: playwrightDir } = loadPlaywright()
  const { browser, via: browserVia, attempts } = await launchBrowser(playwright.chromium)
  const server = await startServer()
  const origin = server.origin
  const environment = {
    node: process.version,
    os: process.platform + ' ' + os.release(),
    playwrightVia,
    playwrightVersion: playwrightDir ? readVersion(playwrightDir) : 'unknown',
    browser: 'chromium ' + browser.version(),
    browserVia,
    browserLaunchFailures: attempts,
    serverOrigin: origin
  }
  console.log('환경: ' + JSON.stringify(environment))

  try {
    await runChecks(browser, origin, environment)
  } finally {
    await browser.close()
    await server.close()
  }
}

async function runChecks(browser, origin, environment) {
  // ===== 1·2·5 공통: 1440 폭에서 14페이지를 한 번씩 열어 정보를 수집 =====
  const infos = {}
  const loadReports = {}
  {
    const context = await newContext(browser, origin)
    for (const name of PAGES) {
      const page = await context.newPage()
      const m = monitor(page, origin)
      const response = await gotoPage(page, origin, file(name))
      infos[name] = await page.evaluate(collectInfo)
      loadReports[name] = { status: response.status(), m }
      await page.close()
    }
    await context.close()
  }

  // ----- 1) 로드·오류·요청 -----
  for (const name of PAGES) {
    await check('1 로드·오류', file(name) + ' 로드·콘솔·요청', async () => {
      const { status, m } = loadReports[name]
      assert.equal(status, 200, 'HTTP ' + status)
      assert.deepEqual(m.consoleErrors, [], '콘솔 error: ' + m.consoleErrors.join(' / '))
      assert.deepEqual(m.pageErrors, [], 'pageerror: ' + m.pageErrors.join(' / '))
      assert.deepEqual(m.requestFailed, [], '요청 실패: ' + m.requestFailed.join(' / '))
      assert.deepEqual(m.badStatus, [], '4xx/5xx 응답: ' + m.badStatus.join(' / '))
      assert.deepEqual(m.external, [], '외부 호스트 요청: ' + m.external.join(' / '))
      return 'HTTP 200, 요청 ' + m.requests.length + '건, 오류 0, 외부 0'
    })
  }

  // ----- 2) 샘플 띠·푸터·법률 문구 -----
  for (const name of PAGES) {
    await check('2 샘플 띠·푸터', file(name) + ' 샘플 띠와 카피라이트', async () => {
      const info = infos[name]
      assert.ok(info.bannerText.includes(BANNER_TEXT), '샘플 띠 문구 없음: "' + info.bannerText + '"')
      assert.ok(info.footerText.includes(COPYRIGHT_TEXT), '푸터 카피라이트 없음: "' + info.footerText + '"')
      return '띠 "' + BANNER_TEXT + '", 푸터 "' + COPYRIGHT_TEXT + '" 확인'
    })
  }
  for (const name of ['terms', 'privacy']) {
    await check('2 샘플 띠·푸터', file(name) + ' 법무 검토 전 샘플 문구', async () => {
      assert.ok(infos[name].bodyText.includes('법무 검토 전 샘플'), '"법무 검토 전 샘플" 문구 없음')
      return '문구 확인'
    })
  }

  // ----- 3) 메뉴·링크 -----
  await check('3 메뉴·링크', '사이드바 메뉴 7개: 링크 목록과 aria-current (페이지별)', async () => {
    const problems = []
    const context = await newContext(browser, origin)
    const page = await context.newPage()
    for (const [id, href] of MENUS) {
      await gotoPage(page, origin, href)
      const nav = await page.$$eval('.side-nav-link', links => links.map(a => ({ href: a.getAttribute('href'), text: a.textContent.trim(), current: a.getAttribute('aria-current'), id: a.getAttribute('data-page-id') })))
      if (nav.length !== 7) problems.push(href + ': 메뉴 ' + nav.length + '개')
      MENUS.forEach(([menuId, menuHref, label], index) => {
        const item = nav[index]
        if (!item || item.href !== menuHref || item.text !== label) problems.push(href + ': ' + (index + 1) + '번 메뉴 불일치(' + JSON.stringify(item) + ')')
      })
      const currents = nav.filter(item => item.current === 'page').map(item => item.href)
      if (currents.length !== 1 || currents[0] !== href) problems.push(href + ': aria-current=' + JSON.stringify(currents))
    }
    await context.close()
    return expectNoProblems(problems, '7개 페이지 모두 메뉴 7개·현재 페이지 1개 표시')
  })

  await check('3 메뉴·링크', '사이드바 메뉴 클릭 이동 (회사 소개 페이지에서 7개 모두)', async () => {
    const problems = []
    const context = await newContext(browser, origin)
    const page = await context.newPage()
    for (const [id, href, label] of MENUS) {
      // 같은 페이지로의 이동은 URL 대기가 즉시 끝나 경합이 생기므로, 활성 메뉴가 없는 공통 페이지에서 출발한다
      await gotoPage(page, origin, 'about.html')
      await Promise.all([
        page.waitForURL(url => url.pathname.endsWith('/' + href)),
        page.locator('.side-nav-link', { hasText: label }).first().click()
      ])
      await page.waitForSelector('.side-nav-link[aria-current="page"]')
      const current = await page.$$eval('.side-nav-link[aria-current="page"]', links => links.map(a => a.getAttribute('href')))
      if (current.join() !== href) problems.push(label + ' 이동 후 aria-current=' + current.join())
    }
    await context.close()
    return expectNoProblems(problems, '7개 모두 이동·aria-current 정확')
  })

  await check('3 메뉴·링크', '공통 페이지에서는 사이드바 활성 메뉴 없음', async () => {
    const problems = []
    const context = await newContext(browser, origin)
    const page = await context.newPage()
    for (const name of ['about', 'help', 'terms', 'privacy', '404']) {
      await gotoPage(page, origin, file(name))
      const count = await page.locator('.side-nav-link[aria-current]').count()
      if (count !== 0) problems.push(file(name) + ': aria-current ' + count + '개')
    }
    await context.close()
    return expectNoProblems(problems, '5개 공통 페이지 모두 활성 메뉴 없음')
  })

  await check('3 메뉴·링크', '푸터 링크 4개 클릭 이동', async () => {
    const problems = []
    const context = await newContext(browser, origin)
    const page = await context.newPage()
    for (const [href, label] of FOOTER_LINKS) {
      await gotoPage(page, origin, 'index.html')
      const link = page.locator('.footer-links a', { hasText: label })
      if ((await link.count()) !== 1) { problems.push(label + ' 링크 개수 ' + (await link.count())); continue }
      await Promise.all([page.waitForURL(url => url.pathname.endsWith('/' + href)), link.click()])
      const h1 = await page.locator('h1').first().innerText()
      if (!h1.trim()) problems.push(href + ' h1 비어 있음')
    }
    await context.close()
    return expectNoProblems(problems, '푸터 4개 링크 이동·h1 확인')
  })

  await check('3 메뉴·링크', '상단바 도움말 링크 이동', async () => {
    const context = await newContext(browser, origin)
    const page = await context.newPage()
    await gotoPage(page, origin, 'inventory.html')
    await Promise.all([page.waitForURL(url => url.pathname.endsWith('/help.html')), page.locator('.topbar-link', { hasText: '도움말' }).click()])
    await context.close()
    return 'help.html 이동'
  })

  await check('3 메뉴·링크', '사용자 메뉴에서 로그인 화면 이동', async () => {
    const context = await newContext(browser, origin)
    const page = await context.newPage()
    await gotoPage(page, origin, 'index.html')
    await page.locator('.user-menu summary').click()
    await Promise.all([page.waitForURL(url => url.pathname.endsWith('/login.html')), page.locator('.user-menu-panel a', { hasText: '로그인 화면' }).click()])
    const badge = await page.locator('.user-menu-panel').count()
    await context.close()
    return 'login.html 이동 (사용자 메뉴 패널 ' + badge + '개 -> 이동 후 0 예상)'
  })

  await check('3 메뉴·링크', '모든 페이지의 내부 링크가 존재하는 파일(HTTP 200)', async () => {
    const problems = []
    const seen = new Map()
    const context = await newContext(browser, origin)
    const page = await context.newPage()
    // 동적으로 그려지는 링크까지 모으기 위해 렌더 후 수집(1440 정보 재사용 + 상태 쿼리 페이지)
    const extra = ['inventory.html?state=error', 'orders.html?state=error']
    const targets = PAGES.map(file).concat(extra)
    const hashChecks = []
    for (const target of targets) {
      await gotoPage(page, origin, target)
      const info = await page.evaluate(collectInfo)
      info.links.forEach(link => {
        const url = new URL(link.abs)
        if (url.origin !== origin) { problems.push(target + ': 외부/비정상 링크 ' + link.abs); return }
        if (link.raw.startsWith('#')) { hashChecks.push({ target, hash: link.raw.slice(1), ids: info.ids }); return }
        const key = url.pathname + url.search
        if (!seen.has(key)) seen.set(key, target)
      })
    }
    hashChecks.forEach(item => {
      if (!item.ids.includes(item.hash)) problems.push(item.target + ': #' + item.hash + ' 대상 id 없음')
    })
    for (const [key, from] of seen) {
      const response = await context.request.get(origin + key)
      if (response.status() !== 200) problems.push(from + ' -> ' + key + ' HTTP ' + response.status())
    }
    await context.close()
    return expectNoProblems(problems, '고유 내부 링크 ' + seen.size + '개 모두 200, 해시 링크 ' + hashChecks.length + '개 대상 존재')
  })

  // ----- 4) 반응형·가로 스크롤 -----
  for (const width of WIDTHS) {
    await check('4 반응형', width + 'px 14페이지 문서 가로 스크롤 없음', async () => {
      const problems = []
      const context = await newContext(browser, origin, { viewport: { width, height: 900 } })
      const page = await context.newPage()
      for (const name of PAGES) {
        await gotoPage(page, origin, file(name))
        const info = await page.evaluate(scrollInfo)
        if (info.scrollWidth > info.clientWidth) problems.push(file(name) + ' scrollWidth ' + info.scrollWidth + ' > clientWidth ' + info.clientWidth + ' [' + info.offenders.join(', ') + ']')
        if (SHOT_PAGES.includes(name)) {
          await page.screenshot({ path: path.join(resultsDir, 'ui-' + name + '-' + width + '.png'), fullPage: true })
        }
      }
      await context.close()
      return expectNoProblems(problems, '14페이지 모두 scrollWidth<=clientWidth, 스크린샷 4장 저장')
    })
  }

  await check('4 반응형', '960px 미만은 상단 가로 메뉴, 이상은 좌측 사이드바', async () => {
    const problems = []
    const out = []
    for (const width of [360, 768, 959, 960, 1440]) {
      const context = await newContext(browser, origin, { viewport: { width, height: 900 } })
      const page = await context.newPage()
      await gotoPage(page, origin, 'inventory.html')
      const geo = await page.evaluate(() => {
        const rect = selector => { const r = document.querySelector(selector).getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height } }
        const links = Array.from(document.querySelectorAll('.side-nav-link')).map(a => a.getBoundingClientRect())
        return { sidebar: rect('.sidebar'), main: rect('main'), tops: links.map(r => Math.round(r.top)), lefts: links.map(r => Math.round(r.left)) }
      })
      const sameRow = new Set(geo.tops).size === 1
      const sidebarAbove = geo.sidebar.bottom <= geo.main.top + 1
      const sidebarLeft = geo.sidebar.right <= geo.main.left + 1
      out.push(width + ':' + (sameRow ? '가로메뉴' : '세로메뉴'))
      if (width < 960) {
        if (!sameRow) problems.push(width + 'px: 메뉴 링크가 한 줄이 아님 tops=' + geo.tops.join(','))
        if (!sidebarAbove) problems.push(width + 'px: 사이드바가 본문 위에 있지 않음')
      } else {
        if (sameRow) problems.push(width + 'px: 메뉴가 가로 한 줄(사이드바 아님)')
        if (!sidebarLeft) problems.push(width + 'px: 사이드바가 본문 왼쪽이 아님')
      }
      await context.close()
    }
    return expectNoProblems(problems, out.join(', '))
  })

  // ----- 5) 쓰기·비밀값 금지 -----
  await check('5 쓰기·비밀값 금지', 'input[type=password] 는 login 에만', async () => {
    const problems = []
    PAGES.forEach(name => {
      const count = infos[name].passwordCount
      if (name === 'login' && count !== 1) problems.push('login password ' + count + '개')
      if (name !== 'login' && count !== 0) problems.push(file(name) + ' password ' + count + '개')
    })
    return expectNoProblems(problems, 'login 1개, 나머지 13페이지 0개')
  })

  await check('5 쓰기·비밀값 금지', 'API 키·토큰·시크릿 입력창 없음 (name/id/placeholder/label)', async () => {
    const problems = []
    const pattern = /api|token|secret|토큰|시크릿|비밀\s*키|access[\s_-]?key|client[\s_-]?id|키/i
    PAGES.forEach(name => {
      infos[name].inputs.forEach(input => {
        if (input.type === 'hidden') return
        if (pattern.test(input.descriptor)) problems.push(file(name) + ': ' + input.tag + '[' + input.type + '] "' + input.descriptor + '"')
      })
    })
    const total = PAGES.reduce((sum, name) => sum + infos[name].inputs.length, 0)
    return expectNoProblems(problems, '입력창 ' + total + '개 검사, 해당 없음')
  })

  await check('5 쓰기·비밀값 금지', "쓰기 문구('재고 수정|발송 처리|주문 상태 변경|발주 확인|취소 승인')가 버튼·링크 텍스트에 없음", async () => {
    const problems = []
    const pattern = /재고\s*수정|발송\s*처리|주문\s*상태\s*변경|발주\s*확인|취소\s*승인/
    PAGES.forEach(name => {
      infos[name].clickable.forEach(item => {
        // summary 는 도움말 FAQ 질문 문장이라 동작 버튼이 아니다(버튼·링크·role=button 만 검사)
        if (item.tag === 'summary') return
        if (pattern.test(item.text)) problems.push(file(name) + ': <' + item.tag + '> "' + item.text.trim() + '"')
      })
    })
    const total = PAGES.reduce((sum, name) => sum + infos[name].clickable.length, 0)
    return expectNoProblems(problems, '버튼·링크 ' + total + '개 검사, 해당 없음')
  })

  await check('5 쓰기·비밀값 금지', '외부 링크(http/https href·src) 0', async () => {
    const problems = []
    PAGES.forEach(name => {
      infos[name].externalRefs.forEach(item => problems.push(file(name) + ': <' + item.tag + '> ' + item.value))
    })
    return expectNoProblems(problems, '14페이지 외부 참조 0')
  })

  // ----- 6) 재고 불변조건 -----
  await check('6 재고 불변조건', 'inventory 표 수량 칸: 실패·미지원·미확인·관리 미사용은 —, 품절만 0', async () => {
    const context = await newContext(browser, origin)
    const page = await context.newPage()
    await gotoPage(page, origin, 'inventory.html')
    const rows = await page.$$eval('tbody tr[data-row-id]', trs => trs.map(tr => {
      const badge = tr.querySelector('td[data-label="조회 상태"] .badge')
      const stateClass = badge ? Array.from(badge.classList).find(c => /^badge-(normal|low|zero|stale|failed|unsupported|unmanaged|unverified)$/.test(c)) : ''
      const qty = tr.querySelector('td[data-label="수량"]')
      return { id: tr.getAttribute('data-row-id'), state: stateClass ? stateClass.replace('badge-', '') : '', qty: qty ? qty.textContent.trim() : null }
    }))
    await context.close()
    const problems = []
    assert.equal(rows.length, 10, '재고 행 ' + rows.length + '개 (10개 기대)')
    const dashOnly = ['failed', 'unsupported', 'unverified', 'unmanaged']
    rows.forEach(row => {
      if (dashOnly.includes(row.state) && row.qty !== '—') problems.push(row.id + '(' + row.state + ') 수량 "' + row.qty + '" (— 기대)')
      if (row.state === 'zero' && row.qty !== '0') problems.push(row.id + '(zero) 수량 "' + row.qty + '" (0 기대)')
      if (row.state !== 'zero' && row.qty === '0') problems.push(row.id + '(' + row.state + ') 수량이 0으로 표시됨')
      if (!row.state) problems.push(row.id + ' 상태 배지 없음')
    })
    const seen = new Set(rows.map(row => row.state))
    const states = ['normal', 'low', 'zero', 'stale', 'failed', 'unsupported', 'unmanaged', 'unverified']
    states.forEach(state => { if (!seen.has(state)) problems.push('상태 ' + state + ' 행이 표에 없음') })
    return expectNoProblems(problems, rows.map(row => row.id + ':' + row.state + '=' + row.qty).join(' '))
  })

  await check('6 재고 불변조건', '대시보드 비교 표에 합계/총합 열 없음, 실패·미지원 칸은 —', async () => {
    const context = await newContext(browser, origin)
    const page = await context.newPage()
    await gotoPage(page, origin, 'index.html')
    const heads = await page.$$eval('#compare-table thead th', ths => ths.map(th => th.textContent.trim()))
    const cells = await page.$$eval('#compare-table tbody td .number', spans => spans.map(span => span.textContent.trim()))
    const stateCells = await page.$$eval('#compare-table tbody td', tds => tds.map(td => ({ text: td.textContent.replace(/\s+/g, ' ').trim(), label: td.getAttribute('data-label') })))
    await context.close()
    assert.ok(heads.length >= 4, '비교 표 머리글을 찾지 못함: ' + heads.join(','))
    const bad = heads.filter(head => /합계|총합|합산|전체 수량|total|sum/i.test(head))
    assert.deepEqual(bad, [], '합계 열 의심 머리글: ' + bad.join(','))
    // 조회 실패/미지원/관리 미사용 배지가 있는 칸의 수량은 —
    const problems = []
    stateCells.forEach(cell => {
      if (/조회 실패|미지원|지원 미확인|관리 미사용/.test(cell.text) && /\s0(\s|$)/.test(cell.text.replace(/(조회 실패|미지원 예시|지원 미확인|관리 미사용)/g, '')) && !/—/.test(cell.text)) problems.push(cell.label + ': ' + cell.text)
    })
    return expectNoProblems(problems, '머리글=' + heads.join('|') + ' / 수량칸=' + cells.join(','))
  })

  await check('6 재고 불변조건', 'orders 로켓그로스 클레임 칸이 "지원 미확인"', async () => {
    const context = await newContext(browser, origin)
    const page = await context.newPage()
    await gotoPage(page, origin, 'orders.html')
    const rows = await page.$$eval('tbody tr[data-row-id]', trs => trs.map(tr => ({
      id: tr.getAttribute('data-row-id'),
      channelText: (tr.querySelector('td[data-label="채널·배송"]') || { textContent: '' }).textContent,
      claim: (tr.querySelector('td[data-label="클레임"]') || { textContent: '' }).textContent.replace(/\s+/g, ' ').trim()
    })))
    await context.close()
    const rocket = rows.filter(row => row.id.startsWith('DEMO-RO-') || row.channelText.includes('로켓그로스'))
    assert.ok(rocket.length >= 1, '로켓그로스 주문 행을 찾지 못함 (전체 ' + rows.length + '행)')
    const problems = rocket.filter(row => !row.claim.includes('지원 미확인')).map(row => row.id + ' 클레임 "' + row.claim + '"')
    return expectNoProblems(problems, '로켓그로스 ' + rocket.length + '행: ' + rocket.map(row => row.claim).join(' / '))
  })

  // ----- 7) 필터·상세·상태 -----
  await check('7 필터·상세', 'inventory 검색·쇼핑몰·상태 필터 건수 변화와 초기화', async () => {
    const context = await newContext(browser, origin)
    const page = await context.newPage()
    await gotoPage(page, origin, 'inventory.html')
    const data = await page.evaluate(() => JSON.parse(JSON.stringify(window.StockD.data.inventory)))
    const count = () => page.locator('tbody tr[data-row-id]').count()
    const total = await count()
    assert.equal(total, data.length, '초기 행 수 ' + total + ' / 데이터 ' + data.length)
    const problems = []

    await page.locator('[data-filter="search"]').fill('머그')
    const expectSearch = data.filter(row => (row.name + ' ' + row.option + ' ' + (row.sku || '')).toLowerCase().includes('머그')).length
    const gotSearch = await count()
    if (gotSearch !== expectSearch || gotSearch >= total) problems.push('검색 "머그" ' + gotSearch + '건 (기대 ' + expectSearch + ', 전체 ' + total + ')')
    await page.locator('[data-filter="search"]').fill('')

    await page.locator('[data-filter="channel"]').selectOption('naver')
    const expectChannel = data.filter(row => row.channel === 'naver').length
    const gotChannel = await count()
    if (gotChannel !== expectChannel || gotChannel >= total) problems.push('쇼핑몰 스마트스토어 ' + gotChannel + '건 (기대 ' + expectChannel + ')')

    await page.locator('[data-filter="status"]').selectOption('zero')
    const expectZero = data.filter(row => row.channel === 'naver' && row.state === 'zero').length
    const gotZero = await count()
    if (gotZero !== expectZero) problems.push('스마트스토어+품절 ' + gotZero + '건 (기대 ' + expectZero + ')')

    await page.locator('[data-filter="search"]').fill('없는상품zzz')
    if ((await count()) !== 0) problems.push('결과 없음 검색인데 행이 남음')
    const emptyShown = await page.locator('.empty-state').count()
    if (emptyShown !== 1) problems.push('결과 없음 안내 ' + emptyShown + '개')

    await page.locator('[data-filter-reset]').first().click()
    const afterReset = await count()
    if (afterReset !== total) problems.push('초기화 후 ' + afterReset + '건 (기대 ' + total + ')')
    const controls = await page.$$eval('[data-filter]', els => els.map(el => el.value))
    if (controls.some(value => value !== '')) problems.push('초기화 후 컨트롤 값 남음: ' + controls.join(','))
    await context.close()
    return expectNoProblems(problems, '전체 ' + total + ' -> 검색 ' + gotSearch + ' -> 쇼핑몰 ' + gotChannel + ' -> +상태 ' + gotZero + ' -> 초기화 ' + afterReset)
  })

  for (const name of ['inventory', 'orders']) {
    await check('7 필터·상세', name + ' 상세 열기 -> Escape -> 초점이 열었던 버튼으로 복귀 (키보드·클릭)', async () => {
      const context = await newContext(browser, origin)
      const page = await context.newPage()
      await gotoPage(page, origin, file(name))
      const problems = []
      const buttons = page.locator('[data-row-action]')
      const n = await buttons.count()
      assert.ok(n > 0, '상세 버튼 없음')
      for (const index of [0, n - 1]) {
        for (const mode of ['keyboard', 'click']) {
          const button = buttons.nth(index)
          const rowId = await button.getAttribute('data-row-action')
          await button.scrollIntoViewIfNeeded()
          if (mode === 'keyboard') {
            await button.focus()
            await page.keyboard.press('Enter')
          } else {
            await button.click()
          }
          const opened = await page.locator('dialog[open]').count()
          if (opened !== 1) { problems.push(rowId + '/' + mode + ' 다이얼로그 열림 ' + opened + '개'); continue }
          await page.keyboard.press('Escape')
          const closed = await page.locator('dialog[open]').count()
          const active = await page.evaluate(() => document.activeElement ? document.activeElement.getAttribute('data-row-action') : null)
          if (closed !== 0) problems.push(rowId + '/' + mode + ' Escape 후에도 열려 있음')
          if (active !== rowId) problems.push(rowId + '/' + mode + ' 초점 복귀 실패(active=' + active + ')')
        }
      }
      await context.close()
      return expectNoProblems(problems, '첫·마지막 행 x (키보드·클릭) 4회 모두 Escape 닫힘·초점 복귀')
    })
  }

  await check('7 필터·상세', 'orders 기간 시작>종료 시 안내, 정상 범위로 복귀', async () => {
    const context = await newContext(browser, origin)
    const page = await context.newPage()
    await gotoPage(page, origin, 'orders.html')
    const before = await page.locator('tbody tr[data-row-id]').count()
    await page.locator('[data-filter="from"]').fill('2026-10-05')
    await page.locator('[data-filter="to"]').fill('2026-10-01')
    const message = await page.locator('.empty-state').innerText()
    const rowsWhileInvalid = await page.locator('tbody tr[data-row-id]').count()
    assert.ok(message.includes('날짜 범위를 확인해 주세요'), '안내 문구 없음: ' + message)
    assert.equal(rowsWhileInvalid, 0, '잘못된 범위에서 행이 남음')
    await page.locator('[data-filter="from"]').fill('2026-10-01')
    await page.locator('[data-filter="to"]').fill('2026-10-05')
    const after = await page.locator('tbody tr[data-row-id]').count()
    assert.ok(after > 0, '정상 범위 복귀 후 행 없음')
    await context.close()
    return '기본 ' + before + '건 -> 잘못된 범위 0건+안내 -> 정상 범위 ' + after + '건'
  })

  for (const name of ['inventory', 'orders']) {
    await check('7 필터·상세', name + ' ?state= 6종 각각 상태 카드 표시', async () => {
      const context = await newContext(browser, origin)
      const page = await context.newPage()
      const problems = []
      for (const state of STATES) {
        await gotoPage(page, origin, file(name) + '?state=' + state)
        const cards = await page.locator('[data-state-card="' + state + '"]').count()
        const visible = cards ? await page.locator('[data-state-card="' + state + '"]').first().isVisible() : false
        if (cards !== 1 || !visible) problems.push(state + ' 카드 ' + cards + '개 visible=' + visible)
      }
      await context.close()
      return expectNoProblems(problems, STATES.join(',') + ' 모두 카드 표시')
    })
  }

  await check('7 필터·상세', 'states.html 의 재현 링크 12개 전부 클릭 이동 후 상태 카드 표시', async () => {
    const context = await newContext(browser, origin)
    const page = await context.newPage()
    await gotoPage(page, origin, 'states.html')
    const hrefs = await page.$$eval('a[href*="?state="]', links => Array.from(new Set(links.map(a => a.getAttribute('href')))))
    const visibleAll = await page.$$eval('a[href*="?state="]', links => links.filter(a => { const r = a.getBoundingClientRect(); return r.width > 0 && r.height > 0 }).length)
    const totalLinks = await page.locator('a[href*="?state="]').count()
    const problems = []
    if (hrefs.length !== 12) problems.push('고유 링크 ' + hrefs.length + '개 (12개 기대)')
    if (visibleAll !== totalLinks) problems.push('보이지 않는 링크 ' + (totalLinks - visibleAll) + '개')
    for (const href of hrefs) {
      await gotoPage(page, origin, 'states.html')
      const link = page.locator('a[href="' + href + '"]').first()
      await link.scrollIntoViewIfNeeded()
      await Promise.all([page.waitForURL(url => (url.pathname + url.search).endsWith(href)), link.click()])
      const state = href.split('=')[1]
      const card = await page.locator('[data-state-card="' + state + '"]').count()
      if (card !== 1) problems.push(href + ' 이동 후 카드 ' + card + '개')
    }
    await context.close()
    return expectNoProblems(problems, '링크 요소 ' + totalLinks + '개 / 고유 ' + hrefs.length + '개 클릭 이동·카드 확인')
  })

  // ----- 8) 연결·알림 -----
  await check('8 연결·알림', 'mappings: 후보 선택 전 적용 비활성 -> 적용 -> 이력 추가 -> 해제', async () => {
    const context = await newContext(browser, origin)
    const page = await context.newPage()
    await gotoPage(page, origin, 'mappings.html')
    const problems = []
    const applyButtons = page.locator('[data-action="apply"]')
    const n = await applyButtons.count()
    assert.ok(n >= 1, '적용 버튼 없음')
    for (let i = 0; i < n; i += 1) {
      if (!(await applyButtons.nth(i).isDisabled())) problems.push((i + 1) + '번 적용 버튼이 선택 전에 활성')
    }
    const histBefore = await page.locator('#history-rows tr').count()
    const unlinkedBefore = await page.locator('#unlinked-count').innerText()
    const firstId = await applyButtons.first().getAttribute('data-mapping-id')
    await page.locator('input[type="radio"][data-mapping-id="' + firstId + '"]').first().check()
    if (await page.locator('[data-action="apply"][data-mapping-id="' + firstId + '"]').isDisabled()) problems.push('후보 선택 후에도 적용 비활성')
    for (let i = 1; i < n; i += 1) {
      const id = await applyButtons.nth(i).getAttribute('data-mapping-id')
      if (id !== firstId && !(await page.locator('[data-action="apply"][data-mapping-id="' + id + '"]').isDisabled())) problems.push(id + ' 적용 버튼이 선택하지 않았는데 활성')
    }
    await page.locator('[data-action="apply"][data-mapping-id="' + firstId + '"]').click()
    const histApplied = await page.locator('#history-rows tr').count()
    const unlinkedApplied = await page.locator('#unlinked-count').innerText()
    if (histApplied !== histBefore + 1) problems.push('적용 후 이력 ' + histBefore + ' -> ' + histApplied)
    if (unlinkedApplied === unlinkedBefore) problems.push('적용 후 미연결 개수 변화 없음: ' + unlinkedApplied)
    const releaseButton = page.locator('[data-action="release"][data-mapping-id="' + firstId + '"]')
    if ((await releaseButton.count()) !== 1) problems.push('적용 후 해제 버튼 없음')
    else {
      await releaseButton.click()
      const histReleased = await page.locator('#history-rows tr').count()
      if (histReleased !== histApplied + 1) problems.push('해제 후 이력 ' + histApplied + ' -> ' + histReleased)
      if (!(await page.locator('[data-action="apply"][data-mapping-id="' + firstId + '"]').isDisabled())) problems.push('해제 후 적용 버튼이 비활성으로 돌아오지 않음')
      const unlinkedReleased = await page.locator('#unlinked-count').innerText()
      if (unlinkedReleased !== unlinkedBefore) problems.push('해제 후 미연결 ' + unlinkedReleased + ' (기대 ' + unlinkedBefore + ')')
    }
    await context.close()
    return expectNoProblems(problems, '적용 버튼 ' + n + '개 모두 선택 전 비활성; 이력 ' + histBefore + ' -> ' + histApplied + ' -> ' + (histApplied + 1) + '; ' + unlinkedBefore + ' -> ' + unlinkedApplied)
  })

  await check('8 연결·알림', 'alerts: 개별 확인 -> 전체 확인', async () => {
    const context = await newContext(browser, origin)
    const page = await context.newPage()
    await gotoPage(page, origin, 'alerts.html')
    const problems = []
    const open0 = Number((await page.locator('#count-open').innerText()).trim())
    const all0 = Number((await page.locator('#count-all').innerText()).trim())
    assert.ok(open0 >= 2, '미확인 알림 ' + open0 + '개')
    await page.locator('[data-ack]').first().click()
    const open1 = Number((await page.locator('#count-open').innerText()).trim())
    if (open1 !== open0 - 1) problems.push('개별 확인 후 미확인 ' + open0 + ' -> ' + open1)
    await page.locator('#ack-all').click()
    const open2 = Number((await page.locator('#count-open').innerText()).trim())
    if (open2 !== 0) problems.push('전체 확인 후 미확인 ' + open2)
    const emptyText = await page.locator('.empty-state').innerText().catch(() => '')
    if (!emptyText.includes('미확인 알림이 없습니다')) problems.push('미확인 0건 빈 상태 안내 없음')
    await page.locator('[data-tab="all"]').click()
    const allRows = await page.locator('#alert-body [data-ack], #alert-body li, #alert-body article').count()
    const all1 = Number((await page.locator('#count-all').innerText()).trim())
    if (all1 !== all0) problems.push('전체 개수 변동 ' + all0 + ' -> ' + all1)
    await context.close()
    return expectNoProblems(problems, '미확인 ' + open0 + ' -> ' + open1 + ' -> ' + open2 + ', 전체 ' + all1 + ' 유지 (전체 탭 항목 요소 ' + allRows + ')')
  })

  // ----- 9) 매일 확인 -----
  const missionsToday = (page) => page.evaluate(() => {
    const summary = window.StockD.missions.getTodaySummary()
    return { date: summary.date, done: summary.done }
  })
  const storyCount = (page) => page.evaluate(() => window.StockD.missions.getStoryProgress().unlocked)

  await check('9 매일 확인', 'KST 날짜 고정: 열기 -> 재고 -> 주문 -> 매일 확인 3/3·스탬프·컷 1', async () => {
    const context = await newContext(browser, origin)
    const page = await context.newPage()
    const m = monitor(page, origin)
    await context.clock.setFixedTime(new Date(KST_DAY1))
    await gotoPage(page, origin, 'index.html')
    await page.evaluate(() => window.localStorage.clear())
    await page.reload({ waitUntil: 'load' })
    const problems = []
    const after = []
    const s0 = await missionsToday(page)
    if (s0.date !== '2026-10-04') problems.push('가상 시계 날짜 ' + s0.date + ' (2026-10-04 기대)')
    after.push('index=' + s0.done)
    if (s0.done !== 1) problems.push('대시보드 열기 후 ' + s0.done + '/3 (1 기대)')
    await gotoPage(page, origin, 'inventory.html')
    const s1 = await missionsToday(page)
    after.push('inventory=' + s1.done)
    if (s1.done !== 2) problems.push('재고 방문 후 ' + s1.done + '/3 (2 기대)')
    await gotoPage(page, origin, 'orders.html')
    const s2 = await missionsToday(page)
    after.push('orders=' + s2.done)
    if (s2.done !== 3) problems.push('주문 방문 후 ' + s2.done + '/3 (3 기대)')
    await gotoPage(page, origin, 'missions.html')
    const progressText = (await page.locator('#todayProgressText').innerText()).trim()
    const storyText = (await page.locator('#storyCount').innerText()).trim()
    const stamped = await page.locator('.stamp-done').count()
    const openCuts = await page.locator('.story-cut:not([disabled])').count()
    after.push('missions="' + progressText + '", "' + storyText + '", 스탬프=' + stamped + ', 열린 컷=' + openCuts)
    if (!progressText.includes('3/3')) problems.push('매일 확인 진행 문구 "' + progressText + '"')
    if (!storyText.includes('1/15')) problems.push('이야기 문구 "' + storyText + '"')
    if (stamped !== 1) problems.push('스탬프 ' + stamped + '개')
    if (openCuts !== 1) problems.push('열린 컷 ' + openCuts + '개')
    if (await page.locator('#storyStart').isDisabled()) problems.push('이야기 읽기 버튼 비활성')

    // 같은 날 재방문: 3/3 유지, 컷 증가 없음
    for (const target of ['index.html', 'inventory.html', 'orders.html', 'missions.html']) await gotoPage(page, origin, target)
    const again = await missionsToday(page)
    const cutsAgain = await storyCount(page)
    after.push('재방문=' + again.done + ', 컷=' + cutsAgain)
    if (again.done !== 3) problems.push('같은 날 재방문 후 ' + again.done + '/3')
    if (cutsAgain !== 1) problems.push('같은 날 재방문 후 컷 ' + cutsAgain)
    const stored = await page.evaluate(([dailyKey, storyKey]) => ({ daily: window.localStorage.getItem(dailyKey), story: window.localStorage.getItem(storyKey) }), [DAILY_KEY, STORY_KEY])
    if (!stored.daily || !stored.story) problems.push('localStorage 키 저장 안 됨')
    if (m.pageErrors.length || m.consoleErrors.length) problems.push('오류 발생: ' + m.pageErrors.concat(m.consoleErrors).join(' / '))

    // 하루 뒤
    await context.clock.setFixedTime(new Date(KST_DAY2))
    await gotoPage(page, origin, 'missions.html')
    const nextProgress = (await page.locator('#todayProgressText').innerText()).trim()
    const nextStory = await storyCount(page)
    after.push('다음 날 missions="' + nextProgress + '", 컷=' + nextStory)
    if (!/0\/3|1\/3/.test(nextProgress)) problems.push('다음 날 시작 진행 "' + nextProgress + '" (0~1/3 기대)')
    if (nextStory !== 1) problems.push('다음 날 컷 ' + nextStory + ' (유지 1 기대)')
    await gotoPage(page, origin, 'index.html')
    const dayTwo = await missionsToday(page)
    after.push('다음 날 index=' + dayTwo.done + ' (' + dayTwo.date + ')')
    if (dayTwo.date !== '2026-10-05') problems.push('다음 날 날짜 ' + dayTwo.date)
    if (dayTwo.done > 1) problems.push('다음 날 index 후 ' + dayTwo.done + '/3')
    await context.close()
    return expectNoProblems(problems, after.join(' | '))
  })

  await check('9 매일 확인', "settings '일일 기록 삭제' 후 이야기 유지, '샘플 초기화' 후 일일 기록 유지", async () => {
    const context = await newContext(browser, origin)
    const page = await context.newPage()
    const problems = []
    const notes = []
    await context.clock.setFixedTime(new Date(KST_DAY1))
    await gotoPage(page, origin, 'index.html')
    await page.evaluate(() => window.localStorage.clear())
    for (const target of ['index.html', 'inventory.html', 'orders.html']) await gotoPage(page, origin, target)
    const base = await missionsToday(page)
    const baseCuts = await storyCount(page)
    notes.push('준비 오늘=' + base.done + ', 컷=' + baseCuts)
    if (base.done !== 3 || baseCuts !== 1) problems.push('준비 상태가 3/3, 컷 1이 아님')

    // 일일 기록 삭제
    await gotoPage(page, origin, 'settings.html')
    await page.locator('#clear-daily-button').click()
    await page.locator('#confirm-ok').click()
    await page.waitForTimeout(100)
    const focusBack = await page.evaluate(() => document.activeElement && document.activeElement.id)
    if (focusBack !== 'clear-daily-button') problems.push('확인창 닫힌 뒤 초점 ' + focusBack)
    const cleared = await missionsToday(page)
    const clearedCuts = await storyCount(page)
    notes.push('일일 기록 삭제 후 오늘=' + cleared.done + ', 컷=' + clearedCuts)
    if (cleared.done > 1) problems.push('일일 기록 삭제 후 오늘 ' + cleared.done + '/3 (0~1 기대)')
    if (clearedCuts !== baseCuts) problems.push('일일 기록 삭제 후 이야기 ' + baseCuts + ' -> ' + clearedCuts)
    const weekStamps = await page.evaluate(() => window.StockD.missions.getWeek().filter(day => day.stamped).length)
    if (weekStamps !== 0) problems.push('삭제 후에도 스탬프 ' + weekStamps + '개')

    // 다시 3/3 으로 만든 뒤 샘플 초기화
    for (const target of ['inventory.html', 'orders.html']) await gotoPage(page, origin, target)
    const redo = await missionsToday(page)
    const redoCuts = await storyCount(page)
    notes.push('재완료 오늘=' + redo.done + ', 컷=' + redoCuts)
    await gotoPage(page, origin, 'settings.html')
    await page.locator('#reset-sample-button').click()
    await page.locator('#confirm-ok').click()
    await page.waitForTimeout(100)
    const afterReset = await missionsToday(page)
    const afterResetCuts = await storyCount(page)
    notes.push('샘플 초기화 후 오늘=' + afterReset.done + ', 컷=' + afterResetCuts)
    if (afterReset.done !== redo.done) problems.push('샘플 초기화 후 일일 기록 ' + redo.done + ' -> ' + afterReset.done)
    if (afterResetCuts !== redoCuts) problems.push('샘플 초기화 후 이야기 ' + redoCuts + ' -> ' + afterResetCuts)
    await context.close()
    return expectNoProblems(problems, notes.join(' | '))
  })

  await check('9 매일 확인', '저장 차단(localStorage 접근 예외) 시 14페이지 오류 없음, missions 안내 표시', async () => {
    const problems = []
    const variants = {
      '접근 예외': () => {
        Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('blocked', 'SecurityError') } })
      },
      '쓰기 예외': () => {
        Storage.prototype.setItem = function () { throw new DOMException('quota', 'QuotaExceededError') }
      }
    }
    const notes = []
    for (const [label, script] of Object.entries(variants)) {
      const context = await newContext(browser, origin)
      await context.addInitScript(script)
      const page = await context.newPage()
      const m = monitor(page, origin)
      for (const name of PAGES) {
        await gotoPage(page, origin, file(name))
        if (name === 'missions') {
          const notice = page.locator('#storageNotice')
          const visible = await notice.isVisible()
          const text = visible ? await notice.innerText() : ''
          if (!visible || !text.includes('저장할 수 없습니다')) problems.push(label + ': missions 저장 불가 안내 미표시')
          const storageText = await page.locator('#todayStorageText').innerText()
          notes.push(label + ' 안내="' + text.replace(/\s+/g, ' ').slice(0, 30) + '" / "' + storageText.trim() + '"')
        }
      }
      // 차단 상태에서도 방문 기록은 현재 열기 동안 메모리로 유지
      await gotoPage(page, origin, 'index.html')
      if (m.pageErrors.length) problems.push(label + ': pageerror ' + m.pageErrors.join(' / '))
      if (m.consoleErrors.length) problems.push(label + ': 콘솔 error ' + m.consoleErrors.join(' / '))
      await context.close()
    }
    return expectNoProblems(problems, '두 방식 모두 14페이지 pageerror 0, 콘솔 error 0; ' + notes.join('; '))
  })

  // ----- 10) 로그인 -----
  await check('10 로그인', '제출 시 요청 0, 입력값 미저장·미출력, 인증 미구현 배지', async () => {
    const randomPart = Math.random().toString(36).slice(2, 10)
    const email = 'qa-' + randomPart + '@example.com'
    const secret = 'Pw-' + randomPart + '-' + Math.random().toString(36).slice(2, 8)
    const context = await newContext(browser, origin)
    const page = await context.newPage()
    const m = monitor(page, origin)
    await gotoPage(page, origin, 'login.html')
    const badge = await page.locator('body').innerText()
    const problems = []
    if (!badge.includes('인증 미구현')) problems.push("'인증 미구현' 표시 없음")
    const badgeVisible = await page.locator('.badge-auth', { hasText: '인증 미구현' }).first().isVisible()
    if (!badgeVisible) problems.push('인증 미구현 배지가 보이지 않음')
    const requestsBefore = m.requests.length
    const urlBefore = page.url()
    await page.locator('#login-email').fill(email)
    await page.locator('#login-password').fill(secret)
    await page.locator('#login-form button[type="submit"]').click()
    await page.waitForTimeout(600)
    const newRequests = m.requests.slice(requestsBefore)
    if (newRequests.length) problems.push('제출 후 요청 ' + newRequests.length + '건: ' + newRequests.join(' / '))
    if (page.url() !== urlBefore) problems.push('URL 변경: ' + page.url())
    const resultVisible = await page.locator('#login-result').isVisible()
    if (!resultVisible) problems.push('제출 후 안내(#login-result) 미표시')
    const dump = await page.evaluate(() => {
      const out = []
      ;[window.localStorage, window.sessionStorage].forEach(store => {
        for (let i = 0; i < store.length; i += 1) out.push(store.key(i) + '=' + store.getItem(store.key(i)))
      })
      return { storage: out.join('\n'), cookie: document.cookie, hash: location.hash + location.search }
    })
    if (dump.storage.includes(randomPart) || dump.cookie.includes(randomPart) || dump.hash.includes(randomPart)) problems.push('입력값이 storage/cookie/URL 에 남음')
    if (m.consoleTexts.some(text => text.includes(randomPart))) problems.push('입력값이 콘솔에 출력됨')
    if (m.pageErrors.length || m.consoleErrors.length) problems.push('오류: ' + m.pageErrors.concat(m.consoleErrors).join(' / '))
    await context.close()
    return expectNoProblems(problems, '제출 후 추가 요청 0, storage 항목 ' + dump.storage.split('\n').filter(Boolean).length + '개(입력값 없음), 콘솔 ' + m.consoleTexts.length + '건(입력값 없음), 안내 표시, 배지 표시')
  })

  await check('10 로그인', '잘못된 입력 검증 문구 (형식만 확인)', async () => {
    const context = await newContext(browser, origin)
    const page = await context.newPage()
    await gotoPage(page, origin, 'login.html')
    await page.locator('#login-form button[type="submit"]').click()
    const emailError = await page.locator('#login-email-error').isVisible()
    const resultHidden = !(await page.locator('#login-result').isVisible())
    await context.close()
    assert.ok(emailError, '빈 제출 시 이메일 오류 문구 없음')
    assert.ok(resultHidden, '빈 제출인데 완료 안내가 표시됨')
    return '빈 제출 시 오류 문구 표시, 완료 안내 숨김'
  })

  // ----- 11) 접근성 기본 -----
  await check('11 접근성', '각 페이지 main 1개·h1 1개', async () => {
    const problems = []
    PAGES.forEach(name => {
      if (infos[name].mainCount !== 1) problems.push(file(name) + ' main ' + infos[name].mainCount + '개')
      if (infos[name].h1Count !== 1) problems.push(file(name) + ' h1 ' + infos[name].h1Count + '개')
    })
    return expectNoProblems(problems, '14페이지 main=1, h1=1')
  })

  await check('11 접근성', '모든 input·select·textarea 에 라벨', async () => {
    const problems = []
    let total = 0
    PAGES.forEach(name => {
      infos[name].inputs.forEach(input => {
        if (['hidden', 'submit', 'button', 'reset', 'image'].includes(input.type)) return
        total += 1
        if (!input.hasLabel) problems.push(file(name) + ': ' + input.tag + '[' + input.type + '] "' + input.descriptor + '" 라벨 없음')
      })
    })
    return expectNoProblems(problems, '입력창 ' + total + '개 모두 라벨 연결')
  })

  for (const width of WIDTHS) {
    await check('11 접근성', width + 'px 클릭 요소 44px 이상 (14페이지)', async () => {
      const context = await newContext(browser, origin, { viewport: { width, height: 900 } })
      const page = await context.newPage()
      const problems = []
      const exempt = []
      let measured = 0
      for (const name of PAGES) {
        await gotoPage(page, origin, file(name))
        const result = await page.evaluate(measureTargets)
        measured += result.measured
        result.violations.forEach(item => problems.push(file(name) + ' ' + item))
        result.exemptInline.forEach(item => exempt.push(file(name) + ' ' + item))
      }
      // 다이얼로그가 열린 상태(재고 상세)도 측정
      await gotoPage(page, origin, 'inventory.html')
      await page.locator('[data-row-action]').first().click()
      const dialogResult = await page.evaluate(measureTargets)
      measured += dialogResult.measured
      dialogResult.violations.forEach(item => problems.push('inventory.html(상세 열림) ' + item))
      await context.close()
      const note = '측정 ' + measured + '개, 인라인 예외 ' + exempt.length + '개' + (exempt.length ? ' [' + exempt.slice(0, 10).join(' ; ') + ']' : '')
      assert.equal(problems.length, 0, '44px 미만 ' + problems.length + '개: ' + problems.slice(0, 40).join(' | ') + ' // ' + note)
      return note
    })
  }

  await check('11 접근성', 'prefers-reduced-motion 에뮬레이션 시 14페이지 오류 없음', async () => {
    const context = await newContext(browser, origin, { reducedMotion: 'reduce' })
    const page = await context.newPage()
    const m = monitor(page, origin)
    const problems = []
    for (const name of PAGES) {
      await gotoPage(page, origin, file(name))
      const matches = await page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      if (!matches) problems.push(file(name) + ': reduce 에뮬레이션 미적용')
    }
    if (m.pageErrors.length) problems.push('pageerror ' + m.pageErrors.join(' / '))
    if (m.consoleErrors.length) problems.push('콘솔 error ' + m.consoleErrors.join(' / '))
    await context.close()
    return expectNoProblems(problems, '14페이지 reduce 적용, 오류 0')
  })

  await runSecondRoundChecks(browser, origin)

  // ===== 결과 저장 =====
  const pass = results.filter(item => item.status === 'pass').length
  const fail = results.length - pass
  const report = {
    checkedAt: new Date().toISOString(),
    total: results.length,
    pass,
    fail,
    environment,
    screenshots: SHOT_PAGES.flatMap(name => WIDTHS.map(width => 'scripts/results/ui-' + name + '-' + width + '.png')).concat(['scripts/results/ui-orders-360-cards.png', 'scripts/results/ui-mappings-360-cards.png']),
    results
  }
  fs.writeFileSync(path.join(resultsDir, 'verify-ui.json'), JSON.stringify(report, null, 2) + '\n', 'utf8')
  console.log('\n합계 ' + results.length + ' / 통과 ' + pass + ' / 실패 ' + fail)
  console.log('결과: ' + path.join(resultsDir, 'verify-ui.json'))
  if (fail) process.exitCode = 1
}

// ───────── H13 2차: 수정 B1~B5 회귀 방지 검사 (A~H) ─────────

// 페이지 안에서 실행: 카드 모드 정렬 진단 (td 왼쪽에서 60px 이내에 값 요소가 있으면 라벨 열 침범)
function cardAlignmentInfo() {
  const problems = []
  let cells = 0
  let tables = 0
  Array.from(document.querySelectorAll('.responsive-table')).forEach(table => {
    if (getComputedStyle(table).display === 'none') return
    tables += 1
    Array.from(table.querySelectorAll('td')).forEach(td => {
      const label = td.getAttribute('data-label')
      const tdStyle = getComputedStyle(td)
      if (tdStyle.display === 'none') return
      cells += 1
      const tdRect = td.getBoundingClientRect()
      const row = td.closest('tr')
      const rowName = row ? (row.getAttribute('data-row-id') || (row.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 20)) : ''
      if (tdStyle.display !== 'grid' && tdStyle.display !== 'flex') problems.push('[' + rowName + '/' + (label || '(라벨없음)') + '] td display=' + tdStyle.display + ' (카드 모드 아님)')
      // 값 영역 후보: 요소 자식 + 글자 노드
      const parts = []
      Array.from(td.childNodes).forEach(node => {
        if (node.nodeType === 1) {
          const style = getComputedStyle(node)
          if (style.display === 'none') return
          const rect = node.getBoundingClientRect()
          if (rect.width > 0 && rect.height > 0) parts.push({ name: node.tagName.toLowerCase() + (node.className ? '.' + String(node.className).trim().split(/\s+/)[0] : ''), rect })
        } else if (node.nodeType === 3 && node.textContent.trim()) {
          const range = document.createRange()
          range.selectNodeContents(node)
          const rect = range.getBoundingClientRect()
          if (rect.width > 0 && rect.height > 0) parts.push({ name: '#text', rect })
        }
      })
      const hasLabel = Boolean(label) && !td.classList.contains('cell-title') && !td.classList.contains('cell-actions')
      parts.forEach(part => {
        const offset = part.rect.left - tdRect.left
        if (hasLabel && offset < 60) problems.push('[' + rowName + '/' + label + '] <' + part.name + '> 왼쪽이 td+' + Math.round(offset) + 'px (라벨 열 침범)')
        if (part.rect.right > tdRect.right + 1.5) problems.push('[' + rowName + '/' + (label || '(라벨없음)') + '] <' + part.name + '> 오른쪽이 td 밖 +' + Math.round(part.rect.right - tdRect.right) + 'px')
      })
      // 값 요소들이 서로 같은 왼쪽 선에 정렬되는지(라벨 칸 이후 열 하나)
      if (hasLabel && parts.length > 1) {
        const lefts = parts.map(part => Math.round(part.rect.left))
        const spread = Math.max.apply(null, lefts) - Math.min.apply(null, lefts)
        if (spread > 2) problems.push('[' + rowName + '/' + label + '] 값 요소 왼쪽 좌표가 제각각 ' + lefts.join('/'))
      }
    })
  })
  return { tables, cells, problems }
}

// 페이지 안에서 실행: 일반 표 레이아웃 유지 및 가로 스크롤 위치 진단
function tableModeInfo() {
  const problems = []
  let tables = 0
  let cells = 0
  Array.from(document.querySelectorAll('.responsive-table')).forEach(table => {
    if (getComputedStyle(table).display === 'none') return
    tables += 1
    if (getComputedStyle(table).display !== 'table') problems.push('table display=' + getComputedStyle(table).display)
    Array.from(table.querySelectorAll('td')).forEach(td => {
      const display = getComputedStyle(td).display
      if (display === 'none') return
      cells += 1
      if (display !== 'table-cell') problems.push('td[' + (td.getAttribute('data-label') || '') + '] display=' + display)
    })
    if (!table.closest('.table-scroll')) problems.push('표가 .table-scroll 밖에 있음')
  })
  const doc = document.documentElement
  const scrollers = []
  Array.from(document.querySelectorAll('body *')).forEach(el => {
    const style = getComputedStyle(el)
    if (/(auto|scroll)/.test(style.overflowX) && el.scrollWidth > el.clientWidth + 1) {
      const cls = typeof el.className === 'string' ? el.className : ''
      scrollers.push({ tag: el.tagName.toLowerCase() + (cls ? '.' + cls.trim().split(/\s+/).join('.') : ''), inTableScroll: el.classList.contains('table-scroll') })
    }
  })
  scrollers.filter(item => !item.inTableScroll).forEach(item => problems.push('.table-scroll 이 아닌 가로 스크롤 영역: ' + item.tag))
  if (doc.scrollWidth > doc.clientWidth) problems.push('문서 가로 스크롤 ' + doc.scrollWidth + '>' + doc.clientWidth)
  return { tables, cells, problems: problems.slice(0, 20), tableScrollOverflow: scrollers.filter(item => item.inTableScroll).length }
}

async function runSecondRoundChecks(browser, origin) {
  const num = text => Number((String(text).match(/\d+/) || [NaN])[0])
  const missionsToday = page => page.evaluate(() => { const summary = window.StockD.missions.getTodaySummary(); return { date: summary.date, done: summary.done } })
  const storyCount = page => page.evaluate(() => window.StockD.missions.getStoryProgress().unlocked)
  const STATE_CLASSES = ['badge-normal', 'badge-low', 'badge-zero', 'badge-stale', 'badge-failed', 'badge-unsupported', 'badge-unmanaged', 'badge-unverified']

  // ===== A) 카드 모드 정렬 (H-1 회귀 방지) =====
  const CARD_PAGES = [
    ['inventory.html', '재고 표'],
    ['orders.html', '주문 표'],
    ['index.html', '대시보드 비교 표'],
    ['mappings.html', '상품 연결(후보·미연결·이력 표)']
  ]
  await check('A 카드 모드 정렬', '360px: 4개 페이지 모든 .responsive-table td 의 값 요소가 라벨 열(td 왼쪽 60px)을 침범하지 않음', async () => {
    const context = await newContext(browser, origin, { viewport: { width: 360, height: 900 } })
    const page = await context.newPage()
    const problems = []
    const notes = []
    for (const [target, label] of CARD_PAGES) {
      await gotoPage(page, origin, target)
      await page.waitForSelector('.responsive-table td')
      const info = await page.evaluate(cardAlignmentInfo)
      notes.push(label + ' 표 ' + info.tables + '개/칸 ' + info.cells + '개')
      if (info.cells === 0) problems.push(target + ': 검사할 칸 0개')
      info.problems.slice(0, 8).forEach(item => problems.push(target + ' ' + item))
      if (info.problems.length > 8) problems.push(target + ' 외 ' + (info.problems.length - 8) + '건')
    }
    // 연결 이력 표는 적용 후 행이 늘어난 상태에서도 확인
    await gotoPage(page, origin, 'mappings.html')
    const firstId = await page.locator('[data-action="apply"]').first().getAttribute('data-mapping-id')
    await page.locator('input[type="radio"][data-mapping-id="' + firstId + '"]').first().check()
    await page.locator('[data-action="apply"][data-mapping-id="' + firstId + '"]').click()
    const afterApply = await page.evaluate(cardAlignmentInfo)
    notes.push('mappings 적용 후 칸 ' + afterApply.cells + '개')
    afterApply.problems.slice(0, 8).forEach(item => problems.push('mappings(적용 후) ' + item))
    await context.close()
    return expectNoProblems(problems, notes.join(' / ') + ' - 침범·삐져나옴 0')
  })

  for (const width of [768, 1440]) {
    await check('A 카드 모드 정렬', width + 'px: 일반 표 레이아웃 유지, 가로 스크롤은 .table-scroll 안에서만', async () => {
      const context = await newContext(browser, origin, { viewport: { width, height: 900 } })
      const page = await context.newPage()
      const problems = []
      const notes = []
      for (const [target] of CARD_PAGES) {
        await gotoPage(page, origin, target)
        await page.waitForSelector('.responsive-table td')
        const info = await page.evaluate(tableModeInfo)
        notes.push(target.replace('.html', '') + ' 표 ' + info.tables + '/칸 ' + info.cells + '/표 안 스크롤 ' + info.tableScrollOverflow)
        if (info.cells === 0) problems.push(target + ': 검사할 칸 0개')
        info.problems.forEach(item => problems.push(target + ' ' + item))
      }
      await context.close()
      return expectNoProblems(problems, notes.join(' ; '))
    })
  }

  // ===== B) 대시보드 카드 링크 일치 =====
  const EXPECT_STATUS = { stock: 3, sync: 2, unavailable: 3, attention: 6 }
  await check('B 카드·알림 링크', '대시보드 카드 4개 숫자 = 링크 이동 후 재고 표시 건수 (stock=3, sync=2, unavailable=3, 미연결=mappings)', async () => {
    const context = await newContext(browser, origin)
    const page = await context.newPage()
    const problems = []
    const notes = []
    await gotoPage(page, origin, 'index.html')
    const cards = await page.$$eval('#attention-cards a.stat-card', links => links.map(a => ({
      label: a.querySelector('.stat-card-label').textContent.trim(),
      value: a.querySelector('.stat-card-value').textContent,
      href: a.getAttribute('href')
    })))
    if (cards.length !== 4) problems.push('카드 ' + cards.length + '개 (4개 기대)')
    for (const card of cards) {
      const value = num(card.value)
      await gotoPage(page, origin, 'index.html')
      await Promise.all([page.waitForURL(url => (url.pathname + url.search).endsWith(card.href)), page.locator('#attention-cards a.stat-card[href="' + card.href + '"]').click()])
      await page.waitForLoadState('load')
      if (card.href.startsWith('inventory.html')) {
        const status = card.href.split('status=')[1]
        const summary = await page.locator('[data-table-summary] strong').innerText()
        const rows = await page.locator('tbody tr[data-row-id]').count()
        const select = await page.locator('[data-filter="status"]').inputValue()
        notes.push(card.label + '=' + value + ' -> ' + status + ' 표시 "' + summary + '" 행 ' + rows)
        if (value !== EXPECT_STATUS[status]) problems.push(card.label + ' 카드 숫자 ' + value + ' (기대 ' + EXPECT_STATUS[status] + ')')
        if (num(summary) !== value) problems.push(card.label + ': 카드 ' + value + ' vs 재고 표시 "' + summary + '"')
        if (rows !== value) problems.push(card.label + ': 카드 ' + value + ' vs 표 행 ' + rows)
        if (select !== status) problems.push(card.label + ': 상태 필터 값 "' + select + '" (' + status + ' 기대)')
      } else {
        const unlinked = await page.locator('#unlinked-count').innerText()
        const rows = await page.locator('#unlinked-body tbody tr').count()
        notes.push(card.label + '=' + value + ' -> mappings "' + unlinked + '" 행 ' + rows)
        if (num(unlinked) !== value || rows !== value) problems.push(card.label + ': 카드 ' + value + ' vs 연결 화면 "' + unlinked + '" 행 ' + rows)
      }
    }
    await gotoPage(page, origin, 'inventory.html?status=attention')
    const attentionRows = await page.locator('tbody tr[data-row-id]').count()
    notes.push('attention 직접 이동 행 ' + attentionRows)
    if (attentionRows !== EXPECT_STATUS.attention) problems.push('?status=attention ' + attentionRows + '행 (6 기대)')
    await context.close()
    return expectNoProblems(problems, notes.join(' | '))
  })

  await check('B 카드·알림 링크', 'alerts 관련 항목 링크: 재고->?status=stock(3건), 조회->?status=sync(2건), 연결->mappings.html', async () => {
    const context = await newContext(browser, origin)
    const page = await context.newPage()
    const problems = []
    const notes = []
    await gotoPage(page, origin, 'alerts.html')
    const alertData = await page.evaluate(() => JSON.parse(JSON.stringify(window.StockD.data.alerts)))
    const count = alertData.length
    const expectHref = { stock: 'inventory.html?status=stock', sync: 'inventory.html?status=sync', mapping: 'mappings.html' }
    const expectCount = { stock: 3, sync: 2 }
    for (let i = 0; i < count; i += 1) {
      await gotoPage(page, origin, 'alerts.html')
      await page.locator('[data-tab="all"]').click().catch(() => {})
      const item = page.locator('.alert-item').nth(i)
      const title = (await item.locator('h3').innerText()).trim()
      const alert = alertData.find(entry => entry.title === title)
      if (!alert) { problems.push('알림 데이터에서 "' + title + '" 를 찾지 못함'); continue }
      const link = item.locator('a')
      const href = await link.getAttribute('href')
      if (href !== expectHref[alert.type]) problems.push(alert.id + '(' + alert.type + ') href "' + href + '" (기대 "' + expectHref[alert.type] + '")')
      await Promise.all([page.waitForURL(url => (url.pathname + url.search).endsWith(href)), link.click()])
      await page.waitForLoadState('load')
      if (alert.type === 'mapping') {
        const unlinked = await page.locator('#unlinked-count').innerText()
        notes.push(alert.id + ' 연결 -> mappings.html (' + unlinked + ')')
      } else {
        const summary = await page.locator('[data-table-summary] strong').innerText()
        const select = await page.locator('[data-filter="status"]').inputValue()
        const rows = await page.locator('tbody tr[data-row-id]').count()
        notes.push(alert.id + ' ' + alert.type + ' -> 표시 "' + summary + '" 행 ' + rows)
        if (select !== alert.type) problems.push(alert.id + ': 이동 후 상태 필터 "' + select + '" (' + alert.type + ' 기대)')
        if (rows !== expectCount[alert.type] || num(summary) !== rows) problems.push(alert.id + ': 이동 후 건수 행 ' + rows + ' / "' + summary + '" (기대 ' + expectCount[alert.type] + ')')
      }
    }
    const perType = {}
    alertData.forEach(entry => { perType[entry.type] = (perType[entry.type] || 0) + 1 })
    notes.push('알림 유형별 개수 ' + JSON.stringify(perType) + '(알림 개수와 이동 후 행 수는 별개 개념으로 비교하지 않음)')
    await context.close()
    return expectNoProblems(problems, notes.join(' | '))
  })

  // ===== C) 방문 기록 규칙 =====
  const readToast = page => page.evaluate(() => {
    const el = document.querySelector('.toast')
    return el ? { text: (el.textContent || '').trim(), hidden: el.hidden } : { text: '', hidden: true }
  })
  const readSteps = page => page.evaluate(() => window.StockD.missions.getTodaySummary())

  await check('C 방문 기록 규칙', 'inventory·orders ?state=loading|error|unauthorized: 기록 안 늘고 토스트 없음 / empty|stale|partial: 기록됨', async () => {
    const problems = []
    const notes = []
    for (const name of ['inventory', 'orders']) {
      for (const state of STATES) {
        const context = await newContext(browser, origin)
        await context.clock.setFixedTime(new Date(KST_DAY1))
        const page = await context.newPage()
        await gotoPage(page, origin, 'about.html')
        await page.evaluate(() => window.localStorage.clear())
        await gotoPage(page, origin, file(name) + '?state=' + state)
        await page.waitForTimeout(150)
        const summary = await readSteps(page)
        const toast = await readToast(page)
        const recorded = ['empty', 'stale', 'partial'].includes(state)
        notes.push(name + '?state=' + state + ' ' + summary.done + '/3' + (toast.text ? ' 토스트' : ' 토스트없음'))
        if (recorded) {
          if (summary.done < 2) problems.push(name + '?state=' + state + ' 기록 안 됨(' + summary.done + '/3, 2 기대)')
          if (!toast.text.includes('점검 완료가 아닙니다')) problems.push(name + '?state=' + state + ' 토스트에 "점검 완료가 아닙니다" 없음: "' + toast.text + '"')
        } else {
          if (summary.done !== 0) problems.push(name + '?state=' + state + ' 기록이 늘어남(' + summary.done + '/3, 0 기대)')
          if (toast.text) problems.push(name + '?state=' + state + ' 토스트 표시됨: "' + toast.text + '"')
        }
        await context.close()
      }
    }
    return expectNoProblems(problems, notes.join(' ; '))
  })

  await check('C 방문 기록 규칙', '단계 이름·토스트·완료 문구 (오늘 StockD 열기 / 재고 화면 열기 / 주문 화면 열기, 점검 완료가 아닙니다, 화면 방문 3개를 모두 기록)', async () => {
    const context = await newContext(browser, origin)
    await context.clock.setFixedTime(new Date(KST_DAY1))
    const page = await context.newPage()
    const problems = []
    const notes = []
    await gotoPage(page, origin, 'about.html')
    await page.evaluate(() => window.localStorage.clear())
    await gotoPage(page, origin, 'missions.html')
    const names = await page.$$eval('#todaySteps li strong', els => els.map(el => el.textContent.trim()))
    const expectNames = ['오늘 StockD 열기', '재고 화면 열기', '주문 화면 열기']
    if (names.join('|') !== expectNames.join('|')) problems.push('단계 이름 ' + names.join('|') + ' (기대 ' + expectNames.join('|') + ')')
    notes.push('단계=' + names.join('/'))
    await gotoPage(page, origin, 'index.html')
    await gotoPage(page, origin, 'inventory.html')
    const invToast = await readToast(page)
    notes.push('재고 토스트="' + invToast.text + '"')
    if (!invToast.text.includes('점검 완료가 아닙니다')) problems.push('재고 방문 토스트에 "점검 완료가 아닙니다" 없음: "' + invToast.text + '"')
    await gotoPage(page, origin, 'orders.html')
    const ordToast = await readToast(page)
    notes.push('주문(3번째) 토스트="' + ordToast.text + '"')
    if (!ordToast.text.includes('화면 방문 3개를 모두 기록')) problems.push('3개 완료 토스트에 "화면 방문 3개를 모두 기록" 없음: "' + ordToast.text + '"')
    if (!ordToast.text.includes('점검 완료가 아닙니다')) problems.push('3개 완료 토스트에 "점검 완료가 아닙니다" 없음')
    await gotoPage(page, origin, 'missions.html')
    const status = (await page.locator('#todayStatus').innerText()).trim()
    notes.push('missions 상태="' + status + '"')
    if (!status.includes('화면 방문')) problems.push('missions 완료 상태 문구에 "화면 방문" 없음: "' + status + '"')
    const body = await page.locator('main').innerText()
    ;[/재고 점검 완료(?!가)/, /주문 점검 완료(?!가)/].forEach(pattern => { if (pattern.test(body)) problems.push('missions 본문에 업무 점검 완료로 읽힐 문구: ' + pattern) })
    // 옛 문구 잔존 확인
    const legacy = ['재고 확인하기', '주문 확인하기', '한 바퀴 검토']
    legacy.forEach(text => { if (body.includes(text)) problems.push('옛 문구 "' + text + '" 잔존') })
    await context.close()
    return expectNoProblems(problems, notes.join(' | '))
  })

  // ===== D) 샘플 연습 배지 =====
  await check('D 샘플 연습 배지', '옵션 연결 승인: 1개->첫 연결 체험, 3개->세 옵션 연결 체험, 해제해도 유지, 새로고침하면 초기화', async () => {
    const context = await newContext(browser, origin)
    const page = await context.newPage()
    const problems = []
    const notes = []
    await gotoPage(page, origin, 'missions.html')
    const badgeText = id => page.locator('[data-badge="' + id + '"]').innerText().then(text => text.trim())
    notes.push('초기 ' + (await badgeText('firstLink')) + ' / ' + (await badgeText('reviewRound')))
    if (!(await badgeText('firstLink')).includes('미획득') || !(await badgeText('reviewRound')).includes('미획득')) problems.push('초기에 이미 획득 표시')
    const details = page.locator('details#samplePractice')
    if (await details.evaluate(el => el.open)) problems.push('추가 샘플 연습이 처음부터 펼쳐져 있음(접힘 기대)')
    await details.locator('summary').click()
    if (!(await details.evaluate(el => el.open))) problems.push('summary 클릭 후에도 접혀 있음')
    const labels = (await page.locator('#practiceList li.mapping-row').count())
    if (labels !== 3) problems.push('옵션 연결 체험 행 ' + labels + '개 (3 기대)')
    const approveButtons = await page.$$eval('#practiceList button[data-map]', els => els.map(el => el.getAttribute('data-map') + ':' + el.textContent.trim()))
    notes.push('연결 버튼=' + approveButtons.join(','))
    if (approveButtons.join('|') !== 'c2:샘플 연결 승인|c3:샘플 연결 승인|n5:샘플 연결 승인') problems.push('옵션 3개(c2·c3·n5) 승인 버튼 구성이 다름: ' + approveButtons.join(','))

    await page.locator('#practiceList button[data-map="c2"]').click()
    const first1 = await badgeText('firstLink')
    const round1 = await badgeText('reviewRound')
    notes.push('1개 승인 후 ' + first1 + ' / ' + round1)
    if (!first1.includes('첫 연결 체험') || !first1.includes('획득') || first1.includes('미획득')) problems.push('1개 승인 후 첫 연결 체험 미획득: "' + first1 + '"')
    if (!round1.includes('미획득')) problems.push('1개 승인 후 세 옵션 연결 체험이 이미 획득: "' + round1 + '"')

    await page.locator('#practiceList button[data-map="c3"]').click()
    const round2 = await badgeText('reviewRound')
    if (!round2.includes('미획득')) problems.push('2개 승인 후 세 옵션 연결 체험이 이미 획득: "' + round2 + '"')
    await page.locator('#practiceList button[data-map="n5"]').click()
    const round3 = await badgeText('reviewRound')
    notes.push('3개 승인 후 ' + (await badgeText('firstLink')) + ' / ' + round3)
    if (!round3.includes('세 옵션 연결 체험') || !round3.includes('획득') || round3.includes('미획득')) problems.push('3개 승인 후 세 옵션 연결 체험 미획득: "' + round3 + '"')

    // 해제해도 배지 유지
    for (const id of ['c2', 'c3', 'n5']) await page.locator('#practiceList button[data-map="' + id + '"]').click()
    const released = (await badgeText('firstLink')) + ' / ' + (await badgeText('reviewRound'))
    notes.push('전체 해제 후 ' + released)
    if (released.includes('미획득')) problems.push('해제 후 배지가 사라짐: ' + released)
    const approveAgain = await page.$$eval('#practiceList button[data-map]', els => els.map(el => el.textContent.trim()))
    if (approveAgain.some(text => text !== '샘플 연결 승인')) problems.push('해제 후 버튼이 승인으로 돌아오지 않음: ' + approveAgain.join(','))

    await page.reload({ waitUntil: 'load' })
    const reset = (await badgeText('firstLink')) + ' / ' + (await badgeText('reviewRound'))
    notes.push('새로고침 후 ' + reset)
    if ((reset.match(/미획득/g) || []).length !== 2) problems.push('새로고침 후 초기화되지 않음: ' + reset)
    await context.close()
    return expectNoProblems(problems, notes.join(' | '))
  })

  // ===== E) 44px 재측정은 위의 '11 접근성' 검사(360/768/1440)에서 수행 =====

  // ===== F) settings =====
  await check('F settings', '수량 기준 입력 검증: 빈 값·소수·음수·문자·지수 거부, 0 이상 정수 허용', async () => {
    const context = await newContext(browser, origin)
    const page = await context.newPage()
    await gotoPage(page, origin, 'settings.html')
    const input = page.locator('#threshold-input')
    const submit = page.locator('#threshold-form button[type="submit"]')
    const error = page.locator('#threshold-error')
    const current = page.locator('#threshold-current')
    const problems = []
    const notes = []
    const tryValue = async (label, apply, shouldPass, expectText) => {
      await apply()
      const typed = await input.inputValue()
      await submit.click()
      const errVisible = await error.isVisible()
      const errText = errVisible ? (await error.innerText()).trim() : ''
      const currentText = (await current.innerText()).trim()
      const invalid = await input.getAttribute('aria-invalid')
      if (shouldPass) {
        if (errVisible) problems.push(label + ' 입력이 거부됨: ' + errText)
        if (!currentText.includes(expectText)) problems.push(label + ' 허용 후 확인 표시 "' + currentText + '" (' + expectText + ' 기대)')
      } else {
        if (!errVisible) problems.push(label + ' 입력이 거부되지 않음(오류 문구 없음, 입력값 "' + typed + '")')
        if (invalid !== 'true') problems.push(label + ' 거부인데 aria-invalid 없음')
      }
      notes.push(label + '(입력값 "' + typed + '") -> ' + (errVisible ? '거부' : '허용'))
    }
    await tryValue('빈 값', () => input.fill(''), false)
    await tryValue('소수 1.5', () => input.fill('1.5'), false)
    await tryValue('음수 -3', () => input.fill('-3'), false)
    await tryValue('지수 1e2', () => input.fill('1e2'), false)
    await tryValue('문자 abc(키 입력)', async () => { await input.fill(''); await input.pressSequentially('abc') }, false)
    await tryValue('0', () => input.fill('0'), true, '0개')
    await tryValue('12', () => input.fill('12'), true, '12개')
    await tryValue('999999', () => input.fill('999999'), true, '999999개')
    await tryValue('1000000(상한 초과)', () => input.fill('1000000'), false)
    await context.close()
    return expectNoProblems(problems, notes.join(' ; '))
  })

  await check('F settings', '샘플 초기화·일일 기록 삭제는 별개 버튼, 각각 확인창, 취소하면 아무 것도 지워지지 않음', async () => {
    const context = await newContext(browser, origin)
    await context.clock.setFixedTime(new Date(KST_DAY1))
    const page = await context.newPage()
    const problems = []
    const notes = []
    await gotoPage(page, origin, 'index.html')
    await page.evaluate(() => window.localStorage.clear())
    for (const target of ['index.html', 'inventory.html', 'orders.html', 'settings.html']) await gotoPage(page, origin, target)
    const reset = page.locator('#reset-sample-button')
    const clear = page.locator('#clear-daily-button')
    if ((await reset.count()) !== 1 || (await clear.count()) !== 1) problems.push('버튼 개수 reset=' + (await reset.count()) + ' clear=' + (await clear.count()))
    const resetText = (await reset.innerText()).trim()
    const clearText = (await clear.innerText()).trim()
    notes.push('버튼 "' + resetText + '" / "' + clearText + '"')
    if (resetText === clearText) problems.push('두 버튼 문구가 같음')
    const before = await missionsToday(page)
    const beforeCuts = await storyCount(page)
    const titles = []
    for (const [name, button] of [['샘플 초기화', reset], ['일일 기록 삭제', clear]]) {
      await button.click()
      const open = await page.locator('dialog#confirm-dialog[open]').count()
      const title = open ? (await page.locator('#confirm-title').innerText()).trim() : ''
      const message = open ? (await page.locator('#confirm-message').innerText()).trim() : ''
      titles.push(title)
      if (open !== 1) problems.push(name + ' 버튼: 확인창 열림 ' + open + '개')
      else {
        notes.push(name + ' 확인창 제목 "' + title + '"')
        await page.locator('#confirm-cancel').click()
        if ((await page.locator('dialog#confirm-dialog[open]').count()) !== 0) problems.push(name + ' 확인창 취소 후에도 열려 있음')
        const active = await page.evaluate(() => document.activeElement && document.activeElement.id)
        if (active !== (name === '샘플 초기화' ? 'reset-sample-button' : 'clear-daily-button')) problems.push(name + ' 취소 후 초점 ' + active)
        if (name === '샘플 초기화' && message.includes('삭제') && !message.includes('보존') && !message.includes('유지')) problems.push('샘플 초기화 확인창이 일일 기록 삭제처럼 읽힘: ' + message)
      }
    }
    if (titles[0] === titles[1]) problems.push('두 확인창 제목이 같음: ' + titles[0])
    const after = await missionsToday(page)
    const afterCuts = await storyCount(page)
    if (after.done !== before.done || afterCuts !== beforeCuts) problems.push('취소했는데 기록 변경 ' + before.done + '->' + after.done + ', 컷 ' + beforeCuts + '->' + afterCuts)
    notes.push('취소 후 오늘 ' + after.done + '/3, 컷 ' + afterCuts + ' 유지')
    // 키보드: Escape 로 닫기
    await clear.click()
    await page.keyboard.press('Escape')
    if ((await page.locator('dialog#confirm-dialog[open]').count()) !== 0) problems.push('Escape 로 확인창이 닫히지 않음')
    await context.close()
    return expectNoProblems(problems, notes.join(' | ') + ' (삭제·초기화 실행 후 보존 규칙은 9 매일 확인 검사에서 확인)')
  })

  // ===== G) states stale 설명 =====
  await check('G states 설명', 'stale 설명이 "마지막 성공값 유지"를 말하고 "—로 비운다"고 말하지 않음, inventory ?state=stale 안내와 일치', async () => {
    const context = await newContext(browser, origin)
    const page = await context.newPage()
    const problems = []
    const notes = []
    await gotoPage(page, origin, 'states.html')
    const staleText = await page.locator('article:has(.state-card-stale)').innerText()
    const flat = staleText.replace(/\s+/g, ' ')
    const withoutNegation = flat.replace(/비우지 않/g, '')
    notes.push('stale 설명 길이 ' + flat.length)
    if (!/마지막\s*(으로\s*)?성공(한)?\s*값/.test(flat) || !/(유지|보여)/.test(flat)) problems.push('stale 설명에 "마지막 성공값 유지" 의미가 없음: ' + flat.slice(0, 160))
    if (/[—‘’']\s*[—]?\s*[’']?\s*(로|으로)\s*비(운다|웁니다|워)|비워\s*(둡|서)/.test(withoutNegation)) problems.push('stale 설명이 "—로 비운다"고 말함: ' + flat.slice(0, 200))
    const pageBody = (await page.locator('main').innerText()).replace(/\s+/g, ' ')
    const intro = pageBody.match(/[^.]*확인 지연은[^.]*\./)
    notes.push('상단 규칙문="' + (intro ? intro[0].trim().slice(0, 80) : '없음') + '"')
    if (!intro || !intro[0].includes('마지막 성공값')) problems.push('상단 규칙 문장에 확인 지연=마지막 성공값 설명이 없음')
    // 재고 화면과 비교
    await gotoPage(page, origin, 'inventory.html?state=stale')
    const card = page.locator('[data-state-card="stale"]')
    const cardText = ((await card.innerText()) || '').replace(/\s+/g, ' ')
    notes.push('inventory stale 안내="' + cardText.slice(0, 90) + '"')
    if (!cardText.includes('마지막 성공값')) problems.push('inventory ?state=stale 안내에 "마지막 성공값" 없음')
    if (/비운다|비웁니다/.test(cardText.replace(/비우지 않/g, ''))) problems.push('inventory stale 안내가 비운다고 말함')
    const sentence = '최근 조회가 실패해 마지막 성공값을 보여주는 상태의 예시입니다'
    if (!flat.includes(sentence) || !cardText.includes(sentence)) problems.push('states 설명과 inventory 안내의 핵심 문장이 서로 다름')
    // stale 행의 수량은 마지막 성공값(—이 아님)
    const staleQty = await page.$$eval('tbody tr[data-row-id]', trs => trs.map(tr => {
      const badge = tr.querySelector('td[data-label="조회 상태"] .badge')
      const qty = tr.querySelector('td[data-label="수량"]')
      return { id: tr.getAttribute('data-row-id'), stale: Boolean(badge && badge.classList.contains('badge-stale')), qty: qty ? qty.textContent.trim() : '' }
    }).filter(row => row.stale))
    notes.push('stale 행 ' + staleQty.map(row => row.id + '=' + row.qty).join(','))
    if (!staleQty.length) problems.push('?state=stale 화면에 stale 행 없음')
    staleQty.forEach(row => { if (row.qty === '—' || row.qty === '') problems.push(row.id + ' stale 행 수량이 비어 있음("' + row.qty + '")') })
    await context.close()
    return expectNoProblems(problems, notes.join(' | '))
  })

  // ===== H) 배지 의미 분리 =====
  await check('H 배지 의미', "'실제 미연결'(index 채널 상태·settings 채널 카드·about 지원 채널 표)은 모두 .badge-neutral, 재고 상태 8종 클래스 미사용", async () => {
    const context = await newContext(browser, origin)
    const page = await context.newPage()
    const problems = []
    const notes = []
    for (const target of ['index.html', 'settings.html', 'about.html']) {
      await gotoPage(page, origin, target)
      await page.waitForSelector('.badge')
      const found = await page.$$eval('.badge', els => els.filter(el => el.textContent.includes('실제 미연결')).map(el => ({ text: el.textContent.trim(), cls: Array.from(el.classList) })))
      notes.push(target + ' ' + found.length + '곳')
      if (found.length === 0) problems.push(target + ': "실제 미연결" 배지를 찾지 못함')
      found.forEach(item => {
        if (!item.cls.includes('badge-neutral')) problems.push(target + ': "' + item.text + '" 클래스 ' + item.cls.join('.') + ' (badge-neutral 아님)')
        const state = item.cls.filter(cls => STATE_CLASSES.includes(cls) || cls === 'badge-sample')
        if (state.length) problems.push(target + ': "' + item.text + '" 가 ' + state.join(',') + ' 사용')
      })
    }
    await context.close()
    return expectNoProblems(problems, notes.join(', ') + ' - 모두 badge-neutral')
  })

  await check('H 배지 의미', 'SKU 미연결 배지는 badge-neutral 이고 재고 상태 8종 클래스를 쓰지 않음 (inventory·mappings·index)', async () => {
    const context = await newContext(browser, origin)
    const page = await context.newPage()
    const problems = []
    const notes = []
    for (const target of ['inventory.html', 'mappings.html', 'index.html', 'orders.html']) {
      await gotoPage(page, origin, target)
      const found = await page.$$eval('.badge', els => els.filter(el => /SKU 미연결/.test(el.textContent)).map(el => ({ text: el.textContent.trim(), cls: Array.from(el.classList) })))
      notes.push(target + ' ' + found.length + '곳')
      found.forEach(item => {
        if (!item.cls.includes('badge-neutral')) problems.push(target + ': "' + item.text + '" 클래스 ' + item.cls.join('.'))
        const state = item.cls.filter(cls => STATE_CLASSES.includes(cls))
        if (state.length) problems.push(target + ': "' + item.text + '" 가 재고 상태 클래스 ' + state.join(',') + ' 사용')
      })
    }
    const total = notes.reduce((sum, note) => sum + num(note.split(' ')[1]), 0)
    if (total === 0) problems.push('SKU 미연결 배지를 어느 페이지에서도 찾지 못함')
    await context.close()
    return expectNoProblems(problems, notes.join(', '))
  })

  // 반대 방향: 재고 상태 8종 클래스가 상태 이름이 아닌 문구에 쓰이지 않는지
  await check('H 배지 의미', '재고 상태 8종 클래스(.badge-normal 등)는 재고 상태 문구에만 사용 (SKU·연결·실제 미연결 문구 제외)', async () => {
    const context = await newContext(browser, origin)
    const page = await context.newPage()
    const problems = []
    const allowed = /정상|부족|품절|조회 실패|확인 지연|미지원|관리 미사용|지원 미확인|상태 미확인|조회 전/
    for (const name of ['index', 'inventory', 'orders', 'mappings', 'alerts', 'settings', 'states', 'about']) {
      await gotoPage(page, origin, file(name))
      const bad = await page.$$eval('.badge', (els, classes) => els.filter(el => classes.some(cls => el.classList.contains(cls))).map(el => ({ text: el.textContent.trim(), cls: Array.from(el.classList).join('.') })), STATE_CLASSES)
      bad.forEach(item => { if (!allowed.test(item.text) || /SKU|연결/.test(item.text)) problems.push(file(name) + ': "' + item.text + '" (' + item.cls + ')') })
    }
    await context.close()
    return expectNoProblems(problems, '8개 페이지의 상태 배지 문구가 모두 재고 상태 이름')
  })

  // ===== 스크린샷: 360px 카드 모드 확인용 (orders, mappings) =====
  await check('A 카드 모드 정렬', '360px 카드 모드 확인용 스크린샷 2장 저장 (orders, mappings)', async () => {
    const context = await newContext(browser, origin, { viewport: { width: 360, height: 900 } })
    const page = await context.newPage()
    await gotoPage(page, origin, 'orders.html')
    await page.screenshot({ path: path.join(resultsDir, 'ui-orders-360-cards.png'), fullPage: true })
    await gotoPage(page, origin, 'mappings.html')
    await page.screenshot({ path: path.join(resultsDir, 'ui-mappings-360-cards.png'), fullPage: true })
    await context.close()
    return 'ui-orders-360-cards.png, ui-mappings-360-cards.png'
  })
}

main().catch(error => {
  console.error('검증 스크립트 실행 실패: ' + (error && error.stack ? error.stack : error))
  process.exitCode = 2
})
