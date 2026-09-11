/**
 * Selector Display page (Page 2) initialization and state management.
 * Multi-chart, multi-filter view for detailed inspection.
 */

import { initNavigation } from '../shared/navigation.js';
import {
  fetchManifest,
  fetchDataForDateRange,
  getUniqueControllers,
  getSeaStateScatter,
  parseCSV,
} from '../shared/dataFetcher.js';
import { initChart, resizeAllCharts, getColorForController } from '../shared/chartUtils.js';
import { getURLParams, setURLParams, getDefaultDateRange } from '../utils/urlParams.js';
import { getColor } from '../shared/colorScheme.js';

let currentData = [];
let currentControllers = [];
let currentSeaStates = [];
let selectedControllers = new Set();
let selectedSeaStates = new Set();
let chartTypes = [];
let charts = {};

const chartTypesConfig = {
  avg_power: { label: 'Avg Power', unit: 'W' },
  efficiency: { label: 'Efficiency', unit: '%' },
  power_in: { label: 'Power In', unit: 'W' },
  power_out: { label: 'Power Out', unit: 'W' },
  battery_pct: { label: 'Battery %', unit: '%' },
  sea_state_energy: { label: 'Sea State Energy', unit: 'J/m²' },
  hs: { label: 'Wave Height (Hs)', unit: 'm' },
  tp: { label: 'Wave Period (Tp)', unit: 's' },
  peaks: { label: 'Peaks', unit: 'count' },
};

/**
 * Initialize the selector display page.
 */
async function init() {
  initNavigation();

  try {
    const manifest = await fetchManifest();
    const urlParams = getURLParams();
    const defaultRange = getDefaultDateRange(manifest);

    const startDate = urlParams.start || defaultRange.start;
    const endDate = urlParams.end || defaultRange.end;

    // Fetch data
    await fetchAndRenderData(startDate, endDate, urlParams);

    // Setup event listeners
    setupDateRangePicker(manifest, startDate, endDate);
    setupFilterListeners();
    setupChartTypeSelectors();

    window.addEventListener('resize', () => resizeAllCharts());
  } catch (error) {
    console.error('Selector page initialization error:', error);
    showError('Failed to load data. Please refresh the page.');
  }
}

/**
 * Fetch data and initialize all UI components.
 */
async function fetchAndRenderData(startDate, endDate, urlParams = {}) {
  try {
    showLoadingState(true);

    currentData = await fetchDataForDateRange(startDate, endDate);
    currentControllers = getUniqueControllers(currentData);
    currentSeaStates = getSeaStateScatter(currentData);

    // Restore filter state from URL or default
    selectedControllers = new Set(
      urlParams.controllers && urlParams.controllers.length > 0
        ? urlParams.controllers
        : currentControllers
    );
    selectedSeaStates = new Set(
      urlParams.seaStates && urlParams.seaStates.length > 0
        ? urlParams.seaStates.map((ss) => `${ss.hs},${ss.tp}`)
        : currentSeaStates.map((ss) => `${ss.hs},${ss.tp}`)
    );

    // Initialize UI
    renderControllerCheckboxes();
    renderSeaStateScatter();
    renderCharts();

    showLoadingState(false);
  } catch (error) {
    console.error('Error fetching data:', error);
    showLoadingState(false);
    showError('Failed to fetch data for the selected range.');
  }
}

/**
 * Render controller selector checkboxes.
 */
function renderControllerCheckboxes() {
  const container = document.getElementById('controller-selector');
  if (!container) return;

  container.innerHTML = '';

  currentControllers.forEach((controller) => {
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
    checkbox.value = controller;
    checkbox.checked = selectedControllers.has(controller);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        selectedControllers.add(controller);
      } else {
        selectedControllers.delete(controller);
      }
      updateCharts();
      updateURLParams();
    });

    const indicator = document.createElement('span');
    indicator.textContent = '●';
    indicator.style.color = getColor(
      currentControllers.indexOf(controller)
    );

    label.appendChild(checkbox);
    label.appendChild(indicator);
    label.appendChild(document.createTextNode(controller));
    container.appendChild(label);
  });
}

/**
 * Render sea state scatter selector.
 */
function renderSeaStateScatter() {
  const container = document.getElementById('seaStateScatter');
  if (!container) return;

  const controllerMap = Object.fromEntries(
    currentControllers.map((c, i) => [c, i])
  );

  // Create scatter plot showing all sea states
  const scatterData = currentSeaStates.map((ss) => ({
    value: [parseFloat(ss.tp), parseFloat(ss.hs)],
    key: `${ss.tp},${ss.hs}`,
    controllers: Array.from(ss.controllers),
  }));

  const option = {
    title: { text: 'Sea State Selection (Tp vs Hs)' },
    tooltip: { trigger: 'item' },
    xAxis: { type: 'value', name: 'Tp (s)' },
    yAxis: { type: 'value', name: 'Hs (m)' },
    series: [
      {
        name: 'Sea States',
        data: scatterData.map((d) => ({
          ...d,
          itemStyle: {
            color: selectedSeaStates.has(d.key) ? '#333333' : '#cccccc',
            opacity: selectedSeaStates.has(d.key) ? 1 : 0.5,
          },
        })),
        type: 'scatter',
        symbolSize: 8,
        itemStyle: { borderColor: '#333333', borderWidth: 1 },
      },
    ],
  };

  const chart = initChart('seaStateScatter', option);

  // Add click handler
  chart.on('click', (params) => {
    if (params.data && params.data.key) {
      if (selectedSeaStates.has(params.data.key)) {
        selectedSeaStates.delete(params.data.key);
      } else {
        selectedSeaStates.add(params.data.key);
      }
      updateCharts();
      updateURLParams();
      renderSeaStateScatter(); // Re-render to update visual state
    }
  });
}

/**
 * Setup chart type selectors (3 dropdowns).
 */
function setupChartTypeSelectors() {
  const typeOptions = Object.keys(chartTypesConfig);

  for (let i = 1; i <= 3; i++) {
    const selector = document.getElementById(`chart-type-${i}`);
    if (!selector) continue;

    selector.innerHTML = '<option value="">Select chart type</option>';
    typeOptions.forEach((type) => {
      const option = document.createElement('option');
      option.value = type;
      option.textContent = chartTypesConfig[type].label;
      selector.appendChild(option);
    });

    // Set default values
    if (i === 1) selector.value = 'avg_power';
    if (i === 2) selector.value = 'efficiency';

    selector.addEventListener('change', () => {
      chartTypes[i - 1] = selector.value;
      renderCharts();
      updateURLParams();
    });
  }
}

/**
 * Render the three main charts.
 */
function renderCharts() {
  chartTypes = [
    document.getElementById('chart-type-1')?.value || 'avg_power',
    document.getElementById('chart-type-2')?.value || 'efficiency',
    document.getElementById('chart-type-3')?.value || '',
  ].filter((t) => t);

  chartTypes.forEach((chartType, index) => {
    const chartId = `chart-${index + 1}`;
    renderChart(chartId, chartType, index);
  });
}

/**
 * Render a single chart with filtering and overlays.
 */
function renderChart(chartId, chartType, chartIndex) {
  const container = document.getElementById(chartId);
  if (!container) return;

  // Filter data based on selections
  const filteredData = currentData.filter((row) => {
    const hasController = selectedControllers.has(row.controller);
    const seaStateKey = `${row.tp},${row.hs}`;
    const hasSeaState = selectedSeaStates.has(seaStateKey);
    return hasController && hasSeaState;
  });

  // Build series
  const timeAxis = filteredData.map((row) => row.timestamp_iso);
  const series = currentControllers.map((controller) => ({
    name: controller,
    data: filteredData.map((row) =>
      row.controller === controller && selectedControllers.has(controller)
        ? parseFloat(row[chartType]) || null
        : null
    ),
    type: 'line',
    smooth: true,
    color: getColor(currentControllers.indexOf(controller)),
  }));

  const option = {
    title: { text: chartTypesConfig[chartType]?.label || chartType },
    tooltip: { trigger: 'axis' },
    legend: { data: currentControllers },
    xAxis: {
      type: 'category',
      data: timeAxis,
    },
    yAxis: {
      type: 'value',
      name: chartTypesConfig[chartType]?.unit || '',
    },
    series,
    dataZoom: [{ type: 'slider', show: true }],
  };

  charts[chartId] = initChart(chartId, option);
}

/**
 * Update all charts with current filter state.
 */
function updateCharts() {
  renderCharts();
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
      const urlParams = getURLParams();
      fetchAndRenderData(start, end, urlParams);
    }
  };

  startInput.addEventListener('change', handleDateChange);
  endInput.addEventListener('change', handleDateChange);
}

/**
 * Setup filter event listeners.
 */
function setupFilterListeners() {
  // Listeners are set up in renderControllerCheckboxes and setupChartTypeSelectors
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
    controllers: Array.from(selectedControllers),
    seaStates: Array.from(selectedSeaStates).map((key) => {
      const [tp, hs] = key.split(',');
      return { tp: parseFloat(tp), hs: parseFloat(hs) };
    }),
    chartTypes: chartTypes.filter((t) => t),
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