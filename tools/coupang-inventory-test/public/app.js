'use strict'

// 쿠팡 재고 조회 로컬 테스트 화면
// - 같은 출처의 /api/* 와 fetch 로만 통신한다. 키·서명 같은 값은 만들지도 표시하지도 않는다.
// - 서버가 준 문자열은 모두 textContent 로만 넣는다(innerHTML 사용 금지).
// - 브라우저 저장소(localStorage 등)와 쿠키는 쓰지 않는다. 새로고침하면 모두 사라진다.

const MAX_BATCH = 20
const MAX_LOG = 100

// 수량 종류 라벨(합산하지 않는다)
const QTY_LABEL = { seller: '채널 등록 재고', rg: '주문가능 재고' }
const KIND_LABEL = { seller: '판매자배송', rg: '로켓그로스' }

// 설계서 6.3 의 오류 코드별 짧은 문구(옵션별 실패 원인 표시용)
const ERROR_SHORT = {
  COUPANG_AUTH: '쿠팡 인증 실패(401)',
  COUPANG_FORBIDDEN: '쿠팡 거부(403)',
  COUPANG_NOT_FOUND: '대상 없음(404)',
  COUPANG_BAD_REQUEST: '요청 형식 거부(400)',
  COUPANG_RATE_LIMIT: '호출 한도 초과(429)',
  COUPANG_SERVER: '쿠팡 서버 오류(5xx)',
  COUPANG_UNEXPECTED: '예상 밖 응답',
  TIMEOUT: '응답 시간 초과',
  NETWORK: '연결 실패',
  RESPONSE_TOO_LARGE: '응답 너무 큼',
  RESPONSE_PARSE: '응답 해석 실패',
  LOCKED: '잠금 중',
  LOCKED_MANUAL: '잠금 중',
  BUSY: '다른 조회 진행 중',
  INTERNAL: '서버 내부 오류'
}

// 잠금 원인 후보 안내(가능성 표현만 사용)
const LOCK_CAUSE = {
  COUPANG_AUTH: '키 만료(발급 후 180일), 키 오타, PC 시계 오차 가능성이 있습니다.',
  COUPANG_FORBIDDEN: '이 PC의 공인 IP가 WING 키 설정에 등록되지 않았거나, 발급 후 24시간이 지나지 않았거나, 해당 API 권한이 없을 가능성이 있습니다.',
  COUPANG_NOT_FOUND: 'vendorId 또는 ID가 틀렸을 가능성이 있습니다. 잘못된 vendorId 반복 호출은 차단 위험이 있습니다.',
  COUPANG_BAD_REQUEST: '요청 형식이 맞지 않았을 수 있습니다. 반복하지 말고 담당자에게 알려 주세요.',
  COUPANG_RATE_LIMIT: '호출 한도를 넘었습니다. 잠금이 풀려도 수 분 이상 기다린 뒤 다시 시도하세요.'
}

const state = {
  hasToken: false,
  keyLoaded: null,
  keyError: null,
  busy: false,
  unlockCount: 0,
  // 서버가 UNLOCK_LIMIT 을 준 적이 있으면 true(새로고침 전까지 유지)
  unlockLimitHit: false,
  lock: { state: 'none', until: null, reasonCode: null, cooldownUntil: null, unlocksLeft: null },
  products: { items: [], nextToken: null, selectedId: null },
  options: { productId: null, productName: '', items: [] },
  rg: { nextToken: null },
  rows: [],
  calls: []
}

const $ = (id) => document.getElementById(id)

// 요소 생성 도우미: 문자열 자식은 항상 텍스트 노드로 들어간다
function h(tag, attrs, ...children) {
  const node = document.createElement(tag)
  if (attrs) {
    for (const key of Object.keys(attrs)) {
      const value = attrs[key]
      if (value === false || value === null || value === undefined) continue
      if (key === 'text') node.textContent = value
      else if (key === 'class') node.className = value
      else node.setAttribute(key, value === true ? '' : String(value))
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue
    node.append(child instanceof Node ? child : document.createTextNode(String(child)))
  }
  return node
}

// 세션 토큰은 이 클로저 안에만 둔다(window·DOM·콘솔·state 에 두지 않는다).
// meta 에서 읽은 즉시 meta 요소를 제거해 DOM 에 남지 않게 하고, 요청 헤더에서만 꺼내 쓴다.
const getSessionToken = (() => {
  let token = ''
  const meta = document.querySelector('meta[name="session-token"]')
  if (meta) {
    const value = meta.getAttribute('content') || ''
    // 서버가 치환하지 않은 자리표시자는 토큰이 아니다
    token = value && value !== '__SESSION_TOKEN__' ? value : ''
    meta.remove()
  }
  return () => token
})()

// ───── 서버 통신 ─────

// 항상 { ok, data, error } 형태로 돌려준다. 응답 원문은 콘솔에 남기지 않는다.
async function api(method, path, body) {
  const headers = { 'X-Session-Token': getSessionToken() }
  const init = { method, headers, credentials: 'same-origin', cache: 'no-store', redirect: 'error' }
  if (method === 'POST') {
    headers['Content-Type'] = 'application/json'
    init.body = JSON.stringify(body || {})
  }
  let payload = null
  try {
    const res = await fetch(path, init)
    payload = await res.json()
  } catch (err) {
    return {
      ok: false,
      error: {
        code: 'LOCAL_NETWORK',
        message: '로컬 서버에 연결하지 못했습니다.',
        hint: '서버(node server.cjs)가 실행 중인지 확인하고 페이지를 새로고침하세요.',
        upstreamMessage: ''
      }
    }
  }
  if (!payload || typeof payload !== 'object') {
    return { ok: false, error: { code: 'RESPONSE_PARSE', message: '응답을 해석하지 못했습니다.', hint: '', upstreamMessage: '' } }
  }
  if (Array.isArray(payload.calls)) addCalls(payload.calls)
  if (payload.lock) setLock(payload.lock, payload)
  else {
    const until = readCooldownUntil(payload)
    if (until) setCooldown(until)
  }
  if (payload.ok === true) return { ok: true, data: payload.data || {} }
  const error = payload.error && typeof payload.error === 'object' ? payload.error : {}
  return {
    ok: false,
    error: {
      code: typeof error.code === 'string' ? error.code : 'UNKNOWN',
      message: typeof error.message === 'string' ? error.message : '알 수 없는 오류입니다.',
      hint: typeof error.hint === 'string' ? error.hint : '',
      upstreamMessage: typeof error.upstreamMessage === 'string' ? error.upstreamMessage : ''
    }
  }
}

// ───── 잠금 ─────

let lockTimer = null

function lockRemainingSec() {
  if (state.lock.state !== 'timed' || !state.lock.until) return 0
  const ms = Date.parse(state.lock.until) - Date.now()
  return Number.isFinite(ms) && ms > 0 ? Math.ceil(ms / 1000) : 0
}

// 해제 횟수를 모두 쓴 상태인지(서버 unlocksLeft 가 0 이거나 UNLOCK_LIMIT 응답을 받은 경우)
function isUnlockExhausted() {
  return state.unlockLimitHit || state.lock.unlocksLeft === 0
}

function isLocked() {
  return state.lock.state === 'manual' || (state.lock.state === 'timed' && lockRemainingSec() > 0)
}

// ───── 해제 후 쿨다운(서버가 알려 줄 때만 표시) ─────
// 백엔드 필드명이 확정되기 전이라 후보 이름을 방어적으로 읽는다. 없으면 아무것도 표시하지 않는다.

let cooldownTimer = null

function secToIso(sec) {
  return Number.isFinite(sec) && sec > 0 ? new Date(Date.now() + sec * 1000).toISOString() : null
}

function readCooldownUntil(source) {
  if (!source || typeof source !== 'object') return null
  const raw = source.cooldown
  const candidates = [source.cooldownUntil, source.unlockAvailableAt, source.nextUnlockAt]
  if (typeof raw === 'string') candidates.push(raw)
  if (raw && typeof raw === 'object') candidates.push(raw.until, raw.cooldownUntil)
  for (const value of candidates) {
    if (typeof value === 'string' && Number.isFinite(Date.parse(value))) return value
  }
  const secs = [source.cooldownSec, source.cooldownSeconds, source.retryAfterSec]
  if (typeof raw === 'number') secs.push(raw)
  if (raw && typeof raw === 'object') secs.push(raw.seconds, raw.sec, raw.remainingSec)
  for (const value of secs) {
    const iso = secToIso(value)
    if (iso) return iso
  }
  return null
}

function cooldownRemainingSec() {
  if (!state.lock.cooldownUntil) return 0
  const ms = Date.parse(state.lock.cooldownUntil) - Date.now()
  return Number.isFinite(ms) && ms > 0 ? Math.ceil(ms / 1000) : 0
}

function renderCooldown() {
  const sec = cooldownRemainingSec()
  $('cooldown-alert').hidden = sec <= 0
  if (sec > 0) {
    $('cooldown-text').textContent = '서버가 잠금 해제 후 대기 시간을 두고 있습니다. 약 ' + sec + '초 뒤에 다시 시도할 수 있습니다. 그 전에는 호출이나 해제가 거절될 수 있습니다.'
  }
  if (sec <= 0 && cooldownTimer) {
    clearInterval(cooldownTimer)
    cooldownTimer = null
    state.lock.cooldownUntil = null
    updateControls()
  }
}

function setCooldown(until) {
  state.lock.cooldownUntil = until
  if (cooldownTimer) {
    clearInterval(cooldownTimer)
    cooldownTimer = null
  }
  if (until && cooldownRemainingSec() > 0) cooldownTimer = setInterval(renderCooldown, 1000)
  renderCooldown()
}

function setLock(lock, cooldownSource) {
  state.lock = {
    state: lock && ['none', 'timed', 'manual'].includes(lock.state) ? lock.state : 'none',
    until: lock && typeof lock.until === 'string' ? lock.until : null,
    reasonCode: lock && typeof lock.reasonCode === 'string' ? lock.reasonCode : null,
    cooldownUntil: state.lock.cooldownUntil,
    // 서버가 정수로 알려 줄 때만 갱신하고, 없으면 이전 값을 유지한다
    unlocksLeft: lock && Number.isInteger(lock.unlocksLeft) ? lock.unlocksLeft : state.lock.unlocksLeft
  }
  // lock 객체 또는 응답 최상위에 쿨다운 정보가 있을 때만 갱신한다
  const found = readCooldownUntil(lock) || readCooldownUntil(cooldownSource)
  if (found) setCooldown(found)
  if (lockTimer) {
    clearInterval(lockTimer)
    lockTimer = null
  }
  if (state.lock.state === 'timed') lockTimer = setInterval(tickLock, 1000)
  renderLock()
  updateControls()
}

async function tickLock() {
  if (lockRemainingSec() > 0) {
    renderLock()
    return
  }
  // 시간 잠금이 끝났으면 서버 상태로 다시 확인한다
  clearInterval(lockTimer)
  lockTimer = null
  await loadStatus()
}

function renderLock() {
  const locked = isLocked()
  $('lock-alert').hidden = !locked
  const stateText = $('st-lock')
  if (!locked) {
    stateText.textContent = '없음'
    return
  }
  if (state.lock.state === 'manual') {
    $('lock-title').textContent = '연속 실패로 쿠팡 호출을 멈췄습니다.'
    $('lock-detail').textContent = isUnlockExhausted()
      ? '해제 횟수를 모두 사용했습니다. 원인(공인 IP 등록·키 만료·vendorId 등)을 해결한 뒤 서버를 다시 실행하세요.'
      : '원인을 확인한 뒤 "잠금 해제"를 눌러야 다시 호출할 수 있습니다. 해제한 뒤에도 서버가 일정 시간 대기(쿨다운)를 둘 수 있고, 해제를 반복해서 누르면 쿠팡이 이 PC를 차단할 수 있습니다.'
    stateText.textContent = '수동 해제 필요'
  } else {
    const sec = lockRemainingSec()
    $('lock-title').textContent = '오류가 발생해 ' + sec + '초 동안 쿠팡 호출을 멈췄습니다.'
    $('lock-detail').textContent = '잠금이 끝날 때까지 쿠팡 호출 버튼이 비활성화됩니다.'
    stateText.textContent = sec + '초 남음'
  }
  const cause = state.lock.reasonCode ? LOCK_CAUSE[state.lock.reasonCode] : ''
  $('lock-cause').textContent = cause || '원인은 아래 오류 안내를 확인하세요.'
  $('lock-actions').hidden = state.lock.state !== 'manual'
}

// ───── 컨트롤 활성 상태 ─────

function setBusy(value, message) {
  state.busy = value
  $('progress').hidden = !value
  if (value) $('progress-text').textContent = message || '처리 중…'
  document.body.setAttribute('aria-busy', value ? 'true' : 'false')
  updateControls()
}

function selectedOptionIds() {
  return Array.from(document.querySelectorAll('#items-list input[type="checkbox"]:checked')).map((el) => el.value)
}

function setDisabled(id, disabled) {
  const el = $(id)
  if (el) el.disabled = Boolean(disabled)
}

function updateControls() {
  const callBlocked = state.busy || isLocked() || state.keyLoaded === false
  const picked = selectedOptionIds().length
  setDisabled('btn-check', callBlocked)
  setDisabled('btn-products', callBlocked)
  setDisabled('btn-products-next', callBlocked || !state.products.nextToken)
  setDisabled('btn-items', callBlocked || !state.products.selectedId)
  setDisabled('btn-inventory', callBlocked || picked < 1 || picked > MAX_BATCH)
  setDisabled('btn-rg', callBlocked)
  setDisabled('btn-rg-next', callBlocked || !state.rg.nextToken)
  setDisabled('btn-rg-one', callBlocked)
  // 남은 횟수가 0 이어도 서버 응답(UNLOCK_LIMIT)을 받기 전에는 버튼을 끄지 않는다(시험 E-LIMIT 흐름과 맞춤)
  setDisabled('btn-unlock', state.busy || cooldownRemainingSec() > 0 || state.unlockLimitHit)
  setDisabled('btn-refresh', state.busy)
  $('btn-products-next').hidden = !state.products.nextToken
  $('btn-rg-next').hidden = !state.rg.nextToken
  // 20개를 넘게 고르지 못하도록 나머지 체크박스를 잠근다(승인 전 옵션은 항상 비활성)
  document.querySelectorAll('#items-list input[type="checkbox"]').forEach((box) => {
    if (box.dataset.noItem === '1') return
    box.disabled = state.busy || (!box.checked && picked >= MAX_BATCH)
  })
}

// ───── 오류·메시지 표시 ─────

function showError(error) {
  if (!error) {
    $('error-card').hidden = true
    return
  }
  $('error-card').hidden = false
  $('error-message').textContent = error.message
  $('error-hint').textContent = error.hint || ''
  $('error-upstream').textContent = error.upstreamMessage ? '쿠팡 응답 메시지(참고): ' + error.upstreamMessage : ''
}

function currentVendorId() {
  return $('vendor-id').value.trim()
}

function withVendor(extra) {
  const body = Object.assign({}, extra)
  const vendorId = currentVendorId()
  if (vendorId) body.vendorId = vendorId
  return body
}

// 요청 한 건을 감싸서 중복 클릭을 막고 로딩을 표시한다
async function run(message, task) {
  if (state.busy) return null
  showError(null)
  setBusy(true, message)
  try {
    return await task()
  } finally {
    setBusy(false)
  }
}

// ───── 호출 로그 ─────

function addCalls(calls) {
  for (const call of calls) {
    if (!call || typeof call !== 'object') continue
    state.calls.push({
      at: typeof call.at === 'string' ? call.at : '',
      name: typeof call.name === 'string' ? call.name : '',
      status: Number.isInteger(call.status) ? call.status : null,
      ms: Number.isFinite(call.ms) ? call.ms : null
    })
  }
  if (state.calls.length > MAX_LOG) state.calls.splice(0, state.calls.length - MAX_LOG)
  renderCalls()
}

function renderCalls() {
  const body = $('log-body')
  body.replaceChildren()
  for (let i = state.calls.length - 1; i >= 0; i -= 1) {
    const call = state.calls[i]
    body.append(h('tr', null,
      h('td', null, call.at || '—'),
      h('td', null, call.name || '—'),
      h('td', null, call.status === null ? '응답 없음' : String(call.status)),
      h('td', { class: 'num' }, call.ms === null ? '—' : String(call.ms))
    ))
  }
  $('log-empty').hidden = state.calls.length > 0
}

// ───── 상태 카드 ─────

async function loadStatus() {
  const res = await api('GET', '/api/status')
  if (!res.ok) {
    $('st-key').textContent = '확인 실패'
    $('st-vendor').textContent = '확인 실패'
    showError(res.error)
    updateControls()
    return
  }
  const data = res.data
  state.keyLoaded = data.keyLoaded === true
  state.keyError = data.keyError || null
  const formatError = state.keyError && state.keyError.code === 'KEY_FILE_FORMAT'
  if (state.keyLoaded) $('st-key').textContent = '로드됨'
  else if (formatError) $('st-key').textContent = '형식 오류(' + state.keyError.line + '번째 줄)'
  else $('st-key').textContent = '없음'
  $('st-vendor').textContent = data.vendorIdFromFile === true ? '제공됨' : '없음(직접 입력)'
  // 파일 값이 있고 입력란이 비어 있으면 미리 채운다
  if (typeof data.vendorId === 'string' && data.vendorId && !currentVendorId()) {
    $('vendor-id').value = data.vendorId
  }
  if (data.lock) setLock(data.lock)
  else updateControls()
  if (!state.keyLoaded) {
    showError({
      message: formatError ? '키 파일 형식이 맞지 않습니다(' + state.keyError.line + '번째 줄).' : '키 파일을 찾을 수 없습니다.',
      hint: '키 파일 위치와 형식을 확인한 뒤 서버를 다시 실행하세요. 값은 화면에 표시하지 않습니다.',
      upstreamMessage: ''
    })
  }
}

// ───── 연결 확인 ─────

async function onCheck() {
  const result = $('check-result')
  result.textContent = ''
  result.className = 'result-line'
  await run('쿠팡 연결을 확인하는 중…', async () => {
    const res = await api('POST', '/api/check', withVendor({}))
    if (res.ok) {
      result.className = 'result-line is-ok'
      const sample = res.data.productCountSample === 0 ? '0건(조회 가능, 상품 없음)' : '표본 1건 확인'
      result.textContent = '✓ 연결 확인 성공. 상품 ' + sample + '.'
    } else {
      result.className = 'result-line is-fail'
      result.textContent = '! 연결 확인 실패: ' + res.error.message
      showError(res.error)
    }
  })
}

// ───── 판매자배송: 상품 목록 ─────

function renderProducts() {
  const list = $('products-list')
  list.replaceChildren()
  $('products-box').hidden = state.products.items.length === 0
  state.products.items.forEach((item, index) => {
    const id = 'prod-' + index
    const input = h('input', { type: 'radio', name: 'product', id, value: item.sellerProductId })
    input.checked = item.sellerProductId === state.products.selectedId
    input.addEventListener('change', () => {
      state.products.selectedId = item.sellerProductId
      updateControls()
    })
    const sub = 'ID ' + item.sellerProductId + (item.statusName ? ' · ' + item.statusName : '')
    list.append(h('div', { class: 'pick-row' },
      input,
      h('label', { for: id },
        h('span', { class: 'pick-main' }, item.sellerProductName || '(이름 없음)'),
        h('span', { class: 'pick-sub' }, sub)
      )
    ))
  })
}

function parseProducts(data) {
  const items = Array.isArray(data.items) ? data.items : []
  return items
    .filter((item) => item && typeof item === 'object' && item.sellerProductId !== undefined && item.sellerProductId !== null)
    .map((item) => ({
      sellerProductId: String(item.sellerProductId),
      sellerProductName: typeof item.sellerProductName === 'string' ? item.sellerProductName : '',
      statusName: typeof item.statusName === 'string' ? item.statusName : ''
    }))
}

async function loadProducts(useNext) {
  const body = withVendor({ maxPerPage: MAX_BATCH })
  if (useNext && state.products.nextToken) body.nextToken = state.products.nextToken
  await run('상품 목록을 불러오는 중…', async () => {
    const res = await api('POST', '/api/seller/products', body)
    if (!res.ok) {
      showError(res.error)
      return
    }
    state.products.items = parseProducts(res.data)
    state.products.nextToken = typeof res.data.nextToken === 'string' && res.data.nextToken ? res.data.nextToken : null
    state.products.selectedId = null
    state.options = { productId: null, productName: '', items: [] }
    renderProducts()
    renderOptions()
    $('items-meta').textContent = ''
    if (state.products.items.length === 0) {
      $('products-meta').textContent = '상품이 없습니다.'
    } else {
      $('products-meta').textContent = state.products.items.length + '건 표시' + (state.products.nextToken ? ' · 다음 페이지 있음' : ' · 마지막 페이지')
    }
  })
  updateControls()
}

// ───── 판매자배송: 옵션 목록 ─────

function renderOptions() {
  const list = $('items-list')
  list.replaceChildren()
  const items = state.options.items
  $('items-box').hidden = items.length === 0
  items.forEach((item, index) => {
    const id = 'opt-' + index
    const hasId = Boolean(item.vendorItemId)
    const input = h('input', { type: 'checkbox', id, value: item.vendorItemId || '', disabled: !hasId, 'data-no-item': hasId ? '0' : '1' })
    input.addEventListener('change', updateControls)
    list.append(h('div', { class: 'pick-row' },
      input,
      h('label', { for: id },
        h('span', { class: 'pick-main' }, item.itemName || '(옵션명 없음)'),
        h('span', { class: 'pick-sub' }, hasId ? '옵션 ID ' + item.vendorItemId : '승인 전 옵션(재고 조회 불가)')
      )
    ))
  })
}

async function loadOptions() {
  const productId = state.products.selectedId
  if (!productId) return
  await run('옵션 목록을 불러오는 중…', async () => {
    const res = await api('POST', '/api/seller/product-items', withVendor({ sellerProductId: productId }))
    if (!res.ok) {
      showError(res.error)
      return
    }
    const items = Array.isArray(res.data.items) ? res.data.items : []
    state.options = {
      productId,
      productName: typeof res.data.sellerProductName === 'string' ? res.data.sellerProductName : '',
      items: items
        .filter((item) => item && typeof item === 'object')
        .map((item) => ({
          vendorItemId: item.vendorItemId === null || item.vendorItemId === undefined ? null : String(item.vendorItemId),
          itemName: typeof item.itemName === 'string' ? item.itemName : ''
        }))
    }
    renderOptions()
    const usable = state.options.items.filter((item) => item.vendorItemId).length
    $('items-meta').textContent = '옵션 ' + state.options.items.length + '개(조회 가능 ' + usable + '개)'
  })
  updateControls()
}

// ───── 결과 표 ─────

// 같은 구분·옵션 ID 는 새 결과로 덮어쓴다
function upsertRow(row) {
  const index = state.rows.findIndex((r) => r.kind === row.kind && r.vendorItemId === row.vendorItemId)
  if (index >= 0) state.rows[index] = row
  else state.rows.push(row)
}

function badge(kind, glyph, text) {
  return h('span', { class: 'badge badge-' + kind }, h('span', { 'aria-hidden': 'true' }, glyph + ' '), text)
}

function renderRows() {
  const body = $('result-body')
  body.replaceChildren()
  for (const row of state.rows) {
    let qtyNode
    let stateNode
    const hasQty = row.status === 'ok' && Number.isInteger(row.qty) && row.qty >= 0
    if (hasQty) {
      qtyNode = h('span', { class: row.qty === 0 ? 'qty qty-zero' : 'qty' }, String(row.qty))
      stateNode = row.qty === 0 ? badge('zero', '■', '품절') : badge('normal', '✓', '정상 조회')
    } else if (row.status === 'not_run') {
      qtyNode = h('span', { class: 'qty qty-none' }, '미실행')
      stateNode = badge('stale', '↻', '미실행')
    } else {
      qtyNode = h('span', { class: 'qty qty-none', 'aria-label': '수량 없음' }, '—')
      const reason = row.status === 'ok' ? '수량 형식 오류' : (ERROR_SHORT[row.errorCode] || row.errorCode || '원인 미상')
      stateNode = h('span', null, badge('failed', '!', '조회 실패'), h('span', { class: 'reason' }, reason))
    }
    let onSale = '—'
    if (row.kind === 'rg') onSale = '해당 없음'
    else if (row.onSale === true) onSale = '판매중'
    else if (row.onSale === false) onSale = '판매중지'
    body.append(h('tr', null,
      h('td', { 'data-label': '구분' }, KIND_LABEL[row.kind]),
      h('td', { 'data-label': '상품·옵션명' }, row.name || '—'),
      h('td', { 'data-label': '옵션 ID' }, row.vendorItemId),
      h('td', { 'data-label': '수량 종류' }, QTY_LABEL[row.kind]),
      h('td', { 'data-label': '수량', class: 'num' }, qtyNode),
      h('td', { 'data-label': '판매중' }, onSale),
      h('td', { 'data-label': '상태' }, stateNode)
    ))
  }
  $('result-empty').hidden = state.rows.length > 0
  $('result-table').hidden = state.rows.length === 0
}

async function loadSellerInventory() {
  const ids = selectedOptionIds()
  if (ids.length < 1) return
  if (ids.length > MAX_BATCH) {
    showError({ message: '한 번에 최대 ' + MAX_BATCH + '개 옵션까지 조회할 수 있습니다.', hint: '', upstreamMessage: '' })
    return
  }
  await run('옵션 ' + ids.length + '개의 재고를 조회하는 중…', async () => {
    const res = await api('POST', '/api/seller/inventory', withVendor({ vendorItemIds: ids }))
    if (!res.ok) {
      showError(res.error)
      return
    }
    const names = new Map(state.options.items.map((item) => [item.vendorItemId, item.itemName]))
    const results = Array.isArray(res.data.results) ? res.data.results : []
    for (const item of results) {
      if (!item || typeof item !== 'object') continue
      const id = String(item.vendorItemId)
      upsertRow({
        kind: 'seller',
        vendorItemId: id,
        name: [state.options.productName, names.get(id) || ''].filter(Boolean).join(' / '),
        status: ['ok', 'failed', 'not_run'].includes(item.status) ? item.status : 'failed',
        qty: Number.isInteger(item.amountInStock) ? item.amountInStock : null,
        onSale: typeof item.onSale === 'boolean' ? item.onSale : null,
        errorCode: typeof item.errorCode === 'string' ? item.errorCode : ''
      })
    }
    renderRows()
    const failed = results.filter((r) => r && r.status !== 'ok').length
    $('inventory-meta').textContent = results.length + '건 처리' + (failed ? ' · 실패/미실행 ' + failed + '건' : '')
  })
}

// ───── 로켓그로스 ─────

async function loadRg(mode) {
  const body = withVendor({})
  if (mode === 'next' && state.rg.nextToken) body.nextToken = state.rg.nextToken
  if (mode === 'one') {
    const id = $('rg-item-id').value.trim()
    if (!id) {
      $('rg-meta').textContent = '옵션 ID를 입력하세요.'
      return
    }
    body.vendorItemId = id
  }
  await run('로켓그로스 재고를 조회하는 중…', async () => {
    const res = await api('POST', '/api/rg/inventory', body)
    if (!res.ok) {
      showError(res.error)
      return
    }
    const items = Array.isArray(res.data.items) ? res.data.items : []
    const token = typeof res.data.nextToken === 'string' && res.data.nextToken ? res.data.nextToken : null
    state.rg.nextToken = mode === 'one' ? null : token
    for (const item of items) {
      if (!item || typeof item !== 'object') continue
      const qty = item.totalOrderableQuantity
      upsertRow({
        kind: 'rg',
        vendorItemId: String(item.vendorItemId),
        name: '',
        status: Number.isInteger(qty) && qty >= 0 ? 'ok' : 'failed',
        qty: Number.isInteger(qty) ? qty : null,
        onSale: null,
        errorCode: 'RESPONSE_PARSE'
      })
    }
    renderRows()
    if (items.length === 0) {
      $('rg-meta').textContent = 'RG 재고 없음 또는 RG 미이용일 수 있습니다.'
    } else {
      $('rg-meta').textContent = items.length + '건 표시' + (state.rg.nextToken ? ' · 다음 페이지 있음' : ' · 마지막 페이지')
    }
  })
  updateControls()
}

// ───── 잠금 해제·초기화 ─────

async function onUnlock() {
  const repeat = state.unlockCount > 0
    ? '\n\n[경고] 이 화면에서 이미 ' + state.unlockCount + '회 해제했습니다. 해제를 반복해서 누르면 쿠팡 차단 위험이 큽니다. 서버를 다시 실행하고 원인부터 해결하는 편이 안전합니다.'
    : ''
  const ok = window.confirm('연속 실패로 멈춘 호출 잠금을 해제합니다.\n\n'
    + '- 원인(공인 IP 등록, 키 만료, vendorId)을 직접 확인하고 해결했나요?\n'
    + '- 원인이 그대로면 다시 실패하고, 반복하면 쿠팡이 차단할 수 있습니다.\n'
    + '- 해제 후에도 서버가 쿨다운(대기 시간)을 두면 그동안은 호출이 거절될 수 있습니다.\n'
    + '- 해제 직후에는 "연결 확인"을 한 번만 실행하세요.'
    + repeat
    + '\n\n원인을 해결했고, 그래도 해제하시겠습니까?')
  if (!ok) return
  await run('잠금을 해제하는 중…', async () => {
    const res = await api('POST', '/api/unlock', {})
    if (res.ok) state.unlockCount += 1
    else {
      if (res.error.code === 'UNLOCK_LIMIT') state.unlockLimitHit = true
      showError(res.error)
    }
  })
  // 잠금 안내 문구와 해제 버튼 상태를 다시 반영한다(오류 카드가 바뀌어도 안내는 유지)
  renderLock()
  updateControls()
}

function onClear() {
  state.rows = []
  renderRows()
}

// ───── 시작 ─────

function init() {
  state.hasToken = getSessionToken() !== ''
  $('vendor-form').addEventListener('submit', (event) => {
    event.preventDefault()
    onCheck()
  })
  $('rg-form').addEventListener('submit', (event) => {
    event.preventDefault()
    loadRg('one')
  })
  $('btn-products').addEventListener('click', () => loadProducts(false))
  $('btn-products-next').addEventListener('click', () => loadProducts(true))
  $('btn-items').addEventListener('click', loadOptions)
  $('btn-inventory').addEventListener('click', loadSellerInventory)
  $('btn-rg').addEventListener('click', () => loadRg('first'))
  $('btn-rg-next').addEventListener('click', () => loadRg('next'))
  $('btn-unlock').addEventListener('click', onUnlock)
  $('btn-refresh').addEventListener('click', () => run('상태를 확인하는 중…', loadStatus))
  $('btn-clear').addEventListener('click', onClear)
  renderRows()
  renderCalls()
  if (!state.hasToken) {
    showError({
      message: '세션 토큰이 없습니다.',
      hint: '서버가 보낸 페이지가 아닙니다. 서버를 실행한 뒤 주소(http://127.0.0.1:포트)로 다시 여세요.',
      upstreamMessage: ''
    })
    state.keyLoaded = false
    updateControls()
    return
  }
  updateControls()
  loadStatus()
}

init()
