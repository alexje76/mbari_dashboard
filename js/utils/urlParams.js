/**
 * URL parameter parsing and management for bookmarking/sharing views.
 */

/**
 * Parse current URL query parameters into an object.
 * @returns {object} - Parsed query params with keys like 'start', 'end', 'controllers', 'seaStates'
 */
function getURLParams() {
  const params = new URLSearchParams(window.location.search);
  const result = {};

  // Date range
  result.start = params.get('start') ? new Date(params.get('start')) : null;
  result.end = params.get('end') ? new Date(params.get('end')) : null;

  // Controllers (comma-separated list of names)
  result.controllers = params.get('controllers')
    ? params.get('controllers').split(',')
    : [];

  // Sea states (comma-separated list of "hs,tp")
  result.seaStates = params.get('seaStates')
    ? params.get('seaStates').split(';').map((pair) => {
        const [hs, tp] = pair.split(',');
        return { hs: parseFloat(hs), tp: parseFloat(tp) };
      })
    : [];

  // Chart types (for Selector and NextWave pages)
  result.chartTypes = params.get('chartTypes')
    ? params.get('chartTypes').split(',')
    : [];

  return result;
}

/**
 * Update browser URL with new query parameters.
 * Does not reload the page, updates history for bookmarking.
 * @param {object} params - Object with keys like 'start', 'end', 'controllers', 'seaStates', 'chartTypes'
 */
function setURLParams(params) {
  const queryParams = new URLSearchParams();

  // Date range
  if (params.start) {
    queryParams.set('start', formatDateForURL(params.start));
  }
  if (params.end) {
    queryParams.set('end', formatDateForURL(params.end));
  }

  // Controllers
  if (params.controllers && params.controllers.length > 0) {
    queryParams.set('controllers', params.controllers.join(','));
  }

  // Sea states
  if (params.seaStates && params.seaStates.length > 0) {
    const seaStateStrings = params.seaStates.map((ss) => `${ss.hs},${ss.tp}`);
    queryParams.set('seaStates', seaStateStrings.join(';'));
  }

  // Chart types
  if (params.chartTypes && params.chartTypes.length > 0) {
    queryParams.set('chartTypes', params.chartTypes.join(','));
  }

  const newURL = `${window.location.pathname}${queryParams.toString() ? '?' + queryParams.toString() : ''}`;
  window.history.replaceState({ path: newURL }, '', newURL);
}

/**
 * Format a Date object or ISO string for URL parameter.
 * @param {Date|string} date - Date object or ISO string
 * @returns {string} - ISO 8601 format (YYYY-MM-DDTHH:mm:ssZ)
 */
function formatDateForURL(date) {
  if (typeof date === 'string') {
    return new Date(date).toISOString();
  }
  if (date instanceof Date) {
    return date.toISOString();
  }
  return '';
}

/**
 * Parse a URL date string to a Date object.
 * @param {string} dateStr - ISO 8601 or YYYY-MM-DD format
 * @returns {Date} - Parsed Date object
 */
function parseDateFromURL(dateStr) {
  return new Date(dateStr);
}

/**
 * Get default date range based on available data.
 * @param {object} manifest - Manifest object with availableDateRange
 * @returns {object} - {start, end} Date objects
 */
function getDefaultDateRange(manifest) {
  if (!manifest || !manifest.availableDateRange) {
    return {
      start: new Date(),
      end: new Date(),
    };
  }

  const maxDate = new Date(manifest.availableDateRange.maxDate);
  const minDate = new Date(manifest.availableDateRange.minDate);

  return {
    start: minDate,
    end: maxDate,
  };
}

/**
 * Get last N days from today (or from maxDate).
 * @param {number} days - Number of days
 * @param {Date} fromDate - Base date (default: today)
 * @returns {object} - {start, end} Date objects
 */
function getLastNDays(days, fromDate = new Date()) {
  const end = new Date(fromDate);
  const start = new Date(fromDate);
  start.setDate(start.getDate() - days);
  return { start, end };
}

export {
  getURLParams,
  setURLParams,
  formatDateForURL,
  parseDateFromURL,
  getDefaultDateRange,
  getLastNDays,
};