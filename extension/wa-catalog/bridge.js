/* Bridge: corre en la app RestaurApp. Copia el token de tu sesión a chrome.storage
 * para que la extensión (en WhatsApp Web) pueda importar directo a tu cuenta.
 * Solo lee tu propio token de localStorage; no envía nada a terceros. */
(() => {
  function sync() {
    try {
      const token = localStorage.getItem('restaurapp.token');
      if (token) chrome.storage.local.set({ ra_token: token, ra_api: location.origin });
      else chrome.storage.local.remove('ra_token');
    } catch { /* noop */ }
  }
  sync();
  window.addEventListener('focus', sync);
  setInterval(sync, 5000);
})();
