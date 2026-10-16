// Injected into the exported HTML before the deferred app bundles execute.
// PWA metadata must be resolved against the PUBLIC browser path: the landing
// proxy deliberately strips /app before reaching this export's origin.
(function () {
  var pathname = window.location.pathname;
  var basePath = pathname === '/app' || pathname.indexOf('/app/') === 0 ? '/app' : '';
  window.__LINKUP_BASE_PATH__ = basePath;

  if (pathname === '/app') {
    window.history.replaceState(window.history.state, '', '/app/' + window.location.search + window.location.hash);
  }

  function link(rel, href) {
    var element = document.querySelector('link[rel="' + rel + '"]');
    if (!element) {
      element = document.createElement('link');
      element.rel = rel;
      element.href = href;
      document.head.appendChild(element);
    } else {
      element.href = href;
    }
  }

  link('manifest', basePath + '/manifest.webmanifest');
  link('apple-touch-icon', basePath + '/icons/icon-192.png?v=cat1');
  link('icon', basePath + '/favicon.ico?v=cat1');
}());
