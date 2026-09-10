// Detect base path for GitHub Pages (e.g., /mbari_dashboard)
// For user/org sites (username.github.io), basePath = ''
// For project sites (username.github.io/repo-name), basePath = '/repo-name'
const getBasePath = () => {
  const pathname = window.location.pathname;
  // If path has more than just '/', extract the repo name
  if (pathname !== '/' && pathname !== '') {
    const parts = pathname.split('/').filter(p => p);
    return '/' + parts[0];
  }
  return '';
};

const BASE_PATH = getBasePath();

export async function fetchManifest() {
  try {
    const manifestUrl = `${BASE_PATH}/data/manifest.json`;
    console.log(`Fetching manifest from: ${manifestUrl}`);
    const response = await fetch(manifestUrl);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('Manifest loaded successfully:', data);
    return data;
  } catch (error) {
    console.error('Error fetching manifest:', error);
    throw new Error(`Error loading data manifest. Please try again later. (${error.message})`);
  }
}

export async function fetchDayFile(dateStr) {
  try {
    const fileUrl = `${BASE_PATH}/data/${dateStr}.csv`;
    console.log(`Fetching day file from: ${fileUrl}`);
    const response = await fetch(fileUrl);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const text = await response.text();
    console.log(`Day file ${dateStr} loaded successfully`);
    return text;
  } catch (error) {
    console.error(`Error fetching day file ${dateStr}:`, error);
    throw error;
  }
}

export function parseCSV(rawText) {
  const lines = rawText.trim().split('\n');
  if (lines.length === 0) return [];

  const headers = lines[0].split(',').map(h => h.trim());
  const rows = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = line.split(',').map(v => v.trim());
    const row = {};

    headers.forEach((header, index) => {
      const value = values[index] || '';
      // Try to parse as number, otherwise keep as string
      row[header] = isNaN(value) ? value : Number(value);
    });

    rows.push(row);
  }

  return rows;
}

export function filterByDateRange(data, startDate, endDate) {
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();

  return data.filter(row => {
    const rowTime = new Date(row.timestamp_iso).getTime();
    return rowTime >= start && rowTime <= end;
  });
}

export function getUniqueControllers(data) {
  const controllers = new Set();
  data.forEach(row => {
    if (row.controller) {
      controllers.add(row.controller);
    }
  });
  return Array.from(controllers).sort();
}

export function getSeaStateScatter(data) {
  const seaStates = {};
  
  data.forEach(row => {
    const hs = row.hs;
    const tp = row.tp;
    
    if (hs !== undefined && tp !== undefined) {
      const key = `${hs},${tp}`;
      if (!seaStates[key]) {
        seaStates[key] = {
          hs: hs,
          tp: tp,
          controllers: new Set()
        };
      }
      if (row.controller) {
        seaStates[key].controllers.add(row.controller);
      }
    }
  });

  return Object.values(seaStates).map(state => ({
    hs: state.hs,
    tp: state.tp,
    controllers: Array.from(state.controllers)
  }));
}