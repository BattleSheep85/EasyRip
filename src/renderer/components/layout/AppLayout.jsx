/**
 * AppLayout - Shared layout wrapper with sidebar and header
 * Provides consistent navigation structure across all pages
 */

import React, { useState, useEffect } from 'react';
import Sidebar from './Sidebar.jsx';
import AppHeader from './AppHeader.jsx';
import Footer from './Footer.jsx';

function AppLayout({ children, appVersion, updateStatus, exportStatus, exportQueue, onDownloadUpdate, onInstallUpdate }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    // Load collapsed state from localStorage
    const saved = localStorage.getItem('easyrip-sidebar-collapsed');
    return saved === 'true';
  });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Persist collapsed state
  useEffect(() => {
    localStorage.setItem('easyrip-sidebar-collapsed', sidebarCollapsed);
  }, [sidebarCollapsed]);

  // Close mobile menu on escape key
  useEffect(() => {
    const handleEscape = (e) => {
      if (e.key === 'Escape' && mobileMenuOpen) {
        setMobileMenuOpen(false);
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [mobileMenuOpen]);

  // Prevent body scroll when mobile menu is open
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [mobileMenuOpen]);

  return (
    <div className={`app-layout ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed(!sidebarCollapsed)}
        mobileOpen={mobileMenuOpen}
        onMobileClose={() => setMobileMenuOpen(false)}
      />

      <div className="app-layout-main">
        <AppHeader
          appVersion={appVersion}
          updateStatus={updateStatus}
          onDownloadUpdate={onDownloadUpdate}
          onInstallUpdate={onInstallUpdate}
          onMobileMenuToggle={() => setMobileMenuOpen(!mobileMenuOpen)}
          mobileMenuOpen={mobileMenuOpen}
        />

        <main className="app-content">
          {children}
        </main>

        <Footer
          exportStatus={exportStatus}
          exportQueue={exportQueue}
        />
      </div>
    </div>
  );
}

export default AppLayout;
