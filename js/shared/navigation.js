/**
 * Navigation menu module for Buoy Dashboard.
 * Handles hamburger menu dropdown and navigation between pages.
 */

/**
 * Initialize the navigation menu on the current page.
 * Attaches click handlers to existing hamburger button and creates dropdown menu.
 * Menu state (open/closed) is local to each page.
 */
function initNavigation() {
  // Find existing hamburger button (already in HTML)
  const hamburger = document.getElementById('menuToggle');
  if (!hamburger) {
    console.warn('Hamburger button not found in HTML. Expected id="hamburger-btn"');
    return;
  }

  // Create menu dropdown if it doesn't exist
  let menuDropdown = document.getElementById('nav-dropdown');
  if (!menuDropdown) {
    menuDropdown = document.createElement('div');
    menuDropdown.id = 'nav-dropdown';
    menuDropdown.style.cssText = `
      position: fixed;
      top: 60px;
      left: 0;
      background-color: #ffffff;
      border-bottom: 1px solid #f0f0f0;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      z-index: 999;
      width: 100%;
      max-width: 250px;
      padding: 8px 0;
      display: none;
      flex-direction: column;
    `;

    // Menu items
    const pages = [
      { name: 'Homepage', href: './' },
      { name: 'Selector Display', href: './selector.html' },
      { name: 'Power Usage', href: './power.html' },
      { name: 'Next Wave', href: './nextwave.html' },
    ];

    pages.forEach((page) => {
      const link = document.createElement('a');
      link.href = page.href;
      link.textContent = page.name;
      link.style.cssText = `
        padding: 12px 20px;
        color: #333333;
        text-decoration: none;
        font-size: 16px;
        border-bottom: 1px solid #f5f5f5;
        transition: background-color 0.2s;
      `;
      link.onmouseover = () => {
        link.style.backgroundColor = '#f5f5f5';
      };
      link.onmouseout = () => {
        link.style.backgroundColor = 'transparent';
      };
      menuDropdown.appendChild(link);
    });

    document.body.appendChild(menuDropdown);
  }

  // Toggle menu on hamburger click
  hamburger.addEventListener('click', (e) => {
    e.stopPropagation();
    const isOpen = menuDropdown.style.display === 'flex';
    menuDropdown.style.display = isOpen ? 'none' : 'flex';
  });

  // Close menu when clicking outside
  document.addEventListener('click', () => {
    menuDropdown.style.display = 'none';
  });

  // Close menu when a link is clicked
  const links = menuDropdown.querySelectorAll('a');
  links.forEach((link) => {
    link.addEventListener('click', () => {
      menuDropdown.style.display = 'none';
    });
  });
}

export { initNavigation };
