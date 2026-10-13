'use strict'

// 쿠팡 재고 조회 로컬 테스트 서버. 조회 전용, 127.0.0.1 바인딩만.
// 키는 env-loader 의 서명기 클로저에만 존재하며 응답·로그·오류에 나가지 않는다.

const http = require('node:http')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')

const { loadKeyFile } = require('./lib/env-loader.cjs')
const { createClient, resolveTarget } = require('./lib/coupang-client.cjs')
const allowlist = require('./lib/allowlist.cjs')
const { createGuard } = require('./lib/guard.cjs')
const { createMasker, formatClockTime } = require('./lib/sanitize.cjs')
const { AppError, StartupError, describe } = require('./lib/errors.cjs')
const { inspectEnvironment } = require('./lib/env-guard.cjs')

const BIND_HOST = '127.0.0.1'
const DEFAULT_PORT = 8787
const MAX_BODY_BYTES = 4096
const MAX_BATCH = 20

// 정적 파일은 이 고정 목록만 서빙한다 (요청 경로로 파일 경로를 만들지 않음)
const STATIC_FILES = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8', isIndex: true },
  '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8', isIndex: false },
  '/style.css': { file: 'style.css', type: 'text/css; charset=utf-8', isIndex: false }
}

const TOKEN_PLACEHOLDER = '__SESSION_TOKEN__'

const SECURITY_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; " +
    "base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'"
}

// 라우트별 허용 요청 키 (그 외 키가 있으면 400)
const ROUTES = {
  '/api/check': { method: 'POST', keys: ['vendorId'] },
  '/api/seller/products': { method: 'POST', keys: ['vendorId', 'nextToken', 'maxPerPage'] },
  '/api/seller/product-items': { method: 'POST', keys: ['vendorId', 'sellerProductId'] },
  '/api/seller/inventory': { method: 'POST', keys: ['vendorId', 'vendorItemIds'] },
  '/api/rg/inventory': { method: 'POST', keys: ['vendorId', 'vendorItemId', 'nextToken'] },
  '/api/unlock': { method: 'POST', keys: [] },
  '/api/status': { method: 'GET', keys: [] }
}

// 시험용 가짜 키 파일을 둘 수 있는 위치인지 (경로 문자열만 비교하며 파일은 열지 않는다)
function isTestKeyLocation(resolvedPath) {
  const roots = [path.join(__dirname, 'test', 'fixtures'), os.tmpdir()]
  const fold = (p) => (process.platform === 'win32' ? p.toLowerCase() : p)
  const target = fold(path.resolve(resolvedPath))
  return roots.some((root) => {
    const base = fold(path.resolve(root))
    return target.startsWith(base.endsWith(path.sep) ? base : base + path.sep)
  })
}

function createApp(options) {
  const opts = options || {}
  const clock = opts.clock || { now: () => Date.now() }
  const sleep = opts.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  const logger = opts.logger || ((line) => process.stdout.write(line + '\n'))
  const publicDir = opts.publicDir || path.join(__dirname, 'public')
  const requestedPort = opts.port === undefined ? DEFAULT_PORT : opts.port

  // 시험용 주소 검증을 가장 먼저 한다 (잘못된 값이면 키 파일도 읽지 않고 거부)
  resolveTarget(opts.baseUrl)

  // M1: 시험용 주소(baseUrl)는 이 함수 인자로만 받고, 가짜 키 파일과 함께일 때만 허용한다.
  // 기본(실제) 키 파일 경로와 주소 오버라이드가 동시에 켜지는 조합은 구조적으로 불가능하다.
  //  1) 오버라이드가 있으면 keyFile 을 반드시 직접 지정해야 한다 (기본 경로로 대체되지 않음)
  //  2) keyFile 은 test/fixtures 또는 OS 임시 폴더 아래여야 한다 (파일을 열기 전에 경로만으로 판단)
  //  3) 읽은 Access Key 가 FAKE 로 시작해야 한다 (실제 키가 허용 폴더에 복사돼 있어도 거부)
  const testOverride = opts.baseUrl !== undefined && opts.baseUrl !== null && opts.baseUrl !== ''
  let keyFile
  if (testOverride) {
    if (!opts.keyFile) {
      throw new StartupError('시험용 쿠팡 주소는 시험용 가짜 키 파일을 직접 지정할 때만 쓸 수 있습니다.')
    }
    keyFile = path.resolve(opts.keyFile)
    if (!isTestKeyLocation(keyFile)) {
      throw new StartupError('시험용 쿠팡 주소는 test/fixtures 또는 임시 폴더의 가짜 키 파일만 쓸 수 있습니다.')
    }
  } else {
    keyFile = opts.keyFile || path.resolve(__dirname, '..', '..', 'env', 'api.txt')
  }

  const masker = createMasker()
  const mask = masker.mask
  let keyState = loadKeyFile(keyFile, masker.addSecret, { requireFakeKey: testOverride })
  if (!keyState.loaded && keyState.errorCode === 'KEY_NOT_FAKE') {
    throw new StartupError('시험용 쿠팡 주소에는 FAKE 로 시작하는 가짜 키만 쓸 수 있습니다.')
  }
  const guard = createGuard({ clock, sleep })
  let client = null
  if (keyState.loaded) {
    client = createClient({
      signer: keyState.signer,
      baseUrl: opts.baseUrl,
      clock,
      timeoutMs: opts.timeoutMs,
      maxBytes: opts.maxBytes,
      mask,
      hasSecretFragment: masker.hasSecretFragment,
      onSignature: masker.addRecent
    })
  }
  const sessionToken = crypto.randomBytes(32).toString('base64url')
  const sessionDigest = crypto.createHash('sha256').update(sessionToken).digest()
  let closing = false
  let port = null

  // 로그는 mask 를 거쳐 한 줄씩만 낸다
  function emit(line) {
    logger(mask(line))
  }

  function logCall(call) {
    const status = call.status === null ? '-' : call.status
    emit(call.at + ' GET ' + call.name + ' ' + status + ' ' + call.ms + 'ms')
  }

  // ---- 응답: 모든 응답은 respond() 한 곳을 지난다 ----

  function respond(res, status, contentType, text, extra) {
    const body = Buffer.from(text, 'utf8')
    const headers = Object.assign({}, SECURITY_HEADERS, {
      'Content-Type': contentType,
      'Content-Length': body.length
    })
    if (extra && extra.close) {
      headers.Connection = 'close'
    }
    if (status === 405) {
      headers.Allow = 'GET, POST'
    }
    res.writeHead(status, headers)
    res.end(body, () => {
      if (extra && extra.close && res.req && res.req.socket) {
        res.req.socket.destroy()
      }
    })
  }

  function sendJson(res, status, payload, extra) {
    let text
    try {
      // 값(문자열) 단위로 마스킹한 뒤, 직렬화 결과에 한 번 더 적용하고 JSON 유효성을 확인한다
      text = mask(JSON.stringify(masker.maskDeep(payload)))
      JSON.parse(text)
    } catch (err) {
      const fallback = describe('INTERNAL')
      text = JSON.stringify({
        ok: false,
        error: { code: 'INTERNAL', message: fallback.message, hint: fallback.hint },
        calls: [],
        lock: guard.getLock()
      })
      status = 500
    }
    respond(res, status, 'application/json; charset=utf-8', text, extra)
  }

  function errorBody(code, vars, extra) {
    const info = describe(code, vars)
    const error = { code, message: info.message, hint: info.hint }
    if (vars && vars.field) {
      error.field = vars.field
    }
    if (extra && typeof extra.upstreamStatus === 'number') {
      error.upstreamStatus = extra.upstreamStatus
    }
    if (extra && typeof extra.upstreamMessage === 'string') {
      error.upstreamMessage = extra.upstreamMessage
    }
    return { status: info.status, error }
  }

  function sendError(res, code, vars, calls, extra) {
    const built = errorBody(code, vars, extra)
    sendJson(res, built.status, { ok: false, error: built.error, calls: calls || [], lock: guard.getLock() })
  }

  function sendOk(res, data, calls) {
    sendJson(res, 200, { ok: true, data, calls: calls || [], lock: guard.getLock() })
  }

  // ---- 보안 검사 ----

  function allowedHosts() {
    return ['127.0.0.1:' + port, 'localhost:' + port]
  }

  function hostOk(req) {
    const host = req.headers.host
    return typeof host === 'string' && allowedHosts().includes(host.toLowerCase())
  }

  function originOk(req) {
    const origin = req.headers.origin
    return (
      typeof origin === 'string' &&
      (origin === 'http://127.0.0.1:' + port || origin.toLowerCase() === 'http://localhost:' + port)
    )
  }

  // 브라우저가 알려 주는 요청 출처 관계. 교차 출처(cross-site)·같은 사이트 다른 출처(same-site)는 거부.
  // 헤더가 없는 요청(curl 등)은 이 검사로 막을 수 없다(같은 PC 프로세스는 범위 밖, 설계 9장).
  function fetchSiteOk(req) {
    const site = req.headers['sec-fetch-site']
    return site === undefined || site === 'same-origin' || site === 'none'
  }

  // Origin 헤더가 있으면 허용 출처여야 하고 Sec-Fetch-Site 도 교차 출처가 아니어야 한다 (토큰 노출 방지)
  function crossOriginRejected(req) {
    if (req.headers.origin !== undefined && !originOk(req)) {
      return true
    }
    return !fetchSiteOk(req)
  }

  function tokenOk(req) {
    const given = req.headers['x-session-token']
    if (typeof given !== 'string' || given === '') {
      return false
    }
    // 길이가 달라도 같은 시간이 걸리도록 해시끼리 비교한다
    const digest = crypto.createHash('sha256').update(given).digest()
    return crypto.timingSafeEqual(digest, sessionDigest)
  }

  function contentTypeOk(req) {
    const value = req.headers['content-type']
    if (typeof value !== 'string') {
      return false
    }
    return value.split(';')[0].trim().toLowerCase() === 'application/json'
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const declared = Number(req.headers['content-length'])
      if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
        reject(new AppError('BODY_TOO_LARGE'))
        return
      }
      const chunks = []
      let size = 0
      let done = false
      req.on('data', (chunk) => {
        if (done) {
          return
        }
        size += chunk.length
        if (size > MAX_BODY_BYTES) {
          done = true
          reject(new AppError('BODY_TOO_LARGE'))
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => {
        if (!done) {
          done = true
          resolve(Buffer.concat(chunks).toString('utf8'))
        }
      })
      req.on('error', () => {
        if (!done) {
          done = true
          reject(new AppError('INVALID_INPUT', { field: 'body' }))
        }
      })
    })
  }

  function parseJsonObject(text, allowedKeys) {
    let value
    try {
      value = JSON.parse(text === '' ? '{}' : text)
    } catch (err) {
      throw new AppError('INVALID_INPUT', { field: 'body' })
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new AppError('INVALID_INPUT', { field: 'body' })
    }
    for (const key of Object.keys(value)) {
      if (!allowedKeys.includes(key)) {
        throw new AppError('INVALID_INPUT', { field: 'body' })
      }
    }
    return value
  }

  // ---- 업무 로직 ----

  function requireKey() {
    if (!keyState.loaded) {
      throw new AppError(keyState.errorCode, { line: keyState.line })
    }
  }

  // 요청 → vendorId. 요청 값 우선, 없으면 키 파일 값
  function resolveVendorId(body) {
    let given = body.vendorId
    if (typeof given === 'string' && given.trim() === '') {
      given = undefined
    }
    if (given === undefined || given === null) {
      if (keyState.loaded && keyState.vendorIdFromFile) {
        return keyState.vendorIdFromFile
      }
      throw new AppError('VENDOR_ID_REQUIRED')
    }
    return allowlist.validateVendorId(typeof given === 'string' ? given.trim() : given)
  }

  // 쿠팡 호출 1회: 간격 확보 → 호출 → 결과 반영. 호출 기록은 calls 에 쌓는다.
  async function guardedCall(name, params, vendorId, calls) {
    await guard.beforeCall(vendorId, { rg: name === 'rg.inventory' })
    const result = await client.call(name, params)
    calls.push(result.call)
    logCall(result.call)
    guard.afterCall(result)
    return result
  }

  // 단일 호출 실패 → 오류 응답
  function upstreamFailure(res, result, calls) {
    sendError(res, result.errorCode, {}, calls, {
      upstreamStatus: result.status,
      upstreamMessage: result.upstreamMessage
    })
  }

  async function handleSingle(res, body, name, buildParams, shape) {
    requireKey()
    const vendorId = resolveVendorId(body)
    const params = buildParams(vendorId)
    allowlist.buildRequest(name, params) // 입력 검증만 먼저 (쿠팡 호출 없음)
    const release = guard.enterJob()
    const calls = []
    try {
      const result = await guardedCall(name, params, vendorId, calls)
      if (!result.ok) {
        upstreamFailure(res, result, calls)
        return
      }
      sendOk(res, shape(result.data), calls)
    } finally {
      release()
    }
  }

  async function handleInventory(res, body) {
    requireKey()
    const vendorId = resolveVendorId(body)
    const rawIds = body.vendorItemIds
    if (!Array.isArray(rawIds) || rawIds.length < 1) {
      throw new AppError('INVALID_INPUT', { field: 'vendorItemIds' })
    }
    if (rawIds.length > MAX_BATCH) {
      throw new AppError('BATCH_LIMIT')
    }
    const ids = []
    for (const raw of rawIds) {
      let id
      try {
        id = allowlist.validateNumericId(raw, 'vendorItemIds')
      } catch (err) {
        throw new AppError('INVALID_INPUT', { field: 'vendorItemIds' })
      }
      if (!ids.includes(id)) {
        ids.push(id)
      }
    }
    for (const id of ids) {
      allowlist.buildRequest('seller.inventory', { vendorId, vendorItemId: id })
    }

    const release = guard.enterJob()
    const calls = []
    const results = []
    try {
      let stopped = false
      for (let i = 0; i < ids.length; i += 1) {
        const id = ids[i]
        if (stopped) {
          results.push({ vendorItemId: id, status: 'not_run', amountInStock: null, onSale: null })
          continue
        }
        let result
        try {
          result = await guardedCall('seller.inventory', { vendorId, vendorItemId: id }, vendorId, calls)
        } catch (err) {
          // 첫 호출 전에 막히면 전체 오류, 중간이면 남은 항목은 미실행
          if (i === 0 || !(err instanceof AppError)) {
            throw err
          }
          stopped = true
          results.push({ vendorItemId: id, status: 'not_run', amountInStock: null, onSale: null })
          continue
        }
        if (!result.ok) {
          results.push({
            vendorItemId: id,
            status: 'failed',
            amountInStock: null,
            onSale: null,
            errorCode: result.errorCode
          })
        } else if (result.data.amountInStock === null) {
          // 수량 타입 불일치: 0 으로 보이지 않게 null + 실패 표시
          results.push({
            vendorItemId: id,
            status: 'failed',
            amountInStock: null,
            onSale: result.data.onSale,
            errorCode: 'RESPONSE_PARSE'
          })
        } else {
          results.push({
            vendorItemId: id,
            status: 'ok',
            amountInStock: result.data.amountInStock,
            onSale: result.data.onSale
          })
        }
        if (guard.getLock().state !== 'none') {
          stopped = true
        }
      }
      sendOk(res, { results }, calls)
    } finally {
      release()
    }
  }

  async function handleApi(req, res, pathname) {
    const route = ROUTES[pathname]
    const text = route.method === 'POST' ? await readBody(req) : ''
    const body = parseJsonObject(text, route.keys)

    if (pathname === '/api/unlock') {
      sendOk(res, { lock: guard.unlock() }, [])
      return
    }
    if (pathname === '/api/check') {
      await handleSingle(
        res,
        body,
        'seller.products',
        (vendorId) => ({ vendorId, maxPerPage: 1 }),
        (data) => ({ connected: true, productCountSample: data.items.length > 0 ? 1 : 0 })
      )
      return
    }
    if (pathname === '/api/seller/products') {
      await handleSingle(
        res,
        body,
        'seller.products',
        (vendorId) => {
          const params = { vendorId }
          if (body.nextToken !== undefined && body.nextToken !== null && body.nextToken !== '') {
            params.nextToken = body.nextToken
          }
          if (body.maxPerPage !== undefined && body.maxPerPage !== null) {
            params.maxPerPage = body.maxPerPage
          }
          return params
        },
        (data) => ({ items: data.items, nextToken: data.nextToken })
      )
      return
    }
    if (pathname === '/api/seller/product-items') {
      await handleSingle(
        res,
        body,
        'seller.product',
        (vendorId) => ({ vendorId, sellerProductId: body.sellerProductId }),
        (data) => data
      )
      return
    }
    if (pathname === '/api/seller/inventory') {
      await handleInventory(res, body)
      return
    }
    if (pathname === '/api/rg/inventory') {
      await handleSingle(
        res,
        body,
        'rg.inventory',
        (vendorId) => {
          const params = { vendorId }
          if (body.vendorItemId !== undefined && body.vendorItemId !== null && body.vendorItemId !== '') {
            params.vendorItemId = body.vendorItemId
          }
          if (body.nextToken !== undefined && body.nextToken !== null && body.nextToken !== '') {
            params.nextToken = body.nextToken
          }
          return params
        },
        (data) => ({ items: data.items, nextToken: data.nextToken })
      )
      return
    }
    throw new AppError('NOT_FOUND')
  }

  function handleStatus(res) {
    const data = {
      keyLoaded: keyState.loaded,
      keyError: keyState.loaded ? null : { code: keyState.errorCode, line: keyState.line },
      vendorIdFromFile: keyState.loaded && Boolean(keyState.vendorIdFromFile),
      vendorId: keyState.loaded && keyState.vendorIdFromFile ? keyState.vendorIdFromFile : null,
      lock: guard.getLock()
    }
    sendOk(res, data, [])
  }

  function serveStatic(res, entry) {
    fs.readFile(path.join(publicDir, entry.file), 'utf8', (err, content) => {
      if (err) {
        sendError(res, 'NOT_FOUND', {}, [])
        return
      }
      let text = mask(content)
      if (entry.isIndex) {
        // 세션 토큰은 마스킹 이후에 주입한다 (HTML 주입 외에는 어디에도 나가지 않음)
        text = text.split(TOKEN_PLACEHOLDER).join(sessionToken)
      }
      respond(res, 200, entry.type, text)
    })
  }

  async function onRequest(req, res) {
    try {
      if (closing) {
        sendError(res, 'FORBIDDEN_REQUEST', {}, [])
        return
      }
      if (!hostOk(req)) {
        sendError(res, 'FORBIDDEN_REQUEST', {}, [])
        return
      }
      if (req.method !== 'GET' && req.method !== 'POST') {
        sendError(res, 'METHOD_NOT_ALLOWED', {}, [])
        return
      }
      const raw = typeof req.url === 'string' ? req.url : ''
      const q = raw.indexOf('?')
      const pathname = q === -1 ? raw : raw.slice(0, q)

      if (pathname.startsWith('/api/')) {
        const route = ROUTES[pathname]
        // 인증 정보 없는 요청에는 경로 존재 여부도 알려 주지 않는다
        if (req.method === 'POST' || req.headers.origin !== undefined) {
          if (!originOk(req)) {
            sendError(res, 'FORBIDDEN_REQUEST', {}, [])
            return
          }
        }
        if (!fetchSiteOk(req)) {
          sendError(res, 'FORBIDDEN_REQUEST', {}, [])
          return
        }
        if (!tokenOk(req)) {
          sendError(res, 'FORBIDDEN_REQUEST', {}, [])
          return
        }
        if (!route) {
          sendError(res, 'NOT_FOUND', {}, [])
          return
        }
        if (route.method !== req.method) {
          sendError(res, 'METHOD_NOT_ALLOWED', {}, [])
          return
        }
        if (req.method === 'POST' && !contentTypeOk(req)) {
          sendError(res, 'UNSUPPORTED_MEDIA_TYPE', {}, [])
          return
        }
        if (pathname === '/api/status') {
          handleStatus(res)
          return
        }
        await handleApi(req, res, pathname)
        return
      }

      // L3: 교차 출처 요청에는 세션 토큰이 들어 있는 GET / 를 포함해 정적 파일도 주지 않는다
      if (crossOriginRejected(req)) {
        sendError(res, 'FORBIDDEN_REQUEST', {}, [])
        return
      }
      const entry = Object.prototype.hasOwnProperty.call(STATIC_FILES, pathname) ? STATIC_FILES[pathname] : null
      if (req.method === 'GET' && entry) {
        serveStatic(res, entry)
        return
      }
      if (req.method !== 'GET') {
        sendError(res, 'METHOD_NOT_ALLOWED', {}, [])
        return
      }
      sendError(res, 'NOT_FOUND', {}, [])
    } catch (err) {
      if (res.headersSent) {
        return
      }
      if (err instanceof AppError) {
        const vars = { line: err.line, field: err.field, seconds: err.seconds, reasonCode: err.reasonCode }
        if (err.code === 'BODY_TOO_LARGE') {
          const built = errorBody(err.code, vars)
          sendJson(res, built.status, { ok: false, error: built.error, calls: [], lock: guard.getLock() }, { close: true })
          return
        }
        sendError(res, err.code, vars, [])
        return
      }
      sendError(res, 'INTERNAL', {}, [])
    }
  }

  const server = http.createServer((req, res) => {
    onRequest(req, res)
  })
  server.requestTimeout = 15000
  server.headersTimeout = 10000
  server.on('clientError', (err, socket) => {
    socket.destroy()
  })

  function listen() {
    return new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(requestedPort, BIND_HOST, () => {
        port = server.address().port
        resolve({ port, url: 'http://127.0.0.1:' + port })
      })
    })
  }

  function close() {
    closing = true
    if (client) {
      client.abortAll()
    }
    return new Promise((resolve) => {
      server.close(() => {
        // 서명기·마스킹 목록 참조 해제 (JS 문자열은 프로세스 종료로 소멸)
        client = null
        keyState = { loaded: false, errorCode: 'KEY_FILE_MISSING', line: null }
        masker.clear()
        resolve()
      })
      if (typeof server.closeAllConnections === 'function') {
        server.closeAllConnections()
      }
    })
  }

  function keyStatusText() {
    if (keyState.loaded) {
      return '로드됨'
    }
    if (keyState.errorCode === 'KEY_FILE_FORMAT') {
      return '형식 오류(' + keyState.line + '번째 줄)'
    }
    return '없음'
  }

  // 실제 리스닝 주소 (시험에서 127.0.0.1 바인딩 확인용)
  function getAddress() {
    const addr = server.address()
    return addr && typeof addr === 'object' ? { address: addr.address, family: addr.family, port: addr.port } : null
  }

  return { listen, close, emit, mask, keyStatusText, getPort: () => port, getAddress }
}

// ---- 실행 진입점 ----

function parsePortArg(argv) {
  const index = argv.indexOf('--port')
  if (index === -1) {
    return DEFAULT_PORT
  }
  const value = Number(argv[index + 1])
  if (!Number.isInteger(value) || value < 1024 || value > 65535) {
    throw new StartupError('--port 값은 1024~65535 사이 정수여야 합니다.')
  }
  return value
}

// 시작 실패 한 줄. 고정 문구(StartupError)만 내보내고, 그마저도 마스킹 패턴을 한 번 거친다 (L7).
function formatStartupFailure(err) {
  const text = err instanceof StartupError ? err.message : '알 수 없는 오류'
  return '시작하지 못했습니다: ' + createMasker().mask(text)
}

// 서버 시작 공통 경로. main() 과 시험 전용 진입 스크립트(test/serve-for-test.cjs)가 함께 쓴다.
// options: { port, keyFile, baseUrl, env, logger, installHandlers, exitProcess }
//  - baseUrl 은 시험 진입 스크립트에서만 넘어온다 (CLI·환경 변수 경로 없음, M1)
//  - env 는 환경 점검 대상 객체 (L2). 운영 모드(baseUrl 없음)에서 위험한 환경이면 시작을 거부한다
async function startServer(options) {
  const opts = options || {}
  const testOverride = Boolean(opts.baseUrl)
  const report = inspectEnvironment(opts.env || {})
  if (report.removed.length > 0) {
    throw new StartupError(
      '더 이상 지원하지 않는 환경 변수가 설정돼 있습니다(' + report.removed.join(', ') + '). 지우고 새 터미널에서 다시 실행하세요.'
    )
  }
  if (report.dangerous.length > 0 && !testOverride) {
    throw new StartupError(
      '쿠팡으로 보내는 요청이 중간에서 노출될 수 있는 실행 환경입니다(' +
        report.dangerous.join(', ') +
        '). 해당 환경 변수를 지우고 새 터미널에서 다시 실행하세요.'
    )
  }

  const app = createApp({
    port: opts.port,
    keyFile: opts.keyFile,
    baseUrl: opts.baseUrl,
    logger: opts.logger
  })
  let info
  try {
    info = await app.listen()
  } catch (err) {
    throw new StartupError('서버를 시작하지 못했습니다. 포트가 이미 사용 중일 수 있습니다.')
  }
  app.emit('쿠팡 재고 조회 로컬 테스트 서버 (조회 전용)')
  app.emit('주소: ' + info.url)
  app.emit('키 파일: ' + app.keyStatusText())
  if (testOverride) {
    app.emit('시험용 주소 사용 중: 실제 쿠팡으로 호출하지 않습니다.')
    if (report.dangerous.length > 0) {
      app.emit('경고: 안전하지 않은 환경 변수가 있습니다(' + report.dangerous.join(', ') + ').')
    }
  }

  // 종료 처리: 새 요청 거부 → 진행 중 쿠팡 요청 중단 → 서버 닫기 → 키 참조 해제.
  // 신호 핸들러와 시험이 같은 함수를 쓴다.
  let shuttingDown = false
  async function shutdown() {
    if (shuttingDown) {
      return
    }
    shuttingDown = true
    await app.close()
    app.emit('종료 처리 완료')
    if (opts.exitProcess !== false) {
      process.exit(0)
    }
  }
  if (opts.installHandlers !== false) {
    // Windows 에서는 Ctrl+C(SIGINT)만 실제로 전달된다. 자식 프로세스 kill() 은 이 핸들러를 거치지 않는다.
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
    process.on('uncaughtException', (err) => {
      app.emit('내부 오류로 종료합니다: ' + (err && err.name ? err.name : 'Error'))
      process.exit(1)
    })
    process.on('unhandledRejection', () => {
      app.emit('내부 오류로 종료합니다: unhandledRejection')
      process.exit(1)
    })
  }
  return { app, info, shutdown }
}

async function main() {
  try {
    // 운영 진입점: 호스트는 쿠팡 고정값이며 환경 변수·CLI 어느 것으로도 바꿀 수 없다.
    await startServer({
      port: parsePortArg(process.argv.slice(2)),
      keyFile: process.env.STOCKD_ENV_FILE ? path.resolve(process.env.STOCKD_ENV_FILE) : undefined,
      env: process.env
    })
  } catch (err) {
    process.stderr.write(formatStartupFailure(err) + '\n')
    process.exit(1)
  }
}

if (require.main === module) {
  main()
}

module.exports = { createApp, startServer, formatStartupFailure }
