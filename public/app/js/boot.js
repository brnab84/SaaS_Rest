// Aplica el tema guardado antes del primer render para evitar el "flash" de tema.
// Script clásico (no módulo) y síncrono en <head> a propósito.
try {
  var t = localStorage.getItem('restaurapp.theme');
  if (t) document.documentElement.setAttribute('data-theme', t);
} catch (e) {}
