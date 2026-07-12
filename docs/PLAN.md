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
- **M2** 진행중 (2026-07-12 인프라 완료): 공개 리포 [github.com/jhlee111/local-wind](https://github.com/jhlee111/local-wind) + **라이브 사이트 <https://local-wind.pages.dev>** (wrangler 첫 배포 ✅). Actions cron 활성화 — bake-wind(매시 :20, bake→build→CF 배포) + collect-obs(매시 :07, 관측→main 커밋). **자동 배포 검증 완료(2026-07-12 08Z)**: CF 시크릿 설정 후 CI에서 bake→build→CF Pages 배포 성공. (트러블슈팅 기록: 최초 실패는 `CLOUDFLARE_ACCOUNT_ID` 값 오류 — CF 에러 7003 "Could not route"는 계정 ID 문제, 토큰 문제 아님. wrangler whoami의 32-hex ID로 교정.) 이제 매시 :20 자동 갱신. **속도 컬러 오버레이 ✅ (2026-07-12)**: WeatherLayers RasterLayer(파티클 아래) + 노트 기준 범례, 팔레트는 `web/src/palette.ts` 단일 소스(세일링 임계값 스톱, 명도 단조증가 = CVD 안전). 로컬·프로덕션 렌더 검증. **잔여 DoD**: Cabrillo 스팟 마커 + 클릭 시 관측/예보 시계열(M2 마지막 조각)
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

## 하지 않는 것

- 자체 WRF/RASP, ML 다운스케일(CorrDiff류) — P5+ 후보로만
- 유료 계정·API 키 필수 서비스, 상시 서버, DB (parquet/정적 파일로 충분)
