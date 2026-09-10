/**
 * power.js
 * Power Usage (power.html) initialization and state management
 */

import { initNavigation } from '../shared/navigation.js';
import { fetchManifest, fetchDayFile, parseCSV, filterByDateRange } from '../shared/dataFetcher.js';
import { initChart } from '../shared/chartUtils.js';
import { getURLParams, setURLParams, formatDateForURL, parseDateFromURL, getDateRangeWithDefaults } from '../utils/urlParams.js';

/**
 * Initialize power usage page
 */
async function initPowerPage() {
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

    // 3. Set date range (default: past 2 days)
    const { minDate, maxDate } = manifest.availableDateRange;
    const defaultEnd = parseDateFromURL(maxDate);
    const defaultStart = new Date(defaultEnd);
    defaultStart.setDate(defaultStart.getDate() - 2);

    const dateRange = getDateRangeWithDefaults(
        formatDateForURL(defaultStart),
        formatDateForURL(defaultEnd)
    );

    updateDateInputs(dateRange.start, dateRange.end);

    // 4. Fetch data
    let allData = [];
    try {
        allData = await fetchDataForDateRange(manifest, dateRange.start, dateRange.end);
    } catch (error) {
        console.error('Failed to fetch data:', error);
        return;
    }

    // 5. Render battery chart
    renderBatteryChart(allData);

    // 6. Set up event listeners
    setupDateRangeListener(manifest, allData);
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
 * Render battery percentage chart
 */
function renderBatteryChart(data) {
    if (data.length === 0) return;

    const xAxisData = data.map(row => new Date(row.timestamp_iso).getTime());
    const batteryData = data.map(row => row.battery_pct || null);

    initChart('chartBattery', {
        tooltip: { trigger: 'axis' },
        legend: { data: ['Battery %'] },
        xAxis: { type: 'time', data: xAxisData },
        yAxis: { type: 'value', min: 0, max: 100 },
        grid: { left: '10%', right: '5%', top: '15%', bottom: '10%' },
        series: [{
            name: 'Battery %',
            data: batteryData,
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
function setupDateRangeListener(manifest, allData) {
    const applyBtn = document.getElementById('applyDateRange');
    const resetBtn = document.getElementById('resetDateRange');
    const startInput = document.getElementById('startDate');
    const endInput = document.getElementById('endDate');

    if (applyBtn) {
        applyBtn.addEventListener('click', async () => {
            const startDate = startInput.valueAsDate;
            const endDate = endInput.valueAsDate;

            if (startDate && endDate) {
                try {
                    const filteredData = filterByDateRange(allData, startDate.getTime(), endDate.getTime());
                    renderBatteryChart(filteredData);

                    setURLParams({
                        start: formatDateForURL(startDate),
                        end: formatDateForURL(endDate)
                    });
                } catch (error) {
                    console.error('Failed to apply date range:', error);
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
document.addEventListener('DOMContentLoaded', initPowerPage);