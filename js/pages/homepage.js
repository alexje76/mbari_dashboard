/**
 * Homepage initialization and state management.
 * Displays overview of power, efficiency, controllers, and sea states.
 */

import { initNavigation } from '../shared/navigation.js';
import {
  fetchManifest,
  fetchDataForDateRange,
  getUniqueControllers,
  getSeaStateScatter,
  filterByDateRange,
} from '../shared/dataFetcher.js';
import {
  initChart,
  resizeAllCharts,
  getColorForController,
  syncChartZoom,
  resetChartZoom,
  disposeChart,
} from '../shared/chartUtils.js';
import { getURLParams, setURLParams, getDefaultDateRange, getLastNDays } from '../utils/urlParams.js';
import { getColor } from '../shared/colorScheme.js';

const SYNCED_CHART_IDS = ['chartAvgPower', 'chartEfficiency', 'chartHs', 'chartTp'];
const ALL_CHART_IDS = [...SYNCED_CHART_IDS, 'chartSeaState'];

let currentData = [];
let currentTimeAxis = [];
let currentControllers = [];
let currentSeaStates = [];
let charts = {
  avgPower: null,
  efficiency: null,
  hsScatter: null,
  tpScatter: null,
  seaStateScatter: null,
};

/**
 * Initialize the homepage.
 */
async function init() {
  initNavigation();

  try {
    // Get manifest and validate date range from URL
    const manifest = await fetchManifest();
    const urlParams = getURLParams();
    const defaultRange = getDefaultDateRange(manifest);

    const startDate = urlParams.start || defaultRange.start;
    const endDate = urlParams.end || defaultRange.end;

    // Fetch data
    await fetchAndRenderData(startDate, endDate);

    // Setup event listeners
    setupDateRangePicker(manifest);
    window.addEventListener('resize', () => resizeAllCharts());
  } catch (error) {
    console.error('Homepage initialization error:', error);
    showError('Failed to load data. Please refresh the page.');
  }
}

/**
 * Fetch data for date range and render all charts.
 */
async function fetchAndRenderData(startDate, endDate) {
  try {
    // Show loading state
    showLoadingState(true);

    // Fetch data
    currentData = await fetchDataForDateRange(startDate, endDate);
    currentTimeAxis = currentData.map((row) => row.timestamp_iso);
    currentControllers = getUniqueControllers(currentData);
    currentSeaStates = getSeaStateScatter(currentData);

    // Render charts
    ALL_CHART_IDS.forEach((id) => disposeChart(id));
    renderAvgPowerChart();
    renderEfficiencyChart();
    renderHsScatterChart();
    renderTpScatterChart();
    renderSeaStateScatterChart();
    renderControllerList();
    syncChartZoom(SYNCED_CHART_IDS);

    // Update URL params
    setURLParams({
      start: startDate,
      end: endDate,
    });

    showLoadingState(false);
  } catch (error) {
    console.error('Error fetching data:', error);
    showLoadingState(false);
    showError('Failed to fetch data for the selected range.');
  }
}

/**
 * Render average power chart (large line/area chart).
 */
function renderAvgPowerChart() {
  const powerSeries = currentControllers.map((controller) => ({
    name: controller,
    data: currentData.map((row) =>
      row.controller === controller ? parseFloat(row.avg_power) || null : null
    ),
    type: 'line',
    smooth: true,
    color: getColorForController(
      controller,
      Object.fromEntries(currentControllers.map((c, i) => [c, i]))
    ),
  }));

  const option = {
    tooltip: { trigger: 'axis' },
    legend: { data: currentControllers },
    xAxis: {
      type: 'category',
      data: currentTimeAxis,
    },
    yAxis: { type: 'value', name: 'Watts' },
    series: powerSeries,
    dataZoom: [{ type: 'inside' }, { type: 'slider' }],
  };

  charts.avgPower = initChart('chartAvgPower', option);
}

/**
 * Render efficiency chart (large line/area chart).
 */
function renderEfficiencyChart() {
  const efficiencySeries = currentControllers.map((controller) => ({
    name: controller,
    data: currentData.map((row) =>
      row.controller === controller ? parseFloat(row.efficiency) || null : null
    ),
    type: 'line',
    smooth: true,
    color: getColorForController(
      controller,
      Object.fromEntries(currentControllers.map((c, i) => [c, i]))
    ),
  }));

  const option = {
    tooltip: { trigger: 'axis' },
    legend: { data: currentControllers },
    xAxis: {
      type: 'category',
      data: currentTimeAxis,
    },
    yAxis: { type: 'value', name: 'Percentage' },
    series: efficiencySeries,
    dataZoom: [{ type: 'inside' }, { type: 'slider' }],
  };

  charts.efficiency = initChart('chartEfficiency', option);
}

/**
 * Render Hs (wave height) scatter chart.
 */
function renderHsScatterChart() {
  const scatterData = currentData.map((row, index) => ({
    value: [index, parseFloat(row.hs) || 0],
    controller: row.controller,
  }));

  const option = {
    tooltip: { trigger: 'item' },
    xAxis: { type: 'category', name: 'Time', data: currentTimeAxis },
    yAxis: { type: 'value', name: 'Hs (m)' },
    series: [
      {
        name: 'Hs',
        data: scatterData,
        type: 'scatter',
        symbolSize: 4,
        itemStyle: {
          color: (params) => {
            const controller = params.data.controller;
            const index = currentControllers.indexOf(controller);
            return getColor(index);
          },
        },
      },
    ],
    dataZoom: [{ type: 'inside' }, { type: 'slider' }],
  };

  charts.hsScatter = initChart('chartHs', option);
}

/**
 * Render Tp (wave period) scatter chart.
 */
function renderTpScatterChart() {
  const scatterData = currentData.map((row, index) => ({
    value: [index, parseFloat(row.tp) || 0],
    controller: row.controller,
  }));

  const option = {
    tooltip: { trigger: 'item' },
    xAxis: { type: 'category', name: 'Time', data: currentTimeAxis },
    yAxis: { type: 'value', name: 'Tp (s)' },
    series: [
      {
        name: 'Tp',
        data: scatterData,
        type: 'scatter',
        symbolSize: 4,
        itemStyle: {
          color: (params) => {
            const controller = params.data.controller;
            const index = currentControllers.indexOf(controller);
            return getColor(index);
          },
        },
      },
    ],
    dataZoom: [{ type: 'inside' }, { type: 'slider' }],
  };

  charts.tpScatter = initChart('chartTp', option);
}

/**
 * Render sea state scatter chart (Tp vs Hs, colored by controller).
 */
function renderSeaStateScatterChart() {
  // Group sea states by controller
  const controllerMap = Object.fromEntries(
    currentControllers.map((c, i) => [c, i])
  );

  const series = currentControllers.map((controller) => {
    const seaStatesForController = currentSeaStates
      .filter((ss) => ss.controllers.has(controller))
      .map((ss) => [parseFloat(ss.tp), parseFloat(ss.hs)]);

    return {
      name: controller,
      data: seaStatesForController,
      type: 'scatter',
      symbolSize: 6,
      color: getColor(controllerMap[controller]),
    };
  });

  const option = {
    tooltip: { trigger: 'item' },
    xAxis: { type: 'value', name: 'Tp (s)' },
    yAxis: { type: 'value', name: 'Hs (m)' },
    legend: { data: currentControllers },
    series,
  };

  charts.seaStateScatter = initChart('chartSeaState', option);
}

/**
 * Render active controller list on the right sidebar.
 */
function renderControllerList() {
  const listContainer = document.getElementById('controllerList');
  if (!listContainer) return;

  listContainer.innerHTML = '';

  const controllerMap = Object.fromEntries(
    currentControllers.map((c, i) => [c, i])
  );

  currentControllers.forEach((controller) => {
    const item = document.createElement('div');
    item.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 0;
      font-size: 14px;
      color: #333333;
    `;

    const indicator = document.createElement('span');
    indicator.textContent = '●';
    indicator.style.cssText = `
      color: ${getColor(controllerMap[controller])};
      font-size: 16px;
    `;

    const label = document.createElement('span');
    label.textContent = controller;

    item.appendChild(indicator);
    item.appendChild(label);
    listContainer.appendChild(item);
  });
}

/**
 * Setup date range picker with event listeners.
 */
function setupDateRangePicker(manifest) {
  const startInput = document.getElementById('startDate');
  const endInput = document.getElementById('endDate');
  const applyButton = document.getElementById('applyDateRange');
  const resetButton = document.getElementById('resetDateRange');

  if (!startInput || !endInput || !applyButton || !resetButton) return;

  // Set current values
  const urlParams = getURLParams();
  const defaultRange = getDefaultDateRange(manifest);
  const startDate = urlParams.start || defaultRange.start;
  const endDate = urlParams.end || defaultRange.end;

  startInput.value = toDateInputValue(startDate);
  endInput.value = toDateInputValue(endDate);

  // Handle changes
  const apply = () => {
    const start = toDateInputValue(startInput.value);
    const end = toDateInputValue(endInput.value);
    if (!start || !end || start > end) {
      console.warn('Invalid date range:', startInput.value, endInput.value);
      return;
    }
    resetChartZoom(SYNCED_CHART_IDS);
    fetchAndRenderData(new Date(`${start}T00:00:00Z`), new Date(`${end}T23:59:59.999Z`));
  };

  applyButton.addEventListener('click', apply);
  resetButton.addEventListener('click', () => {
    startInput.value = toDateInputValue(manifest.availableDateRange.minDate);
    endInput.value = toDateInputValue(manifest.availableDateRange.maxDate);
    apply();
  });
}

/**
 * Convert a Date or ISO string to YYYY-MM-DD for date input values.
 * @param {Date|string} value - Date object or ISO string
 * @returns {string} - YYYY-MM-DD
 */
function toDateInputValue(value) {
  return new Date(value).toISOString().slice(0, 10);
}

/**
 * Show or hide loading state.
 */
function showLoadingState(isLoading) {
  const loader = document.getElementById('loading-indicator');
  if (loader) {
    loader.style.display = isLoading ? 'block' : 'none';
  }
}

/**
 * Show error message.
 */
function showError(message) {
  const errorContainer = document.getElementById('error-message');
  if (errorContainer) {
    errorContainer.textContent = message;
    errorContainer.style.display = 'block';
  }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', init);

export { init };