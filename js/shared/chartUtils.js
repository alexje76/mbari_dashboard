/**
 * chartUtils.js
 * ECharts initialization, sync, color mapping, and overlay utilities.
 */

/**
 * Initialize an ECharts instance
 * @param {string} domId - DOM element ID
 * @param {Object} chartConfig - ECharts config object
 * @returns {Object} ECharts instance
 */
export function initChart(domId, chartConfig) {
    const dom = document.getElementById(domId);
    if (!dom) {
        console.warn(`DOM element #${domId} not found`);
        return null;
    }

    const chart = echarts.init(dom);
    chart.setOption(chartConfig);

    // Handle window resize
    window.addEventListener('resize', () => {
        if (chart) chart.resize();
    });

    return chart;
}

/**
 * Sync chart X-axis zoom across multiple charts
 * When sourceChart's X-axis range changes, update all other charts' X-ranges
 * @param {Array<Object>} charts - Array of {id: string, instance: echarts}
 * @param {string} sourceChartId - ID of chart that triggered zoom
 */
export function syncChartZoom(charts, sourceChartId) {
    const sourceChart = charts.find(c => c.id === sourceChartId)?.instance;
    if (!sourceChart) return;

    sourceChart.on('datazoom', (params) => {
        const sourceOption = sourceChart.getOption();
        const sourceDataZoom = sourceOption.dataZoom?.[0];

        if (!sourceDataZoom) return;

        charts.forEach(chart => {
            if (chart.id === sourceChartId) return;

            const targetOption = chart.instance.getOption();
            if (!targetOption.dataZoom) targetOption.dataZoom = [{}];

            targetOption.dataZoom[0].startValue = sourceDataZoom.startValue;
            targetOption.dataZoom[0].endValue = sourceDataZoom.endValue;

            chart.instance.setOption(targetOption, false);
        });
    });
}

/**
 * Get color for controller by index
 * @param {number} index - Index in controller list
 * @param {Array<string>} colorPalette - Color palette array
 * @returns {string} Hex color string
 */
export function getColorForControllerIndex(index, colorPalette) {
    return colorPalette[index % colorPalette.length];
}

/**
 * Add vertical bar overlay to chart (deselected controller or sea state)
 * @param {Object} chart - ECharts instance
 * @param {Array<Object>} ranges - Array of {start: timestamp, end: timestamp, style: 'solid' | 'hatched'}
 * @param {Array<Object>} xAxisData - Original X-axis time data
 */
export function addVerticalBarOverlay(chart, ranges, xAxisData) {
    // Implementation: Adds graphic overlays or uses ECharts markArea
    // This will be refined in page-specific modules
    console.log('addVerticalBarOverlay: implementation in page modules');
}

/**
 * Add horizontal average line to chart
 * @param {Object} chart - ECharts instance
 * @param {string} controllerName - Controller name
 * @param {number} avgValue - Average value
 * @param {string} color - Line color
 */
export function addHorizontalAvgLine(chart, controllerName, avgValue, color) {
    const option = chart.getOption();

    if (!option.markLine) option.markLine = { data: [] };

    option.markLine.data.push({
        yAxis: avgValue,
        name: `${controllerName} Avg`,
        lineStyle: { color, type: 'dashed' },
        label: { formatter: `${controllerName}: {c}` }
    });

    chart.setOption(option, false);
}

/**
 * Create basic line chart config
 * @param {Array<number>} xAxisData - X-axis (timestamps in ms)
 * @param {Array<number>} seriesData - Y-axis values
 * @param {string} seriesName - Series name
 * @param {string} color - Series color
 * @returns {Object} ECharts config
 */
export function createLineChartConfig(xAxisData, seriesData, seriesName, color) {
    return {
        tooltip: { trigger: 'axis' },
        legend: { data: [seriesName] },
        xAxis: {
            type: 'time',
            data: xAxisData,
            gridIndex: 0
        },
        yAxis: {
            type: 'value',
            gridIndex: 0
        },
        grid: { left: '10%', right: '5%', top: '15%', bottom: '10%' },
        series: [
            {
                name: seriesName,
                data: seriesData,
                type: 'line',
                smooth: false,
                stroke: 'solid',
                itemStyle: { color },
                areaStyle: { color: `${color}33` }
            }
        ],
        dataZoom: [
            { type: 'inside', xAxisIndex: [0] },
            { type: 'slider', xAxisIndex: [0] }
        ]
    };
}

/**
 * Create basic scatter chart config
 * @param {Array<Array<number>>} data - Array of [x, y] points
 * @param {string} seriesName - Series name
 * @param {string} color - Point color
 * @returns {Object} ECharts config
 */
export function createScatterChartConfig(data, seriesName, color) {
    return {
        tooltip: { trigger: 'item' },
        legend: { data: [seriesName] },
        xAxis: { type: 'value', name: 'Tp' },
        yAxis: { type: 'value', name: 'Hs' },
        grid: { left: '12%', right: '5%', top: '15%', bottom: '12%' },
        series: [
            {
                name: seriesName,
                data,
                type: 'scatter',
                symbolSize: 6,
                itemStyle: { color }
            }
        ]
    };
}

/**
 * Convert timestamp (ms) to ISO string
 * @param {number} timestampMs - Milliseconds since epoch
 * @returns {string} ISO 8601 date string (YYYY-MM-DD)
 */
export function formatDateFromTimestamp(timestampMs) {
    return new Date(timestampMs).toISOString().split('T')[0];
}
