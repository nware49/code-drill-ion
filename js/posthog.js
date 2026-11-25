// PostHog is initialized once for the browser. Import `posthog` from this module at call sites.
const config = window.POSTHOG_CONFIG ?? {};
const isDevelopment = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
const missingConfig = !config.key || !config.host;
const pendingLogs = [];

if (missingConfig) {
  if (isDevelopment) {
    const variable = !config.key ? 'PUBLIC_POSTHOG_PROJECT_TOKEN' : 'PUBLIC_POSTHOG_HOST';
    throw new Error(`${variable} variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once ${variable} is configured`);
  }
} else {
  window.posthog = window.posthog || [];
  window.posthog.init = window.posthog.init || function init(key, options) {
    window.posthog._i = window.posthog._i || [];
    window.posthog._i.push([key, options]);
  };
  window.posthog.capture = window.posthog.capture || ((...args) => window.posthog.push(['capture', ...args]));
  window.posthog.identify = window.posthog.identify || ((...args) => window.posthog.push(['identify', ...args]));
  window.posthog.reset = window.posthog.reset || ((...args) => window.posthog.push(['reset', ...args]));
  window.posthog.init(config.key, {
    api_host: config.host,
    defaults: '2026-08-30',
    capture_exceptions: {
      capture_unhandled_errors: true,
      capture_unhandled_rejections: true,
      capture_console_errors: false,
    },
    logs: {
      serviceName: 'code-drillion-web',
      environment: isDevelopment ? 'development' : 'production',
    },
  });

  const script = document.createElement('script');
  script.async = true;
  script.crossOrigin = 'anonymous';
  script.src = `${config.host.replace('.i.posthog.com', '-assets.i.posthog.com')}/static/array.js`;
  script.addEventListener('load', () => {
    for (const [message, attributes] of pendingLogs) window.posthog.logger?.info(message, attributes);
    pendingLogs.length = 0;
  });
  document.head.append(script);
}

export const posthog = new Proxy({}, {
  get: (_, method) => (...args) => window.posthog?.[method]?.(...args),
});

// Only purpose-written game lifecycle records are sent to the PostHog log exporter.
export const gameLogger = {
  info(message, attributes) {
    if (window.posthog?.logger?.info) window.posthog.logger.info(message, attributes);
    else if (!missingConfig) pendingLogs.push([message, attributes]);
  },
};
