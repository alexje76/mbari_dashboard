/**
 * Chart utilities for ECharts initialization, zoom sync, and overlays.
 */

const echarts = window.echarts;
import {
  getColor,
  deselectedControllerGrey,
  deselectedSeaStatePattern,
  gridLineGrey,
  darkGrey,
} from './colorScheme.js';

// Map to track all chart instances on a page for zoom sync
const chartRegistry = new Map();
const zoomRanges = new Map();
const zoomSyncing = new Set();

function zoomGroupKey(chartIds) {
  return chartIds.join('|');
}

/**
 * Initialize an ECharts instance with common settings.
 * @param {string} domId - DOM element ID
 * @param {object} options - ECharts configuration object
 * @returns {echarts.ECharts} - Initialized chart instance
 */
function initChart(domId, options) {
  const dom = document.getElementById(domId);
  if (!dom) {
    console.error(`DOM element not found: ${domId}`);
    return null;
  }

  const chart = echarts.init(dom);

  const mergedOptions = {
    grid: {
      left: 60,
      right: 20,
      top: 30,
      bottom: 40,
    },
    textStyle: {
      fontFamily: 'system-ui, -apple-system, sans-serif',
      color: darkGrey,
    },
    ...options,
  };

  chart.setOption(mergedOptions);
  chartRegistry.set(domId, chart);
  return chart;
}

/**
 * Return a zoom range using percentages. Percentages work reliably across
 * charts even when their category-axis values are strings or duplicated.
 */
function getZoomRange(event, chart) {
  const zoom = event?.batch?.[0] || event || {};
  const start = Number(zoom.start);
  const end = Number(zoom.end);

  if (Number.isFinite(start) && Number.isFinite(end)) {
    return { start, end };
  }

  // Fallback for ECharts events that only provide startValue/endValue.
  const xAxis = chart.getOption().xAxis;
  const axisData = (Array.isArray(xAxis) ? xAxis[0] : xAxis)?.data || [];
  if (axisData.length < 2) return null;

  const indexOf = (value, fallback) => {
    if (Number.isInteger(value)) return value;
    const index = axisData.indexOf(value);
    return index >= 0 ? index : fallback;
  };

  const startIndex = indexOf(zoom.startValue, 0);
  const endIndex = indexOf(zoom.endValue, axisData.length - 1);
  return {
    start: (startIndex / (axisData.length - 1)) * 100,
    end: (endIndex / (axisData.length - 1)) * 100,
  };
}

/**
 * Sync X-axis zoom across multiple charts.
 * @param {string[]} chartIds - Array of chart DOM IDs
 */
function syncChartZoom(chartIds) {
  const groupKey = zoomGroupKey(chartIds);

  chartIds.forEach((sourceId) => {
    const sourceChart = chartRegistry.get(sourceId);
    if (!sourceChart) return;

    if (sourceChart.__zoomSyncHandler) {
      sourceChart.off('datazoom', sourceChart.__zoomSyncHandler);
    }

    const handler = (event) => {
      if (zoomSyncing.has(groupKey)) return;

      const range = getZoomRange(event, sourceChart);
      if (!range) return;
      zoomRanges.set(groupKey, range);

      zoomSyncing.add(groupKey);
      try {
        chartIds.forEach((targetId) => {
          if (targetId === sourceId) return;
          chartRegistry.get(targetId)?.dispatchAction({
            type: 'dataZoom',
            ...range,
          });
        });
      } finally {
        zoomSyncing.delete(groupKey);
      }
    };

    sourceChart.__zoomSyncHandler = handler;
    sourceChart.on('datazoom', handler);
  });

  // Reapply the saved range after charts are recreated during filtering.
  const savedRange = zoomRanges.get(groupKey);
  if (!savedRange) return;

  zoomSyncing.add(groupKey);
  try {
    chartIds.forEach((chartId) => {
      chartRegistry.get(chartId)?.dispatchAction({
        type: 'dataZoom',
        ...savedRange,
      });
    });
  } finally {
    zoomSyncing.delete(groupKey);
  }
}

function resetChartZoom(chartIds) {
  zoomRanges.delete(zoomGroupKey(chartIds));
}

function getColorForController(controllerName, controllerMap) {
  const index = controllerMap[controllerName] ?? 0;
  return getColor(index);
}

function addVerticalBarOverlay(chart, ranges, controllerMap) {
  if (!ranges || ranges.length === 0) return;

  const option = chart.getOption();
  const markArea = { data: [], itemStyle: { opacity: 0.5 } };

  ranges.forEach((range) => {
    const color =
      range.type === 'controller'
        ? deselectedControllerGrey
        : deselectedSeaStatePattern;

    markArea.data.push([
      { xAxis: range.start, itemStyle: { color } },
      { xAxis: range.end },
    ]);
  });

  if (!option.series) option.series = [];
  if (option.series.length === 0) option.series.push({ data: [] });
  option.series[0].markArea = markArea;
  chart.setOption(option);
}

function addHorizontalAvgLine(chart, controllerName, avgValue, controllerMap) {
  const color = getColorForController(controllerName, controllerMap);
  const option = chart.getOption();

  if (!option.series) option.series = [];
  if (option.series.length === 0) option.series.push({ data: [] });
  if (!option.series[0].markLine) option.series[0].markLine = { data: [] };

  option.series[0].markLine.data.push({
    yAxis: avgValue,
    name: `Avg: ${controllerName}`,
    lineStyle: { color, type: 'dashed' },
    label: { position: 'end', formatter: `${controllerName} avg` },
  });

  chart.setOption(option);
}

function clearOverlays(chart) {
  const option = chart.getOption();
  if (option.series && option.series[0]) {
    option.series[0].markArea = null;
    option.series[0].markLine = null;
  }
  chart.setOption(option);
}

function disposeChart(domId) {
  const chart = chartRegistry.get(domId);
  if (chart) {
    chart.dispose();
    chartRegistry.delete(domId);
  }
}

function resizeAllCharts() {
  chartRegistry.forEach((chart) => chart.resize());
}

export {
  initChart,
  syncChartZoom,
  resetChartZoom,
  getColorForController,
  addVerticalBarOverlay,
  addHorizontalAvgLine,
  clearOverlays,
  disposeChart,
  resizeAllCharts,
};
