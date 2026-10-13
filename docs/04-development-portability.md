# Windows·macOS·Linux 개발 환경 및 GitHub 배포 검토

검토일: 2026-10-03. 상태: 공식 지원 문서와 현재 프로젝트 설계 기준 검토. **다른 OS에서 실제 앱 설치·빌드·DB 연결을 검증한 상태는 아니다.**

## 1. 결론

현재의 TypeScript, Next.js 15, React 19, Tailwind CSS, shadcn/ui, Zustand, React Hook Form, Zod, PostgreSQL, Prisma 구성을 Windows 11·macOS·Linux에서 유지할 수 있다. Next.js 15가 세 운영체제를 공식 지원하고 PostgreSQL도 각 OS용 설치 방법을 제공한다. [Next.js 15 설치](https://nextjs.org/docs/15/app/getting-started/installation), [PostgreSQL 다운로드](https://www.postgresql.org/download/)

GitHub에 코드와 환경 재현 설정을 함께 올리면 다른 OS에서도 내려받아 개발할 수 있다. 다만 GitHub는 Node.js·DB·API 키를 자동 설치하거나 같은 데이터를 배포하지 않는다. 도구 설치, 환경변수 설정, 해당 OS용 의존성 설치, DB 초기화가 필요하다.

`AGENTS.md`의 Windows 11은 현재 작업 환경이다. 기존 설계에 Windows 전용 프레임워크나 서비스를 필수로 사용하는 부분은 없다. 다중 OS 지원은 아래 기준으로 구현하고 실제 실행 결과를 확인해야 한다.

현재 저장소에는 문서만 있으며 `.git`, `package.json`, 잠금 파일, Compose 설정, GitHub Actions가 없다. 이번 검토에서 GitHub 저장소 생성·업로드나 개발 환경 설치를 수행하지 않았다.

## 2. 기술별 판단

| 구성 | 세 OS에서 같은 기술 사용 | 구현 시 조건 |
| --- | --- | --- |
| TypeScript·React 19 | 가능 | 같은 버전·설정, 파일명 대소문자 일치 |
| Next.js 15 | 공식 OS 지원 | Next 15 범위 유지, 각 OS에서 설치·빌드 |
| Tailwind·shadcn/ui | 가능 | React 19와 선택한 Tailwind 버전에 맞는 조합 고정 |
| Zustand·React Hook Form·Zod | 가능 | 패키지·TypeScript 버전과 strict 설정 고정 |
| PostgreSQL | 공식 OS별 설치 제공 | 동일 DB 버전·스키마·마이그레이션 적용 |
| Prisma | macOS·Windows·대부분 Linux 지원 | 메이저별 Node·시스템 라이브러리·생성 방식 확인 |
| TypeScript 수집 워커 | 가능하도록 구현 | Windows 작업 스케줄러·전용 셸 명령에 종속되지 않는 공통 진입점 |

shadcn은 React 19·Tailwind 4 지원을 안내하며 Tailwind는 Next.js 설치 가이드를 제공한다. 이는 OS별로 UI 스택을 바꿀 필요가 없다는 판단의 근거다. Zod의 현재 지원 기준은 TypeScript 5.5 이상과 strict 설정이다. 실제 패키지 조합은 S1에서 선택·고정한다. [shadcn React 19](https://ui.shadcn.com/docs/react-19), [Tailwind Next.js](https://tailwindcss.com/docs/installation/framework-guides/nextjs), [Zod 요구사항](https://zod.dev/)

## 3. 권장 공통 구성

기본 개발 방식은 **호스트의 Node.js로 웹·워커를 실행하고 PostgreSQL은 Docker Compose로 실행**하는 구성이다. 앱 변경 반영과 로컬 디버깅을 유지하면서 DB 설치 차이를 줄일 수 있다. Docker를 사용하기 어려우면 같은 버전의 로컬 PostgreSQL 또는 개발용 공용 DB를 사용할 수 있다.

| 항목 | 권장 기준 | 아직 확정할 사항 |
| --- | --- | --- |
| Node.js | 24 LTS를 공통 후보로 선택 | 앱·워커·Prisma 조합 확인 후 정확한 패치 버전 고정 |
| 패키지 관리자 | pnpm 단일 사용 | 정확한 pnpm 버전과 실행 도구 설정 |
| Next.js·React | 기존 Next.js 15·React 19 유지 | 지원되는 패치와 나머지 패키지 조합 |
| TypeScript | 선택한 Zod/Prisma 요구를 함께 만족 | 최소 5.5 이상 범위에서 정확한 버전 고정 |
| Prisma | PostgreSQL과 연결 | 메이저/생성기/드라이버 선택 후 요구사항 검증 |
| PostgreSQL | 지원되는 동일 정식 버전 | 컨테이너 태그·설정·해당 버전의 데이터 볼륨 경로 |
| 개발 데이터 | 비식별 fixture 및 seed | 실제 운영 DB·비밀값과 분리 |

Next.js 15의 최소 Node는 18.18이지만 전체 스택의 추천 버전으로 사용하지 않는다. 현재 Node 공식 표에서 24·22는 LTS이며 Prisma 7은 Node 24를 지원한다. 이 조건을 근거로 Node 24를 제안하며, 실제 StockD 전체 조합의 호환성을 검증한 것은 아니다. [Next 15 요구사항](https://nextjs.org/docs/15/app/getting-started/installation), [Node 릴리스](https://nodejs.org/en/about/previous-releases), [Prisma 시스템 요구](https://www.prisma.io/docs/orm/v7/reference/system-requirements)

Prisma 7 기본 TypeScript client와 이전 Rust 엔진 기반 Prisma의 설정은 다르다. OS별 `binaryTargets`를 무조건 추가하지 않는다. 레거시 엔진을 선택하면 배포 대상의 OS·CPU·OpenSSL·libc에 맞춰 설치·생성한다. Prisma 7에서도 CLI·선택한 드라이버·전체 도구의 시스템 요구 확인은 필요하다. [Prisma 생성기](https://www.prisma.io/docs/orm/v7/prisma-schema/overview/generators), [엔진별 차이](https://www.prisma.io/docs/orm/v6/more/internals/engines)

앱·워커까지 컨테이너로 실행하는 선택지도 있다. 이 경우 Linux 실행 환경을 공유할 수 있지만 개발 파일 감시·볼륨 성능·디버깅 설정과 x64/ARM64 차이는 별도로 검증한다. 완전히 같은 설치 바이너리를 모든 기기에 복사하는 방식은 사용하지 않는다.

## 4. OS·CPU별 범위

| 개발 환경 | 제안 구성 | 주의점 |
| --- | --- | --- |
| Windows 11 x64 | Git·Node·pnpm + Docker Desktop의 Linux 컨테이너 | Docker의 지원 조건 충족. WSL 2를 쓰면 도구와 작업 경로를 WSL 안에서 일관되게 사용 |
| macOS Intel | Git·Node·pnpm + 지원되는 Docker Desktop | macOS·CPU에 맞는 설치 파일 사용 |
| macOS Apple Silicon | ARM64 Node·pnpm + ARM64 대응 Docker 이미지 | `linux/amd64` 일괄 강제 대신 이미지의 ARM64 지원 확인 |
| Ubuntu/Debian 계열 Linux | Git·Node·pnpm + Docker Engine/Compose 또는 Desktop | 배포판·OpenSSL·libc·CPU 지원 확인 |

Docker Desktop은 OS별 설치/지원 조건을 갖는다. Linux에서는 Docker Engine과 Compose 플러그인으로 같은 Compose 구성을 실행할 수 있다. Compose 파일 공유는 도구가 이미 설치돼 있다는 전제다. [Docker Desktop](https://docs.docker.com/desktop/setup/install/), [Linux Compose 플러그인](https://docs.docker.com/compose/install/linux/)

Node 24 사전 빌드의 macOS 최소는 13.5지만 이것을 Docker까지 포함한 전체 스택의 최소 OS라고 쓰지 않는다. 모든 선택 도구가 지원하는 macOS 버전을 사용한다. Windows ARM64, 오래된 OS, 모든 Linux 배포판, Alpine/musl은 초기 검증 범위에 자동 포함하지 않는다. [Node 24 플랫폼 표](https://github.com/nodejs/node/blob/v24.x/BUILDING.md)

## 5. GitHub에 포함할 파일

아래는 후속 구현에서 생성할 파일이다. 현재 준비된 파일 목록이 아니다.

| 파일/디렉터리 | 역할 |
| --- | --- |
| `package.json` | 의존성·공통 실행 명령·Node 요구·정확한 packageManager 버전 |
| `pnpm-lock.yaml` | 의존성 해석 결과 고정, 설치 시 `--frozen-lockfile` 사용 |
| `.node-version` 등 선택한 도구의 버전 파일 | Node 기준 기록; 실제 설치는 도구/CI에서 별도 수행 |
| `tsconfig.json`, 린트·포맷 설정 | 동일 TypeScript·코드 기준 |
| `.env.example` | 변수 이름과 안전한 예시; 실제 비밀값 없음 |
| `compose.yaml` | 같은 PostgreSQL 버전·포트·healthcheck·영속 볼륨 설정 |
| `.gitignore`, `.dockerignore` | 비밀값·설치 결과·빌드·실데이터 제외 |
| `.gitattributes`, `.editorconfig` | 텍스트 줄바꿈·UTF-8·2칸 들여쓰기 통일 |
| `prisma/schema.prisma`, `prisma/migrations/` | 스키마와 버전별 DB 변경 |
| fixture·seed·환경 설정 도구 | 동일한 샘플 기준 데이터와 안전한 초기화 |
| `.github/workflows/` | OS별 설치·검증과 Linux DB 통합 검증 |
| README 및 환경 문서 | OS별 사전 설치·공통 실행·문제 해결 |

잠금 파일은 커밋하고 OS별로 의존성을 다시 설치한다. pnpm 버전도 도구/CI가 `packageManager` 설정을 따르도록 맞춘다. 버전 파일이 있다는 이유만으로 시스템 Node가 자동 변경됐다고 판단하지 않는다. [pnpm 설치](https://pnpm.io/installation), [pnpm install](https://pnpm.io/cli/install), [packageManager 설정](https://pnpm.io/package_json#packagemanager)

**GitHub에 올리지 않을 항목:** 실제 `.env`·API 키·토큰, 고객 주문 원본/DB 백업, PostgreSQL 데이터 디렉터리, `node_modules`, `.next`, 로그. 다른 OS로 이동할 때 이 폴더들을 복사하는 대신 해당 환경에서 재설치·재빌드·마이그레이션한다. Next.js의 SWC 등 플랫폼별 바이너리는 설치 환경에 맞아야 한다. [Next.js SWC 설치 문제](https://nextjs.org/docs/messages/failed-loading-swc)

Compose의 DB 볼륨은 코드 공유와 분리한다. DB 스키마는 마이그레이션, 개발 데이터는 fixture/seed로 전달한다. 공식 PostgreSQL 이미지의 amd64/arm64 지원을 확인하고 승인한 버전의 볼륨 경로를 사용한다. [PostgreSQL 공식 이미지](https://hub.docker.com/_/postgres)

## 6. 다른 OS에서 받았을 때의 목표 절차

1. 지원되는 Git·지정 Node·지정 pnpm·DB 실행 도구 설치.
2. GitHub 저장소 clone 또는 소스 압축 파일 다운로드. Git 이력이 필요한 작업에는 clone 사용.
3. `.env.example` 기반 로컬 환경 작성. 기본은 fixture 모드이며 실제 키는 별도 등록.
4. 잠금 파일을 유지한 설치와 필요한 Prisma client 생성.
5. PostgreSQL 실행 → 준비 완료 확인 → 개발 DB 마이그레이션 → 비식별 샘플 seed.
6. 웹·워커를 공통 프로젝트 명령으로 실행하고 상태 확인.
7. 타입·린트·빌드·기능 검증 수행.

후속 구현에서 `pnpm install --frozen-lockfile`, `docker compose up -d db`, `pnpm db:migrate`, `pnpm db:seed`, `pnpm dev`, `pnpm worker:dev` 형태의 공통 명령을 제공한다. **현재는 package.json·Compose·스크립트가 없으므로 실행 가능한 설치 안내가 아니다.** 초기 설정은 Node 기반 도구로 구현해 파일 복사·환경 검증의 셸 차이를 줄인다. DB 초기화 도구는 개발 DB에만 동작하게 하고 운영 DB를 자동 삭제/초기화하지 않는다.

GitHub에서 내려받아도 각 PC의 API 권한·키·발신 IP가 자동 승계되지 않는다. 로컬 시험은 fixture로 시작하고 실제 조회는 등록된 고정 발신 IP의 서버에서 진행한다. 여러 개발 PC가 같은 운영 계정으로 워커를 동시에 실행하지 않도록 기본 수집 비활성/fixture 모드를 유지한다.

## 7. 이식성을 위한 구현 규칙

- 경로는 Node 경로 API로 다루고 코드에 `C:\...` 같은 로컬 절대경로를 넣지 않는다.
- 파일명·import 대소문자를 정확히 맞추고 대소문자만 다른 두 파일을 만들지 않는다. TypeScript의 `forceConsistentCasingInFileNames`를 활성화한다. [TypeScript 설정](https://www.typescriptlang.org/tsconfig/forceConsistentCasingInFileNames.html)
- 공통 작업에 `rm -rf`, `cp`, `export`, Windows 전용 스케줄러 명령을 직접 요구하지 않는다. 파일 작업·환경 설정은 Node 도구 또는 검증된 공통 패키지를 사용한다.
- 환경변수 설정 구문은 셸에 종속되지 않게 구현하고 코드·문서를 UTF-8로 저장한다.
- 텍스트 줄바꿈을 LF로 관리하고 실행 스크립트에 필요한 Git 실행 권한을 확인한다. PostgreSQL 데이터는 Git 줄바꿈 변환 대상이 아니다.
- 서버 저장/서명 시간은 UTC, 화면은 Asia/Seoul 정책을 유지한다. 개발 PC의 현지 시간대에 따라 주문 기간·재고 시각이 달라지지 않게 한다.
- 네이티브 의존성·Prisma 생성 결과·빌드 산출물은 대상 환경에서 준비한다.
- 운영 웹·워커는 Linux 환경에서 빌드·실행하는 구성을 우선 검토한다. 개발 PC의 OS가 운영 서버의 OS와 같을 필요는 없다.

## 8. 실제 지원을 인정할 검증 기준

| 검증 | 구성 | 완료로 인정할 증거 |
| --- | --- | --- |
| OS별 기본 검증 | GitHub Actions Windows/macOS/Ubuntu 매트릭스 | 같은 Node/pnpm/lockfile로 설치·타입·린트·빌드·fixture 테스트 성공 |
| DB·워커 통합 | 별도 Ubuntu job + PostgreSQL service container | 마이그레이션·멱등 upsert·중단 복구·알림 검증 |
| 개발 PC 실행 | Windows 11, macOS Apple Silicon, 선정 Linux 배포판 | clone부터 DB·웹·워커 실행까지 재현 |
| 추가 CPU/OS | macOS Intel 등 실제 제공할 범위 | 해당 CPU/OS에서 추가 설치·실행 확인 |
| 실제 채널 조회 | 승인된 서버·계정·IP | 플랫폼 검증과 별도로 판매자센터 대조 |

GitHub Actions의 서비스 컨테이너는 Linux runner에서 사용한다. Windows/macOS 매트릭스에 동일 PostgreSQL service 설정을 넣지 않고 Linux DB 통합 job으로 분리한다. GitHub의 Windows/macOS runner가 모든 개인 PC 버전·CPU를 대체하는 것은 아니므로 실제 지원 대상에서 시작 절차도 검증한다. 재현 기준이 되는 runner OS 버전·CPU를 명시하고 `latest` 이미지 변경으로 지원 범위가 바뀌는지 관리한다. [서비스 컨테이너 요구사항](https://docs.github.com/en/actions/tutorials/use-containerized-services/use-docker-service-containers), [OS 매트릭스](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/run-job-variations), [runner 선택](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job)

현재 결론은 **기술 스택의 다중 OS 적용 가능**, 실제 재현 상태는 **구현·검증 전**이다. 다음 S1에서 공통 환경 파일과 실행 절차를 만들고 위 검증을 통과한 범위만 지원 완료로 표시한다.
