# local-wind MVP 구현 계획

> Living doc — 작업 시작 전 확인, 결정 변경 시 여기 갱신. 배경·근거는 [research-wind-forecast.md](research-wind-forecast.md) (신뢰도 tier 표기 포함).
> 최초 작성: 2026-07-11

**목표 한 줄**: South Bay(Torrance/San Pedro/PV) 연안 바람을 색+파티클로 보여주는 무료 self-hosted windy 스타일 사이트. HRRR 기반, 지형·통계보정은 검증 후 단계적 추가.

## 결정 기록 (Decision Log)

| ID | 결정 | 근거 | 상태 |
|---|---|---|---|
| D1 | 기상 데이터 = **HRRR** (Herbie byte-range, AWS `noaa-hrrr-bdp-pds` 익명) | 3km·hourly·무료·익명, NAM 은퇴 예정, RRFS는 pre-op(~2026-10) — 정식 운영 후 재평가 | ✅ 확정 |
| D2 | **Python 파이프라인 + TypeScript 프론트** monorepo (`pipeline/` + `web/`) | 기상 도구는 전부 Python, WebGL 렌더는 전부 JS — 생태계 강제 | ✅ 확정 |
| D3 | 프론트 = **A안: Vite + MapLibre GL + WeatherLayers GL** (vanilla TS 기본) | windy 비주얼 목표. 폴백 B: Leaflet + leaflet-velocity | ✅ A안 확정 (프레임워크는 React/Svelte 선호 시 변경 가능) |
| D4 | **서버 없음**: GitHub Actions cron(public repo) + Cloudflare Pages/R2 정적 서빙 | $0 목표, "미리 구워 정적 서빙" 아키텍처 | ✅ 확정 |
| D5 | **지형(WindNinja)은 Phase 3으로 유보**, Phase 4 관측 검증에서 실효 확인 후 정식 채택 | WindNinja는 mechanical 전용 — sea-breeze는 생성 못함(공식 경고). 해풍 신호는 HRRR가 담당 | ✅ 확정 |
| D6 | **관측 수집기(collector)를 Phase 1부터 상시 가동** | thermal 오차의 실질 해법 = 스팟별 통계보정(MOS) — 학습 데이터를 미리 축적 | ✅ 확정 |
| D7 | Python 환경: **uv** (P0–P2) → **pixi/conda 또는 Docker** (P3, WindNinja C++·GDAL 필요 시점) | P0–2 의존성은 전부 wheel; WindNinja는 conda-forge/Docker | ✅ 확정 |
| D8 | 브라우저 데이터 포맷: **PNG-encoded U/V raster** (R=U, G=V, unscale ±40 m/s 고정) | WeatherLayers/webgl-wind 표준 방식, 컴팩트. B폴백 시 grib2json | ✅ 확정 (2026-07-12 구현·렌더 검증) |
| D9 | **장기(>48h) 예보는 지도 래스터가 아니라 스팟별 point-series JSON**으로. 지도 래스터는 단기 HRRR(≤48h)만 | 10일치 래스터는 ~240프레임(낭비); 스팟 테이블은 몇 KB JSON으로 동일 UX. 임의 지점 장기예보는 Open-Meteo 클라이언트 fetch(CORS 허용·무료) 옵션 | ✅ 확정 (2026-07-12) |
| D10 | **클릭값 정직성**: 포인트 값 옆에 소스·해상도 표시(예: "HRRR 3 km · interpolated"). 보간의 매끈함이 해상도 착시를 만들므로 명시 | windy.app는 GFS ~25km 보간값을 라벨 없이 노출 — 모델 유효 해상도는 격자의 4~7배라는 사실을 숨기지 않는 것이 차별점 | ✅ 확정 (2026-07-12) |
| D11 | 시간 해상도: **1시간 기본**(HRRR native), 장기 구간은 3h(NBM/GFS), 15분 subhourly(`product="subh"`)는 nowcast 옵션 | windy.app 무료는 3h(1h는 유료) — 우리는 1h가 공짜. HRRR subh로 해풍 onset 표현력 여지 | ✅ 확정 (2026-07-12) |
| D12 | **단일 시간 상태(selectedTime)** — 맵·타임라인·차트·테이블이 하나의 T를 공유, 어디서 조작해도 동기화 | 시간 컨트롤러 3개가 따로 놀아 직관성 붕괴(사용자 피드백). 상세: [ux-redesign.md](ux-redesign.md) | 계획 (2026-07-12) |
| D13 | **모바일 = 하단 시트**(peek/half/full), 플로팅 모달 금지. 데스크톱 = 우측 카드 유지 | windy.app 패턴. 폰에서 팝업 비친화적(사용자 피드백) | 계획 (2026-07-12) |
| D14 | **타임라인 = 팔레트 색칠 스크러버**(날짜 틱+스팟 풍속 스트립+로컬시간 라벨), naked range input 제거 | 슬라이더 자체가 주간 개요가 됨(windy.app 슬라이더 그라데이션 패턴) | 계획 (2026-07-12) |
| D15 | **범례는 코너로 강등**(참조물), "HRRR 16Z f00"류 런 메타는 부가 정보 줄로 | 하단 중앙은 컨트롤 자리. D10 정직성은 위계만 낮춰 유지 | 계획 (2026-07-12) |

## 도메인 파라미터 (초안 — M1에서 조정)

- **표시 도메인 bbox**: lat 33.2–34.2, lon −119.0 – −117.8 (Santa Monica Bay~Long Beach, Catalina 포함 — eddy·채널 흐름 관찰용)
- **다운스케일 도메인(P3)**: PV 반도 중심 ~30×30 km, 목표 해상도 ~200 m (WindNinja 권장 한도 50×50 km 내)
- **변수**: 10 m U/V(UGRD/VGRD), GUST. 옵션: 15분 subhourly(`product="subh"`, 해풍 onset 표시용)
- **시간**: 매시 f00–f18, 00/06/12/18Z 사이클은 f48까지
- **스팟(포인트 예보·검증 기준점)**: Cabrillo Beach(33.708, −118.286) 우선, Torrance Beach 추가 예정

## 마일스톤 & Definition of Done

- **M0** (옵션, 반나절): Open-Meteo API로 Cabrillo 48h 바람 시계열 플롯 1장. — 파이프라인 감 잡기용, 건너뛰어도 됨
- **M1** ✅ (2026-07-12): `pipeline/` — Herbie로 South Bay bbox HRRR 10m U/V 서브셋 → quiver/barbs 정적 PNG 1장. **DoD**: 명령 한 번에 최신 HRRR로 바람장 PNG 생성 → `uv run --project pipeline python -m localwind.plot_once` 동작 확인. bake(13프레임) + 웹 파티클 렌더·시간 슬라이더까지 로컬 검증 완료 (M2의 로컬 부분 선행 달성)
- **M1.5** 수집기 ✅ (2026-07-12): `localwind.obs` — KTOA METAR + **NDBC AGXC1**(Angels Gate, LA 하버 입구 — Cabrillo 바로 앞) + NDBC 46025 → `data/obs/YYYY-MM.parquet` dedup 병합. ⚠️ 당초 계획의 CO-OPS 9410660은 **바람 센서 없음**(기압·수위만)이 확인되어 AGXC1로 대체. **잔여 DoD**: 상시 스케줄 가동(cron 3일 무결) — M2 인프라(Actions cron)에서 활성화
- **M2** 진행중 (2026-07-12 인프라 완료): 공개 리포 [github.com/jhlee111/local-wind](https://github.com/jhlee111/local-wind) + **라이브 사이트 <https://local-wind.pages.dev>** (wrangler 첫 배포 ✅). Actions cron 활성화 — bake-wind(매시 :20, bake→build→CF 배포) + collect-obs(매시 :07, 관측→main 커밋). **자동 배포 검증 완료(2026-07-12 08Z)**: CF 시크릿 설정 후 CI에서 bake→build→CF Pages 배포 성공. (트러블슈팅 기록: 최초 실패는 `CLOUDFLARE_ACCOUNT_ID` 값 오류 — CF 에러 7003 "Could not route"는 계정 ID 문제, 토큰 문제 아님. wrangler whoami의 32-hex ID로 교정.) 이제 매시 :20 자동 갱신. **속도 컬러 오버레이 ✅ (2026-07-12)**: WeatherLayers RasterLayer(파티클 아래) + 노트 기준 범례, 팔레트는 `web/src/palette.ts` 단일 소스(세일링 임계값 스톱, 명도 단조증가 = CVD 안전). 로컬·프로덕션 렌더 검증. **스팟 패널 ✅ (2026-07-12)**: Cabrillo 마커(pointerup+키보드 — click은 맵 드래그에 삼켜짐) → 24h 관측(AGXC1, 거스트 점) vs 13h HRRR 예보(클라이언트에서 U/V 래스터 샘플링) 차트, 방향 화살표·now라인·크로스헤어 툴팁, 시리즈 색은 dataviz validator 통과쌍(#c9821a/#3583cc). `localwind.export_obs`가 bake 워크플로에서 obs_recent.json 생성. **→ M2 완료.**
- **M2.5 — 포인트 예보 UX** (windy.app 클릭 UX 벤치마크, 2026-07-12 계획):
  - **M2.5a 클릭-anywhere 패널 ✅ (2026-07-12)**: 지도 임의 지점 클릭 → `sampleUV()` 재사용 패널(coords 제목, 예보만, D10 라벨 "HRRR 3 km grid · interpolated (no station)", 임시 포인트 마커, bbox 밖 무시, 관측 범례 자동 숨김+과거창 3h 축소). 사용자 실브라우저 검증 + 라이브 배포 완료
  - **M2.5b 스팟 주간 테이블 ✅ (2026-07-12)**: `localwind.spot_series` — HRRR f00–f18(native 1h, 래스터와 같은 런 probe) + GFS 0.25° 3h → f168(~7일) point-series JSON → 패널에 3h 매트릭스(일자 헤더·kt/gust 팔레트 색칠+휘도 기반 잉크·방향 화살표·now 링·가로 스크롤). 래스터도 f18(19프레임)로 확장. 로컬·라이브 검증. 차트 예보선에도 모델 거스트 점 표시(series에서 시각 매칭 주입, 2026-07-12). **TODO**: NBM으로 장기 구간 업그레이드(보정된 point guidance), GFS 중복 다운로드 절약(런 변경시만), ad-hoc 포인트 장기예보(Open-Meteo)
- **M2.6 — UX 리디자인** (2026-07-12 진행 중): 단일 타임라인(D12) + 반응형(D13-D15). 설계 문서: [ux-redesign.md](ux-redesign.md). **전 단계 완료 ✅ (2026-07-12)**: UX-1 → UX-2 → UX-3 → UX-4 → UX-5. 단계별 독립 배포됨
  - UX-1: `web/src/state.ts` 단일 시간 스토어(times = 래스터 frames ∪ 8일 spot series, 미니 pub/sub). 슬라이더·맵 래스터·주간 테이블이 구독자로 전환, `loadSeries()` 공유 메모이즈. 테이블 `sel-col` 클래스는 emit만(스타일은 UX-2에서) → 시각 무변화. 보너스 수정: 빠른 스크럽 시 텍스처 디코드 완료 순서 역전으로 래스터/라벨이 뒤로 되돌아가는 선존재 레이스에 stale-완료 드롭 가드. 데스크톱+375px 검증 완료
  - UX-2: `web/src/timeline.ts` 커스텀 스크러버 — 8일 팔레트 스트립(스팟 시리즈 → colorForKt 그라데이션), 날짜 틱(`SUN 12` — 로케일 스켈레톤이 day-first라 수동 조립), 래스터 밖 구간 딤 + `map ≤ +18 h` 뱃지, 드래그/탭+ARIA slider+←/→(그리드 간격대로 1h/3h 스텝). 범례 → 우하단 `kt` 칩 토글(D15). 차트 T-커서(#sp-tcursor, 풀 리렌더 없이 위치만 갱신 — attachHover 리스너 중복 회피), 테이블 sel-col 파랑 링 스타일. 가드: setPointerCapture는 합성 포인터에서 throw → try/catch. 모바일(<768px)은 격일 라벨 + credit/칩을 타임라인 위로 (media query는 원본 선언 뒤에 둬야 이김 — specificity 동률)
  - UX-3: 차트 = **T가 속한 로컬 하루 창**(자정±1.5h pad, `sp-chart-day` 라벨). 스팟 차트의 예보 소스를 래스터 샘플링 → **8일 point series**로 전환 (패널 열 때 텍스처 13장 디코드 불필요 — 임의지점/시리즈 실패 시에만 래스터 폴백). 테이블 셀 `data-ms` + 위임 클릭 1개 → `selectTime` (날짜 헤더 = 그 날 정오, 3h 그리드 스냅), hover 밝기 어포던스. 차트 hover 리스너 1회 등록으로 리팩터(리렌더마다 누적되던 선존재 버그 수정), 예보 hover 스냅 반경 45→95분(3h 구간 커버). 미래 날엔 obs/past셰이딩/now라인 자동 부재 = 검증 뷰 부수효과 유지
  - UX-4: `web/src/sheet.ts` — <768px에서 `#spot-panel`을 하단 시트로(peek 88px / half 330px / full 86vh, height transition + snap). 그립 드래그(~50줄 포인터 핸들러, 인라인 height 추적 → 릴리스 시 최근접 스냅) + 그립/헤더 탭 = peek→half→full 순환. 모바일 콘텐츠 순서 CSS `order`로 헤더→테이블(=시간 내비)→차트(full에서만), 타임라인 바 숨김. 임의지점은 테이블이 없어 half가 비므로 `:has(#sp-table[hidden])`로 차트를 half에 표시(UX-5에서 자연 소멸). 데스크톱 무변화(시트 클래스는 media query 안에서만 의미). 모바일 뱃지("map ≤ +18 h")는 타임라인과 함께 숨겨짐
  - UX-5: `web/src/openmeteo.ts` — 임의지점 8일 시리즈 클라이언트 fetch(무키·무료, ~1km 좌표 캐시, `t+":00Z"`로 UTC 명시 파싱). 스팟/임의지점이 **같은 SeriesPt 경로** → 테이블·day-창 차트·시간내비 UI 완전 동일(D13), 실패 시 래스터 폴백(고정 창). D10 강화: 차트 라인 라벨 = **현재 창에 실제 보이는 소스**(오늘 HRRR / 먼 날 GFS / 포인트 Open-Meteo), 테이블 캡션 "source: …", 범례 라벨 동적. extendTimes는 미래 시각만(OM이 00Z부터 시작해 타임라인이 과거로 끌리는 것 방지). 폴리시: 유리 마감 통일(보더 하이라이트+그림자+radius 12), tl-time 요일/시간 위계, **playhead knob = T 시각 풍속의 팔레트색**. Lighthouse 실측은 못 함(번들 +2KB뿐, 회귀 없음 — 라이브에서 확인 가능)
- 다음: **M2.6(UX)** → M3(WindNinja 지형 토글) 또는 M4 조기 착수(관측 데이터가 이미 쌓이는 중이므로 2-3주 후 bias 분석 가능)
- **M3**: WindNinja(mass solver, HRRR init, 3DEP 10m + NLCD) ~200m 레이어 토글. **DoD**: 동일 시각 HRRR raw vs 다운스케일 비교 화면
- **M4**: 검증 대시보드 + 스팟 통계보정. **DoD**: 스팟·시간대별 bias 차트, 보정 전/후 MAE 리포트 → **D5 재평가(WindNinja 정식 채택 여부) + 보정 모델 예보 적용**

## 리스크 / 스캐폴딩 시 확인

- ~~WeatherLayers GL 라이선스~~ → **해소(2026-07-12)**: npm 메타데이터 확인 결과 `(MPL-2.0 OR 상업 라이선스)` 듀얼 — MPL-2.0 옵션으로 무료 사용 가능 (weatherlayers-gl 2026.5.2)
- GH Actions 무료 쿼터에서 WindNinja hourly 실행 실측 (P3 진입 시)
- ~~CO-OPS 9410660 바람 센서 실가동 여부~~ → **해소(2026-07-12)**: 센서 목록에 anemometer 없음 확인 → NDBC AGXC1(Angels Gate, 6분 간격)로 대체. NDBC 46025 결측률은 데이터 쌓이면 관찰
- cfgrib 다중 typeOfLevel 읽기 시 `filter_by_keys` 필요 (Herbie `.xarray()`가 대부분 처리)

### 구현 gotcha (발견 시 추가)

- **Herbie는 naive UTC datetime만 받는다** — tz-aware를 주면 `Cannot compare tz-naive and tz-aware timestamps`. `fetch.find_latest_run()`이 naive로 변환해 반환.
- HRRR 경도는 0–360 — bbox 크롭·regrid 전에 ±180 변환 필요 (`fetch.lon_to_pm180`).
- HRRR Lambert 격자는 위경도에 회전돼 있어 인덱스 크롭은 회전된 상위집합 — 정확한 bbox는 bake의 regrid(griddata)에서 잘림.
- basemap(OpenFreeMap) 로드 실패/차단 시에도 바람 레이어가 뜨도록 fallback 인라인 스타일 + 6s 타임아웃 가드 (`web/src/main.ts`). **주의**: 첫 렌더를 map `'load'`에만 걸면 basemap 차단 시 영영 안 뜸 → `loaded()`/`load`/`style.load`/timeout 중 먼저 오는 것으로 트리거하고, `buildLegend()`는 fetch 이전에, manifest fetch엔 10s timeout. deck.gl은 basemap과 독립적으로 렌더됨.
- 팔레트는 연속 필드라 dataviz의 카테고리컬 validator 부적용 — 대신 명도 단조증가로 magnitude 가독성(CVD) 확보. 범례는 필수(구현됨).
- **캔버스 400×300 고착 레이스**: vite dev의 비동기 CSS 주입 때문에 Map 생성 시점에 `#map`이 0-size로 측정될 수 있고, 이후 resize 관찰이 안 오는 환경에선 maplibre 기본 400×300에 고착. 일회성 `map.resize()`도 같은 레이스에 짐 → **캔버스=컨테이너 일치까지 250ms 폴링(10s 한도)** (`web/src/main.ts` sizePoll).
- 마커 클릭은 `click` 이벤트 대신 **pointerdown/up + 이동 가드** — 맵 드래그 핸들러가 click을 삼키는 경로(터치·자동화 포함)에서도 동작 (`web/src/spots.ts`).

## 하지 않는 것

- 자체 WRF/RASP, ML 다운스케일(CorrDiff류) — P5+ 후보로만
- 유료 계정·API 키 필수 서비스, 상시 서버, DB (parquet/정적 파일로 충분)
