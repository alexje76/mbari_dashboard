/**
 * Next Wave page (Page 4) initialization and state management.
 * Experimental next-wave prediction data tracking. Renders one stacked chart
 * per chartTypes.json "prediction" column; the NextWave State column plots on a
 * categorical axis, error columns as numeric lines. Stacked charts share
 * synced X-axis zoom.
 */

import { initNavigation } from '../shared/navigation.js';
import {
  fetchManifest,
  fetchDataForDateRange,
} from '../shared/dataFetcher.js';
import {
  initChart,
  resizeAllCharts,
  disposeChart,
  syncChartZoom,
} from '../shared/chartUtils.js';
import { getURLParams, setURLParams, getLastNDays } from '../utils/urlParams.js';

const BASE_PATH = '/mbari_dashboard';

let currentData = [];
let currentTimes = [];
let chartTypesConfig = {};
let selectedCharts = new Set();
let currentChartIds = [];
let currentStartDate = null;
let currentEndDate = null;

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
    restoreSelectedCharts();
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
 * Restore the selected charts from the URL, defaulting to all prediction
 * columns. Unknown names are dropped.
 */
function restoreSelectedCharts() {
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
 * Setup chart selector checkboxes (all prediction columns from chartTypes.json).
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
        updateURLCharts();
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
    currentTimes = [...new Set(currentData.map((row) => row.timestamp_iso))].sort();

    renderCharts();

    setURLParams({
      start: startDate,
      end: endDate,
      chartTypes: Array.from(selectedCharts),
    });

    showLoading(false);
  } catch (error) {
    console.error('Error fetching data:', error);
    showLoading(false);
    showError('Failed to fetch data for the selected range.');
  }
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
 * Render all selected charts stacked vertically.
 */
function renderCharts() {
  const selectedArray = selectedColumns();
  const container = document.getElementById('chartsContainer');
  if (!container) return;

  const allChartDivs = container.querySelectorAll('[id^="chart-"]');
  allChartDivs.forEach((div) => {
    const index = Number(div.id.replace('chart-', ''));
    if (index >= selectedArray.length) {
      disposeChart(div.id);
      div.remove();
    }
  });

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
}

/**
 * Row for a given timestamp on the current time axis.
 */
function rowByTime(time) {
  return currentData.find((row) => row.timestamp_iso === time) || null;
}

/**
 * Build the option for one prediction column's chart.
 */
function buildChartOption(col) {
  const categorical = col.name === 'nextwave';
  const categories = categorical
    ? [
        ...new Set(
          currentData
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
 * Update only the chart-types URL param, preserving the current date range.
 */
function updateURLCharts() {
  setURLParams({
    start: currentStartDate,
    end: currentEndDate,
    chartTypes: Array.from(selectedCharts),
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