'use strict'

// 오류 코드 표 (설계서 6.3과 1:1). 키 값·서명은 어떤 문구에도 넣지 않는다.
const TABLE = {
  KEY_FILE_MISSING: {
    status: 503,
    message: '키 파일을 찾을 수 없습니다.',
    hint: 'env/api.txt가 있는지 확인한 뒤 서버를 다시 실행하세요.'
  },
  KEY_FILE_FORMAT: {
    status: 503,
    message: '키 파일 형식이 맞지 않습니다({line}번째 줄).',
    hint: '1줄 coupang, 2줄 Access Key:, 3줄 Secret Key: 형식인지 확인하세요. 값은 화면에 표시하지 않습니다.'
  },
  VENDOR_ID_REQUIRED: {
    status: 400,
    message: '판매자 코드(vendorId)를 입력하세요.',
    hint: 'WING 로그인 후 확인하는 A로 시작하는 코드입니다.'
  },
  INVALID_INPUT: {
    status: 400,
    message: '입력 형식이 올바르지 않습니다({field}).',
    hint: '숫자 ID 또는 A로 시작하는 판매자 코드인지 확인하세요.'
  },
  BATCH_LIMIT: {
    status: 400,
    message: '한 번에 최대 20개 옵션까지 조회할 수 있습니다.',
    hint: ''
  },
  NEXT_TOKEN_UNSUPPORTED: {
    status: 502,
    message: '다음 페이지 토큰 형식을 처리할 수 없습니다.',
    hint: '설계 보완이 필요합니다. 담당자에게 알려 주세요.'
  },
  FORBIDDEN_REQUEST: {
    status: 403,
    message: '허용되지 않은 요청입니다.',
    hint: '페이지를 새로고침하세요(서버를 다시 실행했다면 필수).'
  },
  NOT_ALLOWED: {
    status: 403,
    message: '허용 목록에 없는 호출이라 보내지 않았습니다.',
    hint: ''
  },
  BODY_TOO_LARGE: {
    status: 413,
    message: '요청이 너무 큽니다.',
    hint: ''
  },
  BUSY: {
    status: 429,
    message: '다른 조회가 진행 중이거나 호출 간격을 지키는 중입니다.',
    hint: '잠시 후 다시 누르세요.'
  },
  LOCKED: {
    status: 423,
    message: '오류가 발생해 {seconds}초 동안 쿠팡 호출을 멈췄습니다.',
    hint: '아래 원인 안내를 확인하세요.'
  },
  LOCKED_MANUAL: {
    status: 423,
    message: '연속 실패로 호출을 멈췄습니다.',
    hint: '원인을 확인한 뒤 "잠금 해제"를 누르세요.'
  },
  COUPANG_AUTH: {
    status: 502,
    message: '쿠팡 인증에 실패했습니다(401).',
    hint: '키 만료(180일)·PC 시계·키 파일 내용을 확인하세요.'
  },
  COUPANG_FORBIDDEN: {
    status: 502,
    message: '쿠팡이 요청을 거부했습니다(403).',
    hint: '이 PC의 공인 IP가 WING 키 설정에 등록됐는지, 발급 후 24시간이 지났는지 확인하세요(가능성).'
  },
  COUPANG_NOT_FOUND: {
    status: 502,
    message: '대상을 찾지 못했습니다(404).',
    hint: 'vendorId 또는 ID를 확인하세요. 잘못된 vendorId 반복은 차단 위험이 있습니다.'
  },
  COUPANG_BAD_REQUEST: {
    status: 502,
    message: '쿠팡이 요청 형식을 거부했습니다(400).',
    hint: ''
  },
  COUPANG_RATE_LIMIT: {
    status: 502,
    message: '쿠팡 호출 한도를 넘었습니다(429).',
    hint: '수 분 이상 기다린 뒤 다시 시도하세요.'
  },
  COUPANG_SERVER: {
    status: 502,
    message: '쿠팡 서버 오류입니다(5xx).',
    hint: '자동 재시도하지 않습니다.'
  },
  COUPANG_UNEXPECTED: {
    status: 502,
    message: '예상하지 못한 응답입니다.',
    hint: 'envelope code 불일치, 3xx 등'
  },
  TIMEOUT: {
    status: 504,
    message: '쿠팡 응답이 10초 안에 오지 않았습니다.',
    hint: ''
  },
  NETWORK: {
    status: 502,
    message: '쿠팡에 연결하지 못했습니다.',
    hint: '인터넷 연결을 확인하세요.'
  },
  RESPONSE_TOO_LARGE: {
    status: 502,
    message: '응답이 너무 커서 중단했습니다.',
    hint: ''
  },
  RESPONSE_PARSE: {
    status: 502,
    message: '응답을 해석하지 못했습니다.',
    hint: ''
  },
  INTERNAL: {
    status: 500,
    message: '서버 내부 오류입니다.',
    hint: '서버 창의 한 줄 로그를 확인하세요.'
  },
  // 수동 잠금 해제 제한(L4): 잠긴 직후 대기, 해제 횟수 상한
  UNLOCK_WAIT: {
    status: 423,
    message: '잠금 해제는 {seconds}초 뒤에 할 수 있습니다.',
    hint: '원인을 먼저 확인하세요. 실패 직후 반복해서 호출하면 쿠팡 차단 위험이 있습니다.'
  },
  UNLOCK_LIMIT: {
    status: 423,
    message: '잠금 해제 횟수를 모두 사용했습니다.',
    hint: '원인을 해결한 뒤 서버를 다시 실행하세요.'
  },
  // 설계서 표에 없는 로컬 거부 코드(6.1의 HTTP 상태 405/415 및 404 대응)
  METHOD_NOT_ALLOWED: {
    status: 405,
    message: '허용되지 않는 요청 방식입니다.',
    hint: ''
  },
  UNSUPPORTED_MEDIA_TYPE: {
    status: 415,
    message: '요청 형식(Content-Type)이 올바르지 않습니다.',
    hint: 'application/json 으로 보내세요.'
  },
  NOT_FOUND: {
    status: 404,
    message: '찾을 수 없는 경로입니다.',
    hint: ''
  }
}

// 잠금 원인별 안내. 모두 "가능성" 표현이며 키 값은 포함하지 않는다.
const CAUSE_HINTS = {
  COUPANG_AUTH: '키 만료(발급 후 180일)·키 오타·PC 시계 오차 가능성이 있습니다.',
  COUPANG_FORBIDDEN:
    '이 PC의 공인 IP가 쿠팡 키 설정에 미등록일 가능성, 키 발급 후 권한 활성화 대기(24시간 이상) 가능성, 해당 API 권한이 없을 가능성이 있습니다.',
  COUPANG_NOT_FOUND: 'vendorId 오류 가능성이 있습니다. 잘못된 vendorId 반복 호출은 IP·vendorId 차단 위험이 있습니다.',
  COUPANG_BAD_REQUEST: '요청 형식 문제 가능성이 있습니다(이 도구의 설계 오류일 수 있음).',
  COUPANG_RATE_LIMIT: '호출 한도 초과 가능성이 있습니다. 해제까지 수 분~수십 분 걸릴 수 있으니 바로 다시 누르지 마세요.',
  COUPANG_SERVER: '쿠팡 서버 일시 장애 가능성이 있습니다.',
  COUPANG_UNEXPECTED: '쿠팡 응답 형식이 예상과 다를 가능성이 있습니다.',
  TIMEOUT: '쿠팡 서버 또는 네트워크 지연 가능성이 있습니다.',
  NETWORK: '인터넷 연결 문제 가능성이 있습니다.',
  RESPONSE_TOO_LARGE: '예상보다 큰 응답이 온 것일 수 있습니다.',
  RESPONSE_PARSE: '쿠팡 응답 형식이 예상과 다를 가능성이 있습니다.'
}

// 서버가 던지는 예외. message 는 코드만 담아 스택에 비밀이 섞이지 않게 한다.
class AppError extends Error {
  constructor(code, extra) {
    super(code)
    this.code = code
    if (extra) {
      Object.assign(this, extra)
    }
  }
}

// 시작 단계 실패 전용 예외. message 는 고정 문구만 담으며 시작 실패 출력에는 이 예외의 문구만 쓴다.
class StartupError extends Error {
  constructor(message) {
    super(message)
    this.name = 'StartupError'
  }
}

function fill(template, vars) {
  return template.replace(/\{(\w+)\}/g, (all, key) => {
    return vars && vars[key] !== undefined && vars[key] !== null ? String(vars[key]) : ''
  })
}

// 코드 → { status, message, hint }
function describe(code, vars) {
  const entry = TABLE[code] || TABLE.INTERNAL
  let hint = fill(entry.hint, vars)
  if ((code === 'LOCKED' || code === 'LOCKED_MANUAL') && vars && vars.reasonCode && CAUSE_HINTS[vars.reasonCode]) {
    hint = (hint + ' ' + CAUSE_HINTS[vars.reasonCode]).trim()
  }
  return { status: entry.status, message: fill(entry.message, vars), hint }
}

module.exports = { AppError, StartupError, describe, TABLE, CAUSE_HINTS }
