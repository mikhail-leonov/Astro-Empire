/* public/js/ui.js — small shared page behaviors, loaded on every page.
   Exists so no .twig view needs an inline <script> or onclick/onsubmit
   attribute: the CSRF token lives in a <meta> tag (plain HTML) and is read
   here into window.__CSRF__ for the other scripts (app.js, galaxygen.js,
   admin.js) to send as the x-csrf-token header; and any form that should
   ask "are you sure?" before submitting just carries a data-confirm
   attribute instead of inline JS. */
(function () {
  "use strict";

  var meta = document.querySelector('meta[name="csrf-token"]');
  window.__CSRF__ = meta ? meta.getAttribute("content") : "";

  document.addEventListener("submit", function (e) {
    var form = e.target;
    if (!(form instanceof HTMLFormElement)) return;
    var msg = form.getAttribute("data-confirm");
    if (msg && !window.confirm(msg)) {
      e.preventDefault();
    }
  }, true);
})();
