/**
 * urlParams.js
 * Parse and write URL query parameters for bookmarking/sharing views
 */

/**
 * Parse current URL query string
 * @returns {Object} Object with date range and filter state
 */
export function getURLParams() {
    const params = new URLSearchParams(window.location.search);
    return {
        start: params.get('start'),
        end: params.get('end'),
        controllers: params.getAll('controller'),
        seaStates: params.getAll('seastate'),
        charts: params.getAll('chart')
    };
}

/**
 * Update URL with new query parameters (updates browser history)
 * @param {Object} params - Object with start, end, controllers, seaStates, charts
 */
export function setURLParams(params) {
    const queryParams = new URLSearchParams();

    if (params.start) queryParams.set('start', params.start);
    if (params.end) queryParams.set('end', params.end);

    if (params.controllers && Array.isArray(params.controllers)) {
        params.controllers.forEach(c => queryParams.append('controller', c));
    }

    if (params.seaStates && Array.isArray(params.seaStates)) {
        params.seaStates.forEach(s => queryParams.append('seastate', s));
    }

    if (params.charts && Array.isArray(params.charts)) {
        params.charts.forEach(c => queryParams.append('chart', c));
    }

    const newURL = `${window.location.pathname}?${queryParams.toString()}`;
    window.history.replaceState(null, '', newURL);
}

/**
 * Format Date object or string to YYYY-MM-DD for URL
 * @param {Date|string} date - Date object or ISO string
 * @returns {string} YYYY-MM-DD format
 */
export function formatDateForURL(date) {
    if (typeof date === 'string') {
        return date.split('T')[0];
    }
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Parse URL date string (YYYY-MM-DD) to Date object
 * @param {string} dateStr - YYYY-MM-DD format
 * @returns {Date} Date object (midnight UTC)
 */
export function parseDateFromURL(dateStr) {
    return new Date(dateStr + 'T00:00:00Z');
}

/**
 * Get date range with defaults if not in URL
 * @param {string} defaultStart - Default start date (YYYY-MM-DD)
 * @param {string} defaultEnd - Default end date (YYYY-MM-DD)
 * @returns {Object} {start: Date, end: Date}
 */
export function getDateRangeWithDefaults(defaultStart, defaultEnd) {
    const params = getURLParams();
    return {
        start: params.start ? parseDateFromURL(params.start) : parseDateFromURL(defaultStart),
        end: params.end ? parseDateFromURL(params.end) : parseDateFromURL(defaultEnd)
    };
}