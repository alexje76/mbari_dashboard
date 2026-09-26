/**
 * Next Wave page (Page 4) initialization and state management.
 * Experimental next-wave prediction data tracking. Renders one stacked chart
 * per chartTypes.json "prediction" column, plus a Prediction Scatter chart with
 * selectable X/Y metrics (the NextWave State column maps to three axis
 * positions). A controller selector filters the whole page's rows; all
 * selections persist via URL params.
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

const BASE_PATH = '/mbari_dashboard';

// NextWave State -> axis positions (three ordered bands).
const STATE_POSITIONS = { Off: 1, Starting: 2, On: 3 };
const POSITION_NAMES = { 1: 'Off', 2: 'Starting', 3: 'On' };

let currentData = [];
let visibleRows = [];
let currentTimes = [];
let chartTypesConfig = {};
let selectedCharts = new Set();
let currentChartIds = [];
let currentStartDate = null;
let currentEndDate = null;
let selectedControllers = new Set();
let controllersInitialized = false;
let scatterX = null;
let scatterY = null;

const toNumber = (value) => {
  if (value === '' || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

/**
 * Initialize the next wave page.
 */
async function init() {
  initNavigation();

  try {
    const manifest = await fetchManifest();
    await loadChartTypes();
    restoreChartSelection();
    restoreScatterAxes();
    setupScatterSelects();
    setupChartSelector();

    const urlParams = getURLParams();
    const lastTwoDays = getLastNDays(2);
    const startDate = urlParams.start || lastTwoDays.start;
    const endDate = urlParams.end || lastTwoDays.end;

    setupDateRangePicker(manifest, startDate, endDate);
    await fetchAndRenderData(startDate, endDate);

    window.addEventListener('resize', () => resizeAllCharts());
  } catch (error) {
    console.error('Next Wave page initialization error:', error);
    showLoading(false);
    showError('Failed to load data. Please refresh the page.');
  }
}

/**
 * Load the chart-type catalog (source of the Next Wave columns).
 */
async function loadChartTypes() {
  const response = await fetch(`${BASE_PATH}/config/chartTypes.json`);
  if (!response.ok) throw new Error(`Chart configuration failed: ${response.status}`);
  const config = await response.json();
  (config.chartTypes || []).forEach((item) => {
    chartTypesConfig[item.name] = item;
  });
}

/**
 * Restore the selected stacked charts from the URL, defaulting to all
 * prediction columns. Unknown names are dropped.
 */
function restoreChartSelection() {
  const urlParams = getURLParams();
  const predictionNames = Object.values(chartTypesConfig)
    .filter((col) => col.category === 'prediction')
    .map((col) => col.name);
  if (urlParams.chartTypes && urlParams.chartTypes.length > 0) {
    selectedCharts = new Set(
      urlParams.chartTypes.filter((name) => predictionNames.includes(name))
    );
  } else {
    selectedCharts = new Set(predictionNames);
  }
}

/**
 * Restore scatter axis selections from the URL; validated in setupScatterSelects.
 */
function restoreScatterAxes() {
  const urlParams = getURLParams();
  scatterX = urlParams.scatterX || null;
  scatterY = urlParams.scatterY || null;
}

function numericColumns() {
  return Object.values(chartTypesConfig).filter((col) => col.name !== 'nextwave');
}

function scatterYColumns() {
  return ['nextwave_error', 'nextwave_error_2', 'nextwave']
    .map((name) => chartTypesConfig[name])
    .filter(Boolean);
}

/**
 * Setup the X/Y metric selects for the prediction scatter chart.
 */
function setupScatterSelects() {
  const xSelect = document.getElementById('scatterXAxis');
  const ySelect = document.getElementById('scatterYAxis');
  if (!xSelect || !ySelect) return;

  xSelect.innerHTML = '';
  numericColumns().forEach((col) => xSelect.add(new Option(col.label, col.name)));
  ySelect.innerHTML = '';
  scatterYColumns().forEach((col) => ySelect.add(new Option(col.label, col.name)));

  xSelect.value = numericColumns().some((col) => col.name === scatterX)
    ? scatterX
    : 'sea_state_energy';
  ySelect.value = scatterYColumns().some((col) => col.name === scatterY)
    ? scatterY
    : 'nextwave_error';

  scatterX = xSelect.value;
  scatterY = ySelect.value;

  xSelect.addEventListener('change', () => {
    scatterX = xSelect.value;
    renderCharts();
    updatePageURL();
  });
  ySelect.addEventListener('change', () => {
    scatterY = ySelect.value;
    renderCharts();
    updatePageURL();
  });
}

/**
 * Setup the stacked-chart selector checkboxes (all prediction columns).
 */
function setupChartSelector() {
  const container = document.getElementById('chartCheckboxes');
  if (!container) return;

  container.innerHTML = '';

  Object.values(chartTypesConfig)
    .filter((col) => col.category === 'prediction')
    .forEach((col) => {
      const label = document.createElement('label');
      label.style.cssText = `
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 4px 0;
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
        updatePageURL();
      });

      const labelText = document.createElement('span');
      labelText.textContent = col.label;

      label.appendChild(checkbox);
      label.appendChild(labelText);
      container.appendChild(label);
    });
}

/**
 * Fetch data for a date range and render charts.
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

    currentStartDate = startDate;
    currentEndDate = endDate;

    setupControllerSelector();

    renderCharts();
    updatePageURL();

    showLoading(false);
  } catch (error) {
    console.error('Error fetching data:', error);
    showLoading(false);
    showError('Failed to fetch data for the selected range.');
  }
}

/**
 * Build the controller checkboxes. Selection is restored from the URL on first
 * build and defaults to all controllers.
 */
function setupControllerSelector() {
  const container = document.getElementById('scatterControllerCheckboxes');
  if (!container) return;

  container.innerHTML = '';
  const allControllers = getUniqueControllers(currentData);

  if (!controllersInitialized) {
    const urlParams = getURLParams();
    if (urlParams.controllers && urlParams.controllers.length > 0) {
      selectedControllers = new Set(
        urlParams.controllers.filter((name) => allControllers.includes(name))
      );
    } else {
      selectedControllers = new Set(allControllers);
    }
    controllersInitialized = true;
  }

  allControllers.forEach((controller, index) => {
    const label = document.createElement('label');
    label.className = 'controller-option';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selectedControllers.has(controller);
    checkbox.addEventListener('change', () => {
      checkbox.checked
        ? selectedControllers.add(controller)
        : selectedControllers.delete(controller);
      renderCharts();
      updatePageURL();
    });
    const swatch = document.createElement('span');
    swatch.textContent = '●';
    swatch.style.color = getColor(index);
    label.append(checkbox, swatch, document.createTextNode(` ${controller}`));
    container.appendChild(label);
  });
}

/**
 * Rows currently visible: currentData filtered to the selected controllers.
 */
function visibleData() {
  if (!selectedControllers.size) return [];
  return currentData.filter((row) => selectedControllers.has(row.controller));
}

/**
 * Selected prediction columns, ordered as they appear in the config.
 */
function selectedColumns() {
  return Object.values(chartTypesConfig).filter(
    (col) => col.category === 'prediction' && selectedCharts.has(col.name)
  );
}

/**
 * Render the stacked charts and the prediction scatter.
 */
function renderCharts() {
  visibleRows = visibleData();
  const selectedArray = selectedColumns();
  const container = document.getElementById('chartsContainer');

  if (container) {
    const allChartDivs = container.querySelectorAll('[id^="chart-"]');
    allChartDivs.forEach((div) => {
      const index = Number(div.id.replace('chart-', ''));
      if (index >= selectedArray.length) {
        disposeChart(div.id);
        div.remove();
      }
    });
  }

  if (!visibleRows.length) {
    if (container) {
      container.querySelectorAll('[id^="chart-"]').forEach((div) => {
        disposeChart(div.id);
        div.remove();
      });
    }
    currentChartIds = [];
    renderScatterChart();
    return;
  }

  currentTimes = [...new Set(visibleRows.map((row) => row.timestamp_iso))].sort();

  const activeChartIds = [];
  selectedArray.forEach((col, index) => {
    const chartId = `chart-${index}`;
    activeChartIds.push(chartId);

    let chartDiv = document.getElementById(chartId);
    if (!chartDiv) {
      chartDiv = document.createElement('div');
      chartDiv.id = chartId;
      chartDiv.className = 'chart';
      chartDiv.style.cssText = 'width: 100%; height: 320px; margin-bottom: 16px;';
      container.appendChild(chartDiv);
    }

    disposeChart(chartId);
    initChart(chartId, buildChartOption(col));
  });

  currentChartIds = activeChartIds;
  syncChartZoom(currentChartIds);
  renderScatterChart();
}

/**
 * Row for a given timestamp on the current visible time axis.
 */
function rowByTime(time) {
  return visibleRows.find((row) => row.timestamp_iso === time) || null;
}

/**
 * Build the stacked-chart option for one prediction column.
 */
function buildChartOption(col) {
  const categorical = col.name === 'nextwave';
  const categories = categorical
    ? [
        ...new Set(
          visibleRows
            .map((row) => row[col.name])
            .filter((value) => value !== '' && value != null)
        ),
      ]
    : [];

  const series = [
    {
      name: col.label,
      type: 'line',
      smooth: !categorical,
      connectNulls: false,
      data: currentTimes.map((time) => {
        const row = rowByTime(time);
        if (!row) return null;
        if (categorical) {
          const value = row[col.name];
          return value === '' || value == null ? null : value;
        }
        return toNumber(row[col.name]);
      }),
      itemStyle: { color: '#d95f02' },
      lineStyle: { color: '#d95f02' },
      areaStyle: categorical ? undefined : { opacity: 0.3 },
    },
  ];

  return {
    tooltip: { trigger: 'axis', formatter: axisTooltipFormatter(col.unit) },
    legend: { data: [col.label], top: 0, left: 10 },
    xAxis: { type: 'category', data: currentTimes },
    yAxis: {
      type: categorical ? 'category' : 'value',
      name: col.unit,
      ...(categorical ? { data: categories } : {}),
    },
    dataZoom: [{ type: 'inside' }, { type: 'slider' }],
    series,
  };
}

/**
 * Build the scatter-chart option: X metric vs Y metric, colored per controller.
 * The NextWave State metric maps to the three axis positions.
 */
function renderScatterChart() {
  const chart = document.getElementById('chartScatter');
  const empty = document.getElementById('scatterEmpty');
  if (!chart) return;

  if (!visibleRows.length) {
    disposeChart('chartScatter');
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;

  const xConfig = chartTypesConfig[scatterX];
  const yConfig = chartTypesConfig[scatterY];
  const xIsState = scatterX === 'nextwave';
  const yIsState = scatterY === 'nextwave';

  const axisValue = (row, isState, metric) =>
    isState ? STATE_POSITIONS[row[metric]] : toNumber(row[metric]);

  const controllerIndex = new Map(
    getUniqueControllers(currentData).map((name, index) => [name, index])
  );

  const series = getUniqueControllers(visibleRows)
    .map((controller) => {
      const color = getColor(controllerIndex.get(controller) ?? 0);
      const points = [];
      visibleRows.forEach((row) => {
        if (row.controller !== controller) return;
        const x = axisValue(row, xIsState, scatterX);
        const y = axisValue(row, yIsState, scatterY);
        if (x === null || x === undefined || y === null || y === undefined) return;
        points.push({ value: [x, y], row });
      });
      return {
        name: controller,
        type: 'scatter',
        symbolSize: 6,
        itemStyle: { color },
        data: points,
      };
    })
    .filter((series) => series.data.length);

  const scatterAxis = (isState, metric) =>
    isState
      ? {
          type: 'value',
          min: 1,
          max: 3,
          interval: 1,
          name: 'State',
          axisLabel: { formatter: (value) => POSITION_NAMES[value] || '' },
        }
      : {
          type: 'value',
          name: `${metric?.label || ''}${metric?.unit ? ` (${metric.unit})` : ''}`,
        };

  const option = {
    tooltip: { trigger: 'item', formatter: scatterTooltipFormatter(xConfig, yConfig, xIsState, yIsState) },
    legend: {
      type: 'scroll',
      data: series.map((s) => s.name),
      top: 0,
      left: 10,
    },
    grid: { left: 70, right: 30, top: 40, bottom: 50 },
    xAxis: scatterAxis(xIsState, xConfig),
    yAxis: scatterAxis(yIsState, yConfig),
    dataZoom: [{ type: 'inside' }],
    series,
  };

  disposeChart('chartScatter');
  initChart('chartScatter', option);
}

function scatterTooltipFormatter(xConfig, yConfig, xIsState, yIsState) {
  return (params) => {
    const point = params.data || {};
    const [x, y] = point.value || [];
    const format = (value, isState, metric) =>
      isState
        ? POSITION_NAMES[value] || String(value)
        : `${Number(value).toFixed(2)}${metric?.unit ? ` ${metric.unit}` : ''}`;
    const lines = [
      point.row?.timestamp_iso ? `<b>${point.row.timestamp_iso}</b>` : '',
      `<span style="color:${params.color}">●</span> ${params.seriesName}`,
      `${xConfig?.label || scatterX}: ${format(x, xIsState, xConfig)}`,
      `${yConfig?.label || scatterY}: ${format(y, yIsState, yConfig)}`,
    ];
    return lines.filter(Boolean).join('<br/>');
  };
}

/**
 * Axis-trigger tooltip that lists only the series actually present at the
 * hovered point. Falls back to just the x-axis timestamp when nothing is drawn
 * there.
 */
function axisTooltipFormatter(unit) {
  return (params) => {
    const all = Array.isArray(params) ? params : [params];
    const timestamp =
      (all[0] && (all[0].axisValueLabel ?? all[0].axisValue ?? all[0].name)) || '';
    const rows = all.filter((p) => {
      const value = p.value;
      return value !== null && value !== undefined && value !== '-';
    });
    if (!rows.length) return timestamp ? `<b>${timestamp}</b>` : '';
    const lines = rows.map((p) => {
      const value = Array.isArray(p.value) ? p.value[p.value.length - 1] : p.value;
      const text =
        typeof value === 'number'
          ? (Number.isInteger(value) ? value.toFixed(0) : value.toFixed(2)) + (unit ? ` ${unit}` : '')
          : String(value);
      return `${p.marker || ''}${p.seriesName}: ${text}`;
    });
    return [timestamp ? `<b>${timestamp}</b>` : '', ...lines].filter(Boolean).join('<br/>');
  };
}

/**
 * Setup the date range picker.
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
 * Persist the full page state to the URL.
 */
function updatePageURL() {
  setURLParams({
    start: currentStartDate,
    end: currentEndDate,
    chartTypes: Array.from(selectedCharts),
    controllers: Array.from(selectedControllers),
    scatterX,
    scatterY,
  });
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