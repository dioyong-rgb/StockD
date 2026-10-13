# API 신청·연동 준비 체크리스트

공개 문서 확인일: 2026-10-03, Asia/Seoul. **문서 확인과 실제 계정 연동 검증은 다르다. 현재 계정 로그인·API 신청·키 발급·실제 판매자 API 호출은 수행하지 않았다.**

공식 공개 문서만 조사했다. 쿠팡 일부 한국어 페이지는 본문 열기 시간초과가 있어 같은 공식 도메인의 검색 결과와 영문 문서로 보완했다. 계정별 승인·권한·샘플 응답은 아직 미확인이다.

## 1. 공통 준비

- [ ] 채널별 판매자 ID·계정 수·배송 방식·연결 담당자 목록 확인.
- [ ] 상품/옵션 수·일 주문량과 초기 수집 기간 확인.
- [ ] 상품·옵션·재고·주문·클레임 **조회용** API 범위 정리. 외부 쓰기 권한은 요청 범위에서 제외.
- [ ] 고정 발신 IP 수집 서버 준비. 로컬 IP와 운영 서버의 외부 IP를 구분.
- [ ] 서버 비밀 저장소·키 교체·접근 권한·마스킹된 상태 표시 준비.
- [ ] 연결별 마지막 성공 호출, 마지막 인증 실패, 만료/갱신 정보 관리.
- [ ] 판매자센터 대조용 정상 재고·0·재고 관리 미사용·신규/변경 주문·클레임 샘플 선정.
- [ ] 조회 시간대·시간 필드·최대 기간·페이지 처리·호출 제한 확인.
- [ ] 운영 전 대조·복구 시험 일정과 미지원 기능 기록.

키·Secret·토큰을 이 문서, 채팅, fixture, 커밋에 기록하지 않는다. 이후 코드에는 빈 값만 있는 `.env.example`을 제공하고 실제 값은 서버에 별도로 등록한다.

## 2. 스마트스토어

### 공개 문서에서 확인한 사항

| 항목 | 확인 내용 | 공식 근거 |
| --- | --- | --- |
| 인증 | OAuth2 Client Credentials/Bearer. 토큰 발급 서명은 bcrypt 후 Base64 방식 | [인증](https://apicenter.commerce.naver.com/docs/auth) |
| 상품·재고 | 원상품·옵션 재고 및 재고 관리 사용 여부 조회 | [원상품 조회](https://apicenter.commerce.naver.com/docs/commerce-api/current/read-origin-product-product) |
| 표준형 옵션 | `useStockManagement`가 false/생략일 때 수량 9,999 설명. 숫자만으로 미사용 판정하지 않고 플래그/옵션 유형을 보존 | [원상품 구조체](https://apicenter.commerce.naver.com/docs/commerce-api/current/schemas/%EC%9B%90%EC%83%81%ED%92%88-%EC%A0%95%EB%B3%B4-%EA%B5%AC%EC%A1%B0%EC%B2%B4) |
| 변경 주문 | 변경시각 기준 조회, 최대 300건/요청 limit. `moreFrom`과 `moreSequence`로 다음 구간 조회 | [변경 상품주문 조회](https://apicenter.commerce.naver.com/docs/commerce-api/current/seller-get-last-changed-status-pay-order-seller) |
| 클레임 | 변경 이벤트에 취소·반품·교환 요청/완료/철회 구분이 포함. 내부 클레임 모델로 분리하며 별도 endpoint를 반드시 요구하지 않음 | [변경 상품주문 구조체](https://apicenter.commerce.naver.com/docs/commerce-api/current/schemas/%EB%B3%80%EA%B2%BD-%EC%83%81%ED%92%88-%EC%A3%BC%EB%AC%B8-%EC%A0%95%EB%B3%B4-%EA%B5%AC%EC%A1%B0%EC%B2%B4) |
| 호출 제한 | API/인증 애플리케이션 단위 제한. 429 및 RateLimit/Quota 헤더로 동적 관리 | [제약 사항](https://apicenter.commerce.naver.com/docs/restriction) |

### 준비 및 계정 확인

- [ ] 판매자 계정과 애플리케이션 등록, Client ID/Secret 확보.
- [ ] 상품·주문·클레임 상세 조회에 필요한 API 그룹 권한 확인.
- [ ] 토큰 발급·갱신과 서버의 실제 권한 오류 응답 확인.
- [ ] 상품 주문 ID 목록→상세 조회의 연결, 동시각 변경 및 전체 페이지 검증.
- [ ] 단일 상품·옵션 유형별 재고 관리 플래그/기본값을 실제 응답과 대조.
- [ ] 초기 주문 이력 조회 범위와 정기 대조 방식 확정.

## 3. 쿠팡 판매자배송

| 항목 | 확인 내용 | 공식 근거 |
| --- | --- | --- |
| 인증 | HMAC Authorization | [HMAC 한국어](https://developers.coupang.com/ko/getting-started/creating-hmac-signature), [HMAC 영문](https://developers.coupang.com/en/getting-started/creating-hmac-signature) |
| 키/IP | 자체개발 URL·IP 등록, 키 유효기간 180일 안내, 별도 테스트 환경 없음 | [키 발급](https://developers.coupang.com/ko/getting-started/issue-open-api-keynew) |
| 옵션 재고 | `vendorItemId`별 `amountInStock`, 가격, 판매 상태 조회 | [수량·가격·상태](https://developers.coupang.com/ko/api/products/query-quantitypricestatus-by-product-items) |
| 발주서 | 일단위 조회, 최대 31일, 상태 필터, 최대 50건/페이지, `nextToken`. 생성일 조회를 변경시각 증분 조회로 취급하지 않음 | [발주서 한국어](https://developers.coupang.com/ko/api/shipments/po-list-query-paging-by-day), [발주서 영문](https://developers.coupang.com/en/api/shipments/po-list-query-paging-by-day) |
| 취소·반품 | 별도 접수 목록. 조회 방식·유형별 쿼리와 페이지 지원이 다름 | [취소·반품 목록](https://developers.coupang.com/ko/api/returns/return-cancellation-request-list-query) |
| 교환 | 별도 목록, 접수일 기준 최대 7일, `nextToken` 및 수정시각 필드 | [교환 목록](https://developers.coupang.com/ko/api/exchanges/query-a-list-of-exchange-requests) |

- [ ] Wing 판매자 계정·vendorId·Access Key·Secret Key 확보.
- [ ] 실제 고정 발신 IP·연동 URL·조회 권한 확인.
- [ ] 서명 대상 경로·query·UTC 시간 형식과 시간 동기화 검증.
- [ ] 옵션 수에 따른 재고 요청 수·일반 API별 실제 호출 제한 확인. RG의 50회/분을 일반 API에 적용하지 않음.
- [ ] 상태별 신규 주문 조회와 기존 미완료 주문 재대조를 함께 설계.
- [ ] 취소 유형의 `orderId/status` 조합, 일단위/분단위 페이지 규칙을 계정에서 확인.
- [ ] 키 만료 정보와 교체 후 인증·복구 시험 계획 작성.

## 4. 쿠팡 로켓그로스

| 항목 | 확인 내용 | 공식 근거 |
| --- | --- | --- |
| 재고 의미 | `totalOrderableQuantity`는 주문가능 수량. 전체 창고 보유 재고가 아님 | [로켓창고 재고](https://developers.coupang.com/ko/api/rocket-growth/rg-inventory-api) |
| 재고 제한 | 분당 50회, 전체 목록 `nextToken`; 단일 옵션 조회 방식 별도 | [로켓창고 재고](https://developers.coupang.com/ko/api/rocket-growth/rg-inventory-api) |
| 주문 의미 | `salesQuantity`는 판매수량, `paidAt`·주문 행·금액/통화 제공 | [주문 목록](https://developers.coupang.com/ko/api/rocket-growth/rg-order-apilist-query) |
| 가시성·페이지 | 출고일 이후 주문 지원, 결제일 조회 구간 최대 30일, 분당 50회, `nextToken` | [주문 목록](https://developers.coupang.com/ko/api/rocket-growth/rg-order-apilist-query) |
| 상태/클레임 | 현재 목록 응답에서 주문 상태·변경시각·취소/반품/교환 필드를 확인하지 못함. 해당 기능의 지원 완료를 주장하지 않음 | [주문 응답](https://developers.coupang.com/ko/api/rocket-growth/rg-order-apilist-query) |

- [ ] 계정의 로켓그로스 사용·조회 권한 확인.
- [ ] 재고 API 설명의 `vendorIdItemId`와 Query 표의 `vendorItemId` 표기 차이를 실제 요청 계약으로 확인.
- [ ] 재고·주문별 호출 제한 및 공통 계정 제한 존재 여부 확인.
- [ ] 원본 ID·시간·금액 형식, 단일 옵션과 목록 응답, 페이지 끝 검증.
- [ ] 출고 이후 가시성과 지연 반영을 판매자센터와 대조.
- [ ] 주문 상태 변경·클레임을 조회할 추가 공식 API/가이드가 있는지 계정에서 확인. 없으면 `unsupported`, 확인 전은 `unverified`.
- [ ] 결제일 범위 반복 조회와 정기 대조로 늦게 등장하는 주문 누락 방지.

## 5. G마켓·옥션 — 조기 신청 권장

### 신청 준비

- [ ] G마켓·옥션 판매자 회원 및 ESM+ 마스터 ID 확인.
- [ ] 필요한 조회 API, 서비스/판매상품 URL, 최근 3개월 매출, 개발 기간 자료 준비.
- [ ] 공식 안내에 따라 신청하고 승인·거절·추가 자료 요청 상태 기록.
- [ ] API별 조회 권한, 마스터 ID·사이트 판매자 ID·Secret Key 확인.
- [ ] 고정 발신 IP 등록 및 변경 절차 확인.
- [ ] 개발 테스트와 운영 전환 일정 협의.

신청 승인은 자동 보장되지 않는다. 이번 작업은 신청 체크리스트 작성이며 외부 신청 제출은 하지 않았다. [공식 신청·인증 가이드](https://etapi.gmarket.com/pages/API-%EA%B0%80%EC%9D%B4%EB%93%9C)

### 공개 문서에서 확인한 사항

| 항목 | 확인 내용 | 공식 근거 |
| --- | --- | --- |
| 인증·통제 | JWT HS256/Bearer, 마스터 ID, 허용 서버 IP, API별 권한 검사 | [가이드](https://etapi.gmarket.com/pages/API-%EA%B0%80%EC%9D%B4%EB%93%9C) |
| 상품 식별 | 2.0 마스터 `goodsNo`와 사이트별 상품번호를 함께 관리. 주문/클레임의 사이트 상품번호와 연결 | [상품 조회](https://etapi.gmarket.com/20) |
| 상품 목록 | `pageIndex/pageSize/totalItems`, 사이트별 `stock`, 분당 최대 20회 | [상품 목록](https://etapi.gmarket.com/160) |
| 옵션 | GET 조회, `isStockManage`, 사이트별 qty, `manageCode`, `optSeq` 등. 품절 상태와 수량을 별도 보존 | [옵션 조회/관리](https://etapi.gmarket.com/26) |
| 일반 주문 | 결제완료 주문. 취소·반품·교환·미수령을 모두 포함하지 않음. 조회기간 31일 이내, 5초당 1회 제한(주문번호 조회 예외) | [주문 조회](https://etapi.gmarket.com/67) |
| 클레임 | 취소·반품·교환 별도 조회. 취소는 7일 이내 구간, 요청/완료/철회 등 상태 보존 | [취소](https://etapi.gmarket.com/50), [반품](https://etapi.gmarket.com/53), [교환](https://etapi.gmarket.com/59) |

### 계정 검증 과제

- [ ] `manageCode`가 비어 있거나 중복되는 옵션의 안정적인 식별 방법 확인. 관리코드만으로 unique 키를 만들지 않음.
- [ ] 옵션 원본 `optSeq`·옵션 유형·조합과 주문 옵션 ID를 대조.
- [ ] 요청/응답 사이트 코드를 별도로 검증. 취소 문서의 G마켓 코드 설명 차이를 그대로 공유 enum으로 적용하지 않음.
- [ ] 일반 주문의 날짜 기준과 과거 주문 상태 재대조 방법 확인.
- [ ] 상품/주문 외 API별 제한·기간·페이지 규칙, 공유 마스터 계정의 제한 범위 확인.
- [ ] 미수령을 첫 버전 클레임 범위에 추가할 필요가 있는지 운영 요구 확인. 현재 확정 범위는 취소·반품·교환.

옵션 문서에 쓰기 메서드가 함께 있어도 첫 버전은 GET 조회만 사용한다.

## 6. 11번가

| 항목 | 확인 내용 | 공식 근거 |
| --- | --- | --- |
| 상품·재고 | 공개 소개에서 상품·재고정보 조회 제공 | [상품 API 소개](https://openapi.11st.co.kr/openapi/OpenApiServiceIntroduce.tmall?introduceType=PRODUCT) |
| 주문 | 공개 소개에서 주문 목록·내역 조회 제공 | [주문 API 소개](https://openapi.11st.co.kr/openapi/OpenApiServiceIntroduce.tmall?introduceType=ORDER) |
| 클레임 | 취소·교환·반품 요청 목록 조회 제공 | [클레임 API 소개](https://openapi.11st.co.kr/openapi/OpenApiServiceIntroduce.tmall?introduceType=CLAIM) |
| 키 유효기간 | Seller API 키 180일. 호출 이력이 있으면 마지막 호출일부터 180일 자동 연장 | [공개 FAQ](https://openapi.11st.co.kr/openapi/OpenApiFaqBoard.tmall?method=getFaqBoardList&unityBrdNo=55) |
| 갱신/재발급 | 만료 60일 전 갱신 가능, 만료 후 재발급 필요. 재발급 시 기존 키 즉시 폐기 | [공개 FAQ](https://openapi.11st.co.kr/openapi/OpenApiFaqBoard.tmall?method=getFaqBoardList&unityBrdNo=55) |

조회 기능의 존재는 공개 확인했지만 옵션 필드·클레임 상세 상태·시간/페이지 계약과 현재 호출 제한은 로그인 후 Seller 개발가이드 및 실제 계정으로 확인해야 한다.

- [ ] 판매자 회원 승인 완료 후 Seller API 서비스 가입·키 발급 확인.
- [ ] 로그인 개발가이드 확보, 계정의 상품·주문·클레임 권한 확인.
- [ ] 옵션별 재고 필드/관리 여부·ID·시간대·기간·페이지 처리 확인.
- [ ] 인증 헤더·발신 IP 요건·실제 호출 제한 확인.
- [ ] XML 사용 여부와 안전한 원본 파싱·검증 계약 확정.
- [ ] 키 관리 화면의 만료일을 우선 사용하고 `lastSuccessfulApiCallAt`, `credentialExpiresAt`, `renewalAvailableAt`를 대조해 표시.
- [ ] 재발급 후 서버 비밀값 교체·중단 복구 검증. 로컬 계산만으로 연장 성공을 확정하지 않음.

비로그인 [공개 개발가이드](https://openapi.11st.co.kr/openapi/OpenApiGuide.tmall)의 상품검색용 요청 방식을 Seller API에 그대로 적용하지 않는다.

## 7. 채널별 검증 기록 양식

실제 연동을 시작하면 아래 표를 계정별로 복제해 기록한다. 현재는 모두 미확인/미수행이다.

| 항목 | 현재 상태 | 검증할 증거 |
| --- | --- | --- |
| 판매자 계정·배송 방식 | 미확인 | 마스킹된 계정 식별과 사용 범위 |
| API 신청·권한 | 미확인 | 승인된 조회 API 범위 |
| 키·만료·IP | 미확인 | 비밀값 없이 인증 성공·만료·등록 상태 |
| 상품·옵션 식별 | 미수행 | 원본 ID와 내부 옵션·SKU 연결 |
| 재고 의미·0/미사용 | 미수행 | 동일 기준시각 판매자센터 대조 |
| 신규·기존 주문 변경 | 미수행 | 시간 기준·상태 변화·행 수량 대조 |
| 클레임/기능 미지원 | 미수행 | 요청·완료·철회·부분 수량, capability 근거 |
| 전체 페이지·중복·지연 | 미수행 | 페이지 수·총 건수·재수집/정기 대조 결과 |
| 장애·복구·호출 제한 | 미수행 | 429/권한/IP/시간초과 대응·성공값 보존 |

각 증거에는 확인일·담당·조회 구간·마스킹된 실행 ID를 남긴다. 공식 문서 변경과 계정별 차이는 커넥터 계약/fixture/준비 문서를 함께 갱신한다.
