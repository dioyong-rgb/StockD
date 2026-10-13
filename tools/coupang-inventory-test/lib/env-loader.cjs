'use strict'

const fs = require('node:fs')
const crypto = require('node:crypto')
const util = require('node:util')

// vendorId 형식. 설계서 3장은 A[0-9]{6,10}(공식 예시 A00012345 기준 추정)이지만,
// 실제 판매자 코드의 자릿수를 확인한 적이 없어 느슨한 4~12자리를 유지한다(8장 허용 목록도 같은 값).
// 느슨해도 안전한 이유: 문자는 A+숫자뿐이라 경로·쿼리 주입이 불가능하고, 서명 입력은 검증된 값만 쓴다.
// 실호출로 자릿수가 확인되면 설계서와 allowlist.cjs 의 정규식을 함께 좁힌다.
const VENDOR_ID_RE = /^A[0-9]{4,12}$/
// 시험용 쿠팡 주소 오버라이드와 함께 쓸 수 있는 키의 Access Key 접두어 (실제 키는 이 접두어가 아니다)
const FAKE_KEY_PREFIX = 'FAKE'
const MAX_FILE_BYTES = 8192

// signed-date: UTC yyMMdd'T'HHmmss'Z'
function formatSignedDate(date) {
  const p = (n) => String(n).padStart(2, '0')
  return (
    p(date.getUTCFullYear() % 100) +
    p(date.getUTCMonth() + 1) +
    p(date.getUTCDate()) +
    'T' +
    p(date.getUTCHours()) +
    p(date.getUTCMinutes()) +
    p(date.getUTCSeconds()) +
    'Z'
  )
}

// 키를 클로저에만 담은 서명기. 직렬화·inspect 에는 '[signer]' 만 나온다.
function createSigner(accessKey, secretKey) {
  const signer = {
    // 서명 대상 = signedDate + METHOD + PATH + QUERY(? 제외), HMAC-SHA256 소문자 hex
    authorize(method, pathname, queryString, date) {
      const signedDate = formatSignedDate(date)
      const message = signedDate + method + pathname + queryString
      const signature = crypto.createHmac('sha256', secretKey).update(message, 'utf8').digest('hex')
      const authorization =
        'CEA algorithm=HmacSHA256, access-key=' +
        accessKey +
        ', signed-date=' +
        signedDate +
        ', signature=' +
        signature
      return { authorization, signature, signedDate }
    },
    toJSON() {
      return '[signer]'
    },
    [util.inspect.custom]() {
      return '[signer]'
    }
  }
  return Object.freeze(signer)
}

// 키 파일 텍스트 해석. 실패 시 줄 번호만 돌려주고 내용은 노출하지 않는다.
function parseKeyText(rawText) {
  const text = rawText.replace(/^﻿/, '')
  const lines = text.split(/\r\n|\n|\r/)
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop()
  }
  if (lines.length < 3) {
    return { ok: false, line: Math.max(lines.length + 1, 1) }
  }
  if (lines[0].trim().toLowerCase() !== 'coupang') {
    return { ok: false, line: 1 }
  }
  const access = /^access\s*key\s*:\s*(.*)$/i.exec(lines[1].trim())
  if (!access || !/^\S{1,512}$/.test(access[1].trim())) {
    return { ok: false, line: 2 }
  }
  const secret = /^secret\s*key\s*:\s*(.*)$/i.exec(lines[2].trim())
  if (!secret || !/^\S{1,512}$/.test(secret[1].trim())) {
    return { ok: false, line: 3 }
  }
  let vendorId = null
  for (let i = 3; i < lines.length; i += 1) {
    const trimmed = lines[i].trim()
    if (trimmed === '') {
      continue
    }
    const vendor = /^vendor\s*id\s*:\s*(.*)$/i.exec(trimmed)
    if (!vendor || vendorId !== null || !VENDOR_ID_RE.test(vendor[1].trim())) {
      return { ok: false, line: i + 1 }
    }
    vendorId = vendor[1].trim()
  }
  return { ok: true, access: access[1].trim(), secret: secret[1].trim(), vendorId }
}

// 키 파일을 읽어 서명기만 돌려준다. registerSecret 은 마스킹 목록 등록용 콜백.
// options.requireFakeKey: true 이면 Access Key 가 FAKE 로 시작하는 가짜 키만 허용한다(실제 키면 KEY_NOT_FAKE).
function loadKeyFile(filePath, registerSecret, options) {
  let text
  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile()) {
      return { loaded: false, errorCode: 'KEY_FILE_MISSING', line: null }
    }
    if (stat.size > MAX_FILE_BYTES) {
      return { loaded: false, errorCode: 'KEY_FILE_FORMAT', line: 1 }
    }
    text = fs.readFileSync(filePath, 'utf8')
  } catch (err) {
    return { loaded: false, errorCode: 'KEY_FILE_MISSING', line: null }
  }
  const parsed = parseKeyText(text)
  if (!parsed.ok) {
    return { loaded: false, errorCode: 'KEY_FILE_FORMAT', line: parsed.line }
  }
  if (options && options.requireFakeKey && !parsed.access.toUpperCase().startsWith(FAKE_KEY_PREFIX)) {
    return { loaded: false, errorCode: 'KEY_NOT_FAKE', line: null }
  }
  if (typeof registerSecret === 'function') {
    registerSecret(parsed.access)
    registerSecret(parsed.secret)
  }
  return {
    loaded: true,
    vendorIdFromFile: parsed.vendorId,
    signer: createSigner(parsed.access, parsed.secret)
  }
}

module.exports = { loadKeyFile, createSigner, formatSignedDate, parseKeyText, VENDOR_ID_RE }
