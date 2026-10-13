## 함께 쓰는 개발 환경

기준 문서 검토일: 2026-10-03. 현재는 문서만 준비되어 있습니다. 앱·수집기·환경 설정 구현, 실제 API·DB 연결, GitHub 업로드, OS별 설치·실행은 아직 검증 전입니다. 패키지 조합의 최신 호환성을 확정한 문서가 아니며 구현 단계에서 버전을 검토합니다.

기존 TypeScript·Next.js 15·React 19를 유지합니다. Tailwind CSS와 shadcn/ui로 반응형 화면을 만들고, Zustand로 화면의 필터·선택을 관리합니다. 설정 폼은 React Hook Form과 Zod, DB는 PostgreSQL과 Prisma를 사용합니다.

한국어 문서·주석, 2칸 들여쓰기, 영어 변수·함수명, any 타입 금지 기준도 유지합니다.

## 다른 컴퓨터에서 이어서 개발하기

Windows 11·macOS·Linux에서 Git과 지정한 Node.js·pnpm을 설치하고 같은 소스를 내려받는 흐름을 준비합니다. PostgreSQL은 Docker Compose로 실행해 DB 설치 차이를 줄입니다. 각 PC의 OS·CPU에 맞는 도구를 설치해야 하며 Apple Silicon은 ARM64 지원도 확인합니다.

Node와 pnpm 버전, 의존성 잠금 파일을 함께 관리합니다. 다른 PC에서는 그 기준으로 새로 설치하고 DB 구조와 샘플을 초기화한 뒤 앱·수집기를 실행합니다. 기존 설치 폴더를 복사하는 방식은 쓰지 않습니다. 같은 코드로 개발할 수 있는지 각 환경에서 검증한 범위만 지원 완료로 표시합니다.

## GitHub로 공유할 것

소스, 버전 설정, 잠금 파일, Compose 설정, DB 구조 변경 기록, 개인정보 없는 샘플, 설치 안내를 공유합니다. 환경변수 예시에는 이름과 안전한 설명용 값만 넣습니다. 실제 API 키·토큰·환경파일, 고객 주문 원본, DB 데이터·백업, node_modules와 빌드 결과는 제외합니다.

GitHub는 개발 도구나 API 권한을 자동 설치·승계하지 않습니다. DB 데이터도 자동 공유하지 않으므로 샘플로 시작하고 실제 키·고정 발신 IP는 별도로 설정합니다.

<details>
<summary>개발할 때 확인할 항목</summary>

	- packageManager와 Node 버전을 고정하고 pnpm-lock.yaml 기준의 frozen install을 사용합니다.
	- PostgreSQL 이미지 버전과 데이터 볼륨 경로를 맞추고 named volume으로 PC별 데이터를 보관합니다.
	- 경로·파일명 대소문자·LF 줄바꿈·환경 설정의 셸 차이를 점검합니다. 공통 준비 작업은 Node 도구로 만듭니다.
	- GitHub Actions의 Windows·macOS·Ubuntu에서 설치·타입·린트·빌드·샘플을 검증합니다. DB 서비스 컨테이너 통합 검증은 별도 Ubuntu 작업으로 진행합니다.

</details>
