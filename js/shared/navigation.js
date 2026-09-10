/**
 * Navigation menu module for Buoy Dashboard.
 * Renders hamburger menu and handles navigation between pages.
 */

/**
 * Initialize the navigation menu on the current page.
 * Renders hamburger button and dropdown menu with links to all pages.
 * Menu state (open/closed) is local to each page.
 */
function initNavigation() {
  // Create menu container if it doesn't exist
  let navContainer = document.getElementById('nav-container');
  if (!navContainer) {
    navContainer = document.createElement('nav');
    navContainer.id = 'nav-container';
    navContainer.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      background-color: #ffffff;
      border-bottom: 1px solid #f0f0f0;
      z-index: 1000;
      padding: 12px 20px;
      display: flex;
      align-items: center;
      gap: 16px;
    `;

    // Hamburger button
    const hamburger = document.createElement('button');
    hamburger.id = 'hamburger-btn';
    hamburger.innerHTML = '☰';
    hamburger.style.cssText = `
      background: none;
      border: none;
      font-size: 24px;
      cursor: pointer;
      color: #333333;
      padding: 0;
      width: 40px;
      height: 40px;
      display: flex;
      align-items: center;
      justify-content: center;
    `;

    // Title
    const title = document.createElement('h1');
    title.textContent = 'Buoy Dashboard';
    title.style.cssText = `
      margin: 0;
      font-size: 20px;
      font-weight: 600;
      color: #333333;
      flex: 1;
    `;

    navContainer.appendChild(hamburger);
    navContainer.appendChild(title);
    document.body.insertBefore(navContainer, document.body.firstChild);

    // Add top margin to body to account for nav bar
    document.body.style.paddingTop = '60px';
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
  const hamburger = document.getElementById('hamburger-btn');
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