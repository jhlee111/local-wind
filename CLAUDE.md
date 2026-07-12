# local-wind

무료 self-hosted windy 스타일 South Bay(SoCal) 로컬 바람 예보 사이트. windsurf/kite/wing foil 용.

- **계획·결정 기록**: [docs/PLAN.md](docs/PLAN.md) — living doc, 작업 전 필독. 마일스톤 M0–M4와 Decision Log(D1–D8).
- **배경 리서치**: [docs/research-wind-forecast.md](docs/research-wind-forecast.md) — 검증된 발견은 ✅, 미검증은 📎/🧠 표기. 근거가 궁금할 때만.
- **구조**: `pipeline/` (Python, uv) + `web/` (Vite + TS + MapLibre + WeatherLayers GL). 아직 미생성이면 PLAN.md 순서대로.

핵심 제약 3줄:
1. **$0 운영** — 무료 티어만(AWS open data 익명, GH Actions public repo, Cloudflare Pages/R2). 유료 키·상시 서버·DB 금지.
2. 데이터는 **HRRR**(Herbie, `noaa-hrrr-bdp-pds`). NAM은 은퇴 예정이라 쓰지 않음. RRFS 정식 운영 후 재평가.
3. **WindNinja는 mechanical 전용** — 해풍(sea breeze)은 못 만든다. 해풍 신호는 HRRR + 스팟 통계보정(M4)으로. 지형 레이어는 M3에서 토글로만, M4 검증 통과 시 정식 채택.
