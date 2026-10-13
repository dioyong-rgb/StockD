'use strict'

const https = require('node:https')
const http = require('node:http')
const util = require('node:util')

const allowlist = require('./allowlist.cjs')
const { AppError, StartupError } = require('./errors.cjs')
const { cleanUpstreamMessage, formatClockTime } = require('./sanitize.cjs')

const PRODUCTION_HOST = 'api-gateway.coupang.com'
const DEFAULT_TIMEOUT_MS = 10000
const DEFAULT_MAX_BYTES = 1024 * 1024

// 호출 대상 결정. 시험용 오버라이드는 loopback(127.0.0.1) http 주소만 허용한다.
// 서명된 요청이 외부 호스트로 새는 것을 막기 위한 장치이며, 그 외 값이면 예외를 던진다.
// 오버라이드는 createApp({ baseUrl }) 인자로만 들어오고(환경 변수·CLI 없음),
// createApp 쪽에서 가짜 키 파일과 함께일 때만 허용한다(M1).
function resolveTarget(override) {
  if (override === undefined || override === null || override === '') {
    return { protocol: 'https:', hostname: PRODUCTION_HOST, port: 443 }
  }
  let url
  try {
    url = new URL(String(override))
  } catch (err) {
    throw new StartupError('시험용 쿠팡 주소 형식이 올바르지 않습니다. http://127.0.0.1:<포트> 만 허용됩니다.')
  }
  const ok =
    url.protocol === 'http:' &&
    url.hostname === '127.0.0.1' &&
    url.username === '' &&
    url.password === '' &&
    url.pathname === '/' &&
    url.search === '' &&
    url.hash === ''
  if (!ok) {
    throw new StartupError('시험용 쿠팡 주소는 http://127.0.0.1:<포트> 형식만 허용됩니다.')
  }
  return { protocol: 'http:', hostname: '127.0.0.1', port: Number(url.port || 80) }
}

// HTTP 상태 → 오류 코드
function statusToErrorCode(status) {
  if (status === 400) return 'COUPANG_BAD_REQUEST'
  if (status === 401) return 'COUPANG_AUTH'
  if (status === 403) return 'COUPANG_FORBIDDEN'
  if (status === 404) return 'COUPANG_NOT_FOUND'
  if (status === 429) return 'COUPANG_RATE_LIMIT'
  if (status >= 500) return 'COUPANG_SERVER'
  return 'COUPANG_UNEXPECTED'
}

// 쿠팡 호출 클라이언트. 공개 함수는 call(name, params) 하나뿐(쓰기 호출 경로 없음).
function createClient(options) {
  const signer = options.signer
  const target = resolveTarget(options.baseUrl)
  const clock = options.clock
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS
  const maxBytes = options.maxBytes || DEFAULT_MAX_BYTES
  const mask = options.mask
  // 키 조각 검사 함수 (없으면 검사 생략: 시험용 단독 사용)
  const hasSecretFragment = options.hasSecretFragment
  const onSignature = options.onSignature || function noop() {}
  const lib = target.protocol === 'https:' ? https : http
  const inflight = new Set()

  async function call(name, params) {
    // 허용 목록 템플릿으로 경로·쿼리 조립 (실패 시 AppError, 네트워크 전송 없음)
    const built = allowlist.buildRequest(name, params)
    const entry = allowlist.ENTRIES[name]

    // 서명에 쓴 쿼리 문자열과 전송 쿼리는 같은 변수 하나를 쓴다 (재직렬화 금지)
    const queryString = built.queryString
    const signed = signer.authorize('GET', built.path, queryString, new Date(clock.now()))
    onSignature(signed.signature)
    onSignature(signed.authorization)

    const requestPath = queryString === '' ? built.path : built.path + '?' + queryString
    const reqOptions = {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port,
      method: 'GET',
      path: requestPath,
      agent: false,
      headers: {
        Authorization: signed.authorization,
        'X-Requested-By': built.vendorId,
        'Content-Type': 'application/json;charset=UTF-8',
        Accept: 'application/json'
      }
    }

    // 전송 직전 재검사: GET · 호스트 · 경로 정규식 · 쿼리 키
    const splitAt = reqOptions.path.indexOf('?')
    allowlist.verifyRequest(
      {
        name,
        method: reqOptions.method,
        hostname: reqOptions.hostname,
        path: splitAt === -1 ? reqOptions.path : reqOptions.path.slice(0, splitAt),
        queryString: splitAt === -1 ? '' : reqOptions.path.slice(splitAt + 1)
      },
      target.hostname
    )

    const startedAt = process.hrtime.bigint()

    return new Promise((resolve) => {
      let settled = false
      let timer = null
      let request = null

      function finish(result) {
        if (settled) {
          return
        }
        settled = true
        clearTimeout(timer)
        if (request) {
          inflight.delete(request)
        }
        const ms = Number((process.hrtime.bigint() - startedAt) / 1000000n)
        result.call = {
          name,
          status: typeof result.status === 'number' ? result.status : null,
          ms,
          at: formatClockTime(clock.now())
        }
        resolve(result)
      }

      function interpret(status, text) {
        if (status >= 200 && status < 300) {
          let body
          try {
            body = JSON.parse(text)
          } catch (err) {
            return { ok: false, status, errorCode: 'RESPONSE_PARSE' }
          }
          if (!allowlist.envelopeOk(body)) {
            return { ok: false, status, errorCode: 'COUPANG_UNEXPECTED' }
          }
          const projected = entry.project(body, built)
          if (projected.errorCode) {
            return { ok: false, status, errorCode: projected.errorCode }
          }
          return { ok: true, status, data: projected.data }
        }
        const result = { ok: false, status, errorCode: statusToErrorCode(status) }
        const message = cleanUpstreamMessage(text, mask, hasSecretFragment)
        if (message !== null) {
          result.upstreamMessage = message
        }
        return result
      }

      try {
        request = lib.request(reqOptions, (res) => {
          const status = res.statusCode
          // 리다이렉트는 따라가지 않는다
          if (status >= 300 && status < 400) {
            res.resume()
            finish({ ok: false, status, errorCode: 'COUPANG_UNEXPECTED' })
            request.destroy()
            return
          }
          const chunks = []
          let total = 0
          res.on('data', (chunk) => {
            if (settled) {
              return
            }
            total += chunk.length
            if (total > maxBytes) {
              finish({ ok: false, status, errorCode: 'RESPONSE_TOO_LARGE' })
              request.destroy()
              return
            }
            chunks.push(chunk)
          })
          res.on('end', () => {
            finish(interpret(status, Buffer.concat(chunks).toString('utf8')))
          })
          res.on('error', () => {
            finish({ ok: false, status: null, errorCode: 'NETWORK' })
          })
          res.on('aborted', () => {
            finish({ ok: false, status: null, errorCode: 'NETWORK' })
          })
        })
      } catch (err) {
        finish({ ok: false, status: null, errorCode: 'NETWORK' })
        return
      }

      inflight.add(request)
      request.on('error', () => {
        finish({ ok: false, status: null, errorCode: 'NETWORK' })
      })
      timer = setTimeout(() => {
        finish({ ok: false, status: null, errorCode: 'TIMEOUT' })
        request.destroy()
      }, timeoutMs)
      request.end()
    })
  }

  // 종료 시 진행 중 요청 중단
  function abortAll() {
    for (const request of Array.from(inflight)) {
      request.destroy()
    }
    inflight.clear()
  }

  const client = {
    call,
    abortAll,
    toJSON() {
      return '[client]'
    },
    [util.inspect.custom]() {
      return '[client]'
    }
  }
  return Object.freeze(client)
}

module.exports = { createClient, resolveTarget, statusToErrorCode, PRODUCTION_HOST }
