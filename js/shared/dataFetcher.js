/**
 * dataFetcher.js
 * Handles manifest fetch, CSV fetching/caching/parsing.
 */

const csvCache = new Map(); // In-memory cache keyed by date string

/**
 * Fetch manifest.json
 * @returns {Promise<Object>} Manifest with availableDateRange and dayFiles
 */
export async function fetchManifest() {
    try {
        const response = await fetch('/data/manifest.json');
        if (!response.ok) throw new Error(`Manifest fetch failed: ${response.status}`);
        return await response.json();
    } catch (error) {
        console.error('Error fetching manifest:', error);
        throw error;
    }
}

/**
 * Fetch a single day CSV file
 * @param {string} dateStr - Date in YYYY-MM-DD format
 * @returns {Promise<string>} Raw CSV text
 */
async function fetchDayFileRaw(dateStr) {
    try {
        const response = await fetch(`/data/${dateStr}.csv`);
        if (!response.ok) throw new Error(`Day file fetch failed: ${response.status}`);
        return await response.text();
    } catch (error) {
        console.error(`Error fetching day file ${dateStr}:`, error);
        throw error;
    }
}

/**
 * Fetch day file with caching
 * @param {string} dateStr - Date in YYYY-MM-DD format
 * @returns {Promise<string>} Raw CSV text
 */
export async function fetchDayFile(dateStr) {
    if (csvCache.has(dateStr)) {
        return csvCache.get(dateStr);
    }
    const csv = await fetchDayFileRaw(dateStr);
    csvCache.set(dateStr, csv);
    return csv;
}

/**
 * Clear cache
 */
export function clearCache() {
    csvCache.clear();
}

/**
 * Parse CSV text to JSON array
 * @param {string} csvText - Raw CSV text
 * @returns {Array<Object>} Array of row objects
 */
export function parseCSV(csvText) {
    const lines = csvText.trim().split('\n');
    if (lines.length < 1) return [];

    const headerLine = lines[0];
    const headers = headerLine.split(',').map(h => h.trim());

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const values = line.split(',').map(v => v.trim());
        const row = {};

        headers.forEach((header, idx) => {
            let value = values[idx] || '';

            // Convert numeric fields
            if (header === 'timestamp_ns') {
                row[header] = BigInt(value);
            } else if (['hs', 'tp', 'avg_power', 'power_in', 'power_out', 'battery_pct', 'sea_state_energy', 'efficiency', 'nextwave_error', 'nextwave_error_2', 'peaks'].includes(header)) {
                row[header] = value === '' ? null : parseFloat(value);
            } else {
                row[header] = value;
            }
        });

        rows.push(row);
    }

    return rows;
}

/**
 * Filter data by date range
 * @param {Array<Object>} data - Array of row objects
 * @param {number} startTimestampMs - Start timestamp in milliseconds
 * @param {number} endTimestampMs - End timestamp in milliseconds
 * @returns {Array<Object>} Filtered rows
 */
export function filterByDateRange(data, startTimestampMs, endTimestampMs) {
    const startNs = BigInt(startTimestampMs * 1_000_000);
    const endNs = BigInt(endTimestampMs * 1_000_000);

    return data.filter(row => {
        const ts = row.timestamp_ns;
        return ts >= startNs && ts <= endNs;
    });
}

/**
 * Get unique controller names from data
 * @param {Array<Object>} data - Array of row objects
 * @returns {Array<string>} Sorted unique controller names
 */
export function getUniqueControllers(data) {
    const controllers = new Set();
    data.forEach(row => {
        if (row.controller) controllers.add(row.controller);
    });
    return Array.from(controllers).sort();
}

/**
 * Get sea state scatter points (Hs, Tp, controller)
 * @param {Array<Object>} data - Array of row objects
 * @returns {Array<Object>} Array of {hs, tp, controller} unique combinations
 */
export function getSeaStateScatter(data) {
    const seen = new Set();
    const points = [];

    data.forEach(row => {
        if (row.hs === null || row.hs === undefined || row.tp === null || row.tp === undefined) {
            return;
        }

        const key = `${row.hs},${row.tp}`;
        if (!seen.has(key)) {
            seen.add(key);
            points.push({
                hs: row.hs,
                tp: row.tp,
                controller: row.controller || 'unknown'
            });
        }
    });

    return points;
}

/**
 * Get all available day files within a date range
 * @param {string} startDateStr - Start date in YYYY-MM-DD
 * @param {string} endDateStr - End date in YYYY-MM-DD
 * @returns {Array<string>} Array of date strings in YYYY-MM-DD format
 */
export function getDayFilesInRange(startDateStr, endDateStr) {
    const start = new Date(startDateStr);
    const end = new Date(endDateStr);
    const dates = [];

    let current = new Date(start);
    while (current <= end) {
        const year = current.getFullYear();
        const month = String(current.getMonth() + 1).padStart(2, '0');
        const day = String(current.getDate()).padStart(2, '0');
        dates.push(`${year}-${month}-${day}`);
        current.setDate(current.getDate() + 1);
    }

    return dates;
}
