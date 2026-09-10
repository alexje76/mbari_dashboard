/**
 * homepage.js
 * Homepage (index.html) initialization, state management, and chart rendering
 */

import { initNavigation } from '../shared/navigation.js';
import { fetchManifest, fetchDayFile, parseCSV, filterByDateRange, getUniqueControllers, getSeaStateScatter } from '../shared/dataFetcher.js';
import { initChart, syncChartZoom, getColorForControllerIndex } from '../shared/chartUtils.js';
import { CONTROLLER_COLOR_PALETTE } from '../shared/colorScheme.js';
import { getURLParams, setURLParams, formatDateForURL, parseDateFromURL, getDateRangeWithDefaults } from '../utils/urlParams.js';

/**
 * Initialize homepage
 */
async function initHomepage() {
    // 1. Initialize navigation
    initNavigation();

    // 2. Load manifest and set up date range
    let manifest;
    try {
        manifest = await fetchManifest();
    } catch (error) {
        console.error('Failed to load manifest:', error);
        document.body.innerHTML = '<p>Error loading data manifest. Please try again later.</p>';
        return;
    }

    const { minDate, maxDate } = manifest.availableDateRange;
    const dateRange = getDateRangeWithDefaults(minDate, maxDate);
    updateDateInputs(dateRange.start, dateRange.end);

    // 3. Fetch all data for date range
    let allData = [];
    try {
        allData = await fetchDataForDateRange(manifest, dateRange.start, dateRange.end);
    } catch (error) {
        console.error('Failed to fetch data:', error);
        document.body.innerHTML = '<p>Error loading data. Please try again later.</p>';
        return;
    }

    // 4. Extract controllers and sea states
    const controllers = getUniqueControllers(allData);
    const seaStatePoints = getSeaStateScatter(allData);

    // 5. Populate controller list
    populateControllerList(controllers);

    // 6. Initialize charts
    const chartInstances = {
        avgPower: null,
        efficiency: null,
        hs: null,
        tp: null,
        seaState: null
    };

    renderCharts(allData, controllers, chartInstances);

    // 7. Set up event listeners
    setupDateRangeListener(manifest, allData, controllers, chartInstances);
}

/**
 * Fetch all CSV data for date range
 * @param {Object} manifest - Manifest data
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @returns {Promise<Array>} Merged data rows
 */
async function fetchDataForDateRange(manifest, startDate, endDate) {
    const allRows = [];
    const current = new Date(startDate);

    while (current <= endDate) {
        const dateStr = formatDateForURL(current);
        if (manifest.dayFiles.includes(dateStr)) {
            try {
                const csvText = await fetchDayFile(dateStr);
                const rows = parseCSV(csvText);
                allRows.push(...rows);
            } catch (error) {
                console.warn(`Failed to fetch day file ${dateStr}:`, error);
            }
        }
        current.setDate(current.getDate() + 1);
    }

    return allRows;
}

/**
 * Populate controller indicator list
 * @param {Array<string>} controllers - Controller names
 */
function populateControllerList(controllers) {
    const listEl = document.getElementById('controllerList');
    if (!listEl) return;

    listEl.innerHTML = '';
    controllers.forEach((controller, idx) => {
        const color = CONTROLLER_COLOR_PALETTE[idx % CONTROLLER_COLOR_PALETTE.length];
        const li = document.createElement('li');
        li.innerHTML = `
            <span class="controller-indicator active" style="background-color: ${color};"></span>
            <span>${controller}</span>
        `;
        listEl.appendChild(li);
    });
}

/**
 * Render all homepage charts
 * @param {Array<Object>} data - Data rows
 * @param {Array<string>} controllers - Controller names
 * @param {Object} chartInstances - Chart instance container
 */
function renderCharts(data, controllers, chartInstances) {
    if (data.length === 0) return;

    // Extract X-axis time data
    const xAxisData = data.map(row => new Date(row.timestamp_iso).getTime());

    // Chart 1: Avg Power (line/area)
    const avgPowerData = data.map(row => row.avg_power || null);
    chartInstances.avgPower = initChart('chartAvgPower', {
        tooltip: { trigger: 'axis' },
        legend: { data: ['Avg Power'] },
        xAxis: { type: 'time', data: xAxisData },
        yAxis: { type: 'value' },
        grid: { left: '10%', right: '5%', top: '15%', bottom: '10%' },
        series: [{
            name: 'Avg Power',
            data: avgPowerData,
            type: 'line',
            smooth: false,
            itemStyle: { color: '#1b9e77' },
            areaStyle: { color: 'rgba(27, 158, 119, 0.2)' }
        }],
        dataZoom: [
            { type: 'inside', xAxisIndex: [0] },
            { type: 'slider', xAxisIndex: [0], show: true }
        ]
    });

    // Chart 2: Efficiency (line/area)
    const efficiencyData = data.map(row => row.efficiency || null);
    chartInstances.efficiency = initChart('chartEfficiency', {
        tooltip: { trigger: 'axis' },
        legend: { data: ['Efficiency'] },
        xAxis: { type: 'time', data: xAxisData },
        yAxis: { type: 'value' },
        grid: { left: '10%', right: '5%', top: '15%', bottom: '10%' },
        series: [{
            name: 'Efficiency',
            data: efficiencyData,
            type: 'line',
            smooth: false,
            itemStyle: { color: '#d95f02' },
            areaStyle: { color: 'rgba(217, 95, 2, 0.2)' }
        }],
        dataZoom: [
            { type: 'inside', xAxisIndex: [0] },
            { type: 'slider', xAxisIndex: [0], show: true }
        ]
    });

    // Chart 3: Hs Scatter
    const hsScatterData = data.map((row, idx) => [xAxisData[idx], row.hs || 0]);
    chartInstances.hs = initChart('chartHs', {
        tooltip: { trigger: 'item' },
        legend: { data: ['Hs'] },
        xAxis: { type: 'time' },
        yAxis: { type: 'value' },
        grid: { left: '10%', right: '5%', top: '15%', bottom: '10%' },
        series: [{
            name: 'Hs',
            data: hsScatterData,
            type: 'scatter',
            symbolSize: 4,
            itemStyle: { color: '#7570b3' }
        }],
        dataZoom: [{ type: 'inside', xAxisIndex: [0] }]
    });

    // Chart 4: Tp Scatter
    const tpScatterData = data.map((row, idx) => [xAxisData[idx], row.tp || 0]);
    chartInstances.tp = initChart('chartTp', {
        tooltip: { trigger: 'item' },
        legend: { data: ['Tp'] },
        xAxis: { type: 'time' },
        yAxis: { type: 'value' },
        grid: { left: '10%', right: '5%', top: '15%', bottom: '10%' },
        series: [{
            name: 'Tp',
            data: tpScatterData,
            type: 'scatter',
            symbolSize: 4,
            itemStyle: { color: '#e7298a' }
        }],
        dataZoom: [{ type: 'inside', xAxisIndex: [0] }]
    });

    // Chart 5: Sea State Scatter (Hs vs Tp)
    const seaStateData = getSeaStateScatter(data).map(point => [point.tp, point.hs]);
    chartInstances.seaState = initChart('chartSeaState', {
        tooltip: { trigger: 'item' },
        xAxis: { type: 'value', name: 'Tp (s)' },
        yAxis: { type: 'value', name: 'Hs (m)' },
        grid: { left: '12%', right: '5%', top: '15%', bottom: '12%' },
        series: [{
            name: 'Sea State',
            data: seaStateData,
            type: 'scatter',
            symbolSize: 6,
            itemStyle: { color: '#333333' }
        }]
    });

    // Sync X-axis zoom across time-series charts
    syncChartZoom([
        { id: 'avgPower', instance: chartInstances.avgPower },
        { id: 'efficiency', instance: chartInstances.efficiency },
        { id: 'hs', instance: chartInstances.hs },
        { id: 'tp', instance: chartInstances.tp }
    ], 'avgPower');
}

/**
 * Update date input fields
 * @param {Date} startDate
 * @param {Date} endDate
 */
function updateDateInputs(startDate, endDate) {
    const startInput = document.getElementById('startDate');
    const endInput = document.getElementById('endDate');
    if (startInput) startInput.valueAsDate = startDate;
    if (endInput) endInput.valueAsDate = endDate;
}

/**
 * Set up date range change listener
 */
function setupDateRangeListener(manifest, allData, controllers, chartInstances) {
    const applyBtn = document.getElementById('applyDateRange');
    const resetBtn = document.getElementById('resetDateRange');
    const startInput = document.getElementById('startDate');
    const endInput = document.getElementById('endDate');

    if (applyBtn) {
        applyBtn.addEventListener('click', async () => {
            const startDate = startInput.valueAsDate;
            const endDate = endInput.valueAsDate;

            if (startDate && endDate) {
                // Filter data for new range
                const filteredData = filterByDateRange(allData, startDate.getTime(), endDate.getTime());

                // Re-render charts
                renderCharts(filteredData, controllers, chartInstances);

                // Update URL params
                setURLParams({
                    start: formatDateForURL(startDate),
                    end: formatDateForURL(endDate)
                });
            }
        });
    }

    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            const { minDate, maxDate } = manifest.availableDateRange;
            updateDateInputs(parseDateFromURL(minDate), parseDateFromURL(maxDate));
            applyBtn?.click();
        });
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', initHomepage);