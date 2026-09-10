/**
 * colorScheme.js
 * Color palette, grey values, and styling constants.
 * Colorblind-friendly palette from Paul Tol.
 */

// Colorblind-friendly controller color palette
export const CONTROLLER_COLOR_PALETTE = [
    '#1b9e77', // teal
    '#d95f02', // orange
    '#7570b3', // purple
    '#e7298a', // magenta
];

// Grey values for deselected sections
export const DESELECTED_CONTROLLER_GREY = '#e8e8e8';
export const DESELECTED_CONTROLLER_GREY_SOLID = { color: '#e8e8e8', opacity: 1 };

// Hatched pattern for deselected sea states (CSS pattern or echarts graphic)
export const DESELECTED_SEA_STATE_PATTERN = '#d3d3d3';

// Additional colors
export const GRID_LINE_COLOR = '#f0f0f0';
export const TEXT_COLOR = '#333333';
export const BACKGROUND_COLOR = '#ffffff';
export const SUBTLE_BACKGROUND = '#fafafa';

/**
 * Get color for controller by index
 * @param {number} index - Controller index
 * @returns {string} Hex color
 */
export function getControllerColor(index) {
    return CONTROLLER_COLOR_PALETTE[index % CONTROLLER_COLOR_PALETTE.length];
}

/**
 * Get color map for array of controller names
 * @param {Array<string>} controllers - Controller names
 * @returns {Object} Map of controller name to color
 */
export function getControllerColorMap(controllers) {
    const map = {};
    controllers.forEach((name, idx) => {
        map[name] = getControllerColor(idx);
    });
    return map;
}

/**
 * Get deselected controller overlay style
 * @returns {Object} Style object for grey overlay
 */
export function getDeselectedControllerStyle() {
    return DESELECTED_CONTROLLER_GREY_SOLID;
}

/**
 * Get deselected sea state overlay style
 * @returns {Object} Style object for hatched overlay
 */
export function getDeselectedSeaStateStyle() {
    return {
        color: DESELECTED_SEA_STATE_PATTERN,
        opacity: 0.6
    };
}
