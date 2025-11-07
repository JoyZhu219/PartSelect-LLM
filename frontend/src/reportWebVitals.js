// reportWebVitals.js
const reportWebVitals = (onPerfEntry) => {
  if (onPerfEntry && typeof onPerfEntry === 'function') {
    import('web-vitals').then(({ getCLS, getFID, getFCP, getLCP, getTTFB }) => {
      [getCLS, getFID, getFCP, getLCP, getTTFB].forEach(fn => fn(onPerfEntry));
    });
  }
};

export default (callback) => {
  reportWebVitals((metric) => {
    // Send to analytics endpoint
    fetch('/analytics', {
      method: 'POST',
      body: JSON.stringify(metric),
      keepalive: true, // ensures it still sends on page unload
      headers: { 'Content-Type': 'application/json' },
    });

    if (callback) callback(metric);
  });
};
