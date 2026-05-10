// Vercel Web Analytics initialization
// This script injects the Vercel Analytics tracking script
(function() {
  'use strict';
  
  // Initialize the queue for analytics events
  if (!window.va) {
    window.va = function() {
      (window.vaq = window.vaq || []).push(arguments);
    };
  }
  
  // Only inject in production (when deployed to Vercel)
  const isDevelopment = window.location.hostname === 'localhost' || 
                        window.location.hostname === '127.0.0.1' || 
                        window.location.hostname.includes('192.168');
  
  // Check if script already exists
  const scriptSrc = '/_vercel/insights/script.js';
  if (document.head.querySelector(`script[src*="${scriptSrc}"]`)) {
    return;
  }
  
  // Create and inject the analytics script
  const script = document.createElement('script');
  script.src = scriptSrc;
  script.defer = true;
  script.setAttribute('data-sdkn', '@vercel/analytics');
  script.setAttribute('data-sdkv', '1.6.1');
  
  script.onerror = function() {
    console.log('[Vercel Web Analytics] Failed to load. Make sure Web Analytics is enabled in your Vercel project settings.');
  };
  
  document.head.appendChild(script);
})();
