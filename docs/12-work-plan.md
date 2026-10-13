# 12. 작업 계획 (갭 분석 및 워크스트림)

- 작성일: 2026-10-12
- 상태: 계획 확정, 실행 대기
- 근거: README, AGENTS.md, docs/00~11, docs/prototype-*, docs/notion-simple/01~10, preview/, scripts/ 전체 검토 결과
- 이 문서는 계획만 담는다. 아래 작업은 아직 하나도 실행하지 않았다.

## 1. 현재 상태 요약

- 존재: 설계 문서, 단일 HTML 시안(`preview/index.html`, 바닐라 JS), Playwright 검증 스크립트
- 없음: `package.json`, `src/`, `prisma/`, `workers/`, `fixtures/`, `tests/`, `compose.yaml`, `.env.example`, `.git`, `.github/`
- S0~S11 전부 미착수. 실제 API 호출·키 발급·판매자센터 대조 없음
- 문서 간 핵심 원칙(외부 쓰기 금지, 재고 상태 구분, RG 재고 비합산, 실패 시 마지막 성공값 유지)은 일관됨

## 2. 사용자 결정 사항 (2026-10-12)

| # | 항목 | 결정 | 후속 영향 |
|---|---|---|---|
| D1 | 게이미피케이션(매일 확인 미션, 상자 친구 이야기, 배지·샘플 연습) | **전부 본 구현에 포함** | AGENTS.md 범위 문구 갱신 필요, WS6에 게임 요소 이관 포함, 불일치 문서(A7) 정정 |
| D2 | 로그인/권한 방식 | **로그인 페이지(`/login`)와 사용자 메뉴 화면만 먼저 구현. 실제 인증·세션·권한 검사는 후속** | WS6 착수 전 결정 사항에서 제외. 화면은 인증 미구현 상태를 명시(아래 "로그인 화면 규칙" 참고). 게임 진행 저장은 브라우저 저장소 유지 |
| D4 | 패키지 버전 | **최신 LTS·안정판** (Node 24 LTS, pnpm 최신, Next 15, React 19, Prisma 최신 안정판) | WS3 착수 시 실제 호환성 확인 후 버전 고정 |
| D5 | 세미콜론 | **사용하지 않음** (Prettier `semi: false`) | 01 문서의 TS 예시 코드 정리 |

### 미결 사항

| # | 항목 | 권장안 | 결정 필요 시점 |
|---|---|---|---|
| D2-후속 | 실제 인증·권한 (세션, 서버 권한 검사, 관리자/조회자 역할) | Auth.js 이메일+비밀번호, 단일 조직, 관리자/조회자 2역할 | 실연동(WS8) 또는 외부 접속 허용 전. 화면(WS6)은 대기하지 않음 |
| D3 | 배포·고정 IP 워커 서버 | 개발은 로컬 Docker Compose, 실연동 전 고정 IP VPS 1대 | WS8 착수 전 |
| D6 | 네이버·쿠팡 키 발급 일정·담당 | 사용자가 직접 발급(에이전트는 키를 다루지 않음) | WS8 착수 전 |
| D7 | 디자인 토큰 | 현행 시안의 민트 계열(#247D68/#16816A)을 기본색으로 | WS6 착수 전 |
| D8 | 원격 저장소·CI | GitHub private + Actions (ubuntu 필수, win/mac 매트릭스) | WS3 착수 시 |

## 3. 갭 분석

### (A) 수정할 것

| # | 내용 | 대상 | 영향 |
|---|---|---|---|
| A1 | 상단 현황표가 "폴더 0개, AGENTS.md 없음"으로 현재와 다름. 일자순 역전, 산출물 목록 누락 | docs/00-project-status.md | 높음 |
| A2 | 첫 버전을 5채널로 서술 (범위 조정 미반영) | docs/05-notion-development-roadmap.md | 높음 |
| A3 | 쿠팡 RG 재고 파라미터 `vendorIdItemId` vs `vendorItemId` 모순 | docs/03, notion-simple/08·09 | 높음 |
| A4 | 쿠팡 `returnRequests`의 `cancelType`/`orderId` 조건 충돌 | docs/03, notion-simple/08·09 | 중간 |
| A5 | 쿠팡 판매자배송 일부 API 사양 미재대조(2026-10-04 기준) | docs/03 | 중간 |
| A6 | TS 예시 코드가 세미콜론 사용 | docs/01-system-design.md | 중간 |
| A7 | "이야기 24/22" 오타(실제 24/24), 배지 3개(설계) vs 2개(실제), '한 바퀴 검토' 이름-조건 불일치, 방문 완료 원칙 주석 누락 | docs/06~11, prototype-*, README, preview/README | 중간 (D1로 본 구현 포함 확정) |
| A8 | 메뉴명 불일치 (운영 현황 vs 대시보드 등) | prototype-*, 01 | 중간 |
| A9 | 디자인 토큰 불일치 (남색 #18324F/#2864D8 vs 민트 #247D68/#16816A) | prototype-* | 중간 |
| A10 | 최종 확인 체크리스트 미갱신 | docs/prototype-requirements.md | 낮음 |
| A11 | 검증 스크립트 Playwright 경로 하드코딩, 127.0.0.1:8765 서버 수동 실행 필요 | scripts/verify-*.cjs | 중간 |
| A12 | 제안값(원본 보관 7일, 수집 주기 등)과 확정값 구분 없음 | docs/01 | 낮음 |
| A13 | AGENTS.md 첫 버전 범위에 게이미피케이션 없음 (D1과 불일치) | AGENTS.md | 높음 |

### (B) 추가할 것

| # | 내용 | 산출물 | 영향 |
|---|---|---|---|
| B1 | git 저장소 없음 | `git init`, `.gitignore`, `.gitattributes`, `.editorconfig` | 높음 |
| B2 | 환경변수 이름 목록 없음 | `docs/13-env-and-secrets.md`, `.env.example` (이름만, 값 없음) | 높음 |
| B3 | 조회 전용 허용 목록 없음 (POST 조회 API 존재) | `docs/14-read-only-allowlist.md` → 코드 `allowlist.ts` (메서드+경로, 그 외 차단) | 높음 |
| B4 | 용어집 없음 | `docs/15-glossary.md` (메뉴명, 상태축, quantityType, sourceMode) | 중간 |
| B5 | fixture 시나리오 명세 없음 | `docs/16-fixture-scenarios.md` (9,999 기본값, 빈 응답, 성공 후 실패, 부분 클레임, RG/판매자배송 비합산) | 높음 |
| B6 | 테스트 전략 없음 | `docs/17-test-strategy.md` (단위·계약·E2E, 불변조건 테스트) | 중간 |
| B7 | 시안 → 컴포넌트 대응표 없음 | `docs/18-ui-component-map.md` (shadcn 대응, UI 상태 6종, 360/768/1440, `SourceModeBadge`, 게임 요소 컴포넌트) | 중간 |
| B8 | 결정 기록 없음 | `docs/decisions/ADR-0001~` (D1~D8) | 중간 |
| B9 | 수치 KPI 없음 | PRD 보강 (주문 반영 지연, stale 비율, 수집 성공률 등) | 중간 |
| B10 | 게임 진행 저장 방식 미정 (로그인 전/후) | ADR: 로그인 전 브라우저 저장소 → 로그인 도입 후 사용자별 DB 이전 여부 | 중간 |

## 4. 워크스트림

서브에이전트 모델 원칙: 파일 읽기·단순 작성은 sonnet, 기획·설계·분석은 opus.

| WS | 목표 | 주요 산출물 | 선행 | 모델 | 완료 기준 |
|---|---|---|---|---|---|
| WS0 저장소 초기화 | git·브랜치 규칙 적용 | `.gitignore`, `.gitattributes`, `.editorconfig`, 초기 커밋 | 없음 | sonnet | 초기 커밋, feature 브랜치 생성 가능 |
| WS1 문서 정정 | (A) 항목 정정 | 00, 05, 03(모순 절), 01, 06~11·prototype-*, AGENTS.md, `15-glossary` | WS0 | sonnet (모순 판단은 opus) | A1~A13 반영 |
| WS2 명세·결정 보강 | (B) 문서 작성 | ADR, 13·14·16·17·18번 문서 | WS0 | opus | ADR이 "확정" 또는 "보류 사유" 상태 |
| WS3 개발 기반 (S1) | 실행 가능한 Next 앱 골격 | `package.json`, `pnpm-lock.yaml`, `.node-version`, `tsconfig.json`, ESLint/Prettier, Tailwind·shadcn, `compose.yaml`, `.env.example`, CI, 스크립트 경로 수정 | WS0, D4, D5, D8 | sonnet 구현 + opus 검토 | install/lint/typecheck/build 통과, DB 컨테이너 기동 |
| WS4 데이터 모델 (S2) | Prisma 스키마·마이그레이션 | `prisma/schema.prisma`, migrations, seed, repositories | WS3 | opus 설계 → sonnet 구현 | migrate/seed 통과, scopeKey unique, 불변조건 테스트 |
| WS5 커넥터 계약·수집 (S3) | 조회 전용 계약, 오류 분류, 수집 파이프라인 | `server/connectors/contracts/*`, `connectors/fixture/*`, `fixtures/*`, `server/sync/*`, `workers/*` | WS4, B5 | opus | fixture로 전 경로 동작, "실패가 성공값을 덮지 않음"·"빈 응답≠0"·허용 목록 차단 테스트 통과 |
| WS6 화면 (S7) | 시안 → Next 컴포넌트 이관 (게임 요소 포함, 로그인 페이지·사용자 메뉴 포함) | `features/{inventory,orders,mappings,integrations}`, `features/gamification/{daily-checks,story,practice}`, `features/auth/{login-form,user-menu}` (화면만), `app/login/page.tsx`, 공통 상태 배지 | WS3, B7, D7 | sonnet 구현 + opus 검토 | 4개 라우트 UI 상태 6종, 반응형 3구간, fixture 배지, 기존 시안 검증 항목(85개) 대응 테스트 |
| WS7 대시보드·알림 (S8) | 운영 요약, 앱 내부 알림 | `features/dashboard`, `server/alerts` | WS5, WS6 | opus 설계 + sonnet 구현 | 반복 실패 3회·인증 오류 즉시 알림, 샘플 제외, 게임 영역이 경고를 가리지 않음 |
| WS8 실제 연동 (S4~S6) | 네이버·쿠팡 판매자배송·RG 조회 | `connectors/{naver,coupang-seller,coupang-rocket-growth}`, `server/security` | D3, D6, 키·고정 IP | opus | 03 체크리스트 완료, live 수집 1회 성공, A3·A4 확정 |
| WS9 검증·QA (S11) | 대조·운영 검증 | `tests/e2e`, `tests/contract`, 대조 리포트 | WS7 (live는 WS8) | opus 분석 + sonnet 실행 | KPI 측정 가능, 회귀 녹색 |

### 로그인 화면 규칙 (D2)

- 범위: `/login` 페이지(React Hook Form + Zod 폼), 상단바 사용자 메뉴(계정 표시·로그아웃 자리), 메뉴 접근 구조만 만든다.
- 하지 않는 것: 실제 인증, 세션·쿠키 발급, 비밀번호 검증, 사용자 DB 저장, 서버 권한 검사. 제출 버튼은 동작하지 않거나 "인증 미구현" 안내만 보여 준다.
- 표기: mock을 실제 연동처럼 표현하지 않는다는 AGENTS.md 원칙에 따라, 로그인 화면과 사용자 메뉴에 "인증 미구현 · 화면 시안" 배지를 둔다. 계정명·역할은 `DEMO-*` 가상 값만 쓴다.
- 비밀값: 자격 증명을 브라우저 저장소·로그·fixture에 저장하지 않는다. 입력값을 어디로도 전송하지 않는다.
- 제한: 실제 인증이 붙기 전에는 외부 네트워크에 앱을 노출하지 않는다(로컬 개발 전용).
- 후속 연결: 실제 인증 도입 시 `features/auth`의 폼·메뉴 컴포넌트를 재사용하고, `User`/역할 스키마(WS4)와 서버 권한 검사를 추가한다.

## 5. 1단계 실행 순서 (실행 승인 시)

결정 없이 진행 가능한 작업이다. 각 항목은 1~4개 파일, 1커밋 단위로 진행한다.

1. WS0: git 초기화와 기본 설정 파일 3종, 초기 커밋
2. `feature/docs-cleanup` 브랜치: 00 현황표 재작성 (A1)
3. 05 범위 정정 (A2)
4. 03에 "모순·미확정 사양" 절 추가 (A3~A5)
5. AGENTS.md 범위에 게이미피케이션 반영 (A13, D1)
6. 게임 요소 문서 불일치 정정 (A7)
7. 15 용어집 신설 (B4, A8)
8. ADR 초안 (D1~D8, B10)
9. 14 허용 목록, 16 fixture 시나리오 초안 (B3, B5)
10. 13 환경변수 문서 초안 (B2)

## 6. 리스크와 완화

| # | 리스크 | 완화 |
|---|---|---|
| R1 | 외부 쓰기 API 오호출 (POST 조회와 혼동) | 메서드+경로 허용 목록과 기본 차단, 커넥터에 쓰기 메서드 미정의, 계약 테스트 |
| R2 | 실패·빈 응답이 재고 0으로 표시 | valueState/readState/freshness 분리, 덮어쓰기 금지 불변조건 테스트, 9,999·빈 응답 fixture 필수 |
| R3 | 키 발급·고정 IP·쿠팡 권한 24시간 등 외부 지연, 사양 모순 | fixture 우선 개발, 모순 항목은 `unverified` 표시, D3·D6 조기 확보 |
| R4 | 게임 요소 포함(D1)으로 범위·일정 확대, 방문 미션이 업무 확인으로 오인 | 게임 영역을 업무 화면과 분리된 feature로 구현, 경고·품절·미연결 표시를 가리지 않는 배치 규칙을 18번 문서에 명시, 핵심 업무(WS5) 우선 |
| R6 | 화면만 있는 로그인을 실제 인증으로 오해하거나, 인증 없이 외부에 노출 | "인증 미구현" 배지 필수, 입력값 미전송·미저장, 외부 노출 금지를 CI/문서에 명시, 실연동(WS8) 전 실제 인증을 선행 조건으로 지정 |
| R5 | 비밀값 노출, 샘플을 실연동처럼 표현 | `.env.example`에 이름만, `NEXT_PUBLIC_` 금지 규칙, `server-only` 모듈, 모든 fixture 데이터에 `SourceModeBadge`, 주소·전화·수취인 기본 미저장 |
