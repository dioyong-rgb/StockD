# 쿠팡 재고 조회 로컬 테스트 도구 보안 검토 (T4)

- 검토일: 2026-10-12
- 대상: `tools/coupang-inventory-test/` 전체(server.cjs, lib/*.cjs, public/*, test/*), `.gitignore`, `docs/coupang-inventory-test-design.md`(통제 기준), `docs/coupang-inventory-test-progress.md`(키 보호 원칙 7개)
- 방식: 코드 읽기 위주. 수정하지 않았다. 실제 키 파일 `env/api.txt`는 열지 않았다(디렉터리 목록에서 파일 존재·크기만 확인). 쿠팡 API는 호출하지 않았다.
- 표기: **[실행]** = 가짜 키(`test/fixtures/fake-api.txt`)와 로컬 가짜 쿠팡 서버(stub)로 직접 재현함. **[읽기]** = 코드 읽기만으로 판단함.

---

## 1. 요약

| 구분 | 개수 |
| --- | --- |
| 통과 관점 | 9개 중 지적 없는 관점 1개(8 공급망·실행). 나머지 8개는 핵심 통제는 통과, 보완 지적이 섞임 |
| 지적 합계 | **12건** — 높음 0 / 중간 3 / 낮음 9 |

**한 줄 결론: 조건부로 "예".** 키가 응답·로그·오류·화면으로 나가는 경로, 쓰기 API 호출 경로, 쿠팡 외 외부 호스트로 서명 요청이 나가는 경로는 찾지 못했다. 다만 아래 "처음 실행 조건"을 지켜야 하고, 중간 3건(M1~M3)은 사용 범위를 넓히기 전에 고치는 것을 권한다.

처음 실행 조건(사용자 확인)
1. 실행하는 터미널에 `STOCKD_TEST_BASE_URL`이 **설정되어 있지 않을 것**(M1). 설정돼 있으면 실제 Access Key·서명이 평문 http로 로컬 다른 포트에 전송된다.
2. 같은 터미널에 `NODE_TLS_REJECT_UNAUTHORIZED`, `NODE_EXTRA_CA_CERTS`, `NODE_OPTIONS`, `NODE_USE_ENV_PROXY`/`HTTPS_PROXY`가 없을 것(L2). 검토 시점 Git Bash 환경에서는 모두 미설정 **[실행]**.
3. 첫 호출은 "연결 확인" 1회만. 실패하면 "잠금 해제"를 반복해 누르지 말 것(L4).
4. 이 PC를 다른 사용자와 같이 쓰지 않고, 신뢰할 수 없는 프로그램·브라우저 확장이 없는 상태에서 실행(L3, L5).
5. 개발자 도구 화면·호출 로그를 외부로 공유하지 말 것(키는 없지만 세션 토큰·vendorId가 보임).

---

## 2. 관점별 결과

| # | 관점 | 결과 | 근거 요약 | 확인 방식 |
| --- | --- | --- | --- | --- |
| 1 | 키 노출 경로 전수 | 통과(지적 낮음 2: L1, L7) | 모든 JSON 응답이 `sendJson()`에서 `maskDeep` + 직렬화 후 `mask` + `JSON.parse` 유효성 검사를 거침(server.cjs:119-136). 정적 파일도 `mask` 후 토큰 주입(483-496). 로그는 `emit()`→`mask`(88-90)이고 내용은 이름·상태·ms뿐. 예외는 `INTERNAL` 고정 문구, `uncaughtException`은 `err.name`만(682-685). 쿠팡 오류 본문은 `message` 1개만 꺼내 마스킹·제어문자 제거·200자(sanitize.cjs:87-102). signer/client는 `toJSON`·`inspect.custom`이 `[signer]`/`[client]`. `process.env`·argv에 키 없음. `results.json`은 scrub 후 저장되며 `FAKE`/`CEA`/`signature=` 0건 | [읽기]+[실행] |
| 2 | 네트워크 경계 | 통과(지적 낮음 2: L3, L6) | `127.0.0.1` 상수 바인딩(18, 589). Host 정확 일치(소문자화), `[::1]`·끝 점·포트 0 패딩 거부. 토큰 32바이트 난수 base64url, sha256 후 `timingSafeEqual`. POST는 Origin 필수, Content-Type json만, 사용자 정의 헤더(X-Session-Token) 때문에 교차 출처 요청은 사전 요청(OPTIONS→405)에서 막힘. CORS 헤더 없음, `no-store`, `frame-ancestors 'none'`, CORP same-origin. 정적 파일은 고정 목록(경로 순회 불가). 본문 4KB, `headersTimeout` 10초·`requestTimeout` 15초 | [읽기]+[실행] |
| 3 | 키 파일 처리 | 통과(지적 낮음 1: L8) | 기본 경로는 `__dirname` 기준 절대 경로(60, cwd 영향 없음). `stat.isFile()`·8KB 상한. 형식 오류 시 `{errorCode, line}`만 반환, 파일 내용 미포함. 4줄째 `Vendor ID:`는 형식 검사 후 사용, 틀리면 줄 번호만. 키는 서명기 클로저와 마스킹 목록 클로저에만 존재 | [읽기] |
| 4 | 쓰기·외부 유출 방지 | 통과(지적 중간 1: M1) | 공개 함수 `call(name, params)` 하나, 메서드 상수 `GET`, 4개 이름만 허용(`hasOwnProperty`로 `__proto__` 차단). 경로 값은 숫자/`A`+숫자 정규식, 쿼리는 비예약 문자만. 전송 직전 `verifyRequest`로 메서드·호스트·앵커된 경로 정규식·쿼리 키 순서 재검사. 리다이렉트 미추종. `X-Requested-By`는 검증된 vendorId라 CRLF 주입 불가. 호스트는 상수 또는 `127.0.0.1` http만(`127.0.0.1.evil.com`, userinfo, `localhost`, `[::1]` 거부. `2130706433`·`127.1`·`0x7f.0.0.1`은 URL 파서가 127.0.0.1로 정규화하므로 여전히 loopback). DNS 조회 없음 | [읽기]+[실행] |
| 5 | 호출 안전장치 | 부분 통과(지적 중간 1: M2, 낮음 1: L4) | 동시 작업 1개(`busy` 동기 플래그, Node 단일 스레드라 경쟁 없음), 재시도 0회, 400/401/403/404 60초·429 300초 전역 잠금, 연속 실패 2회 수동 잠금, 타임아웃 10초, 응답 1MB. **초당 3회 제한이 vendorId별이라 vendorId를 바꿔 가며 보내면 전역 제한이 없음**(M2) | [읽기]+[실행] |
| 6 | 프론트엔드 | 통과(지적 낮음 1: L5) | `innerHTML`·`eval`·브라우저 저장소·쿠키·`console.*` 0건. 서버 문자열은 `textContent`/텍스트 노드, 속성은 `value`/`id` 등 안전한 것만 `setAttribute`. 인라인 script/style 없음(CSP와 일치), 외부 자원 0. `fetch`는 같은 출처, `redirect: 'error'`. 화면에 키 관련 값 없음 | [읽기] |
| 7 | 운영·유출 부주의 | 부분 통과(지적 중간 1: M3) | `.gitignore`에 `env/`, `.env*`, `*.log` 있음(git 초기화 전이지만 파일이 먼저 있으므로 `git add .` 시에도 제외됨). 키 형식 문자열 정규식 점검: UUID 형식 0건, 40자 이상 hex 2건(`run-tests.cjs:228,235` — 가짜 Secret으로 만든 HMAC 기대값, 비밀 아님), 라벨 뒤 값이 있는 `Access/Secret Key:` 리터럴은 가짜 fixture(`FAKE-ACCESS-…-TEST-ONLY`, `FAKE_SECRET_…_NOT_A_REAL_KEY`)뿐. 로그 파일·덤프 파일 없음(서버는 stdout만). **키 파일이 작업 폴더 안에 있어 git 외 경로(코딩 에이전트, 동기화, 압축 공유)로 읽힐 수 있음**(M3) | [실행] grep |
| 8 | 공급망·실행 | **통과** | `require`는 `node:*` 내장 모듈과 상대 경로뿐, package.json·node_modules 없음. 시작 시 네트워크 호출 없음(클라이언트는 요청 처리 때만 사용). 실행 안내 `node tools/coupang-inventory-test/server.cjs` → `http://127.0.0.1:8787` 안전 | [실행] grep |
| 9 | 시험의 충분성 | 부분 통과(지적 낮음 1: L9) | 36개 시험이 핵심 위협(서명 독립 검증, 허용 목록 우회, Host/Origin/토큰, 경로 순회, 잠금, 유출 수집 검사)을 다룸. 빈틈은 L9 참고 | [읽기] |

---

## 3. 지적 목록 (심각도순)

### 중간

#### M1. 시험용 주소 환경 변수 `STOCKD_TEST_BASE_URL`이 실제 키와 함께 쓰일 수 있음 (설계 S15 위반)
- 위치: `server.cjs:647-648`(main), `lib/coupang-client.cjs:17-39`
- 내용: 설계 S15는 "시험용 baseUrl 주입은 `createApp({ baseUrl })` 함수 인자로만, CLI·환경 변수로 노출하지 않음"인데, 구현은 환경 변수로 받는다. `STOCKD_ENV_FILE` 없이 이 변수만 설정하면 **실제 `env/api.txt`가 로드된 상태에서** 서명된 요청이 평문 http로 `127.0.0.1:<포트>`에 나간다.
- 재현(코드 읽기, 실제 키로 실행하지 않음): `STOCKD_TEST_BASE_URL=http://127.0.0.1:9999 node server.cjs` → `createApp`이 기본 키 파일을 로드 → "연결 확인" 시 `Authorization: CEA ... access-key=<실제 Access Key>, signature=<서명>`이 9999 포트로 전송. 시작 로그에 "시험용 주소 사용 중" 한 줄만 나옴.
- 영향: 그 포트에서 듣는 아무 로컬 프로세스가 실제 Access Key 원문과 유효 서명을 받는다(Secret Key 자체는 아님. 서명은 GET 경로·시각에 묶여 재사용 범위가 좁음). 이전 시험 세션에서 남은 환경 변수로 실수하기 쉬움.
- 수정 제안(server.cjs): ① 환경 변수 경로 제거하고 시험은 `createApp` 인자로만(설계 준수), 또는 ② 유지한다면 `STOCKD_TEST_BASE_URL`이 있을 때 `STOCKD_ENV_FILE`도 반드시 있어야 하고 그 경로가 기본 키 파일(`env/api.txt`)과 같으면 시작 거부. 시험(`T-SHUT-1`)은 ②의 조건을 이미 만족하므로 영향 적음.

#### M2. 초당 3회 제한이 vendorId별이라 vendorId를 바꾸면 전역 제한이 없음
- 위치: `lib/guard.cjs:25, 83-98`
- 내용: `vendorHits`가 vendorId별 맵이다. 작업 동시 실행은 1개로 막지만, 작업 1개가 끝나면 바로 다음 작업이 들어올 수 있어 vendorId만 다르면 간격 대기가 없다.
- 재현 **[실행]**: 가짜 키 + stub로 `/api/check`를 vendorId `A0001000`~`A0001007`로 8번 순차 전송 → **31ms 동안 stub에 8회 도달**(첫 1초 안 8회).
- 영향: 키 보호 원칙 5("호출은 초당 3회 이하")를 우회. 쿠팡 차단 기준이 IP 단위일 수 있고(설계 9장), 잘못된 vendorId 반복은 차단 위험. 현재 화면은 한 번에 한 요청이고 사람이 누르므로 실제 위험은 낮지만, 스크립트·다른 로컬 프로세스(L3)나 화면 버그가 있으면 바로 드러난다. 다만 404·401·403 등은 첫 응답에서 전역 잠금이 걸리므로 연속 피해는 최대 1~2회로 제한됨.
- 수정 제안(lib/guard.cjs): vendorId별 버킷과 별도로 **전역 초당 3회 버킷**을 추가(둘 다 통과해야 호출). 필요하면 한 서버 실행 중 사용한 서로 다른 vendorId 수 상한(예: 3개)도 둔다.

#### M3. 실제 키 파일이 작업 폴더(`C:\Proj\Codex\StockD\env\`) 안에 있음
- 위치: 운영(파일 배치). 관련: `.gitignore`, `server.cjs:60`
- 내용: `.gitignore`는 git 커밋만 막는다. 코딩 에이전트(Codex·Claude 등)가 저장소 전체를 읽거나 검색할 때, 폴더 압축 공유·클라우드 동기화·백업 때 키 파일이 함께 나갈 수 있다. 이번 검토처럼 "열지 말라"는 지시에 의존하는 상태다.
- git 초기화 시 위험 평가: `.gitignore`가 이미 있으므로 `git init && git add .`로는 제외된다. 위험한 경우는 `git add -f env/api.txt`, `.gitignore` 수정·삭제, 다른 폴더로 복사 후 커밋. 초기화 직후 `git check-ignore -v env/api.txt`로 확인하고, 가능하면 비밀 검사(pre-commit) 훅을 둔다.
- 수정 제안(사용자 + 문서 `docs/coupang-inventory-test-progress.md`): 키 파일을 저장소 밖(예: `%USERPROFILE%\.stockd\api.txt`)으로 옮기고 `STOCKD_ENV_FILE`로 지정. Windows 파일 권한을 본인 계정만 읽기로 제한. 에이전트 도구의 무시 설정(예: 에이전트별 ignore 파일)에 `env/` 추가.

### 낮음

#### L1. 마스킹이 원문·JSON 이스케이프·URL 인코딩만 잡음 (변형 우회)
- 위치: `lib/sanitize.cjs:18-28, 41-54, 87-102`
- 재현 **[실행]**(가짜 키로 `mask`·`cleanUpstreamMessage` 직접 호출): 소문자 변환, base64, 앞 20자 일부, 제로폭 문자 삽입, HTML 엔티티 변형은 **가려지지 않음**. 줄바꿈으로 나뉜 값은 제어문자를 공백으로 바꾼 뒤 두 조각이 그대로 남음(재조립 가능). hex 인코딩은 64자 hex 패턴에 걸려 가려짐.
- 영향: 이 경로로 키가 나가려면 쿠팡이 오류 메시지에 키를 변형해 되돌려 줘야 하고, 받는 곳도 토큰을 가진 같은 PC 브라우저뿐이다. 실제 가능성 낮음.
- 수정 제안(lib/sanitize.cjs): `upstreamMessage`는 대소문자 무시로 비교하고, 키의 12자 이상 부분 문자열이 하나라도 있으면 메시지 전체를 버림(`null`). 더 보수적으로는 upstreamMessage를 화면에 보내지 않고 상태 코드만 사용.

#### L2. TLS·프록시 관련 환경 변수 방어 없음
- 위치: `lib/coupang-client.cjs:61, 76-89`, `server.cjs` main
- 내용: 코드에는 `rejectUnauthorized` 지정이 없지만(설계 준수), 사용자 환경에 `NODE_TLS_REJECT_UNAUTHORIZED=0`이 있으면 인증서 검증이 꺼지고, `NODE_EXTRA_CA_CERTS`·`NODE_OPTIONS=--use-system-ca` 등으로 신뢰 CA가 바뀌면 중간자 공격 시 Authorization(Access Key·서명)이 노출될 수 있다. 검토 시점 Git Bash 환경에서는 관련 변수 모두 미설정 **[실행]**(PowerShell 창 환경은 별도 확인 필요).
- 수정 제안(server.cjs main): 시작 시 `NODE_TLS_REJECT_UNAUTHORIZED === '0'`이면 시작 거부, `NODE_EXTRA_CA_CERTS`·`HTTPS_PROXY`·`NODE_USE_ENV_PROXY`가 있으면 경고 한 줄. (T-NET-3이 `rejectUnauthorized` 문자열을 금지하므로 옵션 지정 대신 환경 검사 방식)

#### L3. `GET /`가 Origin·Sec-Fetch-Site와 무관하게 세션 토큰을 돌려줌
- 위치: `server.cjs:549-552, 483-496`
- 재현 **[실행]**: `Origin: http://evil.example` 헤더를 붙인 `GET /` → 200, 본문에 토큰 포함.
- 영향: 브라우저의 교차 출처 페이지는 응답을 읽을 수 없어(CORS 없음 + CORP same-origin) 실질 위험 없음. 그러나 같은 PC의 다른 프로세스·다른 Windows 사용자는 `curl`로 토큰을 얻어 쿠팡 호출(조회)과 잠금 해제를 일으킬 수 있다(키 자체는 얻지 못함). 설계 9장에서 "같은 PC 악성 프로그램은 범위 밖"으로 명시된 잔여 위험.
- 수정 제안(server.cjs): `Origin`이 있고 허용 목록 밖이거나 `Sec-Fetch-Site`가 `cross-site`/`same-site`면 `GET /`도 403. 잔여 위험은 문서에 유지.

#### L4. 수동 잠금 해제에 대기 시간이 없어 실패 반복이 가능
- 위치: `lib/guard.cjs:124-132`, `public/app.js:592-599`
- 재현 **[실행]**: stub가 500을 주는 상태에서 "실패 2회 → 잠금 해제"를 3번 반복 → 쿠팡 실패 호출 6회.
- 영향: 사람이 확인 창을 계속 누르면 잘못된 vendorId·IP 미등록 상태로 반복 호출 → 차단 위험(원칙 5). 401·403·404는 60초 시간 잠금이 함께 걸려 속도는 느림.
- 수정 제안(lib/guard.cjs): 수동 잠금 후 해제 가능 시점까지 최소 60초, 같은 서버 실행 중 해제 2회 이후에는 서버 재시작 요구. 화면 문구는 app.js에서 맞춤.

#### L5. 세션 토큰이 DOM `<meta>`에 계속 남음
- 위치: `public/index.html:6`, `public/app.js:77-82`
- 영향: 브라우저 확장·개발자 도구·화면 공유로 토큰이 보임(토큰은 키가 아니지만 L3과 같은 호출 권한). 낮음.
- 수정 제안(public/app.js): `readToken()` 직후 `meta.remove()`(또는 `content` 비우기).

#### L6. CSP `default-src`가 설계(`'none'`)보다 넓은 `'self'`
- 위치: `server.cjs:38-40`
- 영향: 현재 자산 구성에서는 실질 차이 없음(필요한 지시어는 모두 개별 지정). 설계 일치를 위해 `'none'`으로 좁히는 것을 권장. `img-src data:`는 화면에서 쓰지 않으면 제거 가능.

#### L7. 시작 실패 메시지가 마스킹을 거치지 않음
- 위치: `server.cjs:651`(`err.message`를 stderr에 그대로 출력)
- 영향: 현재 이 경로로 오는 예외는 고정 문구(`resolveTarget`, `--port`)뿐이라 노출 없음. 이후 코드 변경 시 회귀 위험. 수정 제안: 고정 문구만 출력하거나 `mask`를 거치게 함.

#### L8. 설계와 다른 입력 범위·키 경로 입력
- 위치: `lib/allowlist.cjs:12`, `lib/env-loader.cjs:7`, `server.cjs:647`
- 내용: vendorId 정규식이 `A[0-9]{4,12}`(설계 `{6,10}`, 경로 정규식 포함). `STOCKD_ENV_FILE`은 설계에 없는 환경 변수로 임의 경로를 읽는다(형식이 틀리면 줄 번호만 나오므로 다른 파일 내용 노출은 "몇 번째 줄이 틀렸는지" 정도의 정보뿐).
- 수정 제안: 설계서 3장·5장에 실제 값과 `STOCKD_ENV_FILE`을 반영(문서) — 또는 코드를 설계 값으로 좁힘. M3 해결에 `STOCKD_ENV_FILE`이 필요하므로 문서 반영을 권장.

#### L9. 시험이 놓치는 위협
- 위치: `test/run-tests.cjs`
- 빈틈:
  1. T-NET-3이 리스닝 주소를 실제로 확인하지 않음(`probe` 서버는 의미 없는 코드). `createApp`이 `server.address()`를 노출하거나 자식 프로세스로 `0.0.0.0`/LAN IP 접속 실패를 확인해야 함.
  2. T-SHUT-1이 `child.kill()`(Windows는 강제 종료)이라 SIGINT 정리 경로(진행 중 요청 abort, 참조 해제)를 시험하지 않음.
  3. vendorId 교체 시 전역 호출 간격(M2), 잠금 해제 반복(L4) 시험 없음.
  4. 마스킹 변형(대소문자·부분·분할) 시험 없음(L1).
  5. `STOCKD_TEST_BASE_URL`만 있고 `STOCKD_ENV_FILE`이 없을 때 시작 거부 시험 없음(M1).
  6. TLS 환경 변수 방어 시험 없음(L2).
  7. `GET /`에 교차 출처 `Origin`/`Sec-Fetch-Site` 시험 없음(L3).
- 참고: `run-tests.cjs`는 실행 때마다 `test/results.json`을 소스 트리에 쓴다(scrub 후라 가짜 키 0건 확인). 실제 키가 시험 경로로 들어가지 않도록 `runChild`가 `STOCKD_ENV_FILE`을 검사하는 점은 좋음.

---

## 4. 수정 후 재확인 항목

| 지적 | 재확인 방법 |
| --- | --- |
| M1 | `STOCKD_TEST_BASE_URL`만 설정하고 실행 → 시작 거부(종료 코드 1). 가짜 키 + `STOCKD_ENV_FILE` 조합은 정상 |
| M2 | vendorId 8개 교체 연속 호출 → stub 도달이 어느 1초 창에서도 3회 이하 |
| M3 | 키 파일이 저장소 밖에 있고 `STOCKD_ENV_FILE`로 로드됨, `env/` 폴더에 실제 키 없음. git 초기화 후 `git check-ignore -v` 결과 |
| L1 | 대소문자·부분·분할·제로폭 변형을 담은 stub 오류 메시지 → `upstreamMessage`가 `null` 또는 `[가림]` |
| L2 | `NODE_TLS_REJECT_UNAUTHORIZED=0`으로 실행 → 시작 거부 |
| L3 | `Origin: http://evil.example` 또는 `Sec-Fetch-Site: cross-site`로 `GET /` → 403, 토큰 없음 |
| L4 | 수동 잠금 직후 `/api/unlock` → 대기 시간 전에는 해제 안 됨 |
| L5 | 페이지 로드 후 `document.querySelector('meta[name=session-token]')`가 없음 |
| L6 | 응답 CSP에 `default-src 'none'` |
| L9 | 추가 시험 포함 전체 통과, T-LEAK-1 유출 0건 유지 |

---

## 5. 수정 묶음 제안 (파일이 겹치지 않게)

| 묶음 | 담당 | 파일 | 포함 지적 |
| --- | --- | --- | --- |
| A | T2 백엔드 | `server.cjs` | M1, L2, L3, L6, L7 |
| B | T2 백엔드 | `lib/guard.cjs` | M2, L4(서버 쪽) |
| C | T2 백엔드 | `lib/sanitize.cjs` | L1 |
| D | T3 프론트 | `public/app.js` | L5, L4(확인 창 문구·대기 안내) |
| E | T5 QA | `test/run-tests.cjs` | L9(위 1~7 시험 추가) |
| F | 사용자 + 문서 담당 | 키 파일 위치·권한(사용자), `docs/coupang-inventory-test-design.md`(L8, S15 결정 반영), `docs/coupang-inventory-test-progress.md`(M3 운영 안내) | M3, L8 |

권장 순서: B·A(실제 호출 안전) → C·D → E(시험으로 고정) → F.

---

## 6. 실행해 본 것 / 코드 읽기만 한 것

실행해 본 것(모두 가짜 키·로컬 stub, 스크립트는 파일로 남기지 않고 표준 입력으로 실행, 서버·stub는 스크립트 끝에서 종료)
- `mask`/`cleanUpstreamMessage` 변형 우회 7종(L1)
- `resolveTarget`에 숫자·16진·축약 IPv4, 대문자 스킴 입력(관점 4)
- `createApp`(가짜 키, stub) 기동 후: vendorId 교체 연속 호출(M2), Host 변형 4종(관점 2), 교차 Origin `GET /`(L3), 500 상황 잠금 해제 반복(L4), 로그 유출 확인(키·`CEA` 0건), CSP 헤더 확인(L6)
- 저장소 grep: 키 형식 리터럴(UUID·40자 이상 hex/영숫자), `require` 목록, 위험 API(`innerHTML`·`eval`·저장소·`console.*`), `results.json` 내 가짜 키·서명 문자열, 로그·덤프 파일 존재
- 환경 변수 존재 여부(값은 보지 않음): TLS·프록시·`STOCKD_*` 모두 미설정(Git Bash 기준)

코드 읽기만 한 것
- 키 로더 경로 해석·형식 오류 처리, 서명기 클로저, 허용 목록·전송 직전 재검사, 리다이렉트·타임아웃·크기 제한, 종료 처리, 프론트엔드 DOM 삽입 방식, 시험 코드의 범위
- `run-tests.cjs`는 실행하지 않음(`test/results.json`을 덮어써 작성 허용 범위를 벗어나므로). 기존 `results.json`(2026-10-12T09:51Z, Node v24.12.0, 36/36 통과)을 참고함
- M1의 실제 키 조합 시나리오는 실행하지 않고 코드 흐름으로만 확인
