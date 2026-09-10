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
import { initChart, resizeAllCharts, getColorForController } from '../shared/chartUtils.js';
import { getURLParams, setURLParams, getDefaultDateRange, getLastNDays } from '../utils/urlParams.js';
import { getColor } from '../shared/colorScheme.js';

let currentData = [];
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
    currentControllers = getUniqueControllers(currentData);
    currentSeaStates = getSeaStateScatter(currentData);

    // Render charts
    renderAvgPowerChart();
    renderEfficiencyChart();
    renderHsScatterChart();
    renderTpScatterChart();
    renderSeaStateScatterChart();
    renderControllerList();

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
  const timeAxis = currentData.map((row) => row.timestamp_iso);
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
    title: { text: 'Average Power (W)' },
    tooltip: { trigger: 'axis' },
    legend: { data: currentControllers },
    xAxis: {
      type: 'category',
      data: timeAxis,
    },
    yAxis: { type: 'value', name: 'Watts' },
    series: powerSeries,
    dataZoom: [{ type: 'slider', show: true, yAxisIndex: [0] }],
  };

  charts.avgPower = initChart('chart-avg-power', option);
}

/**
 * Render efficiency chart (large line/area chart).
 */
function renderEfficiencyChart() {
  const timeAxis = currentData.map((row) => row.timestamp_iso);
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
    title: { text: 'Efficiency (%)' },
    tooltip: { trigger: 'axis' },
    legend: { data: currentControllers },
    xAxis: {
      type: 'category',
      data: timeAxis,
    },
    yAxis: { type: 'value', name: 'Percentage' },
    series: efficiencySeries,
    dataZoom: [{ type: 'slider', show: true }],
  };

  charts.efficiency = initChart('chart-efficiency', option);
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
    title: { text: 'Wave Height - Hs (m)' },
    tooltip: { trigger: 'item' },
    xAxis: { type: 'category', name: 'Time' },
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
  };

  charts.hsScatter = initChart('chart-hs-scatter', option);
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
    title: { text: 'Wave Period - Tp (s)' },
    tooltip: { trigger: 'item' },
    xAxis: { type: 'category', name: 'Time' },
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
  };

  charts.tpScatter = initChart('chart-tp-scatter', option);
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
    title: { text: 'Sea State (Tp vs Hs)' },
    tooltip: { trigger: 'item' },
    xAxis: { type: 'value', name: 'Tp (s)' },
    yAxis: { type: 'value', name: 'Hs (m)' },
    legend: { data: currentControllers },
    series,
  };

  charts.seaStateScatter = initChart('chart-sea-state-scatter', option);
}

/**
 * Render active controller list on the right sidebar.
 */
function renderControllerList() {
  const listContainer = document.getElementById('controller-list');
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
  const startInput = document.getElementById('date-start');
  const endInput = document.getElementById('date-end');

  if (!startInput || !endInput) return;

  // Set current values
  const urlParams = getURLParams();
  const defaultRange = getDefaultDateRange(manifest);
  const startDate = urlParams.start || defaultRange.start;
  const endDate = urlParams.end || defaultRange.end;

  startInput.valueAsDate = startDate;
  endInput.valueAsDate = endDate;

  // Handle changes
  const handleDateChange = () => {
    const start = startInput.valueAsDate;
    const end = endInput.valueAsDate;

    if (start && end && start <= end) {
      fetchAndRenderData(start, end);
    }
  };

  startInput.addEventListener('change', handleDateChange);
  endInput.addEventListener('change', handleDateChange);
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