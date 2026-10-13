## 연결 전 확인

공식 문서 확인: **2026-10-04** · **실제 계정 검증 대기**

현재 StockD에 API 키를 등록하거나 실제로 연결하지 않았습니다. 첫 연결은 상품·재고·주문 조회에 한정합니다. 쇼핑몰 재고 수정과 주문 처리 기능은 포함하지 않습니다.

## 1. 준비하기

내 스토어를 관리할 계정으로 **커머스API센터에서 애플리케이션 등록과 활성 상태를 확인**합니다. 상품과 주문 등 사용할 API 그룹에 권한이 있어야 합니다. 등록 화면의 세부 메뉴와 계정별 사용 가능 여부는 로그인 후 확인해야 합니다. [API센터](https://apicenter.commerce.naver.com/ko) · [API 그룹 권한](https://apicenter.commerce.naver.com/docs/restriction)

애플리케이션에는 **API를 호출할 서버의 IPv4 주소를 등록**해야 합니다. 네이버는 2024-09-11부터 신규 등록·수정 시 이 입력을 필수로 안내합니다. 주소 입력 후 추가·저장합니다. StockD 운영에는 등록 주소가 바뀌지 않도록 **고정 발신 IPv4 사용을 권장**합니다. 고정 IP는 운영 설계 제안입니다. [호출 IP 등록 안내](https://help.sell.smartstore.naver.com/faq/content.help?faqId=15538)

## 2. 인증하기

앱 ID와 시크릿을 서버 비밀값으로 보관합니다. 서버가 앱 ID·시간·시크릿으로 **bcrypt·Base64 서명**을 만든 뒤 OAuth2 Client Credentials 방식으로 토큰을 발급받습니다. 조회 요청에는 Bearer 토큰을 넣습니다. 시크릿과 토큰은 브라우저·문서·로그에 남기지 않습니다. [인증 절차](https://apicenter.commerce.naver.com/docs/auth)

## 3. 조회하기

먼저 상품 목록에서 `originProductNo`를 얻고, 그 번호로 상품 상세와 옵션 정보를 조회합니다. 목록 조회도 HTTP POST를 쓰는 읽기 기능입니다. [상품 목록 조회](https://apicenter.commerce.naver.com/docs/commerce-api/current/search-product) · [상품 상세 조회](https://apicenter.commerce.naver.com/docs/commerce-api/current/read-origin-product-product)

상품은 원상품 번호로 조회하고, 옵션이 있으면 **옵션별 ID와 수량**을 연결합니다. `stockQuantity`는 상품·옵션의 판매 재고 값입니다. 표준형 옵션에서는 `useStockManagement`가 없거나 false일 때 문서상 수량이 9,999로 설정되므로, 관리 여부를 함께 저장하고 실제 보유 재고처럼 표시하지 않습니다. 수량 9,999만으로 관리 여부를 판단하지 않습니다. [상품 조회](https://apicenter.commerce.naver.com/docs/commerce-api/current/read-origin-product-product) · [재고 필드 정의](https://apicenter.commerce.naver.com/docs/commerce-api/current/schemas/%EC%9B%90%EC%83%81%ED%92%88-%EC%A0%95%EB%B3%B4-%EA%B5%AC%EC%A1%B0%EC%B2%B4)

주문은 **변경된 상품주문 ID를 모은 뒤 상세 정보를 조회**합니다. 변경 목록에는 신규 결제와 기존 주문의 상태 변경이 함께 있으므로, 목록 건수를 신규 주문 수로 계산하지 않습니다. 상세 조회는 읽기 기능이지만 HTTP POST를 사용합니다. [변경 목록](https://apicenter.commerce.naver.com/docs/commerce-api/current/seller-get-last-changed-status-pay-order-seller) · [주문 상세 조회](https://apicenter.commerce.naver.com/docs/commerce-api/current/seller-get-product-orders-pay-order-seller)

취소·반품·교환은 주문 상태와 클레임 유형·상태를 함께 읽어 구분합니다. 주문 목록에 나타났다는 사실만으로 클레임 처리가 끝났다고 판단하지 않습니다. [변경·클레임 필드](https://apicenter.commerce.naver.com/docs/commerce-api/current/schemas/%EB%B3%80%EA%B2%BD-%EC%83%81%ED%92%88-%EC%A3%BC%EB%AC%B8-%EC%A0%95%EB%B3%B4-%EA%B5%AC%EC%A1%B0%EC%B2%B4)

## 4. 연결 검증하기

계정의 앱 활성 상태·API 그룹 권한·호출 IP를 확인하고, 토큰 발급과 상품·주문 조회가 성공하는지 검사합니다. 대표 상품의 옵션·수량과 주문·클레임을 스마트스토어 화면과 대조해야 합니다. 현재 이 검증은 모두 대기 중이며, 검증 전에는 **미연결**로 표시합니다. 외부 API 오류와 재고 0은 서로 다른 상태로 표시합니다.

<details>
<summary>개발 참고</summary>
	- 상품 목록: `POST /v1/products/search` → 응답의 `contents[].originProductNo` → 원상품 상세 순서입니다. [상품 목록 사양](https://apicenter.commerce.naver.com/docs/commerce-api/current/search-product)
	- 요청 기본 주소는 `https://api.commerce.naver.com/external`입니다. 아래 경로를 이 주소 뒤에 붙입니다. [인증 문서의 Token URL](https://apicenter.commerce.naver.com/docs/auth)
	- 인증: `POST /v1/oauth2/token`. `client_secret_sign`은 `client_id + "_" + timestamp`를 비밀번호, `client_secret`을 salt로 bcrypt 해시한 뒤 Base64로 인코딩합니다. 서버가 생성하고 보관합니다. [인증 사양](https://apicenter.commerce.naver.com/docs/auth)
	- 상품: `GET /v2/products/origin-products/{originProductNo}`. 옵션 ID·`sellerManagerCode`·`stockQuantity`·`useStockManagement`의 실제 응답을 확인합니다. [상품 사양](https://apicenter.commerce.naver.com/docs/commerce-api/current/read-origin-product-product)
	- 변경 주문: `GET /v1/pay-order/seller/product-orders/last-changed-statuses`. 최대 300개이며 다음 페이지에는 `more.moreFrom`을 `lastChangedFrom`, `more.moreSequence`를 `moreSequence`로 전달합니다. `more`가 없어질 때까지 수집합니다. [페이지 수집 규칙](https://apicenter.commerce.naver.com/docs/commerce-api/current/seller-get-last-changed-status-pay-order-seller)
	- 주문 상세: `POST /v1/pay-order/seller/product-orders/query`. 상품주문 ID는 한 번에 최대 300개입니다. 동일 ID의 변경을 갱신하며 중복 수집을 허용해야 합니다. [상세 조회 사양](https://apicenter.commerce.naver.com/docs/commerce-api/current/seller-get-product-orders-pay-order-seller)
	- 호출 제한: API·인증 앱별 한도가 적용됩니다. 고정 횟수를 가정하지 않고 응답의 `GNCP-GW-RateLimit-*`·`GNCP-GW-Quota-*`와 429 오류를 처리합니다. TLS 1.2 이상을 사용합니다. [제약 사항](https://apicenter.commerce.naver.com/docs/restriction)
</details>
