'use strict'

// 쿠팡 재고 조회 로컬 테스트 서버 시험.
// 실행: node tools/coupang-inventory-test/test/run-tests.cjs
// 가짜 키 파일(test/fixtures/fake-api.txt)과 로컬 가짜 쿠팡 서버(stub)만 사용한다.
// 실제 키 파일(env/api.txt)은 열지 않고, 실제 쿠팡도 호출하지 않는다.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const http = require('node:http')
const net = require('node:net')
const util = require('node:util')
const { spawn } = require('node:child_process')

const ROOT = path.resolve(__dirname, '..')
const { createApp, startServer } = require(path.join(ROOT, 'server.cjs'))
const { createStub } = require('./fake-coupang-stub.cjs')
const envLoader = require(path.join(ROOT, 'lib', 'env-loader.cjs'))
const allowlist = require(path.join(ROOT, 'lib', 'allowlist.cjs'))
const { createClient, resolveTarget } = require(path.join(ROOT, 'lib', 'coupang-client.cjs'))
const { createMasker, cleanUpstreamMessage, GENERIC_UPSTREAM_MESSAGE } = require(path.join(ROOT, 'lib', 'sanitize.cjs'))
const { createGuard } = require(path.join(ROOT, 'lib', 'guard.cjs'))
const { inspectEnvironment } = require(path.join(ROOT, 'lib', 'env-guard.cjs'))
const { AppError, describe } = require(path.join(ROOT, 'lib', 'errors.cjs'))

const FAKE_FILE = path.join(__dirname, 'fixtures', 'fake-api.txt')
const fakeText = fs.readFileSync(FAKE_FILE, 'utf8')
const FAKE_ACCESS = /Access Key:\s*(\S+)/.exec(fakeText)[1]
const FAKE_SECRET = /Secret Key:\s*(\S+)/.exec(fakeText)[1]
const VENDOR = 'A0001234'
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'stockd-test-'))

// 유출 검사 대상 수집 (응답 본문·헤더·로그). kind: body | header | log
const collected = []
const stubSecrets = new Set()

function record(kind, text) {
  collected.push({ kind, text: String(text) })
}

// ---- 간단한 시험 실행기 ----
const tests = []
function T(id, name, fn) {
  tests.push({ id, name, fn })
}

// ---- 도우미 ----

function makeClock(startMs) {
  let t = startMs
  return {
    now: () => t,
    advance(ms) {
      t += ms
    },
    sleep: async (ms) => {
      t += ms
    }
  }
}

function rawRequest(opts) {
  return new Promise((resolve, reject) => {
    let finished = false
    const req = http.request(
      {
        host: '127.0.0.1',
        port: opts.port,
        method: opts.method || 'GET',
        path: opts.path || '/',
        headers: opts.headers || {},
        setHost: opts.setHost !== false,
        agent: false
      },
      (res) => {
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        const done = () => {
          if (finished) {
            return
          }
          finished = true
          const text = Buffer.concat(chunks).toString('utf8')
          const headerLines = []
          for (let i = 0; i < res.rawHeaders.length; i += 2) {
            headerLines.push(res.rawHeaders[i] + ': ' + res.rawHeaders[i + 1])
          }
          record('body', text)
          record('header', headerLines.join('\n'))
          let json = null
          try {
            json = JSON.parse(text)
          } catch (err) {
            json = null
          }
          resolve({ status: res.statusCode, headers: res.headers, headerLines, text, json })
        }
        res.on('end', done)
        res.on('close', done)
      }
    )
    req.on('error', (err) => {
      if (!finished) {
        finished = true
        reject(err)
      }
    })
    if (opts.chunks) {
      for (const c of opts.chunks) {
        req.write(c)
      }
    } else if (opts.body !== undefined) {
      req.write(opts.body)
    }
    req.end()
  })
}

async function withEnv(options, fn) {
  const opts = options || {}
  const clock = opts.clock || makeClock(Date.UTC(2026, 9, 12, 0, 0, 0))
  const stub = createStub({ fakeAccess: FAKE_ACCESS, fakeSecret: FAKE_SECRET, now: clock.now })
  const baseUrl = await stub.start()
  const publicDir = fs.mkdtempSync(path.join(TMP, 'public-'))
  fs.writeFileSync(
    path.join(publicDir, 'index.html'),
    '<!doctype html><html><head><meta name="session-token" content="__SESSION_TOKEN__"></head><body>시험</body></html>'
  )
  fs.writeFileSync(path.join(publicDir, 'app.js'), 'void 0\n')
  fs.writeFileSync(path.join(publicDir, 'style.css'), 'body{}\n')
  const lines = []
  const app = createApp({
    port: 0,
    keyFile: opts.keyFile || FAKE_FILE,
    baseUrl,
    clock,
    sleep: clock.sleep,
    timeoutMs: opts.timeoutMs,
    publicDir,
    logger: (line) => {
      lines.push(line)
      record('log', line)
    }
  })
  const info = await app.listen()
  const env = { app, stub, clock, port: info.port, lines, token: null, publicDir }

  env.request = (o) => rawRequest(Object.assign({ port: env.port }, o))

  // GET / 로 세션 토큰 확보
  const home = await env.request({ path: '/', headers: { Host: '127.0.0.1:' + env.port } })
  const m = /name="session-token" content="([^"]+)"/.exec(home.text)
  env.token = m ? m[1] : null
  env.home = home

  env.api = (pathname, body, over) => {
    const o = over || {}
    const text = o.rawBody !== undefined ? o.rawBody : JSON.stringify(body === undefined ? {} : body)
    const headers = {}
    if (o.host !== null) headers.Host = o.host || '127.0.0.1:' + env.port
    if (o.origin !== null) headers.Origin = o.origin || 'http://127.0.0.1:' + env.port
    if (o.contentType !== null) headers['Content-Type'] = o.contentType || 'application/json'
    if (o.token !== null) headers['X-Session-Token'] = o.token || env.token
    if (!o.chunks) headers['Content-Length'] = Buffer.byteLength(text)
    Object.assign(headers, o.headers || {})
    return env.request({
      method: o.method || 'POST',
      path: pathname,
      headers,
      body: text,
      chunks: o.chunks,
      setHost: o.host !== null
    })
  }
  env.get = (pathname, over) => {
    const o = over || {}
    const headers = {}
    if (o.host !== null) headers.Host = o.host || '127.0.0.1:' + env.port
    if (o.token !== null) headers['X-Session-Token'] = o.token || env.token
    if (o.origin) headers.Origin = o.origin
    return env.request({ method: o.method || 'GET', path: pathname, headers, setHost: o.host !== null })
  }
  env.stubSecrets = () => stub.state.seenSecrets.forEach((s) => stubSecrets.add(s))

  try {
    await fn(env)
  } finally {
    env.stubSecrets()
    await app.close()
    await stub.stop()
  }
}

function tmpFile(name, content) {
  const p = path.join(TMP, name)
  fs.writeFileSync(p, content)
  return p
}

function fakeFileWith(lines, eol) {
  return lines.join(eol || '\n')
}

async function expectThrows(fn, code) {
  let err = null
  try {
    await fn()
  } catch (e) {
    err = e
  }
  assert.ok(err, '예외가 발생해야 합니다')
  if (code) {
    assert.equal(err.code, code)
  }
  return err
}

// ======================= 서명 =======================

T('T-SIG-1', '고정 입력 서명이 미리 계산한 소문자 hex 와 일치', () => {
  const signer = envLoader.createSigner(FAKE_ACCESS, FAKE_SECRET)
  const date = new Date(Date.UTC(2026, 9, 12, 1, 2, 3))
  const a = signer.authorize(
    'GET',
    '/v2/providers/seller_api/apis/api/v1/marketplace/seller-products',
    'vendorId=A0001234&maxPerPage=1',
    date
  )
  assert.equal(a.signature, '68e12e354512f5f0176ba9e614e82b5ac19fa51ab789ea638972b50e864e9de2')
  const b = signer.authorize(
    'GET',
    '/v2/providers/seller_api/apis/api/v1/marketplace/vendor-items/90000001/inventories',
    '',
    date
  )
  assert.equal(b.signature, '1c12e4ee16447eba4d17ced95c7f2c8682413bcf6468a2b3568e99ba1619c744')
  assert.match(a.signature, /^[0-9a-f]{64}$/)
})

T('T-SIG-2', 'signed-date 는 UTC yyMMddTHHmmssZ', () => {
  assert.equal(envLoader.formatSignedDate(new Date(Date.UTC(2026, 0, 2, 3, 4, 5))), '260102T030405Z')
  assert.equal(envLoader.formatSignedDate(new Date(Date.UTC(2018, 7, 9, 12, 0, 0))), '180809T120000Z')
  assert.equal(envLoader.formatSignedDate(new Date(Date.UTC(2099, 11, 31, 23, 59, 59))), '991231T235959Z')
})

T('T-SIG-3', '쿼리 있는 호출을 stub 이 서명 검증으로 통과시킴 (서명 쿼리 = 전송 쿼리)', async () => {
  await withEnv({}, async (env) => {
    const r = await env.api('/api/seller/products', { vendorId: VENDOR, nextToken: 'abc.DEF_1~2-x', maxPerPage: 5 })
    assert.equal(r.status, 200)
    assert.equal(r.json.ok, true)
    const req = env.stub.state.requests[0]
    assert.equal(req.sigOk, true)
    assert.equal(req.query, 'vendorId=A0001234&nextToken=abc.DEF_1~2-x&maxPerPage=5')
    assert.equal(req.method, 'GET')
    assert.equal(req.vendorHeader, VENDOR)
  })
})

T('T-SIG-4', 'Authorization 헤더 형식(stub 에서만 확인)과 모든 호출의 서명 일치', async () => {
  await withEnv({}, async (env) => {
    await env.api('/api/check', { vendorId: VENDOR })
    await env.api('/api/seller/product-items', { vendorId: VENDOR, sellerProductId: '11111' })
    await env.api('/api/seller/inventory', { vendorId: VENDOR, vendorItemIds: ['90000001'] })
    await env.api('/api/rg/inventory', { vendorId: VENDOR })
    assert.equal(env.stub.count(), 4)
    for (const r of env.stub.state.requests) {
      assert.equal(r.formatOk, true)
      assert.equal(r.sigOk, true)
      assert.equal(r.method, 'GET')
    }
  })
})

// ======================= 키 파일 =======================

T('T-ENV-1', '정상 파일 변형(CRLF·BOM·공백·콜론 뒤 공백·대소문자)이 모두 로드됨', () => {
  const reference = envLoader
    .createSigner(FAKE_ACCESS, FAKE_SECRET)
    .authorize('GET', '/p', 'q=1', new Date(Date.UTC(2026, 9, 12, 1, 2, 3))).signature
  const variants = {
    basic: fakeFileWith(['coupang', 'Access Key: ' + FAKE_ACCESS, 'Secret Key: ' + FAKE_SECRET]),
    crlf: fakeFileWith(['coupang', 'Access Key: ' + FAKE_ACCESS, 'Secret Key: ' + FAKE_SECRET], '\r\n'),
    bom: '\uFEFF' + fakeFileWith(['coupang', 'Access Key: ' + FAKE_ACCESS, 'Secret Key: ' + FAKE_SECRET]),
    padded: fakeFileWith(['  coupang  ', '   Access Key:   ' + FAKE_ACCESS + '   ', '\tSecret Key:\t' + FAKE_SECRET + '  ']),
    nospace: fakeFileWith(['coupang', 'Access Key:' + FAKE_ACCESS, 'Secret Key:' + FAKE_SECRET]),
    manyspace: fakeFileWith(['coupang', 'Access Key:      ' + FAKE_ACCESS, 'Secret Key:          ' + FAKE_SECRET]),
    case: fakeFileWith(['COUPANG', 'access key: ' + FAKE_ACCESS, 'SECRET KEY : ' + FAKE_SECRET]),
    trailing: fakeFileWith(['coupang', 'Access Key: ' + FAKE_ACCESS, 'Secret Key: ' + FAKE_SECRET, '', '', '']),
    cr: fakeFileWith(['coupang', 'Access Key: ' + FAKE_ACCESS, 'Secret Key: ' + FAKE_SECRET], '\r')
  }
  for (const [name, content] of Object.entries(variants)) {
    const result = envLoader.loadKeyFile(tmpFile('env1-' + name + '.txt', content))
    assert.equal(result.loaded, true, name)
    const sig = result.signer.authorize('GET', '/p', 'q=1', new Date(Date.UTC(2026, 9, 12, 1, 2, 3))).signature
    assert.equal(sig, reference, name)
  }
})

T('T-ENV-2', '형식 오류 파일은 KEY_FILE_FORMAT + 줄 번호만, 내용 노출 없음', () => {
  const cases = [
    { name: 'missing-line3', content: 'coupang\nAccess Key: ' + FAKE_ACCESS + '\n', line: 3 },
    { name: 'only-title', content: 'coupang\n', line: 2 },
    { name: 'empty', content: '', line: 1 },
    { name: 'typo-label', content: 'coupang\nAcess Key: ' + FAKE_ACCESS + '\nSecret Key: ' + FAKE_SECRET, line: 2 },
    { name: 'swapped', content: 'coupang\nSecret Key: ' + FAKE_SECRET + '\nAccess Key: ' + FAKE_ACCESS, line: 2 },
    { name: 'empty-value', content: 'coupang\nAccess Key: ' + FAKE_ACCESS + '\nSecret Key:   ', line: 3 },
    { name: 'wrong-title', content: 'naver\nAccess Key: ' + FAKE_ACCESS + '\nSecret Key: ' + FAKE_SECRET, line: 1 },
    { name: 'space-in-value', content: 'coupang\nAccess Key: ' + FAKE_ACCESS + ' extra\nSecret Key: ' + FAKE_SECRET, line: 2 },
    {
      name: 'strange-4th',
      content: 'coupang\nAccess Key: ' + FAKE_ACCESS + '\nSecret Key: ' + FAKE_SECRET + '\nsomething odd',
      line: 4
    },
    {
      name: 'strange-5th',
      content: 'coupang\nAccess Key: ' + FAKE_ACCESS + '\nSecret Key: ' + FAKE_SECRET + '\n\nSecret Key: ' + FAKE_SECRET,
      line: 5
    }
  ]
  for (const c of cases) {
    const result = envLoader.loadKeyFile(tmpFile('env2-' + c.name + '.txt', c.content))
    assert.equal(result.loaded, false, c.name)
    assert.equal(result.errorCode, 'KEY_FILE_FORMAT', c.name)
    assert.equal(result.line, c.line, c.name)
    const shown = JSON.stringify(result) + util.inspect(result, { depth: 10 }) + JSON.stringify(describe(result.errorCode, { line: result.line }))
    assert.ok(!shown.includes(FAKE_ACCESS) && !shown.includes(FAKE_SECRET), c.name)
  }
})

T('T-ENV-3', '키 파일 없음: 서버는 뜨고 쿠팡 호출은 거부(503), stub 호출 0', async () => {
  await withEnv({ keyFile: path.join(TMP, 'does-not-exist.txt') }, async (env) => {
    const s = await env.get('/api/status')
    assert.equal(s.status, 200)
    assert.equal(s.json.data.keyLoaded, false)
    assert.deepEqual(s.json.data.keyError, { code: 'KEY_FILE_MISSING', line: null })
    const r = await env.api('/api/check', { vendorId: VENDOR })
    assert.equal(r.status, 503)
    assert.equal(r.json.error.code, 'KEY_FILE_MISSING')
    assert.equal(env.stub.count(), 0)
  })
  const bad = tmpFile('env3-bad.txt', 'coupang\nAccess Key: ' + FAKE_ACCESS + '\n')
  await withEnv({ keyFile: bad }, async (env) => {
    const s = await env.get('/api/status')
    assert.deepEqual(s.json.data.keyError, { code: 'KEY_FILE_FORMAT', line: 3 })
    const r = await env.api('/api/seller/products', { vendorId: VENDOR })
    assert.equal(r.status, 503)
    assert.equal(r.json.error.code, 'KEY_FILE_FORMAT')
    assert.ok(r.json.error.message.includes('3번째 줄'))
    assert.equal(env.stub.count(), 0)
  })
})

T('T-ENV-4', 'Vendor ID 줄: 있으면 자동 사용, 형식이 틀리면 KEY_FILE_FORMAT(그 줄)', async () => {
  const good = tmpFile(
    'env4-good.txt',
    'coupang\nAccess Key: ' + FAKE_ACCESS + '\nSecret Key: ' + FAKE_SECRET + '\nVendor ID: A0009999\n'
  )
  await withEnv({ keyFile: good }, async (env) => {
    const s = await env.get('/api/status')
    assert.equal(s.json.data.vendorIdFromFile, true)
    assert.equal(s.json.data.vendorId, 'A0009999')
    const r = await env.api('/api/check', {})
    assert.equal(r.status, 200)
    assert.equal(env.stub.state.requests[0].vendorHeader, 'A0009999')
    // 요청 값이 있으면 요청 값이 우선
    await env.api('/api/check', { vendorId: 'A0001111' })
    assert.equal(env.stub.state.requests[1].vendorHeader, 'A0001111')
  })
  const badFile = tmpFile(
    'env4-bad.txt',
    'coupang\nAccess Key: ' + FAKE_ACCESS + '\nSecret Key: ' + FAKE_SECRET + '\nVendor ID: not-a-code\n'
  )
  const bad = envLoader.loadKeyFile(badFile)
  assert.equal(bad.loaded, false)
  assert.equal(bad.errorCode, 'KEY_FILE_FORMAT')
  assert.equal(bad.line, 4)
  await withEnv({}, async (env) => {
    const s = await env.get('/api/status')
    assert.equal(s.json.data.vendorIdFromFile, false)
    assert.equal(s.json.data.vendorId, null)
    const r = await env.api('/api/check', {})
    assert.equal(r.status, 400)
    assert.equal(r.json.error.code, 'VENDOR_ID_REQUIRED')
    assert.equal(env.stub.count(), 0)
  })
})

// ======================= 허용 목록 =======================

T('T-ALLOW-1', '허용 외 이름·경로 주입·쿼리 주입·메서드 변경은 전송 전 거부, stub 호출 0', async () => {
  // 라이브러리 수준
  await expectThrows(() => allowlist.buildRequest('seller.product.delete', { vendorId: VENDOR }), 'NOT_ALLOWED')
  await expectThrows(() => allowlist.buildRequest('__proto__', { vendorId: VENDOR }), 'NOT_ALLOWED')
  await expectThrows(() => allowlist.buildRequest('seller.inventory', { vendorId: VENDOR, vendorItemId: '1', method: 'POST' }), 'NOT_ALLOWED')
  await expectThrows(() => allowlist.buildRequest('seller.inventory', { vendorId: VENDOR, vendorItemId: '1', path: '/x' }), 'NOT_ALLOWED')
  await expectThrows(() => allowlist.buildRequest('seller.products', { vendorId: VENDOR, status: 'APPROVED' }), 'NOT_ALLOWED')
  for (const bad of ['../1', '1/2', '1%2F2', '1?x=1', '1#a', '0', '01', '', ' 1', '1 ', 'a', '9'.repeat(21)]) {
    await expectThrows(() => allowlist.buildRequest('seller.inventory', { vendorId: VENDOR, vendorItemId: bad }), 'INVALID_INPUT')
    await expectThrows(() => allowlist.buildRequest('seller.product', { vendorId: VENDOR, sellerProductId: bad }), 'INVALID_INPUT')
  }
  await expectThrows(() => allowlist.buildRequest('rg.inventory', { vendorId: VENDOR, vendorItemId: '1', nextToken: 'a' }), 'INVALID_INPUT')

  // 전송 직전 재검사
  const base = allowlist.buildRequest('seller.inventory', { vendorId: VENDOR, vendorItemId: '90000001' })
  const host = 'api-gateway.coupang.com'
  const ok = { name: 'seller.inventory', method: 'GET', hostname: host, path: base.path, queryString: '' }
  assert.equal(allowlist.verifyRequest(ok, host), true)
  const variants = [
    Object.assign({}, ok, { method: 'POST' }),
    Object.assign({}, ok, { method: 'PUT' }),
    Object.assign({}, ok, { method: 'get' }),
    Object.assign({}, ok, { hostname: 'evil.example' }),
    Object.assign({}, ok, { hostname: host + '.evil.example' }),
    Object.assign({}, ok, { path: '/v2/providers/openapi/apis/api/v5/vendors/A0001234/ordersheets' }),
    Object.assign({}, ok, { path: base.path + '/extra' }),
    Object.assign({}, ok, { path: base.path.replace('inventories', 'inventories/../quantities') }),
    Object.assign({}, ok, { path: base.path.replace('/90000001/', '/90000001%2F..%2F/') }),
    Object.assign({}, ok, { path: '/v2/providers/seller_api/apis/api/v1/marketplace/vendor-items/1/quantities/2' }),
    Object.assign({}, ok, { queryString: 'extra=1' }),
    Object.assign({}, ok, { queryString: 'vendorId=A0001234' }),
    Object.assign({}, ok, { name: 'unknown.name' })
  ]
  for (const v of variants) {
    await expectThrows(() => allowlist.verifyRequest(v, host), 'NOT_ALLOWED')
  }
  const productsPath = allowlist.buildRequest('seller.products', { vendorId: VENDOR }).path
  const pq = { name: 'seller.products', method: 'GET', hostname: host, path: productsPath }
  assert.equal(allowlist.verifyRequest(Object.assign({}, pq, { queryString: 'vendorId=A0001234&maxPerPage=1' }), host), true)
  for (const q of [
    'maxPerPage=1',
    'nextToken=a&vendorId=A0001234',
    'vendorId=A0001234&vendorId=A0001234',
    'vendorId=A0001234&status=APPROVED',
    'vendorId=A0001234&nextToken=a%2Fb',
    'vendorId=A0001234&nextToken=a b',
    'vendorId=A0001234&',
    '?vendorId=A0001234'
  ]) {
    await expectThrows(() => allowlist.verifyRequest(Object.assign({}, pq, { queryString: q }), host), 'NOT_ALLOWED')
  }

  // 클라이언트 수준: 허용 외 호출은 stub 에 도달하지 않음
  const stub = createStub({ fakeAccess: FAKE_ACCESS, fakeSecret: FAKE_SECRET })
  const baseUrl = await stub.start()
  try {
    const loaded = envLoader.loadKeyFile(FAKE_FILE)
    const client = createClient({ signer: loaded.signer, baseUrl, clock: { now: () => Date.now() }, mask: (s) => s })
    await expectThrows(() => client.call('seller.inventory.update', { vendorId: VENDOR }), 'NOT_ALLOWED')
    await expectThrows(() => client.call('seller.inventory', { vendorId: VENDOR, vendorItemId: '1/../2' }), 'INVALID_INPUT')
    await expectThrows(() => client.call('seller.inventory', { vendorId: VENDOR, vendorItemId: '1', method: 'DELETE' }), 'NOT_ALLOWED')
    assert.equal(stub.count(), 0)
    const good = await client.call('seller.inventory', { vendorId: VENDOR, vendorItemId: '90000001' })
    assert.equal(good.ok, true)
    assert.equal(stub.count(), 1)
  } finally {
    await stub.stop()
  }
})

T('T-ALLOW-2', '화면 API 에 path·method·url 등 알 수 없는 키를 넣으면 400', async () => {
  await withEnv({}, async (env) => {
    const attempts = [
      ['/api/check', { vendorId: VENDOR, path: '/v2/x' }],
      ['/api/check', { vendorId: VENDOR, method: 'POST' }],
      ['/api/seller/products', { vendorId: VENDOR, url: 'http://evil.example' }],
      ['/api/seller/product-items', { vendorId: VENDOR, sellerProductId: '1', query: 'a=b' }],
      ['/api/seller/inventory', { vendorId: VENDOR, vendorItemIds: ['1'], host: 'evil.example' }],
      ['/api/rg/inventory', { vendorId: VENDOR, headers: {} }],
      ['/api/unlock', { force: true }]
    ]
    for (const [p, body] of attempts) {
      const r = await env.api(p, body)
      assert.equal(r.status, 400, p)
      assert.equal(r.json.error.code, 'INVALID_INPUT', p)
    }
    assert.equal(env.stub.count(), 0)
  })
})

T('T-INPUT', '입력 검증 실패는 400, 값을 에코하지 않고 stub 호출 0', async () => {
  await withEnv({}, async (env) => {
    const marker = 'ZZINPUTMARKERZZ'
    const cases = [
      ['/api/check', { vendorId: 'A1234567/../' + marker }],
      ['/api/check', { vendorId: 'a1234567' }],
      ['/api/check', { vendorId: 'A12' }],
      ['/api/check', { vendorId: 'A1234567?x=' + marker }],
      ['/api/check', { vendorId: 12345 }],
      ['/api/seller/products', { vendorId: VENDOR, nextToken: 'a&vendorItemId=1' + marker }],
      ['/api/seller/products', { vendorId: VENDOR, nextToken: 'a/b' }],
      ['/api/seller/products', { vendorId: VENDOR, nextToken: 'a%2Fb' }],
      ['/api/seller/products', { vendorId: VENDOR, nextToken: 'x'.repeat(257) }],
      ['/api/seller/products', { vendorId: VENDOR, maxPerPage: 0 }],
      ['/api/seller/products', { vendorId: VENDOR, maxPerPage: 21 }],
      ['/api/seller/products', { vendorId: VENDOR, maxPerPage: 1.5 }],
      ['/api/seller/products', { vendorId: VENDOR, maxPerPage: 'x' }],
      ['/api/seller/product-items', { vendorId: VENDOR, sellerProductId: '../1' + marker }],
      ['/api/seller/product-items', { vendorId: VENDOR }],
      ['/api/seller/product-items', { vendorId: VENDOR, sellerProductId: {} }],
      ['/api/seller/inventory', { vendorId: VENDOR, vendorItemIds: ['1/../2' + marker] }],
      ['/api/seller/inventory', { vendorId: VENDOR, vendorItemIds: [] }],
      ['/api/seller/inventory', { vendorId: VENDOR, vendorItemIds: '123' }],
      ['/api/seller/inventory', { vendorId: VENDOR, vendorItemIds: [1.5] }],
      ['/api/seller/inventory', { vendorId: VENDOR }],
      ['/api/rg/inventory', { vendorId: VENDOR, vendorItemId: '1', nextToken: 'abc' }],
      ['/api/rg/inventory', { vendorId: VENDOR, vendorItemId: '1?' + marker }]
    ]
    for (const [p, body] of cases) {
      const r = await env.api(p, body)
      assert.equal(r.status, 400, p + ' ' + JSON.stringify(body).slice(0, 60))
      assert.equal(r.json.error.code, 'INVALID_INPUT')
      assert.ok(typeof r.json.error.field === 'string')
      assert.ok(!r.text.includes(marker), '값 에코 금지')
    }
    assert.equal(env.stub.count(), 0)
  })
})

// ======================= 마스킹 / 유출 =======================

T('T-MASK', 'mask(): 키·서명·Authorization·패턴을 모두 가림, 일반 문자열은 유지', () => {
  const masker = createMasker()
  masker.addSecret(FAKE_ACCESS)
  masker.addSecret(FAKE_SECRET)
  const sig = 'ab'.repeat(32)
  const authorization = 'CEA algorithm=HmacSHA256, access-key=OTHERKEY, signed-date=261012T010203Z, signature=' + sig
  masker.addRecent('recent-signature-value-xyz')
  const inputs = [
    'x ' + FAKE_ACCESS + ' y',
    'x ' + FAKE_SECRET + ' y',
    authorization,
    'signature=0123456789abcdef0123',
    'access-key=SOMETHING',
    'hash ' + sig + ' end',
    'recent-signature-value-xyz',
    encodeURIComponent(FAKE_SECRET),
    new Error('boom ' + FAKE_SECRET).stack
  ]
  for (const input of inputs) {
    const out = masker.mask(input)
    assert.ok(!out.includes(FAKE_ACCESS), input)
    assert.ok(!out.includes(FAKE_SECRET), input)
    assert.ok(!out.includes(sig), input)
    assert.ok(!out.includes('CEA algorithm'), input)
    assert.ok(!out.includes('recent-signature-value-xyz'), input)
    assert.ok(!/signature=[0-9a-f]{16,}/.test(out), input)
  }
  assert.equal(masker.mask('테스트 상품 A (재고 12)'), '테스트 상품 A (재고 12)')
  const deep = masker.maskDeep({ a: [FAKE_SECRET, { b: 'k ' + FAKE_ACCESS }], c: 5, [FAKE_SECRET]: 1 })
  const s = JSON.stringify(deep)
  assert.ok(!s.includes(FAKE_SECRET) && !s.includes(FAKE_ACCESS))
  assert.equal(deep.c, 5)
})

T('T-LEAK-2', '쿠팡 오류 본문이 Authorization·키를 에코해도 upstreamMessage·로그에 원문 없음', async () => {
  await withEnv({}, async (env) => {
    env.stub.setOverride((info) => ({
      status: 403,
      body: {
        code: 403,
        message:
          'denied: ' + info.authorization + ' | key=' + FAKE_SECRET + ' | ' + FAKE_ACCESS + ' | ' + 'x'.repeat(400),
        extra: FAKE_SECRET
      }
    }))
    const r = await env.api('/api/check', { vendorId: VENDOR })
    assert.equal(r.status, 502)
    assert.equal(r.json.error.code, 'COUPANG_FORBIDDEN')
    assert.equal(r.json.error.upstreamStatus, 403)
    // L1: 키 조각이 보이면 메시지를 통째로 버리고 일반 문구로 대체한다
    assert.equal(r.json.error.upstreamMessage, GENERIC_UPSTREAM_MESSAGE)
    assert.ok(r.json.error.upstreamMessage.length <= 200)
    assert.ok(!r.text.includes(FAKE_SECRET) && !r.text.includes(FAKE_ACCESS))
    assert.ok(!r.text.includes('extra'), '메시지 외 필드는 전달하지 않음')
    assert.ok(!env.lines.join('\n').includes(FAKE_SECRET))
    env.stubSecrets()
    for (const s of env.stub.state.seenSecrets) {
      assert.ok(!r.text.includes(s))
    }
  })
})

T('T-LEAK-3', 'inspect / JSON.stringify 에 키가 없고 process.env 에도 올라가지 않음', async () => {
  const loaded = envLoader.loadKeyFile(FAKE_FILE)
  const client = createClient({ signer: loaded.signer, baseUrl: 'http://127.0.0.1:9', clock: { now: () => Date.now() }, mask: (s) => s })
  const dumps = [
    JSON.stringify(loaded),
    util.inspect(loaded, { depth: 10, showHidden: true }),
    JSON.stringify(loaded.signer),
    util.inspect(loaded.signer, { depth: 10, showHidden: true }),
    String(loaded.signer.authorize),
    JSON.stringify(client),
    util.inspect(client, { depth: 10, showHidden: true }),
    JSON.stringify(process.env),
    Object.keys(process.env).join(',')
  ]
  for (const d of dumps) {
    assert.ok(!d.includes(FAKE_ACCESS) && !d.includes(FAKE_SECRET))
  }
  assert.equal(JSON.stringify(loaded.signer), '"[signer]"')
  assert.equal(util.inspect(loaded.signer), '[signer]')
  assert.ok(Object.isFrozen(loaded.signer))
  await withEnv({}, async (env) => {
    const dump = util.inspect(env.app, { depth: 10, showHidden: true }) + JSON.stringify(env.app)
    assert.ok(!dump.includes(FAKE_ACCESS) && !dump.includes(FAKE_SECRET))
    assert.ok(!JSON.stringify(process.env).includes(FAKE_SECRET))
  })
})

T('T-LEAK-4', '/api/status 응답은 불리언·줄 번호·vendorId·잠금 외 값이 없음', async () => {
  await withEnv({}, async (env) => {
    const r = await env.get('/api/status')
    assert.equal(r.status, 200)
    assert.deepEqual(Object.keys(r.json).sort(), ['calls', 'data', 'lock', 'ok'])
    assert.deepEqual(Object.keys(r.json.data).sort(), ['keyError', 'keyLoaded', 'lock', 'vendorId', 'vendorIdFromFile'])
    assert.equal(r.json.data.keyLoaded, true)
    assert.equal(r.json.data.keyError, null)
    assert.deepEqual(r.json.data.lock, { state: 'none', until: null, reasonCode: null })
    assert.ok(!r.text.includes(FAKE_ACCESS) && !r.text.includes(FAKE_SECRET))
    assert.ok(!r.text.includes(env.token), '세션 토큰은 HTML 주입 외에 나가지 않음')
  })
})

T('T-PII-1', '쿠팡 응답에 개인정보·미지정 필드가 섞여도 projection 필드만 응답', async () => {
  await withEnv({}, async (env) => {
    const pii = {
      receiver: { name: '수취인비밀', addr1: '서울시 비밀주소 1', receiverNumber: '010-0000-0000' },
      requesterName: '홍길동비밀',
      requesterPhoneNumber: '050-1111-2222',
      unknownField: 'UNKNOWN_FIELD_VALUE',
      salePrice: 99999,
      maximumBuyCount: 321
    }
    env.stub.setOverride((info) => {
      if (/\/seller-products$/.test(info.path)) {
        return {
          status: 200,
          body: {
            code: 200,
            data: [Object.assign({ sellerProductId: 111, sellerProductName: '상품', statusName: '승인' }, pii)],
            nextToken: '2',
            extraTop: 'EXTRA_TOP'
          }
        }
      }
      if (/\/seller-products\/\d+$/.test(info.path)) {
        return {
          status: 200,
          body: {
            code: 200,
            data: Object.assign(
              {
                sellerProductId: 111,
                sellerProductName: '상품',
                items: [Object.assign({ sellerProductItemId: 5, vendorItemId: 6, itemName: '옵션' }, pii)]
              },
              pii
            )
          }
        }
      }
      if (/inventories$/.test(info.path)) {
        return { status: 200, body: { code: 'SUCCESS', data: Object.assign({ amountInStock: 4, onSale: false }, pii) } }
      }
      return {
        status: 200,
        body: {
          code: 200,
          data: [Object.assign({ vendorItemId: 6, inventoryDetails: { totalOrderableQuantity: 9, other: 'OTHER_DETAIL' }, salesCountMap: { A: 1 } }, pii)],
          nextToken: null
        }
      }
    })
    const responses = [
      await env.api('/api/seller/products', { vendorId: VENDOR }),
      await env.api('/api/seller/product-items', { vendorId: VENDOR, sellerProductId: '111' }),
      await env.api('/api/seller/inventory', { vendorId: VENDOR, vendorItemIds: ['6'] }),
      await env.api('/api/rg/inventory', { vendorId: VENDOR })
    ]
    for (const r of responses) {
      assert.equal(r.status, 200)
      for (const word of [
        '수취인비밀',
        '서울시 비밀주소',
        '010-0000',
        '홍길동비밀',
        '050-1111',
        'UNKNOWN_FIELD_VALUE',
        'EXTRA_TOP',
        'OTHER_DETAIL',
        'salePrice',
        'maximumBuyCount',
        'salesCountMap',
        'receiver',
        'requester',
        '99999',
        '321'
      ]) {
        assert.ok(!r.text.includes(word), word)
      }
    }
    assert.deepEqual(Object.keys(responses[0].json.data.items[0]).sort(), ['sellerProductId', 'sellerProductName', 'statusName'])
    assert.deepEqual(Object.keys(responses[1].json.data).sort(), ['items', 'sellerProductId', 'sellerProductName'])
    assert.deepEqual(Object.keys(responses[1].json.data.items[0]).sort(), ['itemName', 'sellerProductItemId', 'vendorItemId'])
    assert.deepEqual(responses[2].json.data.results[0], { vendorItemId: '6', status: 'ok', amountInStock: 4, onSale: false })
    assert.deepEqual(responses[3].json.data.items[0], { vendorItemId: '6', totalOrderableQuantity: 9 })
  })
})

// ======================= 네트워크 보안 =======================

T('T-NET-1', 'Host·Origin·세션 토큰 검증', async () => {
  await withEnv({}, async (env) => {
    const port = env.port
    // Host
    for (const host of ['evil.example:' + port, '127.0.0.1:' + (port === 1025 ? 1026 : 1025), '127.0.0.1', 'localhost', 'evil.example', '127.0.0.1:' + port + '.evil.example']) {
      const r = await env.get('/api/status', { host })
      assert.equal(r.status, 403, 'Host ' + host)
      const page = await env.get('/', { host, token: null })
      assert.equal(page.status, 403, 'Host(정적) ' + host)
    }
    const noHost = await env.request({ method: 'GET', path: '/api/status', headers: { 'X-Session-Token': env.token }, setHost: false }).catch(() => ({ status: 400 }))
    assert.ok(noHost.status === 400 || noHost.status === 403)
    const local = await env.get('/api/status', { host: 'localhost:' + port })
    assert.equal(local.status, 200)
    // Origin
    for (const origin of ['http://evil.example', 'null', 'http://127.0.0.1', 'https://127.0.0.1:' + port, 'http://127.0.0.1:' + port + '.evil.example', 'http://localhost']) {
      const r = await env.api('/api/unlock', {}, { origin })
      assert.equal(r.status, 403, 'Origin ' + origin)
    }
    const noOrigin = await env.api('/api/unlock', {}, { origin: null })
    assert.equal(noOrigin.status, 403)
    const okOrigin = await env.api('/api/unlock', {}, { origin: 'http://localhost:' + port })
    assert.equal(okOrigin.status, 200)
    const getBadOrigin = await env.get('/api/status', { origin: 'http://evil.example' })
    assert.equal(getBadOrigin.status, 403)
    // 토큰
    const wrongSameLen = env.token.replace(/.$/, env.token.endsWith('A') ? 'B' : 'A')
    for (const token of [null, 'wrong', wrongSameLen, env.token + 'x', env.token.slice(1), 'x'.repeat(5000)]) {
      const post = await env.api('/api/unlock', {}, { token })
      assert.equal(post.status, 403, 'token ' + String(token).slice(0, 8))
      const get = await env.get('/api/status', { token })
      assert.equal(get.status, 403)
    }
    const good = await env.api('/api/unlock', {})
    assert.equal(good.status, 200)
    assert.equal(good.json.ok, true)
    assert.deepEqual(good.json.data.lock, { state: 'none', until: null, reasonCode: null })
    assert.equal(env.stub.count(), 0)
  })
})

T('T-NET-2', '메서드·Content-Type·본문 크기·JSON 형식 검사, CORS 헤더 없음', async () => {
  await withEnv({}, async (env) => {
    for (const method of ['OPTIONS', 'PUT', 'DELETE', 'PATCH', 'HEAD']) {
      const r = await env.get('/api/check', { method, origin: 'http://127.0.0.1:' + env.port })
      assert.equal(r.status, 405, method)
      const root = await env.get('/', { method, token: null })
      assert.equal(root.status, 405, method + ' /')
    }
    const getCheck = await env.get('/api/check')
    assert.equal(getCheck.status, 405)
    const postStatus = await env.api('/api/status', {})
    assert.equal(postStatus.status, 405)
    for (const contentType of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data', 'application/jsonx', null]) {
      const r = await env.api('/api/unlock', {}, { contentType })
      assert.equal(r.status, 415, String(contentType))
    }
    const charset = await env.api('/api/unlock', {}, { contentType: 'application/json; charset=utf-8' })
    assert.equal(charset.status, 200)
    // 본문 크기
    const big = await env.api('/api/check', {}, { rawBody: JSON.stringify({ vendorId: 'A' + '1'.repeat(5000) }) })
    assert.equal(big.status, 413)
    assert.equal(big.json.error.code, 'BODY_TOO_LARGE')
    const chunk = Buffer.alloc(1024, 0x61)
    const chunked = await env.api('/api/check', {}, { chunks: [chunk, chunk, chunk, chunk, chunk, chunk], headers: { 'Transfer-Encoding': 'chunked' } })
    assert.equal(chunked.status, 413)
    // JSON 형식
    for (const raw of ['[]', '"str"', '123', 'null', '{bad json', '{"vendorId":"A0001234","extra":1}']) {
      const r = await env.api('/api/check', {}, { rawBody: raw })
      assert.equal(r.status, 400, raw)
      assert.equal(r.json.error.code, 'INVALID_INPUT', raw)
    }
    assert.equal(env.stub.count(), 0)
    const notFound = await env.api('/api/nope', {})
    assert.equal(notFound.status, 404)
  })
})

T('T-NET-3', '127.0.0.1 만 리스닝, 소스에 금지 문자열 없음, CORS 헤더 미전송', async () => {
  await withEnv({}, async (env) => {
    // 실제 리스닝 주소가 127.0.0.1 하나뿐인지 서버 객체에서 확인
    const addr = env.app.getAddress()
    assert.equal(addr.address, '127.0.0.1')
    assert.equal(addr.family, 'IPv4')
    assert.equal(addr.port, env.port)
    const ok = await env.get('/api/status')
    assert.equal(ok.status, 200)
    // 다른 인터페이스(LAN IP)·IPv6 loopback 으로는 연결되지 않아야 한다
    const targets = [{ host: '::1', family: 6 }]
    for (const list of Object.values(os.networkInterfaces())) {
      for (const nic of list || []) {
        if (nic.family === 'IPv4' && nic.address !== '127.0.0.1') {
          targets.push({ host: nic.address, family: 4 })
        }
      }
    }
    for (const t of targets) {
      const connected = await new Promise((resolve) => {
        const socket = net.connect({ host: t.host, port: env.port, family: t.family })
        const done = (value) => {
          socket.destroy()
          resolve(value)
        }
        socket.setTimeout(1500, () => done(false))
        socket.on('connect', () => done(true))
        socket.on('error', () => done(false))
      })
      assert.equal(connected, false, t.host + ' 로 연결되면 안 됨')
    }
  })
  const files = [path.join(ROOT, 'server.cjs')]
  for (const f of fs.readdirSync(path.join(ROOT, 'lib'))) {
    files.push(path.join(ROOT, 'lib', f))
  }
  const forbidden = [/0\.0\.0\.0/, /['"]::['"]/, /rejectUnauthorized/i, /access-control/i]
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8')
    for (const re of forbidden) {
      assert.ok(!re.test(src), path.basename(file) + ' ' + re)
    }
    // 위험 환경 변수 이름은 점검 목록(env-guard.cjs)에만 있어야 한다 (읽어서 동작을 바꾸는 코드 없음)
    if (path.basename(file) !== 'env-guard.cjs') {
      assert.ok(!/NODE_TLS_REJECT_UNAUTHORIZED|STOCKD_TEST_BASE_URL/.test(src), path.basename(file) + ' 환경 변수 이름')
    }
    // M1: 운영 코드가 읽는 환경 변수는 STOCKD_ENV_FILE 하나뿐
    assert.ok(!/process\.env\.(?!STOCKD_ENV_FILE)/.test(src), path.basename(file) + ' process.env')
    assert.ok(!/process\.env\s*(\[|\.[A-Za-z_]+)\s*=[^=]/.test(src), path.basename(file) + ' env 쓰기')
  }
  // 지금까지 수집한 모든 응답 헤더에 CORS 헤더가 없어야 한다
  for (const c of collected.filter((x) => x.kind === 'header')) {
    assert.ok(!/^access-control-/im.test(c.text))
  }
})

T('T-NET-4', 'GET / 에 세션 토큰이 주입되고 보안 헤더가 붙음, 인스턴스마다 토큰이 다름', async () => {
  let first = null
  await withEnv({}, async (env) => {
    first = env.token
    assert.equal(env.home.status, 200)
    assert.ok(env.token && env.token.length >= 32)
    assert.ok(!env.home.text.includes('__SESSION_TOKEN__'))
    assert.match(env.home.headers['content-type'], /text\/html/)
    const h = env.home.headers
    assert.equal(h['x-content-type-options'], 'nosniff')
    assert.equal(h['cache-control'], 'no-store')
    const csp = h['content-security-policy']
    for (const part of [
      "default-src 'none'",
      "script-src 'self'",
      "style-src 'self'",
      "connect-src 'self'",
      "img-src 'self'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
      "object-src 'none'"
    ]) {
      assert.ok(csp.split('; ').includes(part), part)
    }
    assert.ok(!csp.includes('data:') && !csp.includes('unsafe'), 'CSP 에 data:/unsafe 없음')
    assert.equal(h['referrer-policy'], 'no-referrer')
    for (const p of ['/app.js', '/style.css']) {
      const r = await env.get(p, { token: null })
      assert.equal(r.status, 200, p)
      assert.equal(r.headers['x-content-type-options'], 'nosniff')
    }
    const js = await env.get('/app.js', { token: null })
    assert.match(js.headers['content-type'], /javascript/)
    const css = await env.get('/style.css', { token: null })
    assert.match(css.headers['content-type'], /css/)
    const json = await env.get('/api/status')
    assert.match(json.headers['content-type'], /application\/json/)
    assert.equal(json.headers['cache-control'], 'no-store')
  })
  await withEnv({}, async (env) => {
    assert.notEqual(env.token, first)
  })
})

T('T-PATH-1', '경로 순회·고정 목록 밖 파일 요청은 404, 파일 내용 없음', async () => {
  await withEnv({}, async (env) => {
    const paths = [
      '/../env/api.txt',
      '/%2e%2e/env/api.txt',
      '/..%5cenv%5capi.txt',
      '/..\\env\\api.txt',
      '/public/../server.cjs',
      '/public/index.html',
      '/env/api.txt',
      '/server.cjs',
      '/lib/env-loader.cjs',
      '/lib/../server.cjs',
      '/test/fixtures/fake-api.txt',
      '/index.html',
      '/app.js/',
      '/app.js/../server.cjs',
      '//server.cjs',
      '/%00',
      '/style.css%00.js',
      '/.env',
      '/package.json',
      '/%2e%2e%2f%2e%2e%2fserver.cjs'
    ]
    for (const p of paths) {
      const r = await env.get(p, { token: null })
      assert.equal(r.status, 404, p)
      assert.ok(!r.text.includes('createServer') && !r.text.includes(FAKE_ACCESS) && !r.text.includes('use strict'), p)
    }
    const apiUnknown = await env.get('/api/../server.cjs', { token: null })
    assert.ok(apiUnknown.status === 403 || apiUnknown.status === 404)
    const absolute = await env.request({ method: 'GET', path: 'http://127.0.0.1/../server.cjs', headers: { Host: '127.0.0.1:' + env.port } })
    assert.equal(absolute.status, 404)
  })
})

// ======================= 호출 제한 / 잠금 =======================

T('T-RATE-1', '재고 20건 일괄: 초당 3회 이하로 호출', async () => {
  await withEnv({}, async (env) => {
    const ids = Array.from({ length: 20 }, (_, i) => String(90000001 + i))
    const t0 = env.clock.now()
    const r = await env.api('/api/seller/inventory', { vendorId: VENDOR, vendorItemIds: ids })
    assert.equal(r.status, 200)
    assert.equal(r.json.data.results.length, 20)
    assert.ok(r.json.data.results.every((x) => x.status === 'ok'))
    assert.equal(r.json.data.results[0].amountInStock, 90000001 % 100)
    assert.equal(r.json.calls.length, 20)
    const times = env.stub.state.requests.map((x) => x.at)
    assert.equal(times.length, 20)
    for (let i = 0; i < times.length; i += 1) {
      const inWindow = times.filter((t) => t >= times[i] && t < times[i] + 1000).length
      assert.ok(inWindow <= 3, '1초 창 안 호출 ' + inWindow + '회')
    }
    assert.ok(env.clock.now() - t0 >= 5000, '간격 대기가 있어야 함')
    // 중복 제거
    const dup = await env.api('/api/seller/inventory', { vendorId: VENDOR, vendorItemIds: ['90000001', 90000001, '90000001'] })
    assert.equal(dup.json.data.results.length, 1)
  })
})

T('T-RATE-2', '21건 요청은 BATCH_LIMIT, 호출 0', async () => {
  await withEnv({}, async (env) => {
    const ids = Array.from({ length: 21 }, (_, i) => String(1000 + i))
    const r = await env.api('/api/seller/inventory', { vendorId: VENDOR, vendorItemIds: ids })
    assert.equal(r.status, 400)
    assert.equal(r.json.error.code, 'BATCH_LIMIT')
    assert.equal(r.json.error.message, '한 번에 최대 20개 옵션까지 조회할 수 있습니다.')
    assert.equal(env.stub.count(), 0)
  })
})

T('T-RATE-3', 'RG 분당 40회: 41번째는 BUSY, 1분 뒤 다시 허용', async () => {
  await withEnv({}, async (env) => {
    for (let i = 0; i < 40; i += 1) {
      const r = await env.api('/api/rg/inventory', { vendorId: VENDOR })
      assert.equal(r.status, 200, 'call ' + (i + 1))
    }
    assert.equal(env.stub.count(), 40)
    const busy = await env.api('/api/rg/inventory', { vendorId: VENDOR })
    assert.equal(busy.status, 429)
    assert.equal(busy.json.error.code, 'BUSY')
    assert.equal(env.stub.count(), 40)
    // 판매자배송 호출은 RG 분당 버킷의 영향을 받지 않음
    const seller = await env.api('/api/check', { vendorId: VENDOR })
    assert.equal(seller.status, 200)
    env.clock.advance(61000)
    const again = await env.api('/api/rg/inventory', { vendorId: VENDOR })
    assert.equal(again.status, 200)
  })
})

T('T-CONC', '동시에 두 작업을 보내면 하나만 쿠팡을 호출하고 나머지는 BUSY', async () => {
  await withEnv({}, async (env) => {
    env.stub.setOverride(() => ({ status: 200, delayMs: 300, body: { code: 200, data: [], nextToken: null } }))
    const [a, b] = await Promise.all([env.api('/api/check', { vendorId: VENDOR }), env.api('/api/check', { vendorId: VENDOR })])
    const statuses = [a.status, b.status].sort()
    assert.deepEqual(statuses, [200, 429])
    const busy = a.status === 429 ? a : b
    assert.equal(busy.json.error.code, 'BUSY')
    assert.equal(env.stub.count(), 1)
  })
})

T('T-LOCK-1', '403 수신 시 잠금, 즉시 재요청은 LOCKED(쿠팡 호출 0), 원인 안내는 가능성 표현', async () => {
  await withEnv({}, async (env) => {
    env.stub.setOverride(() => ({ status: 403, body: { code: 403, message: 'Forbidden' } }))
    const first = await env.api('/api/check', { vendorId: VENDOR })
    assert.equal(first.status, 502)
    assert.equal(first.json.error.code, 'COUPANG_FORBIDDEN')
    assert.equal(first.json.error.message, '쿠팡이 요청을 거부했습니다(403).')
    assert.equal(first.json.lock.state, 'timed')
    assert.equal(first.json.lock.reasonCode, 'COUPANG_FORBIDDEN')
    assert.equal(first.json.calls.length, 1)
    assert.equal(first.json.calls[0].name, 'seller.products')
    assert.equal(first.json.calls[0].status, 403)
    assert.match(first.json.calls[0].at, /^\d\d:\d\d:\d\d$/)
    assert.equal(env.stub.count(), 1)
    const second = await env.api('/api/check', { vendorId: VENDOR })
    assert.equal(second.status, 423)
    assert.equal(second.json.error.code, 'LOCKED')
    assert.match(second.json.error.message, /^오류가 발생해 \d+초 동안 쿠팡 호출을 멈췄습니다\.$/)
    assert.ok(second.json.error.hint.includes('아래 원인 안내를 확인하세요.'))
    assert.ok(second.json.error.hint.includes('가능성'))
    assert.ok(second.json.error.hint.includes('IP'))
    assert.deepEqual(second.json.calls, [])
    assert.equal(env.stub.count(), 1)
    for (const [p, body] of [
      ['/api/seller/products', { vendorId: VENDOR }],
      ['/api/seller/product-items', { vendorId: VENDOR, sellerProductId: '1' }],
      ['/api/seller/inventory', { vendorId: VENDOR, vendorItemIds: ['1'] }],
      ['/api/rg/inventory', { vendorId: VENDOR }]
    ]) {
      const r = await env.api(p, body)
      assert.equal(r.status, 423, p)
    }
    assert.equal(env.stub.count(), 1)
    const st = await env.get('/api/status')
    assert.equal(st.json.data.lock.state, 'timed')
    assert.ok(st.json.data.lock.until)
    // 시간 잠금은 /api/unlock 으로 풀리지 않는다
    const un = await env.api('/api/unlock', {})
    assert.equal(un.status, 200)
    assert.equal(un.json.data.lock.state, 'timed')
    const still = await env.api('/api/check', { vendorId: VENDOR })
    assert.equal(still.status, 423)
  })
})

T('T-LOCK-2', '일반 4xx 는 60초, 429 는 300초 뒤 잠금 해제 (가짜 시계)', async () => {
  for (const status of [400, 401, 403, 404]) {
    await withEnv({}, async (env) => {
      env.stub.setOverride(() => ({ status, body: { message: 'x' } }))
      const first = await env.api('/api/check', { vendorId: VENDOR })
      assert.equal(first.json.lock.state, 'timed', String(status))
      env.stub.setOverride(null)
      env.clock.advance(59000)
      assert.equal((await env.api('/api/check', { vendorId: VENDOR })).status, 423)
      env.clock.advance(1000)
      const after = await env.api('/api/check', { vendorId: VENDOR })
      assert.equal(after.status, 200, String(status))
      assert.equal(after.json.lock.state, 'none')
    })
  }
  await withEnv({}, async (env) => {
    env.stub.setOverride(() => ({ status: 429, body: { message: 'too many' } }))
    const first = await env.api('/api/check', { vendorId: VENDOR })
    assert.equal(first.json.error.code, 'COUPANG_RATE_LIMIT')
    assert.equal(first.json.lock.state, 'timed')
    env.stub.setOverride(null)
    env.clock.advance(61000)
    assert.equal((await env.api('/api/check', { vendorId: VENDOR })).status, 423)
    env.clock.advance(238000)
    assert.equal((await env.api('/api/check', { vendorId: VENDOR })).status, 423)
    env.clock.advance(1000)
    assert.equal((await env.api('/api/check', { vendorId: VENDOR })).status, 200)
  })
})

T('T-LOCK-3', '연속 실패 2회는 수동 잠금, /api/unlock 으로만 해제, 성공 시 연속 실패 초기화', async () => {
  // 500 두 번
  await withEnv({}, async (env) => {
    env.stub.setOverride(() => ({ status: 500, body: { message: 'server error' } }))
    const a = await env.api('/api/check', { vendorId: VENDOR })
    assert.equal(a.status, 502)
    assert.equal(a.json.error.code, 'COUPANG_SERVER')
    assert.equal(a.json.lock.state, 'none')
    const b = await env.api('/api/check', { vendorId: VENDOR })
    assert.equal(b.json.error.code, 'COUPANG_SERVER')
    assert.equal(b.json.lock.state, 'manual')
    assert.equal(b.json.lock.until, null)
    assert.equal(env.stub.count(), 2)
    env.stub.setOverride(null)
    env.clock.advance(3600000)
    const locked = await env.api('/api/check', { vendorId: VENDOR })
    assert.equal(locked.status, 423)
    assert.equal(locked.json.error.code, 'LOCKED_MANUAL')
    assert.equal(locked.json.error.message, '연속 실패로 호출을 멈췄습니다.')
    assert.equal(env.stub.count(), 2)
    const un = await env.api('/api/unlock', {})
    assert.equal(un.json.data.lock.state, 'none')
    const ok = await env.api('/api/check', { vendorId: VENDOR })
    assert.equal(ok.status, 200)
    assert.equal(env.stub.count(), 3)
  })
  // 성공이 끼면 연속이 아님
  await withEnv({}, async (env) => {
    env.stub.setOverride(() => ({ status: 500, body: {} }))
    await env.api('/api/check', { vendorId: VENDOR })
    env.stub.setOverride(null)
    assert.equal((await env.api('/api/check', { vendorId: VENDOR })).status, 200)
    env.stub.setOverride(() => ({ status: 500, body: {} }))
    const c = await env.api('/api/check', { vendorId: VENDOR })
    assert.equal(c.json.lock.state, 'none')
  })
  // 시간 잠금이 풀려도 연속 실패 수는 유지 → 403 두 번이면 수동 잠금
  await withEnv({}, async (env) => {
    env.stub.setOverride(() => ({ status: 403, body: {} }))
    await env.api('/api/check', { vendorId: VENDOR })
    env.clock.advance(61000)
    const second = await env.api('/api/check', { vendorId: VENDOR })
    assert.equal(second.json.lock.state, 'manual')
    assert.equal(env.stub.count(), 2)
  })
  // 타임아웃 2회
  await withEnv({ timeoutMs: 150 }, async (env) => {
    env.stub.setOverride(() => ({ status: 200, delayMs: 700, body: { code: 200, data: [] } }))
    const a = await env.api('/api/check', { vendorId: VENDOR })
    assert.equal(a.json.error.code, 'TIMEOUT')
    const b = await env.api('/api/check', { vendorId: VENDOR })
    assert.equal(b.json.lock.state, 'manual')
    const c = await env.api('/api/check', { vendorId: VENDOR })
    assert.equal(c.status, 423)
    assert.equal(env.stub.count(), 2)
  })
})

T('T-LOCK-4', '일괄 조회 중 3번째에서 429: 1·2 ok, 3 failed, 나머지 not_run, 재시도 없음', async () => {
  await withEnv({}, async (env) => {
    env.stub.setOverride((info) => (info.index === 3 ? { status: 429, body: { message: 'slow down' } } : null))
    const ids = ['90000001', '90000002', '90000003', '90000004', '90000005']
    const r = await env.api('/api/seller/inventory', { vendorId: VENDOR, vendorItemIds: ids })
    assert.equal(r.status, 200)
    assert.equal(r.json.ok, true)
    assert.deepEqual(
      r.json.data.results.map((x) => x.status),
      ['ok', 'ok', 'failed', 'not_run', 'not_run']
    )
    assert.equal(r.json.data.results[2].errorCode, 'COUPANG_RATE_LIMIT')
    assert.equal(r.json.data.results[3].amountInStock, null)
    assert.equal(r.json.lock.state, 'timed')
    assert.equal(r.json.calls.length, 3)
    assert.equal(env.stub.count(), 3)
    // 두 번째 연속 실패 방지: 5xx 두 번이면 일괄도 중단
  })
  await withEnv({}, async (env) => {
    env.stub.setOverride((info) => (info.index >= 2 ? { status: 500, body: {} } : null))
    const ids = ['90000001', '90000002', '90000003', '90000004']
    const r = await env.api('/api/seller/inventory', { vendorId: VENDOR, vendorItemIds: ids })
    assert.deepEqual(
      r.json.data.results.map((x) => x.status),
      ['ok', 'failed', 'failed', 'not_run']
    )
    assert.equal(r.json.lock.state, 'manual')
    assert.equal(env.stub.count(), 3)
  })
})

T('T-TIME-1', '응답 지연은 TIMEOUT(504), 1MB 초과는 RESPONSE_TOO_LARGE', async () => {
  await withEnv({ timeoutMs: 250 }, async (env) => {
    env.stub.setOverride(() => ({ status: 200, delayMs: 1200, body: { code: 200, data: [] } }))
    const r = await env.api('/api/check', { vendorId: VENDOR })
    assert.equal(r.status, 504)
    assert.equal(r.json.error.code, 'TIMEOUT')
    assert.equal(r.json.calls[0].status, null)
  })
  await withEnv({}, async (env) => {
    env.stub.setOverride(() => ({ status: 200, raw: JSON.stringify({ code: 200, data: [], pad: 'x'.repeat(2 * 1024 * 1024) }) }))
    const r = await env.api('/api/check', { vendorId: VENDOR })
    assert.equal(r.status, 502)
    assert.equal(r.json.error.code, 'RESPONSE_TOO_LARGE')
  })
  await withEnv({}, async (env) => {
    env.stub.setOverride(() => ({ status: 302, body: {} }))
    const r = await env.api('/api/check', { vendorId: VENDOR })
    assert.equal(r.json.error.code, 'COUPANG_UNEXPECTED')
    assert.equal(env.stub.count(), 1, '리다이렉트를 따라가지 않음')
  })
  await withEnv({}, async (env) => {
    env.stub.setOverride(() => ({ status: 200, raw: 'not json at all' }))
    const r = await env.api('/api/check', { vendorId: VENDOR })
    assert.equal(r.json.error.code, 'RESPONSE_PARSE')
  })
})

T('T-PARSE-1', 'envelope code 숫자 200·문자열 SUCCESS 모두 성공, 수량 타입 불일치는 null + 실패', async () => {
  await withEnv({}, async (env) => {
    // 기본 stub: 목록 code=200(숫자), 재고 code="SUCCESS"(문자열)
    assert.equal((await env.api('/api/check', { vendorId: VENDOR })).status, 200)
    const inv = await env.api('/api/seller/inventory', { vendorId: VENDOR, vendorItemIds: ['90000007'] })
    assert.equal(inv.json.data.results[0].status, 'ok')
    assert.equal(inv.json.data.results[0].amountInStock, 7)
    // 수량이 0 이면 0 으로 표시
    env.stub.setOverride(() => ({ status: 200, body: { code: 'SUCCESS', data: { amountInStock: 0, onSale: true } } }))
    const zero = await env.api('/api/seller/inventory', { vendorId: VENDOR, vendorItemIds: ['1'] })
    assert.deepEqual(zero.json.data.results[0], { vendorItemId: '1', status: 'ok', amountInStock: 0, onSale: true })
    for (const bad of ['5', -3, 1.5, null, undefined, true, [], {}]) {
      env.stub.setOverride(() => ({ status: 200, body: { code: 'SUCCESS', data: { amountInStock: bad, onSale: true } } }))
      const r = await env.api('/api/seller/inventory', { vendorId: VENDOR, vendorItemIds: ['1'] })
      const row = r.json.data.results[0]
      assert.equal(row.status, 'failed', JSON.stringify(bad))
      assert.equal(row.amountInStock, null)
      assert.equal(r.json.lock.state, 'none', '형식 불일치는 잠금 사유가 아님')
    }
    env.stub.setOverride(() => ({ status: 200, body: { code: 'ERROR', message: 'x', data: [] } }))
    const wrong = await env.api('/api/check', { vendorId: VENDOR })
    assert.equal(wrong.json.error.code, 'COUPANG_UNEXPECTED')
    env.stub.setOverride(() => ({ status: 200, body: { code: 200, data: [{ vendorItemId: 6, inventoryDetails: { totalOrderableQuantity: '9' } }], nextToken: null } }))
    const rg = await env.api('/api/rg/inventory', { vendorId: VENDOR })
    assert.equal(rg.json.data.items[0].totalOrderableQuantity, null)
  })
})

T('T-PAGING', 'nextToken 정규화: 끝 표시(null·빈 문자열·"null")는 null, 이상한 문자는 NEXT_TOKEN_UNSUPPORTED', async () => {
  await withEnv({}, async (env) => {
    const first = await env.api('/api/seller/products', { vendorId: VENDOR })
    assert.equal(first.json.data.nextToken, '2')
    assert.equal(first.json.data.items.length, 2)
    assert.equal(typeof first.json.data.items[0].sellerProductId, 'string')
    const second = await env.api('/api/seller/products', { vendorId: VENDOR, nextToken: '2' })
    assert.equal(second.json.data.nextToken, null)
    for (const end of [null, '', 'null']) {
      env.stub.setOverride(() => ({ status: 200, body: { code: 200, data: [], nextToken: end } }))
      const r = await env.api('/api/seller/products', { vendorId: VENDOR })
      assert.equal(r.json.data.nextToken, null)
    }
    env.stub.setOverride(() => ({ status: 200, body: { code: 200, data: [], nextToken: 'a/b?c=1' } }))
    const weird = await env.api('/api/seller/products', { vendorId: VENDOR })
    assert.equal(weird.status, 502)
    assert.equal(weird.json.error.code, 'NEXT_TOKEN_UNSUPPORTED')
    // 상품 옵션: vendorItemId null 유지
    env.stub.setOverride(null)
    const items = await env.api('/api/seller/product-items', { vendorId: VENDOR, sellerProductId: '11111' })
    assert.equal(items.json.data.items[0].vendorItemId, '90000001')
    assert.equal(items.json.data.items[1].vendorItemId, null)
    assert.equal(items.json.data.sellerProductId, '11111')
    // check 의 표본 수
    const check = await env.api('/api/check', { vendorId: VENDOR })
    assert.deepEqual(check.json.data, { connected: true, productCountSample: 1 })
    env.stub.setOverride(() => ({ status: 200, body: { code: 200, data: [], nextToken: null } }))
    const empty = await env.api('/api/check', { vendorId: VENDOR })
    assert.deepEqual(empty.json.data, { connected: true, productCountSample: 0 })
  })
})

T('T-LOG', '로그는 "HH:mm:ss GET 허용이름 상태 ms" 한 줄 형식, 비밀·vendorId 없음', async () => {
  await withEnv({}, async (env) => {
    await env.api('/api/check', { vendorId: VENDOR })
    await env.api('/api/seller/inventory', { vendorId: VENDOR, vendorItemIds: ['90000001'] })
    env.stub.setOverride(() => ({ status: 404, body: { message: 'x' } }))
    await env.api('/api/rg/inventory', { vendorId: VENDOR })
    assert.equal(env.lines.length, 3)
    for (const line of env.lines) {
      assert.match(line, /^\d\d:\d\d:\d\d GET (seller\.products|seller\.product|seller\.inventory|rg\.inventory) (\d{3}|-) \d+ms$/)
      assert.ok(!line.includes(VENDOR) && !line.includes(env.token))
    }
  })
})

T('T-BASEURL', '시험용 호스트 오버라이드는 loopback(127.0.0.1) http 만 허용', async () => {
  assert.deepEqual(resolveTarget(undefined), { protocol: 'https:', hostname: 'api-gateway.coupang.com', port: 443 })
  assert.deepEqual(resolveTarget('http://127.0.0.1:9123'), { protocol: 'http:', hostname: '127.0.0.1', port: 9123 })
  const bad = [
    'https://api-gateway.coupang.com',
    'https://api-gateway.coupang.com.evil.example',
    'http://evil.example:9',
    'http://localhost:9',
    'http://[::1]:9',
    'https://127.0.0.1:9',
    'http://127.0.0.1:9/path',
    'http://127.0.0.1:9/?a=1',
    'http://user@127.0.0.1:9',
    'http://127.0.0.1@evil.example',
    'http://127.0.0.1.evil.example',
    'http://0.0.0.0:9',
    'ftp://127.0.0.1',
    'not a url'
  ]
  for (const url of bad) {
    assert.throws(() => resolveTarget(url), Error, url)
    assert.throws(() => createApp({ port: 0, keyFile: FAKE_FILE, baseUrl: url, logger: () => {} }), Error, url)
  }
})

// ======================= 프로세스 시험 =======================

function freePort() {
  return new Promise((resolve) => {
    const s = http.createServer()
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port
      s.close(() => resolve(p))
    })
  })
}

// 자식 프로세스 환경: 위험 환경 변수(L2)와 STOCKD_* 는 기본으로 제거하고 시험이 필요한 것만 다시 넣는다.
const SCRUB_ENV_NAMES = [
  'NODE_TLS_REJECT_UNAUTHORIZED',
  'NODE_EXTRA_CA_CERTS',
  'NODE_OPTIONS',
  'NODE_USE_ENV_PROXY',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'STOCKD_ENV_FILE',
  'STOCKD_TEST_BASE_URL'
]

function childEnv(extraEnv) {
  const env = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (!SCRUB_ENV_NAMES.includes(key.toUpperCase())) {
      env[key] = value
    }
  }
  return Object.assign(env, extraEnv)
}

function isFakeKeyPath(p) {
  return p === FAKE_FILE || String(p).startsWith(TMP + path.sep)
}

// 운영 진입점(server.cjs)을 자식 프로세스로 실행한다. 키 파일은 가짜(STOCKD_ENV_FILE)만 허용.
// 이 진입점에는 주소 오버라이드가 없으므로 쿠팡 호출은 시험하지 않고 시작·거부 동작만 확인한다.
function runChild(args, extraEnv) {
  const env = childEnv(extraEnv)
  assert.ok(env.STOCKD_ENV_FILE && isFakeKeyPath(env.STOCKD_ENV_FILE), '시험은 가짜 키 파일만 사용')
  return spawn(process.execPath, [path.join(ROOT, 'server.cjs')].concat(args), { env, stdio: ['pipe', 'pipe', 'pipe'] })
}

// 시험 전용 진입 스크립트(test/serve-for-test.cjs)를 자식 프로세스로 실행한다. 가짜 키 파일·stub 주소만 허용.
function runTestServer(args, extraEnv) {
  const keyIndex = args.indexOf('--key-file')
  assert.ok(keyIndex !== -1 && isFakeKeyPath(args[keyIndex + 1]), '시험은 가짜 키 파일만 사용')
  const env = childEnv(extraEnv)
  return spawn(process.execPath, [path.join(__dirname, 'serve-for-test.cjs')].concat(args), {
    env,
    stdio: ['pipe', 'pipe', 'pipe']
  })
}

// 자식 프로세스 출력 수집 도우미
function collectOutput(child) {
  const box = { out: '' }
  child.stdout.on('data', (d) => (box.out += d))
  child.stderr.on('data', (d) => (box.out += d))
  box.exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)))
  return box
}

function waitFor(predicate, ms) {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const tick = () => {
      if (predicate()) {
        resolve()
      } else if (Date.now() - started > ms) {
        reject(new Error('대기 시간 초과'))
      } else {
        setTimeout(tick, 25)
      }
    }
    tick()
  })
}

function exitWithin(box, child, ms) {
  return Promise.race([
    box.exited,
    new Promise((resolve) =>
      setTimeout(() => {
        child.kill()
        resolve('timeout')
      }, ms)
    )
  ])
}

T('T-SHUT-1', '시험 전용 진입 스크립트 실행·정상 종료 처리: 종료 신호 대체(stdin) 후 코드 0, 포트 해제, 비밀 없음', async () => {
  const stub = createStub({ fakeAccess: FAKE_ACCESS, fakeSecret: FAKE_SECRET })
  const baseUrl = await stub.start()
  const port = await freePort()
  const child = runTestServer(['--port', String(port), '--key-file', FAKE_FILE, '--base-url', baseUrl])
  const box = collectOutput(child)
  let code = null
  try {
    await waitFor(() => box.out.includes('주소:'), 8000)
    const home = await rawRequest({ port, path: '/', headers: { Host: '127.0.0.1:' + port } })
    const token = /name="session-token" content="([^"]+)"/.exec(home.text)
    // 기본 public/index.html 에 자리표시자가 없으면 토큰을 못 얻을 수 있어 그 경우 건너뜀
    if (token) {
      const body = JSON.stringify({ vendorId: VENDOR })
      const r = await rawRequest({
        port,
        method: 'POST',
        path: '/api/check',
        headers: {
          Host: '127.0.0.1:' + port,
          Origin: 'http://127.0.0.1:' + port,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'X-Session-Token': token[1]
        },
        body
      })
      assert.equal(r.status, 200)
      assert.equal(stub.count(), 1)
      assert.ok(stub.state.requests[0].sigOk)
    }
    const st = await rawRequest({ port, path: '/nope', headers: { Host: '127.0.0.1:' + port } })
    assert.equal(st.status, 404)
    // 종료 신호 대체: 신호 핸들러와 같은 shutdown 함수를 호출한다 (Windows 는 자식에게 SIGINT 를 보낼 수 없음)
    child.stdin.write('shutdown\n')
    code = await exitWithin(box, child, 8000)
  } finally {
    child.kill()
    await box.exited
    stub.state.seenSecrets.forEach((s) => stubSecrets.add(s))
    await stub.stop()
  }
  record('log', box.out)
  assert.equal(code, 0, '정상 종료 코드 0')
  assert.match(box.out, /종료 처리 완료/)
  assert.ok(!box.out.includes(FAKE_ACCESS) && !box.out.includes(FAKE_SECRET))
  assert.match(box.out, /키 파일: 로드됨/)
  await expectThrows(() => rawRequest({ port, path: '/', headers: {} }))

  // POSIX 에서는 실제 SIGINT 로도 같은 정상 종료 경로를 확인한다 (Windows 는 신호 전달이 안 되어 생략)
  if (process.platform !== 'win32') {
    const stub2 = createStub({ fakeAccess: FAKE_ACCESS, fakeSecret: FAKE_SECRET })
    const base2 = await stub2.start()
    const port2 = await freePort()
    const c2 = runTestServer(['--port', String(port2), '--key-file', FAKE_FILE, '--base-url', base2])
    const box2 = collectOutput(c2)
    await waitFor(() => box2.out.includes('주소:'), 8000)
    c2.kill('SIGINT')
    const code2 = await exitWithin(box2, c2, 8000)
    await stub2.stop()
    assert.equal(code2, 0)
    assert.match(box2.out, /종료 처리 완료/)
  }

  // 잘못된 시험 주소 → 시작 거부(키 파일은 읽지 않음)
  const bad = runTestServer(['--port', String(await freePort()), '--key-file', FAKE_FILE, '--base-url', 'https://api-gateway.coupang.com'])
  const badBox = collectOutput(bad)
  const badCode = await exitWithin(badBox, bad, 8000)
  record('log', badBox.out)
  assert.equal(badCode, 1)
  assert.ok(badBox.out.includes('시작하지 못했습니다'))
  assert.ok(!badBox.out.includes(FAKE_ACCESS) && !badBox.out.includes(FAKE_SECRET))

  // 잘못된 --port (운영 진입점, 가짜 키 파일)
  const badPort = runChild(['--port', '80'], { STOCKD_ENV_FILE: FAKE_FILE })
  const portBox = collectOutput(badPort)
  assert.equal(await exitWithin(portBox, badPort, 8000), 1)
  assert.ok(portBox.out.includes('--port'))
})

T('T-SHUT-2', '종료 처리 함수: 진행 중 쿠팡 요청을 끊고 포트를 해제하며 두 번 불러도 안전 (프로세스 내부 호출)', async () => {
  const clock = makeClock(Date.UTC(2026, 9, 12, 0, 0, 0))
  const stub = createStub({ fakeAccess: FAKE_ACCESS, fakeSecret: FAKE_SECRET, now: clock.now })
  const baseUrl = await stub.start()
  const lines = []
  const started = await startServer({
    port: 0,
    keyFile: FAKE_FILE,
    baseUrl,
    env: {},
    installHandlers: false,
    exitProcess: false,
    logger: (line) => {
      lines.push(line)
      record('log', line)
    }
  })
  const port = started.info.port
  try {
    assert.equal(started.app.getAddress().address, '127.0.0.1')
    const home = await rawRequest({ port, path: '/', headers: { Host: '127.0.0.1:' + port } })
    const token = /name="session-token" content="([^"]+)"/.exec(home.text)
    if (token) {
      stub.setOverride(() => ({ status: 200, delayMs: 5000, body: { code: 200, data: [], nextToken: null } }))
      const body = JSON.stringify({ vendorId: VENDOR })
      const pending = rawRequest({
        port,
        method: 'POST',
        path: '/api/check',
        headers: {
          Host: '127.0.0.1:' + port,
          Origin: 'http://127.0.0.1:' + port,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'X-Session-Token': token[1]
        },
        body
      }).catch(() => ({ status: 0 }))
      await waitFor(() => stub.count() === 1, 3000)
      const t0 = Date.now()
      await started.shutdown()
      await started.shutdown()
      assert.ok(Date.now() - t0 < 2500, '진행 중 요청을 기다리지 않고 종료')
      const done = await pending
      assert.ok(done.status === 0 || done.status >= 500 || done.status === 403, '진행 중 요청은 중단됨')
    } else {
      await started.shutdown()
    }
    assert.ok(lines.includes('종료 처리 완료'))
    assert.equal(lines.filter((l) => l === '종료 처리 완료').length, 1)
    await expectThrows(() => rawRequest({ port, path: '/', headers: {} }))
  } finally {
    stub.state.seenSecrets.forEach((s) => stubSecrets.add(s))
    await stub.stop()
  }
})

// ======================= 보안 검토 지적 보강 시험 =======================

T('T-M1-1', '시험용 주소는 createApp 인자로만, 가짜 키 파일과 함께일 때만 허용 (실제 키 조합 불가)', async () => {
  const stub = createStub({ fakeAccess: FAKE_ACCESS, fakeSecret: FAKE_SECRET })
  const baseUrl = await stub.start()
  try {
    const quiet = () => {}
    // 1) 키 파일을 지정하지 않으면(= 기본 실제 키 경로) 주소 오버라이드는 거부 (기본 경로 파일은 열지도 않음)
    assert.throws(() => createApp({ port: 0, baseUrl, logger: quiet }), /가짜 키 파일을 직접 지정/)
    // 2) 허용 위치(test/fixtures, 임시 폴더) 밖의 키 파일은 거부 (경로만으로 판단, 파일은 열지 않음)
    assert.throws(() => createApp({ port: 0, baseUrl, keyFile: path.resolve(ROOT, '..', 'not-allowed-dir', 'api.txt'), logger: quiet }), /가짜 키 파일만/)
    assert.throws(() => createApp({ port: 0, baseUrl, keyFile: path.join(TMP, '..', '..', 'escape.txt'), logger: quiet }), /가짜 키 파일만/)
    assert.throws(() => createApp({ port: 0, baseUrl, keyFile: path.join(ROOT, 'server.cjs'), logger: quiet }), /가짜 키 파일만/)
    // 3) 허용 위치여도 Access Key 가 FAKE 로 시작하지 않으면 거부 (오류 문구에 키 값 없음)
    const notFakeAccess = 'REALLOOKING-0000-1111-2222-333344445555'
    const notFakeSecret = 'realLookingSecretValue0123456789abcdef'
    const notFake = tmpFile('m1-notfake.txt', 'coupang\nAccess Key: ' + notFakeAccess + '\nSecret Key: ' + notFakeSecret + '\n')
    let message = ''
    try {
      createApp({ port: 0, baseUrl, keyFile: notFake, logger: quiet })
    } catch (err) {
      message = String(err && err.message)
    }
    assert.match(message, /FAKE/)
    assert.ok(!message.includes(notFakeAccess) && !message.includes(notFakeSecret))
    // 4) 가짜 키 + 허용 위치는 정상
    const ok = createApp({ port: 0, baseUrl, keyFile: FAKE_FILE, logger: quiet })
    assert.ok(ok)
    // 5) 주소 오버라이드가 없는 일반 모드는 키 파일 위치 제한이 없다 (운영: 호스트가 쿠팡 고정이라 안전)
    const prod = createApp({ port: 0, keyFile: notFake, logger: quiet })
    assert.ok(prod)
    await prod.close()
    await ok.close()
  } finally {
    await stub.stop()
  }
  assert.equal(stub.count(), 0)
})

T('T-M1-2', 'STOCKD_TEST_BASE_URL 이 남아 있으면 운영 진입점은 시작을 거부하고 그 주소로 아무것도 보내지 않음', async () => {
  const stub = createStub({ fakeAccess: FAKE_ACCESS, fakeSecret: FAKE_SECRET })
  const baseUrl = await stub.start()
  try {
    const port = await freePort()
    const child = runChild(['--port', String(port)], { STOCKD_ENV_FILE: FAKE_FILE, STOCKD_TEST_BASE_URL: baseUrl })
    const box = collectOutput(child)
    const code = await exitWithin(box, child, 8000)
    record('log', box.out)
    assert.equal(code, 1)
    assert.ok(box.out.includes('STOCKD_TEST_BASE_URL'), '변수 이름만 안내')
    assert.ok(!box.out.includes(baseUrl), '변수 값은 출력하지 않음')
    assert.ok(!box.out.includes('주소:'), '서버가 시작되지 않음')
    assert.equal(stub.count(), 0)
    await expectThrows(() => rawRequest({ port, path: '/', headers: {} }))
  } finally {
    await stub.stop()
  }
})

T('T-ENVGUARD', '위험한 실행 환경(TLS 검증 끄기·CA 추가·프록시·NODE_OPTIONS) 점검: 운영 모드는 거부, 변수 이름만 안내', async () => {
  // 순수 함수
  assert.deepEqual(inspectEnvironment({}), { removed: [], dangerous: [] })
  assert.deepEqual(inspectEnvironment({ NODE_TLS_REJECT_UNAUTHORIZED: '1' }).dangerous, [])
  assert.deepEqual(inspectEnvironment({ NODE_TLS_REJECT_UNAUTHORIZED: '0' }).dangerous, ['NODE_TLS_REJECT_UNAUTHORIZED'])
  assert.deepEqual(inspectEnvironment({ node_extra_ca_certs: 'x' }).dangerous, ['NODE_EXTRA_CA_CERTS'])
  assert.deepEqual(inspectEnvironment({ https_proxy: 'http://p' }).dangerous, ['HTTPS_PROXY'])
  assert.deepEqual(inspectEnvironment({ HTTPS_PROXY: '' }).dangerous, [], '빈 값은 설정으로 보지 않음')
  assert.deepEqual(inspectEnvironment({ NODE_USE_ENV_PROXY: '1' }).dangerous, ['NODE_USE_ENV_PROXY'])
  assert.deepEqual(inspectEnvironment({ NODE_OPTIONS: '--use-openssl-ca' }).dangerous, ['NODE_OPTIONS'])
  assert.deepEqual(inspectEnvironment({ NODE_OPTIONS: '--max-old-space-size=512 --require ./x.js' }).dangerous, ['NODE_OPTIONS'])
  assert.deepEqual(inspectEnvironment({ NODE_OPTIONS: '--max-old-space-size=512' }).dangerous, [])
  assert.deepEqual(inspectEnvironment({ STOCKD_TEST_BASE_URL: 'http://127.0.0.1:1' }).removed, ['STOCKD_TEST_BASE_URL'])

  // 운영 진입점: 위험한 변수가 하나라도 있으면 시작 거부 (가짜 키 파일, 서버는 뜨지 않음)
  const marker = 'VALUEMARKZZ'
  const cases = [
    ['NODE_TLS_REJECT_UNAUTHORIZED', '0'],
    ['NODE_EXTRA_CA_CERTS', path.join(TMP, 'no-such-' + marker + '.pem')],
    ['HTTPS_PROXY', 'http://127.0.0.1:9/' + marker],
    ['HTTP_PROXY', 'http://127.0.0.1:9/' + marker],
    ['NODE_USE_ENV_PROXY', '1'],
    ['NODE_OPTIONS', '--use-openssl-ca']
  ]
  for (const [name, value] of cases) {
    const child = runChild(['--port', String(await freePort())], { STOCKD_ENV_FILE: FAKE_FILE, [name]: value })
    const box = collectOutput(child)
    const code = await exitWithin(box, child, 8000)
    record('log', box.out)
    assert.equal(code, 1, name)
    const ours = box.out.split(/\r?\n/).filter((l) => l.includes('시작하지 못했습니다'))
    assert.equal(ours.length, 1, name)
    assert.ok(ours[0].includes(name), name + ' 이름 안내')
    assert.ok(!ours[0].includes(marker) && !ours[0].includes('127.0.0.1:9'), name + ' 값 비출력')
    assert.ok(!box.out.includes('주소:'), name + ' 서버 미시작')
  }

  // 위험한 변수가 없으면 운영 진입점이 정상 시작 (호출은 하지 않고 시작·종료만 확인)
  const port = await freePort()
  const ok = runChild(['--port', String(port)], { STOCKD_ENV_FILE: FAKE_FILE })
  const okBox = collectOutput(ok)
  try {
    await waitFor(() => okBox.out.includes('키 파일:'), 8000)
    assert.match(okBox.out, /키 파일: 로드됨/)
    assert.ok(!okBox.out.includes('시험용 주소'), '운영 모드는 시험용 주소 문구가 없음')
  } finally {
    ok.kill()
    await okBox.exited
  }
  record('log', okBox.out)

  // 시험용 주소(가짜 키) 모드는 시작을 막지 않고 경고만 한다
  const stub = createStub({ fakeAccess: FAKE_ACCESS, fakeSecret: FAKE_SECRET })
  const baseUrl = await stub.start()
  const warnChild = runTestServer(['--port', String(await freePort()), '--key-file', FAKE_FILE, '--base-url', baseUrl], {
    NODE_TLS_REJECT_UNAUTHORIZED: '0'
  })
  const warnBox = collectOutput(warnChild)
  try {
    await waitFor(() => warnBox.out.includes('경고:'), 8000)
    assert.ok(warnBox.out.includes('NODE_TLS_REJECT_UNAUTHORIZED'))
    warnChild.stdin.write('shutdown\n')
    assert.equal(await exitWithin(warnBox, warnChild, 8000), 0)
  } finally {
    warnChild.kill()
    await warnBox.exited
    await stub.stop()
  }
})

T('T-RATE-4', 'vendorId 를 바꿔 8번 보내도 전역 초당 3회를 넘지 않음 (가짜 키·stub)', async () => {
  await withEnv({}, async (env) => {
    const t0 = env.clock.now()
    for (let i = 0; i < 8; i += 1) {
      const r = await env.api('/api/check', { vendorId: 'A000100' + i })
      assert.equal(r.status, 200, 'vendor ' + i)
    }
    assert.equal(env.stub.count(), 8)
    const times = env.stub.state.requests.map((x) => x.at)
    for (let i = 0; i < times.length; i += 1) {
      const inWindow = times.filter((t) => t >= times[i] && t < times[i] + 1000).length
      assert.ok(inWindow <= 3, '1초 창 안 호출 ' + inWindow + '회')
    }
    assert.ok(env.clock.now() - t0 >= 2000, '전역 간격 대기가 있어야 함')
    const vendors = new Set(env.stub.state.requests.map((x) => x.vendorHeader))
    assert.equal(vendors.size, 8)
  })
  // 같은 vendorId 한도도 그대로 유지 (T-RATE-1 과 동일한 창 검사를 단위로 확인)
  const clock = makeClock(1000000)
  const guard = createGuard({ clock, sleep: clock.sleep })
  const stamps = []
  for (let i = 0; i < 9; i += 1) {
    await guard.beforeCall(i % 2 === 0 ? 'A0000001' : 'A0000002', {})
    stamps.push(clock.now())
  }
  for (const t of stamps) {
    assert.ok(stamps.filter((x) => x >= t && x < t + 1000).length <= 3)
  }
})

T('T-MASK-2', '마스킹 변형(소문자·base64·hex·제로폭·일부·줄 분할)과 업스트림 메시지 폐기', () => {
  const masker = createMasker()
  masker.addSecret(FAKE_ACCESS)
  masker.addSecret(FAKE_SECRET)
  const hex = (v) => Buffer.from(v, 'utf8').toString('hex')
  for (const secret of [FAKE_ACCESS, FAKE_SECRET]) {
    const forms = [
      secret.toLowerCase(),
      secret.toUpperCase(),
      Buffer.from(secret).toString('base64'),
      Buffer.from(secret).toString('base64url'),
      hex(secret),
      secret.slice(0, 10) + '​' + secret.slice(10),
      secret.slice(0, 5) + '‍⁠' + secret.slice(5)
    ]
    // 문자열 중간에 놓인 base64 (정렬 0·1·2바이트 어긋남)
    for (const prefix of ['', 'x', 'xy']) {
      const b64 = Buffer.from(prefix + secret).toString('base64')
      forms.push('tok=' + b64 + ';')
    }
    for (const form of forms) {
      const out = masker.mask('앞 ' + form + ' 뒤')
      assert.ok(!out.toLowerCase().includes(secret.toLowerCase().slice(0, 12)), form)
      assert.ok(!out.includes(Buffer.from(secret).toString('base64').slice(0, 12)), form)
      assert.ok(!out.includes(hex(secret).slice(0, 12)), form)
      assert.ok(out.includes('[가림]'), form)
    }
  }
  // 정상 문장은 그대로
  assert.equal(masker.mask('상품 재고 12개 · invalid signature'), '상품 재고 12개 · invalid signature')

  // 조각 검사: 8자 이상 연속 일치(대소문자·공백·줄바꿈·제로폭 무시)
  const sec = FAKE_SECRET
  const fragments = [
    sec.slice(0, 8),
    sec.slice(0, 8).toLowerCase(),
    sec.slice(5, 14),
    sec.slice(0, 4) + '\n' + sec.slice(4, 12),
    sec.slice(0, 6) + '​' + sec.slice(6, 14),
    Buffer.from(sec).toString('base64').slice(2, 14),
    hex(sec).slice(4, 16),
    FAKE_ACCESS.slice(3, 12)
  ]
  for (const f of fragments) {
    assert.equal(masker.hasSecretFragment('error: ' + f + ' end'), true, f)
  }
  for (const benign of ['Forbidden', 'invalid signature', 'IP not allowed for vendor', '요청 한도를 넘었습니다', 'x'.repeat(40), '']) {
    assert.equal(masker.hasSecretFragment(benign), false, benign)
  }
  // 서명(64자리 hex)의 조각도 대상
  const sig = 'c3'.repeat(32)
  masker.addRecent(sig)
  assert.equal(masker.hasSecretFragment('x ' + sig.slice(10, 20)), true)

  // cleanUpstreamMessage: 조각이 있으면 통째로 폐기하고 일반 문구, 없으면 정제 후 전달
  const mk = (message) => JSON.stringify({ code: 403, message })
  for (const f of fragments) {
    const out = cleanUpstreamMessage(mk('denied ' + f), masker.mask, masker.hasSecretFragment)
    assert.equal(out, GENERIC_UPSTREAM_MESSAGE, f)
    assert.ok(!out.includes(f))
  }
  assert.equal(cleanUpstreamMessage(mk('Forbidden\nby policy'), masker.mask, masker.hasSecretFragment), 'Forbidden by policy')
  assert.equal(cleanUpstreamMessage('not json', masker.mask, masker.hasSecretFragment), null)

  // 서버 경유: 키 앞 8자(소문자)만 에코해도 화면 응답에는 일반 문구만
})

T('T-MASK-3', '쿠팡 오류가 키 일부(소문자·줄 분할)를 되돌려 줘도 화면 응답·로그에 조각이 없음', async () => {
  await withEnv({}, async (env) => {
    const piece = FAKE_SECRET.slice(0, 10).toLowerCase()
    env.stub.setOverride(() => ({
      status: 500,
      body: { code: 500, message: 'oops ' + piece.slice(0, 5) + '\n' + piece.slice(5) + ' trailing' }
    }))
    const r = await env.api('/api/check', { vendorId: VENDOR })
    assert.equal(r.status, 502)
    assert.equal(r.json.error.upstreamMessage, GENERIC_UPSTREAM_MESSAGE)
    assert.ok(!r.text.toLowerCase().includes(piece))
    assert.ok(!env.lines.join('\n').toLowerCase().includes(piece))
  })
})

T('T-L3', 'GET / 는 교차 출처 요청이면 토큰 없이 403 (Origin·Sec-Fetch-Site)', async () => {
  await withEnv({}, async (env) => {
    const host = '127.0.0.1:' + env.port
    const ownOrigin = 'http://127.0.0.1:' + env.port
    const blocked = [
      { Origin: 'http://evil.example' },
      { Origin: 'null' },
      { Origin: 'http://127.0.0.1:1' },
      { 'Sec-Fetch-Site': 'cross-site' },
      { 'Sec-Fetch-Site': 'same-site' },
      { Origin: ownOrigin, 'Sec-Fetch-Site': 'cross-site' }
    ]
    for (const extra of blocked) {
      for (const p of ['/', '/app.js', '/style.css']) {
        const r = await env.request({ path: p, headers: Object.assign({ Host: host }, extra) })
        assert.equal(r.status, 403, p + ' ' + JSON.stringify(extra))
        assert.ok(!r.text.includes(env.token), '토큰 비노출')
        assert.ok(!r.text.includes('session-token'))
      }
    }
    // 정상: 직접 주소 입력(none)·같은 출처·헤더 없음·허용 Origin
    for (const extra of [{}, { 'Sec-Fetch-Site': 'none' }, { 'Sec-Fetch-Site': 'same-origin' }, { Origin: ownOrigin }]) {
      const r = await env.request({ path: '/', headers: Object.assign({ Host: host }, extra) })
      assert.equal(r.status, 200, JSON.stringify(extra))
      assert.ok(r.text.includes(env.token))
    }
    // API 도 교차 출처 표시가 있으면 토큰이 맞아도 거부
    const crossGet = await env.request({
      path: '/api/status',
      headers: { Host: host, 'X-Session-Token': env.token, 'Sec-Fetch-Site': 'cross-site' }
    })
    assert.equal(crossGet.status, 403)
    const crossPost = await env.api('/api/unlock', {}, { headers: { 'Sec-Fetch-Site': 'same-site' } })
    assert.equal(crossPost.status, 403)
    const sameOk = await env.api('/api/unlock', {}, { headers: { 'Sec-Fetch-Site': 'same-origin' } })
    assert.equal(sameOk.status, 200)
  })
})

T('T-L4', '수동 잠금 해제는 잠긴 뒤 60초 대기, 서버 실행당 2회까지 (그 뒤는 서버 재시작 요구)', async () => {
  await withEnv({}, async (env) => {
    const failTwice = async () => {
      env.stub.setOverride(() => ({ status: 500, body: { message: 'server error' } }))
      await env.api('/api/check', { vendorId: VENDOR })
      const second = await env.api('/api/check', { vendorId: VENDOR })
      env.stub.setOverride(null)
      return second
    }
    // 1회차: 잠금 직후 해제 시도는 대기 안내와 함께 거부
    const locked = await failTwice()
    assert.equal(locked.json.lock.state, 'manual')
    assert.equal(env.stub.count(), 2)
    const remain = Date.parse(locked.json.lock.unlockAvailableAt) - env.clock.now()
    assert.ok(remain > 58000 && remain <= 60000, '해제 가능 시각 안내: ' + remain)
    assert.equal(locked.json.lock.unlocksLeft, 2)
    const early = await env.api('/api/unlock', {})
    assert.equal(early.status, 423)
    assert.equal(early.json.ok, false)
    assert.equal(early.json.error.code, 'UNLOCK_WAIT')
    assert.match(early.json.error.message, /^잠금 해제는 \d+초 뒤에 할 수 있습니다\.$/)
    assert.equal(early.json.lock.state, 'manual')
    env.clock.advance(59000)
    assert.equal((await env.api('/api/unlock', {})).json.error.code, 'UNLOCK_WAIT')
    assert.equal((await env.api('/api/check', { vendorId: VENDOR })).status, 423)
    assert.equal(env.stub.count(), 2, '잠금 중에는 쿠팡 호출 없음')
    env.clock.advance(1000)
    const first = await env.api('/api/unlock', {})
    assert.equal(first.status, 200)
    assert.equal(first.json.data.lock.state, 'none')
    // 2회차
    const locked2 = await failTwice()
    assert.equal(locked2.json.lock.state, 'manual')
    assert.equal(locked2.json.lock.unlocksLeft, 1)
    assert.equal((await env.api('/api/unlock', {})).json.error.code, 'UNLOCK_WAIT')
    env.clock.advance(61000)
    assert.equal((await env.api('/api/unlock', {})).status, 200)
    // 3회차: 횟수 소진 → 시간이 아무리 지나도 해제되지 않음
    const locked3 = await failTwice()
    assert.equal(locked3.json.lock.state, 'manual')
    assert.equal(locked3.json.lock.unlocksLeft, 0)
    env.clock.advance(24 * 3600 * 1000)
    const limit = await env.api('/api/unlock', {})
    assert.equal(limit.status, 423)
    assert.equal(limit.json.error.code, 'UNLOCK_LIMIT')
    assert.ok(limit.json.error.hint.includes('서버를 다시 실행'))
    const still = await env.api('/api/check', { vendorId: VENDOR })
    assert.equal(still.json.error.code, 'LOCKED_MANUAL')
    assert.equal(env.stub.count(), 6, '해제 반복에도 실패 호출은 총 6회 이하(쌍당 2회 × 3)')
    const st = await env.get('/api/status')
    assert.equal(st.json.data.lock.state, 'manual')
  })
  await withEnv({}, async (env) => {
    const none = await env.api('/api/unlock', {})
    assert.equal(none.status, 200)
    assert.deepEqual(none.json.data.lock, { state: 'none', until: null, reasonCode: null })
  })
})

T('T-L7', '시작 실패 메시지는 고정 문구만 내보내고 마스킹을 거침', () => {
  const { StartupError } = require(path.join(ROOT, 'lib', 'errors.cjs'))
  const { formatStartupFailure } = require(path.join(ROOT, 'server.cjs'))
  // 알 수 없는 예외의 message 는 출력하지 않는다
  assert.equal(formatStartupFailure(new Error('비밀 ' + FAKE_SECRET)), '시작하지 못했습니다: 알 수 없는 오류')
  assert.equal(formatStartupFailure('문자열 ' + FAKE_SECRET), '시작하지 못했습니다: 알 수 없는 오류')
  // 고정 문구 예외도 서명·Authorization 패턴은 가린다
  const out = formatStartupFailure(new StartupError('x signature=' + 'ab'.repeat(16) + ' CEA algorithm=HmacSHA256, access-key=ZZZ'))
  assert.ok(!out.includes('abab') && !out.includes('CEA algorithm'))
  assert.ok(out.includes('[가림]'))
  assert.equal(formatStartupFailure(new StartupError('고정 문구')), '시작하지 못했습니다: 고정 문구')
})


// ======================= 최종 유출 검사 =======================

T('T-LEAK-1', '전 시험 중 수집한 응답 본문·헤더·로그에 키·서명·Authorization 이 0건', () => {
  const needles = [FAKE_ACCESS, FAKE_SECRET, 'CEA algorithm']
  for (const s of stubSecrets) {
    needles.push(s)
  }
  assert.ok(collected.length > 50, '수집량이 충분해야 함: ' + collected.length)
  assert.ok(stubSecrets.size > 10, 'stub 이 받은 서명이 있어야 함')
  let hits = 0
  for (const c of collected) {
    for (const needle of needles) {
      if (c.text.includes(needle)) {
        hits += 1
      }
    }
    if ((c.kind === 'header' || c.kind === 'log') && /authorization/i.test(c.text)) {
      hits += 1
    }
    if (c.kind !== 'header' && /signature=[0-9a-f]{16,}/i.test(c.text)) {
      hits += 1
    }
  }
  assert.equal(hits, 0)
})

// ======================= 실행 =======================

function scrub(text) {
  let out = String(text)
  for (const s of [FAKE_ACCESS, FAKE_SECRET].concat(Array.from(stubSecrets))) {
    if (s && s.length >= 4) {
      out = out.split(s).join('[가림]')
    }
  }
  return out
}

async function main() {
  const results = []
  let passed = 0
  let failed = 0
  for (const t of tests) {
    const started = Date.now()
    try {
      await t.fn()
      passed += 1
      results.push({ id: t.id, name: t.name, ok: true, ms: Date.now() - started })
      console.log('PASS ' + t.id + ' ' + t.name)
    } catch (err) {
      failed += 1
      const message = scrub(err && err.stack ? err.stack.split('\n').slice(0, 6).join('\n') : String(err))
      results.push({ id: t.id, name: t.name, ok: false, ms: Date.now() - started, error: message })
      console.log('FAIL ' + t.id + ' ' + t.name + '\n' + message)
    }
  }
  const summary = {
    ranAt: new Date().toISOString(),
    node: process.version,
    total: tests.length,
    passed,
    failed,
    results
  }
  let json = JSON.stringify(summary, null, 2)
  // 결과 파일에 가짜 키 값이 들어가지 않게 마지막으로 한 번 더 가린다
  json = scrub(json)
  fs.writeFileSync(path.join(__dirname, 'results.json'), json + '\n')
  fs.rmSync(TMP, { recursive: true, force: true })
  console.log('\n통과 ' + passed + ' / 실패 ' + failed + ' / 전체 ' + tests.length)
  process.exit(failed === 0 ? 0 : 1)
}

main()
