/**
 * Sidebar Component - Collapsible navigation sidebar
 * Sonarr-style with hamburger toggle
 */

import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

const NAV_ITEMS = [
  { id: 'home', path: '/', label: 'Drives', icon: '\uD83D\uDCBF' },
  { id: 'metadata', path: '/metadata', label: 'Metadata', icon: '\uD83C\uDFAC' },
  { id: 'export', path: '/export', label: 'Export', icon: '\uD83D\uDCE4' },
  { id: 'logs', path: '/logs', label: 'Logs', icon: '\uD83D\uDCDD' },
  { id: 'settings', path: '/settings', label: 'Settings', icon: '\u2699' },
];

function Sidebar({ collapsed, onToggle, mobileOpen, onMobileClose }) {
  const navigate = useNavigate();
  const location = useLocation();

  const isActive = (path) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  const handleNavClick = (path) => {
    navigate(path);
    // Close mobile menu after navigation
    if (mobileOpen && onMobileClose) {
      onMobileClose();
    }
  };

  return (
    <>
      {/* Mobile backdrop */}
      {mobileOpen && (
        <div
          className="sidebar-backdrop"
          onClick={onMobileClose}
          aria-hidden="true"
        />
      )}

      <nav className={`app-sidebar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}>
        {/* Collapse toggle (desktop only) */}
        <button
          className="sidebar-toggle desktop-only"
          onClick={onToggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? '\u276F' : '\u276E'}
        </button>

        <div className="sidebar-nav">
          {NAV_ITEMS.map(item => (
            <button
              key={item.id}
              className={`sidebar-nav-item ${isActive(item.path) ? 'active' : ''}`}
              onClick={() => handleNavClick(item.path)}
              title={collapsed ? item.label : undefined}
            >
              <span className="nav-icon">{item.icon}</span>
              <span className="nav-label">{item.label}</span>
            </button>
          ))}
        </div>

        {/* Version at bottom */}
        <div className="sidebar-footer">
          <span className="sidebar-version">EasyRip</span>
        </div>
      </nav>
    </>
  );
}

export default Sidebar;
