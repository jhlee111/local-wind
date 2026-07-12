# HANDOFF — 2026-07-12 세션 종료 스냅샷

> 이 문서는 세션 종료 시점 스냅샷입니다. **살아있는 계획·상태는 [PLAN.md](PLAN.md)가 canonical** — 어긋나면 PLAN이 맞습니다. 다음 세션이 이 문서만 읽고 바로 일할 수 있게 쓰였습니다.

## 시스템 현황 (자동으로 돌아가는 것들)

- **라이브**: <https://local-wind.pages.dev> — 파티클+컬러 오버레이 지도, 클릭-anywhere 포인트 예보, Cabrillo 스팟 패널(관측/예보 차트 + 주간 테이블)
- **GitHub Actions** (public repo, 무료 무제한):
  - `bake-wind` 매시 **:20** — HRRR 19프레임 bake → obs export → spot series(HRRR 1h + GFS 3h·7일) → vite 빌드 → CF Pages 배포
  - `collect-obs` 매시 **:07** — KTOA·AGXC1·46025 관측 수집 → `data/obs/YYYY-MM.parquet` **main에 자동 커밋**
- **시크릿**: `CLOUDFLARE_API_TOKEN`/`CLOUDFLARE_ACCOUNT_ID` 설정 완료 (계정 ID 오류→7003 트러블슈팅 이력은 PLAN 참조)

## 상태 요약

- **완료**: M1(파이프라인) · M1.5(관측 수집) · M2(라이브+자동화+컬러 오버레이+스팟 패널) · M2.5a(클릭-anywhere) · M2.5b(주간 테이블) · **M2.6 UX 리디자인 전체(UX-1~5, 2026-07-12)** — 단일 selectedTime(D12), 팔레트 타임라인(D14), 범례 코너(D15), 모바일 하단 시트(D13), 임의지점 Open-Meteo 테이블. 상세는 PLAN.md M2.6 절
- **그 뒤 갈림길**: M3(WindNinja 지형 — pixi/Docker 필요) vs **M4 bias 분석(관측이 7/12부터 쌓이는 중 → 7월 말 가능, thermal 정확도의 본체)**
- 백로그(PLAN TODO): NBM 업그레이드, GFS 재다운로드 절약, 래스터 B채널 GUST(지도 거스트 토글)

## 다음 세션 시작 상태 점검 (30초)

```bash
git pull --rebase origin main          # obs cron 커밋 받기 (필수 습관)
gh run list --limit 3                  # 두 cron 최근 실행 success 확인
curl -s "https://local-wind.pages.dev/data/wind.json" | python3 -c "import json,sys;print(json.load(sys.stdin)['run'])"   # 런이 ~2h 이내면 정상
uv run --project pipeline python -c "import pandas as pd;d=pd.read_parquet('data/obs/2026-07.parquet');print(d.groupby('source').time_utc.max())"  # 관측 적재 확인
```

로컬 개발: `npm --prefix web run dev` (데이터 낡았으면 `uv run --project pipeline python -m localwind.bake` 먼저). 배포는 **push → CI만** (CLAUDE.md 운영 규칙).

## 새 세션 Pickup 프롬프트 (복붙용)

```
/pickup
이어서 M2.6 UX 리디자인 구현 시작해줘.
docs/ux-redesign.md의 설계(D12-D15)와 "구현 노트" 섹션 그대로,
UX-1(단일 selectedTime 스토어 리팩터 — 시각 변화 없음, 회귀 없음이 DoD)부터
단계별로 진행하고 각 단계마다 데스크톱+375px 프리뷰로 검증 후 커밋·배포해줘.
```

(pickup 없이 시작해도 됨 — CLAUDE.md → PLAN.md → ux-redesign.md 순으로 읽으면 같은 지점에 도달)
