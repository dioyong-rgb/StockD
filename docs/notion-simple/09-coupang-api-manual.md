**내부 문서번호:** STOCKD-CP-API-001 · **개정:** 00 · **작성일:** 2026-10-04
**적용 대상:** 쿠팡 판매자배송·로켓그로스 조회 연동
**현재 상태:** 절차 문서 작성 · 실제 계정 연결 및 검증 미수행
**원문:** <mention-page url="https://app.notion.com/p/3ef15a85fa8681b5b3c5d88dfccacbc9">쿠팡 API 연결</mention-page>
## 작업 개요
계정 준비 → 인증 → 상품 식별 → 재고 조회 → 주문 조회 → 클레임 조회 → 대조 및 완료 판정 순서로 수행하라. 적용되는 작업을 번호 순서대로 진행하라. 확인 기준을 충족하지 못한 기능은 미연결 또는 미확인으로 기록하라.
본 절차는 조회 작업에 한정한다. 재고 수정·발송 처리·주문 상태 변경 API를 호출하지 말라. 이 문서의 체크 항목은 작업 기록용이며, 작성 또는 체크만으로 실제 연결 완료가 되지 않는다.
<callout icon="🔒" color="red_bg">
	**경고 — 자격증명 노출 금지**
	Access Key, Secret Key 및 Authorization 헤더를 브라우저·문서·샘플·로그에 기록하지 말라. 노출을 발견하면 해당 키 사용을 중단하고 계정 담당자를 통해 키 교체를 수행하라.
</callout>
<callout icon="⚠️" color="yellow_bg">
	**주의 — 데이터 오판정 금지**
	조회 실패·누락·미제공 값을 재고 0으로 변환하지 말라. 채널 등록 재고와 로켓그로스 주문가능 재고를 실제 창고 보유량으로 합산하지 말라.
</callout>
## 1. 계정 및 API 키 준비
**사전 조건:** 사업자 인증을 완료한 WING 판매자 계정을 확보하라.
1. WING의 판매자정보 또는 추가판매정보에서 API Key 발급 메뉴를 확인하라.
2. OPEN API 약관에 동의하라.
3. 자체개발 항목을 선택하라.
4. 업체명과 서비스 URL을 입력하라.
5. 실제 요청 서버의 발신 IP를 등록하라. 등록 개수는 최대 10개로 제한하라.
6. 해당 계정의 vendorId를 확인하라.
7. Access Key와 Secret Key를 서버 비밀 저장소에 등록하라.
8. 키 만료일을 작업 기록에 기입하라. 키 값은 기입하지 말라.
**확인 기준:** vendorId·키 활성 상태·등록 IP를 확인하고, 판매자배송 및 RG 조회 권한을 계정별로 확인하라.
**불일치 시 조치:** 사업자 인증·키·IP·권한 중 미확인 조건이 있으면 해당 조회 작업을 중단하라. 조건을 보완한 후 재개하라.
**참고:** 최초 접근 권한 활성화는 24시간 이상 걸릴 수 있다. 변경·재발급 반영은 최대 30분이 걸릴 수 있다. 키 유효기간은 180일이며 별도 테스트 환경은 제공되지 않는다. StockD 운영의 고정 발신 IP는 운영 권장 사항이다.
**근거:** [쿠팡 OpenAPI 키 발급 안내](https://developers.coupang.com/ko/getting-started/issue-open-api-keynew)
## 2. 서버 인증 요청 구성
**사전 조건:** 작업 1의 키·계정·IP 조건을 충족하라. 유효한 조회 요청 경로를 준비하라.
1. 서버의 현재 UTC 시각으로 signed-date를 생성하라.
2. 조회 요청의 메서드·경로·쿼리를 확정하라.
3. signed-date·메서드·경로·쿼리를 순서대로 결합하라.
4. Secret Key로 HMAC-SHA256 서명을 생성하라.
5. 생성한 서명을 Authorization 헤더에 설정하라.
6. 등록한 발신 IP에서 조회 요청을 전송하라.
**확인 기준:** HTTP 상태와 API 응답의 결과 코드·메시지를 확인하라. 요청한 조회의 성공 여부를 확인한 후 응답 데이터를 사용하라.
**불일치 시 조치:** 인증이 실패하면 서버 UTC 시각·서명 대상·실제 전송 쿼리·vendorId·키 활성 상태·등록 IP를 대조하라. 원인을 조치하기 전 반복 호출하지 말라. 기존 성공 데이터는 유지하라.
<details>
<summary>인증 구성 세부사항</summary>
	- 기본 주소: `https://api-gateway.coupang.com`
	- signed-date 형식: `yyMMddTHHmmssZ` · UTC 사용
	- 서명 대상: `signed-date + method + path + query`
	- path에 호스트를 포함하지 말라. query에 선행 `?`를 포함하지 말라. 서명에 사용한 쿼리와 실제 전송 쿼리의 표현을 일치시켜라.
	- 헤더 구성: `CEA algorithm=HmacSHA256, access-key={Access Key}, signed-date={signed-date}, signature={signature}`
	- 위 중괄호는 치환 위치를 나타낸다. 실제 키·헤더는 문서에 붙여 넣지 말라.
</details>
**근거:** [쿠팡 HMAC 인증 및 요청 예제](https://developers.coupang.com/ko/getting-started/creating-hmac-signature)
## 3. 상품 및 옵션 식별자 확보
**사전 조건:** 인증 요청 구성이 완료된 서버와 해당 vendorId를 사용하라.
1. 해당 vendorId의 상품 목록을 조회하라.
2. 응답에 nextToken이 있으면 다음 페이지를 조회하라. 토큰이 더 이상 없을 때까지 반복하라.
3. 목록의 sellerProductId로 상품 상세를 조회하라.
4. 상세의 data.items[].vendorItemId를 옵션 식별자로 보존하라.
5. vendorId·배송 방식·옵션 ID를 내부 SKU 연결 후보와 함께 기록하라.
**확인 기준:** 원본 옵션 ID가 실제 판매 옵션과 대응하는지 확인하라. 내부 SKU 연결은 운영자가 후보를 확인한 후 확정하라.
**불일치 시 조치:** 임시저장 상품의 vendorItemId가 null이면 승인 상태를 확인하라. 미확인 옵션은 연결 대기로 남겨 두라. null ID를 재고 0으로 처리하지 말라.
<details>
<summary>상품 조회 경로</summary>
	- 목록: `GET /v2/providers/seller_api/apis/api/v1/marketplace/seller-products?vendorId={vendorId}`
	- 상세: `GET /v2/providers/seller_api/apis/api/v1/marketplace/seller-products/{sellerProductId}`
</details>
**근거:** [상품 목록 페이징 조회](https://developers.coupang.com/ko/api/products/product-list-paging-query) · [상품 상세 및 옵션 ID](https://developers.coupang.com/ko/api/products/querying-product)
## 4. 배송 방식별 재고 조회
**사전 조건:** 해당 기능의 권한과 옵션 식별자를 확인하라. 판매자배송과 RG 조회 대상을 구분하라.
1. 판매자배송 옵션의 재고를 조회하라.
2. amountInStock을 채널 등록 재고로 기록하라.
3. RG 재고 목록을 조회하라.
4. nextToken이 반환되면 다음 RG 페이지를 조회하라. 토큰이 더 이상 없을 때까지 반복하라.
5. totalOrderableQuantity를 RG 주문가능 재고로 기록하라.
6. 수량과 마지막 성공 시각·최근 시도 시각을 함께 기록하라.
**확인 기준:** 정상 응답의 수량 0은 품절로 구분하라. 실패·미지원·미확인은 별도 상태로 구분하라. 성공 후 실패한 경우에는 이전 성공 수량과 시각을 유지하라.
**불일치 시 조치:** 실패한 조회 범위를 성공으로 확정하지 말라. 첫 실패에는 확인된 수량이 없음을 표시하라. 원인을 조치한 후 해당 범위를 다시 조회하라.
**주의:** RG 재고 API 호출은 분당 50회 이하로 제한하라. 이 제한을 쿠팡 전체 API의 공통 한도로 사용하지 말라.
<details>
<summary>재고 조회 경로 및 문서 확인 사항</summary>
	- 판매자배송: `GET /v2/providers/seller_api/apis/api/v1/marketplace/vendor-items/{vendorItemId}/inventories`
	- RG: `GET /v2/providers/rg_open_api/apis/api/v1/vendors/{vendorId}/rg/inventory/summaries`
	- RG 값 위치: `data[].inventoryDetails.totalOrderableQuantity`
	- RG 문서 설명은 `vendorIdItemId`, Query 표는 `vendorItemId`를 사용한다. 단일 옵션 조회에 사용할 파라미터는 실제 계정 호출 계약으로 확인하라. 임의로 확정하지 말라.
</details>
**근거:** [판매자배송 재고 조회](https://developers.coupang.com/ko/api/products/query-quantitypricestatus-by-product-items) · [RG 재고·한도·파라미터](https://developers.coupang.com/ko/api/rocket-growth/rg-inventory-api)
## 5. 판매자배송 주문 조회
**사전 조건:** 조회할 기간과 원본 주문 상태를 정하라.
1. 일 단위 조회 구간을 최대 31일 범위로 분할하라.
2. 기간·상태별 발주서를 페이지당 최대 50개로 조회하라.
3. nextToken이 반환되면 다음 페이지를 조회하라. 토큰이 더 이상 없을 때까지 반복하라.
4. 주문 행별 식별자·옵션·수량·원본 상태를 보존하라.
5. 기존 주문을 다시 조회하여 과거 주문의 상태 변경을 확인하라.
**확인 기준:** 요청한 기간·상태의 모든 페이지를 확인하라. 신규 주문과 기존 주문 변경을 구분하라.
**불일치 시 조치:** 페이지 또는 주문 행이 누락되면 해당 범위를 미완료로 기록하라. 기존 성공 데이터를 유지하고 누락 범위를 재조회하라.
<details>
<summary>판매자배송 주문 조회 경로</summary>
	- `GET /v2/providers/openapi/apis/api/v5/vendors/{vendorId}/ordersheets`
</details>
**근거:** [발주서 목록 조회 및 페이지 규칙](https://developers.coupang.com/ko/api/shipments/po-list-query-paging-by-day)
## 6. 로켓그로스 주문 조회
**사전 조건:** RG 권한을 확인하라. 조회 범위가 출고 이후 주문이라는 제한을 확인하라.
1. 결제일 기준 조회 구간을 최대 30일 범위로 분할하라.
2. RG 주문 API를 분당 50회 이하로 호출하라.
3. nextToken이 반환되면 다음 페이지를 조회하라. 토큰이 더 이상 없을 때까지 반복하라.
4. salesQuantity를 주문 행 판매수량으로 기록하라.
5. 출고 후 늦게 나타나는 주문을 확인하도록 과거 결제일 구간을 반복 조회하라.
6. 반복 조회 결과를 정기 대조하라.
**확인 기준:** 판매수량을 재고로 사용하지 말라. 결제 직후 모든 주문이 조회됐다고 판정하지 말라.
**불일치 시 조치:** 응답에 명시되지 않은 주문 상태·변경 시각·클레임을 추정하지 말라. 해당 기능은 지원 미확인으로 기록하라.
**참고:** 과거 구간 반복 조회와 정기 대조는 출고 이후 가시성에 대응하는 StockD 수집 설계다. 실제 범위와 주기는 검증 결과에 따라 정하라.
<details>
<summary>RG 주문 조회 경로</summary>
	- `GET /v2/providers/rg_open_api/apis/api/v1/vendors/{vendorId}/rg/orders`
	- 결제일 파라미터: `paidDateFrom`, `paidDateTo` · 날짜 형식 `yyyymmdd`
	- 호출 한도는 RG 주문 API 기준이다. 일반 판매자배송 API에 그대로 적용하지 말라.
</details>
**근거:** [RG 주문 조회·출고 이후 가시성·호출 한도](https://developers.coupang.com/ko/api/rocket-growth/rg-order-apilist-query)
## 7. 판매자배송 취소·반품·교환 조회
**사전 조건:** 판매자배송 발주서만으로 반품 완료 주문 전체를 확인할 수 없음을 확인하라.
1. 반품·취소 API를 별도로 조회하라. 일 단위 구간은 최대 31일로 분할하라.
2. 교환 API를 별도로 조회하라. 조회 구간은 최대 7일로 분할하라.
3. 각 API의 nextToken을 처리하라. 모든 페이지를 조회하라.
4. 클레임 유형·원본 상태·대상 주문 행·부분 수량을 구분하여 기록하라.
5. 기존 클레임을 다시 조회하여 완료·철회 등의 변경을 확인하라.
**확인 기준:** 주문 상태와 클레임 상태를 각각 보존하라. 목록에 나타났다는 이유로 처리 완료를 판정하지 말라.
**불일치 시 조치:** RG 클레임 지원을 계정 검증 전 확정하지 말라. 미확인으로 기록하라. 조회 조건이 불명확하면 해당 조건을 해결한 후 검증하라.
<details>
<summary>클레임 조회 경로 및 조건 확인</summary>
	- 반품·취소: `GET /v2/providers/openapi/apis/api/v6/vendors/{vendorId}/returnRequests`
	- 교환: `GET /v2/providers/openapi/apis/api/v4/vendors/{vendorId}/exchangeRequests`
	- 결제 완료 단계 취소는 `cancelType=CANCEL`로 조회하고 `status`·`orderId`를 제외하라는 안내가 있다. `orderId` 설명에는 별도 필수 조건도 있다. 조회 조합을 계정에서 확인하라.
</details>
**근거:** [반품·취소 조회 및 조건](https://developers.coupang.com/ko/api/returns/return-cancellation-request-list-query) · [교환 조회](https://developers.coupang.com/ko/api/exchanges/query-a-list-of-exchange-requests)
## 8. 기능 시험 및 완료 판정
**사전 조건:** 적용 기능의 앞선 조회 작업을 완료하라. WING 대조용 상품·주문·클레임을 선정하라.
1. 같은 옵션·배송 방식·기준시각의 수량을 WING과 대조하라.
2. 같은 기간의 주문 행·수량·지원되는 클레임을 WING과 대조하라.
3. 모든 페이지가 처리됐는지 확인하라.
4. 실패·누락·미제공·재고 0이 구분되는지 확인하라.
5. 작업자·작업일·대조 범위·불일치·조치 결과를 기록하라. 키와 주문 개인정보는 기록에 포함하지 말라.
6. 검증한 기능에 한해 실제 연동 완료를 판정하라.
**합격 기준:** 해당 기능의 인증·조회·전체 페이지·WING 대조가 확인되고, 수량 의미와 오류 표시가 일치해야 한다.
**불합격 시 조치:** 불합격 기능은 미연결 또는 검증 대기로 유지하라. 원인을 조치한 후 해당 시험을 반복하라. 미확인 기능을 합격 범위에 포함하지 말라.
### 작업 완료 기록
실제 작업 증거가 확보된 항목만 표시하라. 현재 모든 항목은 미수행이다.
- [ ] 계정·키 활성 상태·조회 권한·등록 IP를 확인했다.
- [ ] 서버 인증과 상품·옵션 식별을 확인했다.
- [ ] 적용 기능의 전체 페이지와 수량 의미를 확인했다.
- [ ] WING 대조와 오류·재고 0 구분을 확인했다.
- [ ] 완료 기능과 미확인 기능의 범위를 기록했다.
## 이상 발생 시 공통 조치
- 인증·권한·IP 문제: 해당 조회를 중단하라. 원인을 확인한 후 재개하라.
- 호출 제한 초과: 즉시 반복 요청을 중단하라. 해당 API 제한에 맞게 호출 빈도를 조정한 후 재개하라.
- 일부 페이지 실패: 완료 범위를 확대하지 말라. 마지막 성공값을 보존하고 미완료 범위를 재조회하라.
- 수량·상태·식별자 불일치: 해당 데이터를 성공값으로 덮어쓰지 말라. 원본 구조와 WING 결과를 대조하라.
## 근거 및 기록 관리
원문은 위의 쿠팡 API 연결 페이지다. 공식 근거는 각 작업의 링크를 사용하라. 키 발급·HMAC·RG 재고·RG 주문 사양은 2026-10-04 공식 문서와 다시 대조했다. 나머지 조회 경로와 한도는 원문 기준이며 실제 작업 전 각 링크의 최신 계약을 확인하라.
현재 계정 키 등록·실제 API 호출·WING 대조는 수행하지 않았다. 문서의 절차와 실제 작업 완료를 구분하여 기록하라.
---
<mention-page url="https://app.notion.com/p/3ef15a85fa868146a556d41c8fe337fc">쇼핑몰별 API 연결 방법</mention-page>
