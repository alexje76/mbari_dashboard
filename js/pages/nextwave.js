/**
 * Next Wave page (Page 4) initialization and state management.
 * Experimental next-wave prediction data tracking.
 */

import { initNavigation } from '../shared/navigation.js';
import {
  fetchManifest,
  fetchDataForDateRange,
  getUniqueControllers,
} from '../shared/dataFetcher.js';
import { initChart, resizeAllCharts } from '../shared/chartUtils.js';
import { getURLParams, setURLParams, getLastNDays } from '../utils/urlParams.js';
import { getColor } from '../shared/colorScheme.js';

const NEXTWAVE_COLUMNS = [
  { name: 'nextwave', label: 'NextWave State', unit: 'state' },
  { name: 'nextwave_error', label: 'NextWave Error', unit: 'RMS' },
  { name: 'nextwave_error_2', label: 'NextWave Error 2', unit: 'value' },
];

let currentData = [];
let selectedCharts = new Set(['nextwave', 'nextwave_error', 'nextwave_error_2']);
let charts = {};

/**
 * Initialize the next wave page.
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

    // Restore selected charts from URL or use defaults
    if (urlParams.chartTypes && urlParams.chartTypes.length > 0) {
      selectedCharts = new Set(urlParams.chartTypes);
    }

    // Fetch and render
    await fetchAndRenderData(startDate, endDate);

    // Setup event listeners
    setupChartSelector();
    setupDateRangePicker(manifest, startDate, endDate);

    window.addEventListener('resize', () => resizeAllCharts());
  } catch (error) {
    console.error('Next Wave page initialization error:', error);
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

    // Render charts for selected columns
    renderCharts();

    // Update URL params
    setURLParams({
      start: startDate,
      end: endDate,
      chartTypes: Array.from(selectedCharts),
    });

    showLoadingState(false);
  } catch (error) {
    console.error('Error fetching data:', error);
    showLoadingState(false);
    showError('Failed to fetch data for the selected range.');
  }
}

/**
 * Setup chart selector checkboxes.
 */
function setupChartSelector() {
  const container = document.getElementById('chart-selector');
  if (!container) return;

  container.innerHTML = '';

  NEXTWAVE_COLUMNS.forEach((col) => {
    const label = document.createElement('label');
    label.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 0;
      cursor: pointer;
      font-size: 14px;
    `;

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = col.name;
    checkbox.checked = selectedCharts.has(col.name);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        selectedCharts.add(col.name);
      } else {
        selectedCharts.delete(col.name);
      }
      renderCharts();
      updateURLParams();
    });

    const labelText = document.createElement('span');
    labelText.textContent = col.label;

    label.appendChild(checkbox);
    label.appendChild(labelText);
    container.appendChild(label);
  });
}

/**
 * Render all selected charts stacked vertically.
 */
function renderCharts() {
  const selectedArray = Array.from(selectedCharts);

  selectedArray.forEach((chartName, index) => {
    const chartId = `chart-${index}`;
    const container = document.getElementById(`charts-container`);

    // Create or get container for this chart
    let chartDiv = document.getElementById(chartId);
    if (!chartDiv) {
      chartDiv = document.createElement('div');
      chartDiv.id = chartId;
      chartDiv.style.cssText = `
        width: 100%;
        height: ${100 / selectedArray.length}%;
        min-height: 300px;
        margin-bottom: 16px;
      `;
      container?.appendChild(chartDiv);
    }

    renderChart(chartId, chartName);
  });

  // Remove charts that are no longer selected
  const chartsContainer = document.getElementById(`charts-container`);
  if (chartsContainer) {
    const allChartDivs = chartsContainer.querySelectorAll('[id^="chart-"]');
    allChartDivs.forEach((div, index) => {
      if (index >= selectedArray.length) {
        div.remove();
      }
    });
  }
}

/**
 * Render a single next-wave chart.
 */
function renderChart(chartId, columnName) {
  const chartConfig = NEXTWAVE_COLUMNS.find((c) => c.name === columnName);
  if (!chartConfig) return;

  const timeAxis = currentData.map((row) => row.timestamp_iso);

  let series;

  if (columnName === 'nextwave') {
    // Categorical state chart
    series = [
      {
        name: 'NextWave State',
        data: currentData.map((row) => row.nextwave || ''),
        type: 'line',
        smooth: true,
        color: '#7570b3',
      },
    ];
  } else {
    // Numeric chart
    series = [
      {
        name: chartConfig.label,
        data: currentData.map((row) => parseFloat(row[columnName]) || null),
        type: 'line',
        smooth: true,
        color: '#d95f02',
        areaStyle: { opacity: 0.3 },
      },
    ];
  }

  const option = {
    title: { text: chartConfig.label },
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: timeAxis,
    },
    yAxis: {
      type: columnName === 'nextwave' ? 'category' : 'value',
      name: chartConfig.unit,
    },
    series,
    dataZoom: [{ type: 'slider', show: true }],
  };

  charts[chartId] = initChart(chartId, option);
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
 * Update URL params with current state.
 */
function updateURLParams() {
  const startInput = document.getElementById('date-start');
  const endInput = document.getElementById('date-end');

  setURLParams({
    start: startInput?.valueAsDate,
    end: endInput?.valueAsDate,
    chartTypes: Array.from(selectedCharts),
  });
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