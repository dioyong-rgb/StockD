'use strict'

// 시작 시 실행 환경 점검 (L2, M1). 환경 변수 '값'은 어디에도 출력하지 않고 '이름'만 돌려준다.
// 인증서 검증을 끄거나, 신뢰 CA 를 바꾸거나, 프록시를 끼우면 Authorization(Access Key·서명)이
// 중간자에게 노출될 수 있다. 이 도구는 쿠팡 고정 호스트로 갈 때(운영 모드) 이런 환경이면 시작을 거부한다.

// 값이 있기만 해도 위험한 변수 (대소문자 무시: Windows 와 POSIX 차이 흡수)
const PRESENCE_DANGEROUS = [
  'NODE_EXTRA_CA_CERTS',
  'NODE_USE_ENV_PROXY',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'ALL_PROXY',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR'
]

// NODE_OPTIONS 안의 위험 옵션 (CA 변경, OpenSSL 설정, 코드 선적재, 디버거, 로더)
const NODE_OPTIONS_DANGEROUS =
  /(^|\s)(--use-(openssl|system|bundled)-ca|--openssl-[a-z-]+|--tls-[a-z0-9.-]+|--require|-r|--import|--loader|--experimental-loader|--inspect[a-z-]*|--env-file[a-z-]*)(=|\s|$)/

// 더 이상 지원하지 않는 변수: 값이 있으면 항상 거부 (시험용 주소는 함수 인자로만 받는다)
const REMOVED_VARIABLES = ['STOCKD_TEST_BASE_URL']

function findKey(env, name) {
  for (const key of Object.keys(env)) {
    if (key.toUpperCase() === name) {
      return key
    }
  }
  return null
}

function hasValue(env, name) {
  const key = findKey(env, name)
  return key !== null && typeof env[key] === 'string' && env[key] !== ''
}

// env: 환경 변수 객체(보통 process.env). 반환: 이름만 담은 { removed, dangerous }
function inspectEnvironment(env) {
  const source = env || {}
  const removed = REMOVED_VARIABLES.filter((name) => hasValue(source, name))
  const dangerous = []
  const tlsKey = findKey(source, 'NODE_TLS_REJECT_UNAUTHORIZED')
  if (tlsKey !== null && String(source[tlsKey]).trim() === '0') {
    dangerous.push('NODE_TLS_REJECT_UNAUTHORIZED')
  }
  for (const name of PRESENCE_DANGEROUS) {
    if (hasValue(source, name)) {
      dangerous.push(name)
    }
  }
  const optionsKey = findKey(source, 'NODE_OPTIONS')
  if (optionsKey !== null && typeof source[optionsKey] === 'string' && NODE_OPTIONS_DANGEROUS.test(source[optionsKey])) {
    dangerous.push('NODE_OPTIONS')
  }
  return { removed, dangerous }
}

module.exports = { inspectEnvironment, REMOVED_VARIABLES, PRESENCE_DANGEROUS }
