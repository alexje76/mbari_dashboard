/**
 * Power Usage page (Page 3) initialization and state management.
 * Battery percentage, a merged power chart (avg power, power in, discharge,
 * and an offset-free phantom line), discharge rate with an unmeasured-discharge
 * offset slider, and a battery-life estimate with per-controller expected-life
 * projections for each controller's most recent run.
 */

import { initNavigation } from '../shared/navigation.js';
import {
  fetchManifest,
  fetchDataForDateRange,
  getUniqueControllers,
} from '../shared/dataFetcher.js';
import {
  initChart,
  resizeAllCharts,
  disposeChart,
  syncChartZoom,
} from '../shared/chartUtils.js';
import { getURLParams, setURLParams, getLastNDays } from '../utils/urlParams.js';
import { getColor } from '../shared/colorScheme.js';

// Swappable usable-capacity constant for the battery-life estimate.
const BATTERY_CAPACITY_WH = 5000;

const chartIds = ['chartBattery', 'chartPower', 'chartBatteryLife'];

let currentData = [];
let currentControllers = [];
let currentTimes = [];
let dischargeOffset = 15;
const chartInstances = new Map();

const toNumber = (value) => {
  if (value === '' || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const batteryGetter = (row) => toNumber(row.battery_pct);
const avgPowerGetter = (row) => toNumber(row.avg_power);
const powerInGetter = (row) => toNumber(row.power_in);
const phantomGetter = (row) => toNumber(row.power_to_controller);
const dischargeGetter = (row) => {
  const base = toNumber(row.power_to_controller);
  return base === null ? null : base + dischargeOffset;
};
const lifeGetter = (row) => {
  const pct = toNumber(row.battery_pct);
  const discharge = toNumber(row.power_to_controller);
  const charge = toNumber(row.power_in);
  if (pct === null || discharge === null || charge === null) return null;
  const net = discharge + dischargeOffset - charge;
  if (net <= 0) return null;
  return (BATTERY_CAPACITY_WH * (pct / 100)) / net;
};

// Line style disambiguates the metric since color encodes the controller.
const POWER_METRICS = [
  { label: 'Avg Power', getter: avgPowerGetter, style: { type: 'solid', width: 2 } },
  { label: 'Power In', getter: powerInGetter, style: { type: 'dashed', width: 2 } },
  { label: 'Discharge', getter: dischargeGetter, style: { type: 'solid', width: 3 } },
  { label: 'Phantom (no offset)', getter: phantomGetter, style: { type: 'dashed', width: 1.5, opacity: 0.4 } },
];

const SIMPLE_CHART_CONFIG = {
  chartBattery: { unit: 'Percentage (%)', getter: batteryGetter, area: true },
};

/**
 * Initialize the power usage page.
 */
async function init() {
  initNavigation();

  try {
    const manifest = await fetchManifest();
    const urlParams = getURLParams();

    // Default to last 2 days if no URL params
    const lastTwoDays = getLastNDays(2);
    const startDate = urlParams.start || lastTwoDays.start;
    const endDate = urlParams.end || lastTwoDays.end;

    setupDischargeSlider();
    setupDateRangePicker(manifest, startDate, endDate);
    await fetchAndRenderData(startDate, endDate);

    window.addEventListener('resize', () => resizeAllCharts());
  } catch (error) {
    console.error('Power page initialization error:', error);
    showLoading(false);
    showError('Failed to load data. Please refresh the page.');
  }
}

/**
 * Fetch data for date range and render charts.
 */
async function fetchAndRenderData(startDate, endDate) {
  showLoading(true);
  hideError();
  try {
    currentData = await fetchDataForDateRange(startDate, endDate);

    const startTime = new Date(startDate).getTime();
    const endTime = new Date(endDate).getTime();
    currentData = currentData.filter((row) => {
      const time = Date.parse(row.timestamp_iso);
      return Number.isFinite(time) && time >= startTime && time <= endTime;
    });

    if (!currentData.length) {
      throw new Error('No data was found for the selected date range.');
    }

    currentTimes = [...new Set(currentData.map((row) => row.timestamp_iso))].sort();
    currentControllers = getUniqueControllers(currentData);

    renderCharts();

    setURLParams({
      start: startDate,
      end: endDate,
    });

    showLoading(false);
  } catch (error) {
    console.error('Error fetching data:', error);
    showLoading(false);
    showError('Failed to fetch data for the selected range.');
  }
}

/**
 * Rows mapped onto the current time axis for one controller.
 */
function controllerRows(controller) {
  const rowByTime = new Map();
  currentData.forEach((row) => {
    if (row.controller === controller && !rowByTime.has(row.timestamp_iso)) {
      rowByTime.set(row.timestamp_iso, row);
    }
  });
  return currentTimes.map((time) => rowByTime.get(time) || null);
}

/**
 * Build the value series for one controller across the current time axis.
 */
function seriesData(controller, getter) {
  return controllerRows(controller).map((row) => (row ? getter(row) : null));
}

function buildSeries(getter, area) {
  return currentControllers.map((controller, index) => ({
    name: controller,
    type: 'line',
    smooth: true,
    connectNulls: false,
    data: seriesData(controller, getter),
    itemStyle: { color: getColor(index) },
    lineStyle: { color: getColor(index) },
    areaStyle: area ? { opacity: 0.3 } : undefined,
  }));
}

function buildOption(unit, getter, area, extraSeries = []) {
  return {
    tooltip: { trigger: 'axis' },
    legend: { data: currentControllers },
    xAxis: { type: 'category', data: currentTimes },
    yAxis: { type: 'value', name: unit },
    dataZoom: [{ type: 'inside' }, { type: 'slider' }],
    series: [...buildSeries(getter, area), ...extraSeries],
  };
}

function buildPowerSeries() {
  const series = [];
  POWER_METRICS.forEach((metric) => {
    currentControllers.forEach((controller, index) => {
      const color = getColor(index);
      series.push({
        name: `${metric.label}: ${controller}`,
        type: 'line',
        smooth: true,
        connectNulls: false,
        data: seriesData(controller, metric.getter),
        itemStyle: { color },
        lineStyle: {
          color,
          type: metric.style.type,
          width: metric.style.width,
          opacity: metric.style.opacity ?? 1,
        },
        emphasis: { lineStyle: { width: metric.style.width + 1 } },
      });
    });
  });
  return series;
}

function buildPowerOption() {
  const legendData = POWER_METRICS.flatMap((metric) =>
    currentControllers.map((controller) => `${metric.label}: ${controller}`)
  );
  return {
    tooltip: { trigger: 'axis' },
    legend: { type: 'scroll', data: legendData },
    xAxis: { type: 'category', data: currentTimes },
    yAxis: { type: 'value', name: 'W' },
    dataZoom: [{ type: 'inside' }, { type: 'slider' }],
    series: buildPowerSeries(),
  };
}

/**
 * Find the most recent contiguous minute-run for a controller: walk back from
 * its last row while timestamps are exactly 1 minute apart.
 */
function findMostRecentRun(controller) {
  const rows = controllerRows(controller);
  let end = -1;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (rows[i]) {
      end = i;
      break;
    }
  }
  if (end === -1) return null;
  let start = end;
  while (
    start > 0 &&
    rows[start - 1] &&
    Date.parse(currentTimes[start]) - Date.parse(currentTimes[start - 1]) === 60000
  ) {
    start--;
  }
  return { start, end };
}

/**
 * Expected life = capacity × avg(battery_pct) ÷ avg(net) over the controller's
 * most recent run. Null when no valid samples or net ≤ 0 (charging).
 */
function projectLife(controller, run) {
  if (!run) return null;
  let pctSum = 0;
  let pctCount = 0;
  let netSum = 0;
  let netCount = 0;
  const rows = controllerRows(controller);
  for (let i = run.start; i <= run.end; i++) {
    const row = rows[i];
    const pct = batteryGetter(row);
    if (pct !== null) {
      pctSum += pct;
      pctCount++;
    }
    const discharge = toNumber(row.power_to_controller);
    const charge = toNumber(row.power_in);
    if (discharge !== null && charge !== null) {
      const net = discharge + dischargeOffset - charge;
      if (net > 0) {
        netSum += net;
        netCount++;
      }
    }
  }
  if (!pctCount || !netCount) return null;
  const avgPct = pctSum / pctCount;
  const avgNet = netSum / netCount;
  if (avgNet <= 0) return null;
  return (BATTERY_CAPACITY_WH * (avgPct / 100)) / avgNet;
}

function computeLifeProjections() {
  return currentControllers.map((controller, index) => {
    const run = findMostRecentRun(controller);
    const hours = projectLife(controller, run);
    return { controller, index, run, hours };
  });
}

/**
 * Flat dashed overlay lines on the battery-life chart spunning each
 * controller's most recent run at its expected life.
 */
function buildLifeProjectionSeries(projections) {
  return projections
    .filter((p) => p.hours !== null && p.run)
    .map((p) => ({
      name: `Expected: ${p.controller}`,
      type: 'line',
      symbol: 'none',
      connectNulls: false,
      data: currentTimes.map((_, i) =>
        i >= p.run.start && i <= p.run.end ? p.hours : null
      ),
      itemStyle: { color: getColor(p.index) },
      lineStyle: { color: getColor(p.index), type: 'dashed', width: 1.5, opacity: 0.9 },
    }));
}

function buildBatteryLifeOption() {
  return buildOption(
    'Hours',
    lifeGetter,
    false,
    buildLifeProjectionSeries(computeLifeProjections())
  );
}

function buildChartOption(id) {
  if (id === 'chartPower') return buildPowerOption();
  if (id === 'chartBatteryLife') return buildBatteryLifeOption();
  const config = SIMPLE_CHART_CONFIG[id];
  return buildOption(config.unit, config.getter, config.area);
}

function renderCharts() {
  chartIds.forEach((id) => {
    disposeChart(id);
    const chart = initChart(id, buildChartOption(id));
    if (chart) chartInstances.set(id, chart);
    else chartInstances.delete(id);
  });
  syncChartZoom(chartIds);
  renderBatteryLifeSummary();
}

/**
 * Text summary of each controller's expected battery life (most recent run).
 */
function renderBatteryLifeSummary() {
  const list = document.getElementById('batteryLifeSummary');
  if (!list) return;
  const projections = computeLifeProjections();
  list.replaceChildren();
  if (!projections.length) {
    const li = document.createElement('li');
    li.textContent = 'No controller data in range.';
    list.appendChild(li);
    return;
  }
  projections.forEach((p) => {
    const li = document.createElement('li');
    const swatch = document.createElement('span');
    swatch.className = 'summary-swatch';
    swatch.style.backgroundColor = getColor(p.index);
    li.appendChild(swatch);
    const text =
      p.hours === null
        ? `${p.controller}: n/a (charging or missing data)`
        : `${p.controller}: ~${p.hours.toFixed(1)} h (last run)`;
    li.appendChild(document.createTextNode(text));
    list.appendChild(li);
  });
}

/**
 * Rebuild only the power and battery-life series in place so the user keeps
 * their current zoom window when moving the offset slider.
 */
function updateOffsetCharts() {
  ['chartPower', 'chartBatteryLife'].forEach((id) => {
    const chart = chartInstances.get(id);
    if (!chart) return;
    const option = buildChartOption(id);
    chart.setOption({ ...option, series: option.series }, { replaceMerge: ['series'] });
  });
  renderBatteryLifeSummary();
}

/**
 * Setup the unmeasured-discharge offset slider (0-100 W, default 15 W).
 */
function setupDischargeSlider() {
  const slider = document.getElementById('dischargeOffset');
  const label = document.getElementById('dischargeOffsetValue');
  if (!slider) return;

  const update = () => {
    dischargeOffset = Number(slider.value) || 0;
    if (label) label.textContent = slider.value;
  };

  update();
  slider.addEventListener('input', () => {
    update();
    updateOffsetCharts();
  });
}

/**
 * Setup date range picker.
 */
function setupDateRangePicker(manifest, defaultStart, defaultEnd) {
  const startInput = document.getElementById('startDate');
  const endInput = document.getElementById('endDate');
  if (!startInput || !endInput) return;

  startInput.value = toDateInputValue(defaultStart);
  endInput.value = toDateInputValue(defaultEnd);

  const apply = () => {
    const nextStart = new Date(`${startInput.value}T00:00:00Z`);
    const nextEnd = new Date(`${endInput.value}T23:59:59.999Z`);
    if (
      Number.isNaN(nextStart.getTime()) ||
      Number.isNaN(nextEnd.getTime()) ||
      nextStart > nextEnd
    ) {
      showError('Choose a valid date range.');
      return;
    }
    fetchAndRenderData(nextStart, nextEnd);
  };

  document.getElementById('applyDateRange')?.addEventListener('click', apply);
  document.getElementById('resetDateRange')?.addEventListener('click', () => {
    const lastTwoDays = getLastNDays(2);
    startInput.value = toDateInputValue(lastTwoDays.start);
    endInput.value = toDateInputValue(lastTwoDays.end);
    apply();
  });
}

function toDateInputValue(value) {
  return new Date(value).toISOString().slice(0, 10);
}

/**
 * Show or hide loading state.
 */
function showLoading(show) {
  const el = document.getElementById('loadingIndicator');
  if (el) el.hidden = !show;
}

/**
 * Show error message.
 */
function showError(message) {
  const el = document.getElementById('errorMessage');
  if (el) {
    el.textContent = message;
    el.hidden = false;
  }
}

function hideError() {
  const el = document.getElementById('errorMessage');
  if (el) {
    el.hidden = true;
    el.textContent = '';
  }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', init);

export { init };