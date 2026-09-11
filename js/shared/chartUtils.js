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
  
  // Apply common defaults
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
  
  // Register chart for zoom sync
  chartRegistry.set(domId, chart);

  return chart;
}

/**
 * Sync X-axis zoom across multiple charts.
 * When sourceChart's X-range changes, update all other charts.
 * @param {string[]} chartIds - Array of chart DOM IDs
 * @param {string} sourceChartId - ID of the chart that triggered the zoom
 */
function syncChartZoom(chartIds, { reset = false } = {}) {
  const groupKey = zoomGroupKey(chartIds);
  if (reset) zoomRanges.delete(groupKey);

  chartIds.forEach((sourceId) => {
    const sourceChart = chartRegistry.get(sourceId);
    if (!sourceChart) return;

    if (sourceChart.__zoomSyncHandler) {
      sourceChart.off('datazoom', sourceChart.__zoomSyncHandler);
    }

    const handler = (event) => {
      if (zoomSyncing.has(groupKey)) return;

      const zoom = event.batch?.[0] || event;
      let { startValue, endValue } = zoom;
      const axisData = sourceChart.getOption().xAxis?.[0]?.data || [];

      // Convert category indexes to the actual timestamp strings.
      if (axisData.length) {
        if (Number.isInteger(startValue)) startValue = axisData[startValue];
        if (Number.isInteger(endValue)) endValue = axisData[endValue];
      }

      if (startValue == null || endValue == null) return;
      const range = { startValue, endValue };
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

  // Apply the saved timestamp range to charts created after a rerender.
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

/**
 * Get color for a controller (wrapper around colorScheme).
 * @param {string} controllerName - Controller name
 * @param {object} controllerMap - Map of controller name -> index
 * @returns {string} - Hex color code
 */
function getColorForController(controllerName, controllerMap) {
  const index = controllerMap[controllerName] ?? 0;
  return getColor(index);
}

/**
 * Add vertical bar overlay for deselected time ranges.
 * @param {echarts.ECharts} chart - Chart instance
 * @param {object[]} ranges - Array of {start, end, type} (type: 'controller' or 'sea_state')
 * @param {object} controllerMap - Map of controller name -> index
 */
function addVerticalBarOverlay(chart, ranges, controllerMap) {
  if (!ranges || ranges.length === 0) return;

  const option = chart.getOption();
  const markArea = {
    data: [],
    itemStyle: {
      opacity: 0.5,
    },
  };

  ranges.forEach((range) => {
    const color =
      range.type === 'controller'
        ? deselectedControllerGrey
        : deselectedSeaStatePattern;

    markArea.data.push([
      {
        xAxis: range.start,
        itemStyle: { color },
      },
      {
        xAxis: range.end,
      },
    ]);
  });

  // Add markArea to first series (or create a dummy series)
  if (!option.series) option.series = [];
  if (option.series.length === 0) {
    option.series.push({ data: [] });
  }

  option.series[0].markArea = markArea;
  chart.setOption(option);
}

/**
 * Add horizontal average line for a controller.
 * @param {echarts.ECharts} chart - Chart instance
 * @param {string} controllerName - Controller name
 * @param {number} avgValue - Average value
 * @param {object} controllerMap - Map of controller name -> index
 */
function addHorizontalAvgLine(chart, controllerName, avgValue, controllerMap) {
  const color = getColorForController(controllerName, controllerMap);
  const option = chart.getOption();

  if (!option.series) option.series = [];
  if (option.series.length === 0) {
    option.series.push({ data: [] });
  }

  // Add markLine to first series
  if (!option.series[0].markLine) {
    option.series[0].markLine = { data: [] };
  }

  option.series[0].markLine.data.push({
    yAxis: avgValue,
    name: `Avg: ${controllerName}`,
    lineStyle: { color, type: 'dashed' },
    label: { position: 'end', formatter: `${controllerName} avg` },
  });

  chart.setOption(option);
}

/**
 * Clear all overlays from a chart.
 * @param {echarts.ECharts} chart - Chart instance
 */
function clearOverlays(chart) {
  const option = chart.getOption();
  if (option.series && option.series[0]) {
    option.series[0].markArea = null;
    option.series[0].markLine = null;
  }
  chart.setOption(option);
}

/**
 * Dispose of a chart and remove from registry.
 * @param {string} domId - DOM element ID
 */
function disposeChart(domId) {
  const chart = chartRegistry.get(domId);
  if (chart) {
    chart.dispose();
    chartRegistry.delete(domId);
  }
}

/**
 * Resize all registered charts (call on window resize).
 */
function resizeAllCharts() {
  chartRegistry.forEach((chart) => {
    chart.resize();
  });
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