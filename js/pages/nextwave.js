/**
 * nextwave.js
 * Next Wave (nextwave.html) initialization and state management
 */

import { initNavigation } from '../shared/navigation.js';
import { fetchManifest, fetchDayFile, parseCSV, filterByDateRange } from '../shared/dataFetcher.js';
import { initChart, syncChartZoom } from '../shared/chartUtils.js';
import { getURLParams, setURLParams, formatDateForURL, parseDateFromURL, getDateRangeWithDefaults } from '../utils/urlParams.js';

let state = {
    allData: [],
    filteredData: [],
    selectedCharts: new Set(['nextwave', 'nextwave_error', 'nextwave_error_2']),
    chartTypes: [],
    startDate: null,
    endDate: null,
    chartInstances: {}
};

/**
 * Initialize next wave page
 */
async function initNextWavePage() {
    // 1. Initialize navigation
    initNavigation();

    // 2. Load manifest
    let manifest;
    try {
        manifest = await fetchManifest();
    } catch (error) {
        console.error('Failed to load manifest:', error);
        document.body.innerHTML = '<p>Error loading data manifest. Please try again later.</p>';
        return;
    }

    // 3. Load chart types config
    let chartTypesConfig;
    try {
        const response = await fetch('/config/chartTypes.json');
        chartTypesConfig = await response.json();
        // Filter to only prediction category
        state.chartTypes = chartTypesConfig.chartTypes.filter(ct => ct.category === 'prediction');
    } catch (error) {
        console.error('Failed to load chart types config:', error);
        state.chartTypes = [
            { name: 'nextwave', label: 'NextWave', category: 'prediction' },
            { name: 'nextwave_error', label: 'NextWave Error', category: 'prediction' },
            { name: 'nextwave_error_2', label: 'NextWave Error 2', category: 'prediction' }
        ];
    }

    // 4. Set date range (default: past 2 days)
    const { minDate, maxDate } = manifest.availableDateRange;
    const defaultEnd = parseDateFromURL(maxDate);
    const defaultStart = new Date(defaultEnd);
    defaultStart.setDate(defaultStart.getDate() - 2);

    const dateRange = getDateRangeWithDefaults(
        formatDateForURL(defaultStart),
        formatDateForURL(defaultEnd)
    );

    state.startDate = dateRange.start;
    state.endDate = dateRange.end;
    updateDateInputs(state.startDate, state.endDate);

    // 5. Fetch data
    try {
        state.allData = await fetchDataForDateRange(manifest, state.startDate, state.endDate);
    } catch (error) {
        console.error('Failed to fetch data:', error);
        return;
    }

    // 6. Populate chart checkboxes
    populateChartCheckboxes();

    // 7. Render charts
    renderCharts();

    // 8. Set up event listeners
    setupDateRangeListener(manifest);
}

/**
 * Fetch all CSV data for date range
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
 * Populate chart type checkboxes
 */
function populateChartCheckboxes() {
    const container = document.getElementById('chartCheckboxes');
    if (!container) return;

    container.innerHTML = '';
    state.chartTypes.forEach(chartType => {
        const label = document.createElement('label');
        const isChecked = state.selectedCharts.has(chartType.name);
        label.innerHTML = `
            <input type="checkbox" value="${chartType.name}" ${isChecked ? 'checked' : ''}>
            ${chartType.label}
        `;

        label.querySelector('input').addEventListener('change', (e) => {
            if (e.target.checked) {
                state.selectedCharts.add(chartType.name);
            } else {
                state.selectedCharts.delete(chartType.name);
            }
            renderCharts();
        });

        container.appendChild(label);
    });
}

/**
 * Render selected charts
 */
function renderCharts() {
    const container = document.getElementById('chartsContainer');
    if (!container) return;

    if (state.allData.length === 0) {
        container.innerHTML = '<p style="color: #ccc;">No data available</p>';
        return;
    }

    // Clear previous charts
    container.innerHTML = '';
    state.chartInstances = {};

    const xAxisData = state.allData.map(row => new Date(row.timestamp_iso).getTime());
    const selectedChartArray = Array.from(state.selectedCharts);
    const totalCharts = selectedChartArray.length;

    selectedChartArray.forEach((chartName, idx) => {
        const chartType = state.chartTypes.find(ct => ct.name === chartName);
        if (!chartType) return;

        // Create container div
        const chartDiv = document.createElement('div');
        chartDiv.className = 'chart-container stacked-chart';
        chartDiv.innerHTML = `
            <h3 id="chart-title-${idx}">${chartType.label}</h3>
            <div id="chart-${idx}" class="chart"></div>
        `;
        container.appendChild(chartDiv);

        // Extract data
        const seriesData = state.allData.map(row => row[chartName] || null);

        // Determine color based on chart type
        let color = '#1b9e77';
        if (chartName.includes('error')) {
            color = '#d95f02';
        }

        // Create chart config
        const config = {
            tooltip: { trigger: 'axis' },
            legend: { data: [chartType.label] },
            xAxis: { type: 'time', data: xAxisData },
            yAxis: { type: 'value' },
            grid: { left: '10%', right: '5%', top: '15%', bottom: '10%' },
            series: [{
                name: chartType.label,
                data: seriesData,
                type: 'line',
                smooth: false,
                itemStyle: { color },
                areaStyle: { color: `${color}33` }
            }],
            dataZoom: [
                { type: 'inside', xAxisIndex: [0] },
                { type: 'slider', xAxisIndex: [0], show: idx === totalCharts - 1 }
            ]
        };

        // Initialize chart
        const chartInstance = initChart(`chart-${idx}`, config);
        state.chartInstances[chartName] = chartInstance;
    });

    // Sync X-axis across all charts
    if (Object.keys(state.chartInstances).length > 1) {
        const charts = Object.entries(state.chartInstances).map(([name, instance], idx) => ({
            id: `chart-${idx}`,
            instance
        }));
        if (charts.length > 0) {
            syncChartZoom(charts, `chart-0`);
        }
    }
}

/**
 * Update date inputs
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
function setupDateRangeListener(manifest) {
    const applyBtn = document.getElementById('applyDateRange');
    const resetBtn = document.getElementById('resetDateRange');
    const startInput = document.getElementById('startDate');
    const endInput = document.getElementById('endDate');

    if (applyBtn) {
        applyBtn.addEventListener('click', async () => {
            const startDate = startInput.valueAsDate;
            const endDate = endInput.valueAsDate;

            if (startDate && endDate) {
                state.startDate = startDate;
                state.endDate = endDate;

                try {
                    state.allData = await fetchDataForDateRange(manifest, startDate, endDate);
                    renderCharts();

                    setURLParams({
                        start: formatDateForURL(startDate),
                        end: formatDateForURL(endDate)
                    });
                } catch (error) {
                    console.error('Failed to fetch data for new date range:', error);
                }
            }
        });
    }

    if (resetBtn) {
        resetBtn.addEventListener('click', () => {
            const { maxDate } = manifest.availableDateRange;
            const defaultEnd = parseDateFromURL(maxDate);
            const defaultStart = new Date(defaultEnd);
            defaultStart.setDate(defaultStart.getDate() - 2);

            updateDateInputs(defaultStart, defaultEnd);
            applyBtn?.click();
        });
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', initNextWavePage);