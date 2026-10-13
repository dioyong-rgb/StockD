# 쿠팡 Open API 공식 문서 대조·연동 절차 검증

- 확인 기준일: **2026-10-12**
- 대상: 기존 문서 `03-api-readiness.md`(R), `notion-simple/08-coupang-api.md`(N8), `notion-simple/09-coupang-api-manual.md`(N9), `01-system-design.md`(SD)의 쿠팡 주장 C01~C49
- 상태: **공식 문서 열람만 수행. 쿠팡 API 호출·키 발급·WING 로그인은 하지 않음.** 이 문서의 어떤 내용도 실제 연동 검증 결과가 아니다.

## 1. 요약

기존 문서의 경로·인증·키 관리 내용은 대부분 공식 문서와 일치한다. 가장 큰 차이는 다섯 가지다. (1) 호출 제한: 기존 문서는 "일반 API 한도 미확인"으로 두었지만, 공식 공지는 **판매자(vendorId) 단위 초당 5회 기준을 쿠팡 전체 API에 적용**한다고 밝힌다. (2) 기존 문서가 모순으로 남긴 RG 재고 파라미터(A3)는 현행 포털에서 `vendorItemId` 하나로 통일되어 **해소**됐다. (3) returnRequests 조회 조합(A4)은 공식 오류 문구로 규칙이 **대부분 해소**됐다. (4) 기존 문서와 이번 1차 조사 모두 "없다"고 한 **RG 주문 단건 조회 API가 존재**한다. (5) RG 주문의 "출고 이후에만 조회"는 공식 문구(`[출고일] 이후의 주문을 지원`)가 모호해 **확정 표현은 과하다**. 그 밖에 발주서는 `status`가 필수라 상태별로 따로 호출해야 하고, 발주서·반품·교환 응답에는 **수취인·주소·전화 등 개인정보가 포함**된다. 변경분 조회 API는 없다.

### 조사 방법과 신뢰도 한계

| 표기 | 의미 |
| --- | --- |
| **직접 재확인함** | 2026-10-12에 내장 브라우저로 공식 페이지(developers.coupang.com/ko) 원문 텍스트를 직접 읽음 |
| **요약 의존** | 1차 조사(WebFetch가 본문을 작은 모델로 요약한 결과)에만 근거함. 수치·파라미터명이 틀렸을 수 있음 |
| **확인 못 함** | 공식 문서에 없거나 실계정에서만 확인 가능함 |

직접 재확인한 페이지(12개): 키 발급 가이드, HMAC 서명, 속도제한 도입 공지(2023-07-07), 호출 빈도 조정 공지(2026-03-17), 포털 v1 종료 공지(2026-10-06), 판매자배송 재고, 발주서 일 단위, 발주서 분 단위, 반품·취소 목록, 교환 목록, RG 재고, RG 주문 목록, RG 주문 단건.
한계: 포털 페이지에는 "최종 수정일"이 없다. API 문서 페이지에는 라벨 없는 버전 코드(`2609170000`)만 있다. FAQ 답변 본문, 사전 연동 가이드 PDF, 연동 계약 원문은 직접 읽지 않았다.

## 2. 실제 연동 절차

### 원칙: 비밀값 취급

- Access Key·Secret Key는 **서버 비밀 저장소에만** 둔다. 브라우저, `NEXT_PUBLIC_` 변수, 문서, fixture, 로그, 채팅, 이슈에 넣지 않는다(AGENTS.md, SD 10장).
- **에이전트(AI 포함)는 키를 받거나 입력하거나 출력하지 않는다.** 키 발급·저장소 등록은 사용자가 직접 하고, 개발은 "키가 저장소에 있다"는 사실과 마스킹된 식별자(예: Access Key 앞 4자리)만 다룬다.
- 서명 원문, Authorization 헤더, 개인정보가 담긴 응답 원문은 로그에 남기지 않는다.

### 단계별 절차

| # | 단계 | 사용자가 직접 할 일 | 개발이 할 일 | 소요 시간(공식/추정) | 막힐 수 있는 지점 |
| --- | --- | --- | --- | --- | --- |
| 1 | 판매자 가입·사업자 인증 | WING에 판매자 등록하고 사업자 인증 완료 | 없음 | 쿠팡 심사에 따라 다름(공식 수치 없음) | 비사업자 일반회원은 키 발급 불가. 판매중지 계정도 발급 제한(직접 재확인함) |
| 2 | vendorId 확인 | WING 로그인 후 판매자 코드(A로 시작) 확인 | 설정 화면에 vendorId 입력란(비밀값 아님) | 즉시 | vendorId는 키와 함께 "발급"되는 값이 아니라 기존 판매자 코드임(교환 API 문서에 "WING 로그인 후 확인 가능", 직접 재확인함) |
| 3 | 호출 서버 고정 IP 확보 | 운영 서버/프록시의 고정 발신 IP를 개발에서 전달받음 | 고정 발신 IP 확보(NAT 게이트웨이·고정 IP 프록시 등), 개발용 IP 별도 | 인프라에 따라 다름 | 서버리스·동적 IP 환경은 등록 불가 위험. IP 등록이 "필수"인지는 문구상 불명확(입력 가능이라고만 표기) |
| 4 | 키 발급 | WING > 우측 상단 ID > 판매자정보 또는 추가판매정보 > API Key 발급 > OPEN API > 약관 동의 > **자체개발** 선택 > 업체명·URL·IP(최대 10개) 입력 | 없음(키 값을 전달받지 않음) | 발급 즉시, **실제 권한은 24시간 이상** 걸릴 수 있음(직접 재확인함) | 메뉴 위치가 판매자 ID마다 다름. 연동업체 방식과 혼동 주의(연동업체는 1곳만 선택 가능) |
| 5 | 키 저장 | 서버 비밀 저장소에 Access Key·Secret Key 직접 등록, 만료일(발급일+180일) 기록 | 저장소 참조 방식 구현, 만료일만 DB/설정에 저장 | 수 분 | 키를 채팅·메일로 개발자/에이전트에게 보내지 않음 |
| 6 | 서명 구현 | 없음 | HMAC-SHA256 서명 모듈. 서명 대상 = `signed-date + METHOD + PATH + QUERY`(구분자 없음), signed-date `yyMMddTHHmmssZ`(UTC), 결과 소문자 hex, 헤더 `CEA algorithm=HmacSHA256, access-key=…, signed-date=…, signature=…`. 서버 NTP 시각 동기화 | 0.5~1일(추정) | 쿼리 인코딩 불일치(서명용 문자열과 실제 전송 쿼리 다름), `%2B09:00` 같은 이미 인코딩된 값 처리. 시간 오차 허용치 미공개. 공식 Python 샘플은 SSL 검증을 끔(복사 금지). 공식 Java/PHP 샘플 경로는 구버전 `v4/returnRequests`(현행 v6) |
| 7 | 첫 호출(읽기 전용) | 권한 활성화 대기(최대 24시간+) | 가장 가벼운 읽기 1건부터: 판매자배송 재고 1건(`vendor-items/{id}/inventories`) 또는 상품 목록 1페이지. 등록 IP에서만 호출 | 1일(권한 대기 포함) | 잘못된 vendorId로 404를 대량 발생시키면 IP·vendorId 차단 가능(공지, 요약 의존). 반복 실패 시 즉시 중단 |
| 8 | 로켓그로스 권한 | WING에서 로켓그로스 이용 여부 확인. RG 상품 **생성**에는 추가판매정보 > OPEN API 영역의 검수 기준 동의 필요(조회에는 필요 여부 미기재) | RG 재고·RG 주문 조회 1건씩 시험 | 미기재 | 별도 키 없음(같은 키 사용, 요약 의존). RG 미이용 계정에서의 응답 형태 확인 못 함 |
| 9 | 운영: 키 만료 관리 | 만료 2주·1주 전 메일 수신 시 **만료 14일 전부터 활성화되는 재발급 버튼**으로 재발급, 새 Secret Key를 저장소에 교체 | 만료일 D-21/D-14/D-7 내부 알림, 401 연속 발생 시 수집 중단·"키 만료 의심" 표시 | 재발급 후 최대 30분 반영 | 재발급하면 Secret Key가 새로 생성되므로 교체 순간 짧은 실패 가능. 연동정보 수정은 주 10회 제한 |
| 10 | 운영: 호출 제한 | 없음 | vendorId 단위 공유 토큰 버킷(초당 5회 이하, 여유를 두어 3~4회), RG 2개 API는 추가로 분당 50회 | - | 429 후 해제까지 수 분~수십 분(직접 재확인함). Retry-After 지침 없음 |

### 실제 연동 전 체크리스트

- [ ] 사업자 인증된 WING 계정, 판매중지 상태 아님
- [ ] vendorId(A로 시작) 확인, 설정값으로만 저장
- [ ] 운영·개발 고정 발신 IP 확정(최대 10개 내), IP 미등록 시 거부되는지 첫 호출에서 확인
- [ ] 키는 사용자가 비밀 저장소에 직접 등록, 만료일 기록, 에이전트·문서·로그에 키 없음
- [ ] 서버 시각 NTP 동기화, 서명 모듈 단위 테스트(공식 예시 문자열로 고정 입력 → 고정 출력)
- [ ] 쓰기 API 경로 차단(아래 8장 허용 목록만 통과하는 HTTP 클라이언트)
- [ ] vendorId 단위 공유 호출 예산(초당 5회 미만)과 RG 분당 50회 예산
- [ ] 개인정보 필드 제거 계층이 저장·로그·원본 보관 앞단에 있음(5장 ②)
- [ ] 첫 호출 대상은 1건짜리 읽기, 실패 시 자동 반복 없음
- [ ] 결과를 WING 화면과 대조하기 전에는 "연동 완료"로 표시하지 않음

## 3. 대조표

판정: 일치 / 차이 / 새 정보 / 확인 불가. 차이·새 정보를 위로 정렬했다.

| 기존 ID | 기존 주장(요약) | 공식 문서 결과 | 판정 | 영향 | 신뢰도 |
| --- | --- | --- | --- | --- | --- |
| C19 | 일반 API 한도 미확인, RG 50회/분만 확인 | 2023-07-10부터 **전체 API**에 vendorId 단위 속도제한, 기본 **초당 5회** 기준, 시스템·vendorId별로 변경 가능, 초과 시 429, 줄이면 수 분~수십 분 뒤 해제. 2026-03-17 공지: 일부 API를 초당 10회 → 5회로 조정(대상 목록 없음) | 차이(새 정보) | 높음 | 직접 재확인함 |
| C40 (A3) | RG 재고 단일 옵션 파라미터 `vendorIdItemId` vs `vendorItemId` 모순 | 현행 페이지의 설명·Query 표·응답 모두 `vendorItemId`. `vendorIdItemId`는 현행 본문에 없음(구 문서 표기로 추정). 지정 시 그 SKU만 반환하고 nextToken 무시 | 차이 → **해소** | 높음 | 직접 재확인함(실호출 확인 전) |
| C33·C34 (A4) | `cancelType=CANCEL`이면 status·orderId 제외 vs orderId 필수 조건 충돌 | 규칙: ① `status`를 빼면 `orderId` 필수(오류 문구로 명시) ② CANCEL 조회는 status·orderId를 제외 ③ `status`는 CANCEL에서 미지원 ④ `orderId`·`nextToken`·`maxPerPage`는 `searchType=timeFrame`에서 미지원 ⑤ CANCEL은 maxPerPage보다 적게 반환될 수 있음. ①은 RETURN 조회 규칙, ②는 CANCEL 예외로 읽으면 충돌 없음 | 차이 → **대부분 해소**(①·②의 적용 순서는 실호출 확인 필요) | 높음 | 직접 재확인함 |
| C43 | RG 주문은 "출고 이후에만 조회됨" | 공식 문구는 `[출고일] 이후의 주문을 지원`뿐. 대괄호가 치환되지 않은 자리표시처럼 보여 "출고 이후 주문만 노출"인지 "특정 출시일 이후 주문"인지 불명확 | 차이(근거 대비 과대 확정) | 높음 | 직접 재확인함(의미는 확인 못 함) |
| (없음) | RG 주문 단건 조회 없음(1차 조사도 "단건 없음") | `GET /v2/providers/rg_open_api/apis/api/v1/vendors/{vendorId}/rg/order/{orderId}` 존재. 응답 `paidAt`은 문자열(`yyyy-MM-dd'T'HH:mm:ss`), 가격 필드는 `salesPrice`(목록은 `unitSalesPrice`, `paidAt` 밀리초 정수) | 새 정보 | 중간 | 직접 재확인함 |
| C29·C30 | 발주서: 기간·상태 필터, 31일, 50건, 파라미터명 미기재 | `createdAtFrom`·`createdAtTo`·`status` **모두 필수**(status 1개 값). 형식 `yyyy-mm-dd%2B09:00`(KST 오프셋). maxPerPage 기본·최대 50. `searchType=timeFrame`이면 분 단위(24시간 이내, 요청 페이지 파라미터 없음). createdAt이 주문일·결제일 중 무엇인지 미정의 | 차이(상태별 필수 호출) + 새 정보 | 높음 | 직접 재확인함 |
| C21 | 모든 목록은 nextToken으로 끝까지 | returnRequests `timeFrame`과 발주서 분 단위는 요청 페이지 파라미터가 없음. RG 재고 단일 조회는 nextToken 무시 | 차이 | 중간 | 직접 재확인함 |
| C20 | HTTP 상태와 결과 코드 확인 | 응답 envelope가 API마다 다름: 판매자배송 재고 `code`="SUCCESS"(문자열), 발주서·반품 `code`=200(숫자), RG 재고 표는 SUCCESS/ERROR라 쓰고 예시는 200 | 차이(파서 영향) | 중간 | 직접 재확인함 |
| C03 | 키 발급 시 vendorId·Access·Secret 확인 | 발급 화면은 Access Key·Secret Key만. vendorId는 WING 로그인 후 확인하는 기존 판매자 코드 | 차이 | 낮음 | 직접 재확인함 |
| C06·C02 | 자체개발은 URL·IP 등록 필요 | 업체명·URL·IP 입력 화면이 있고 IP는 "최대 10개까지 입력 가능". URL이 없으면 wing.coupang.com 입력도 무방. 미등록 시 거부 여부는 미기재 | 차이(필수 여부 불명) | 중간 | 직접 재확인함 |
| C32 | 반품·취소: 일 단위 31일, nextToken | 31일 일치. `searchType`이 필수 표시인데 일 단위용 값은 문서에 없음. 대량이면 412 타임아웃, 짧은 기간 권장 | 일치 + 새 정보 | 중간 | 직접 재확인함 |
| C45 | RG 상태·클레임 미확인 | RG 목록·단건 응답 모두 상태·변경시각·클레임 필드 없음. RG 메뉴 8개 중 클레임 조회 API 없음 | 일치(부재 확인) | 높음 | 직접 재확인함(일반 클레임 API의 RG 포함 여부는 확인 못 함) |
| C35 | 발주서로 반품 완료 확인 불가 | 공식 명시: 반품완료 건은 발주서 목록에서 조회 불가 | 일치 | 중간 | 직접 재확인함 |
| C37 | 교환: 최대 7일, 접수일 기준, 수정시각 필드 | "교환 접수일자로 최대 7일" 명시. `modifiedAt` 있음. 날짜 형식 `yyyy-MM-ddTHH:mm:ss`, maxPerPage 기본 10 | 일치 + 새 정보 | 낮음 | 직접 재확인함 |
| C23 | 상품 목록 경로·nextToken | 경로 일치. vendorId 필수, maxPerPage 기본 10·최대 100, status 필터, createdAt 단일 일자. 별도 시간 구간 조회(최대 10분) 존재 | 일치 + 새 정보 | 낮음 | 요약 의존 |
| C44 | RG 주문 salesQuantity·paidAt·금액/통화 | 일치. `paidAt` 밀리초 정수, `unitSalesPrice` 문자열 | 일치 + 새 정보 | 낮음 | 직접 재확인함 |
| C07 | 키 유효기간 180일 | 일치. 만료 후 인증 불가, 2주·1주 전 메일, 14일 전부터 재발급 버튼 | 일치 + 새 정보 | 중간 | 직접 재확인함 |
| C08·C09 | 권한 24시간+, 변경 30분 | 일치 | 일치 | 낮음 | 직접 재확인함 |
| C10 | 테스트 환경 없음 | 일치 | 일치 | 중간 | 직접 재확인함 |
| C04 | IP 최대 10개 | 일치 | 일치 | 낮음 | 직접 재확인함 |
| C01 | WING 판매자정보/추가판매정보 | 일치 | 일치 | 낮음 | 직접 재확인함 |
| C11 | `https://api-gateway.coupang.com` | 일치(443) | 일치 | 낮음 | 직접 재확인함 |
| C12~C16 | signed-date 형식, 서명 문자열, HMAC-SHA256, 헤더 형식 | 일치(PHP 예제로 확인). 결과 소문자 hex | 일치 | 중간 | 직접 재확인함 |
| C17·C18·C22 | HMAC 헤더, 시간 동기화 검증, 인증 실패 대조 항목 | 일치. 시간 오차 허용치는 공식 미공개 | 일치 | 낮음 | 직접 재확인함 |
| C24·C25 | 상품 상세 `items[].vendorItemId`, 임시저장 null | 일치(임시저장 중 null, 승인 후 표시) | 일치 | 중간 | 요약 의존 |
| C26·C27 | 판매자배송 재고 경로·`amountInStock`·가격·판매상태 | 일치. 경로 파라미터 1개, 쿼리 없음, 응답 `sellerItemId`·`amountInStock`·`salePrice`·`onSale` | 일치 | 높음(호출량) | 직접 재확인함 |
| C28 | 발주서 경로 v5 | 일치 | 일치 | 낮음 | 직접 재확인함 |
| C31 | returnRequests 경로 v6 | 일치 | 일치 | 낮음 | 직접 재확인함 |
| C36 | exchangeRequests 경로 v4 | 일치 | 일치 | 낮음 | 직접 재확인함 |
| C38·C39 | RG 재고 경로, `data[].inventoryDetails.totalOrderableQuantity`, 분당 50회 | 일치. 필드 설명은 "주문 가능 수량 총합" | 일치 | 중간 | 직접 재확인함 |
| C41·C42 | RG 주문 경로, `paidDateFrom/To`, yyyymmdd, 30일, 50회/분 | 일치 | 일치 | 중간 | 직접 재확인함 |
| C48 | 한국어 페이지 일부 시간초과 | 2026-10-12에는 한국어 페이지 정상 열림 | 해소 | 낮음 | 직접 재확인함 |
| C49 | 근거 URL 목록 | 모두 신규 포털(developers.coupang.com) 경로로 열림 | 일치 | 낮음 | 직접 재확인함(10개 중 8개) |
| C05 | 고정 발신 IP 권장 | 공식은 동적 IP에 대해 언급 없음. 권장 유지가 타당 | 확인 불가 | 중간 | 확인 못 함 |
| C46·C47 | 재고 비합산, 배송 방식별 커넥터 분리 | StockD 설계 원칙(공식 사실 아님). 공식 필드 의미와 충돌 없음 | 해당 없음 | - | - |

## 4. 기존 조사에 없던 새 정보

| 항목 | 내용 | 신뢰도 |
| --- | --- | --- |
| 포털 v1 종료 | 구 포털(developers-v1.coupangcorp.com)은 **2026-10-31 종료**, 11-01부터 이용 불가. 신규 포털은 developers.coupang.com. 기존 문서 링크는 이미 신규 도메인이라 영향 작음. 구 포털 링크·스크린샷을 인용한 메모가 있으면 교체 | 직접 재확인함 |
| 호출 제한 공지 | 위 C19. 2023-10-12 공지는 상품 조회·수량/가격 변경 계열 API의 초당 제한 강화와 반복 위반 시 영구 차단 가능성을 안내 | 2023-07 공지·2026-03 공지 직접 재확인함, 2023-10 공지는 요약 의존 |
| 잘못된 vendorId 대량 호출 차단 | 잘못된 vendorId로 404가 대량 발생하면 IP·vendorId를 사전 통지 없이 차단할 수 있음(2024-03 공지) | 요약 의존 |
| 키 운영 세부 | 만료 14일 전부터 재발급 버튼 활성화, 재발급 시 Secret Key 새로 생성, 그 전에는 삭제 후 재발급, 연동정보 수정 주 10회 제한 | 직접 재확인함 |
| 추가 헤더 | 테스트 가이드에 `X-Requested-By`(vendorId), `X-MARKET`(KR/TW) 언급 | 요약 의존 |
| 개인정보 필드 | 발주서: `orderer`(name, email은 빈 값, safeNumber, ordererNumber는 null), `receiver`(name, safeNumber, receiverNumber, addr1, addr2, postCode, consigneePrimaryAddress), `parcelPrintMessage`(배송메시지), 해외배송 통관 정보. 반품: `requesterName`, `requesterPhoneNumber`(안심번호), `requesterRealPhoneNumber`, `requesterAddress/Detail/ZipCode`. 교환: `exchangeAddressDtoV1`, `collectInformationsDto`의 고객 이름·전화·주소 | 발주서·반품 직접 재확인함, 교환 필드명 직접 확인 |
| 배송지 변경 | 결제완료 상태에서 고객이 배송지를 바꿀 수 있어 상품준비중 처리 뒤 단건 조회로 receiver 재확인 권고(StockD는 배송지를 저장하지 않으므로 영향 없음) | 직접 재확인함 |
| 발주 가능 수량 | `shippingCount - (holdCountForCancel + cancelCount)` | 직접 재확인함 |
| RG 주문 단건 | 3장 참조 | 직접 재확인함 |
| 반품 철회 이력 | `GET .../api/v4/vendors/{vendorId}/returnWithdrawRequests`(최대 7일), receiptId 기준 조회(POST) | 메뉴 존재 직접 확인, 사양은 요약 의존 |
| 배송상태 이력 | `GET .../v5/vendors/{vendorId}/ordersheets/{shipmentBoxId}/history`(건당) | 메뉴 존재 직접 확인, 사양은 요약 의존 |
| 상품 시간 구간 조회 | `GET .../seller-products/time-frame`(생성 시각 기준 최대 10분) | 메뉴 존재 직접 확인, 사양은 요약 의존 |
| RG 상품 옵션 ID | 상품 목록에 `businessTypes=rocketGrowth`를 주면 `rocketGrowthItemData.vendorItemId` 포함 | 요약 의존 |
| API 연동 계약 | 금지 사항에 API 데이터 복제·저장·제3자 제공, 주문관리 목적 외 DB 구축, 호출 한도 우회 등이 있다는 요약. 셀러툴 사업자용 계약으로 보이나 자체개발 셀러 적용 여부 불명 | 요약 의존(원문 미확인, **StockD 저장 방침과 관련되어 원문 확인 필요**) |
| 이메일 제거 | 2024-08-06부터 주문자 이메일 빈 값, 2026-03-15부터 고객문의 API에서 buyerEmail 제거 | 요약 의존(발주서 email 빈 값은 직접 확인) |

## 5. StockD 설계·문서에 미치는 영향

### ① 호출 제한과 수집 주기·재시도

- **판단 근거(확인)**: 전체 API에 vendorId 단위 초당 제한, 기본 5회. RG 재고·RG 주문은 별도로 분당 50회.
- **설계 제안(추측 포함)**: 판매자배송·RG 커넥터가 같은 vendorId를 쓰므로 **vendorId 하나에 공유 토큰 버킷 1개**(목표 초당 3~4회, 최대 5회 미만)를 두고, RG 두 API에는 분당 45회 정도의 하위 버킷을 추가한다. SD 7장 "인증/계정/공유 API 제한 그룹별 예산"에 쿠팡 값을 명시하면 된다.
- 429 처리: 공식 해제 시간이 "수 분~수십 분"이므로 SD의 지수 지연(최대 5회)만으로는 짧다. 429가 오면 **해당 vendorId 전체 수집을 일시 정지**(예: 5분 후 1건 탐색 호출)하고 재고·주문 작업을 동시에 멈춘다. 반복 위반은 영구 차단 위험이 있으므로 같은 버킷 안에서 즉시 재시도하지 않는다.
- 일부 API가 초당 10회였다가 5회로 줄었다는 공지가 있어, 한도는 계정·시점마다 다를 수 있다. 공개값을 상수로 고정하지 말고 설정값 + 429 관측 기반 자동 감속으로 둔다.

### ② 발주서 개인정보와 "개인정보 기본 미저장" 방침

SD 10장은 "첫 버전에 불필요한 주소·전화번호·수취인명은 저장하지 않는다"이다. 발주서·반품·교환 응답에는 이 필드가 **항상 포함**되므로, 제거 위치를 명확히 해야 한다.

| 위치 | 방법 |
| --- | --- |
| 커넥터 응답 파싱 직후(메모리) | **허용 필드 목록(projection) 방식**으로 필요한 필드만 Zod 스키마로 꺼낸다. 제거 목록 방식은 신규 필드가 추가되면(예: 2026-07 수입신고 정보) 새어 나가므로 쓰지 않는다 |
| 제거 대상 | 발주서 `orderer.*`, `receiver.*`, `parcelPrintMessage`, 해외배송·통관 정보, `invoiceNumber`(첫 버전 불필요 시). 반품 `requester*` 전체, `returnDeliveryDtos[].deliveryInvoiceNo`. 교환 `exchangeAddressDtoV1*`, `collectInformationsDto.*` 의 고객 이름·전화·주소 |
| 남길 필드 예 | 발주서 `shipmentBoxId`, `orderId`, `orderedAt`, `paidAt`, `status`, `orderItems[].{vendorItemId, sellerProductId, shippingCount, cancelCount, holdCountForCancel, salesPrice, orderPrice}`. 반품 `receiptId`, `orderId`, `receiptType`, `receiptStatus`, `createdAt`, `modifiedAt`, `returnItems[].{vendorItemId, purchaseCount, cancelCount, shipmentBoxId, releaseStatus}` |
| `RawPayload` | 원본 그대로 저장 금지. projection 결과 또는 개인정보 필드를 제거한 사본 + 원문 해시만 저장, 7일 만료 유지 |
| 로그·오류 | 응답 본문을 오류 로그에 덤프하지 않는다. 파싱 실패 시 필드 경로·타입만 기록 |
| fixture | 공식 예시에도 실제 형태의 주소(공공 주소)·이름이 있으므로 그대로 복사하지 않고 합성값으로 대체 |

연동 계약 요약에 "API 데이터 저장" 금지 문구가 있다는 점은 원문 확인이 필요하다(7장). 확인 전까지는 "주문관리 목적의 최소 저장"으로 범위를 좁혀 기록한다.

### ③ 변경분 조회가 없어 폴링·재대조 필요

- 발주서는 **생성일 구간 + status 1개 필수**다. 한 주문이 상태를 옮기면 이전 status 조회에서 사라지므로, 신규 수집은 6개 status를 각각 호출해야 한다(직접 재확인함).
- 기존 미완료 주문은 단건 조회(`ordersheets/{shipmentBoxId}`, `{orderId}/ordersheets`) 또는 원래 생성일 구간을 status별로 다시 조회해 대조한다. SD 6장 "쿠팡 판매자배송" 전략과 일치하므로 방향은 유지하고, "status별 6회 × 구간"이라는 호출 비용만 반영하면 된다.
- 반품은 `modifiedAt`이 응답에 있지만 필터는 없다. 접수일 31일 구간을 주기적으로 재조회하고 receiptId를 자체 보관한다. 철회 건은 목록에서 사라질 수 있어 철회 이력 API로 보완(요약 의존).
- 교환은 접수일 7일 한도라 7일보다 오래된 교환 건은 목록으로 다시 볼 수 없다. 미종결 교환 건의 추적 한계를 화면에 표시해야 한다(단건 교환 조회 API는 목록에 없음).
- RG 주문은 결제일 구간 조회뿐이고 상태 필드가 없다. 늦게 나타나는 주문 대비 과거 결제일 구간 재조회는 유지하되, "출고 이후에만"이라는 이유는 확정하지 말고 "조회 시점에 따라 늦게 나타날 수 있음(공식 문구 모호)"으로 표현한다.

### ④ RG 클레임 조회 API 부재

- RG 메뉴(8개)에 클레임 조회가 없고 RG 주문 응답에도 상태·클레임이 없다(직접 재확인함). 일반 returnRequests·exchangeRequests가 RG 주문을 포함하는지는 공식 문서에 없다.
- SD의 `unverified` 처리를 유지한다. 실계정에서 RG 반품 1건을 WING과 대조해 returnRequests에 나오면 `supported`, 나오지 않으면 `unsupported`로 바꾼다. 그 전에는 RG 주문을 "취소/반품 없음"으로 집계하지 않는다.

### ⑤ 재고 조회가 옵션 1건씩: 호출량 계산

판매자배송 재고는 `vendorItemId` 1개당 1회 호출이다(일괄 조회 없음, 직접 재확인함). 아래는 버킷 목표 초당 4회, 다른 작업이 예산의 절반을 쓴다고 가정해 재고에 **초당 2회**를 배정한 추정이다.

| 판매자배송 옵션 수 | 1회 순회 호출 수 | 소요(초당 2회) | 15분 주기 가능 여부 |
| --- | --- | --- | --- |
| 200 | 200 | 약 1.7분 | 가능 |
| 1,000 | 1,000 | 약 8.3분 | 가능(여유 적음) |
| 2,000 | 2,000 | 약 16.7분 | **불가** → 30분 주기 또는 변동 옵션 우선 |
| 5,000 | 5,000 | 약 42분 | 불가 → 주문 발생 옵션 우선 + 전체 순회 1~2시간 |

- RG 재고는 전체 목록 모드(nextToken)를 써야 한다. 단일 옵션 모드로 1,000개를 조회하면 분당 50회 한도로 20분이 걸린다. 목록 페이지 크기는 미공개라 실측 필요.
- 주문: 3분 주기에 발주서 6 status × 1구간 = 최소 6회 + 페이지 수, 반품·교환 2~3회. 초당 4회 예산의 일부만 쓰므로 여유가 있다. 다만 대조 작업(31일 × 6 status)은 하루 1회로 분산한다.
- 상품 상세는 상품 1건당 1회라 초기 연결 시 상품 수만큼 호출된다(예: 상품 1,000개 → 초당 2회 기준 약 8분).

## 6. 문서 수정 제안 목록(제안만, 이번에 수정하지 않음)

| # | 파일·위치 | 무엇을 | 어떻게 |
| --- | --- | --- | --- |
| 1 | `03-api-readiness.md` 3장 체크리스트 "일반 API별 실제 호출 제한 확인"(57행 부근) | 호출 제한 | "공식 공지: vendorId 단위 초당 5회 기준이 전체 API에 적용(2023-07, 2026-03 조정). 계정 실측으로 확인" 행 추가, 근거 공지 링크 2개 |
| 2 | `03-api-readiness.md` 4장 RG 재고 체크 항목(73행) | A3 모순 | "2026-10-12 현행 문서는 `vendorItemId`로 통일, 실호출로 최종 확인"으로 교체 |
| 3 | `03-api-readiness.md` 3장 "취소 유형의 orderId/status 조합"(59행) | A4 | 3장 대조표의 규칙 ①~⑤ 요약으로 교체, 남은 확인은 "CANCEL+status 생략 시 orderId 요구 여부" 1건으로 축소 |
| 4 | `03-api-readiness.md` 3장 발주서 행(50행) | 필수 파라미터 | "`createdAtFrom/To`·`status` 필수(상태별 개별 호출), `yyyy-mm-dd+09:00`, 분 단위 모드 24시간" 추가 |
| 5 | `03-api-readiness.md` 4장 가시성 행(69행), `08-coupang-api.md` 23·38행, `09-coupang-api-manual.md` 99·115행, `01-system-design.md` 93·331행 | "출고 이후에만 조회" | "공식 문구가 '[출고일] 이후 주문 지원'으로 모호, 늦게 나타날 수 있음을 전제로 재조회"로 완화 |
| 6 | `03-api-readiness.md` 4장, `09-coupang-api-manual.md` 6절 | RG 단건 조회 | `rg/order/{orderId}` 경로 추가(대조·재확인용), 목록과 `paidAt` 형식·가격 필드명 차이 표시 |
| 7 | `08-coupang-api.md` 9행, `09-coupang-api-manual.md` 23행 | vendorId 출처 | "키와 함께 발급되지 않음. WING 로그인 후 확인하는 판매자 코드(A로 시작)"로 명확화 |
| 8 | `08-coupang-api.md` 11행, `09-coupang-api-manual.md` 28행 | 키 재발급 | "만료 14일 전부터 재발급 버튼, 재발급 시 Secret Key 교체, 연동정보 수정 주 10회" 추가 |
| 9 | `09-coupang-api-manual.md` 2절 세부사항(45행 부근) | 서명 구현 주의 | "결과 소문자 hex, 공식 Python 샘플의 SSL 검증 해제 복사 금지, 샘플 경로 v4는 구버전" 추가 |
| 10 | `09-coupang-api-manual.md` 2절 확인 기준(38행) | 응답 envelope | "`code`가 API마다 문자열(SUCCESS) 또는 숫자(200)" 주의 추가 |
| 11 | `09-coupang-api-manual.md` 75행, 101행, 151행 | 호출 제한 조치 | "429 시 vendorId 전체 수집 정지, 해제까지 수 분~수십 분" 추가 |
| 12 | `01-system-design.md` 10장 개인정보(401~402행) | 필드 제거 방법 | "커넥터 파싱 직후 허용 필드 projection, 쿠팡 발주서·반품·교환의 개인정보 필드 목록" 추가 |
| 13 | `01-system-design.md` 7장 호출 제한(355행 부근) | 쿠팡 예산 | "쿠팡: vendorId 공유 버킷 초당 5회 미만, RG 2개 API 분당 50회 추가" 명시 |
| 14 | `01-system-design.md` 6장 수집 주기 표(315~319행) | 재고 호출량 | "쿠팡 판매자배송 재고는 옵션당 1회, 옵션 2,000개 이상이면 15분 주기 불가" 주석 |
| 15 | `09-coupang-api-manual.md` 155행 | 재대조 범위 | "2026-10-12 재대조: 발주서·반품·교환·판매자배송 재고·HMAC·키 발급·RG 재고·RG 주문(본 문서 참조)"로 갱신 |
| 16 | `03-api-readiness.md` 5행 | 출처 한계 | 한국어 페이지 시간초과 문구 → "2026-10-12 한국어 원문 확인" |

## 7. 아직 확인 못 한 것과 확인 방법

| 항목 | 확인 방법 | 실계정 필요 |
| --- | --- | --- |
| IP 미등록·미일치 시 거부 여부와 오류 응답 | 등록 IP 외에서 1회 호출(운영 차단 위험이 있으므로 개발 IP로만) 또는 쿠팡 온라인 문의 | 예 |
| 서명 시간 오차 허용치 | 쿠팡 문의 또는 실호출 오류 관찰(의도적 반복 시험은 하지 않음) | 예 |
| 실제 적용 호출 한도(초당 5회 vs 10회, API별) | 저속 호출로 시작해 429 발생 여부만 관찰, 쿠팡 문의 | 예 |
| RG 주문 "[출고일] 이후" 의미 | WING에서 결제됐지만 미출고인 RG 주문이 API에 나오는지 대조 | 예 |
| returnRequests CANCEL 조회에서 orderId 요구 여부, 일 단위 `searchType` 값 | 계정에서 `cancelType=CANCEL`, status·orderId 없이 1회 호출 | 예 |
| returnRequests·exchangeRequests가 RG 클레임을 포함하는지 | RG 반품 1건을 WING과 대조 | 예 |
| RG 재고 단일 조회 `vendorItemId` 실동작 | 실호출 1건 | 예 |
| 발주서 `createdAt` 의미(주문일/결제일) | 응답의 `orderedAt`·`paidAt`과 조회 구간 비교 | 예 |
| RG 재고 목록·발주서 분 단위의 페이지 크기 | 실호출 응답 건수 관찰 | 예 |
| `maximumBuyCount`와 `amountInStock`의 관계 | 같은 옵션 비교 | 예 |
| 공통 오류 코드(서명·IP·권한) 목록 | FAQ 답변 본문 열람(로그인 불필요로 보임), 사전 연동 가이드 PDF | 아니오 |
| API 연동 계약의 자체개발 셀러 적용 여부와 "데이터 저장" 금지 범위 | 계약 공지 원문 직접 열람, 필요 시 쿠팡 문의·법무 검토 | 아니오 |
| 2023-10 속도제한 강화 공지, 잘못된 vendorId 차단 공지의 정확한 문구 | 공지 원문 직접 열람 | 아니오 |
| RG 조회에 별도 동의가 필요한지, 동의 반영 시간 | WING 추가판매정보 화면 확인 | 예 |
| 반품 철회 이력·배송상태 이력·상품 시간 구간 조회 사양 | 각 공식 페이지 원문 직접 열람 | 아니오 |

## 8. 쓰기 API(범위 밖)와 허용 목록 후보

### 쓰기 API: 존재만 기록(StockD 첫 버전에서 호출 금지)

- 상품: 생성, 수정(승인필요/승인불필요), 삭제, 승인 요청, 아이템별 수량 변경·가격 변경·판매 재개·판매 중지·할인율 기준가 변경, 자동생성옵션 활성/비활성 4종
- 배송/주문: 상품준비중 처리, 송장 업로드·업데이트, 이미출고 처리, 장기미배송 배송완료 처리, 주문 상품 취소, 출고중지완료 처리
- 반품: 반품상품 입고 확인, 반품요청 승인, 회수 송장 등록
- 교환: 입고 확인, 교환요청 거부, 교환상품 송장 업로드
- RG: 상품 생성, 상품 수정

주의: 반품철회 이력의 receiptId 조회는 **POST이지만 조회용**이다(요약 의존). 메서드만으로 읽기/쓰기를 가르지 말고 경로 단위 허용 목록을 쓴다.

### 읽기 전용 허용 목록 후보

모두 호스트 `https://api-gateway.coupang.com`, 메서드 GET(별도 표시 제외).

| 용도 | 경로 | 우선순위 | 사양 신뢰도 |
| --- | --- | --- | --- |
| 상품 목록 | `/v2/providers/seller_api/apis/api/v1/marketplace/seller-products` | 필수 | 요약 의존 |
| 상품 상세(옵션 ID) | `/v2/providers/seller_api/apis/api/v1/marketplace/seller-products/{sellerProductId}` | 필수 | 요약 의존 |
| 판매자배송 재고 | `/v2/providers/seller_api/apis/api/v1/marketplace/vendor-items/{vendorItemId}/inventories` | 필수 | 직접 재확인함 |
| 발주서 목록(일/분) | `/v2/providers/openapi/apis/api/v5/vendors/{vendorId}/ordersheets` | 필수 | 직접 재확인함 |
| 발주서 단건(shipmentBoxId) | `/v2/providers/openapi/apis/api/v5/vendors/{vendorId}/ordersheets/{shipmentBoxId}` | 권장(재대조) | 요약 의존 |
| 발주서 단건(orderId) | `/v2/providers/openapi/apis/api/v5/vendors/{vendorId}/{orderId}/ordersheets` | 권장(재대조) | 요약 의존 |
| 반품·취소 목록 | `/v2/providers/openapi/apis/api/v6/vendors/{vendorId}/returnRequests` | 필수 | 직접 재확인함 |
| 반품 단건 | `/v2/providers/openapi/apis/api/v6/vendors/{vendorId}/returnRequests/{receiptId}` | 권장 | 요약 의존 |
| 교환 목록 | `/v2/providers/openapi/apis/api/v4/vendors/{vendorId}/exchangeRequests` | 필수 | 직접 재확인함 |
| RG 재고 | `/v2/providers/rg_open_api/apis/api/v1/vendors/{vendorId}/rg/inventory/summaries` | 필수(RG) | 직접 재확인함 |
| RG 주문 목록 | `/v2/providers/rg_open_api/apis/api/v1/vendors/{vendorId}/rg/orders` | 필수(RG) | 직접 재확인함 |
| RG 주문 단건 | `/v2/providers/rg_open_api/apis/api/v1/vendors/{vendorId}/rg/order/{orderId}` | 권장(RG 대조) | 직접 재확인함 |
| 반품 철회 이력(기간) | `/v2/providers/openapi/apis/api/v4/vendors/{vendorId}/returnWithdrawRequests` | 선택 | 요약 의존 |
| 배송상태 이력 | `/v2/providers/openapi/apis/api/v5/vendors/{vendorId}/ordersheets/{shipmentBoxId}/history` | 선택 | 요약 의존 |
| 상품 상태 이력 | `/v2/providers/seller_api/apis/api/v1/marketplace/seller-products/{sellerProductId}/histories` | 선택 | 요약 의존 |
| 상품 시간 구간 | `/v2/providers/seller_api/apis/api/v1/marketplace/seller-products/time-frame` | 선택 | 요약 의존 |

구현 제안: HTTP 클라이언트는 위 경로 패턴과 메서드 조합만 통과시키고, 그 외(특히 PUT·PATCH·DELETE, 송장·승인·수량 변경 경로)는 요청 전에 차단해 오류로 기록한다. "요약 의존" 경로는 구현 직전에 원문을 다시 확인한다.
