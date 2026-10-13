# 정적 HTML 시안(ui/) 검토 결과 (H12)

- 작성일: 2026-10-12
- 검토자: H12 (opus)
- 대상: `ui/` HTML 14개, `ui/assets/*.css`, `ui/assets/*.js`
- 기준: `AGENTS.md`, `docs/prototype-html-page-plan.md`, `docs/12-work-plan.md`(로그인 화면 규칙, R1~R6), `docs/01-system-design.md`(4절 재고 의미, 10절 보안), 공통 규약(page-contract)
- 방법: **코드 읽기 검토**. 실행한 것은 아래 두 가지뿐이다.
  - `node --check`: `assets/*.js` 5개, 인라인 스크립트가 있는 HTML 9개 모두 문법 통과 (확인)
  - grep 전수 검색: 외부 URL·fetch·XHR·`url()`·`import`·`<img>`·`<iframe>` 0건, `href`/`src` 대상 파일 전부 존재, 탭 문자 0건, 홀수 들여쓰기 0건, 줄 끝 세미콜론 0건 (확인)
- **브라우저 실행, 화면 폭별 렌더링, 스크린리더 확인은 미실행**이다. 아래에서 "확인"은 코드로 직접 확인한 사실, "추측"은 브라우저 동작에 대한 추정이다.

## 1. 요약

| 구분 | 개수 |
|---|---|
| 검토 관점 | 9개 (통과 1, 부분 통과 7, 판단 항목 1) |
| 지적 합계 | 25건 |
| 높음 | 1건 |
| 중간 | 5건 |
| 낮음 | 19건 |

**한 줄 결론:** 범위 이탈(쓰기 버튼·키 입력창·외부 요청·개인정보)은 없고 mock 표기도 충실하다. 다만 360px 카드 모드에서 여러 줄 셀이 라벨 칸으로 밀리는 레이아웃 결함(높음)과, 대시보드 숫자·상태 예시·설정 문구가 실제 동작과 맞지 않는 곳(중간)은 Next.js 이관 기준으로 쓰기 전에 고쳐야 한다.

## 2. 관점별 결과

| # | 관점 | 판정 | 통과 근거 (확인) | 지적 |
|---|---|---|---|---|
| 1 | 범위 이탈 | 통과 | 버튼 전수: 쇼핑몰 쓰기 버튼 없음(연결 적용·해제, 예시 확인, 샘플 초기화, 일일 기록 삭제는 모두 내부 상태용이고 화면에 그렇게 명시). API 키·토큰 입력창 없음(`input type=password`는 login.html 1곳뿐). 외부 요청 코드 0건. 주문 fixture에 수취인·주소·전화 필드 없음 | L-19 (문구) |
| 2 | 재고 의미 불변조건 | 부분 통과 | `formatQuantity`가 null·실패·미지원·미확인·관리 미사용을 `—`로, 0은 `state=zero`일 때만 표시(mock-data.js:163-170). 합산 함수 없음, 비교표에 합계 열 없음. 첫 조회 실패(r2: 이전 성공값 없음)와 성공 후 실패(c2: 7개 유지·시각 표시) 구분. 로켓그로스 "주문가능 재고" / 판매자배송 "채널 등록 재고" 분리. salesQuantity는 "재고 아님" 표기 | M-2, L-12, L-15, L-17 |
| 3 | mock 표기 | 부분 통과 | 샘플 띠를 layout.js가 14개 페이지 전부에 삽입(login·404 포함). 로그인에 "인증 미구현 · 화면 시안" 배지, 제출 시 `form.reset()` 후 안내만 표시, 저장·전송 코드 없음. 회사 정보는 `[회사명 입력 필요]`·`[입력 필요]`·`contact@example.com (예시)`만 사용. terms·privacy 상단 띠 존재 | M-3, L-11, L-14 |
| 4 | 게임 요소 배치 | 부분 통과 | 대시보드 매일 확인 요약은 맨 아래(index.html:58-62), 사이드바에서 구분선 뒤 마지막. 매일 확인 페이지 상단 고정 안내, 이야기 허구 표기 3곳(카드·다이얼로그·저장 안내). 알림 "예시 확인"과 게임 "검토 기록" 문구 분리 | M-4, L-16 |
| 5 | 접근성 | 부분 통과 | 건너뛰기 링크, `main tabindex=-1`, 다이얼로그 Escape(네이티브 `showModal`)와 `close` 이벤트 초점 복귀(table.js:108-114, settings.html:226-229, missions.html:561-566), 사용자 메뉴 Escape 후 summary 초점 복귀, `--touch-min: 44px` 적용, `prefers-reduced-motion` 전역 처리, 상태 배지는 글자+글리프로 구분(색만 쓰지 않음) | M-5, L-3, L-4, L-5, L-6 |
| 6 | 반응형 | 부분 통과 | 표는 `.table-scroll` 안에서만 가로 스크롤, 960 미만 가로 메뉴와 현재 메뉴 스크롤, 1200 미만 `.col-detail` 숨김. `data-label` 누락 없음(table.js 자동 부여, 정적 표 index·mappings·about·help 전수 확인) | **H-1**, L-18 |
| 7 | 코드 규칙 | 부분 통과 | 2칸 들여쓰기, 세미콜론 없음(ASI 보호용 줄머리 `;(` 2곳은 허용 범위), 한국어 주석, 영어 식별자. XSS: 동적 문자열은 모두 이스케이프되거나 코드 안 상수(저장소에서 읽는 날짜는 `isRealDate`로 검증 후 사용) → 실질 위험 없음 | L-8, L-9 |
| 8 | 페이지 간 일관성 | 부분 통과 | 모든 `href`/`src`가 실제 파일을 가리킴(HTML 고정 링크 + JS 생성 링크 전수). states.html의 12개 링크는 모두 `table.js`의 `STATES` 6종에 들어 있고 inventory·orders 둘 다 `pageName`을 넘겨 처리. 메뉴 7개·푸터 4개 링크 일치 | M-1, L-1, L-7, L-10, L-13 |
| 9 | 알려진 사항 ①~⑥ | 판단 | 5절 참고 | — |

## 3. 지적 목록 (심각도순)

표기: 파일:줄 / 근거 / 수정 제안 / 수정 담당 파일. 묶음은 6절 참고.

### 높음

#### H-1. 600px 미만 카드 모드에서 여러 요소가 든 셀이 라벨 칸으로 밀림 — 묶음 B1
- 위치: `assets/components.css:1482-1490`(카드 모드 `td { display: grid; grid-template-columns: minmax(88px, 36%) minmax(0, 1fr) }`), 자식 배치 규칙 없음
- 근거(확인): 카드 모드 `td`는 2열 grid이고 `::before`(라벨)가 1열을 차지한다. 셀 안에 자식이 2개 이상이면 grid 자동 배치로 두 번째 자식이 **다음 줄의 라벨 칸(88px)** 에 들어간다. `.secondary`는 `display: block`(base.css:156)이라 독립 grid 항목이 된다. 해당 셀:
  - inventory 채널·계정(채널+계정), 조회 상태(배지+설명), 마지막 성공(시각+시도)
  - orders 일시, 채널·배송, 상품·옵션(텍스트 노드+span 2개), 원본 상태(배지+span 2개), 클레임
  - index 비교표 3개 열(수량 종류+수량+배지), mappings 채널/계정/원본 ID(3개), 연결 이력 계정
- 화면 결과(추측, 브라우저 미확인): 360px에서 계정명·설명이 왼쪽 좁은 라벨 칸 아래로 떨어져 라벨과 값이 뒤섞여 보인다. 첫 버전 핵심 화면 전부에 해당.
- 수정 제안: `components.css` 카드 모드에 `.responsive-table td:not(.cell-title):not(.cell-actions) > * { grid-column: 2 }` 추가. 텍스트 노드가 직접 들어가는 셀(orders.html:93 상품명, mappings.html:204 계정명)까지 막으려면 `table.js` `renderRow`에서 셀 내용을 `<div class="cell-value">…</div>`로 감싸고, 정적 표는 `<span>`으로 감싼다.
- 담당: `assets/components.css`, `assets/table.js` (텍스트 노드 감싸기는 orders.html·mappings.html — 각 묶음에서)

### 중간

#### M-1. 대시보드 요약 숫자와 이동한 목록 건수가 다름 (알려진 사항 ⑥ 포함) — 묶음 B2
- 위치: `index.html:97-100`, `inventory.html:43, 117-121`
- 근거(확인): "품절·부족 **3**건"과 "조회 실패·지연 **2**건" 카드가 모두 `inventory.html?status=attention`으로 가고, 이 필터는 zero·low·failed·stale·미연결을 합쳐 **6행**을 보여 준다. "미지원·관리 미사용·지원 미확인 **3**건"은 필터 없이 `inventory.html`(10행)로 간다. 카드 숫자와 도착 화면 건수가 맞지 않아 "숫자를 믿을 수 없는 화면"이 된다.
- 수정 제안: inventory 상태 필터에 `stock`(zero+low), `sync`(failed+stale), `unavailable`(unsupported+unmanaged+unverified) 선택지를 추가하고, 카드 링크를 `?status=stock` / `?status=sync` / `?status=unavailable`로 바꾼다. `attention`은 알림 링크용으로 유지.
- 담당: `inventory.html`, `index.html`

#### M-2. 상태 예시 페이지가 "지연 상태도 수량을 `—`로 비운다"고 안내 — 묶음 B5
- 위치: `states.html:21`
- 근거(확인): "오류·**지연**·미지원 상태의 수량은 0으로 바꾸지 않고 '—'로 비워 두며". 실제 규칙과 구현은 지연(stale)일 때 **마지막 성공값을 유지해 표시**한다(01-system-design 4절 "성공 후 실패: 마지막 성공값 유지", mock-data c2 = 7, help.html:112 "마지막 성공값 + 시각"). 핵심 불변조건을 반대로 설명한다.
- 수정 제안: "조회 실패·미지원·미확인·관리 미사용은 '—', 확인 지연은 마지막 성공값과 성공 시각을 함께 표시, 0은 정상 조회 결과가 0일 때만"으로 고친다.
- 담당: `states.html`

#### M-3. 연결·설정의 문구가 다른 화면에 반영된다고 약속하지만 실제로는 반영되지 않음 (알려진 사항 ① 관련) — 묶음 B4
- 위치: `settings.html:77`, `:112`, `:299`, `:261`
- 근거(확인): ① 수량 강조 기준: "표에서 이 개수 이하의 수량을 부족으로 강조합니다"라고 하지만 값은 `StockD.state.threshold`에만 쓰이고 어디서도 읽지 않는다(inventory·index는 `StockD.data.meta.defaultThreshold` 고정). 또 상태 배지(low)는 데이터에 고정이라 기준을 바꿔도 "부족 예시" 배지는 그대로다. ② 샘플 초기화: "상품 연결, 알림 확인, 수량 기준을 처음 상태로"라고 하지만 `StockD.state`는 페이지마다 새로 복제되므로 다른 페이지의 연결·알림 확인은 이미 이동 시점에 사라진다. 결과적으로 버튼이 바꾸는 것은 이 페이지의 기준값뿐이다.
- 수정 제안: 문구를 "이 화면 시안에서만 확인하는 값이며 다른 화면의 표에는 반영되지 않습니다(새로고침·이동 시 초기화)"로 바꾼다. 필요하면 설정 카드 안에 예시 수량 3~4개로 강조 미리보기를 둔다. 샘플 초기화 설명은 "이 시안은 페이지를 이동하면 샘플이 처음 상태로 돌아갑니다. 이 버튼은 현재 페이지 값을 되돌립니다"로 정정.
- 담당: `settings.html`

#### M-4. 방문 기록이 업무 확인으로 읽히는 문구, 오류 화면에서도 "재고 확인" 기록 (알려진 사항 ②③ 관련) — 묶음 B4
- 위치: `assets/missions.js:18-20`(단계 라벨 "재고 확인하기", "주문 여부 확인하기"), `:309`(토스트 "재고 확인을 오늘 미션에 기록했습니다"), `:431`(로드 즉시 기록), `missions.html:242-244`(설명 "수량과 조회 상태를 살펴보세요")
- 근거(확인): R4는 "방문 미션이 업무 확인으로 오인"을 리스크로 둔다. 페이지를 열기만 해도 "재고 확인"이 기록되고, `inventory.html?state=error`처럼 "재고 정보를 불러오지 못했습니다" 카드만 보이는 화면에서도 같은 토스트가 뜬다. 매일 확인 페이지 안내문(“화면 방문 기록일 뿐”)은 있으나 업무 화면에서 뜨는 토스트에는 그 맥락이 없다.
- 수정 제안: 라벨을 "재고 화면 방문", "주문 화면 방문"으로, 토스트를 "재고 화면 방문을 오늘 기록에 남겼습니다(재고 점검 완료가 아닙니다). n/3"으로 바꾼다. `?state=loading|error|unauthorized`일 때는 기록하지 않는다(5절 ③).
- 담당: `assets/missions.js`, `missions.html`

#### M-5. 재고 상태 배지 클래스를 다른 의미에 재사용해 상태 구분이 흐려짐 — 묶음 B1(클래스 추가) + B2·B3(사용처)
- 위치: `inventory.html:59`·`mappings.html:193`(SKU "미연결"에 `badge-unmanaged`), `index.html:116`(계정 "실제 미연결"에 `badge-unverified`) vs `settings.html:185`(같은 값에 `badge-unsupported`), `mappings.html:156`·`orders.html:49`(직접 확인 필요·클레임에 `badge-low`), `mappings.html:155, 203`(연결됨에 `badge-normal`)
- 근거(확인): 상태 배지 8종은 색+글리프(✓ ▼ ■ ! ↻ ⊘ – ?)로 재고 상태를 뜻한다(components.css:139-243). inventory 한 행 안에서 SKU 칸 "– 미연결"과 상태 칸 "– 관리 미사용"이 같은 모양이 되고, 같은 "실제 미연결"이 대시보드와 설정에서 다른 배지로 나온다.
- 수정 제안: components.css에 재고 상태와 무관한 보조 배지(예: `.badge-neutral`, `.badge-attention`, `.badge-link`)를 추가하고 위 사용처를 교체한다. "실제 미연결"은 한 가지 클래스로 통일.
- 담당: `assets/components.css`, `inventory.html`, `index.html`, `mappings.html`, `orders.html`, `settings.html`

### 낮음

| ID | 위치 | 근거 (확인/추측) | 수정 제안 | 담당·묶음 |
|---|---|---|---|---|
| L-1 | orders.html:162 | 상태 필터 id가 `state`라서 `?state=` UI 상태 파라미터와 이름이 같다. 지금은 값이 겹치지 않아 동작하지만 `orders.html?status=claim`은 무시되고 inventory(`?status=`)와 규칙이 다르다 (확인) | 필터에 `param: 'status'` 지정(table.js가 이미 `filter.param` 지원) | orders.html · B3 |
| L-2 | layout.js init, missions.html:44·49, components.css:957 | 계약은 효과 기본값 'on'이지만 `data-effects="on"`은 settings.html body에만 있다. 다른 페이지에서는 토스트 등장 효과·배지 획득 효과 CSS가 적용되지 않는다 (확인) | layout.js init에서 `data-effects`가 없으면 'on' 지정 | layout.js · B1 |
| L-3 | table.js:67·277, states.html:28-95 | 상태 카드·빈 상태 제목이 `h3` 고정이라 inventory·orders(`h1` 다음 `h2` 없음)와 states.html에서 제목 단계를 건너뛴다 (확인) | table.js 제목을 `h2`로(또는 옵션), states.html 카드 제목 `h2` | table.js · B1 / states.html · B5 |
| L-4 | states.html:26-92 | 정적 예시 카드에 `role="alert"` 2개, `role="status"` 4개 → 페이지 로드 시 낭독될 수 있음 (추측) | 예시 페이지에서는 role 제거(table.js가 실제 재현할 때만 role 부여) | states.html · B5 |
| L-5 | index.html:153, mappings.html:43·81·185, about.html:53, help.html:22, states.html:113 / layout.js:29 | 직접 쓴 `.table-scroll`에 `role="region"`이 없어 `aria-label`이 무시된다(table.js는 있음). about·help 표 `th`에 `scope` 없음. 사이드바가 `aside aria-label="주 메뉴"`라 주 내비가 complementary 안에 있음 (확인) | `role="region"` 추가, `th scope="col"`, aside 레이블을 "사이드바"로 하거나 `nav`만 표시 | 각 페이지 묶음 / layout.js · B1 |
| L-6 | table.js:315·342 | `role="status"` 요약 줄을 입력마다 `innerHTML`로 새로 만든다. 새로 생긴 live region은 낭독되지 않을 수 있음 (추측) | 요약 요소를 한 번 만들고 `textContent`만 갱신 | table.js · B1 |
| L-7 | orders.html:51 | 결제 완료·배송 중에 `badge-sample` 사용 → "샘플" 표지와 같은 모양 (알려진 사항 ④, 확인) | M-5의 중립 배지 사용 | orders.html · B3 |
| L-8 | mappings.html:108, alerts.html:78, settings.html:166, missions.html:213 / index·inventory·orders·mappings 배지·채널 헬퍼 / missions.html:401-403 / `<style>` 3곳(alerts·mappings·missions), 인라인 `style=` 12곳 | `escapeHtml` 4벌 중복(settings 판은 `'` 미처리 — 현재는 큰따옴표 속성에만 써서 안전), 배지·채널 헬퍼 4벌, 라벨 사전 재정의, 페이지 전용 스타일 분산 (확인) | `StockD.table.escapeHtml`(또는 공용 `StockD.html`) 사용, `labels` 사전 사용, 반복 스타일은 components.css로 이동 | 각 묶음 |
| L-9 | settings.html:261, mock-data.js:200-212, inventory.html:189, table.js:222, orders.html:29, base.css:452, mock-data `mappings.chosen`(mappings.html 미사용) | 죽은 코드: 읽히지 않는 `state.threshold`, 쓰이지 않는 summary 필드 6개(sample·inventoryTotal·orderTotal·claimOrders·openAlerts·alertTotal), `hideMobile: false`, 곧바로 덮어쓰는 `slot` 첫 할당, 없는 id를 가리키는 `aria-labelledby="orderDialogTitle"`, 미사용 `.nav-count` (확인) | 제거하거나 "이관용 예약" 주석 | 각 묶음 |
| L-10 | states.html | 어느 페이지에서도 states.html로 가는 링크가 없다(메뉴·푸터·도움말 모두 없음) (확인) | help.html "재고 상태 8종" 아래에 "화면 상태 6종 예시 보기" 링크 | help.html · B5 |
| L-11 | login.html:29·36 | `autocomplete="username"`/`"current-password"`라 제출 후 브라우저가 비밀번호 저장을 제안할 수 있다. "입력값 비저장" 원칙과 충돌 가능 (추측) | 시안 단계에서는 `autocomplete="off"`, 실제 인증 도입 때 복원 | login.html · B5 |
| L-12 | help.html:109-110 | 정상 "부족 기준 **이상**", 부족 "부족 기준 **이하**" → 기준값이 두 상태에 겹침. 구현은 `<= 기준`이 부족(mock-data.js:182) (확인) | 정상을 "기준 초과"로 | help.html · B5 |
| L-13 | orders.html:85·123 | 주문 일시만 `2026-10-04 09:12` 형식, 다른 화면은 `2026.10.04` (`formatDateTime`) (확인) | `StockD.format.formatDateTime(o.date + ' ' + o.time)` | orders.html · B3 |
| L-14 | privacy.html | 매일 확인이 브라우저 localStorage에 방문 날짜를 저장하는데 방침 샘플에 언급이 없다 (확인) | "이 브라우저에만 저장되는 화면 방문 기록" 항목 추가(샘플 표기 유지) | privacy.html · B5 |
| L-15 | index.html:132 | 비교표에서 데일리 머그의 쿠팡 판매자배송 칸이 "해당 옵션 없음"으로 나온다. 실제로는 옵션(c2)이 있으나 내부 SKU 미연결이다 (확인) | "연결된 옵션 없음"으로 표기하고 상품 연결 링크 | index.html · B2 |
| L-16 | missions.html:130 | 배지 "한 바퀴 검토"의 조건이 이름과 다르다는 것을 설명문으로 알리고 있다 (확인) | 이름을 조건에 맞게(예: "세 옵션 연결 체험") 바꾸고 설명문 삭제 | missions.html · B4 |
| L-17 | mock-data.js:8-11 | 주석이 unsupported·unverified를 `readState`로 대응시킴. 설계상 unsupported는 `valueState`, unverified는 기능 지원값(`supported/unsupported/unverified`) (확인) | 주석 정정(이관 시 혼동 방지) | mock-data.js · B4 |
| L-18 | components.css:1598, base.css:1032 | 960px 미만에서 `.reference-time`과 `.topbar-date`가 모두 숨어 모바일에는 "예시 기준 시각"이 어디에도 없다 (확인) | 둘 중 하나는 유지(예: topbar-date를 줄여서 표시) | components.css · B1 |
| L-19 | orders.html:22 | "주문 상태 변경과 취소·반품·교환 지원은 미확인" → StockD가 상태 변경 기능을 지원할 수도 있다는 뜻으로 읽힐 수 있다 (확인, 해석은 추측) | "상태 변경 내역과 취소·반품·교환 조회 지원은 미확인" | orders.html · B3 |

## 4. 관점별 세부 메모

- **범위 이탈(관점 1):** 쓰기처럼 보이는 동작은 상품 연결 "시안에 연결 적용/해제", 알림 "예시 확인", 매일 확인 "샘플 연결 승인/해제"뿐이며 모두 "쇼핑몰에는 어떤 값도 보내지 않습니다" 문구가 곁에 있다(mappings.html:30·57, alerts.html:36). settings.html의 연결 절차는 설명만 있고 입력창·링크 없음(외부 링크도 의도적으로 생략, :54).
- **재고 의미(관점 2):** `quantityClass`가 stale일 때 부족 강조를 빼서 "오래된 7개"가 부족처럼 보이지 않게 한 점, 로켓그로스 클레임 `null`을 "지원 미확인 · 클레임 없음이 아닙니다"로 표시한 점(orders.html:62-64)은 좋다.
- **mock 표기(관점 3):** 사용자 메뉴 "DEMO-user · 인증 미구현", 로그아웃 비활성, 로그인 결과 "어디에도 전송되거나 저장되지 않았습니다" 모두 확인. 로그인 페이지는 단순 푸터라 개인정보처리방침 링크가 없다(규약상 허용, 실서비스 전에는 추가 권장).
- **게임 요소(관점 4):** 매일 확인 토스트는 화면 하단 `role=status`로 경고 영역을 덮지 않는 위치다(추측: 고정 위치라 좁은 화면에서 마지막 행을 3초간 가릴 수 있음).
- **XSS(관점 7):** innerHTML 사용 29곳을 모두 따라가 봤다. 외부 입력은 URL 쿼리(`state`·`status`)와 localStorage뿐이고, 쿼리는 허용 목록 값만 받고(table.js:46·212) 저장소 날짜는 정규식·실제 날짜 검증 후 쓰인다. 위험 없음.

## 5. 알려진 사항 판단

| # | 사항 | 권고 | 이유 |
|---|---|---|---|
| ① | `StockD.state.threshold`가 settings에서만 반영 | **문구를 고친다(M-3).** 저장(세션·로컬)은 도입하지 않는다 | 규약이 "저장 안 함"이고, 페이지마다 state가 새로 복제되므로 구조상 전달 불가. 문제는 동작이 아니라 "표에서 강조합니다"라는 틀린 약속이다. 쓰기만 하는 `state.threshold`는 제거하거나 이관 메모로 남긴다 |
| ② | 단계 하나라도 있으면 '열기' 보정 | **유지하되 설명을 맞춘다.** 라벨 "오늘 StockD 열기", 설명 "대시보드·재고·주문 중 한 화면을 열면 기록" | 보정이 없으면 재고만 본 날이 "2/3인데 열기 미완료"가 되어 더 혼란스럽다. 현재 설명(missions.html:242 "대시보드를 열면")만 동작과 다르다 |
| ③ | `?state=error`에서도 방문 기록 | **고친다.** `loading`·`error`·`unauthorized`에서는 기록하지 않는다(`empty`·`stale`·`partial`은 화면이 정상 표시되므로 기록) | 데이터를 보지 못한 화면에서 "재고 확인 기록" 토스트가 뜨는 것은 R4 오인을 가장 직접적으로 키운다. missions.js가 로드 시 URL 쿼리를 읽어 판단하면 된다(table.js보다 먼저 실행되므로 자체 판단 필요) |
| ④ | 결제 완료·배송 중 배지에 `badge-sample` | **고친다(낮음, L-7).** M-5의 중립 배지 사용 | 같은 화면에 "샘플" 표지가 많아 상태 배지와 구분이 안 된다 |
| ⑤ | 사이드바 `nav-count` 미표시 | **그대로 둔다.** 미사용 CSS는 이관 예약 주석만 | 알림 확인이 페이지 간 유지되지 않아 숫자를 넣으면 페이지마다 다른 값이 보인다. 계획서에도 요구 없음 |
| ⑥ | 미지원 카드의 필터 없음 | **고친다(M-1).** `?status=unavailable` 추가 | 같은 문제가 품절·부족 / 실패·지연 카드에도 있어 함께 해결해야 숫자가 일치한다 |

## 6. 수정 작업 묶음 제안 (파일 겹침 없음)

| 묶음 | 파일 | 포함 지적 | 순서 |
|---|---|---|---|
| B1 공용 자산 | `assets/components.css`, `assets/table.js`, `assets/layout.js` | H-1, M-5(중립 배지 클래스 추가), L-2, L-3(table.js), L-5(layout.js aside), L-6, L-9(table.js·base.css는 제외), L-18 | **먼저** (B2·B3이 새 배지 클래스와 셀 감싸기 규칙을 사용) |
| B2 대시보드·재고 | `index.html`, `inventory.html` | M-1, M-5(사용처), L-5(index), L-8(헬퍼), L-9(hideMobile), L-15 | B1 뒤 |
| B3 주문·연결·알림 | `orders.html`, `mappings.html`, `alerts.html` | H-1(텍스트 노드 감싸기), M-5(사용처), L-1, L-5(mappings), L-7, L-8, L-9(aria-labelledby), L-13, L-19 | B1 뒤, B2와 병렬 |
| B4 매일 확인·설정·데이터 | `assets/missions.js`, `missions.html`, `settings.html`, `assets/mock-data.js` | M-3, M-4(②③ 포함), M-5(settings 사용처), L-8(missions 라벨·settings escape), L-9(state.threshold, summary 필드), L-16, L-17 | B1 뒤(배지 클래스), B2·B3과 병렬 |
| B5 안내·공통 페이지 | `states.html`, `help.html`, `privacy.html`, `login.html`, `about.html` | M-2, L-3(states), L-4, L-5(about·help·states), L-10, L-11, L-12, L-14 | 독립, 언제든 |

- `base.css`의 `.nav-count`(L-9)는 ⑤ 판단상 그대로 두므로 어느 묶음에도 넣지 않았다.
- 각 묶음 완료 후 H13 검증 스크립트로 360/768/1440 화면 캡처와 외부 요청 0건을 실제로 확인해야 한다. 특히 H-1은 브라우저 확인 전까지 "코드 근거 추정"이다.
