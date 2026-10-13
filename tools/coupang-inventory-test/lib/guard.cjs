'use strict'

const { AppError } = require('./errors.cjs')

// 호출 안전장치(설계서 4장 R1~R9). 상태는 서버 프로세스 하나가 공유한다.
const PER_SECOND_LIMIT = 3
const SECOND_MS = 1000
const RG_PER_MINUTE_LIMIT = 40
const MINUTE_MS = 60000
const MAX_WAIT_MS = 2000
const SHORT_LOCK_MS = 60000
const LONG_LOCK_MS = 300000
const SHORT_LOCK_STATUSES = [400, 401, 403, 404]
// 수동 잠금 해제 제한(L4): 잠긴 뒤 최소 대기, 서버 실행 1회당 해제 횟수 상한
const UNLOCK_WAIT_MS = 60000
const MAX_UNLOCKS = 2

function createGuard(options) {
  const clock = options.clock
  const sleep = options.sleep
  const shortLockMs = options.shortLockMs || SHORT_LOCK_MS
  const longLockMs = options.longLockMs || LONG_LOCK_MS
  const unlockWaitMs = options.unlockWaitMs === undefined ? UNLOCK_WAIT_MS : options.unlockWaitMs
  const maxUnlocks = options.maxUnlocks === undefined ? MAX_UNLOCKS : options.maxUnlocks

  let lock = { state: 'none', untilMs: null, reasonCode: null, lockedAtMs: null }
  let unlockCount = 0
  let failures = 0
  let busy = false
  // vendorId 별 최근 1초 호출 시각 (슬라이딩 창: 어느 1초 구간에도 3회 이하)
  const vendorHits = new Map()
  // vendorId 와 무관한 전역 호출 시각 (vendorId 를 바꿔 가며 보내도 어느 1초 구간에도 3회 이하)
  let globalHits = []
  let rgHits = []

  // 시간 잠금이 끝났으면 해제 (연속 실패 수는 유지)
  function refresh() {
    if (lock.state === 'timed' && clock.now() >= lock.untilMs) {
      lock = { state: 'none', untilMs: null, reasonCode: null, lockedAtMs: null }
    }
  }

  function getLock() {
    refresh()
    const view = {
      state: lock.state,
      until: lock.state === 'timed' ? new Date(lock.untilMs).toISOString() : null,
      reasonCode: lock.reasonCode
    }
    if (lock.state === 'manual') {
      // 수동 잠금일 때만: 해제 가능 시각과 남은 해제 횟수 (화면 안내용)
      view.unlockAvailableAt = new Date(lock.lockedAtMs + unlockWaitMs).toISOString()
      view.unlocksLeft = Math.max(0, maxUnlocks - unlockCount)
    }
    return view
  }

  function assertNotLocked() {
    refresh()
    if (lock.state === 'manual') {
      throw new AppError('LOCKED_MANUAL', { reasonCode: lock.reasonCode })
    }
    if (lock.state === 'timed') {
      const seconds = Math.max(1, Math.ceil((lock.untilMs - clock.now()) / 1000))
      throw new AppError('LOCKED', { seconds, reasonCode: lock.reasonCode })
    }
  }

  // 작업 시작: 잠금 중이면 거부, 이미 작업 중이면 BUSY. 반환 함수로 반드시 종료한다.
  function enterJob() {
    assertNotLocked()
    if (busy) {
      throw new AppError('BUSY')
    }
    busy = true
    let released = false
    return function release() {
      if (!released) {
        released = true
        busy = false
      }
    }
  }

  // 쿠팡 호출 직전: 잠금 확인 + 호출 간격(초당·RG 분당) 확보
  async function beforeCall(vendorId, opts) {
    assertNotLocked()
    const isRg = Boolean(opts && opts.rg)
    if (isRg) {
      const now = clock.now()
      rgHits = rgHits.filter((t) => now - t < MINUTE_MS)
      if (rgHits.length >= RG_PER_MINUTE_LIMIT) {
        throw new AppError('BUSY')
      }
    }
    let waited = 0
    for (;;) {
      const now = clock.now()
      const hits = (vendorHits.get(vendorId) || []).filter((t) => now - t < SECOND_MS)
      globalHits = globalHits.filter((t) => now - t < SECOND_MS)
      // vendorId 별 버킷과 전역 버킷을 둘 다 통과해야 호출한다
      if (hits.length < PER_SECOND_LIMIT && globalHits.length < PER_SECOND_LIMIT) {
        hits.push(now)
        globalHits.push(now)
        vendorHits.set(vendorId, hits)
        break
      }
      vendorHits.set(vendorId, hits)
      let wait = 1
      if (hits.length >= PER_SECOND_LIMIT) {
        wait = Math.max(wait, hits[0] + SECOND_MS - now)
      }
      if (globalHits.length >= PER_SECOND_LIMIT) {
        wait = Math.max(wait, globalHits[0] + SECOND_MS - now)
      }
      if (waited + wait > MAX_WAIT_MS) {
        throw new AppError('BUSY')
      }
      await sleep(wait)
      waited += wait
    }
    if (isRg) {
      rgHits.push(clock.now())
    }
  }

  // 쿠팡 호출 직후: 성공이면 연속 실패 초기화, 실패면 잠금 규칙 적용 (재시도 없음)
  function afterCall(result) {
    if (result.ok) {
      failures = 0
      return
    }
    failures += 1
    const now = clock.now()
    if (lock.state !== 'manual') {
      if (result.status === 429) {
        lock = { state: 'timed', untilMs: now + longLockMs, reasonCode: result.errorCode, lockedAtMs: now }
      } else if (SHORT_LOCK_STATUSES.includes(result.status)) {
        lock = { state: 'timed', untilMs: now + shortLockMs, reasonCode: result.errorCode, lockedAtMs: now }
      }
    }
    if (failures >= 2) {
      if (lock.state !== 'manual') {
        lock = { state: 'manual', untilMs: null, reasonCode: result.errorCode, lockedAtMs: now }
      }
    }
  }

  // 수동 잠금만 해제한다. 시간 잠금은 시간이 지나기 전엔 풀지 않는다.
  // 수동 잠금은 잠긴 뒤 최소 대기 시간이 지나야 풀리고, 서버 실행 1회당 해제 횟수에 상한이 있다(L4).
  // 거부하면 AppError(UNLOCK_WAIT / UNLOCK_LIMIT)를 던진다.
  function unlock() {
    refresh()
    if (lock.state === 'manual') {
      if (unlockCount >= maxUnlocks) {
        throw new AppError('UNLOCK_LIMIT')
      }
      const remainMs = lock.lockedAtMs + unlockWaitMs - clock.now()
      if (remainMs > 0) {
        throw new AppError('UNLOCK_WAIT', { seconds: Math.max(1, Math.ceil(remainMs / 1000)) })
      }
      unlockCount += 1
      lock = { state: 'none', untilMs: null, reasonCode: null, lockedAtMs: null }
      failures = 0
    }
    return getLock()
  }

  return Object.freeze({ enterJob, beforeCall, afterCall, unlock, getLock })
}

module.exports = { createGuard, UNLOCK_WAIT_MS, MAX_UNLOCKS, PER_SECOND_LIMIT, RG_PER_MINUTE_LIMIT, SHORT_LOCK_MS, LONG_LOCK_MS }
