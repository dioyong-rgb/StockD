/*
 * StockD 시안 가상 샘플 데이터
 * - 모든 값은 가상입니다(DEMO-*). 실제 API/DB 응답이 아닙니다.
 * - StockD.data  : 깊게 동결된 원본
 * - StockD.state : 화면에서 바꾸는 사본 (resetSample 로 data 에서 다시 복제)
 * - 이후 실제 연동 이관을 위한 상태 대응 표기(docs/01-system-design.md 4절)
 *   state 값 → 설계 문서 이름
 *     normal / low / zero          → valueState=available (정상 조회된 수량의 크기 구분, 0 은 정상 품절)
 *     failed                       → readState=failed (수량 null, 첫 조회 실패면 never_succeeded)
 *     stale                        → freshness=stale (마지막 성공값 유지)
 *     unsupported                  → valueState=unsupported (수량 null, 장애와 구분)
 *     unmanaged                    → valueState=stock_management_disabled (재고 관리 미사용, 수량 null)
 *     unverified                   → valueState=unknown (지원 여부 미확인, 수량 null)
 *   이 시안의 모든 항목                → sourceMode = sample
 */
(function () {
  var root = window
  root.StockD = root.StockD || {}
  var StockD = root.StockD

  // 기준 시점 (시안 고정값)
  var REFERENCE_DATE = '2026-10-04'
  var DEFAULT_THRESHOLD = 5

  var inventory = [
    { id: 'n1', sku: 'BAG-NT-S', name: '코튼 파우치', option: '내추럴 / S', channel: 'naver', fulfillment: 'seller', quantity: 18, state: 'normal', lastSuccess: '09:40', lastAttempt: '09:40', externalId: 'DEMO-N-101', detail: '정상 조회된 채널 등록 재고의 표시 예시입니다.' },
    { id: 'c1', sku: 'BAG-NT-S', name: '코튼 파우치', option: '내추럴 / S', channel: 'coupang', fulfillment: 'seller', quantity: 12, state: 'normal', lastSuccess: '09:38', lastAttempt: '09:38', externalId: 'DEMO-C-201', detail: '쿠팡 판매자배송의 amountInStock에 해당하는 등록 재고 예시입니다.' },
    { id: 'r1', sku: 'BAG-NT-S', name: '코튼 파우치', option: '내추럴 / S', channel: 'coupang', fulfillment: 'rocket', quantity: 4, state: 'low', lastSuccess: '09:35', lastAttempt: '09:35', externalId: 'DEMO-R-301', detail: '로켓그로스 totalOrderableQuantity에 해당하는 주문가능 재고 예시입니다. 창고의 실제 보유 재고와 합산하지 않습니다.' },
    { id: 'n2', sku: 'MUG-IV-320', name: '데일리 머그', option: '아이보리 / 320ml', channel: 'naver', fulfillment: 'seller', quantity: 0, state: 'zero', lastSuccess: '09:40', lastAttempt: '09:40', externalId: 'DEMO-N-102', detail: '성공한 조회에서 수량 0을 받은 품절 예시입니다. 조회 실패와 구분합니다.' },
    { id: 'c2', sku: null, name: '데일리 머그', option: '아이보리 / 320ml', channel: 'coupang', fulfillment: 'seller', quantity: 7, state: 'stale', lastSuccess: '09:02', lastAttempt: '09:39', externalId: 'DEMO-C-202', detail: '09:02 마지막 성공값 7개를 보존했습니다. 09:39 조회 오류 예시로 현재 수량은 확인되지 않았습니다.' },
    { id: 'r2', sku: 'BOX-GR-M', name: '접이식 보관함', option: '그레이 / M', channel: 'coupang', fulfillment: 'rocket', quantity: null, state: 'failed', lastSuccess: null, lastAttempt: '09:36', externalId: 'DEMO-R-302', detail: '첫 조회부터 실패한 상태 예시입니다. 이전 성공값이 없어 수량을 비워 두고 품절로 처리하지 않습니다.' },
    { id: 'n3', sku: 'TAPE-IV-01', name: '페이퍼 테이프', option: '아이보리 / 1개', channel: 'naver', fulfillment: 'seller', quantity: null, state: 'unmanaged', lastSuccess: '09:40', lastAttempt: '09:40', externalId: 'DEMO-N-103', detail: '표준형 옵션의 useStockManagement=false 예시입니다. 문서상 9,999 값이 있더라도 보유 수량으로 표시하지 않습니다.' },
    { id: 'n4', sku: 'TAG-KR-10', name: '메시지 태그', option: '기본 / 10장', channel: 'naver', fulfillment: 'seller', quantity: null, state: 'unsupported', lastSuccess: null, lastAttempt: '09:40', externalId: 'DEMO-N-104', detail: '해당 조회 기능이 제공되지 않을 때의 화면 표시만 보여주는 가상 사례입니다. 이 상품이나 네이버 API가 실제로 미지원이라는 뜻은 아닙니다.' },
    { id: 'c3', sku: null, name: '드로잉 페이퍼', option: '화이트 / A4', channel: 'coupang', fulfillment: 'seller', quantity: null, state: 'unverified', lastSuccess: null, lastAttempt: '09:39', externalId: 'DEMO-C-203', detail: '임시저장 상품의 옵션 ID와 조회 지원을 아직 확인하지 못한 예시입니다. 지원 미확인과 품절은 구분합니다.' },
    { id: 'n5', sku: null, name: '코튼 파우치', option: '블랙 / M', channel: 'naver', fulfillment: 'seller', quantity: 3, state: 'low', lastSuccess: '09:40', lastAttempt: '09:40', externalId: 'DEMO-N-105', detail: '등록 재고 3개인 부족 상태 예시입니다. 연결 후보가 있어도 운영자가 확정하기 전에는 내부 SKU에 합치지 않습니다.' }
  ]

  var orders = [
    { id: 'DEMO-NO-101', date: '2026-10-04', time: '09:12', channel: 'naver', fulfillment: 'seller', sku: 'BAG-NT-S', name: '코튼 파우치', option: '내추럴 / S', quantity: 2, state: 'paid', label: '결제 완료', original: 'PAYED', claim: '없음', claimQuantity: 0 },
    { id: 'DEMO-NO-102', date: '2026-10-04', time: '08:45', channel: 'naver', fulfillment: 'seller', sku: 'MUG-IV-320', name: '데일리 머그', option: '아이보리 / 320ml', quantity: 1, state: 'shipping', label: '배송 중', original: 'DELIVERING', claim: '없음', claimQuantity: 0 },
    { id: 'DEMO-NO-103', date: '2026-10-03', time: '14:30', channel: 'naver', fulfillment: 'seller', sku: 'BAG-NT-S', name: '코튼 파우치', option: '내추럴 / S', quantity: 3, state: 'claim', label: '배송 완료', original: 'DELIVERED', claim: '부분 반품 요청', claimQuantity: 1 },
    { id: 'DEMO-CO-201', date: '2026-10-04', time: '09:03', channel: 'coupang', fulfillment: 'seller', sku: 'BAG-NT-S', name: '코튼 파우치', option: '내추럴 / S', quantity: 1, state: 'paid', label: '결제 완료', original: 'ACCEPT', claim: '없음', claimQuantity: 0 },
    { id: 'DEMO-CO-202', date: '2026-10-03', time: '11:20', channel: 'coupang', fulfillment: 'seller', sku: 'MUG-IV-320', name: '데일리 머그', option: '아이보리 / 320ml', quantity: 2, state: 'claim', label: '취소 확인 예시', original: '별도 취소 조회', claim: '취소 완료', claimQuantity: 2 },
    { id: 'DEMO-RO-301', date: '2026-10-03', time: '16:15', channel: 'coupang', fulfillment: 'rocket', sku: 'BAG-NT-S', name: '코튼 파우치', option: '내추럴 / S', quantity: 2, state: 'limited', label: '상태 미확인', original: '응답 상태 필드 미확인', claim: '지원 미확인', claimQuantity: null }
  ]

  var mappings = [
    { id: 'c2', candidates: ['MUG-IV-320', 'MUG-WH-320'], chosen: 'MUG-IV-320' },
    { id: 'c3', candidates: ['PAPER-WH-A4', 'PAPER-WH-A5'], chosen: 'PAPER-WH-A4' },
    { id: 'n5', candidates: ['BAG-BK-M', 'BAG-BK-S'], chosen: 'BAG-BK-M' }
  ]

  var alerts = [
    { id: 'a1', type: 'stock', title: '로켓그로스 주문가능 재고가 낮습니다', description: '코튼 파우치 · 내추럴 / S · 주문가능 재고 4개, 예시 기준 5개', time: '09:35', target: 'inventory', item: 'r1', acknowledged: false },
    { id: 'a2', type: 'stock', title: '스마트스토어 등록 재고가 0입니다', description: '데일리 머그 · 아이보리 / 320ml · 정상 조회된 품절 사례', time: '09:40', target: 'inventory', item: 'n2', acknowledged: false },
    { id: 'a3', type: 'sync', title: '이전 재고를 유지하고 있습니다', description: '쿠팡 판매자배송 · 최근 조회 실패 · 마지막 성공 09:02, 7개 유지', time: '09:39', target: 'inventory', item: 'c2', acknowledged: false },
    { id: 'a4', type: 'sync', title: '첫 조회에서 수량을 확인하지 못했습니다', description: '로켓그로스 · 접이식 보관함 · 이전 성공값 없음, 수량 —', time: '09:36', target: 'inventory', item: 'r2', acknowledged: false },
    { id: 'a5', type: 'mapping', title: '내부 SKU 연결을 확인해 주세요', description: '채널 옵션 3개의 후보를 준비했습니다. 직접 확인한 후 연결합니다.', time: '09:40', target: 'mapping', item: null, acknowledged: false }
  ]

  // 실제 연결 상태: 모두 미연결 (키·권한 미등록)
  var channels = [
    { id: 'naver', channel: 'naver', fulfillment: 'seller', label: '네이버 스마트스토어', account: '스토어 A (샘플)', status: '실제 미연결', keyStatus: '미등록', lastSuccess: null, lastAttempt: null },
    { id: 'coupang-seller', channel: 'coupang', fulfillment: 'seller', label: '쿠팡 판매자배송', account: '판매자 A (샘플)', status: '실제 미연결', keyStatus: '미등록', lastSuccess: null, lastAttempt: null },
    { id: 'coupang-rocket', channel: 'coupang', fulfillment: 'rocket', label: '쿠팡 로켓그로스', account: '판매자 A (샘플)', status: '실제 미연결', keyStatus: '미등록', lastSuccess: null, lastAttempt: null }
  ]

  // 내부 SKU 미연결 옵션: inventory 에서 sku 가 null 인 항목(c2, c3, n5)에서 파생
  var unlinked = inventory
    .filter(function (item) { return item.sku === null })
    .map(function (item) {
      var mapping = mappings.filter(function (m) { return m.id === item.id })[0]
      return {
        id: item.id,
        channel: item.channel,
        fulfillment: item.fulfillment,
        name: item.name,
        option: item.option,
        externalId: item.externalId,
        candidates: mapping ? mapping.candidates.slice() : [],
        chosen: mapping ? mapping.chosen : null
      }
    })

  // 연결 변경 이력: 예시 2건(샘플). action: approve | release
  var mappingHistory = [
    { id: 'h1', time: '2026-10-03 17:20', action: 'approve', account: '스토어 A (샘플)', externalId: 'DEMO-N-101', sku: 'BAG-NT-S', example: true },
    { id: 'h2', time: '2026-10-03 17:22', action: 'approve', account: '판매자 A (샘플)', externalId: 'DEMO-C-201', sku: 'BAG-NT-S', example: true }
  ]

  var labels = {
    // 재고 상태 8종
    state: {
      normal: '정상 예시',
      low: '부족 예시',
      zero: '품절',
      stale: '확인 지연',
      failed: '조회 실패',
      unsupported: '미지원 예시',
      unmanaged: '관리 미사용',
      unverified: '지원 미확인'
    },
    channel: { naver: '스마트스토어', coupang: '쿠팡' },
    fulfillment: { seller: '판매자배송', rocket: '로켓그로스' },
    // 수량 종류: 합산 금지
    quantityKind: { seller: '채널 등록 재고', rocket: '주문가능 재고' },
    // 주문 상태 필터값
    orderState: { paid: '결제 완료', shipping: '배송 중', claim: '클레임 있음', limited: 'RG 상태 미확인' },
    alertType: { stock: '재고 부족 예시', sync: '조회 오류 예시', mapping: '상품 연결 예시' },
    account: { naver: '스토어 A (샘플)', coupang: '판매자 A (샘플)' }
  }

  // 깊은 동결
  function deepFreeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      Object.freeze(value)
      Object.keys(value).forEach(function (key) { deepFreeze(value[key]) })
    }
    return value
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value))
  }

  var data = deepFreeze({
    meta: { referenceDate: REFERENCE_DATE, referenceTime: '09:40', defaultThreshold: DEFAULT_THRESHOLD, sourceMode: 'sample' },
    channels: channels,
    inventory: inventory,
    orders: orders,
    mappings: mappings,
    unlinked: unlinked,
    mappingHistory: mappingHistory,
    alerts: alerts,
    labels: labels
  })

  StockD.data = data
  StockD.state = clone(data)

  // 샘플 초기화: state 객체 참조를 유지한 채 내용만 다시 복제 (일일 기록·이야기 진행은 건드리지 않음)
  StockD.resetSample = function () {
    var fresh = clone(data)
    Object.keys(StockD.state).forEach(function (key) { delete StockD.state[key] })
    Object.keys(fresh).forEach(function (key) { StockD.state[key] = fresh[key] })
    return StockD.state
  }

  var NO_QUANTITY_STATES = { failed: true, unsupported: true, unverified: true, unmanaged: true }

  function formatDateTime(value) {
    if (value === null || value === undefined || value === '') return '—'
    var text = String(value).trim()
    // 'HH:MM' 만 있으면 기준일을 붙인다
    if (/^\d{1,2}:\d{2}$/.test(text)) {
      return REFERENCE_DATE.replace(/-/g, '.') + ' ' + text
    }
    var match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}:\d{2}))?/.exec(text)
    if (!match) return text
    var date = match[1] + '.' + match[2] + '.' + match[3]
    return match[4] ? date + ' ' + match[4] : date
  }

  // 수량 표시: 0 은 정상 조회된 품절(state === 'zero')일 때만. 그 외 값 없음은 '—'
  function formatQuantity(item) {
    if (!item) return '—'
    var quantity = item.quantity
    if (quantity === null || quantity === undefined) return '—'
    if (NO_QUANTITY_STATES[item.state]) return '—'
    if (quantity === 0) return item.state === 'zero' ? '0' : '—'
    return Number(quantity).toLocaleString('ko-KR')
  }

  // 수량 종류 라벨 (채널 수량은 합산하지 않으므로 합산 함수는 두지 않음)
  function quantityKind(item) {
    return item && item.fulfillment === 'rocket' ? labels.quantityKind.rocket : labels.quantityKind.seller
  }

  // 수량 강조 클래스: number-zero / number-low / number-none / ''
  function quantityClass(item, threshold) {
    var limit = typeof threshold === 'number' ? threshold : DEFAULT_THRESHOLD
    if (!item || item.quantity === null || item.quantity === undefined || NO_QUANTITY_STATES[item.state]) return 'number-none'
    if (item.state === 'zero') return 'number-zero'
    if (item.quantity <= limit && item.quantity >= 0 && item.state !== 'stale') return 'number-low'
    return ''
  }

  StockD.format = {
    formatDateTime: formatDateTime,
    formatQuantity: formatQuantity,
    quantityKind: quantityKind,
    quantityClass: quantityClass
  }

  // 대시보드용 집계 (현재 state 기준, 샘플 표시용 - 실제 운영 통계 아님). 대시보드가 쓰는 값만 둔다
  StockD.summary = function () {
    var current = StockD.state
    var byState = {}
    Object.keys(labels.state).forEach(function (key) { byState[key] = 0 })
    current.inventory.forEach(function (item) { byState[item.state] += 1 })
    return {
      referenceDate: REFERENCE_DATE,
      zeroOrLow: byState.zero + byState.low,
      failedOrStale: byState.failed + byState.stale,
      unlinked: current.inventory.filter(function (item) { return item.sku === null }).length,
      unavailable: byState.unsupported + byState.unmanaged + byState.unverified,
      byState: byState
    }
  }
})()
