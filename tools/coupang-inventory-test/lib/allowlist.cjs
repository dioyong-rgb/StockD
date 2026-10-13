'use strict'

const { AppError } = require('./errors.cjs')
const {
  toIdString,
  toNonNegativeInt,
  toDisplayString,
  toBooleanOrNull
} = require('./sanitize.cjs')

// ---- 입력 형식 (설계서 3장 S13, 추측 표기 부분은 느슨하게) ----
const VENDOR_ID_RE = /^A[0-9]{4,12}$/
const ID_RE = /^[1-9][0-9]{0,19}$/
const NEXT_TOKEN_RE = /^[A-Za-z0-9._~-]{1,256}$/
const MAX_PER_PAGE_LIMIT = 20

const SELLER_BASE = '/v2/providers/seller_api/apis/api/v1/marketplace'
const RG_BASE = '/v2/providers/rg_open_api/apis/api/v1/vendors'

function validateVendorId(value) {
  if (typeof value !== 'string' || !VENDOR_ID_RE.test(value)) {
    throw new AppError('INVALID_INPUT', { field: 'vendorId' })
  }
  return value
}

// 숫자 ID: 문자열 또는 안전 정수만 받아 문자열로 통일
function validateNumericId(value, field) {
  let text = value
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    text = String(value)
  }
  if (typeof text !== 'string' || !ID_RE.test(text)) {
    throw new AppError('INVALID_INPUT', { field })
  }
  return text
}

function validateNextToken(value) {
  if (typeof value !== 'string' || !NEXT_TOKEN_RE.test(value)) {
    throw new AppError('INVALID_INPUT', { field: 'nextToken' })
  }
  return value
}

function validateMaxPerPage(value) {
  let n = value
  if (typeof value === 'string' && /^[0-9]{1,3}$/.test(value)) {
    n = Number(value)
  }
  if (!Number.isInteger(n) || n < 1 || n > MAX_PER_PAGE_LIMIT) {
    throw new AppError('INVALID_INPUT', { field: 'maxPerPage' })
  }
  return String(n)
}

// 응답의 nextToken 정규화: null·빈 문자열·"null" 은 끝
function normalizeNextToken(value) {
  let v = value
  if (v === null || v === undefined) {
    return { value: null }
  }
  if (typeof v === 'number' && Number.isSafeInteger(v)) {
    v = String(v)
  }
  if (typeof v !== 'string') {
    return { error: 'NEXT_TOKEN_UNSUPPORTED' }
  }
  const t = v.trim()
  if (t === '' || t === 'null') {
    return { value: null }
  }
  if (!NEXT_TOKEN_RE.test(t)) {
    return { error: 'NEXT_TOKEN_UNSUPPORTED' }
  }
  return { value: t }
}

// 성공 판정: envelope code 가 숫자 200 또는 문자열 SUCCESS
function envelopeOk(body) {
  return Boolean(body) && typeof body === 'object' && (body.code === 200 || body.code === 'SUCCESS')
}

// ---- projection (남길 필드만 새 객체로 복사) ----

function projectSellerProducts(body) {
  const list = body.data === null || body.data === undefined ? [] : body.data
  if (!Array.isArray(list)) {
    return { errorCode: 'RESPONSE_PARSE' }
  }
  const items = []
  for (const row of list) {
    if (!row || typeof row !== 'object') {
      continue
    }
    const id = toIdString(row.sellerProductId)
    if (id === null) {
      continue
    }
    items.push({
      sellerProductId: id,
      sellerProductName: toDisplayString(row.sellerProductName),
      statusName: toDisplayString(row.statusName, 60)
    })
  }
  const token = normalizeNextToken(body.nextToken)
  if (token.error) {
    return { errorCode: token.error }
  }
  return { data: { items, nextToken: token.value } }
}

function projectSellerProduct(body, req) {
  const data = body.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { errorCode: 'RESPONSE_PARSE' }
  }
  const rawItems = data.items === null || data.items === undefined ? [] : data.items
  if (!Array.isArray(rawItems)) {
    return { errorCode: 'RESPONSE_PARSE' }
  }
  const items = []
  for (const row of rawItems) {
    if (!row || typeof row !== 'object') {
      continue
    }
    items.push({
      sellerProductItemId: toIdString(row.sellerProductItemId),
      vendorItemId: toIdString(row.vendorItemId),
      itemName: toDisplayString(row.itemName)
    })
  }
  return {
    data: {
      sellerProductId: toIdString(data.sellerProductId) || req.params.sellerProductId,
      sellerProductName: toDisplayString(data.sellerProductName),
      items
    }
  }
}

function projectSellerInventory(body) {
  const data = body.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { errorCode: 'RESPONSE_PARSE' }
  }
  const amount = toNonNegativeInt(data.amountInStock)
  const result = { amountInStock: amount, onSale: toBooleanOrNull(data.onSale) }
  if (amount === null) {
    result.fieldError = 'TYPE'
  }
  return { data: result }
}

function projectRgInventory(body) {
  const list = body.data === null || body.data === undefined ? [] : body.data
  if (!Array.isArray(list)) {
    return { errorCode: 'RESPONSE_PARSE' }
  }
  const items = []
  for (const row of list) {
    if (!row || typeof row !== 'object') {
      continue
    }
    const id = toIdString(row.vendorItemId)
    if (id === null) {
      continue
    }
    const details = row.inventoryDetails && typeof row.inventoryDetails === 'object' ? row.inventoryDetails : {}
    const qty = toNonNegativeInt(details.totalOrderableQuantity)
    const item = { vendorItemId: id, totalOrderableQuantity: qty }
    if (qty === null) {
      item.fieldError = 'TYPE'
    }
    items.push(item)
  }
  const token = normalizeNextToken(body.nextToken)
  if (token.error) {
    return { errorCode: token.error }
  }
  return { data: { items, nextToken: token.value } }
}

// ---- 허용 목록 (GET 4종) ----
// params: 허용 입력 키, query: 쿼리 키 순서(서명·전송 모두 이 순서), path: 경로 조립
const ENTRIES = {
  'seller.products': {
    pathRegex: /^\/v2\/providers\/seller_api\/apis\/api\/v1\/marketplace\/seller-products$/,
    allowedParams: ['vendorId', 'nextToken', 'maxPerPage'],
    queryKeys: ['vendorId', 'nextToken', 'maxPerPage'],
    requiredQuery: ['vendorId'],
    buildPath() {
      return SELLER_BASE + '/seller-products'
    },
    normalize(params) {
      return {
        vendorId: validateVendorId(params.vendorId),
        nextToken: params.nextToken === undefined ? undefined : validateNextToken(params.nextToken),
        maxPerPage: params.maxPerPage === undefined ? undefined : validateMaxPerPage(params.maxPerPage)
      }
    },
    project: projectSellerProducts
  },
  'seller.product': {
    pathRegex: /^\/v2\/providers\/seller_api\/apis\/api\/v1\/marketplace\/seller-products\/[1-9][0-9]{0,19}$/,
    allowedParams: ['vendorId', 'sellerProductId'],
    queryKeys: [],
    requiredQuery: [],
    buildPath(p) {
      return SELLER_BASE + '/seller-products/' + p.sellerProductId
    },
    normalize(params) {
      return {
        vendorId: validateVendorId(params.vendorId),
        sellerProductId: validateNumericId(params.sellerProductId, 'sellerProductId')
      }
    },
    project: projectSellerProduct
  },
  'seller.inventory': {
    pathRegex: /^\/v2\/providers\/seller_api\/apis\/api\/v1\/marketplace\/vendor-items\/[1-9][0-9]{0,19}\/inventories$/,
    allowedParams: ['vendorId', 'vendorItemId'],
    queryKeys: [],
    requiredQuery: [],
    buildPath(p) {
      return SELLER_BASE + '/vendor-items/' + p.vendorItemId + '/inventories'
    },
    normalize(params) {
      return {
        vendorId: validateVendorId(params.vendorId),
        vendorItemId: validateNumericId(params.vendorItemId, 'vendorItemId')
      }
    },
    project: projectSellerInventory
  },
  'rg.inventory': {
    pathRegex: /^\/v2\/providers\/rg_open_api\/apis\/api\/v1\/vendors\/A[0-9]{4,12}\/rg\/inventory\/summaries$/,
    allowedParams: ['vendorId', 'vendorItemId', 'nextToken'],
    queryKeys: ['vendorItemId', 'nextToken'],
    requiredQuery: [],
    buildPath(p) {
      return RG_BASE + '/' + p.vendorId + '/rg/inventory/summaries'
    },
    normalize(params) {
      // vendorItemId 와 nextToken 은 동시에 지정할 수 없다
      if (params.vendorItemId !== undefined && params.nextToken !== undefined) {
        throw new AppError('INVALID_INPUT', { field: 'nextToken' })
      }
      return {
        vendorId: validateVendorId(params.vendorId),
        vendorItemId: params.vendorItemId === undefined ? undefined : validateNumericId(params.vendorItemId, 'vendorItemId'),
        nextToken: params.nextToken === undefined ? undefined : validateNextToken(params.nextToken)
      }
    },
    project: projectRgInventory
  }
}

function isAllowedName(name) {
  return typeof name === 'string' && Object.prototype.hasOwnProperty.call(ENTRIES, name)
}

// 허용 이름 + 검증된 값으로 경로·쿼리 문자열을 서버가 조립한다.
function buildRequest(name, params) {
  if (!isAllowedName(name)) {
    throw new AppError('NOT_ALLOWED')
  }
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    throw new AppError('NOT_ALLOWED')
  }
  const entry = ENTRIES[name]
  for (const key of Object.keys(params)) {
    if (!entry.allowedParams.includes(key)) {
      throw new AppError('NOT_ALLOWED')
    }
  }
  const normalized = entry.normalize(params)
  const parts = []
  for (const key of entry.queryKeys) {
    if (normalized[key] !== undefined) {
      parts.push(key + '=' + encodeURIComponent(normalized[key]))
    }
  }
  return {
    name,
    method: 'GET',
    vendorId: normalized.vendorId,
    params: normalized,
    path: entry.buildPath(normalized),
    queryString: parts.join('&')
  }
}

// 전송 직전 재검사: GET · 호스트 · 경로 정규식 · 쿼리 키(순서·중복·형식)
function verifyRequest(req, allowedHostname) {
  if (!req || !isAllowedName(req.name)) {
    throw new AppError('NOT_ALLOWED')
  }
  const entry = ENTRIES[req.name]
  if (req.method !== 'GET') {
    throw new AppError('NOT_ALLOWED')
  }
  if (typeof req.hostname !== 'string' || req.hostname !== allowedHostname) {
    throw new AppError('NOT_ALLOWED')
  }
  if (typeof req.path !== 'string' || !entry.pathRegex.test(req.path)) {
    throw new AppError('NOT_ALLOWED')
  }
  const query = req.queryString
  if (typeof query !== 'string' || query.length > 1000) {
    throw new AppError('NOT_ALLOWED')
  }
  const seen = []
  if (query !== '') {
    let lastIndex = -1
    for (const pair of query.split('&')) {
      const m = /^([A-Za-z]+)=([A-Za-z0-9._~-]+)$/.exec(pair)
      if (!m) {
        throw new AppError('NOT_ALLOWED')
      }
      const index = entry.queryKeys.indexOf(m[1])
      if (index === -1 || index <= lastIndex) {
        throw new AppError('NOT_ALLOWED')
      }
      lastIndex = index
      seen.push(m[1])
    }
  }
  for (const key of entry.requiredQuery) {
    if (!seen.includes(key)) {
      throw new AppError('NOT_ALLOWED')
    }
  }
  return true
}

module.exports = {
  ENTRIES,
  buildRequest,
  verifyRequest,
  isAllowedName,
  validateVendorId,
  validateNumericId,
  validateNextToken,
  validateMaxPerPage,
  envelopeOk,
  VENDOR_ID_RE,
  ID_RE,
  NEXT_TOKEN_RE,
  MAX_PER_PAGE_LIMIT
}
