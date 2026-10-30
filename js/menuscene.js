/* menuscene.js — живая сцена за главным меню.
   Персонажи проигрывают свою idle-анимацию из SHEETS (те же кадры, что в игре),
   земля — тайлами ground_green. Работает только пока экран меню открыт. */
'use strict';
(function () {
  /* Масштаб задан по ВИДИМОЙ части спрайта (прозрачные поля не считаем):
     Лис 16x11 в клетке 32x32 → ×7 (≈112x77);
     Ангел 62x92 в клетке 64x96 → ×1.8 (≈112x166).
     (В комментарии стояло ×10/×0.9 и «≈160x110 / ≈56x83» — это не совпадало
     с константами ниже, т.е. описывало не тот кадр, который рисуется.) */
  const FOX_SCALE = 7;
  const ANGEL_SCALE = 1.8;
  const TILE = 32;            // размер тайла земли в кадре

  let cv = null, ctx = null, raf = null, t0 = 0, running = false;

  function size() {
    const r = cv.getBoundingClientRect();
    const w = Math.max(2, Math.round(r.width)), h = Math.max(2, Math.round(r.height));
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    return { w, h };
  }

  function drawSky(w, h, gy) {
    const g = ctx.createLinearGradient(0, 0, 0, gy);
    g.addColorStop(0, '#2c5f9a');
    g.addColorStop(1, '#9cc6e6');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, gy);
    /* дальний холм */
    ctx.fillStyle = '#7fb06e';
    ctx.beginPath(); ctx.ellipse(w * 0.18, gy, w * 0.32, h * 0.22, 0, Math.PI, 0); ctx.fill();
    /* ближний холм */
    ctx.fillStyle = '#5a9450';
    ctx.beginPath(); ctx.ellipse(w * 0.62, gy, w * 0.36, h * 0.16, 0, Math.PI, 0); ctx.fill();
  }

  function drawTree(w, h, gy) {
    const im = ASSETS.img.tree;
    if (!im) return;
    /* дерево справа от персонажей, основание ствола на линии земли */
    const s = Math.round(h * 0.55 / im.height * 10) / 10 || 1;
    const dw = Math.round(im.width * s), dh = Math.round(im.height * s);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(im, Math.round(w * 0.66 - dw / 2), gy - dh + Math.round(dh * 0.06), dw, dh);
  }

  function drawGround(w, h) {
    const im = ASSETS.img.ground_green;
    const gy = Math.round(h * 0.78);           // линия земли
    if (!im) {
      ctx.fillStyle = '#4f8a3a';
      ctx.fillRect(0, gy, w, h - gy);
      return gy;
    }
    const ts = Math.round(TILE * Math.max(1, h / 540));  // тайл растёт с высотой экрана
    /* верхний ряд тайла — трава, нижние 2/3 — земля. Ниже травы земля
       вымощена тем же тайлом, но без травяного ряда (берём нижнюю часть). */
    for (let x = 0; x < w; x += ts)
      ctx.drawImage(im, 0, 0, im.width, im.height, x, gy, ts, ts);
    const dirtSrcY = Math.round(im.height * 0.5);      // земляная половина тайла
    for (let y = gy + ts; y < h; y += ts)
      for (let x = 0; x < w; x += ts)
        ctx.drawImage(im, 0, dirtSrcY, im.width, im.height - dirtSrcY, x, y, ts, ts);
    return gy;
  }

  function drawActor(key, def, scale, anchorX, groundY, t, flip) {
    const frame = animFrame(def, t);
    const dw = Math.round(def.cw * scale), dh = Math.round(def.ch * scale);
    const dx = Math.round(anchorX - dw / 2);
    const dy = Math.round(groundY - dh);
    drawFrame(ctx, key, def, frame, dx, dy, dw, dh, flip);
  }

  function frame() {
    if (!running) return;
    /* время берём сами: rAF не всегда передаёт число (фон/скрытый экран) → NaN → кадр undefined */
    const t = (performance.now() - t0) / 1000;
    const { w, h } = size();
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, w, h);
    const gyLine = Math.round(h * 0.78);
    drawSky(w, h, gyLine);
    drawTree(w, h, gyLine);      // дерево сзади
    /* drawGround возвращает ту же линию земли — берём её, чтобы формула
       h * 0.78 не жила в двух местах и не разъехалась при правке. */
    const gy = drawGround(w, h);  // слой земли поверх основания дерева
    /* слева направо: Ангел, Лис, дерево. Ангел стоит левее, Лис смотрит влево (к Ангелу) */
    drawActor('angel_idle', SHEETS.angel_idle, ANGEL_SCALE, w * 0.50, gy + 4, t, false);
    drawActor('fox', SHEETS.fox_idle, FOX_SCALE, w * 0.60, gy + 4, t, true);
    raf = requestAnimationFrame(frame);
  }

  window.MenuScene = {
    start() {
      cv = document.getElementById('menuCanvas');
      if (!cv) return;
      ctx = cv.getContext('2d');
      if (running) return;
      running = true;
      t0 = performance.now();
      /* экран меню показывается ДО окончания loadAssets — тогда спрайтов ещё нет.
         Не выходим, а просто ждём: frame() сам рисует, как только ASSETS.img заполнится. */
      raf = requestAnimationFrame(frame);
    },
    stop() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = null;
    },
  };
})();
