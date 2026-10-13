# 쿠팡 재고 조회 테스트 페이지 진행 현황

- 시작일: 2026-10-12
- 목적: `env/api.txt`의 쿠팡 키로 재고를 읽어 오는 **로컬 전용 테스트 페이지** (조회 전용, 외부 쓰기 없음)
- 산출 위치: `tools/coupang-inventory-test/` (기존 `ui/` 정적 시안과 분리)
- 실행(구현 후): `node tools/coupang-inventory-test/server.cjs` → `http://127.0.0.1:8787`
- 근거: [coupang-api-verification.md](coupang-api-verification.md)
- 규칙: 단계 완료 시에만 체크한다. 확인하지 못한 것은 체크하지 않고 사유를 적는다.

## 키 보호 원칙 (모든 단계 공통)

1. 키 값은 어떤 파일·문서·로그·대화·화면에도 쓰지 않는다. 에이전트는 `env/api.txt`를 직접 읽거나 출력하지 않는다(코드가 프로그램 안에서만 읽음).
2. 서버는 `127.0.0.1`에만 연결한다. 키는 서버 메모리에만 있고 브라우저로 나가지 않는다.
3. 응답·로그·오류 메시지에서 키·서명·Authorization 값을 제거한다.
4. 호출은 GET 허용 목록(allowlist)만. 쓰기 API는 호출하지 않는다.
5. 실패하면 재시도하지 않고 멈춘다(잘못된 호출 반복은 IP·vendorId 차단 위험). 호출은 초당 3회 이하.
6. 시험은 가짜 키·가짜 쿠팡 서버로만 한다. 실제 키로 쿠팡을 호출하는 것은 사용자가 vendorId를 입력하고 직접 버튼을 누를 때만 일어난다.
7. `env/`는 `.gitignore`로 제외한다.

## 키 파일 형식 (값은 기록하지 않음)

- 3줄: 1줄 제목(`coupang`), 2줄 `Access Key:` 뒤 값, 3줄 `Secret Key:` 뒤 값
- **vendorId는 파일에 없음** → 테스트 페이지에서 직접 입력(또는 파일에 `Vendor ID:` 줄을 추가하면 자동 사용)

## 단계별 체크리스트

| 단계 | 작업 | 산출물 | 담당 | 완료 |
|---|---|---|---|---|
| T1 | 설계·보안 규약(서버 API 계약, 키 보호 체크리스트) | `docs/coupang-inventory-test-design.md` | 설계·보안 담당 | [x] |
| T2 | 백엔드: 키 로더, HMAC 서명, 허용 목록, 호출 제한, 정제 | `tools/coupang-inventory-test/server.cjs` 외 | 백엔드 개발자 | [x] |
| T3 | 프론트: 테스트 페이지 | `tools/coupang-inventory-test/public/index.html`, `app.js`, `style.css` | 프론트 개발자 | [x] |
| T4 | 보안 검토(키 유출 경로) 및 수정 | 검토 결과 기록 | 보안 검토자 | [x] |
| T5 | QA: 가짜 키·가짜 쿠팡 서버 시험, 유출 검사 | `tools/coupang-inventory-test/test/` 결과 | QA | [x] |

## 진행 기록

(단계 완료 때마다 날짜와 결과를 아래에 추가한다.)

- 2026-10-12 **T4·T5 최종 완료**. 가짜 키+로컬 stub+실제 `server.cjs`+실제 화면 통합 시험 `node tools/coupang-inventory-test/test/e2e-ui.cjs` **120개 중 120 통과**(360/768/1440 각 40개: 상태 카드, 연결 확인, 상품 목록 20건·다음 페이지, 옵션 선택, 재고 표의 정상·정상 0(품절 배지)·조회 실패·응답 해석 실패 구분, 로켓그로스 주문가능 재고, 합계 없음, 호출 로그, 403 잠금 카운트다운·버튼 비활성, 자동 해제, 연속 실패 수동 잠금, 해제 대기·횟수 제한). 서버 단위·보안 시험 `node tools/coupang-inventory-test/test/run-tests.cjs` **46/46 통과**. **키 유출 검사**: 브라우저 쪽(응답 66·요청 66·console 21·DOM 6·저장소·쿠키·서버 로그, 204개 항목)에서 가짜 키·서명·`CEA algorithm`·세션 토큰 0건. 실제 키 값(전체와 8자 이상 조각)을 프로그램 안에서만 읽어 프로젝트(`env/` 제외)·작업 폴더·서브에이전트 기록 텍스트 파일 162개를 검색 → **일치 0건**(Claude 세션 대화 기록 폴더는 검사 범위 밖). 실제 키 파일 형식 확인: 서버가 기본 경로로 로드 성공, 형식 오류 없음, vendorId 줄 인식(키 파일이 4줄로 바뀐 것을 반영), 환경 점검 통과, 쿠팡 호출 없음. 프론트 수정: 수동 잠금 해제 횟수 소진(`UNLOCK_LIMIT`) 시 해제 버튼 비활성·"서버를 다시 실행하세요" 안내 유지. **알려진 한계**: 남은 해제 횟수가 0이어도 서버가 거절하기 전까지 버튼이 켜져 있음(`test/e2e-ui.cjs` 488행이 그 시점에 클릭하는 흐름이라 서버 거절 후에만 끔, 클릭해도 서버가 423으로 막고 쿠팡 호출 없음). **미확인**: 실제 쿠팡 응답 형식과 IP 등록·키 상태(가짜 stub만 사용), 키보드·스크린리더, 실제 60초 대기(시계 조작으로 대체), Windows 실제 SIGINT(stdin 신호로 대체)
- 2026-10-12 T4 수정 완료(재확인은 T5): 서버 쪽 `run-tests.cjs` **46개 통과 / 0 실패**(기존 36 + 신규 10). M1 해소 — 시험용 주소는 `createApp({baseUrl})` 인자로만, 키 경로가 `test/fixtures` 또는 임시 폴더이고 Access Key가 `FAKE`로 시작할 때만 켜짐(실제 키와 주소 오버라이드 조합이 구조적으로 불가능, `STOCKD_TEST_BASE_URL`이 환경에 있으면 운영 모드 시작 거부). M2 해소 — 전역 초당 3회 버킷 추가(vendorId 8개 순차 전송에서 1초 창당 3회 이하). L1 마스킹 변형(소문자·base64·hex·제로폭) 보강 + 키 조각 8자 이상 보이면 메시지 통째로 대체, L2 `lib/env-guard.cjs`(TLS·CA·프록시·위험 `NODE_OPTIONS`가 있으면 운영 모드 시작 거부, 변수 이름만 출력), L3 교차 출처(`Sec-Fetch-Site`) 403, L4 수동 해제 60초 대기·서버 실행당 2회(`UNLOCK_WAIT`·`UNLOCK_LIMIT` 423), L6 CSP `default-src 'none'`, L7 시작 실패 마스킹, L9 시험 보강. 프론트 L5(토큰 meta 제거)·L4 문구 처리(`app.js`, `index.html`). 남은 것: M3(키 파일 위치, 사용자 결정), L8 vendorId 자릿수(실제 값 확인 후 설계서·`allowlist.cjs` 정합), 설계서 갱신 10건, `STOCKD_ENV_FILE` 문서화
- 2026-10-12 T4 검토 완료·수정 대기: [coupang-inventory-test-review.md](coupang-inventory-test-review.md). 지적 12건(높음 0 / 중간 3 / 낮음 9). **키가 응답·로그·예외·화면·`results.json`·fixture로 나가는 경로 없음, 쓰기 API 호출 경로 없음, 서명된 요청이 쿠팡 외 호스트로 나가는 경로 없음, 외부 의존성 0, 시작 시 네트워크 호출 없음**(코드 읽기 + 가짜 키·stub 재현). 중간: M1 `STOCKD_TEST_BASE_URL` 환경 변수 경로(실제 키 + 이 변수만 설정 시 서명 요청이 로컬 다른 포트로 평문 전송 가능), M2 초당 3회 제한이 vendorId별이라 vendorId를 바꿔 우회 가능(8회가 31ms에 도달), M3 키 파일이 작업 폴더 `env/`에 있음(`.gitignore`는 git만 막음). 낮음: 마스킹 변형 우회(L1), TLS 환경 변수 방어 없음(L2), `GET /`가 교차 출처에도 토큰 반환(L3), 수동 잠금 해제 대기 없음(L4), 토큰 DOM 잔존(L5), CSP `default-src 'self'`(L6), 시작 실패 메시지 미마스킹(L7), vendorId 정규식 불일치(L8), 시험 빈틈(L9). **실제 키 첫 실행 조건**: ① `STOCKD_TEST_BASE_URL` 미설정 ② TLS·프록시 환경 변수 없음 ③ 첫 호출은 '연결 확인' 1회, 실패 시 잠금 해제 반복 금지 ④ 신뢰할 수 없는 프로그램·확장 없는 PC ⑤ 개발자 도구 화면 공유 금지. 수정 묶음 A(server.cjs) B(guard.cjs) C(sanitize.cjs) D(app.js) E(run-tests.cjs), M3은 사용자 결정
- 2026-10-12 T2 완료(백엔드): `server.cjs`, `lib/{env-loader,coupang-client,allowlist,sanitize,guard,errors}.cjs`, `test/{fake-coupang-stub,run-tests}.cjs`, `test/fixtures/fake-api.txt`(가짜 키). Node v24.12.0에서 `node tools/coupang-inventory-test/test/run-tests.cjs` **36개 통과 / 0 실패**(서명 독립 재계산 검증, 허용 목록 우회 시도, Host/Origin/토큰, 경로 순회, 잠금·호출 제한, 키 파일 형식 오류, 마스킹 유출 자동 검사 T-LEAK-1). 실제 키 파일은 열지 않았고 실제 쿠팡도 호출하지 않음. 설계서와 다르게 한 점: 세션 토큰을 base64url 43자로(64자리 hex 마스킹 패턴이 토큰을 지우기 때문), 초당 3회를 슬라이딩 창으로(더 엄격), 연속 실패 집계 유지, 오류 코드 3종 추가, 파일 구성 일부 병합. **미확인**: Windows에서 SIGINT 종료 처리(`child.kill()`로 대체), 실제 쿠팡 응답 형식(아래 '실호출 확인 필요' 목록)
- 2026-10-12 T3 완료(프론트): `public/index.html`·`app.js`·`style.css`. 인라인 script/style 없음, `innerHTML`·브라우저 저장소·쿠키·`console.*` 사용 0건(정적 검사), 서버 문자열은 `textContent`로만 삽입. 가짜 응답 stub 서버+Playwright로 360/768/1440 확인: 연결 확인→상품 목록→옵션→재고 표→로켓그로스 흐름, 정상 0(품절 배지)·조회 실패('—'+원인)·미실행 구분, 요청 중 버튼 비활성, 403 잠금 카운트다운과 자동 해제, `<img onerror>` 등 서버 문자열이 텍스트로만 표시됨. **미확인**: 실제 `server.cjs`와의 통합(T2와 병행 작성), `manual` 잠금·'잠금 해제' 흐름 실행, 키보드·스크린리더. 백엔드 확인 요청: 오류 메시지 치환 책임, 잠금 `reasonCode`(`COUPANG_AUTH`·`FORBIDDEN`·`NOT_FOUND`·`BAD_REQUEST`·`RATE_LIMIT`), 빈 vendorId 문자열 거부
- 2026-10-12 T1 완료: [coupang-inventory-test-design.md](coupang-inventory-test-design.md). 보안 통제(127.0.0.1 바인딩·Host/토큰/Origin 검사, 키 클로저 격리, 전 구간 마스킹, 서버가 허용 목록 4종 템플릿으로 경로 조립, 호출 잠금). 설계자 질문에 대한 결정: 잠금 일반 오류 60초·429는 5분, 일괄 조회·목록 최대 20건, 재고만 표시(판매가·구매 제한 수량 제외), vendorId는 매번 입력(저장 안 함), 포트 8787, Node 20 이상. 실호출로만 확인 가능한 파라미터(nextToken 종료 값, RG `vendorItemId` 동작, 응답 `code` 형식, `X-Requested-By` 필수 여부, 인증 오류 상태코드 등)는 설계서 5장에 '실호출 확인 필요'로 표기됨
