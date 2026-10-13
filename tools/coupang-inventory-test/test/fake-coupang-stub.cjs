'use strict'

// 가짜 쿠팡 서버 (시험 전용, 127.0.0.1 임의 포트).
// 받은 요청의 서명을 서버 코드와 별개로 다시 계산해 검증한다.

const http = require('node:http')
const crypto = require('node:crypto')

const AUTH_RE = /^CEA algorithm=HmacSHA256, access-key=([^,\s]+), signed-date=(\d{6}T\d{6}Z), signature=([0-9a-f]{64})$/

function createStub(config) {
  const fakeAccess = config.fakeAccess
  const fakeSecret = config.fakeSecret
  const nowFn = config.now || (() => Date.now())

  const state = {
    requests: [], // { index, method, path, query, at, sigOk, formatOk, vendorHeader }
    override: null, // (info) => { status, body, raw, delayMs } | null
    seenSecrets: [] // 받은 Authorization·signature (유출 검사용)
  }
  const sockets = new Set()

  function ok(body) {
    return { status: 200, body }
  }

  function defaultResponse(info) {
    const { path, query } = info
    if (/\/seller-products$/.test(path)) {
      const row = {
        sellerProductId: 11111,
        sellerProductName: '테스트 상품 A',
        statusName: '승인완료',
        vendorId: 'A0001234',
        mdId: 'md-secret-field',
        brand: '브랜드'
      }
      const hasToken = /nextToken=/.test(query)
      const rows = /maxPerPage=1(&|$)/.test(query) ? [row] : [row, Object.assign({}, row, { sellerProductId: 22222, sellerProductName: '테스트 상품 B' })]
      return ok({ code: 200, message: 'OK', data: rows, nextToken: hasToken ? '' : '2' })
    }
    const detail = /\/seller-products\/(\d+)$/.exec(path)
    if (detail) {
      return ok({
        code: 200,
        message: 'OK',
        data: {
          sellerProductId: Number(detail[1]),
          sellerProductName: '테스트 상품 ' + detail[1],
          statusName: '승인완료',
          items: [
            { sellerProductItemId: 501, vendorItemId: 90000001, itemName: '옵션 1', salePrice: 1000, maximumBuyCount: 5 },
            { sellerProductItemId: 502, vendorItemId: null, itemName: '임시저장 옵션', salePrice: 2000, maximumBuyCount: 0 }
          ]
        }
      })
    }
    const inv = /\/vendor-items\/(\d+)\/inventories$/.exec(path)
    if (inv) {
      return ok({
        code: 'SUCCESS',
        message: 'OK',
        data: { sellerItemId: 1, amountInStock: Number(inv[1]) % 100, salePrice: 12345, onSale: true }
      })
    }
    if (/\/rg\/inventory\/summaries$/.test(path)) {
      return ok({
        code: 200,
        message: 'OK',
        data: [
          {
            vendorId: 'A0001234',
            vendorItemId: 90000001,
            externalSkuId: 'sku-x',
            inventoryDetails: { totalOrderableQuantity: 7 },
            salesCountMap: { SALES_COUNT_LAST_THIRTY_DAYS: 3 }
          }
        ],
        nextToken: null
      })
    }
    return { status: 404, body: { code: 404, message: 'not found' } }
  }

  const server = http.createServer((req, res) => {
    const at = nowFn()
    const rawUrl = req.url || ''
    const q = rawUrl.indexOf('?')
    const path = q === -1 ? rawUrl : rawUrl.slice(0, q)
    const query = q === -1 ? '' : rawUrl.slice(q + 1)
    const authorization = String(req.headers.authorization || '')
    const m = AUTH_RE.exec(authorization)
    let sigOk = false
    if (m && m[1] === fakeAccess) {
      const expected = crypto.createHmac('sha256', fakeSecret).update(m[2] + req.method + path + query, 'utf8').digest('hex')
      sigOk = expected === m[3]
    }
    if (authorization) {
      state.seenSecrets.push(authorization)
    }
    if (m) {
      state.seenSecrets.push(m[3])
    }
    const info = {
      index: state.requests.length + 1,
      method: req.method,
      path,
      query,
      at,
      sigOk,
      formatOk: Boolean(m),
      vendorHeader: req.headers['x-requested-by'] || null,
      authorization
    }
    state.requests.push(info)

    let response
    if (!sigOk) {
      response = { status: 401, body: { code: 401, message: 'invalid signature' } }
    } else {
      response = (state.override && state.override(info)) || defaultResponse(info)
    }
    const send = () => {
      if (res.destroyed) {
        return
      }
      const text = response.raw !== undefined ? response.raw : JSON.stringify(response.body)
      res.writeHead(response.status, { 'Content-Type': 'application/json' })
      res.end(text)
    }
    if (response.delayMs) {
      setTimeout(send, response.delayMs)
    } else {
      send()
    }
  })
  server.on('connection', (socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    socket.on('error', () => {})
  })

  return {
    state,
    start() {
      return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          resolve('http://127.0.0.1:' + server.address().port)
        })
      })
    },
    stop() {
      return new Promise((resolve) => {
        for (const s of sockets) {
          s.destroy()
        }
        server.close(() => resolve())
      })
    },
    setOverride(fn) {
      state.override = fn
    },
    reset() {
      state.requests.length = 0
      state.override = null
    },
    count() {
      return state.requests.length
    }
  }
}

module.exports = { createStub }
