/**
 * Power Usage page (Page 3) initialization and state management.
 * Battery percentage tracking over time.
 */

import { initNavigation } from '../shared/navigation.js';
import {
  fetchManifest,
  fetchDataForDateRange,
  getUniqueControllers,
} from '../shared/dataFetcher.js';
import { initChart, resizeAllCharts, getColorForController } from '../shared/chartUtils.js';
import { getURLParams, setURLParams, getLastNDays } from '../utils/urlParams.js';
import { getColor } from '../shared/colorScheme.js';

let currentData = [];
let currentControllers = [];
let charts = {};

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

    // Fetch and render
    await fetchAndRenderData(startDate, endDate);

    // Setup event listeners
    setupDateRangePicker(manifest, startDate, endDate);

    window.addEventListener('resize', () => resizeAllCharts());
  } catch (error) {
    console.error('Power page initialization error:', error);
    showError('Failed to load data. Please refresh the page.');
  }
}

/**
 * Fetch data for date range and render charts.
 */
async function fetchAndRenderData(startDate, endDate) {
  try {
    showLoadingState(true);

    currentData = await fetchDataForDateRange(startDate, endDate);
    currentControllers = getUniqueControllers(currentData);

    // Render charts
    renderBatteryChart();

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
 * Render battery percentage chart.
 */
function renderBatteryChart() {
  const timeAxis = currentData.map((row) => row.timestamp_iso);
  const batteryData = currentData.map((row) => parseFloat(row.battery_pct) || null);

  // Create series per controller if needed, or single series for overall battery
  const series = currentControllers.map((controller) => ({
    name: controller,
    data: currentData.map((row) =>
      row.controller === controller ? parseFloat(row.battery_pct) || null : null
    ),
    type: 'line',
    smooth: true,
    color: getColor(currentControllers.indexOf(controller)),
    areaStyle: { opacity: 0.3 },
  }));

  const option = {
    title: { text: 'Battery Percentage (%)' },
    tooltip: { trigger: 'axis' },
    legend: { data: currentControllers },
    xAxis: {
      type: 'category',
      data: timeAxis,
    },
    yAxis: {
      type: 'value',
      name: 'Percentage (%)',
      min: 0,
      max: 100,
    },
    series,
    dataZoom: [{ type: 'slider', show: true }],
  };

  charts.battery = initChart('chart-battery', option);
}

/**
 * Setup date range picker.
 */
function setupDateRangePicker(manifest, defaultStart, defaultEnd) {
  const startInput = document.getElementById('date-start');
  const endInput = document.getElementById('date-end');

  if (!startInput || !endInput) return;

  startInput.valueAsDate = defaultStart;
  endInput.valueAsDate = defaultEnd;

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