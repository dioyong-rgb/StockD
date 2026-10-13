# 쿠팡 재고 조회 로컬 테스트 페이지 설계·보안 규약 (T1)

- 작성일: 2026-10-12
- 산출 위치(구현 대상): `tools/coupang-inventory-test/`
- 근거: [coupang-api-verification.md](coupang-api-verification.md), [coupang-inventory-test-progress.md](coupang-inventory-test-progress.md), 쿠팡 공식 포털 조사 메모(엔드포인트·인증, 2026-10-12)
- 상태: **설계만.** 쿠팡 API를 호출하지 않았고, 키 파일(`env/api.txt`)을 열지 않았다. 이 문서의 호출 명세는 공식 문서 기준이며 실제 연동 검증 결과가 아니다.
- 표기: **실호출 확인 필요** = 공식 문서만으로 확정할 수 없어 사용자가 실제 키로 처음 호출할 때 확인할 항목. **추측** = 근거 없는 설계 가정.

---

## 1. 목적·범위

### 목적

사용자 PC에서만 동작하는 한 페이지 도구로, 쿠팡 키가 실제로 동작하는지와 재고 수량을 **읽기만** 해서 확인한다.

| # | 확인 항목 | 쿠팡 호출 | 화면 라벨 |
| --- | --- | --- | --- |
| ① | 연결·서명 확인 | 상품 목록 1건(`maxPerPage=1`) | "연결 확인" |
| ② | 판매자배송 재고 | 상품 목록 → 상품 상세(옵션 ID) → 옵션별 재고 | "채널 등록 재고" (`amountInStock`) |
| ③ | 로켓그로스 재고 | RG 재고 요약(목록 또는 옵션 1건) | "주문가능 재고" (`totalOrderableQuantity`) |

### 범위 / 비범위

| 포함 | 제외(비범위) |
| --- | --- |
| `127.0.0.1` 로컬 서버 + 정적 한 페이지 | 쓰기 API 전부(재고·가격·판매상태 변경, 발송·송장, 승인 등) |
| 아래 5장 허용 목록의 GET 4종 | 주문·반품·교환·RG 주문 조회(개인정보 포함 API) |
| 메모리 안에서만 결과 보관(새로고침 시 사라짐) | DB·파일·브라우저 저장소 저장, 결과 내보내기 |
| 가짜 쿠팡 서버로 하는 자동 시험 | 외부 노출(포트 포워딩, 터널, 0.0.0.0 바인딩), 다중 사용자 |
| | StockD 본 앱(Next.js) 연동, 자동 주기 수집 |

---

## 2. 구조

의존성 없음(Node 내장 모듈만: `node:http`, `node:https`, `node:crypto`, `node:fs`, `node:path`, `node:url`, `node:test`, `node:assert`). Node 20 LTS 이상(추측: `node:test` 안정 기준).
코드 규칙: 들여쓰기 2칸, 세미콜론 없음, 한국어 주석, CommonJS `.cjs`, `any` 성격의 무검증 객체 전달 금지(입력은 모두 검증 함수 통과 후 사용).

```
tools/coupang-inventory-test/
  server.cjs              진입점. HTTP 서버, 라우팅, 보안 검사(Host·Origin·토큰), 정적 파일, 종료 처리
  lib/
    env-loader.cjs        키 파일 읽기·검증. 키를 클로저에 담은 서명기만 반환
    coupang-client.cjs    서명(HMAC), 허용 목록 기반 URL 조립, https GET, 타임아웃·크기 제한
    allowlist.cjs         쿠팡 엔드포인트 허용 목록(경로 템플릿·쿼리 키·검증기·projection)
    rate-guard.cjs        토큰 버킷(초당·분당), 잠금 상태(시간 잠금·수동 잠금), 연속 실패 수
    sanitize.cjs          마스킹 필터(비밀값·서명·Authorization), 응답 projection 도우미, 오류 정제
    validate.cjs          입력 정규식(vendorId·sellerProductId·vendorItemId·nextToken·maxPerPage)
    errors.cjs            오류 코드 → 한국어 메시지·안내 표(6장 표와 1:1)
  public/
    index.html            한 페이지(세션 토큰 자리표시 `__SESSION_TOKEN__` 포함)
    app.js                화면 동작(fetch는 같은 출처 /api/* 만)
    style.css             tokens.css 에서 필요한 토큰을 **복사**해 사용(../ui 참조 금지)
  test/
    fixtures/             (시험 중 임시 생성. 가짜 키 파일은 os.tmpdir() 아래에 만들고 끝나면 삭제)
    stub-coupang.cjs      가짜 쿠팡 서버(서명 검증 포함)
    *.test.cjs            8장 시험
```

모듈 경계 원칙

| 모듈 | 키를 볼 수 있나 | 외부로 내보내는 것 |
| --- | --- | --- |
| env-loader | 읽는 순간만 | `{ loaded: true, vendorIdFromFile: string \| null, signer }` 또는 `{ loaded: false, errorCode, line }` |
| coupang-client | `signer` 클로저 경유로만 | 정제된 결과 객체(projection 후) |
| sanitize | 마스킹용 비밀 목록을 클로저에 보관 | `mask(text)` 함수만 |
| 그 외 | 볼 수 없음 | - |

---

## 3. 서버 보안 설계 (체크리스트)

T2가 구현하고 T4가 검토, T5가 시험한다. 모든 항목은 "구현 방법 / 시험 방법"을 짝으로 가진다.

| # | 통제 | 구현 방법 | 시험 방법 |
| --- | --- | --- | --- |
| S1 | `127.0.0.1` 바인딩만 | `server.listen(port, '127.0.0.1')` 고정. 호스트 인자·환경 변수로 바꾸지 못하게 함. 포트는 기본 8787, CLI 인자 `--port`만 허용(1024~65535) | `server.address().address === '127.0.0.1'` 확인. 코드 검색으로 `0.0.0.0`·`::` 문자열 없음 확인 |
| S2 | Host 헤더 검증(DNS 리바인딩 차단) | 모든 요청에서 `Host`가 정확히 `127.0.0.1:<port>` 또는 `localhost:<port>`가 아니면 403 `FORBIDDEN_REQUEST`(본문 최소) | `Host: evil.example:8787`, Host 없음, 포트 다름 → 403 |
| S3 | 세션 토큰 | 시작 시 `crypto.randomBytes(32).toString('hex')` 생성. `GET /` 응답 때 `index.html`의 `__SESSION_TOKEN__`을 치환해 `<meta name="session-token">`로 주입. 모든 `/api/*` 요청은 `X-Session-Token` 헤더 필수, `crypto.timingSafeEqual`로 비교. 토큰은 로그에 쓰지 않음. 서버 재시작 시 새 토큰(이전 탭은 새로고침 필요) | 토큰 없음·틀림·길이 다름 → 403. 맞으면 200 |
| S4 | Origin 검사 | `POST`는 `Origin`이 `http://127.0.0.1:<port>` 또는 `http://localhost:<port>`일 때만 허용, Origin 없으면 거부. `GET /api/status`는 Origin이 있으면 같은 규칙, 없으면 토큰만으로 허용 | 다른 Origin, `null` Origin, Origin 없는 POST → 403 |
| S5 | CORS 비허용 | `Access-Control-Allow-*` 헤더를 절대 보내지 않음. `OPTIONS`·`PUT`·`PATCH`·`DELETE` 등은 405. `POST /api/*`는 `Content-Type: application/json`만 허용(아니면 415) → 단순 폼 CSRF 차단 | 응답 헤더에 `access-control-` 없음, OPTIONS → 405, `text/plain` POST → 415 |
| S6 | 정적 파일 제한 | 디렉터리 서빙 대신 **고정 목록**만: `/`→`public/index.html`, `/app.js`, `/style.css`. 그 외 경로는 404. 요청 경로로 파일 경로를 만들지 않으므로 순회 불가. 공통 헤더: `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'` | `/../env/api.txt`, `/%2e%2e/env/api.txt`, `/..%5cenv%5capi.txt`, `/public/../server.cjs`, `/env/api.txt` → 모두 404, 본문에 파일 내용 없음 |
| S7 | 키 보관 | env-loader가 파일을 읽어 `createSigner(accessKey, secretKey)` 클로저만 만들고 지역 변수는 스코프 종료. `process.env`에 넣지 않음. 클래스 속성·모듈 전역·반환 객체 속성에 키 없음. `signer`는 `Object.freeze`된 함수 묶음 `{ authorize(method, path, query, date) }`이고 `toJSON`·`[util.inspect.custom]`이 `'[signer]'`을 반환 | `JSON.stringify(signer)`, `util.inspect(loaderResult, { depth: 10 })` 출력에 가짜 키 없음. `process.env` 전체 문자열에 가짜 키 없음 |
| S8 | 전 구간 마스킹 | `sanitize.mask(text)`: ① 로드한 Access Key·Secret Key 원문 ② 호출마다 만든 signature·Authorization 문자열(최근 N개 보관) ③ 패턴 `CEA algorithm=[^"\r\n]*`, `signature=[0-9a-fA-F]{16,}`, `access-key=[^,\s"]+`, 64자리 hex 연속 → `[가림]`으로 치환. **모든** 응답 본문(JSON 직렬화 후), 로그 한 줄, 오류 메시지, `console.*` 출력 직전에 적용. 서버 응답은 `sendJson()` 한 함수로만 보내 우회 경로를 없앰 | 단위 테스트: 가짜 키·서명이 들어간 문자열·중첩 객체·오류 스택 → 결과에 원문 없음. 통합: 8장 T-LEAK |
| S9 | 로그 최소화 | 로그 형식 `HH:mm:ss GET <허용 이름> <상태> <ms>ms` 한 줄(예: `GET seller.inventory 200 312ms`). vendorId·옵션 ID·쿼리·헤더·응답 본문·스택 출력 금지. 시작 시 `URL`, `키 파일: 로드됨/없음/형식 오류(n번째 줄)`만 | stdout/stderr 캡처에 가짜 키·서명·`Authorization`·vendorId 없음 |
| S10 | 오류 메시지 정제 | 쿠팡 오류 본문은 화면에 그대로 보내지 않음. HTTP 상태 → 6장 오류 코드로 변환하고, 참고용 `upstreamMessage`는 `message` 필드 1개만 꺼내 `mask()` 후 제어문자 제거·200자 자름. 내부 예외는 `INTERNAL` 코드와 고정 문구만(스택·`err.message` 미전달) | 가짜 서버가 Authorization·키를 에코한 오류 본문 → 화면 응답·로그에 원문 없음 |
| S11 | 응답 projection | 쿠팡 응답은 5장 표의 "남길 필드"만 새 객체로 복사(허용 목록 방식). 원본 응답 전체를 화면에 보내거나 보관하지 않음. 타입 불일치 필드는 `null` + `fieldError` | 가짜 서버가 `receiver`, `addr1`, 예상 밖 필드를 섞어 보내도 화면 응답에 없음 |
| S12 | 요청 본문 제한 | `/api/*` 본문 최대 4 KB, 넘으면 즉시 연결 종료 + 413. JSON 파싱 실패 400. 최상위는 객체만, 알 수 없는 키가 있으면 400 | 5 KB 본문 → 413, 배열·문자열 본문 → 400 |
| S13 | 입력 검증 | `validate.cjs` 정규식(아래 표). 실패 시 쿠팡 호출 없이 400 `INVALID_INPUT`(어느 필드인지만, 값 에코 안 함) | 경계값·특수문자·경로 문자(`/`, `..`, `%`, `?`, `#`) 입력 → 400, 가짜 서버 호출 수 0 |
| S14 | 쓰기 방지 | coupang-client의 공개 함수는 `call(name, params)` 하나. `name`은 allowlist 키만, 경로는 템플릿 + 검증된 값으로 서버가 조립(화면은 경로를 보내지 않음). 조립 후 다시 ① 메서드 `GET` ② 호스트 `api-gateway.coupang.com` ③ 경로가 해당 패턴 정규식에 일치 ④ 쿼리 키가 허용 목록 안 — 넷 다 통과해야 전송. 리다이렉트 따라가지 않음(3xx는 오류) | 허용 외 name, 템플릿 값에 `../`·`?`, 쿼리 키 추가 시도, 메서드 변경 시도 → 전송 전 거부, 가짜 서버 호출 수 0 |
| S15 | TLS·프록시 | `https.request` 기본 인증서 검증 유지(`rejectUnauthorized` 지정 금지). 환경 변수 프록시 미사용(에이전트 지정 없음). 운영 기준 URL은 상수이며 시험용 `baseUrl` 주입은 `createApp({ baseUrl })` 함수 인자로만 가능(CLI·환경 변수로 노출하지 않음) | 코드 검색: `rejectUnauthorized`, `NODE_TLS_REJECT_UNAUTHORIZED` 없음 |
| S16 | 종료 시 정리 | `SIGINT`(Ctrl+C)·`SIGTERM`에서 새 요청 거부 → 진행 중 쿠팡 요청 `abort` → `server.close()` → signer·마스킹 목록 참조를 `null`로 → 종료 코드 0. `uncaughtException`은 마스킹한 한 줄만 쓰고 종료. 한계: JS 문자열은 메모리에서 즉시 지워지지 않음(프로세스 종료로 해소) | 시험에서 프로세스를 띄우고 SIGINT(Windows는 `child.kill()`) 후 포트 해제 확인 |

입력 형식(S13)

| 필드 | 정규식 | 비고 |
| --- | --- | --- |
| `vendorId` | `^A[0-9]{6,10}$` | 공식 예시 형식 `A00012345`. 자릿수 범위는 **추측**(실제 코드로 확인 필요) |
| `sellerProductId` | `^[1-9][0-9]{0,19}$` | 숫자 ID. 길이 상한은 추측 |
| `vendorItemId` | `^[1-9][0-9]{0,19}$` | 숫자 ID. 길이 상한은 추측 |
| `nextToken` | `^[A-Za-z0-9._~-]{1,256}$` | URL 비예약 문자만 허용 → 인코딩해도 값이 같아 서명 불일치 위험 제거. 쿠팡이 다른 문자를 주면 `NEXT_TOKEN_UNSUPPORTED`로 멈춤(실호출 확인 필요) |
| `maxPerPage` | 정수 1~20 | 공식 최대 100이지만 호출량·응답 크기 보호를 위해 20으로 제한 |
| `vendorItemIds` | 배열 1~20개, 각 항목 위 규칙, 중복 제거 | 작업당 최대 20건 |

---

## 4. 호출 안전장치

`rate-guard.cjs`가 쿠팡 호출 직전·직후에 끼어든다. 상태는 서버 프로세스 하나가 공유한다("세션" = 서버 실행 1회).

| # | 장치 | 값(기본) | 동작 |
| --- | --- | --- | --- |
| R1 | 초당 토큰 버킷 | 초당 3회, 버스트 3 | vendorId별 버킷. 공식 기준(vendorId 단위 초당 5회)보다 낮게. 토큰이 없으면 최대 2초 대기, 그래도 없으면 `BUSY` |
| R2 | RG 분당 버킷 | 분당 40회 | RG 재고 호출에만 추가 적용(공식 분당 50회보다 낮게) |
| R3 | 작업당 최대 호출 | 재고 일괄 20건, 목록 1페이지 | 화면 요청 1번 = 쿠팡 호출 최대 20회. 다음 페이지는 사용자가 다시 눌러야 함(자동 순회 없음) |
| R4 | 재시도 금지 | 0회 | 어떤 실패도 자동 재시도하지 않음 |
| R5 | 시간 잠금 | 60초 | 쿠팡 응답 400·401·403·404·429 수신 시 **모든** 쿠팡 호출 잠금. 진행 중 일괄 작업은 즉시 중단, 남은 항목은 `NOT_RUN` |
| R6 | 수동 잠금 | 연속 실패 2회 | 쿠팡 호출 결과가 2xx가 아닌 것(타임아웃·네트워크·5xx 포함)이 연속 2회면 `LOCKED_MANUAL`. 화면의 "잠금 해제" 버튼(`POST /api/unlock`)을 눌러야 풀림. 성공 1회면 연속 실패 수 0 |
| R7 | 타임아웃 | 연결+응답 10초 | 넘으면 `abort`, `TIMEOUT`(실패 1회로 집계) |
| R8 | 응답 크기 | 1 MB | 누적 바이트가 넘으면 `abort`, `RESPONSE_TOO_LARGE` |
| R9 | 동시 실행 | 1개 | 쿠팡 호출 작업은 한 번에 하나. 진행 중 새 작업 요청 → `BUSY` |

잠금 시 안내(원인별, 키 값·길이·일부 문자 노출 없음)

| 쿠팡 상태 | 코드 | 원인 후보(추정 표기) |
| --- | --- | --- |
| 401 | `COUPANG_AUTH` | 키 만료(발급 후 180일), 키 오타, PC 시계 오차, 서명 구현 오류 |
| 403 | `COUPANG_FORBIDDEN` | 이 PC의 공인 IP가 쿠팡 키 설정에 미등록일 가능성, 권한 활성화 대기(발급 후 24시간+), 해당 API 권한 없음 |
| 404 | `COUPANG_NOT_FOUND` | vendorId 오류 또는 ID 없음. 잘못된 vendorId 반복 호출은 IP·vendorId 차단 위험 |
| 400 | `COUPANG_BAD_REQUEST` | 파라미터 형식(이 도구의 설계 오류일 수 있음) |
| 429 | `COUPANG_RATE_LIMIT` | 호출 한도 초과. 공식 해제 시간 "수 분~수십 분" → 60초 잠금 뒤에도 바로 다시 누르지 말 것 |

상태코드별 실제 원인 매핑은 공식 문서에 없다(**실호출 확인 필요**). 화면 문구는 "가능성"으로만 쓴다.

---

## 5. 쿠팡 호출 명세

### 5.1 서명

| 항목 | 값 | 근거 |
| --- | --- | --- |
| 호스트 | `https://api-gateway.coupang.com` (443) | 공식 확인 |
| signed-date | UTC `yyMMdd'T'HHmmss'Z'` (예 형식: `180809T120000Z`). 호출마다 새로 생성 | 공식 확인 |
| 서명 대상 | `signedDate + method + path + query` 구분자 없음. `query`는 `?` 제외. 쿼리 없으면 빈 문자열 | 공식 확인 |
| 해시 | HMAC-SHA256(키 = Secret Key, UTF-8), 결과 **소문자 hex** | 공식 확인 |
| Authorization | `CEA algorithm=HmacSHA256, access-key=<ACCESS>, signed-date=<DATE>, signature=<SIG>` | 공식 확인 |
| 추가 헤더 | `X-Requested-By: <vendorId>` (판매자 코드) | 공식 확인(테스트 가이드) |
| `X-MARKET` | 보내지 않음(KR 기본 가정) | **실호출 확인 필요** |
| `Content-Type` | `application/json;charset=UTF-8` (공식 샘플 관행, GET이라 본문 없음) | 추측 |
| 시간 오차 허용 | 미공개. PC 시계 자동 동기화를 사용자 할 일로 안내 | 확인 못 함 |

동일 쿼리 문자열 보장(서명 불일치 방지)

1. allowlist 항목마다 쿼리 키 **순서를 고정**한다(예: `vendorId`, `nextToken`, `maxPerPage`).
2. 값은 검증 통과한 문자열만 쓰고 `encodeURIComponent`로 한 번 인코딩해 `key=value`를 `&`로 잇는다. 허용 문자(3장 표)가 모두 비예약 문자라 인코딩 전후가 같다.
3. 이렇게 만든 **문자열 하나**(`queryString`)를 서명 입력과 요청 경로(`path + '?' + queryString`)에 그대로 쓴다. `URL`/`URLSearchParams` 객체로 다시 직렬화하지 않는다(재인코딩 방지).
4. 값이 없는 선택 파라미터는 키째 뺀다(`nextToken=` 같은 빈 값 전송 금지).

### 5.2 엔드포인트 허용 목록 (최소 4종, 모두 GET)

| 이름 | 경로 패턴 | 쿼리(순서대로) | 페이징 | 남길 필드(projection) | 신뢰도 |
| --- | --- | --- | --- | --- | --- |
| `seller.products` | `/v2/providers/seller_api/apis/api/v1/marketplace/seller-products` | `vendorId`(필수), `nextToken`(선택, 첫 페이지 생략), `maxPerPage`(선택, 1~20) | 응답 `nextToken` | `data[].{sellerProductId, sellerProductName, statusName}`, `nextToken` | 공식 확인(경로·파라미터) |
| `seller.product` | `/v2/providers/seller_api/apis/api/v1/marketplace/seller-products/{sellerProductId}` | 없음 | 없음 | `data.{sellerProductId, sellerProductName, statusName}`, `data.items[].{sellerProductItemId, vendorItemId, itemName}` | 공식 확인 |
| `seller.inventory` | `/v2/providers/seller_api/apis/api/v1/marketplace/vendor-items/{vendorItemId}/inventories` | 없음 | 없음 | `data.{amountInStock, onSale}` (+ 요청한 `vendorItemId`) | 공식 확인 |
| `rg.inventory` | `/v2/providers/rg_open_api/apis/api/v1/vendors/{vendorId}/rg/inventory/summaries` | `vendorItemId`(선택) **또는** `nextToken`(선택), 동시 지정 금지 | 응답 `nextToken`(단일 조회 시 무시됨) | `data[].{vendorItemId, inventoryDetails.totalOrderableQuantity}`, `nextToken` | 공식 확인(파라미터 이름은 실호출 확인 필요) |

경로 정규식(S14 재검사용)

```
seller.products  ^/v2/providers/seller_api/apis/api/v1/marketplace/seller-products$
seller.product   ^/v2/providers/seller_api/apis/api/v1/marketplace/seller-products/[1-9][0-9]{0,19}$
seller.inventory ^/v2/providers/seller_api/apis/api/v1/marketplace/vendor-items/[1-9][0-9]{0,19}/inventories$
rg.inventory     ^/v2/providers/rg_open_api/apis/api/v1/vendors/A[0-9]{6,10}/rg/inventory/summaries$
```

응답 해석 규칙

| 항목 | 규칙 |
| --- | --- |
| 성공 판정 | HTTP 2xx **이고** envelope `code`가 `200`(숫자) 또는 `"SUCCESS"`(문자열). API마다 형식이 달라 둘 다 허용(공식 문서상 차이 확인됨) |
| 수량 필드 | `amountInStock`·`totalOrderableQuantity`가 0 이상 정수일 때만 숫자로 표시. 아니면 `null` + `fieldError: "TYPE"` |
| `vendorItemId` null | 상품 상세에서 임시저장 옵션은 `null`(공식) → 화면에 "승인 전 옵션(재고 조회 불가)", 재고 조회 대상에서 제외 |
| 마지막 페이지 | `nextToken`이 `null`·빈 문자열·문자열 `"null"`이면 끝으로 처리(어느 값이 오는지 **실호출 확인 필요**) |
| RG 미이용 계정 | 응답 형태 미확인 → 빈 `data`면 "RG 재고 없음 또는 RG 미이용"으로 표시(**실호출 확인 필요**) |
| `maximumBuyCount`·`salePrice`·`salesCountMap` | 남기지 않음(재고와 의미가 달라 혼동 위험). 필요 시 사용자 결정 |

허용 목록 밖(이번 도구에서 호출 금지): 발주서·반품·교환·RG 주문(개인정보 포함), 상품 time-frame·histories, 그리고 모든 쓰기 API.

---

## 6. 서버↔화면 API 계약 (T2·T3 공통 기준)

화면→로컬 서버는 `POST`(JSON)를 쓰지만, **로컬 서버→쿠팡은 항상 GET만** 나간다.

### 6.1 공통

| 항목 | 규칙 |
| --- | --- |
| 요청 헤더 | `X-Session-Token: <meta 값>`, POST는 `Content-Type: application/json` |
| 성공 응답 | `{ "ok": true, "data": {...}, "calls": [CallLog], "lock": LockState }` |
| 실패 응답 | `{ "ok": false, "error": { "code", "message", "hint", "field"?, "upstreamStatus"?, "upstreamMessage"? }, "calls": [CallLog], "lock": LockState }` |
| `CallLog` | `{ "name": "seller.inventory", "status": 200 \| null, "ms": 312, "at": "HH:mm:ss" }` |
| `LockState` | `{ "state": "none" \| "timed" \| "manual", "until": ISO문자열 \| null, "reasonCode": string \| null }` |
| HTTP 상태 | 로컬 거부 400/403/405/413/415, 잠금 423, 바쁨 429, 쿠팡 쪽 실패 502, 타임아웃 504. 화면은 `ok`와 `error.code`로만 분기 |

응답에 **절대 포함 금지**: Access Key·Secret Key(일부·길이·해시 포함), signature, Authorization 문자열, signed-date, 요청·응답 헤더, 쿠팡 원본 응답 전체, 키 파일 경로 외 파일 내용, 스택 트레이스, 세션 토큰(HTML 주입 외).

### 6.2 엔드포인트

| 경로 | 메서드 | 요청 | 성공 `data` | 쿠팡 호출 |
| --- | --- | --- | --- | --- |
| `/api/status` | GET | 없음 | `{ keyLoaded: bool, keyError: null \| {code, line}, vendorIdFromFile: bool, vendorId: string \| null, lock: LockState }` | 없음 |
| `/api/check` | POST | `{ vendorId }` | `{ connected: true, productCountSample: 0 \| 1 }` | `seller.products` `maxPerPage=1` 1회 |
| `/api/seller/products` | POST | `{ vendorId, nextToken?, maxPerPage? }` | `{ items: [{ sellerProductId, sellerProductName, statusName }], nextToken: string \| null }` | `seller.products` 1회 |
| `/api/seller/product-items` | POST | `{ vendorId, sellerProductId }` | `{ sellerProductId, sellerProductName, items: [{ sellerProductItemId, vendorItemId: string \| null, itemName }] }` | `seller.product` 1회 |
| `/api/seller/inventory` | POST | `{ vendorId, vendorItemIds: [1~20] }` | `{ results: [{ vendorItemId, status: "ok" \| "failed" \| "not_run", amountInStock: int \| null, onSale: bool \| null, errorCode? }] }` | `seller.inventory` 최대 20회(순차) |
| `/api/rg/inventory` | POST | `{ vendorId, vendorItemId? , nextToken? }` (둘 중 하나 이하) | `{ items: [{ vendorItemId, totalOrderableQuantity: int \| null }], nextToken: string \| null }` | `rg.inventory` 1회 |
| `/api/unlock` | POST | `{}` | `{ lock: LockState }` | 없음. `timed` 잠금은 시간이 지나기 전엔 풀지 않음, `manual`만 해제 |

- `vendorId`: 요청에 있으면 그것을, 없고 파일에 `Vendor ID:`가 있으면 파일 값을 쓴다. 둘 다 없으면 `VENDOR_ID_REQUIRED`. `/api/status`의 `vendorId`는 파일에서 온 값일 때만 채운다(비밀값 아님).
- `/api/seller/inventory`는 부분 성공을 허용한다. 잠금 유발 실패가 나면 그 항목은 `failed`, 이후 항목은 `not_run`이며 응답 전체는 `ok: true` + `lock` 갱신.

### 6.3 오류 코드 표

| 코드 | HTTP | 화면 메시지(한국어) | 안내(hint) |
| --- | --- | --- | --- |
| `KEY_FILE_MISSING` | 503 | 키 파일을 찾을 수 없습니다. | `env/api.txt`가 있는지 확인한 뒤 서버를 다시 실행하세요. |
| `KEY_FILE_FORMAT` | 503 | 키 파일 형식이 맞지 않습니다({line}번째 줄). | 1줄 `coupang`, 2줄 `Access Key:`, 3줄 `Secret Key:` 형식인지 확인하세요. 값은 화면에 표시하지 않습니다. |
| `VENDOR_ID_REQUIRED` | 400 | 판매자 코드(vendorId)를 입력하세요. | WING 로그인 후 확인하는 A로 시작하는 코드입니다. |
| `INVALID_INPUT` | 400 | 입력 형식이 올바르지 않습니다({field}). | 숫자 ID 또는 A로 시작하는 판매자 코드인지 확인하세요. |
| `BATCH_LIMIT` | 400 | 한 번에 최대 20개 옵션까지 조회할 수 있습니다. | |
| `NEXT_TOKEN_UNSUPPORTED` | 502 | 다음 페이지 토큰 형식을 처리할 수 없습니다. | 설계 보완이 필요합니다. 담당자에게 알려 주세요. |
| `FORBIDDEN_REQUEST` | 403 | 허용되지 않은 요청입니다. | 페이지를 새로고침하세요(서버를 다시 실행했다면 필수). |
| `NOT_ALLOWED` | 403 | 허용 목록에 없는 호출이라 보내지 않았습니다. | |
| `BODY_TOO_LARGE` | 413 | 요청이 너무 큽니다. | |
| `BUSY` | 429 | 다른 조회가 진행 중이거나 호출 간격을 지키는 중입니다. | 잠시 후 다시 누르세요. |
| `LOCKED` | 423 | 오류가 발생해 {남은 초}초 동안 쿠팡 호출을 멈췄습니다. | 아래 원인 안내를 확인하세요. |
| `LOCKED_MANUAL` | 423 | 연속 실패로 호출을 멈췄습니다. | 원인을 확인한 뒤 "잠금 해제"를 누르세요. |
| `COUPANG_AUTH` | 502 | 쿠팡 인증에 실패했습니다(401). | 키 만료(180일)·PC 시계·키 파일 내용을 확인하세요. |
| `COUPANG_FORBIDDEN` | 502 | 쿠팡이 요청을 거부했습니다(403). | 이 PC의 공인 IP가 WING 키 설정에 등록됐는지, 발급 후 24시간이 지났는지 확인하세요(가능성). |
| `COUPANG_NOT_FOUND` | 502 | 대상을 찾지 못했습니다(404). | vendorId 또는 ID를 확인하세요. 잘못된 vendorId 반복은 차단 위험이 있습니다. |
| `COUPANG_BAD_REQUEST` | 502 | 쿠팡이 요청 형식을 거부했습니다(400). | |
| `COUPANG_RATE_LIMIT` | 502 | 쿠팡 호출 한도를 넘었습니다(429). | 수 분 이상 기다린 뒤 다시 시도하세요. |
| `COUPANG_SERVER` | 502 | 쿠팡 서버 오류입니다(5xx). | 자동 재시도하지 않습니다. |
| `COUPANG_UNEXPECTED` | 502 | 예상하지 못한 응답입니다. | envelope `code` 불일치, 3xx 등 |
| `TIMEOUT` | 504 | 쿠팡 응답이 10초 안에 오지 않았습니다. | |
| `NETWORK` | 502 | 쿠팡에 연결하지 못했습니다. | 인터넷 연결을 확인하세요. |
| `RESPONSE_TOO_LARGE` | 502 | 응답이 너무 커서 중단했습니다. | |
| `RESPONSE_PARSE` | 502 | 응답을 해석하지 못했습니다. | |
| `INTERNAL` | 500 | 서버 내부 오류입니다. | 서버 창의 한 줄 로그를 확인하세요. |

---

## 7. 화면 설계 (`public/index.html` 한 페이지)

| 항목 | 규칙 |
| --- | --- |
| 반응형 | 360 / 768 / 1440px 검증. 599px 이하 표 → 카드, 600~1199px 축약 표, 1200px 이상 전체 표(tokens.css 기준과 동일) |
| 스타일 | `ui/assets/tokens.css`의 색·간격·글꼴 토큰을 `public/style.css`로 복사. 시스템 글꼴만 |
| 외부 자원 | 외부 폰트·CDN·이미지·외부 호스트 fetch 금지(CSP로도 차단) |
| 접근성 | 모든 컨트롤 레이블, 최소 44px 터치 영역, 포커스 링, 결과·오류 영역 `aria-live="polite"`, 잠금 안내는 `role="alert"`, 색 외에 글자·기호로 상태 구분 |
| 저장 | `localStorage`·`sessionStorage`·쿠키·IndexedDB 사용 금지. 새로고침 시 vendorId·결과 사라짐 |

화면 구성(위→아래)

| # | 영역 | 내용 |
| --- | --- | --- |
| 0 | 상단 띠 | "로컬 테스트 · 조회 전용 · 키는 이 PC 밖으로 나가지 않음" (info 톤, 항상 표시) |
| ① | 상태 카드 | 키 파일: 로드됨 / 없음 / 형식 오류(n번째 줄). vendorId 파일 제공 여부. 잠금 상태(없음 / n초 남음 / 수동 해제 필요 + "잠금 해제" 버튼) |
| ② | vendorId 입력 | `autocomplete="off"`, 형식 안내(A로 시작). 파일 값이 있으면 미리 채움. 저장 안 함 문구 표시 |
| ③ | 연결 확인 | 버튼 1개. 결과: 성공 / 실패 코드·안내. 실행 중 버튼 비활성 |
| ④ | 판매자배송 재고 | "상품 목록 불러오기"(10건, "다음 페이지") → 상품 선택 → 옵션 목록(승인 전 옵션은 비활성) → 옵션 체크(최대 20) → "재고 조회" |
| ⑤ | 로켓그로스 재고 | "목록 불러오기"(다음 페이지 버튼) 또는 옵션 ID 1건 입력 조회 |
| ⑥ | 결과 표 | 열: 구분(판매자배송/로켓그로스), 옵션 ID, 옵션명(있을 때), 수량 종류, 수량, 판매중(판매자배송만), 상태. 수량 종류 라벨은 **"채널 등록 재고"**(판매자배송)와 **"주문가능 재고"**(로켓그로스)로 분리, **합계 행 없음**. 성공 0은 `0`(품절 배지), 실패는 `—` + 원인 코드 문구, 미실행은 `미실행` |
| ⑦ | 호출 로그 | 응답의 `calls`를 누적(최대 100줄). 표시: 시각·이름·상태·ms만 |
| ⑧ | 오류·잠금 안내 | 6.3 표의 메시지·hint. 잠금 중에는 쿠팡 호출 버튼 전부 비활성 |

화면 구현 규칙(T3): 응답 값은 `textContent`로만 넣는다(`innerHTML` 금지, 상품명 등 외부 문자열 XSS 방지). 세션 토큰은 `meta`에서 읽어 메모리 변수에만 둔다.

---

## 8. 시험 계획 (T5)

- 실행: `node --test tools/coupang-inventory-test/test/`
- 가짜 키 파일: 시험 시작 시 `os.tmpdir()`에 생성, 끝나면 삭제. 값은 눈에 띄는 가짜 문자열(예: Access Key는 UUID 형식의 `0000...-FAKE` 계열, Secret은 `FAKE_SECRET_` 접두). **실제 `env/api.txt`는 열지 않는다.**
- 가짜 쿠팡 서버(`stub-coupang.cjs`): `127.0.0.1` 임의 포트, 4개 경로만 응답, 받은 요청으로 서명을 **독립 구현**해 검증(불일치 시 401), 호출 수·수신 경로 기록, 시나리오 스위치(401/403/404/429/500/지연/큰 응답/개인정보 필드 혼입/헤더 에코).
- **실제 키로 쿠팡을 호출하는 시험은 에이전트가 하지 않는다.**

| ID | 시험 | 기대 결과 |
| --- | --- | --- |
| T-SIG-1 | 고정 입력(고정 날짜·경로·쿼리·가짜 Secret) → 서명 | 미리 계산해 고정한 소문자 hex 64자와 일치 |
| T-SIG-2 | signed-date 포맷 | 고정 시각 → `yyMMddTHHmmssZ` 형식, UTC |
| T-SIG-3 | 쿼리 있는 호출을 stub에 전송 | stub 서명 검증 통과(서명 문자열 = 전송 쿼리) |
| T-SIG-4 | Authorization 헤더 형식 | `CEA algorithm=HmacSHA256, access-key=..., signed-date=..., signature=...` 순서·구분자 일치(stub에서만 확인) |
| T-ENV-1 | 정상 파일(CRLF, BOM, 앞뒤 공백, 콜론 뒤 공백 없음/여러 개, 대소문자 다른 라벨) | 모두 로드 성공 |
| T-ENV-2 | 줄 누락, 라벨 오타, 빈 값, 1줄 제목 다름, 4줄 이상 이상한 줄 | `KEY_FILE_FORMAT` + 줄 번호만, 메시지에 파일 내용 없음 |
| T-ENV-3 | 파일 없음 | `KEY_FILE_MISSING`, 서버는 뜨고 쿠팡 호출 버튼은 거부 |
| T-ENV-4 | `Vendor ID:` 줄 있음/형식 틀림 | 있음 → 자동 사용, 틀림 → `KEY_FILE_FORMAT`(그 줄 번호) |
| T-ALLOW-1 | 허용 외 name, 템플릿 값에 `../`·`%2F`·`?`·`#`, 추가 쿼리 키 | 전송 전 거부, stub 호출 0 |
| T-ALLOW-2 | 화면 API에 `path`·`method`·`url` 필드 추가 | 400(알 수 없는 키) |
| T-LEAK-1 | 모든 시나리오 실행 중 수집한 HTTP 응답 본문·헤더, stdout·stderr | 가짜 Access·Secret, 만들어진 signature, `CEA algorithm`, `Authorization` 문자열 0건 |
| T-LEAK-2 | stub이 오류 본문에 받은 Authorization·키를 에코 | 화면 응답 `upstreamMessage`·로그에 원문 없음(`[가림]`) |
| T-LEAK-3 | `util.inspect`/`JSON.stringify`(loader 결과, signer, client) | 키 없음 |
| T-LEAK-4 | `/api/status` 응답 | 불리언·줄 번호·vendorId 외 값 없음(키 길이·일부 문자 없음) |
| T-PII-1 | stub 응답에 `receiver.addr1`, `requesterName`, 모르는 필드 혼입 | 화면 응답에 projection 필드만 |
| T-NET-1 | Host 변조, Origin 변조·없음, 토큰 없음·틀림 | 403 |
| T-NET-2 | OPTIONS·PUT·DELETE, `text/plain` POST, 5 KB 본문 | 405 / 415 / 413, CORS 헤더 없음 |
| T-NET-3 | 리스닝 주소 | `127.0.0.1`만 |
| T-PATH-1 | `/../env/api.txt`, 인코딩·역슬래시 변형, `/server.cjs`, `/lib/env-loader.cjs` | 404, 본문에 파일 내용 없음 |
| T-RATE-1 | 재고 20건 일괄 | stub 수신 간격이 초당 3회 이하 |
| T-RATE-2 | 21건 요청 | `BATCH_LIMIT`, 호출 0 |
| T-RATE-3 | RG 분당 버킷 | 1분 내 41번째 호출은 `BUSY`(가짜 시계 주입) |
| T-LOCK-1 | stub 403 → 즉시 재요청 | 첫 응답 `COUPANG_FORBIDDEN` + 잠금, 재요청 `LOCKED`, stub 추가 호출 0 |
| T-LOCK-2 | 60초 경과(가짜 시계) | 잠금 해제 |
| T-LOCK-3 | 실패 2회 연속(예: 500, 타임아웃) | `LOCKED_MANUAL`, `/api/unlock` 후 해제 |
| T-LOCK-4 | 일괄 중 3번째에서 429 | 1·2 ok, 3 failed, 4~ not_run, 재시도 없음 |
| T-TIME-1 | stub 지연 11초 / 2 MB 응답 | `TIMEOUT` / `RESPONSE_TOO_LARGE` |
| T-PARSE-1 | `code` 숫자 200·문자열 SUCCESS 모두 / `amountInStock` 문자열·음수 | 둘 다 성공 / 수량 `null` + 실패 표시, 0과 구분 |
| T-SHUT-1 | 종료 신호 | 포트 해제, 로그에 비밀 없음 |

---

## 9. 위험과 한계, 사용자가 직접 할 일

### 위험·한계

| 위험 | 영향 | 대응 |
| --- | --- | --- |
| 이 PC의 공인 IP가 키 설정에 미등록 | 실제 호출이 403 등으로 거부될 수 있음(IP 등록 필수 여부는 공식 문구상 불명확) | 첫 호출은 "연결 확인" 1회만. 거부 시 잠금 후 원인 안내 |
| 가정용 회선 IP 변동 | 어제 되던 호출이 오늘 거부될 수 있음 | 사용자가 현재 공인 IP와 등록 IP 대조 |
| 호출 제한 위반 | 429, 반복 시 영구 차단 가능성(공지) | 초당 3회·분당 40회·재시도 금지·잠금 |
| 잘못된 vendorId 반복 | IP·vendorId 차단 가능(공지, 요약 의존) | 404 즉시 잠금, 연속 2회 수동 잠금 |
| 연동 계약의 "API 데이터 저장" 금지 문구(적용 범위 불명) | 저장 시 계약 위반 소지 | 이 도구는 DB·파일·브라우저 저장 없음, 메모리 표시만 |
| 응답 형식 미확정(5.2 실호출 확인 항목) | 표시 오류 가능 | 타입 불일치는 실패로 표시, 추측으로 채우지 않음 |
| JS 메모리의 키 문자열 | 프로세스 메모리에 남음 | 로컬 전용·종료로 해소, 덤프 도구 사용 금지 |
| 같은 PC의 다른 프로그램 | 로컬 포트 접근 가능 | 세션 토큰·Host·Origin 검사로 브라우저 경유 공격 차단. 같은 PC의 악성 프로그램은 범위 밖 |

### 사용자가 직접 할 일

1. WING에서 vendorId(A로 시작) 확인. 원하면 키 파일 4줄째에 `Vendor ID: <코드>` 추가(선택).
2. WING 키 설정의 등록 IP에 **이 PC의 현재 공인 IP**가 있는지 확인. 키 발급 후 24시간이 지났는지, 만료(180일) 전인지 확인.
3. PC 시계 자동 동기화 켜기(서명 시각 오차 방지).
4. 실행: 프로젝트 폴더에서 `node tools/coupang-inventory-test/server.cjs` → 브라우저로 `http://127.0.0.1:8787` 열기.
5. "연결 확인"을 한 번 누르고 결과를 본다. 실패 시 반복해서 누르지 말고 안내된 원인부터 확인.
6. 결과를 WING 화면 수량과 대조한 뒤에만 "연동 확인"으로 기록한다.
7. 종료: 서버 창에서 `Ctrl+C`. 브라우저 탭 닫기.
8. 저장소를 git으로 관리하게 되면 `env/`를 `.gitignore`에 넣는다(현재 폴더는 git 저장소가 아님).

---

## 10. 작업 분담

| 담당 | 파일 | 할 일 | 완료 기준 |
| --- | --- | --- | --- |
| T2 백엔드 | `server.cjs`, `lib/env-loader.cjs`, `lib/coupang-client.cjs`, `lib/allowlist.cjs`, `lib/rate-guard.cjs`, `lib/sanitize.cjs`, `lib/validate.cjs`, `lib/errors.cjs` | 3장 S1~S16, 4장 R1~R9, 5장 서명·허용 목록·projection, 6장 API | 6장 계약대로 응답, `createApp({ baseUrl, keyFile, clock })` 시험 진입점 제공 |
| T3 프론트 | `public/index.html`, `public/app.js`, `public/style.css` | 7장 화면, 6장 계약 소비 | 360/768/1440 확인, `innerHTML`·브라우저 저장소·외부 자원 0 |
| T4 보안 검토 | (수정은 T2·T3) | 3장 표를 항목별로 코드와 대조, 키 유출 경로 점검 | 미충족 항목 목록과 수정 확인 |
| T5 QA | `test/stub-coupang.cjs`, `test/*.test.cjs` | 8장 시험 전부 | 전부 통과, 유출 검사 0건 |

T2·T3가 맞출 계약은 **6장**(경로·요청·응답·오류 코드)이 유일한 기준이다. 계약을 바꿀 때는 이 문서 6장을 먼저 고친다.
