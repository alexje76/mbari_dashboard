# Buoy Monitoring Dashboard — Architecture Decisions

## Context
Static website hosted on GitHub Pages, displaying time-series buoy sensor/system data. Real data will arrive hourly from a separate raw ingestion pipeline (not yet built). This site is the read/visualization layer only. Four pages: Homepage (overview), Selector Display (filtered/multi-chart view), Power Usage (battery tracking), Next Wave (experimental data).

---

## Data Pipeline

### Pipeline Overview
A **GitHub Action** ingests raw data (source/format TBD, arrives hourly) and generates static files, committed to the repo.

### Generated Files
- `/data/YYYY-MM-DD.csv` — one file per day, full resolution (1-minute).
- `/data/overview.csv` — downsampled to hourly, spans entire available history.
- `/data/manifest.json` — lists available day-files and the overall min/max available date range, so the frontend knows what data exists without failed fetch attempts.
- `/config/chartTypes.json` — list of available chart types (dynamically read by frontend).
- Dataset **grows over time** (new day-files appended as new data arrives); frontend must treat the available date range as dynamic, not fixed.

---

## CSV Schema (per-row fields)

### Required Fields
- `timestamp_ns` — ROS2-style nanoseconds since epoch (int64), matches `node.get_clock().now().nanoseconds`.
- `timestamp_iso` — human-readable ISO8601 convenience column (e.g., `2026-10-05T12:34:56Z`).
- `controller` — string enum (real telemetry: `free_response`, `stepwise_random_bounded`, `stepwise_integrated_bounded`; synthetic: the same keys prefixed `synthetic_`); dynamically read from CSV, not hardcoded. Persists in multi-hour blocks. `build_dashboard_data.py` maps both key sets to display labels via `CONTROLLER_LABELS` (kept in sync with the synthetic generator's `CONTROLLERS` constant).

### Environmental/Wave Data (persist in ~30-min blocks)
- `hs` — float, 0–3 (wave height, meters).
- `tp` — float, 1–14 (wave period, seconds).

### Power & Energy (per-minute or per-record)
- `avg_power` — float, signed battery-bus power (watts). Negative = discharging from the battery to the power controller; positive = charging.
- `power_in` — float, = `max(avg_power, 0)` (input watts).
- `power_to_controller` — float, magnitude of the discharging half of `avg_power` = `|min(avg_power, 0)|` (watts flowing battery → power controller). Replaces the earlier random 0–600 W `power_out` placeholder.
- `battery_voltage` — float, volts, raw minute-mean of the battery-controller bank voltage (from `BC Voltage`). Stored so the exact charge curve can be swapped later without reprocessing telemetry.
- `battery_pct` — float, 0–100, derived from battery voltage via a **swappable piecewise-linear voltage→SoC curve** for the 288 V lead-acid bank (24 × 12 V, 6 × 2 V cells each; operating range ~288 V depleted → ~325 V float charge). Readings outside the curve span (e.g. transient spikes) map to NaN, not clamped 0/100. Exact charge curve swaps in later.
- `sea_state_energy` — float, J/m² (wave energy density, derived from Hs and Tp using simplified formula: E ≈ 0.5 × Hs² × Tp with random variation).
- `efficiency` — float, 0–100+ % (calculated as `(avg_power / sea_state_energy) × 100`, **not clamped**).

### System State
- `peaks` — int, 1–3 (independent per-minute, or summed hourly for overview).

### Next Wave Prediction (experimental; new columns)
- `nextwave` — string enum, e.g., `On`, `Starting`, `Off` (state that persists for 30–120 min blocks).
- `nextwave_error` — float, RMS value, typically 0–~1500 (prediction error metric).
- `nextwave_error_2` — float, 0–~1000, lower is better (secondary error metric).

**Important:** All numeric columns (except `timestamp_ns`, `timestamp_iso`, and `controller`) are treated as potential chart types. No chart type is hardcoded; all are read from `chartTypes.json`. Controller values are not hardcoded; all unique values from the CSV are treated as valid controllers.

---

## Data Generation (Testing)

Two paths produce the same CSV schema and `chartTypes.json`:

### Script: `SyntheticData/generate_synthetic_data.py`
Python script for synthetic minute-resolution telemetry. Usage:

```bash
.venv\Scripts\python.exe SyntheticData\generate_synthetic_data.py \
  --start "2026-09-05T00:00:00Z" \
  --days 60 \
  --seed 42 \
  --output .
```

**Outputs:**
- `./data/YYYY-MM-DD.csv` — daily files
- `./data/overview.csv` — hourly downsampled
- `./data/manifest.json` — manifest
- `./config/chartTypes.json` — chart types config
- `./controller_logs/controller_logs.csv` — controller-block events (`build_dashboard_data.py` input)

**Generation Logic:**
- **Hs & Tp:** Drifting log-space mean reversion (smooth, positively skewed sea states).
- **Avg power:** Uniform -30 to 200 W per controller; `power_in`/`power_to_controller` are the positive/negative halves (`power_in = max(avg_power, 0)`, `power_to_controller = |min(avg_power, 0)|`).
- **Battery Pct:** Synthetic sawtooth — smooth discharge (0.005–0.035% per min) with periodic charging cycles (every 12–20 hrs, lasting 2–5 hrs). Emits `battery_voltage` consistent with the sawtooth via `percent_to_voltage()`, the inverse of the same `LEAD_ACID_BANK_SOC_CURVE` table (duplicated in both generators; keep in sync).
- **Sea State Energy:** `0.5 × Hs² × Tp × random(0.9, 1.1)`.
- **Efficiency:** `(avg_power / sea_state_energy) × 100`, unclamped.
- **NextWave State:** Cycles between On/Starting/Off, stays per state 30–120 min.
- **NextWave Errors:** Smooth variation with occasional spikes.
- **Peaks:** Random 1–3 per minute (summed to `peaks_total` per hour in overview).
- **Controller blocks & logs:** The per-minute `controller` sequence (30 min–24 hr blocks; controllers = real keys with a `synthetic_` prefix) is compressed into `controller_logs/controller_logs.csv` — one event at each block's start minute (`event` = `start`/`controller_switch`, `wall_epoch_seconds` = `ros_seconds` = start epoch + 60·minute-index). Emitting only block-start rows keeps the logs consistent with `data/*.csv` by construction and lets the real pipeline's `controller_by_minute` reconstruct the exact sequence when it ingests them.

### Script: `build_dashboard_data.py`
Real ingestion pipeline (the "GitHub Action" step): reads raw telemetry CSVs (10 Hz power samples, one row per Source ID) plus controller event logs, aggregates to complete minutes, and writes the same outputs. Key mappings:
- `avg_power` = `PC Bus Voltage × (PC Battery Curr + PC Load Dump Current)` (signed by current direction).
- `battery_voltage` = minute mean of `BC Voltage` (Battery Controller, Source ID 0).
- `battery_pct` = `voltage_to_percent(BC Voltage)` — piecewise-linear lead-acid curve, swappable via the `LEAD_ACID_BANK_SOC_CURVE` table at the top of the file. Values outside the curve span become NaN (sanity filter for the observed 141 V transient spikes).
- `power_in` / `power_to_controller` split as above.
- Wave and NextWave loaders are placeholders until their raw schemas are known.

**Raw telemetry field mapping** (`TELEMETRY_COLUMNS`, Source ID → controller):

| Source ID | Controller | Fields used |
|---|---|---|
| 0 | Battery Controller (BC) | `BC Voltage` → `battery_voltage`, `battery_pct` (from `BCRecord.voltage`, `/battery_data` — total bank voltage) |
| 2 | Power Controller (PC) | `PC Bus Voltage (V)`, `PC Battery Curr (A)`, `PC Load Dump Current (A)` → `avg_power` |
| 3 | XB (AHRS / GPS) | none |
| 4 | Trefoil (TF) | none (`TF Batt Volt` ≈ 48 V is the trefoil's own instrument battery, **not** the main bank — not used) |

`Timestamp (epoch seconds)` drives minute bucketing (and `Source ID` row dedup only).

---

## Hosting & Backend
- **Static hosting only** — GitHub Pages. No server/API/database.
- All filtering, downsampling, and range selection logic lives in the frontend.
- Frontend must fetch only the day-files needed for a given view (not the whole dataset).

---

## Frontend Charting Library
- **ECharts** — chosen for performance on large time series, built-in `dataZoom` (brushing/zooming), and support for scatter/line/area chart needs.
- **CDN delivery:** ECharts 5.4.3+ via jsDelivr CDN (no npm/bundler required).
  - Script tag: `<script src="https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js"></script>`
  - Rationale: GitHub Pages static hosting, no build step, simpler deployment.
  - Fallback: if CDN is unavailable, charts will not render; frontend gracefully degrades.

### JavaScript Module Strategy
- **Vanilla ES6 modules** (no transpiler needed).
- All modules load via `<script type="module" src="..."></script>` in HTML.
- Each module uses `export` for public functions, `import` for dependencies.
- Rationale: Keep stack simple, no build tooling, works directly in browser.

### CSV Parsing Strategy
- **Manual string parsing** (no PapaParse or external CSV library).
- Simple `split('\n')` → `split(',')` logic in `dataFetcher.js`.
- Handles quoted fields and escaping as needed.
- Rationale: Schema is well-defined and stable; no need for heavy parser.

---

## Page/Date-Range Model — **Option B: Independent per-page state**
- Each page has its **own** date-range picker and its **own** local state (not shared/global across pages).
- Each page's range is reflected in its own URL query params (e.g., `/selector?start=...&end=...`) so views are independently bookmarkable/shareable.
- No global/shared date-range store. Shared utility functions (date-picker component, day-file fetch/cache, chart utilities) are reused, but state itself is per-page.
- **URL params update on page navigation or view close, not in real-time** (avoids excessive history rewrites).
- Rationale: simpler mental model, avoids cross-page state bugs, allows different pages to be pinned to different time windows simultaneously, and keeps each page fully self-contained.

---

## Navigation Model
- **Hamburger menu** (☰) in top-left corner on all pages.
- Menu opens a dropdown/drawer listing all 4 pages: Homepage, Selector Display, Power Usage, Next Wave.
- Menu is accessible from any page and links to any other page.
- Menu state (open/closed) is local to each page; no global state shared.
- **Shared implementation:** Navigation menu rendered by imported JavaScript module (`/js/shared/navigation.js`).

---

## Site Structure & Pages

### Homepage (`index.html`)
**Purpose:** Overview of long-term deployment; quick visual scan of power, efficiency, and sea state activity.

**Layout (Desktop):**
```
┌─────────────────────────────────────────────────────┐
│ ☰  Buoy Dashboard                                   │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Left (60%)           │     Right (40%)             │
│  ─────────────────    │  ──────────────             │
│  Large Graph 1        │  Active Controller List     │
│  (Avg Power)          │  ────────────────           │
│  [Line/area, linked]  │  ● Controller 1 (active)   │
│                       │  ◯ Controller 2 (off)      │
│  Large Graph 2        │  ◯ Free Response (off)     │
│  (Efficiency)         │                             │
│  [Line/area, linked]  │  [Controller colors match   │
│                       │   graph vertical bars]     │
│  Small Graph 3        │                             │
│  (Hs scatter)         │                             │
│  [Scatter, linked X]  │                             │
│  Height: 1/3 of large │                             │
│                       │                             │
│  Small Graph 4        │                             │
│  (Tp scatter)         │                             │
│  [Scatter, linked X]  │                             │
│  Height: 1/3 of large │                             │
│                       │                             │
│  Bottom: Sea State Scatter                          │
│  X-axis: Tp           │                             │
│  Y-axis: Hs           │                             │
│  All states: black    │                             │
│  Colored by           │                             │
│  controller activity  │                             │
│  [Axis labels only]   │                             │
│                       │                             │
│  Date Range Picker:                                 │
│  [Default: All Available Data]                      │
└─────────────────────────────────────────────────────┘
```

**Key Specifications:**
- **Large graphs (Avg Power, Efficiency):** time-series line/area charts, linked X-axis zoom only (Y independent).
- **Small graphs (Hs, Tp):** scatter plots, same X-axis linked zoom.
- **Vertical color bars:** Full-height colored bands behind each chart indicating which controller was active during that time range. *(Not yet built.)*
- **Controller list:** Shows all controllers dynamically (read from CSV); one indicator light (● for active, ◯ for inactive) per controller. Colors match vertical bars. *(Not yet built.)*
- **Sea state scatter:** X=Tp, Y=Hs. All sea states default to black. Points colored by which controller was active for that sea state combination.
- **Date range:** Defaults to "all available data" (read from `manifest.json`).

---

### Page 2: Selector Display (`selector.html`)
**Purpose:** Multi-chart, multi-filter view for detailed inspection; compare different metrics side-by-side with controller and sea state filtering.

**Layout (Desktop):**
```
┌─────────────────────────────────────────────────────┐
│ ☰  Buoy Dashboard                                   │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Left (30%)           │    Right (70%)              │
│  ─────────────────    │  ─────────────────          │
│  FILTERS              │  CHARTS (stacked vertically)│
│                       │                             │
│  Controller Selector  │  Chart 1: Avg Power        │
│  ☑ Controller 1       │  [Linked X-axis zoom]      │
│  ☑ Controller 2       │  [Vertical bars: deselected│
│  ☑ Free Response      │   controllers=grey solid,  │
│  [All default ON]     │   deselected sea states=   │
│                       │   grey hatched]             │
│  Chart Type Selector  │  [Horizontal lines: avg    │
│  [Avg Power]          │   value per controller]    │
│  [Efficiency]         │                             │
│  [Select chart type]  │  Chart 2: Efficiency      │
│  [expandable per CSV] │  [Linked X-axis zoom]      │
│                       │  [Same grey overlays]      │
│  Sea State Selector   │  [Horizontal lines]        │
│  ┌─────────────────┐  │                             │
│  │ Hs/Tp Scatter   │  │  Chart 3: [User-Selected]  │
│  │                 │  │  [Linked X-axis zoom]      │
│  │ ● = in current  │  │  [Same grey overlays]      │
│  │   time range    │  │  [Horizontal lines]        │
│  │                 │  │                             │
│  │ ◯ = not in      │  │  Date Range Picker:        │
│  │   current range │  │  [Start Date] – [End Date] │
│  │                 │  │                             │
│  │ Click or draw   │  │  Legend:                   │
│  │ box to toggle   │  │  ▓▓▓▓ Deselected Controller│
│  │ selection       │  │  ▒▒▒▒ Deselected Sea State│
│  └─────────────────┘  │                             │
│                       │                             │
└─────────────────────────────────────────────────────┘
```

**Key Specifications:**
- **Controller Selector:** Checkboxes for all controllers (read from CSV). Default: all checked.
  - When a controller is deselected: sections of all three charts where that controller was active turn solid light-grey (e.g., `#e8e8e8`), and all lines are removed from those sections.
  
- **Chart Type Selector:** Dropdown to pick 3 charts independently. Defaults: Chart 1 = Avg Power, Chart 2 = Efficiency, Chart 3 = empty ("Select chart type"). Options dynamically read from `chartTypes.json` and all numeric CSV columns.

- **Sea State Selector:** 
  - Displays scatter plot (X=Tp, Y=Hs) of ALL available sea states across full dataset history. Nearby (Hs, Tp) combinations are aggregated into a fixed grid (2% of the observed span per cell); the zoomed X-axis window on the timeline charts highlights the matching cells in the scatter.
  - Visual indication (● filled vs. ◯ hollow) shows which sea states exist within the currently selected time range on the main charts.
  - User can click individual grid cells to toggle sea state selection; a "Select All/Deselect All" button toggles the full set. Box-draw selection is specified but *not yet built* (desktop target).
  - When a sea state is deselected, those rows are dropped from all three charts' series. Hatched light-grey overlays over deselected-sea-state-only sections are specified but *not yet built*; deselected *controller* runs currently show as solid-grey vertical gaps instead (controller solid grey **is** built).
  - **No-sea-state fallback:** when a dataset has no Hs/Tp columns at all (e.g. real-pipeline output before the wave loader lands), the sea-state scatter shows an "No sea-state data in range" note with the toggle disabled, and the timeline charts use *every* row (sea-state filter bypassed). The filter re-engages as soon as any sea-state point exists.

- **Charts (3, stacked vertically):**
  - All three charts share X-axis (time); Y-axes independent.
  - Equal height (33% each).
  - Zooming/panning one chart's X-axis triggers zoom on the other two (X only). The zoom window also filters the sea-state scatter cells.
  - Vertical bars overlay:
    - Deselected controller sections: solid light-grey (`#e8e8e8`), full height, all data lines removed. **(Built.)**
    - Deselected sea state sections: hatched light-grey (e.g., diagonal stripes), full height, all data lines removed. *(Not yet built; deselected sea states are dropped from the series instead.)*
  - Horizontal lines: for each controller, a line showing average value during the selected time range (color matches controller). **(Built — dashed colored `markLine` per controller, recomputed on controller/sea-state changes.)**

- **Date Range:** Each page has independent picker. Page 2 defaults to "all available data."

---

### Page 3: Power Usage (`power.html`)
**Purpose:** Battery health and power flow tracking over time.

**Layout (Desktop):**
```
┌─────────────────────────────────────────────────────┐
│ ☰  Buoy Dashboard                                   │
├─────────────────────────────────────────────────────┤
│  Date Range Picker:                                 │
│  [Start Date] – [End Date]                          │
│  [Default: Past 2 Days]                             │
│                                                     │
│  Unmeasured discharge offset slider: [0..100 W]     │
│  (default 15 W, tick at 15 = assumed average;       │
│  affects discharge + battery-life series only)       │
│                                                     │
│  Chart 1: Battery %  [Line/area, per controller]     │
│  Chart 2: Power      [merged, per controller]:       │
│    - Avg Power (solid, signed)                       │
│    - Power In         [max(avg_power, 0)] (dashed)   │
│    - Discharge        [-(power_to_controller +       │
│                        offset)] (solid, bold,        │
│                        negative = discharging)       │
│    - Phantom          [-power_to_controller, no      │
│                        offset] (thin dashed, faint,  │
│                        negative)                     │
│  Chart 3: Battery Life [5 kWh × pct ÷ net, hours;    │
│            gap while charging] + dashed expected-life│
│            span lines & text summary per controller's│
│            most recent run                           │
│  [All charts: linked X-axis zoom]                   │
└─────────────────────────────────────────────────────┘
```

**Key Specifications:**
- Three stacked charts, all per-controller series, shared X-axis zoom (`dataZoom` synced across all three).
- **Battery %:** `battery_pct` column (percent).
- **Power (merged):** per-controller lines for Avg Power (solid, signed), Power In `power_in` (dashed, ≥ 0), Discharge `-(power_to_controller + offset)` (solid, bold, negative per the signed-power convention), and Phantom `-power_to_controller` (thin dashed, low opacity — the measured discharge without the offset, also negative). Line style (type/width/opacity) disambiguates the metric; color encodes the controller; series names are `<metric>: <controller>` so ECharts legend can toggle them.
- **Tooltips:** all three charts use a shared axis-trigger formatter that lists only the series with a value at the hovered point (null/gap series are omitted), showing just the x-axis timestamp when no line is present there.
- **Discharge offset slider:** 0–100 W, default 15 W, tick mark at 15 W (assumed average unmeasured discharge). Moving it updates only the discharge line and the battery-life series in place (`replaceMerge` on series only), preserving the current zoom window.
- **Battery Life:** `hours = (BATTERY_CAPACITY_WH × battery_pct/100) ÷ net`, where `net = (power_to_controller + offset) − power_in`. `BATTERY_CAPACITY_WH = 5000` (constant, swappable); null/gap while charging (`net ≤ 0`).
- **Expected-life projections:** for each controller, its most recent contiguous minute-run is found (walking back from its last row while timestamps are exactly 1 minute apart); expected life = `BATTERY_CAPACITY_WH × avg(battery_pct) ÷ avg(net)` over that run. Drawn as flat dashed lines spanning the run's time range, plus a text summary list under the chart (n/a when charging or missing data). Recomputes on slider moves.
- The offset affects **only** the discharge and battery-life lines — never the battery %, power-in, phantom line, or the underlying data.
- Default date range: past 2 days from the current date. Reset button returns to "Past 2 Days".

---

### Page 4: Next Wave (`nextwave.html`)
**Purpose:** Experimental next-wave prediction data tracking.

**Layout (Desktop):**
```
┌─────────────────────────────────────────────────────┐
│ ☰  Buoy Dashboard                                   │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Chart Selector:                                    │
│  ☑ NextWave                                         │
│  ☑ NextWaveError                                    │
│  ☑ NextWaveError2                                   │
│  [All default ON, expandable]                       │
│                                                     │
│  Large Charts: [Selected columns, stacked]          │
│  [Line/area charts]                                 │
│  [Linked X-axis zoom]                               │
│                                                     │
│  Date Range Picker:                                 │
│  [Start Date] – [End Date]                          │
│  [Default: Past 2 Days]                             │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**Key Specifications:**
- Chart selector: checkboxes for all columns in the "Next Wave" category (`nextwave`, `nextwave_error`, `nextwave_error_2`), auto-loaded from `chartTypes.json` (`category: "prediction"`) so future prediction columns added to the config appear automatically. Selection persists via the `chartTypes` URL param and defaults to all on.
- All selected charts displayed as stacked vertical sections.
- Shared X-axis zoom (Y-axes independent) — synced across the stacked charts via `syncChartZoom`.
- The `nextwave` state column plots on a categorical y-axis; numeric prediction columns plot as value-axis lines with area fill.
- **Prediction Scatter (`#chartScatter`):** one `scatter` series per controller, `[x, y]` per-minute points. X-axis selectable among the numeric metrics from `chartTypes.json` (`#scatterXAxis`); Y-axis selectable among `nextwave_error`, `nextwave_error_2`, and the `nextwave` state (`#scatterYAxis`). When the state metric is on an axis it maps to three positions — `Off→1`, `Starting→2`, `On→3` (value axis, ticks labeled with the state names). Axis choices persist via `scatterX`/`scatterY` URL params; defaults `sea_state_energy` / `nextwave_error`.
- **Controller Selector (`#scatterControllerCheckboxes`):** mirrors the selector page's checkbox+swatch pattern; unchecking a controller excludes its rows from *all* charts on the page (stacked + scatter). Selection persists via the shared `controllers` URL param and defaults to all controllers in range. A "No controller data in range." note replaces the scatter when nothing remains.
- Date range: defaults to past 2 days.

---

## Frontend Component Architecture

### Directory Structure
```
/
├── index.html                    — Homepage
├── selector.html                 — Page 2 (Selector Display)
├── power.html                    — Page 3 (Power Usage)
├── nextwave.html                 — Page 4 (Next Wave)
├── css/
│   ├── styles.css                — Global styles, layout, responsive
│   └── charts.css                — ECharts customizations
├── js/
│   ├── shared/
│   │   ├── navigation.js          — Hamburger menu (imported by all pages)
│   │   ├── dataFetcher.js         — Manifest fetch, CSV fetch/cache/parse
│   │   ├── chartUtils.js          — ECharts setup, color mapping, zoom sync
│   │   └── colorScheme.js         — Controller colors, grey values, palette
│   ├── pages/
│   │   ├── homepage.js            — Homepage initialization and state
│   │   ├── selector.js            — Page 2 initialization and state
│   │   ├── power.js               — Page 3 initialization and state
│   │   └── nextwave.js            — Page 4 initialization and state
│   └── utils/
│       └── urlParams.js           — Parse/write query params for bookmarking
├── data/
│   ├── manifest.json              — Available date range, day-files list
│   ├── YYYY-MM-DD.csv             — Day files (generated by GitHub Action)
│   └── overview.csv               — Full history downsampled
├── config/
│   └── chartTypes.json            — List of available chart types (expandable)
└── README.md                      — Setup and deployment instructions
```

### Shared JavaScript Modules

**`navigation.js`**
- Renders hamburger menu on all pages.
- Exports function: `initNavigation()` — call on page load.
- Stores menu state locally (open/closed); no global state.

**`dataFetcher.js`**
- `fetchManifest()` → loads `manifest.json`, returns date range and day-file list.
- `fetchDayFile(date)` → fetches `/data/YYYY-MM-DD.csv`, caches in memory.
- `parseCSV(rawText)` → converts CSV to JSON array of rows.
- `filterByDateRange(data, start, end)` → filters rows by timestamp range.
- `getUniqueControllers(data)` → returns all controller names from CSV.
- `getSeaStateScatter(data)` → groups by (Hs, Tp), returns points with controller info.

**`chartUtils.js`**
- `initChart(domId, chartConfig)` → creates ECharts instance.
- `syncChartZoom(charts, sourceChart)` → listener: when source chart zooms X-axis, sync other charts' X range.
- `getColorForController(controllerName)` → returns color from colorblind palette.
- `addVerticalBarOverlay(chart, xRanges, colors, style)` → draws colored/hatched vertical bars.
- `addHorizontalAvgLine(chart, controllerName, avgValue, color)` → draws average line per controller.

**`colorScheme.js`**
- `controllerColorPalette` — array of distinct, colorblind-friendly colors.
- `deselectedControllerGrey` — solid light grey (`#e8e8e8`).
- `deselectedSeaStatePattern` — hatched pattern grey.
- Exports functions: `getColor(index)`, `getDeselectedControllerStyle()`, `getDeselectedSeaStateStyle()`.

### Per-Page Modules

Each page (e.g., `selector.js`) handles:
1. Load and parse URL query params (date range, filters).
2. Fetch required day-files via `dataFetcher`.
3. Initialize all charts and UI components.
4. Set up event listeners (date-range change, filter toggle, zoom sync).
5. Update URL params on state change (for bookmarking).

### URL Params Utility

**`urlParams.js`**
- `getURLParams()` → parses current query string, returns object with date range and filter state.
- `setURLParams(params)` → updates `window.history` with new query params for bookmarking.
- `formatDateForURL(date)` → converts Date or string to URL-safe format.
- `parseDateFromURL(dateStr)` → converts URL date string to Date object.

---

## Data Flow & State Management

### Typical User Flow (Page 2)
1. Page loads → read `?start=...&end=...` from URL.
2. Call `fetchManifest()` → validate date range against available data.
3. Determine which day-files needed → `fetchDayFile(date)` for each day.
4. Parse all files → merge into single dataset.
5. Initialize filter UI: populate controller checkboxes (all checked), sea state scatter (all selected).
6. Initialize 3 charts (Avg Power, Efficiency, [empty]).
7. Apply filters to dataset.
8. Render charts with vertical bars and horizontal lines.
9. User clicks a controller checkbox → dataset re-filters → charts re-render.
10. User zooms Chart 1 X-axis → `syncChartZoom()` fires → Charts 2 & 3 X-axes updated.
11. User navigates away or changes date range → URL params updated for bookmarking.

---

## Manifest File Format

**`/data/manifest.json`**
```json
{
  "availableDateRange": {
    "minDate": "2026-10-05",
    "maxDate": "2026-12-03"
  },
  "dayFiles": [
    "2026-10-05",
    "2026-10-06",
    ...
    "2026-12-03"
  ],
  "lastUpdated": "2026-12-03T20:30:00Z"
}
```
- Updated by GitHub Action each time new data arrives.
- Frontend queries this first to determine available date ranges; prevents failed fetch attempts.
- Dates in `YYYY-MM-DD` format for simplicity and direct mapping to day-file naming.

---

## Chart Configuration File

**`/config/chartTypes.json`**
```json
{
  "chartTypes": [
    {"name": "avg_power", "label": "Avg Power", "unit": "W", "category": "power"},
    {"name": "efficiency", "label": "Efficiency", "unit": "%", "category": "power"},
    {"name": "power_in", "label": "Power In", "unit": "W", "category": "power"},
    {"name": "power_to_controller", "label": "Power to Controller", "unit": "W", "category": "power"},
    {"name": "battery_voltage", "label": "Battery Voltage", "unit": "V", "category": "power"},
    {"name": "battery_pct", "label": "Battery %", "unit": "%", "category": "power"},
    {"name": "sea_state_energy", "label": "Sea State Energy", "unit": "J/m²", "category": "wave"},
    {"name": "hs", "label": "Wave Height (Hs)", "unit": "m", "category": "wave"},
    {"name": "tp", "label": "Wave Period (Tp)", "unit": "s", "category": "wave"},
    {"name": "peaks", "label": "Peaks", "unit": "count", "category": "system"},
    {"name": "nextwave", "label": "NextWave State", "unit": "state", "category": "prediction"},
    {"name": "nextwave_error", "label": "NextWave Error", "unit": "RMS", "category": "prediction"},
    {"name": "nextwave_error_2", "label": "NextWave Error 2", "unit": "value", "category": "prediction"}
  ]
}
```
- When new CSV columns are added, add corresponding entries here.
- Frontend reads this file once on app init; all chart selectors populated dynamically.
- Categories allow for future grouping/organization of chart types.

---

## Color Scheme & Styling

### Background & Neutral
- **Page background:** White (`#ffffff`).
- **Deselected controller sections:** Solid light grey (`#e8e8e8`), opaque.
- **Deselected sea state sections:** Hatched light grey, same base color, with diagonal stripe pattern overlay.

### Controller Colors
Use a **colorblind-friendly palette** (e.g., from Paul Tol or ColorBrewer):
- Suggested palette (4 distinct, colorblind-safe): `#1b9e77`, `#d95f02`, `#7570b3`, `#e7298a`.
- Can extend as needed; order determined by appearance order in CSV.

### Chart Elements
- **Grid lines:** Light grey (`#f0f0f0`), subtle.
- **Text:** Dark grey or black (`#333333` or `#000000`), high contrast.
- **Axis labels:** Same as text.
- **Legend:** Minimal; colors match controller palette.

### Styling Principles
- **Keep extremely simple:** No drop shadows, minimal borders, focus on readability.
- **Subtle backing cards** (e.g., light grey background `#fafafa`) can separate filter/chart sections if needed.
- **No flairs or animations** beyond what ECharts provides for interaction.
- **Consistent spacing:** Margins, padding, gaps between sections follow a simple grid (e.g., 8px or 16px multiples).

---

## Responsive Design & Breakpoints

### Desktop (≥ 1200px)
- Homepage: Left 60% + Right 40% side-by-side.
- Page 2: Left 30% filters + Right 70% charts side-by-side.
- Page 3 & 4: Full-width chart stack.

### Tablet (768px – 1199px)
- Homepage: Left 50% + Right 50%, or stack vertically if needed.
- Page 2: Left (filters) and Right (charts) stack vertically; filters on top, charts below.
- Charts may be slightly smaller but remain readable.

### Mobile (< 768px)
- All sections stack vertically.
- Charts shrink to fit screen width; X-axis labels may be rotated or offset.
- Hamburger menu opens full-width.
- Filter selectors and sea state scatter remain functional.
- Sea state selector: click-toggle only (no box-draw on touch).

**CSS Implementation:**
- Use CSS media queries (`@media (max-width: 1200px)`, etc.).
- Flexbox for layout (`flex-direction: row` → `column` at breakpoints).
- ECharts handles chart responsiveness natively via `chart.resize()` on window resize.

---

## Key Implementation Notes

### No Hardcoding
- Controller names, chart types, and sea states are **never hardcoded** in the UI code.
- All are read dynamically from CSVs or config files.
- Adding a new controller or chart type requires only updating the CSV or `chartTypes.json`; no code changes.

### Linked X-Axis Zoom (Not Y)
- All charts on a page share the same X-axis (time).
- When one chart's X-range changes (user zoom/pan), all other charts' X-ranges update identically.
- Y-axes remain independent (each chart can have different value ranges).
- Implementation: ECharts `dataZoom` events trigger listener callbacks that sync X-range on other charts.

### URL Bookmarking
- All page state encoded in URL query params: `?start=TIMESTAMP&end=TIMESTAMP` (and filters for Page 2).
- Users can bookmark/share a specific view by copying the URL.
- Each page reads URL params on load and restores state accordingly.
- URL params update on page navigation/close, not real-time (avoids excessive history rewrites).

### Data Caching
- Day-files fetched once and cached in memory (not re-fetched on filter/zoom changes).
- Cache keyed by date; cleared if user navigates between pages or closes browser.
- Large datasets (many months) may require pagination/lazy loading (noted for future optimization).

### Scatter Plots vs. Line Charts
- Homepage small graphs (Hs, Tp) and sea state selector: **scatter plots** (points only, no connecting lines).
- Large graphs (Power, Efficiency) and other numeric charts: **line or area charts** (connected time series).
- Chart type determined by data semantics; homepage Hs/Tp are persistent ~30-min blocks (best shown as scatter).

### Chart Heights
- Homepage: Large charts (600px), small charts (200px).
- Page 2: Three stacked charts with equal heights (33% each).
- Page 3 & 4: Single or stacked charts fill available space.

---

## Future Considerations & Notes

1. **Data volume:** As dataset grows (months → years), consider lazy-loading day-files or implementing server-side aggregation endpoints.
2. **Mobile UI:** Sea state selector (draw-box interaction) may need touch-friendly alternatives (tap-to-toggle, pinch-zoom).
3. **Accessibility:** Ensure color choices work for colorblind users (tested with Coblis simulator). Provide text labels / legends.
4. **Performance:** Monitor ECharts render time with large datasets; may need to downsample in-browser or pre-aggregate on backend.
5. **New columns:** When adding new CSV columns, update `chartTypes.json` and optionally add category grouping for organization.
6. **Reference dashboard — Sandia Pioneer WEC (`https://sandialabs.github.io/pioneer_wec_dashboard/`, source `sandialabs/pioneer_wec_dashboard`):** Dashboard for the Pioneer WEC v1 prototype (Sandia + OOI), deployed at the Coastal Pioneer Array Central Surface Mooring Nov 2025–May 2026 (181 days; peak 20.2 W, mean 8.6 W, total 36.9 kWh; solar/wind also tracked). Built on a different stack on purpose: static Plotly HTML pages generated by a Python pipeline (`app.py`: `fetch-data` → `generate-plots` → `build-site`, `.cache` for raw inputs) plus a Jekyll layout, with raw data downloadable as HDF5/NetCDF (`wec_data.h5.gz`, `pwrsys_data.h5.gz`, `ndbc_data.h5.gz`, `ndbc_spectral.h5.gz`). Its data sources are OOI rawdata (`wec_decimated`, nightly satellite) and NDBC buoys 44014/44079/41083/44095; the deployment dataset is on MHK-DR (submission 714). Visualization ideas to revisit when new MBARI views are discussed:
   - Power-generation calendar heatmap (daily avg DC power)
   - Joint-probability distribution of Hs vs Tp; wave spectral density over time
   - Correlation scatter matrix across key variables
   - Power matrix and capture-width matrix (mean power / capture efficiency as functions of Hs/Tp boxes) — an efficiency-per-sea-state framing worth comparing against our `efficiency`/`sea_state_energy`
   - Damping-gain vs power scatter (control-tuning analysis, analogous to our per-controller views)
   - Solar/wind/WEC power-systems boxplot + stats table

   Not for direct reuse (our stack is ECharts + raw CSV day-files), but useful context for future changes. Notes written 2026-09-25.

---

## Site Structure Summary
- **Homepage (`index.html`):** Overview of power, efficiency, controllers, sea states.
- **Selector Display (`selector.html`):** Multi-chart, multi-filter detailed view.
- **Power Usage (`power.html`):** Battery percentage tracking.
- **Next Wave (`nextwave.html`):** Experimental prediction metrics.

All pages share:
- Hamburger navigation menu (top-left).
- Independent date-range pickers.
- Responsive design (desktop → tablet → mobile).
- Colorblind-friendly color scheme.
- No hardcoded data values.