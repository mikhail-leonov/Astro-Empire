/* public/js/app.js — decorative starfield only. */
(function () {
  'use strict';
  var cv = document.getElementById('stars');
  if (!cv || !cv.getContext) return;

  function draw() {
    var w = (cv.width = window.innerWidth);
    var h = (cv.height = window.innerHeight);
    var ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    var n = Math.min(220, (w * h) / 9000);
    for (var i = 0; i < n; i++) {
      var x = Math.random() * w;
      var y = Math.random() * h;
      var r = Math.random() * 1.3;
      ctx.globalAlpha = 0.3 + Math.random() * 0.6;
      ctx.fillStyle = Math.random() < 0.2 ? '#7fd0ff' : '#cdd9ee';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 6.28);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  draw();
  window.addEventListener('resize', draw);
})();
