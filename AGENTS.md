# AGENTS.md

Static GitHub Pages site (`main` branch → https://github.com/alexje76/mbari_dashboard). Buoy wave-energy dashboard. Vanilla JS ES modules + ECharts from CDN. **No build step, no package.json, no tests/lint/typecheck.** Verify changes by loading the pages in a browser.

## Local serving gotcha
All data fetches are root-relative to `/mbari_dashboard` (hard-coded `BASE_PATH` in `js/shared/dataFetcher.js` and `js/pages/selector.js`). Pages will 404 when opened via `file://` or a plain `python -m http.server`. To test locally, serve the repo mounted at `/mbari_dashboard` (serve a parent directory or route the path). Keep `BASE_PATH` as-is when adding fetches.

## Architecture
- One HTML page per view: `index.html` (homepage), `selector.html`, `power.html`, `nextwave.html`. Each page loads the ECharts CDN script **classic** (no `type="module"`), then shared modules, then `js/pages/<page>.js`.
- `js/shared/` = `dataFetcher.js` (manifest + per-day CSV fetch/cache/parse/downsample), `chartUtils.js` (ECharts init, zoom sync, overlays), `colorScheme.js` (colorblind-safe palette), `navigation.js` (hamburger menu).
- `js/utils/urlParams.js` makes views shareable/bookmarkable via query params `start`, `end`, `controllers`, `seaStates` (`hs,tp` pairs joined by `;`), `chartTypes`.
- Charts are created through `initChart(domId, option)` from `chartUtils.js`; controller colors come from `getColor(index)` in `colorScheme.js` (4-color Paul Tol palette). ECharts is read as `window.echarts` (global from CDN), never imported.
- New metrics added to a page must also be registered in `config/chartTypes.json` (drives the Selector page's three chart-type dropdowns) and kept in sync with `SyntheticData/generate_synthetic_data.py`.

## Data model
- `data/YYYY-MM-DD.csv` = minute-resolution rows; `data/overview.csv` = hourly downsample; `data/manifest.json` = `availableDateRange` + `dayFiles` list. Day files are only fetched for dates listed in the manifest.
- CSV columns (accessed by header name: `row.hs`, `row.avg_power`, …): `timestamp_ns`, `timestamp_iso`, `controller`, `hs`, `tp`, `avg_power`, `power_out`, `battery_pct`, `sea_state_energy`, `efficiency`, `peaks`, `nextwave`, `nextwave_error`, `nextwave_error_2`.
- Controllers: `"free response"`, `"controller 1"`, `"controller 2"`. `nextwave` states: `On`, `Starting`, `Off`.

## Regenerating data
`SyntheticData/generate_synthetic_data.py` is the source of truth for `data/*.csv`, `data/manifest.json`, and `config/chartTypes.json` — don't hand-edit those derived artifacts. Run from the repo root:

```
.venv\Scripts\python.exe SyntheticData\generate_synthetic_data.py --output . --days <N> --start 2026-09-05T00:00:00Z --seed 42
```

Default `--output` is `./data_output` (a scratch dir — pass `--output .` to write into the repo). Python 3.14 venv lives in `.venv\` (untracked, no `.gitignore`).

## CI
`.github/workflows/test-auto-update.yml` runs daily (cron + manual dispatch): it fetches `Tester.yaml` from `alexje76/Mbari_Wec_Compare` and auto-commits if changed. `Tester.yaml` is currently a placeholder; this workflow does **not** update the CSVs.

## Legacy / scratch
Do not extend `js/pages/selectorold.js`, `js/shared/chartUtilsold.js`, or `OriginalTesting/` — old versions kept for reference.