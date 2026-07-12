# 로컬 윈드 예보 사이트 리서치 — Southern California 연안 (Torrance / San Pedro / Palos Verdes)

> 목표: windy.app 스타일의 **무료·self-hosted** 로컬 바람 예보 웹사이트. 지형(terrain)을 반영해
> South Bay 연안(San Pedro / Cabrillo Beach / PV) 바람의 방향·세기를 색으로 시각화. windsurf / kite / wing foil 용.
>
> 작성일: 2026-07-11 · 리서치 방식: 6-angle fan-out → 28개 소스 fetch → 134개 claim 추출 → adversarial 3-vote 검증 → 21개 confirmed / 9개 finding

## 신뢰도 범례

| 표기 | 의미 |
|---|---|
| ✅ **검증됨** | adversarial 3-vote 검증을 통과(대개 3-0). 1차 소스(정부 SCN, peer-review 논문, 공식 docs) 기반. |
| 📎 **소스 수집** | 리서치가 primary 소스를 fetch·평가했으나, 해당 claim이 최종 3-0 검증 코어까지는 못 든 것. URL은 실재·신뢰 가능하나 **별도 확인 권장**. |
| 🧠 **엔지니어링 판단** | 리서치 범위 밖. 내 도메인 지식 기반 설계·추천. 구현 전 검증 필요. |

---

## 0. TL;DR — 먼저 읽을 3가지

1. ✅ **데이터 소스는 HRRR로 확정.** 2026년 신모델 RRFS(3km 북미 전역)가 NAM·HREF·SREF·HiresW를 은퇴시키지만 **HRRR는 대체하지 않고 계속 운영**된다. HRRR(3km·매시간·convection-allowing)를 무료·익명 AWS 버킷 `noaa-hrrr-bdp-pds`에서 **Herbie**로 byte-range 서브셋하는 것이 $0 MVP의 정답. 현재 NAM을 쓰고 있다면 **HRRR로 갈아타는 것 자체가 업그레이드**이고, RRFS 정식 운영(현재 pre-operational, ~2026-10 예상) 후 RRFS로 다시 이전하면 된다.

2. ⚠️ **가장 중요한 전략적 발견 — WindNinja는 당신의 use case와 정면으로 어긋난다.** 지형 다운스케일 도구 WindNinja는 **mechanical(지형에 의한 기계적) 바람** 전용이다. Santa Ana(offshore/downslope)에서는 peer-review로 +13% 정확도 개선이 검증됐지만, **sea-breeze·marine layer·Catalina eddy 같은 thermal 순환은 명시적으로 모의하지 않아 "정확도가 심각하게 저하될 수 있다"**고 공식 문서가 경고한다. 그런데 당신의 핵심 사용 사례(San Pedro/Cabrillo 해풍)가 바로 그 sea-breeze regime이다. → **결론: 해풍 신호는 이미 3km HRRR 안에 들어있다.** 지형 다운스케일의 실질 가치는 "해풍을 새로 만드는 것"이 아니라 **Palos Verdes wind shadow / 채널링**을 표현하는 데 국한된다.

3. 🧠 **windy.app의 "인상적인 그림"의 정체.** windy가 보여주는 색+파티클 애니메이션은 대부분 **원본 NWP 모델 출력을 WebGL로 렌더링**한 것이지, 무료 이용자에게 로컬 CFD 지형 다운스케일을 돌려주는 게 아니다. 즉 **그 "비주얼"은 HRRR + WebGL wind layer만으로 $0에 재현 가능**하다. 지형 다운스케일(WindNinja)은 "windy를 넘어서는" 야심이고, 거기서 위 2번 caveat가 걸린다. → **MVP는 "HRRR을 예쁘게 렌더링"부터, 지형은 나중에 선택적으로.**

---

## 1. 기상 데이터 (NWP) — Q1

### 1-1. 2026년 모델 지형도: RRFS가 NAM을 은퇴시킨다 (그러나 HRRR는 남는다) ✅

- ✅ **RRFS(Rapid Refresh Forecast System)** 가 **NAM · HREF · SREF · HiresW · NAM MOS를 대체·은퇴**시킨다. 근거: NWS Service Change Notice **SCN 26-47**("Termination of the NAM, SREF, HREF, HiresW, and NAM MOS", 2026-05-12 서명) + **SCN 26-48**(RRFS/REFS Implementation) + NOAA GSL. 
- ✅ **HRRR는 대체되지 않는다.** NOAA GSL 원문: *"RRFSv1 is intended to replace several operational models while **complementing the HRRR, which will remain in operations**."* → "RRFS가 HRRR를 대체했나?"의 답은 **아니오**.
- ✅ **RRFS 사양**: **3km, 북미 전역**(CONUS·캐나다·알래스카·하와이·멕시코·중미·카리브 + 인접 해역, SoCal 연안·해상 포함). **매시간 18h 예보 + 00/06/12/18 UTC마다 84h 예보**(NAM Nest 60h·HRRR 48h보다 김). 사실상 HRRR의 해상도·rapid-refresh + NAM의 도메인을 통합.
- ✅ **전환 시점 주의(time-sensitive)**: 당초 **2026-08-31 12 UTC** 예정이었으나 보고상 **~2026-10-06으로 연기**. 리서치 시점(2026-07-11)에는 RRFS가 아직 **pre-operational**(para/실험 데이터만 ~2026-06-09부터 NOMADS 제공). ⚠️ "8/31 확정"이라는 claim은 검증에서 **반증됨** — 날짜는 유동적이니 못 박지 말 것.
- **→ 실무 함의**: 지금 NAM을 쓰고 있다면, ① **당장 HRRR로 이전**(더 고해상도·고빈도), ② RRFS 정식 운영 뒤 **RRFS로 재이전**(NAM 도메인 + HRRR급 해상도). NAM은 아직 살아있지만 은퇴 예정이므로 신규 파이프라인을 NAM에 묶지 말 것.

### 1-2. HRRR = MVP의 데이터 소스 ✅

- ✅ **HRRR**: *"3-km resolution, hourly updated, cloud-resolving, convection-allowing"* (rapidrefresh.noaa.gov). 지형 다운스케일의 고해상도 mesoscale 입력으로 적합.
- ✅ **완전 무료·익명 접근**: AWS Open Data 버킷 `arn:aws:s3:::noaa-hrrr-bdp-pds` (region **us-east-1**), *"No AWS account required"*. NODD 버킷이라 **egress도 무료**(Amazon Sustainability Data Initiative 부담), 소규모 파이프라인에 실질 rate cap 없음.
  - 익명 확인: `aws s3 ls --no-sign-request s3://noaa-hrrr-bdp-pds/`
- ✅ **Herbie**로 byte-range GRIB2 서브셋(전체 파일 다운로드 없이 필요한 변수·영역만). Herbie는 2026년까지 활발히 유지보수(stable 2026.3.0).

### 1-3. 데이터 소스 비교표

| 모델/소스 | 해상도 | 갱신 | Horizon | 바람 변수 | 접근(무료) | 검증 |
|---|---|---|---|---|---|---|
| **HRRR** | 3 km | 매시간 | 48 h (00/06/12/18Z), 그 외 18 h | 10 m U/V(UGRD/VGRD), GUST, 80 m | AWS `noaa-hrrr-bdp-pds`(익명) · NOMADS grib filter · Herbie | ✅ |
| **RRFS** (신규) | 3 km | 매시간 | 18 h + 84 h(synoptic) | 10 m U/V, gust 등 | AWS `noaa-rrfs` · NOMADS(para) | ✅ 사양 / ⏳ pre-op |
| **NAM / NAM-Nest** | 12 km / 3 km nest | 6 h | 84 h / 60 h | 10 m U/V, gust | NOMADS · AWS | ✅ **은퇴 예정** |
| **GFS** | ~13 km(global) | 6 h | 384 h | 10 m U/V, gust, 다층 | NOMADS · AWS `noaa-gfs-bdp-pds` · Open-Meteo | 📎 |
| **NBM** | ~2.5 km | 매시간 | ~264 h | 10 m wind, gust(통계 blend) | NOMADS · AWS | 🧠 |
| **RAP** | 13 km | 매시간 | 21–51 h | 10 m U/V | NOMADS · AWS | 🧠 |
| **ECMWF Open Data (IFS/AIFS)** | 0.25° | 6–12 h | 240 h | 10 m U/V, gust | data.ecmwf.int(무료·open) · Herbie | 🧠 |
| **Open-Meteo API** | 모델별 | 모델별 | 모델별 | 10 m/80 m wind, gust(JSON) | open-meteo.com(키 불필요, 비상업 무료) | 📎 |

> 📎/🧠 표기 행은 이번 리서치에서 3-0 검증까지는 안 됐지만, HRRR/RRFS 대비 널리 알려진 사양. GFS·Open-Meteo는 소스를 fetch함(아래 소스 목록).

**Open-Meteo 특기(📎)**: GRIB을 직접 안 만지고 **위경도 한 점의 wind JSON을 즉시** 받는 가장 빠른 길. `https://api.open-meteo.com/v1/gfs?latitude=33.71&longitude=-118.29&hourly=wind_speed_10m,wind_direction_10m,wind_gusts_10m`. HRRR 기반 값도 지원. **Phase 0 프로토타이핑·검증에 최적**, 단 격자 필드(래스터) 전체가 아니라 point 값 중심이라 "지도 전체 색칠"에는 GRIB 파이프라인이 필요.

---

## 2. 지형 / 고도 데이터 — Q2

- ✅ **py3dep** (HyRiver 스택): USGS **3DEP** 고도 데이터를 The National Map 웹서비스로 프로그램적 접근. `get_dem`, `elevation_bycoords`, `elevation_bygrid`, `elevation_profile`.
  - ✅ **CONUS 전역 최고 해상도 ~10 m**. **1 m lidar는 일부 지역만**(전국 아님). South Bay/PV는 lidar coverage가 좋은 편(별도 확인).
  - ✅ **주의**: py3dep는 현재 **maintenance-only**(최신 v0.19.0, 2025-01-18). HyRiver가 **후속 패키지 `Seamless3DEP` 사용을 권장**. 신규 코드는 Seamless3DEP로.
  - ⏳ USGS **Seamless 1 m DEM(S1M)** 이 2025년부터 타일별 발행 중 → 향후 "10 m 상한"이 갱신될 예정.
- 🧠 **표면 거칠기(roughness length z0)**: **NLCD**(National Land Cover Database, MRLC) land cover → z0 lookup table로 변환하는 것이 표준. WindNinja는 land cover/vegetation 입력을 직접 받아 거칠기를 내부 처리할 수 있음(도시=거침, 수면=매끈). 해안 도시-바다 경계의 거칠기 대비가 South Bay 바람에 큰 영향.
- 🧠 대안 DEM: **Copernicus GLO-30**(전지구 30 m, 무료), **SRTM**(30 m, 구형). 미국 내라면 3DEP 10 m가 우월.

---

## 3. 다운스케일링 방법 — Q3 (프로젝트의 승부처)

### 3-1. WindNinja — 사양과 검증된 정확도 ✅

- ✅ **WindNinja**(USFS diagnostic wind model): **~100–200 m 해상도, 최대 50×50 km 도메인**에서 **mechanical terrain modification**(부차적으로 diurnal slope wind)이 지배하는 바람을 다운스케일. 사용자의 ~100–250 m 목표와 부합. 50×50 km면 South Bay(~20–30 km)를 충분히 커버.
- ✅ **17개 NCEP mesoscale 모델로 초기화** 가능 — 표에 **NOMADS-HRRR-CONUS-3-KM**, **NOMADS-NAM-NEST-CONUS-3-KM** 명시(NOAA NOMADS·UCAR THREDDS에서 수신). 즉 **HRRR로 초기화해 미래 시점의 terrain-aware 예보 생성 가능**. 최신 버전은 HRRR pastcast/extended, RAP extended, NBM도 추가.
- ✅ **두 솔버**:
  - **mass-conserving**(질량 보존, finite-element): 빠름. Seto 2025가 채택.
  - **mass-and-momentum**(OpenFOAM CFD: finite volume, k-epsilon 난류, simpleFoam/SIMPLE): 더 정확할 수 있으나 **~60배 느림**.
- ✅ **속도**: Seto 2025는 mass 솔버 + 250 m GMTED 지형 + 500 m 격자로 **대형 SoCal 도메인 6h 예보를 표준 데스크톱/VM에서 ~10분**에 생성. → 시간별 cron으로 충분히 돌릴 수 있는 비용.
- ✅ **peer-review 검증 정확도(Seto et al. 2025, AMS Weather & Forecasting 40:525-541)**: HRRR 3km → WindNinja 500 m 다운스케일이 **6개 SoCal Santa Ana 이벤트에서 ~1000개 SCE mesonet 관측 대비 전체 정확도 평균 +13%, 관측소 71.6%에서 개선**.
  - ✅ **단, 한계**: 고풍속·wind-prone lee-slope canyon에서는 skill 저하, 음의 풍속 bias 오히려 증가. mass-consistent 솔버가 lee측 풍속을 축소하고 mountain wave/downslope windstorm을 모의 못 함 — Santa Ana peak가 lee slope에서 나므로 중요한 제약.

### 3-2. ⚠️ 결정적 caveat — sea-breeze regime ✅

- ✅ **WindNinja 공식 Tutorial 원문**: *"In situations where other factors become important (**larger scale processes, sea-breeze, cloud dynamics**, etc.) WindNinja's accuracy **can severely degrade** since it does not explicitly simulate these effects."*
- 즉 **SoCal marine layer · sea breeze · Catalina eddy**(= "larger scale processes")는 WindNinja가 **생성하지 못한다**. 위 +13%는 **Santa Ana(offshore) 한정** 수치이고 **해풍 regime에 그대로 적용 불가**.
- **다만** HRRR로 초기화하면 해풍이 **3km 입력장에서 상속(inherited)** 되므로 완전히 사라지진 않는다. WindNinja는 그 위에 지형 채널링·shadow만 얹는다. → **해풍의 "존재·타이밍"은 HRRR가, 지형에 의한 "국소 강약·방향 꺾임"은 WindNinja가.** 그러나 해풍 상황에서의 정량 정확도는 이번 검증에서 확인되지 않음.

### 3-3. Python 통합 📎

- ✅ **gagreene/WindNinja**(third-party Python): WindNinja **CLI를 subprocess로 호출**하는 wrapper(config 생성 + 실행). **공식 엔진 아님**, 별도 WindNinja CLI 설치 필요(공식 엔진은 firelab/windninja C++).
  - ✅ "이 wrapper가 weather-model 초기화를 노출 안 해서 HRRR/NAM 그리드 초기화 불가"라는 claim은 **반증됨** → weather-model 초기화 지원 가능성 있음. **코드로 직접 확인 권장.**

### 3-4. 대안 다운스케일링 방법 🧠 (미검증 — 후속 조사 필요)

이번 리서치에서 정량 검증된 건 WindNinja뿐. 아래는 참고용:
- **log-profile + roughness 조정**: 가장 단순. 관측/모델 기준고도 바람을 z0·안정도로 다른 고도·거칠기에 사상. 해안 거칠기 대비 표현에 유용하나 지형 채널링은 못 함.
- **Winstral Sx exposure index**: DEM 기반 지형 노출도(풍상측 차폐)로 상대적 강약 보정. 가볍고 GPU/래스터 친화적 — **$0 MVP의 "가짜 지형 효과"로 쓰기 좋음**(물리 아님, 경험적).
- **CALMET-style mass-consistent**: WindNinja와 유사 계열.
- **WRF / RASP(DrJack soaring)**: full mesoscale — 무겁고 $0 self-host엔 부적합. **활성 SoCal RASP 존재 여부는 미확인**(후속 조사).
- **ML super-resolution(wind GAN/diffusion, NVIDIA CorrDiff)**: 최신 연구 흐름. 사전학습 가중치·연산 비용·SoCal 적용성 모두 미확인. 장기 옵션.

---

## 4. Python 파이프라인 생태계 — Q4

| 도구 | 역할 | 상태 |
|---|---|---|
| **Herbie** | AWS/NOMADS에서 HRRR/RRFS/GFS GRIB2 **byte-range 서브셋** | ✅ 활발히 유지보수(2026.3.0) |
| **xarray + cfgrib** | GRIB2 → labeled N-D array | 📎 (cfgrib는 eccodes 의존, 다변수 파일에서 `filter_by_keys` 필요 — issue #63 참조) |
| **wgrib2 / pygrib** | GRIB 저수준 조작·추출 | 🧠 |
| **MetPy** | 기상 계산(풍속·풍향·단위) | 🧠 |
| **rioxarray / rasterio** | DEM(GeoTIFF) 입출력·재투영 | 🧠 |
| **py3dep → Seamless3DEP** | USGS 3DEP DEM 취득 | ✅ (py3dep maintenance-only) |
| **xESMF / pyresample** | 격자 간 regridding(모델↔지형 격자 정합) | 🧠 |

**gotcha 📎**: cfgrib는 한 GRIB 파일에 여러 `typeOfLevel`/변수가 섞이면 한 번에 못 읽고 `filter_by_keys`로 쪼개야 함(ecmwf/cfgrib#63). Herbie의 `.xarray()`가 이 필터링을 상당 부분 감싸줌.

---

## 5. 시각화 렌더링 (windy 스타일) — Q5 📎

> ⚠️ 이 섹션의 개별 claim은 3-0 검증을 통과하지 못함. 아래 URL은 리서치가 **fetch·primary 평가**한 실재 소스 + 🧠 엔지니어링 지식.

- 🧠 **핵심 기법 = "U/V를 텍스처로 굽고 GPU 파티클 시뮬레이션"**. 두 원조:
  - **mapbox/webgl-wind**(Vladimir Agafonkin) — U/V 바람 성분을 **PNG(R=U, G=V)로 인코딩**, fragment shader로 수만 개 파티클 이류. windy식 애니메이션의 레퍼런스. (blog.mapbox.com/how-i-built-a-wind-map-with-webgl 📎)
  - **cambecc/earth**(earth.nullschool.net) — Canvas 파티클 + d3 투영. (github.com/cambecc/earth 📎)
- 📎 **바로 쓸 라이브러리**:
  - **leaflet-velocity**(onaci) — 가장 쉬움. **grib2json 포맷 U/V JSON**을 먹여 Leaflet 위 애니메이션. **MVP 1순위.**
  - **sakitam-fdd/wind-layer** — WebGL, Mapbox GL·OpenLayers·Leaflet·Maptalks 어댑터. 더 현대적·고성능.
  - **WeatherLayers GL**(weatherlayers.com/open-source) — deck.gl 기반, 파티클 + **color raster overlay**(색칠) 둘 다. 오픈소스 코어 + 상업 Cloud 티어. **"windy 비주얼"에 가장 근접.**
  - **danwild/wind-js-leaflet** — leaflet-velocity + 서버 예제(참고용 클론).
- 🧠 **브라우저용 데이터 포맷**:
  - **grib2json**(cambecc) — GRIB2 → leaflet-velocity/earth가 먹는 JSON. 고전이지만 Java 의존.
  - **PNG-encoded U/V raster** — webgl-wind 방식. 컴팩트·GPU 친화. 도메인이 작으면(South Bay) 타일 몇 장이면 끝.
  - **Zarr 타일** — 도메인·시간 축이 커질 때.

---

## 6. $0 아키텍처 — Q6 📎🧠

> 📎 GitHub Actions billing·PMTiles 소스 fetch됨. 쿼터 수치는 🧠 일반 지식 — 배포 전 현재 무료 티어 재확인 권장.

- 🧠 **GitHub Actions(cron)**: private repo **2,000분/월 무료**, **public repo 무제한**. HRRR가 시간별이므로 hourly cron 적합. HRRR 서브셋은 수 초, WindNinja 6h 다운스케일은 소도메인이면 ~수 분(Seto 기준 ~10분/대형도메인) → **public repo면 넉넉**. 단 **long-lived 서버 불가**(배치/cron 전용) — windy식 "미리 구워 정적 서빙"과 정확히 맞음.
- 🧠 **정적 호스팅**:
  - **Cloudflare Pages**(무료: 대역폭·요청 무제한, 500 builds/월) — 대역폭 때문에 **Pages 권장**.
  - **Cloudflare R2**(무료: 10 GB 저장, 1M Class-A + 10M Class-B ops/월, **egress 0원**) — PNG/JSON 바람 타일 서빙에 이상적.
  - **GitHub Pages**(무료, ~1 GB / ~100 GB·월 soft) — 가장 간단, 소규모면 충분.
- 📎 **PMTiles**(protomaps) — 단일 파일 벡터/래스터 타일을 R2/Pages에 얹어 서버리스 서빙(map 배경·타일에 유용).
- 🧠 **기존 windy-clone 프로토타입**: wind-js-leaflet, webgl-wind 포크들이 참고감. **"$0 + 지형 다운스케일"까지 하는 완성 클론은 사실상 없음 → 그게 이 프로젝트의 신규성.**

---

## 7. 관측 검증 데이터 (South Bay) — Q7 📎

> 📎 아래 스테이션 URL은 리서치가 fetch·primary 평가. 자동수집 API 세부는 별도 확인 권장.

| 소스 | 위치/ID | 제공 | 접근 |
|---|---|---|---|
| **NDBC 부이 46025** | Santa Monica Basin(South Bay 앞바다) | 실시간 풍속·풍향·gust | ndbc.noaa.gov(무료, txt/API) 📎 |
| **NOS CO-OPS 9410660** | **Los Angeles(LA Harbor / San Pedro)** — 사용자 스팟 바로 옆 | 기상(바람) 센서 | tidesandcurrents.noaa.gov CO-OPS Data API(무료) 📎 |
| **METAR KTOA** | **Zamperini Field, Torrance**(사용자 동네) | 정시 풍향·풍속·gust | aviationweather.gov Data API(무료) 📎 · KLAX/KLGB도 |
| **CDIP** | Santa Monica Bay 등 | 주로 파랑, 일부 바람 | cdip.ucsd.edu 🧠 |
| **iWindsurf / WeatherFlow** | wx.iwindsurf.com/spot/405(South Bay 스팟) | 스팟 관측·예보 | 뷰는 무료, **프로그램적 접근은 제한/상업** 📎 |
| **Tempest(WeatherFlow)** | 개인 스테이션 | 실시간 | **본인 스테이션은 무료 API**, 타 스테이션 제한 🧠 |

**검증 전략 🧠**: HRRR(및 WindNinja 출력)의 10m 바람을 KTOA METAR + CO-OPS 9410660(San Pedro) + NDBC 46025(앞바다)와 시계열 비교. 특히 **오후 해풍 onset 타이밍**과 **PV 풍하(Cabrillo)에서의 감쇠**를 관측으로 확인 — 이게 지형 다운스케일이 실제로 값을 더하는지 판정하는 핵심 지표.

---

## 8. 추천 $0 MVP 아키텍처 🧠

```
┌─────────────────────────────────────────────────────────────────┐
│  GitHub Actions (public repo, hourly cron)                        │
│                                                                   │
│  1) Herbie → noaa-hrrr-bdp-pds (익명) : South Bay bbox의          │
│     10m U/V·GUST만 byte-range 서브셋  (수 초)                      │
│         ↓  xarray/cfgrib                                           │
│  2) [Phase 3+] WindNinja mass solver, HRRR init,                  │
│     3DEP 10m DEM + NLCD roughness, 20×20km @ ~200m  (~수 분)       │
│         ↓                                                          │
│  3) U/V → 브라우저 포맷으로 굽기:                                   │
│       · leaflet-velocity용 grib2json JSON  (MVP)                   │
│       · 또는 PNG-encoded U/V raster (webgl-wind/WeatherLayers)     │
│         ↓  git commit / R2 upload                                 │
├─────────────────────────────────────────────────────────────────┤
│  Cloudflare Pages(정적 사이트) + R2(바람 타일, egress 0원)         │
│       · MapLibre/Leaflet 지도 + WeatherLayers GL / leaflet-        │
│         velocity 파티클·color overlay                              │
│       · 시간 슬라이더(예보 프레임)                                  │
└─────────────────────────────────────────────────────────────────┘
   검증: KTOA METAR · CO-OPS 9410660 · NDBC 46025 시계열 대조
```

---

## 9. 단계별 로드맵 🧠

- **Phase 0 — 점 예보 스모크 테스트 (반나절).** Open-Meteo API로 San Pedro 위경도 바람 JSON을 받아 그래프. 파이프라인 감 잡기, 지형·GRIB 없이.
- **Phase 1 — HRRR 한 장 렌더 (핵심 마일스톤).** Herbie로 South Bay HRRR 10m U/V 서브셋 → matplotlib `quiver`/`barbs`로 한 시각 바람장 plot. **"HRRR를 읽어 South Bay 바람 한 장"** 달성.
- **Phase 2 — windy식 인터랙티브 웹 (비주얼 완성).** U/V → grib2json 또는 PNG → leaflet-velocity/WeatherLayers로 파티클+색. GitHub Actions hourly cron + Cloudflare Pages/R2로 자동 갱신 정적 사이트. **이 시점에서 이미 "내 무료 windy"** — 지형 다운스케일 없이 HRRR 3km만으로도 실용적(해풍 신호 이미 포함).
- **Phase 3 — 지형 다운스케일 (차별화).** 3DEP 10m DEM + NLCD → WindNinja(mass solver, HRRR init)로 South Bay ~200m 다운스케일. **PV wind shadow / Cabrillo 채널링** 표현. gagreene wrapper 또는 CLI 직접.
- **Phase 4 — 검증·튜닝.** KTOA/CO-OPS/NDBC 관측 대조로 해풍 정확도 정량화. WindNinja가 값을 더하는 조건(예: NW 스웰·특정 풍향) vs. HRRR raw가 나은 조건을 구분해 **regime별로 소스 선택**. 필요시 Winstral Sx 같은 경량 보정 실험.

**의사결정 원칙**: 해풍이 주도하는 날은 **HRRR raw로 충분**할 가능성이 높다. WindNinja는 "PV 지형이 흐름을 막고 꺾는" 국소 효과에 투자하는 것 — Phase 4 검증으로 **정말 값을 더하는지 데이터로 확인한 뒤** 복잡도를 늘려라. 처음부터 CFD로 가지 말 것.

---

## 10. 미검증 / 반증 / 후속 조사

**검증에서 반증된(refuted) claim** — 사실로 취급하지 말 것:
- ❌ "NAM 은퇴 = 2026-08-31 확정" — 날짜 유동적(~10월로 연기), pre-operational 단계.
- ❌ "gagreene wrapper는 weather-model 초기화 불가" — 반증됨(지원 가능성 있음, 코드 확인).

**후속 1차 조사 필요(open questions)**:
1. 시각화 스택 최종 선택(leaflet-velocity vs sakitam vs WeatherLayers)과 U/V 포맷(grib2json vs PNG vs zarr) 실측 비교.
2. GitHub Actions 무료 티어에서 WindNinja hourly 지속 운영 실쿼터 검증 + 참고할 오픈소스 클론.
3. South Bay 관측 API(NDBC/CO-OPS/METAR/iWindsurf) 자동수집 실접근성·무료 범위.
4. sea-breeze regime에서 WindNinja 외 대안(log-profile, Winstral Sx, RASP, ML super-resolution)의 정량 해풍 정확도.

---

## 11. 소스 목록 (fetch·평가 완료, 28)

**Q1 NWP (정부·1차 중심)**
- SCN 26-47 (NAM 등 은퇴): https://www.weather.gov/media/notification/pdf_2026/scn26-47_Retirement_of_NAM_SREF_HREF_HiresW_NAM_MOS.pdf
- SCN 26-48 (RRFS/REFS 구현): https://www.weather.gov/media/notification/pdf_2026/scn26-48_RRFS_and_REFS_Implementation.pdf
- NOAA GSL RRFS: https://gsl.noaa.gov/rrfs/
- AWS HRRR Open Data: https://registry.opendata.aws/noaa-hrrr-pds/
- GribStream RRFS/REFS 해설: https://gribstream.com/blog/noaa-rrfs-refs-operational-august-2026

**Q2–3 지형·다운스케일 (1차)**
- Seto et al. 2025 (peer-review, HRRR→WindNinja SoCal 검증): https://www.fs.usda.gov/rm/pubs_journals/2025/rmrs_2025_seto_d001.pdf
- WindNinja 공식: https://research.fs.usda.gov/firelab/products/dataandtools/windninja
- WindNinja Tutorial 4 (초기화·해풍 caveat): https://firelab.github.io/windninja/pdf/WindNinja_tutorial4.pdf
- WindNinja solver 문서: https://firelab.github.io/windninja/internal/whatis/solver.html
- py3dep (3DEP DEM): https://github.com/hyriver/py3dep
- gagreene/WindNinja (Python wrapper): https://github.com/gagreene/WindNinja/

**Q4 Python 파이프라인**
- Herbie: https://github.com/blaylockbk/Herbie
- Open-Meteo GFS API: https://open-meteo.com/en/docs/gfs-api
- Open-Meteo open-data: https://github.com/open-meteo/open-data
- cfgrib multi-field gotcha: https://github.com/ecmwf/cfgrib/issues/63

**Q5 시각화**
- Mapbox WebGL wind (기법 원조): https://blog.mapbox.com/how-i-built-a-wind-map-with-webgl-b63022b5537f
- mapbox/webgl-wind: https://github.com/mapbox/webgl-wind
- WeatherLayers open-source: https://weatherlayers.com/open-source.html
- sakitam-fdd/wind-layer: https://github.com/sakitam-fdd/wind-layer
- onaci/leaflet-velocity: https://github.com/onaci/leaflet-velocity
- cambecc/earth (nullschool): https://github.com/cambecc/earth

**Q6 $0 아키텍처**
- danwild/wind-js-leaflet: https://github.com/danwild/wind-js-leaflet
- PMTiles 서버리스 논의: https://github.com/protomaps/PMTiles/discussions/289
- GitHub Actions billing: https://docs.github.com/billing/managing-billing-for-github-actions/about-billing-for-github-actions

**Q7 관측 검증**
- NDBC 46025: https://www.ndbc.noaa.gov/station_page.php?station=46025
- NOS CO-OPS 9410660 (San Pedro): https://tidesandcurrents.noaa.gov/met.html?id=9410660
- Aviation Weather (METAR) API: https://aviationweather.gov/data/api/
- iWindsurf spot 405: https://wx.iwindsurf.com/spot/405

---

*리서치 통계: 6 angles · 28 sources · 134 claims 추출 · 25 verified · 21 confirmed · 9 findings · 4 refuted · 111 agents.*
