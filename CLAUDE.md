# diet-routine

1인용 감량 앱. 아이폰 앱(Expo)과 데스크톱 웹(Next.js)이 Supabase 로 같은 기록을 본다.
기획: `docs/PLAN.md` (기능·단계 변경 시 먼저 갱신)

## 모드

솔로 모드. 글로벌 `~/CLAUDE.md` 솔로 규칙 적용 (`main <- dev <- <type>/<desc>`).

## 구조

- `apps/mobile` Expo dev build: iOS 네이티브 기능 (HealthKit, 위젯, Live Activity, 알림, GPS)
- `apps/web` Next.js: 데스크톱 UI + 모든 서버 API (AI 포함)
- `apps/web-legacy` 지금 배포 중인 단일 HTML (diet-routine.vercel.app). web 이 대체하면 삭제
- `packages/core` 순수 TS: 식단 데이터, 끼니 시간, 칼로리 재분배, 체중 추세, 러닝 계산, 알림 계획
- `supabase/migrations` raw SQL

## 규칙

- 칼로리·시간·거리 계산은 `packages/core` 에서만. 앱과 웹에서 따로 계산하지 않는다
- 웹-앱 패리티: 기록·계산 결과는 양쪽이 같다. 레이아웃은 기기별로 다르게 설계
- AI 코치: 데이터를 바꾸는 도구는 변경 카드 승인 후에만 실행. 답변 속 숫자는 도구 반환값에서만
- Claude 모델 기본값 `claude-opus-5-5`
- 키는 루트 `.env.local` 과 Vercel env 에만. 앱 번들에 서버 키를 넣지 않는다
- UI 는 기본 브라우저·OS 컨트롤을 그대로 쓰지 않는다 (시간·숫자 입력은 직접 만든 피커)
- 다크 모드 중립색은 R=G=B (남색 금지), 모서리는 Apple 연속 곡률, 움직이는 상태 표시(점멸·LIVE) 금지
- 화면 문구는 합니다체 한국어
