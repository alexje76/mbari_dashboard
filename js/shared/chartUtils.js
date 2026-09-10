/**
 * Chart utilities for ECharts initialization, zoom sync, and overlays.
 */

import * as echarts from 'https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js';
import {
  getColor,
  deselectedControllerGrey,
  deselectedSeaStatePattern,
  gridLineGrey,
  darkGrey,
} from './colorScheme.js';

// Map to track all chart instances on a page for zoom sync
const chartRegistry = new Map();

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
function syncChartZoom(chartIds, sourceChartId) {
  const sourceChart = chartRegistry.get(sourceChartId);
  if (!sourceChart) return;

  sourceChart.on('datazoom', (event) => {
    // Get the zoom range from source chart's dataZoom
    const option = sourceChart.getOption();
    const dataZoom = option.dataZoom?.[0];

    if (!dataZoom) return;

    const startPercentage = dataZoom.startValue;
    const endPercentage = dataZoom.endValue;

    // Apply same zoom to other charts
    chartIds.forEach((id) => {
      if (id === sourceChartId) return; // Skip source

      const targetChart = chartRegistry.get(id);
      if (targetChart) {
        const targetOption = targetChart.getOption();
        if (targetOption.dataZoom) {
          targetOption.dataZoom[0].startValue = startPercentage;
          targetOption.dataZoom[0].endValue = endPercentage;
          targetChart.setOption(targetOption);
        }
      }
    });
  });
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
  getColorForController,
  addVerticalBarOverlay,
  addHorizontalAvgLine,
  clearOverlays,
  disposeChart,
  resizeAllCharts,
};