/**
 * Power Usage page (Page 3) initialization and state management.
 * Battery percentage, power flow (power in / power to controller),
 * discharge rate with an unmeasured-discharge offset, and a battery-life
 * estimate.
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

const chartIds = ['chartBattery', 'chartPowerIn', 'chartDischarge', 'chartBatteryLife'];

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
const powerInGetter = (row) => toNumber(row.power_in);
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

const CHART_CONFIG = {
  chartBattery: { getter: batteryGetter, unit: 'Percentage (%)', area: true },
  chartPowerIn: { getter: powerInGetter, unit: 'W', area: false },
  chartDischarge: { getter: dischargeGetter, unit: 'W', area: false },
  chartBatteryLife: { getter: lifeGetter, unit: 'Hours', area: false },
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
 * Build the value series for one controller across the current time axis.
 */
function seriesData(controller, getter) {
  const rowByTime = new Map();
  currentData.forEach((row) => {
    if (row.controller === controller && !rowByTime.has(row.timestamp_iso)) {
      rowByTime.set(row.timestamp_iso, row);
    }
  });
  return currentTimes.map((time) => {
    const row = rowByTime.get(time);
    return row ? getter(row) : null;
  });
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

function buildOption(unit, getter, area) {
  return {
    tooltip: { trigger: 'axis' },
    legend: { data: currentControllers },
    xAxis: { type: 'category', data: currentTimes },
    yAxis: { type: 'value', name: unit },
    dataZoom: [{ type: 'inside' }, { type: 'slider' }],
    series: buildSeries(getter, area),
  };
}

function renderCharts() {
  chartIds.forEach((id) => {
    disposeChart(id);
    const config = CHART_CONFIG[id];
    const chart = initChart(id, buildOption(config.unit, config.getter, config.area));
    if (chart) chartInstances.set(id, chart);
    else chartInstances.delete(id);
  });
  syncChartZoom(chartIds);
}

/**
 * Rebuild only the discharge-rate and battery-life series in place so the
 * user keeps their current zoom window when moving the offset slider.
 */
function updateOffsetCharts() {
  ['chartDischarge', 'chartBatteryLife'].forEach((id) => {
    const chart = chartInstances.get(id);
    if (!chart) return;
    const config = CHART_CONFIG[id];
    chart.setOption(
      { series: buildSeries(config.getter, config.area) },
      { replaceMerge: ['series'] }
    );
  });
}

/**
 * Setup the unmeasured-discharge offset slider (0-30 W, default 15 W).
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