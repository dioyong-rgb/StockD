## 연결 전 확인

공식 문서 확인: **2026-10-04** · **실제 계정 검증 대기**

현재 StockD에 API 키를 등록하거나 실제로 연결하지 않았습니다. 판매자배송과 로켓그로스는 재고와 주문 조회 방식을 구분합니다. 첫 연결은 조회에 한정하며 재고 수정·발송·주문 상태 변경은 포함하지 않습니다.

## 1. 준비하기

사업자 인증을 마친 WING 판매자 계정에서 API 키 메뉴를 찾습니다. 계정에 따라 판매자정보 또는 추가판매정보에 있습니다. OPEN API 이용 약관에 동의하고 자체 개발 항목을 선택한 뒤 업체·서비스 URL·호출 IP를 입력합니다. **vendorId, Access Key, Secret Key**를 확인합니다. 등록 IP는 최대 10개이며, StockD 운영에는 고정 발신 IP를 권장합니다. [신청·발급 안내](https://developers.coupang.com/ko/getting-started/issue-open-api-keynew)

신규 발급 후 권한 활성화에는 24시간 이상, 변경·재발급 반영에는 최대 30분이 걸릴 수 있습니다. 키 유효기간은 180일입니다. 별도 테스트 환경이 없어 실제 계정에서 조회 검증이 필요합니다. [권한 반영·키 관리](https://developers.coupang.com/ko/getting-started/issue-open-api-keynew)

## 2. 인증하기

키는 서버 비밀값으로 보관합니다. 서버가 UTC 시간·요청 방식·경로·쿼리를 Secret Key로 서명하고 **HMAC Authorization 헤더**를 붙여 호출합니다. 등록한 IP에서 인증과 조회가 성공하는지 확인해야 합니다. 키와 인증 헤더는 브라우저·문서·로그에 남기지 않습니다. [HMAC 인증](https://developers.coupang.com/ko/getting-started/creating-hmac-signature)

## 3. 조회하기

판매자 ID로 상품 목록을 조회해 `sellerProductId`를 얻고, 상품 상세의 `vendorItemId`로 옵션을 연결합니다. 임시저장 상품은 이 옵션 ID가 없을 수 있으므로 승인 상태를 확인합니다. [상품 목록 조회](https://developers.coupang.com/ko/api/products/product-list-paging-query) · [상품 상세 조회](https://developers.coupang.com/ko/api/products/querying-product)

**판매자배송 재고**는 옵션 ID인 `vendorItemId`로 조회하고 `amountInStock`을 읽습니다. **로켓그로스 재고**는 `totalOrderableQuantity`를 주문 가능한 수량으로 읽습니다. 로켓그로스 주문의 `salesQuantity`는 판매 수량입니다. 이 값들을 실제 창고 보유량 하나로 합치지 않습니다. [판매자배송 재고](https://developers.coupang.com/ko/api/products/query-quantitypricestatus-by-product-items) · [로켓그로스 재고](https://developers.coupang.com/ko/api/rocket-growth/rg-inventory-api)

판매자배송 주문은 기간·상태별 발주서를 수집하고 기존 주문의 상태도 다시 확인합니다. 로켓그로스 주문은 **출고일 이후에만 조회**됩니다. 현재 문서의 응답에는 주문 상태·변경 시각·클레임 필드가 명시되지 않아, 이를 신규 결제 알림이나 전체 주문 상태 추적에 바로 사용하지 않습니다. [판매자배송 주문](https://developers.coupang.com/ko/api/shipments/po-list-query-paging-by-day) · [로켓그로스 주문](https://developers.coupang.com/ko/api/rocket-growth/rg-order-apilist-query)

판매자배송 주문 조회만으로 반품 완료 주문을 확인할 수 없습니다. **반품·취소 조회와 교환 조회를 따로 수집**합니다. 이 API들이 로켓그로스 클레임까지 제공하는지는 문서만으로 확인하지 못했습니다. 계정 검증 전에는 로켓그로스 취소·반품·교환 지원을 미확인으로 표시합니다. [반품·취소 조회](https://developers.coupang.com/ko/api/returns/return-cancellation-request-list-query) · [교환 조회](https://developers.coupang.com/ko/api/exchanges/query-a-list-of-exchange-requests)

## 4. 연결 검증하기

키 활성 상태·등록 IP·판매자배송 및 로켓그로스 권한을 확인합니다. 대표 옵션의 수량과 주문·클레임을 WING과 대조하고, 모든 페이지를 수집했는지 확인해야 합니다. 현재는 모두 검증 대기이며 **미연결**입니다. 조회 실패·데이터 미제공·재고 0은 각각 구분합니다.

<details>
<summary>개발 참고</summary>
	- 상품 식별: `GET /v2/providers/seller_api/apis/api/v1/marketplace/seller-products?vendorId=...`의 목록을 `nextToken`으로 수집하고, `GET .../seller-products/{sellerProductId}`의 `data.items[].vendorItemId`를 보존합니다. 임시저장의 null ID를 정상 재고 0으로 바꾸지 않습니다. [상품 상세·옵션 ID](https://developers.coupang.com/ko/api/products/querying-product)
	- 요청 기본 주소는 `https://api-gateway.coupang.com`입니다. 아래 경로를 이 주소 뒤에 붙입니다. [HMAC 예제의 API 호스트](https://developers.coupang.com/ko/getting-started/creating-hmac-signature)
	- 판매자배송 재고: `GET /v2/providers/seller_api/apis/api/v1/marketplace/vendor-items/{vendorItemId}/inventories`. 옵션 연결 기준은 `vendorItemId`, 수량은 `amountInStock`입니다. [재고 사양](https://developers.coupang.com/ko/api/products/query-quantitypricestatus-by-product-items)
	- 판매자배송 주문: `GET /v2/providers/openapi/apis/api/v5/vendors/{vendorId}/ordersheets`. 일 단위 조회는 최대 31일, 페이지당 최대 50개이며 `nextToken`으로 이어서 조회합니다. 기간·상태 조회이므로 기존 주문의 상태 변경을 주기적으로 다시 확인해야 합니다. [발주서 사양](https://developers.coupang.com/ko/api/shipments/po-list-query-paging-by-day)
	- 로켓그로스 재고: `GET /v2/providers/rg_open_api/apis/api/v1/vendors/{vendorId}/rg/inventory/summaries`. 전체 목록은 `nextToken`으로 수집하며 **분당 50회**입니다. 문서 설명의 `vendorIdItemId`와 Query 표의 `vendorItemId`가 서로 달라 실제 파라미터 확인이 필요합니다. [재고 사양·문서 불일치](https://developers.coupang.com/ko/api/rocket-growth/rg-inventory-api)
	- 로켓그로스 주문: `GET /v2/providers/rg_open_api/apis/api/v1/vendors/{vendorId}/rg/orders`. 결제일 조회 범위는 최대 30일, `nextToken`이 없어질 때까지 수집하며 **분당 50회**입니다. 출고 이후 조회와 `salesQuantity` 의미를 유지합니다. 로켓그로스 주문은 출고 후 늦게 등장할 수 있으므로 과거 결제일 구간을 반복 조회하고 정기 대조합니다. 이 두 API의 한도를 쿠팡 전체 API의 공통 한도로 적용하지 않습니다. [주문 사양](https://developers.coupang.com/ko/api/rocket-growth/rg-order-apilist-query)
	- 반품·취소: `GET /v2/providers/openapi/apis/api/v6/vendors/{vendorId}/returnRequests`. 일 단위 조회는 최대 31일이며 `nextToken`을 사용합니다. 결제 완료 단계 취소는 `cancelType=CANCEL`로 조회하고 `status`·`orderId`를 제외하라는 안내가 있습니다. 다만 `orderId` 설명에 필수 조건이 별도로 있어 조회 조합을 계정에서 확인해야 합니다. [조회 조건·문서 확인 사항](https://developers.coupang.com/ko/api/returns/return-cancellation-request-list-query)
	- 교환: `GET /v2/providers/openapi/apis/api/v4/vendors/{vendorId}/exchangeRequests`. 조회 범위는 최대 7일이며 `nextToken`을 이어서 조회합니다. [교환 사양](https://developers.coupang.com/ko/api/exchanges/query-a-list-of-exchange-requests)
</details>
