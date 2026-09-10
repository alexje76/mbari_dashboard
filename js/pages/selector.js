/**
 * selector.js
 * Selector Display (selector.html) initialization, state management, and chart rendering
 */

import { initNavigation } from '../shared/navigation.js';
import { fetchManifest, fetchDayFile, parseCSV, filterByDateRange, getUniqueControllers, getSeaStateScatter } from '../shared/dataFetcher.js';
import { initChart, syncChartZoom } from '../shared/chartUtils.js';
import { CONTROLLER_COLOR_PALETTE } from '../shared/colorScheme.js';
import { getURLParams, setURLParams, formatDateForURL, parseDateFromURL, getDateRangeWithDefaults } from '../utils/urlParams.js';

let state = {
    allData: [],
    filteredData: [],
    selectedControllers: new Set(),
    selectedSeaStates: new Set(),
    chartTypes: [],
    selectedCharts: ['avg_power', 'efficiency', ''],
    startDate: null,
    endDate: null
};

/**
 * Initialize selector display page
 */
async function initSelectorPage() {
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
        state.chartTypes = chartTypesConfig.chartTypes;
    } catch (error) {
        console.error('Failed to load chart types config:', error);
    }

    // 4. Set date range
    const { minDate, maxDate } = manifest.availableDateRange;
    const dateRange = getDateRangeWithDefaults(minDate, maxDate);
    state.startDate = dateRange.start;
    state.endDate = dateRange.end;
    updateDateInputs(state.startDate, state.endDate);

    // 5. Fetch and parse data
    try {
        state.allData = await fetchDataForDateRange(manifest, state.startDate, state.endDate);
    } catch (error) {
        console.error('Failed to fetch data:', error);
        return;
    }

    // 6. Initialize state: controllers and sea states (all selected by default)
    const controllers = getUniqueControllers(state.allData);
    state.selectedControllers = new Set(controllers);

    const seaStates = getSeaStateScatter(state.allData);
    state.selectedSeaStates = new Set(seaStates.map(s => `${s.tp},${s.hs}`));

    // 7. Populate filter UI
    populateControllerCheckboxes(controllers);
    populateChartTypeSelectors(state.chartTypes);
    renderSeaStateScatter(seaStates);

    // 8. Apply initial filter and render charts
    applyFilters();

    // 9. Set up event listeners
    setupEventListeners(manifest);
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
 * Populate controller checkboxes
 */
function populateControllerCheckboxes(controllers) {
    const container = document.getElementById('controllerCheckboxes');
    if (!container) return;

    container.innerHTML = '';
    controllers.forEach((controller, idx) => {
        const color = CONTROLLER_COLOR_PALETTE[idx % CONTROLLER_COLOR_PALETTE.length];
        const label = document.createElement('label');
        label.innerHTML = `
            <input type="checkbox" value="${controller}" checked>
            <span style="color: ${color};">●</span> ${controller}
        `;
        label.querySelector('input').addEventListener('change', (e) => {
            if (e.target.checked) {
                state.selectedControllers.add(controller);
            } else {
                state.selectedControllers.delete(controller);
            }
            applyFilters();
        });
        container.appendChild(label);
    });
}

/**
 * Populate chart type dropdowns (3 selectors)
 */
function populateChartTypeSelectors(chartTypes) {
    for (let i = 1; i <= 3; i++) {
        const container = document.getElementById(`chartTypeSelector${i}`);
        if (!container) continue;

        const select = document.createElement('select');
        select.id = `chartTypeSelect${i}`;
        
        // Add "Select chart type" option
        const emptyOpt = document.createElement('option');
        emptyOpt.value = '';
        emptyOpt.textContent = 'Select chart type';
        select.appendChild(emptyOpt);

        // Add all chart type options
        chartTypes.forEach(ct => {
            const opt = document.createElement('option');
            opt.value = ct.name;
            opt.textContent = ct.label;
            select.appendChild(opt);
        });

        select.value = state.selectedCharts[i - 1] || '';
        select.addEventListener('change', (e) => {
            state.selectedCharts[i - 1] = e.target.value;
            applyFilters();
        });

        container.innerHTML = '';
        container.appendChild(select);
    }
}

/**
 * Render sea state scatter selector
 */
function renderSeaStateScatter(seaStates) {
    const container = document.getElementById('seaStateScatter');
    if (!container) return;

    const scatterData = seaStates.map(s => [s.tp, s.hs]);
    const seaStateChart = initChart('seaStateScatter', {
        tooltip: { trigger: 'item' },
        xAxis: { type: 'value', name: 'Tp' },
        yAxis: { type: 'value', name: 'Hs' },
        grid: { left: '12%', right: '5%', top: '10%', bottom: '12%' },
        series: [{
            name: 'Sea States',
            data: scatterData,
            type: 'scatter',
            symbolSize: 8,
            itemStyle: { color: '#d95f02' }
        }]
    });

    // Click handler for sea state selection
    seaStateChart.on('click', (params) => {
        if (params.value) {
            const key = `${params.value[0]},${params.value[1]}`;
            if (state.selectedSeaStates.has(key)) {
                state.selectedSeaStates.delete(key);
            } else {
                state.selectedSeaStates.add(key);
            }
            applyFilters();
        }
    });
}

/**
 * Apply controller and sea state filters to data
 */
function applyFilters() {
    let filtered = state.allData.filter(row => {
        // Controller filter
        if (!state.selectedControllers.has(row.controller)) {
            return false;
        }
        // Sea state filter
        const seaStateKey = `${row.tp},${row.hs}`;
        if (!state.selectedSeaStates.has(seaStateKey)) {
            return false;
        }
        return true;
    });

    state.filteredData = filtered;

    // Re-render charts
    renderCharts();
}

/**
 * Render the 3 selector charts
 */
function renderCharts() {
    if (state.filteredData.length === 0) return;

    const xAxisData = state.filteredData.map(row => new Date(row.timestamp_iso).getTime());

    for (let i = 1; i <= 3; i++) {
        const chartName = state.selectedCharts[i - 1];
        const domId = `chart${i}`;
        const titleId = `chart${i}Title`;

        if (!chartName || chartName === '') {
            // Clear chart
            const dom = document.getElementById(domId);
            if (dom) dom.innerHTML = '<p style="color: #ccc; text-align: center;">No chart selected</p>';
            continue;
        }

        // Find chart type metadata
        const chartType = state.chartTypes.find(ct => ct.name === chartName);
        if (!chartType) continue;

        // Update title
        const titleEl = document.getElementById(titleId);
        if (titleEl) titleEl.textContent = chartType.label;

        // Extract data for this chart
        const seriesData = state.filteredData.map(row => row[chartName] || null);

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
                itemStyle: { color: '#1b9e77' },
                areaStyle: { color: 'rgba(27, 158, 119, 0.2)' }
            }],
            dataZoom: [
                { type: 'inside', xAxisIndex: [0] },
                { type: 'slider', xAxisIndex: [0], show: true }
            ]
        };

        initChart(domId, config);
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
 * Set up event listeners
 */
function setupEventListeners(manifest) {
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

                // Re-fetch data for new date range
                try {
                    state.allData = await fetchDataForDateRange(manifest, startDate, endDate);
                    applyFilters();
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
            const { minDate, maxDate } = manifest.availableDateRange;
            updateDateInputs(parseDateFromURL(minDate), parseDateFromURL(maxDate));
            applyBtn?.click();
        });
    }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', initSelectorPage);