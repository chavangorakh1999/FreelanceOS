'use client';

import { useEffect } from 'react';

/**
 * General Sans comes from Fontshare. It is added after the page is interactive so a slow or blocked font host can never
 * hold the page up: the system sans shows first and the real face swaps in (font-display: swap).
 */
export function FontLoader() {
  useEffect(() => {
    if (document.getElementById('font-general-sans')) return;
    const add = () => {
      const link = Object.assign(document.createElement('link'), { id: 'font-general-sans', rel: 'stylesheet', href: 'https://api.fontshare.com/v2/css?f[]=general-sans@400,500,600&display=swap' });
      document.head.append(link);
    };
    // After the load event, so the font request never counts toward (or delays) page load.
    if (document.readyState === 'complete') add();
    else window.addEventListener('load', add, { once: true });
  }, []);
  return null;
}
