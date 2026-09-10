/**
 * Color scheme and palette management for Buoy Dashboard.
 * Provides colorblind-friendly palette and styling values.
 */

// Colorblind-friendly palette (Paul Tol, 4 distinct colors)
const controllerColorPalette = [
  '#1b9e77', // teal
  '#d95f02', // orange
  '#7570b3', // purple
  '#e7298a', // pink
];

// Neutral greys
const deselectedControllerGrey = '#e8e8e8'; // solid light grey for deselected controllers
const deselectedSeaStatePattern = '#d0d0d0'; // base color for hatched pattern (sea state)
const gridLineGrey = '#f0f0f0';
const darkGrey = '#333333';

/**
 * Get color for a controller by index.
 * @param {number} index - Index in the controller list
 * @returns {string} - Hex color code
 */
function getColor(index) {
  return controllerColorPalette[index % controllerColorPalette.length];
}

/**
 * Get all controller colors (for legend/mapping).
 * @returns {string[]} - Array of hex colors
 */
function getControllerColors() {
  return [...controllerColorPalette];
}

/**
 * Get deselected controller overlay style.
 * @returns {object} - Style object for ECharts overlay
 */
function getDeselectedControllerStyle() {
  return {
    color: deselectedControllerGrey,
    fillOpacity: 0.7,
  };
}

/**
 * Get deselected sea state overlay style (hatched pattern).
 * @returns {object} - Style object for ECharts overlay
 */
function getDeselectedSeaStateStyle() {
  return {
    color: deselectedSeaStatePattern,
    fillOpacity: 0.5,
    // Pattern implemented via SVG or canvas in chartUtils
  };
}

export {
  controllerColorPalette,
  deselectedControllerGrey,
  deselectedSeaStatePattern,
  gridLineGrey,
  darkGrey,
  getColor,
  getControllerColors,
  getDeselectedControllerStyle,
  getDeselectedSeaStateStyle,
};