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

### CSV Schema (per-row fields)

#### Required Fields
- `timestamp_ns` — ROS2-style nanoseconds since epoch (int64), matches `node.get_clock().now().nanoseconds`.
- `timestamp_iso` — human-readable ISO8601 convenience column (e.g., `2026-10-05T12:34:56Z`).
- `controller` — string enum (e.g., `free response`, `controller 1`, `controller 2`); dynamically read from CSV, not hardcoded. Persists in multi-hour blocks.

#### Environmental/Wave Data (persist in ~30-min blocks)
- `hs` — float, 0–3 (wave height, meters).
- `tp` — float, 1–14 (wave period, seconds).

#### Power & Energy (per-minute or per-record)
- `avg_power` — float, range -30 to 200 (watts).
- `power_in` — float, 0–450 (input watts).
- `power_out` — float, 0–600 (output watts).
- `battery_pct` — float, 0–100, smooth sawtooth (discharge/charge cycles).
- `sea_state_energy` — float, J/m² (wave energy density, derived from Hs and Tp using simplified formula: E ≈ 0.5 × Hs² × Tp with random variation).
- `efficiency` — float, 0–100 % (calculated as `(power_out / sea_state_energy) × 100`, clamped to [0, 100]).

#### System State
- `peaks` — int, 1–3 (independent per-minute, or summed hourly for overview).

#### Next Wave Prediction (experimental; new columns)
- `nextwave` — string enum, e.g., `On`, `Starting`, `Off` (state that persists for 30–120 min blocks).
- `nextwave_error` — float, RMS value, typically 0–~1500 (prediction error metric).
- `nextwave_error_2` — float, 0–~1000, lower is better (secondary error metric).

**Important:** All numeric columns (except `timestamp_ns`, `timestamp_iso`, and `controller`) are treated as potential chart types. No chart type is hardcoded; all are read from `chartTypes.json`. Controller values are not hardcoded; all unique values from the CSV are treated as valid controllers.

---

## Data Generation (Testing)

### Script: `generate_telemetry.py`
A Python script generates synthetic minute-resolution telemetry for testing. Usage:

```bash
python generate_telemetry.py \
  --start "2026-10-05T00:00:00Z" \
  --days 60 \
  --seed 42 \
  --output ./data_output
```

**Outputs:**
- `./data_output/data/YYYY-MM-DD.csv` — 60 daily files
- `./data_output/data/overview.csv` — hourly downsampled
- `./data_output/data/manifest.json` — manifest
- `./data_output/config/chartTypes.json` — chart types config

**Generation Logic:**
- **Hs & Tp:** Piecewise constant (30-min blocks) with intra-block jitter.
- **Battery Pct:** Smooth discharge (0.005–0.035% per min) with periodic charging cycles (every 12–20 hrs, lasting 2–5 hrs).
- **Sea State Energy:** `0.5 × Hs² × Tp × random(0.9, 1.1)`.
- **Efficiency:** `(power_out / sea_state_energy) × 100`, clamped [0, 100].
- **NextWave State:** Cycles between On/Starting/Off, stays per state 30–120 min.
- **NextWave Errors:** Smooth variation with occasional spikes.
- **Peaks:** Random 1–3 per minute (summed to total per hour in overview).

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
│  Bottom: Sea State    │                             │
│  Scatter (Hs vs Tp)   │                             │
│                       │                             │
│  Date Range Picker:   │                             │
│  [Default: All Data]  │                             │
└─────────────────────────────────────────────────────┘
```

**Key Specifications:**
- **Large graphs (Avg Power, Efficiency):** time-series line/area charts, linked X-axis zoom only (Y independent).
- **Small graphs (Hs, Tp):** scatter plots, same X-axis linked zoom.
- **Vertical color bars:** Full-height colored bands behind each chart indicating which controller was active during that time range.
- **Controller list:** Shows all controllers dynamically (read from CSV); one indicator light (● for active, ◯ for inactive) per controller. Colors match vertical bars.
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
│  FILTERS              │  CHARTS (stacked)           │
│                       │                             │
│  Controller Selector  │  Chart 1: Avg Power        │
│  ☑ Controller 1       │  [Linked X-axis zoom]      │
│  ☑ Controller 2       │  [Overlays as described]   │
│  ☑ Free Response      │  [Horizontal avg lines]    │
│                       │                             │
│  Chart Type Selector  │  Chart 2: Efficiency      │
│  [Dropdown 1]         │  [Linked X-axis zoom]      │
│  [Dropdown 2]         │  [Overlays as described]   │
│  [Dropdown 3]         │  [Horizontal avg lines]    │
│                       │                             │
│  Sea State Selector   │  Chart 3: User-Selected   │
│  ┌─────────────────┐  │  [Linked X-axis zoom]      │
│  │ Hs/Tp Scatter   │  │  [Overlays as described]   │
│  │                 │  │  [Horizontal avg lines]    │
│  │ ● = in range    │  │                             │
│  │ ◯ = not in range│  │  Date Range Picker:        │
│  │                 │  │  [All Available]           │
│  └─────────────────┘  │                             │
│                       │                             │
└─────────────────────────────────────────────────────┘
```

**Key Specifications:**
- **Controller Selector:** Checkboxes for all controllers (read from CSV). Default: all checked.
  - When a controller is deselected: sections of all three charts where that controller was active turn solid light-grey (`#e8e8e8`), and all lines are removed from those sections.
  
- **Chart Type Selector:** Three independent dropdowns to pick chart types. Defaults: Chart 1 = Avg Power, Chart 2 = Efficiency, Chart 3 = empty ("Select chart type"). Options dynamically read from `chartTypes.json`.

- **Sea State Selector:** 
  - Displays scatter plot (X=Tp, Y=Hs) of ALL available sea states across full dataset history.
  - Visual indication (● filled vs. ◯ hollow) shows which sea states exist within the currently selected time range.
  - User can click individual points or draw a box to toggle sea state selection.
  - **Mobile (<768px): Click-toggle only** (no box-draw).
  - When a sea state is deselected: sections of all three charts where ONLY that sea state occurred turn hatched light-grey, and all lines are removed.
  - Default: all sea states selected.

- **Charts (3, stacked vertically, equal height):**
  - All three charts share X-axis (time); Y-axes independent.
  - Zooming/panning one chart's X-axis triggers zoom on the other two (X only).
  - Vertical bar overlays:
    - Deselected controller sections: solid light-grey (`#e8e8e8`).
    - Deselected sea state sections: hatched light-grey.
  - Horizontal lines: for each controller, a line showing average value during the selected time range.

- **Date Range:** Defaults to "all available data."

---

### Page 3: Power Usage (`power.html`)
**Purpose:** Battery health and power flow tracking over time.

**Layout (Desktop):**
```
┌─────────────────────────────────────────────────────┐
│ ☰  Buoy Dashboard                                   │
├─────────────────────────────────────────────────────┤
│                                                     │
│  Large Chart: Battery %                             │
│  [Line/area chart]                                  │
│  [X-axis zoom linked to other charts on this page] │
│                                                     │
│  Date Range Picker:                                 │
│  [Default: Past 2 Days]                             │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**Key Specifications:**
- Single large chart displaying `battery_pct` over time.
- Default date range: past 2 days from current date.
- Independent X-axis zoom (Y-axis independent if multiple charts added later).
- No filtering or overlays.

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
│  ☑ NextWave State                                   │
│  ☑ NextWave Error                                   │
│  ☑ NextWave Error 2                                 │
│  [All default ON]                                   │
│                                                     │
│  Large Charts: [Selected columns, stacked]          │
│  [Line/area charts]                                 │
│  [Linked X-axis zoom]                               │
│                                                     │
│  Date Range Picker:                                 │
│  [Default: Past 2 Days]                             │
│                                                     │
└─────────────────────────────────────────────────────┘
```

**Key Specifications:**
- Chart selector: checkboxes for next-wave category columns (`nextwave`, `nextwave_error`, `nextwave_error_2`). Future columns added to CSV are auto-included.
- All selected charts displayed as stacked vertical sections with equal height.
- Shared X-axis zoom (Y-axes independent).
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
│   │   ├── navigation.js          — Hamburger menu
│   │   ├── dateRangePicker.js     — Reusable date picker component
│   │   ├── dataFetcher.js         — Manifest/CSV fetch/cache/parse
│   │   ├── chartUtils.js          — ECharts setup, color mapping, zoom sync
│   │   └── colorScheme.js         — Controller colors, grey values
│   ├── pages/
│   │   ├── homepage.js            — Homepage initialization
│   │   ├── selector.js            — Page 2 initialization
│   │   ├── power.js               — Page 3 initialization
│   │   └── nextwave.js            — Page 4 initialization
│   └── utils/
│       ├── urlParams.js           — Parse/write query params
│       └── csvParser.js           — Additional CSV utilities (if needed)
├── data/
│   ├── manifest.json              — Available date range
│   ├── YYYY-MM-DD.csv             — Daily files (generated)
│   └── overview.csv               — Hourly downsampled
├── config/
│   └── chartTypes.json            — Chart types catalog
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
- `getDayFilesInRange(start, end)` → returns dates between start and end.

**`chartUtils.js`**
- `initChart(domId, chartConfig)` → creates ECharts instance.
- `syncChartZoom(charts, sourceChartId)` → listener: when source chart zooms X-axis, sync other charts' X range.
- `getColorForControllerIndex(index, colorPalette)` → returns color from palette.
- `addVerticalBarOverlay(chart, ranges, xAxisData)` → draws colored/hatched vertical bars.
- `addHorizontalAvgLine(chart, controllerName, avgValue, color)` → draws average line.
- `createLineChartConfig(xAxisData, seriesData, seriesName, color)` → basic line chart config.
- `createScatterChartConfig(data, seriesName, color)` → basic scatter chart config.
- `formatDateFromTimestamp(timestampMs)` → converts ms timestamp to ISO date string.

**`colorScheme.js`**
- `CONTROLLER_COLOR_PALETTE` — array of colorblind-friendly colors.
- `DESELECTED_CONTROLLER_GREY` — solid light grey (`#e8e8e8`).
- `DESELECTED_SEA_STATE_PATTERN` — hatched pattern grey.
- `getControllerColor(index)` — returns color by index.
- `getControllerColorMap(controllers)` → map of controller name → color.

### Per-Page Modules

Each page (e.g., `selector.js`) handles:
1. Load and parse URL query params (date range, filters).
2. Fetch required day-files via `dataFetcher`.
3. Initialize all charts and UI components.
4. Set up event listeners (date-range change, filter toggle, zoom sync).
5. Update URL params on state change (on page nav/close only).

---

## Data Flow & State Management

### Typical User Flow (Page 2)
1. Page loads → read `?start=...&end=...` from URL.
2. Call `fetchManifest()` → validate date range against available data.
3. Determine which day-files needed → `fetchDayFile(date)` for each day.
4. Parse all files → merge into single dataset.
5. Initialize filter UI: populate controller checkboxes (all checked), sea state scatter (all selected).
6. Initialize 3 charts (Avg Power, Efficiency, empty).
7. Apply filters to dataset.
8. Render charts with vertical bars and horizontal lines.
9. User clicks a controller checkbox → dataset re-filters → charts re-render.
10. User zooms Chart 1 X-axis → `syncChartZoom()` fires → Charts 2 & 3 X-axes updated.
11. User navigates away → URL params written for bookmarking.

---

## Color Scheme & Styling

### Background & Neutral
- **Page background:** White (`#ffffff`).
- **Deselected controller sections:** Solid light grey (`#e8e8e8`), opaque.
- **Deselected sea state sections:** Hatched light grey, diagonal stripe pattern.

### Controller Colors
**Colorblind-friendly palette** (Paul Tol, 4 distinct):
- `#1b9e77` (teal)
- `#d95f02` (orange)
- `#7570b3` (purple)
- `#e7298a` (magenta)

Extended automatically for more controllers.

### Chart Elements
- **Grid lines:** Light grey (`#f0f0f0`), subtle.
- **Text:** Dark grey or black (`#333333`), high contrast.
- **Axis labels:** Same as text.
- **Legend:** Minimal; colors match controller palette.

### Styling Principles
- Keep extremely simple: No drop shadows, minimal borders, focus on readability.
- Subtle backing cards (light grey background `#fafafa`) separate filter/chart sections.
- No flairs or animations beyond ECharts interaction.
- Consistent spacing: 8px or 16px multiples.

---

## Responsive Design & Breakpoints

### Desktop (≥ 1200px)
- Homepage: Left 60% + Right 40% side-by-side.
- Page 2: Left 30% filters + Right 70% charts side-by-side.
- Page 3 & 4: Full-width chart stack.

### Tablet (768px – 1199px)
- Homepage: Left 50% + Right 50%, or stack vertically.
- Page 2: Filters and charts stack vertically; filters on top.
- Charts smaller but readable.

### Mobile (< 768px)
- All sections stack vertically.
- Charts shrink to fit screen width.
- Hamburger menu opens full-width.
- Filter selectors and sea state scatter remain functional.
- **Sea state selector: Click-toggle only** (no box-draw).

**CSS Implementation:**
- Use media queries (`@media (max-width: 1200px)`, etc.).
- Flexbox for layout (`flex-direction: row` → `column` at breakpoints).
- ECharts handles chart responsiveness via `chart.resize()` on window resize.

---

## Chart Configuration File

**`/config/chartTypes.json`**
```json
{
  "chartTypes": [
    {"name": "avg_power", "label": "Avg Power", "unit": "W", "category": "power"},
    {"name": "efficiency", "label": "Efficiency", "unit": "%", "category": "power"},
    {"name": "power_in", "label": "Power In", "unit": "W", "category": "power"},
    {"name": "power_out", "label": "Power Out", "unit": "W", "category": "power"},
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

---

## Manifest File Format

**`/data/manifest.json`**
```json
{
  "availableDateRange": {
    "startDate": "2026-10-05T00:00:00Z",
    "endDate": "2026-12-03T23:59:59Z"
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

---

## Key Implementation Notes

### No Hardcoding
- Controller names, chart types, and sea states are **never hardcoded** in the UI code.
- All are read dynamically from CSVs or config files.
- Adding a new controller or chart type requires only updating the CSV or `chartTypes.json`; no code changes.

### Linked X-Axis Zoom (Not Y)
- All charts on a page share the same X-axis (time).
- When one chart's X-range changes (user zoom/pan), all other charts' X-ranges update identically.
- Y-axes remain independent.
- Implementation: ECharts `datazoom` events trigger callbacks that sync X-range on other charts.

### URL Bookmarking
- All page state encoded in URL query params: `?start=TIMESTAMP&end=TIMESTAMP` (and filters for Page 2).
- Users can bookmark/share a specific view by copying the URL.
- Each page reads URL params on load and restores state accordingly.
- Params updated on page navigation or view close, not in real-time.

### Data Caching
- Day-files fetched once and cached in memory.
- Cache keyed by date; cleared if user navigates between pages or closes browser.
- Large datasets (many months) may require pagination/lazy loading (future optimization).

### Scatter Plots vs. Line Charts
- Homepage small graphs (Hs, Tp) and sea state selector: **scatter plots**.
- Large graphs (Power, Efficiency) and other numeric charts: **line or area charts**.

---

## Future Considerations & Notes

1. **Data volume:** As dataset grows (months → years), consider lazy-loading day-files or server-side aggregation.
2. **Mobile UI:** Sea state selector (draw-box interaction) simplified to click-toggle on <768px.
3. **Accessibility:** Colorblind palette verified with Coblis simulator. Text labels and legends provided.
4. **Performance:** Monitor ECharts render time with large datasets; may need in-browser downsampling.
5. **New columns:** When adding new CSV columns, update `chartTypes.json` and optionally add category grouping.

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
