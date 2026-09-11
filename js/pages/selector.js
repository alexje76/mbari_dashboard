/** Selector Display page. */

import { initNavigation } from '../shared/navigation.js';
import {
  fetchManifest,
  fetchDataForDateRange,
  getUniqueControllers,
  getSeaStateScatter,
} from '../shared/dataFetcher.js';
import {
  initChart,
  resizeAllCharts,
  disposeChart,
  syncChartZoom,
  resetChartZoom,
  addVerticalBarOverlay,
} from '../shared/chartUtils.js';
import {
  getURLParams,
  setURLParams,
  getDefaultDateRange,
} from '../utils/urlParams.js';
import { getColor } from '../shared/colorScheme.js';

const BASE_PATH = '/mbari_dashboard';
const chartIds = ['chart1', 'chart2', 'chart3'];

let currentData = [];
let currentControllers = [];
let currentSeaStates = [];
let selectedControllers = new Set();
let selectedSeaStates = new Set();
let chartTypes = ['', '', ''];
let chartTypesConfig = {};

async function init() {
  initNavigation();
  try {
    const manifest = await fetchManifest();
    await loadChartTypes();
    setupChartTypeSelectors();

    const params = getURLParams();
    const defaults = getDefaultDateRange(manifest);
    const start = params.start || defaults.start;
    const end = params.end || defaults.end;

    setupDateRangePicker(manifest, start, end);
    await fetchAndRenderData(start, end, params);
    window.addEventListener('resize', resizeAllCharts);
  } catch (error) {
    console.error('Selector initialization error:', error);
    showLoading(false);
    showError(error.message || 'Failed to load selector data.');
  }
}

async function loadChartTypes() {
  const response = await fetch(`${BASE_PATH}/config/chartTypes.json`);
  if (!response.ok) throw new Error(`Chart configuration failed: ${response.status}`);
  const config = await response.json();
  (config.chartTypes || []).forEach((item) => {
    chartTypesConfig[item.name] = item;
  });
}

function setupChartTypeSelectors() {
  const container = document.getElementById('chartTypeSelectors');
  if (!container) throw new Error('Missing chart type selector container.');
  container.innerHTML = '';

  for (let i = 0; i < 3; i++) {
    const select = document.createElement('select');
    select.id = `chart-type-${i + 1}`;
    select.className = 'chart-type-select';
    select.innerHTML = '<option value="">Select chart type</option>';

    Object.values(chartTypesConfig).forEach((item) => {
      select.add(new Option(item.label, item.name));
    });

    select.value = i === 0 ? 'avg_power' : i === 1 ? 'efficiency' : '';
    chartTypes[i] = select.value;
    select.addEventListener('change', () => {
      chartTypes[i] = select.value;
      renderCharts();
      updateURLParams();
    });
    container.appendChild(select);
  }
}

async function fetchAndRenderData(start, end, params = {}) {
  showLoading(true);
  hideError();
  try {
    const rows = await fetchDataForDateRange(start, end);
    const startTime = new Date(start).getTime();
    const endTime = new Date(end).getTime();
    currentData = rows.filter((row) => {
      const time = Date.parse(row.timestamp_iso);
      return Number.isFinite(time) && time >= startTime && time <= endTime;
    });

    if (!currentData.length) throw new Error('No data was found for the selected date range.');

    currentControllers = getUniqueControllers(currentData);
    currentSeaStates = getSeaStateScatter(currentData);
    selectedControllers = new Set(
      params.controllers?.length ? params.controllers : currentControllers
    );
    selectedSeaStates = new Set(
      params.seaStates?.length
        ? params.seaStates.map(({ hs, tp }) => `${hs},${tp}`)
        : currentSeaStates.map(({ hs, tp }) => `${hs},${tp}`)
    );

    renderControllerCheckboxes();
    renderSeaStateScatter();
    renderCharts();
    showLoading(false);
  } catch (error) {
    showLoading(false);
    showError(error.message || 'Failed to load data for the selected range.');
    throw error;
  }
}

function renderControllerCheckboxes() {
  const container = document.getElementById('controllerCheckboxes');
  if (!container) throw new Error('Missing controller checkbox container.');
  container.innerHTML = '';

  currentControllers.forEach((controller, index) => {
    const label = document.createElement('label');
    label.className = 'controller-option';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selectedControllers.has(controller);
    checkbox.addEventListener('change', () => {
      checkbox.checked ? selectedControllers.add(controller) : selectedControllers.delete(controller);
      renderCharts();
      updateURLParams();
    });
    const swatch = document.createElement('span');
    swatch.textContent = '●';
    swatch.style.color = getColor(index);
    label.append(checkbox, swatch, document.createTextNode(` ${controller}`));
    container.appendChild(label);
  });
}

function renderSeaStateScatter() {
  const data = currentSeaStates.map((state) => {
    const key = `${state.hs},${state.tp}`;
    return {
      key,
      value: [state.tp, state.hs],
      itemStyle: {
        color: selectedSeaStates.has(key) ? '#333' : '#ccc',
        opacity: selectedSeaStates.has(key) ? 1 : 0.5,
      },
    };
  });
  const chart = initChart('seaStateScatter', {
    tooltip: { trigger: 'item' },
    xAxis: { type: 'value', name: 'Tp (s)' },
    yAxis: { type: 'value', name: 'Hs (m)' },
    series: [{ type: 'scatter', symbolSize: 9, data }],
  });
  if (chart && !chart.__selectorClickBound) {
    chart.__selectorClickBound = true;
    chart.on('click', ({ data: point }) => {
      if (!point?.key) return;
      selectedSeaStates.has(point.key)
        ? selectedSeaStates.delete(point.key)
        : selectedSeaStates.add(point.key);
      renderSeaStateScatter();
      renderCharts();
      updateURLParams();
    });
  }
}

function renderCharts() {
  chartIds.forEach((id, index) => {
    const type = chartTypes[index];
    if (!type) {
      disposeChart(id);
      const el = document.getElementById(id);
      if (el) el.innerHTML = '<p class="empty-chart">Select a chart type.</p>';
      return;
    }
    renderChart(id, type, index);
  });
  syncChartZoom(chartIds);
}

function renderChart(id, type, index) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing chart element: ${id}`);
  disposeChart(id);

  const timelineRows = currentData.filter((row) =>
    selectedSeaStates.has(`${row.hs},${row.tp}`)
  );
  const times = [...new Set(timelineRows.map((row) => row.timestamp_iso))];
  const activeControllers = currentControllers.filter((controller) =>
    selectedControllers.has(controller)
  );

  // Shade only intervals where none of the selected controllers has data.
  const missingRanges = getMissingControllerRanges(timelineRows, times);

  const series = activeControllers.map((controller) => {
    const controllerIndex = currentControllers.indexOf(controller);
    const valuesByTime = new Map(
      timelineRows
        .filter((row) => row.controller === controller)
        .map((row) => [row.timestamp_iso, valueForChart(row[type])])
    );

    return {
      name: controller,
      type: 'line',
      smooth: true,
      connectNulls: false,
      data: times.map((time) => valuesByTime.get(time) ?? null),
      itemStyle: { color: getColor(controllerIndex) },
      lineStyle: { color: getColor(controllerIndex) },
    };
  });

  const chart = initChart(id, {
    tooltip: { trigger: 'axis' },
    legend: { data: activeControllers },
    xAxis: { type: 'category', data: times },
    yAxis: { type: 'value', name: chartTypesConfig[type]?.unit || '' },
    dataZoom: [{ type: 'inside' }, { type: 'slider' }],
    series,
  });

  if (chart) addVerticalBarOverlay(chart, missingRanges, {});
  document.getElementById(`chart${index + 1}Title`).textContent =
    chartTypesConfig[type]?.label || type;
}

function getMissingControllerRanges(rows, times) {
  const hasSelectedData = new Set(
    rows
      .filter((row) => selectedControllers.has(row.controller))
      .map((row) => row.timestamp_iso)
  );
  const ranges = [];
  let start = null;

  times.forEach((time, index) => {
    if (!hasSelectedData.has(time) && start === null) start = index;
    if (hasSelectedData.has(time) && start !== null) {
      ranges.push({
        start: Math.max(0, start - 0.5),
        end: index - 0.5,
        type: 'controller',
      });
      start = null;
    }
  });

  if (start !== null && times.length) {
    ranges.push({
      start: Math.max(0, start - 0.5),
      end: times.length - 0.5,
      type: 'controller',
    });
  }

  return ranges;
}

function valueForChart(value) {
  if (value === '' || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : value;
}

function setupDateRangePicker(manifest, start, end) {
  const startInput = document.getElementById('startDate');
  const endInput = document.getElementById('endDate');
  if (!startInput || !endInput) throw new Error('Missing date range inputs.');

  startInput.value = toDateInputValue(start);
  endInput.value = toDateInputValue(end);
  const apply = () => {
    const nextStart = new Date(`${startInput.value}T00:00:00Z`);
    const nextEnd = new Date(`${endInput.value}T23:59:59.999Z`);
    if (Number.isNaN(nextStart.getTime()) || Number.isNaN(nextEnd.getTime()) || nextStart > nextEnd) {
      showError('Choose a valid date range.');
      return;
    }
    resetChartZoom(chartIds);
    fetchAndRenderData(nextStart, nextEnd, getURLParams()).catch(() => {});
  };
  document.getElementById('applyDateRange')?.addEventListener('click', apply);
  document.getElementById('resetDateRange')?.addEventListener('click', () => {
    startInput.value = toDateInputValue(manifest.availableDateRange.minDate);
    endInput.value = toDateInputValue(manifest.availableDateRange.maxDate);
    apply();
  });
}

function toDateInputValue(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function updateURLParams() {
  const start = document.getElementById('startDate')?.value;
  const end = document.getElementById('endDate')?.value;
  setURLParams({
    start: start ? new Date(`${start}T00:00:00Z`) : null,
    end: end ? new Date(`${end}T23:59:59.999Z`) : null,
    controllers: [...selectedControllers],
    seaStates: [...selectedSeaStates].map((key) => {
      const [hs, tp] = key.split(',').map(Number);
      return { hs, tp };
    }),
    chartTypes,
  });
}

function showLoading(show) {
  const el = document.getElementById('loadingIndicator');
  if (el) el.hidden = !show;
}
function hideError() {
  const el = document.getElementById('errorMessage');
  if (el) {
    el.hidden = true;
    el.textContent = '';
  }
}
function showError(message) {
  const el = document.getElementById('errorMessage');
  if (el) {
    el.textContent = message;
    el.hidden = false;
  }
}

document.addEventListener('DOMContentLoaded', init);
export { init };
