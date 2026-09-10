/**
 * navigation.js
 * Hamburger menu component. Imported by all pages.
 * Menu state (open/closed) is local to the page; no global state.
 */

export function initNavigation() {
    const menuToggle = document.getElementById('menuToggle');
    const navMenu = document.getElementById('navigationMenu');

    if (!menuToggle || !navMenu) {
        console.warn('Navigation elements not found');
        return;
    }

    // Toggle menu open/closed
    menuToggle.addEventListener('click', () => {
        navMenu.classList.toggle('nav-menu-closed');
        navMenu.classList.toggle('nav-menu-open');
    });

    // Close menu when a link is clicked
    const navLinks = navMenu.querySelectorAll('a');
    navLinks.forEach(link => {
        link.addEventListener('click', () => {
            navMenu.classList.add('nav-menu-closed');
            navMenu.classList.remove('nav-menu-open');
        });
    });

    // Close menu when clicking outside
    document.addEventListener('click', (e) => {
        if (!menuToggle.contains(e.target) && !navMenu.contains(e.target)) {
            navMenu.classList.add('nav-menu-closed');
            navMenu.classList.remove('nav-menu-open');
        }
    });
}
