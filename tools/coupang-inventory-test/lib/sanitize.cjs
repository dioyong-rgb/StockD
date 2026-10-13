'use strict'

const REDACTED = '[가림]'

// 서명·Authorization 계열 패턴
const PATTERNS = [
  /CEA algorithm=[^"\r\n]*/g,
  /signature=[0-9a-fA-F]{16,}/g,
  /access-key=[^,\s"]+/g,
  /[0-9a-fA-F]{64,}/g
]

// 제로폭·방향 제어 문자 (비교 전에 제거해 삽입 우회를 막는다)
const ZERO_WIDTH = /[­͏؜ᅟᅠ឴឵᠎​-‏‪-‮⁠-⁯ㅤ﻿ﾠ]/g

// 부분 일치로 보는 최소 연속 길이 (이 길이 이상 키 조각이 보이면 메시지 전체를 버린다)
const FRAGMENT_MIN = 8

// 쿠팡 오류 메시지에 키 조각이 있을 때 대신 보여 주는 일반 문구
const GENERIC_UPSTREAM_MESSAGE = '쿠팡 오류 메시지에 민감 정보로 보이는 내용이 있어 표시하지 않습니다.'

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// base64 는 값이 문자열 중간에 놓이면 앞뒤 정렬(0~2바이트 어긋남)에 따라 모양이 달라진다.
// 정렬 3가지의 '안정된 가운데 부분'(+ base64url 형태)만 돌려준다.
function base64Forms(value) {
  const bytes = Buffer.from(value, 'utf8')
  const forms = []
  for (let offset = 0; offset < 3; offset += 1) {
    const encoded = Buffer.concat([Buffer.alloc(offset), bytes]).toString('base64')
    const startCut = [0, 2, 3][offset]
    const endCut = [0, 3, 2][(bytes.length + offset) % 3]
    const stable = encoded.slice(startCut, encoded.length - endCut)
    if (stable.length >= FRAGMENT_MIN) {
      forms.push(stable)
      forms.push(stable.replace(/\+/g, '-').replace(/\//g, '_'))
    }
  }
  return forms
}

// 마스킹 도구. 비밀 목록은 이 클로저 안에만 있고 함수만 밖으로 나간다.
function createMasker() {
  // 가릴 문자열 (원문·JSON 이스케이프·URL 인코딩·hex·base64 변형). 대소문자 무시 정규식으로 보관한다.
  let rules = []
  let ruleKeys = new Set()
  // 부분 일치 검사용 정규화 원형 (소문자, 공백·제어·제로폭 제거)
  let fragmentSources = []
  let recent = []

  function normalize(text) {
    return String(text)
      .replace(ZERO_WIDTH, '')
      .replace(/[\s\u0000-\u001f\u007f]+/g, '')
      .toLowerCase()
  }

  function addRule(value) {
    if (value.length < 4 || ruleKeys.has(value)) {
      return
    }
    ruleKeys.add(value)
    rules.push({ length: value.length, re: new RegExp(escapeRegExp(value), 'gi') })
    rules.sort((a, b) => b.length - a.length)
  }

  function addSecret(value) {
    if (typeof value !== 'string' || value.length < 4) {
      return
    }
    addRule(value)
    addRule(JSON.stringify(value).slice(1, -1))
    addRule(encodeURIComponent(value))
    if (value.length >= FRAGMENT_MIN) {
      const hex = Buffer.from(value, 'utf8').toString('hex')
      const b64 = base64Forms(value)
      addRule(hex)
      for (const form of b64) {
        addRule(form)
      }
      fragmentSources.push(normalize(value))
      fragmentSources.push(normalize(hex))
      for (const form of b64) {
        fragmentSources.push(normalize(form))
      }
    }
  }

  // 최근 서명·Authorization 문자열 (최대 50개 보관)
  function addRecent(value) {
    if (typeof value !== 'string' || value.length < 8) {
      return
    }
    recent.push(value)
    if (recent.length > 50) {
      recent.shift()
    }
    // 서명(64자리 hex)은 조각 검사 대상에도 넣는다 (Authorization 은 일반 단어가 섞여 제외)
    if (/^[0-9a-f]{64}$/.test(value)) {
      fragmentSources.push(value)
    }
  }

  function mask(input) {
    let text = typeof input === 'string' ? input : String(input)
    text = text.replace(ZERO_WIDTH, '')
    for (const pattern of PATTERNS) {
      text = text.replace(pattern, REDACTED)
    }
    for (const rule of rules) {
      rule.re.lastIndex = 0
      text = text.replace(rule.re, REDACTED)
    }
    const sorted = recent.slice().sort((a, b) => b.length - a.length)
    for (const item of sorted) {
      if (text.includes(item)) {
        text = text.split(item).join(REDACTED)
      }
    }
    return text
  }

  // 키(또는 그 변형)의 8자 이상 연속 조각이 텍스트에 들어 있는지.
  // 대소문자·줄 분할·공백/제로폭 삽입을 무시하고 비교한다.
  function hasSecretFragment(input) {
    const text = normalize(input)
    if (text.length < FRAGMENT_MIN) {
      return false
    }
    for (const source of fragmentSources) {
      for (let i = 0; i + FRAGMENT_MIN <= source.length; i += 1) {
        if (text.includes(source.slice(i, i + FRAGMENT_MIN))) {
          return true
        }
      }
    }
    return false
  }

  // 객체·배열 안의 모든 문자열(키 포함)에 mask 적용한 새 값을 돌려준다.
  function maskDeep(value, depth) {
    const level = depth || 0
    if (level > 20) {
      return null
    }
    if (typeof value === 'string') {
      return mask(value)
    }
    if (Array.isArray(value)) {
      return value.map((item) => maskDeep(item, level + 1))
    }
    if (value && typeof value === 'object') {
      const out = {}
      for (const key of Object.keys(value)) {
        out[mask(key)] = maskDeep(value[key], level + 1)
      }
      return out
    }
    return value
  }

  function clear() {
    rules = []
    ruleKeys = new Set()
    fragmentSources = []
    recent = []
  }

  return Object.freeze({ addSecret, addRecent, mask, maskDeep, hasSecretFragment, clear })
}

// 쿠팡 오류 본문에서 message 한 개만 꺼내 정제 후 200자로 자른다.
// 키 조각이 하나라도 보이면(hasFragment) 메시지를 통째로 버리고 일반 문구로 대체한다.
function cleanUpstreamMessage(bodyText, mask, hasFragment) {
  let message = null
  try {
    const parsed = JSON.parse(bodyText)
    if (parsed && typeof parsed.message === 'string') {
      message = parsed.message
    }
  } catch (err) {
    return null
  }
  if (message === null) {
    return null
  }
  if (typeof hasFragment === 'function' && hasFragment(message)) {
    return GENERIC_UPSTREAM_MESSAGE
  }
  const cleaned = mask(message).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200)
  return cleaned === '' ? null : cleaned
}

// ---- projection 도우미 (허용 필드만 새 객체로 옮길 때 사용) ----

// 양의 안전 정수 또는 숫자 문자열 → 문자열 ID, 아니면 null
function toIdString(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return String(value)
  }
  if (typeof value === 'string' && /^[0-9]{1,20}$/.test(value)) {
    return value
  }
  return null
}

// 0 이상 정수만 허용, 아니면 null
function toNonNegativeInt(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return value
  }
  return null
}

// 표시용 문자열: 제어문자 제거, 길이 제한. 문자열이 아니면 null
function toDisplayString(value, max) {
  if (typeof value !== 'string') {
    return null
  }
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max || 300)
}

function toBooleanOrNull(value) {
  return typeof value === 'boolean' ? value : null
}

// HH:mm:ss (로컬 시각)
function formatClockTime(ms) {
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds())
}

module.exports = {
  REDACTED,
  GENERIC_UPSTREAM_MESSAGE,
  createMasker,
  cleanUpstreamMessage,
  toIdString,
  toNonNegativeInt,
  toDisplayString,
  toBooleanOrNull,
  formatClockTime
}
