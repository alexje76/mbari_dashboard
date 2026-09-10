/**
 * Data fetching and parsing module for Buoy Dashboard.
 * Handles manifest loading, CSV fetching/caching, and data transformation.
 */

const BASE_PATH = '/buoy-dashboard'; // GitHub Pages repo base path

// In-memory cache for day files
const dayFileCache = new Map();
let manifestCache = null;

/**
 * Fetch and cache the manifest file.
 * @returns {Promise<object>} - Manifest object with availableDateRange and dayFiles
 */
async function fetchManifest() {
  if (manifestCache) return manifestCache;

  try {
    const response = await fetch(`${BASE_PATH}/data/manifest.json`);
    if (!response.ok) throw new Error(`Manifest fetch failed: ${response.status}`);
    manifestCache = await response.json();
    return manifestCache;
  } catch (error) {
    console.error('Error fetching manifest:', error);
    throw error;
  }
}

/**
 * Fetch a day file CSV and cache it.
 * @param {string} date - Date in YYYY-MM-DD format
 * @returns {Promise<string>} - Raw CSV text
 */
async function fetchDayFile(date) {
  if (dayFileCache.has(date)) {
    return dayFileCache.get(date);
  }

  try {
    const response = await fetch(`${BASE_PATH}/data/${date}.csv`);
    if (!response.ok) throw new Error(`Day file fetch failed: ${response.status}`);
    const text = await response.text();
    dayFileCache.set(date, text);
    return text;
  } catch (error) {
    console.error(`Error fetching day file ${date}:`, error);
    throw error;
  }
}

/**
 * Parse CSV text into array of row objects.
 * Handles quoted fields and basic escaping.
 * @param {string} csvText - Raw CSV text
 * @returns {object[]} - Array of row objects with column names as keys
 */
function parseCSV(csvText) {
  const lines = csvText.trim().split('\n');
  if (lines.length < 1) return [];

  // Parse header
  const headers = parseCSVLine(lines[0]);

  // Parse rows
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length !== headers.length) continue; // Skip malformed rows

    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index];
    });
    rows.push(row);
  }

  return rows;
}

/**
 * Parse a single CSV line, handling quoted fields.
 * @param {string} line - CSV line
 * @returns {string[]} - Array of field values
 */
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++; // Skip next quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

/**
 * Filter data rows by date range.
 * @param {object[]} data - Array of row objects
 * @param {Date} startDate - Start date (inclusive)
 * @param {Date} endDate - End date (inclusive)
 * @returns {object[]} - Filtered rows
 */
function filterByDateRange(data, startDate, endDate) {
  const startTime = startDate.getTime();
  const endTime = endDate.getTime();

  return data.filter((row) => {
    try {
      const rowTime = new Date(row.timestamp_iso).getTime();
      return rowTime >= startTime && rowTime <= endTime;
    } catch {
      return false;
    }
  });
}

/**
 * Get all unique controller names from data.
 * @param {object[]} data - Array of row objects
 * @returns {string[]} - Sorted array of unique controller names
 */
function getUniqueControllers(data) {
  const controllers = new Set();
  data.forEach((row) => {
    if (row.controller) {
      controllers.add(row.controller);
    }
  });
  return Array.from(controllers).sort();
}

/**
 * Get sea state scatter points (Hs, Tp combinations).
 * @param {object[]} data - Array of row objects
 * @returns {object[]} - Array of {hs, tp, controllers} where controllers is a set of active controllers
 */
function getSeaStateScatter(data) {
  const scatterMap = new Map(); // Key: "hs,tp" -> {hs, tp, controllers: Set}

  data.forEach((row) => {
    if (!row.hs || !row.tp) return;

    const hs = parseFloat(row.hs);
    const tp = parseFloat(row.tp);
    if (isNaN(hs) || isNaN(tp)) return;

    const key = `${hs},${tp}`;
    if (!scatterMap.has(key)) {
      scatterMap.set(key, {
        hs,
        tp,
        controllers: new Set(),
      });
    }

    if (row.controller) {
      scatterMap.get(key).controllers.add(row.controller);
    }
  });

  return Array.from(scatterMap.values());
}

/**
 * Fetch and parse all data for a date range.
 * Fetches only the day files needed for the range.
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @returns {Promise<object[]>} - Merged data from all day files in range
 */
async function fetchDataForDateRange(startDate, endDate) {
  const allData = [];

  // Generate list of dates to fetch
  const currentDate = new Date(startDate);
  while (currentDate <= endDate) {
    const dateStr = currentDate.toISOString().split('T')[0]; // YYYY-MM-DD
    try {
      const csv = await fetchDayFile(dateStr);
      const rows = parseCSV(csv);
      allData.push(...rows);
    } catch (error) {
      console.warn(`Skipping day file ${dateStr}:`, error);
    }
    currentDate.setDate(currentDate.getDate() + 1);
  }

  return allData;
}

/**
 * Clear all cached data (call when navigating away or closing).
 */
function clearCache() {
  dayFileCache.clear();
  manifestCache = null;
}

/**
 * Downsample data to hourly resolution (for overview CSV).
 * @param {object[]} data - Array of row objects
 * @returns {object[]} - Hourly downsampled data
 */
function downsampleToHourly(data) {
  const hourlyMap = new Map(); // Key: hour timestamp

  data.forEach((row) => {
    try {
      const timestamp = new Date(row.timestamp_iso);
      const hourKey = new Date(
        timestamp.getFullYear(),
        timestamp.getMonth(),
        timestamp.getDate(),
        timestamp.getHours()
      ).getTime();

      if (!hourlyMap.has(hourKey)) {
        hourlyMap.set(hourKey, {
          timestamp_iso: new Date(hourKey).toISOString(),
          timestamp_ns: hourKey * 1e6, // Convert ms to ns
          controller: row.controller,
          hs: [],
          tp: [],
          avg_power: [],
          power_in: [],
          power_out: [],
          battery_pct: [],
          sea_state_energy: [],
          efficiency: [],
          peaks_total: 0,
          nextwave: row.nextwave || '',
          nextwave_error: [],
          nextwave_error_2: [],
        });
      }

      const hourData = hourlyMap.get(hourKey);

      // Average numeric fields
      if (row.hs) hourData.hs.push(parseFloat(row.hs));
      if (row.tp) hourData.tp.push(parseFloat(row.tp));
      if (row.avg_power) hourData.avg_power.push(parseFloat(row.avg_power));
      if (row.power_in) hourData.power_in.push(parseFloat(row.power_in));
      if (row.power_out) hourData.power_out.push(parseFloat(row.power_out));
      if (row.battery_pct) hourData.battery_pct.push(parseFloat(row.battery_pct));
      if (row.sea_state_energy) hourData.sea_state_energy.push(parseFloat(row.sea_state_energy));
      if (row.efficiency) hourData.efficiency.push(parseFloat(row.efficiency));
      if (row.peaks) hourData.peaks_total += parseInt(row.peaks);
      if (row.nextwave_error) hourData.nextwave_error.push(parseFloat(row.nextwave_error));
      if (row.nextwave_error_2) hourData.nextwave_error_2.push(parseFloat(row.nextwave_error_2));
    } catch (error) {
      console.warn('Error processing row:', error);
    }
  });

  // Average arrays and convert back to numbers
  const result = Array.from(hourlyMap.values()).map((hour) => ({
    timestamp_iso: hour.timestamp_iso,
    timestamp_ns: hour.timestamp_ns,
    controller: hour.controller,
    hs: hour.hs.length > 0 ? (hour.hs.reduce((a, b) => a + b) / hour.hs.length).toFixed(2) : '',
    tp: hour.tp.length > 0 ? (hour.tp.reduce((a, b) => a + b) / hour.tp.length).toFixed(2) : '',
    avg_power: hour.avg_power.length > 0 ? (hour.avg_power.reduce((a, b) => a + b) / hour.avg_power.length).toFixed(2) : '',
    power_in: hour.power_in.length > 0 ? (hour.power_in.reduce((a, b) => a + b) / hour.power_in.length).toFixed(2) : '',
    power_out: hour.power_out.length > 0 ? (hour.power_out.reduce((a, b) => a + b) / hour.power_out.length).toFixed(2) : '',
    battery_pct: hour.battery_pct.length > 0 ? (hour.battery_pct.reduce((a, b) => a + b) / hour.battery_pct.length).toFixed(2) : '',
    sea_state_energy: hour.sea_state_energy.length > 0 ? (hour.sea_state_energy.reduce((a, b) => a + b) / hour.sea_state_energy.length).toFixed(2) : '',
    efficiency: hour.efficiency.length > 0 ? (hour.efficiency.reduce((a, b) => a + b) / hour.efficiency.length).toFixed(2) : '',
    peaks: hour.peaks_total,
    nextwave: hour.nextwave,
    nextwave_error: hour.nextwave_error.length > 0 ? (hour.nextwave_error.reduce((a, b) => a + b) / hour.nextwave_error.length).toFixed(2) : '',
    nextwave_error_2: hour.nextwave_error_2.length > 0 ? (hour.nextwave_error_2.reduce((a, b) => a + b) / hour.nextwave_error_2.length).toFixed(2) : '',
  }));

  return result.sort((a, b) => new Date(a.timestamp_iso) - new Date(b.timestamp_iso));
}

export {
  fetchManifest,
  fetchDayFile,
  parseCSV,
  filterByDateRange,
  getUniqueControllers,
  getSeaStateScatter,
  fetchDataForDateRange,
  clearCache,
  downsampleToHourly,
};