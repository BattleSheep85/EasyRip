/**
 * ExternalLink - Opens links in the OS default browser instead of Electron
 *
 * Usage: <ExternalLink href="https://example.com">Link Text</ExternalLink>
 */

import React from 'react';

function ExternalLink({ href, children, className, title }) {
  const handleClick = async (e) => {
    e.preventDefault();
    e.stopPropagation();

    if (!href) {
      console.warn('[ExternalLink] No href provided');
      return;
    }

    console.log('[ExternalLink] Opening:', href);

    // Use Electron API if available (in Electron)
    if (window.electronAPI?.openExternal) {
      try {
        console.log('[ExternalLink] Using electronAPI.openExternal');
        const result = await window.electronAPI.openExternal(href);
        console.log('[ExternalLink] Result:', result);
      } catch (err) {
        console.error('[ExternalLink] Failed to open external link:', err);
        // Fallback: try window.open
        window.open(href, '_blank', 'noopener,noreferrer');
      }
    } else {
      // Fallback for browser-only mode (dev without Electron)
      console.log('[ExternalLink] electronAPI not available, using window.open');
      window.open(href, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <a
      href={href}
      onClick={handleClick}
      className={className}
      title={title}
      rel="noopener noreferrer"
    >
      {children}
    </a>
  );
}

export default ExternalLink;
