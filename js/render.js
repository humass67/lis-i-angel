/* render.js — отрисовка мира: небо, параллакс, тайлы, сущности, пост-эффекты
   коррупции (десатурация, хроматическая аберрация, зерно, виньетка). */
'use strict';

const R = {
  cv: null, ctx: null,        // экранный canvas
  buf: null, bctx: null,      // внутренний буфер VIEW_W x VIEW_H
  post: null, pctx: null,     // буфер для пост-эффектов
  scale: 1,
  grainCv: null,
};

function renderInit(canvas) {
  R.cv = canvas;
  R.ctx = canvas.getContext('2d', { alpha: false });
  R.buf = document.createElement('canvas');
  R.buf.width = CFG.VIEW_W; R.buf.height = CFG.VIEW_H;
  R.bctx = R.buf.getContext('2d', { alpha: false });
  R.post = document.createElement('canvas');
  R.post.width = CFG.VIEW_W; R.post.height = CFG.VIEW_H;
  R.pctx = R.post.getContext('2d', { alpha: false });
  R.bctx.imageSmoothingEnabled = false;
  R.pctx.imageSmoothingEnabled = false;
  R.ctx.imageSmoothingEnabled = false;
  buildGrain();
  renderResize();
}

/* Зерно готовим один раз как маленький canvas и тайлим */
function buildGrain() {
  const g = document.createElement('canvas');
  g.width = 96; g.height = 96;
  const gc = g.getContext('2d');
  const im = gc.createImageData(96, 96);
  for (let i = 0; i < im.data.length; i += 4) {
    const v = 120 + Math.random() * 135;
    im.data[i] = im.data[i + 1] = im.data[i + 2] = v;
    im.data[i + 3] = 255;
  }
  gc.putImageData(im, 0, 0);
  R.grainCv = g;
}

function renderResize() {
  if (!R.cv) return;
  const wrap = R.cv.parentElement;
  /* Пока экран игры скрыт (display:none), родитель имеет нулевой размер —
     canvas получал 0x0 и кадр не рисовался вообще. Падаем на размер окна. */
  let availW = wrap ? wrap.clientWidth : 0;
  let availH = wrap ? wrap.clientHeight : 0;
  if (availW < 2 || availH < 2) {
    availW = window.innerWidth;
    availH = window.innerHeight;
  }
  /* Кадр адаптируется под пропорции окна: высоту держим 540, а ширину
     считаем от соотношения сторон. Тогда игра занимает ВЕСЬ экран без
     чёрных полей, и при этом ничего не обрезается и не растягивается.
     Ширину ограничиваем, чтобы на очень широких экранах камера не
     выходила за пределы самого узкого уровня (арена босса — 34 тайла). */
  const aspect = availW / availH;
  const wantW = Math.round(CFG.VIEW_H * aspect / 2) * 2;   // чётное число
  CFG.VIEW_W = clamp(wantW, 854, 1088);

  const s = Math.min(availW / CFG.VIEW_W, availH / CFG.VIEW_H);
  R.scale = s;
  R.cv.width = CFG.VIEW_W;
  R.cv.height = CFG.VIEW_H;
  /* внутренние буферы должны совпадать с новым размером кадра */
  if (R.buf && R.buf.width !== CFG.VIEW_W) {
    R.buf.width = CFG.VIEW_W;  R.buf.height = CFG.VIEW_H;
    R.post.width = CFG.VIEW_W; R.post.height = CFG.VIEW_H;
    R.bctx.imageSmoothingEnabled = false;
    R.pctx.imageSmoothingEnabled = false;
    /* кэши пост-обработки (зерно/виньетка) построены под старый размер */
    if (typeof invalidatePostCache === 'function') invalidatePostCache();
  }
  /* лицо босса центрируем заново — оно привязано к ширине кадра.
     Руки трогаем ТОЛЬКО в состоянии 'up': при 'slam'/'ground'/'aim'/'retract'
     у них есть собственные x/tx (летят к игроку), и безусловный сброс их в
     углы 0.22/0.78 способен телепортировать руку посреди удара или увести
     прицеливание в пустой угол → удар не попадёт по двери, doorHits не растёт.
     Проверено пробой (рука x=500, state='slam' → после resize x=211.2). */
  if (typeof Game !== 'undefined' && Game.state && Game.state.boss) {
    const b = Game.state.boss;
    b.face.x = CFG.VIEW_W / 2 - b.face.w / 2;
    if (b.hands[0].state === 'up') b.hands[0].x = b.hands[0].tx = CFG.VIEW_W * 0.22;
    if (b.hands[1].state === 'up') b.hands[1].x = b.hands[1].tx = CFG.VIEW_W * 0.78;
  }
  const cssW = Math.round(CFG.VIEW_W * s);
  const cssH = Math.round(CFG.VIEW_H * s);
  R.cv.style.width = cssW + 'px';
  R.cv.style.height = cssH + 'px';
  /* рамка UI повторяет ВИДИМЫЙ размер канваса */
  const frame = document.getElementById('frame');
  if (frame) {
    frame.style.width = cssW + 'px';
    frame.style.height = cssH + 'px';
  }
  R.ctx.imageSmoothingEnabled = false;
}

/* ───────────────────────── небо и параллакс ───────────────────────── */
function drawSky(ctx, meta, camX, camY, t, fx) {
  const night = !!(Game.L && Game.L.mech && Game.L.mech.night);
  const g = ctx.createLinearGradient(0, 0, 0, CFG.VIEW_H);
  /* ночь: тёмное небо вместо дневного градиента уровня */
  g.addColorStop(0, night ? '#05060f' : meta.sky[0]);
  g.addColorStop(1, night ? '#15182b' : meta.sky[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, CFG.VIEW_W, CFG.VIEW_H);
  if (night) {
    /* звёзды: детерминированные по координатам, мерцают медленно; не зависят от камеры */
    for (let i = 0; i < 90; i++) {
      const sx = (i * 9173) % CFG.VIEW_W;
      const sy = (i * 6151) % Math.round(CFG.VIEW_H * 0.55);
      const tw = 0.5 + 0.5 * Math.sin(t * (1 + (i % 5) * 0.4) + i);
      ctx.globalAlpha = 0.35 + 0.45 * tw;
      ctx.fillStyle = '#e8ecff';
      ctx.fillRect(sx, sy, i % 7 === 0 ? 2 : 1, i % 7 === 0 ? 2 : 1);
    }
    ctx.globalAlpha = 1;
  }

  /* дальние холмы — два слоя параллакса */
  const c = meta.corruption;
  for (let layer = 0; layer < 2; layer++) {
    const depth = layer === 0 ? 0.18 : 0.34;
    const off = -camX * depth;
    const baseY = CFG.VIEW_H * (layer === 0 ? 0.58 : 0.68) - camY * depth * 0.4;
    const col = layer === 0
      ? shadeHex(meta.ground, -0.18 - c * 0.1, 0.55 - c * 0.3)
      : shadeHex(meta.ground, -0.05, 0.75 - c * 0.35);
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(0, CFG.VIEW_H);
    const step = 26 + layer * 14;
    const amp = 16 + layer * 10;
    for (let x = -step; x <= CFG.VIEW_W + step; x += step) {
      const wx = x + (off % step);
      const h = Math.sin((wx - off) * 0.012 + layer * 2.1) * amp
              + Math.sin((wx - off) * 0.031 + layer) * amp * 0.4;
      ctx.lineTo(wx, baseY + h);
    }
    ctx.lineTo(CFG.VIEW_W, CFG.VIEW_H);
    ctx.closePath();
    ctx.fill();
  }
}

/* Сдвиг яркости/насыщенности hex-цвета */
function shadeHex(hex, dl, sat) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return hex;
  let r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
  const gray = 0.299 * r + 0.587 * g + 0.114 * b;
  const s = sat == null ? 1 : sat;
  r = gray + (r - gray) * s;
  g = gray + (g - gray) * s;
  b = gray + (b - gray) * s;
  const f = 1 + dl;
  r = clamp(Math.round(r * f), 0, 255);
  g = clamp(Math.round(g * f), 0, 255);
  b = clamp(Math.round(b * f), 0, 255);
  return `rgb(${r},${g},${b})`;
}

/* ───────────────────────── тайлы ───────────────────────── */
function drawTiles(ctx, L, camX, camY, t, state) {
  const map = L.map, T = CFG.TILE;
  const x0 = Math.max(0, Math.floor(camX / T) - 1);
  const x1 = Math.min(map.w - 1, Math.ceil((camX + CFG.VIEW_W) / T) + 1);
  const y0 = Math.max(0, Math.floor(camY / T) - 1);
  const y1 = Math.min(map.h - 1, Math.ceil((camY + CFG.VIEW_H) / T) + 1);
  const ts = L.tileset;
  const waterKey = WATER_FRAMES[Math.floor(t * 6) % WATER_FRAMES.length];

  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const ch = map.grid[ty][tx];
      if (ch === '.' ) continue;
      const dx = tx * T, dy = ty * T;

      switch (ch) {
        case '#': {
          /* трава только на верхней кромке */
          const above = ty > 0 ? map.grid[ty - 1][tx] : '.';
          const isTop = !SOLID.has(above) && above !== '=';
          drawImg(ctx, isTop ? ts.ground : ts.stone, dx, dy, T, T);
          break;
        }
        case '=': drawImg(ctx, ts.plat, dx, dy, T, T); break;
        case 's': drawImg(ctx, 'sand', dx, dy, T, T); break;
        case '^': drawImg(ctx, 'spikes', dx, dy, T, T); break;
        case 'W': drawImg(ctx, waterKey, dx, dy, T, T); break;
        case '~': break;   /* невидимый триггер перехода (верхний слой): не рисуется, не SOLID, не DEADLY */
        case 'v': drawImg(ctx, waterKey, dx, dy, T, T); break;   /* видимая вода в обрыве: не SOLID, не DEADLY */
        case 'm': drawImg(ctx, 'mirror', dx, dy, T, T); break;
        case 'x': {
          const cr = state.crumbleMap && state.crumbleMap.get(tx + ',' + ty);
          const stage = cr && cr.phase === 'armed' ? (cr.t < 0.18 ? 3 : 2) : 1;
          drawImg(ctx, 'crumble' + stage, dx, dy, T, T);
          break;
        }
        /* 't' — блоки памяти; у каждого своя отрисовка: ур.7 (tailRadar) —
           по радару хвоста, ур.8 (memoryBlocks) — drawMemoryBlocks по радиусу
           и памяти. Общий проход красил их на 100% даже далёкими и
           неувиденными — механика «память проявляется рядом» не работала. */
        case 't': if (!L.mech.tailRadar && !L.mech.memoryBlocks) drawImg(ctx, 'memory_on', dx, dy, T, T); break;  /* фоллбэк на случай памяти без mech-флагов */
        case 'E': {
          if (L.idx === 0) break;
          /* Дверь 48x72 (1.5x2.25 тайла) рисуем один раз — от верхней клетки,
             центрируя по колонке и ставя низ на грунт. */
          if (ty === 0 || map.grid[ty - 1][tx] !== 'E') {
            drawImg(ctx, L.meta.corruption > 0.6 ? 'door_void' : 'door',
                    dx + (T - 48) / 2, dy + T * 2 - 72, 48, 72);
          }
          break;
        }
        default: break;
      }
    }
  }
}

function drawLightWells(ctx, L, t) {
  if (!L.lightWells || !L.lightWells.length) return;
  const T = CFG.TILE;
  for (const w of L.lightWells) {
    const x = w.tx * T, y = w.ty * T, width = w.w * T, height = w.h * T;
    const g = ctx.createLinearGradient(x, y, x + width, y);
    g.addColorStop(0, 'rgba(255,249,196,0)');
    /* «Лёгкие» (док. ур.5, п.7): колодец с pulseBeat вспыхивает в такт, иначе — медленный синус */
    const a = w.pulseBeat && typeof Game !== 'undefined' && Game.state
      ? (Game.state.rhythmBeat % 2 === 0 ? 0.42 : 0.12)
      : 0.20 + Math.sin(t * 2 + w.tx) * 0.03;
    g.addColorStop(0.5, `rgba(255,249,196,${a})`);
    g.addColorStop(1, 'rgba(255,249,196,0)');
    ctx.fillStyle = g; ctx.fillRect(x, y, width, height);
    ctx.fillStyle = 'rgba(255,255,225,0.09)'; ctx.fillRect(x + width * 0.42, y, width * 0.16, height);
  }
}

function drawKeys(ctx, L, t) {
  if (!L.keys || !L.keys.length) return;
  const T = CFG.TILE;
  for (const k of L.keys) {
    if (k.taken) continue;
    const x = k.tx * T + T / 2, y = k.ty * T + T / 2;
    ctx.save();
    ctx.translate(x, y + Math.sin(t * 3 + k.tx) * 4);
    ctx.rotate(t * 0.8);
    ctx.fillStyle = '#f1d77a';
    ctx.fillRect(-3, -10, 6, 20);
    ctx.fillRect(3, 5, 8, 3);
    ctx.fillRect(3, -2, 6, 3);
    ctx.restore();
  }
}

function drawMirrorFeatures(ctx, L, t, state) {
  const T = CFG.TILE;
  if (L.mech.memoryHub) {
    const names = ['РАДОСТЬ', 'СТРАХ', 'ОДИНОЧЕСТВО', 'ДОМ'];
    for (let i = 0; i < L.portals.length; i++) {
      const p = L.portals[i];
      const name = names[i];
      const taken = state.keys.includes(name);
      ctx.save();
      ctx.strokeStyle = taken ? 'rgba(120,120,130,0.4)' : '#d2bced';
      ctx.lineWidth = 3;
      ctx.strokeRect(p.tx * T, (p.ty - 1) * T, T * 1.2, T * 2.5);
      ctx.fillStyle = taken ? '#888' : '#f5eaff';
      ctx.font = '14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText(name, (p.tx + 0.6) * T, (p.ty - 1.2) * T);
      ctx.restore();
    }
  }
  if (L.mech.mirrorPortals) {
    for (const p of (L.portals || [])) {
      const x = p.tx * T, y = p.ty * T;
      const alpha = 0.18 + Math.sin(t * 3 + p.tx) * 0.06;
      ctx.fillStyle = `rgba(180,225,255,${alpha})`;
      ctx.beginPath(); ctx.ellipse(x + T, y, T * 0.9, T * 0.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = `rgba(225,250,255,${alpha + 0.2})`; ctx.stroke();
    }
    for (const f of (L.fragments || [])) {
      if (f.taken) continue;
      ctx.save(); ctx.translate(f.tx * T + T / 2, f.ty * T + T / 2);
      ctx.rotate(t);
      ctx.fillStyle = '#f6edaa'; ctx.fillRect(-7, -7, 14, 14);
      ctx.restore();
    }
  }
  if (L.mech.rhythm) {
    /* Рисуем по p.lit (его считает игровой шаг): «ложь ритма» (док. ур.5, п.3)
       выглядит как обычная платформа и получает такой же контур-телеграф, но
       тверди не даёт — на неё прыгаешь и проваливаешься (под ней земля есть,
       провал не смерть). Так в зоне ускорения не остаётся пустого места. */
    for (const p of (L.rhythm || [])) {
      if (!p.lit) {
        const beatNow = Game.state ? Game.state.rhythmBeat : -1;
        const period = L.mech.beatPeriod || 0.72;
        const st0 = Game.state || { t: 0, rhythmShift: 0 };
        const nextBeat = Math.floor((st0.t + (st0.rhythmShift || 0)) / period) + 1;
        /* п.5 телеграф: контур за такт до появления, чтобы прыжок можно было спланировать */
        const soon = (p.group - 1) % 4 === nextBeat % 4 || p.group % 4 === nextBeat % 4;
        if (soon && beatNow >= 0) {
          ctx.strokeStyle = 'rgba(190,163,231,0.35)';
          ctx.lineWidth = 2;
          ctx.strokeRect(p.tx * T + 1, p.ty * T + 1, T - 2, T - 2);
        }
        continue;
      }
      const pulse = 0.55 + 0.3 * Math.sin(t * 9);
      ctx.fillStyle = `rgba(190,163,231,${pulse})`;
      ctx.fillRect(p.tx * T, p.ty * T, T, T);
    }
  }
}

function drawVisualPulse(ctx, L, t, state) {
  if (!L.mech.visualPulse) return;
  const T = CFG.TILE;
  const alpha = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(t * 5));
  /* 't' на L7 — SOLID-тайл (engine.js): видимая высота обязана совпадать
     с хитбоксом, иначе Ангел «стоит в воздухе» над 7px-полоской. Пульс —
     по яркости/прозрачности всего блока, а не по его обрезке. */
  for (const m of L.memory) {
    drawImg(ctx, 'memory_on', m.tx * T, m.ty * T, T, T, false, alpha);
  }
}

/* хвост у двери (док. ур.8, п.6): на L8 хвост молчит, у двери вибрирует один раз */
function drawDoorTail(ctx, L, state) {
  const door = L.decor.find(d => d.kind === 'door');
  if (!door || !state.fox || state.foxGone) return;
  const ang = state.angel;
  const dx = door.tx * CFG.TILE, dy = door.ty * CFG.TILE;
  const near = Math.abs(ang.x - dx) < 4 * CFG.TILE;
  if (!near) return;
  const fox = state.fox;
  ctx.save();
  ctx.fillStyle = '#b8eff0';
  ctx.font = 'bold 20px monospace';
  ctx.textAlign = 'center';
  /* однократный рывок (док. ур.8, п.6): при первом подходе хвост дёргается на 6 px */
  const jerk = state.doorTailJerk > 0 ? 6 * Math.sin(state.doorTailJerk * 30) : 0;
  ctx.fillText('≋', fox.x + fox.w / 2 + jerk, fox.y - 16);
  ctx.restore();
}

function drawTailRadar(ctx, L, state) {
  const fox = state.fox;
  const fx = fox.x + fox.w / 2, fy = fox.y - 16;
  let nearest = Infinity;
  /* п.2: расстояние по евклиду (X и Y), иначе секрет на этаже ty 11 и тень на земле дают одинаковый сигнал */
  const dd = (tx, ty) => Math.hypot(tx * CFG.TILE - fox.x, ty * CFG.TILE - fox.y);
  for (const shadow of state.shadows) nearest = Math.min(nearest, Math.hypot(shadow.x - fox.x, shadow.y - fox.y));
  /* секреты (док. ур.7, п.1): радар «≋» чувствует скрытые места, пока не подобраны */
  for (const sec of (L.secrets || [])) if (!sec.found && !sec.fake)
    nearest = Math.min(nearest, dd(sec.tx, sec.ty));
  /* «хвост врёт» (док. ур.7, п.5): ложная точка — радар дрожит у пустоты */
  for (const sec of (L.secrets || [])) if (sec.fake && !sec.found)
    nearest = Math.min(nearest, dd(sec.tx, sec.ty));
  for (const eye of L.decor) if (eye.kind === 'eye')
    nearest = Math.min(nearest, dd(eye.tx, eye.ty));
  const bars = nearest < 160 ? 4 : nearest < 320 ? 2 : 1;
  ctx.save();
  ctx.fillStyle = '#b8eff0';
  ctx.font = 'bold 20px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('≋'.repeat(bars), fx, fy);
  ctx.restore();
}

/* Блоки памяти: рисуем по своему списку, с затуханием по расстоянию */
function drawMemoryBlocks(ctx, L, state, angel) {
  if (!L.mech.memoryBlocks) return;
  const T = CFG.TILE;
  const acx = angel.x + angel.w / 2, acy = angel.y + angel.h / 2;
  /* радиус — как в game.js: портал СТРАХ сужает его через state.memRadiusNow */
  const rad = state.memRadiusNow || L.mech.memRadius || 44;
  for (const mb of L.memory) {
    const cx = mb.tx * T + T / 2, cy = mb.ty * T + T / 2;
    const d = Math.sqrt(dist2(acx, acy, cx, cy));
    let a;
    if (d <= rad) a = 1;
    else if (state.memSeen.has(mb.tx + ',' + mb.ty)) a = L.mech.memFade ? 0.22 : 0.42;
    else a = 0;
    if (a <= 0.01) continue;
    drawImg(ctx, a >= 0.99 ? 'memory_on' : 'memory_off', mb.tx * T, mb.ty * T, T, T, false, a);
  }
}

/* Эхо-платформы — подсвечиваем остаток времени */
function drawEchoPlats(ctx, L, state) {
  if (!state.echo) return;
  const T = CFG.TILE;
  for (const p of state.echo.list) {
    if (p.alive <= 0) continue;
    const k = Math.min(1, p.alive / (p.ttl != null ? p.ttl : state.echo.ttl));
    ctx.save();
    ctx.globalAlpha = 0.35 + k * 0.65;
    drawImg(ctx, L.tileset.plat, p.tx * T, p.ty * T, T, T);
    ctx.globalAlpha = 0.5 * k;
    ctx.fillStyle = '#cfe8ff';
    ctx.fillRect(p.tx * T, p.ty * T, T, 2);
    ctx.restore();
  }
}

/* Разломы */
function drawRifts(ctx, L, t, used) {
  const T = CFG.TILE;
  for (const r of L.rifts) {
    const key = RIFT_FRAMES[Math.floor(t * 9 + r.tx) % RIFT_FRAMES.length];
    /* одноразовый разлом: сработавший рисуется почти невидимым */
    const spent = used && used.has(r.tx + ',' + r.ty);
    ctx.save();
    ctx.globalAlpha = spent ? 0.15 : 0.85;
    for (let dy = -1; dy <= 1; dy++) drawImg(ctx, key, r.tx * T, (r.ty + dy) * T, T, T);
    ctx.restore();
  }
}

/* Зоны времени / инверсии — мягкая подсветка */
/* ТЗ (L9): подсветка опасных участков — инверс-зоны и шипы тревожным красным. */
function drawHazardGlow(ctx, L, t, boost) {
  if (!L.mech.hazardGlow) return;
  /* boost > 1 — окно «мягкой помощи» после серии смертей: подсветка заметно сильнее */
  const k = boost || 1;
  const T = CFG.TILE;
  for (const z of L.zones) {
    if (z.kind !== 'invert') continue;
    const x = z.tx * T, y = z.ty * T, w = z.w * T, h = z.h * T;
    const pulse = (0.26 + 0.08 * Math.sin(t * 3 + z.tx)) * k;
    ctx.fillStyle = `rgba(220,50,60,${Math.min(1, pulse)})`;
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = `rgba(220,50,60,${Math.min(1, pulse + 0.25 * k)})`;
    ctx.lineWidth = 3;
    ctx.strokeRect(x, y, w, h);
    const bx = x + 10, by = y + h / 2;
    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(Math.PI / 4);
    ctx.fillStyle = `rgba(255,80,80,${Math.min(1, (0.5 + 0.3 * Math.sin(t * 4)) * k)})`;
    ctx.fillRect(-6, -6, 12, 12);
    ctx.restore();
  }
  const spikes = findTiles(L.map, '^');
  for (const s of spikes) {
    const x = s.tx * T, y = s.ty * T;
    const pulse = (0.26 + 0.08 * Math.sin(t * 3.5 + s.tx * 0.8)) * k;
    ctx.fillStyle = `rgba(220,50,60,${Math.min(1, pulse)})`;
    ctx.fillRect(x - 2, y - 4, T + 4, T + 4);
    const flare = 0.35 + 0.25 * Math.sin(t * 5 + s.tx);
    ctx.fillStyle = `rgba(255,90,90,${Math.min(1, flare * 0.35 * k)})`;
    ctx.fillRect(x + 4, y + 4, T - 8, T - 8);
  }
}

function drawZones(ctx, L, t) {
  const T = CFG.TILE;
  for (const z of L.zones) {
    const x = z.tx * T, y = z.ty * T, w = z.w * T, h = z.h * T;
    const pulse = 0.06 + 0.04 * Math.sin(t * 2 + z.tx);
    let col;
    if (z.kind === 'anchor') col = `rgba(70,150,255,${pulse + 0.08})`;
    else if (z.kind === 'flip') col = `rgba(235,65,70,${pulse + 0.08})`;
    else if (z.kind === 'slow') col = `rgba(150,130,220,${pulse + 0.05})`;
    else if (z.kind === 'fast') col = `rgba(230,150,90,${pulse + 0.04})`;
    else col = `rgba(210,90,120,${pulse + 0.05})`;
    ctx.fillStyle = col;
    ctx.fillRect(x, y, w, h);
    /* Паттерн зоны: различие читается ФОРМОЙ, а не только оттенком
       (раунд 2 UX, п.15 — при протанопии flip и anchor неразличимы). */
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.lineWidth = 1;
    if (z.kind === 'flip') {
      /* диагональная штриховка — «опрокидывание» */
      for (let i = -h; i < w; i += 12) {
        ctx.beginPath();
        ctx.moveTo(x + i, y + h);
        ctx.lineTo(x + i + h, y);
        ctx.stroke();
      }
    } else if (z.kind === 'slow') {
      /* сетка точек — «вязкость» */
      for (let py = 8; py < h; py += 16)
        for (let px = 8; px < w; px += 16) ctx.fillRect(x + px, y + py, 2.5, 2.5);
    } else if (z.kind === 'fast') {
      /* двойные вертикальные линии — «стрелы» */
      for (let i = 6; i < w; i += 14) {
        ctx.beginPath();
        ctx.moveTo(x + i, y);
        ctx.lineTo(x + i, y + h);
        ctx.moveTo(x + i + 3, y);
        ctx.lineTo(x + i + 3, y + h);
        ctx.stroke();
      }
    } else if (z.kind === 'anchor') {
      /* горизонтальные линии — «устойчивость» */
      for (let i = 6; i < h; i += 14) {
        ctx.beginPath();
        ctx.moveTo(x, y + i);
        ctx.lineTo(x + w, y + i);
        ctx.stroke();
      }
    } else {
      /* прочие: прежние «дышащие» вертикальные штрихи */
      for (let i = 0; i < w; i += 12) {
        const o = Math.sin(t * 1.6 + i * 0.1) * 3;
        ctx.beginPath();
        ctx.moveTo(x + i, y + o);
        ctx.lineTo(x + i, y + h + o);
        ctx.stroke();
      }
    }
  }
}

/* Низ «стоящего» декора привязываем к поверхности под ним, а не к клетке:
   деревья/кусты ставились на ty = GY-4 и висели в воздухе на 3 тайла. */
function decorBaseY(L, tx, fromTy) {
  const T = CFG.TILE;
  for (let ty = fromTy; ty < L.map.h; ty++) {
    const ch = tileAt(L.map, tx, ty);
    if (ch === '#' || ch === '=') return ty * T;
  }
  return (fromTy + 1) * T;
}

/* Декор */
function drawDecor(ctx, L, t, layerBack) {
  const T = CFG.TILE;
  for (const d of L.decor) {
    const x = d.tx * T, y = d.ty * T;
    const back = d.kind === 'cloud1' || d.kind === 'cloud2' || d.kind === 'cloud3'
              || d.kind === 'cloud_bw' || d.kind === 'bird';
    if (back !== !!layerBack) continue;
    /* Размеры/смещения выражаем через T, а не числами под тайл 16:
       дерево 128px = 4 тайла, куст 64x40, глаз 48x32 — как в gen_textures. */
    switch (d.kind) {
      case 'tree': {
        const base = decorBaseY(L, d.tx, d.ty);
        drawImg(ctx, 'tree', x, base - T * 4, T * 4, T * 4);
        break;
      }
      case 'tree_bw': {
        const base = decorBaseY(L, d.tx, d.ty);
        drawImg(ctx, 'tree', x, base - T * 4, T * 4, T * 4, false, 0.55);
        break;
      }
      case 'tree_gray': {
        const base = decorBaseY(L, d.tx, d.ty);
        ctx.save(); ctx.globalAlpha = 0.55; ctx.filter = 'grayscale(1)';
        drawImg(ctx, 'tree', x, base - T * 4, T * 4, T * 4);
        ctx.restore();
        break;
      }
      case 'bush': {
        const base = decorBaseY(L, d.tx, d.ty);
        drawImg(ctx, 'bush', x, base - 40, 64, 40);
        break;
      }
      case 'bush_bw': {
        const base = decorBaseY(L, d.tx, d.ty);
        drawImg(ctx, 'bush_bw', x, base - 40, 64, 40);
        break;
      }
      case 'flower_pink': drawImg(ctx, 'flower_pink', x, y, T, T); break;
      case 'flower_white': drawImg(ctx, 'flower_white', x, y, T, T); break;
      case 'flower_bw': drawImg(ctx, 'flower_bw', x, y, T, T); break;
      case 'final_flower': {
        const pulse = 0.8 + Math.sin(t * 2.4) * 0.15;
        drawImg(ctx, 'flower_pink', x, y, T, T, false, pulse);
        break;
      }
      case 'gray_leaf': {
        ctx.save(); ctx.fillStyle = '#91979a'; ctx.globalAlpha = 0.9;
        ctx.translate(x + T / 2, y + T / 2); ctx.rotate(-0.45);
        ctx.beginPath(); ctx.ellipse(0, 0, 9, 4, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
        break;
      }
      case 'village_house': {
        /* закрытый дом (док. ур.1, п.4): примитивы, без ассетов */
        const base = decorBaseY(L, d.tx, d.ty);
        ctx.save(); ctx.fillStyle = '#4a3c30';
        ctx.fillRect(x, base - T * 2.4, T * 2.2, T * 2.4);
        ctx.fillStyle = '#2b2118';
        ctx.beginPath(); ctx.moveTo(x - 4, base - T * 2.4); ctx.lineTo(x + T * 1.1, base - T * 3.4); ctx.lineTo(x + T * 2.2 + 4, base - T * 2.4); ctx.fill();
        ctx.fillStyle = '#1a140f'; ctx.fillRect(x + T * 0.8, base - T * 1.2, T * 0.5, T * 1.2);   /* дверь */
        ctx.restore();
        break;
      }
      case 'horizon_line': {
        /* чёрная линия на горизонте (док. ур.1, п.5): видна только когда активна сцена */
        if (!L.meta || !(d.visible)) break;
        ctx.save(); ctx.fillStyle = '#000'; ctx.fillRect(x, y, T * 6, 3); ctx.restore();
        break;
      }
      case 'sign': {
        /* надпись на поляне (док. ур.3, п.5): текст из d.text, без ассетов */
        const base = decorBaseY(L, d.tx, d.ty);
        ctx.save();
        ctx.fillStyle = '#2b2118'; ctx.fillRect(x + 6, base - T * 1.6, 4, T * 1.6);
        ctx.fillStyle = '#3a2c20'; ctx.fillRect(x - 10, base - T * 1.9, T * 1.6, T * 0.7);
        ctx.fillStyle = '#e6dccb'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
        ctx.fillText(d.text || '', x - 10 + T * 0.8, base - T * 1.45);
        ctx.restore();
        break;
      }
      case 'door': {
        const base = decorBaseY(L, d.tx, d.ty);
        /* дверь из ключей (док. ур.8, п.5): видна только когда собраны все четыре ключа */
        if (d.onlyWhenKeys && !(Game.state && Game.state.keys && Game.state.keys.length >= 4)) break;
        const dh = (Game.state && Game.state.doorHits) || 0;
        /* дрожь двери сразу после удара (док. ур.10, п.3) */
        const shake = (Game.state && Game.state.doorShakeT > 0) ? Math.sin(Game.state.doorShakeT * 60) * 3 : 0;
        const dx0 = x - T * 0.4 + shake;
        drawImg(ctx, 'door_void', dx0, base - T * 3, T * 1.8, T * 3);
        /* трещины: по одной за удар рук Стража (док. ур.10, п.3).
           Их ровно maxHp босса (L10 — 5): раскладываем по высоте двери, иначе
           пятая уезжает ниже полотна. */
        const maxCracks = (Game.state && Game.state.boss && Game.state.boss.maxHp) || 3;
        const crackStep = (T * 2.6) / maxCracks;
        for (let i = 0; i < Math.min(maxCracks, dh); i++) {
          const cy0 = base - T * 2.5 + i * crackStep;
          ctx.save();
          ctx.globalAlpha = 0.5 + 0.5 * (i / maxCracks);
          ctx.strokeStyle = '#ffb0b0';
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          const cx = dx0 + T * 0.9;
          ctx.moveTo(cx, cy0);
          ctx.lineTo(cx + (i % 2 ? T * 0.5 : -T * 0.5), cy0 + T * 0.4);
          ctx.lineTo(cx + (i % 2 ? T * 0.2 : -T * 0.2), cy0 + T * 0.8);
          ctx.stroke();
          ctx.restore();
        }
        break;
      }
      case 'grass_tuft':
        drawImg(ctx, L.meta.corruption < 0.3 ? 'tuft' : 'tuft_bw', x, y, T, T, false, 0.85);
        break;
      case 'grid': drawImg(ctx, 'grid', x, y, T, T); break;
      case 'eye': {
        /* глаз мигает по своему ритму */
        const ph = (t * 0.6 + d.tx * 0.37) % 4;
        const key = ph < 3.4 ? 'eye1' : (ph < 3.7 ? 'eye2' : 'eye3');
        drawImg(ctx, key, x, y, 48, 32, false, 0.8);
        break;
      }
      case 'bird': {
        const key = Math.floor(t * 6 + d.tx) % 2 ? 'bird1' : 'bird2';
        const fx2 = ((t * 44 + d.tx * 37) % (L.map.w * T));
        drawImg(ctx, key, fx2, y + Math.sin(t + d.tx) * 8, 24, 16, false, 0.7);
        break;
      }
      case 'cloud1': case 'cloud2': case 'cloud3': case 'cloud_bw': {
        const im = ASSETS.img[d.kind];
        const w = im ? im.width : 64, h = im ? im.height : 28;
        const drift = (t * 5 + d.tx * 29) % (L.map.w * T + 200) - 100;
        drawImg(ctx, d.kind, drift, y, w, h);
        break;
      }
      default: break;
    }
  }
}

/* ───────────────────────── сущности ───────────────────────── */

function drawAngel(ctx, a, t, state) {
  let def, key;
  if (!a.onGround) { def = SHEETS.angel_jump; key = 'angel_jump'; }
  else if (Math.abs(a.vx) > 8) { def = SHEETS.angel_walk; key = 'angel_walk'; }
  else { def = SHEETS.angel_idle; key = 'angel_idle'; }

  let frame;
  if (key === 'angel_jump') {
    /* подбираем кадр по фазе прыжка, а не по времени */
    const vy = a.vy * a.grav;
    const i = vy < -140 ? 1 : (vy < 40 ? 2 : 3);
    frame = def.frames[Math.min(i, def.frames.length - 1)];
  } else {
    frame = animFrame(def, t);
  }

  const dh = DRAW.ANGEL_H, dw = DRAW.ANGEL_W;
  /* Ноги в спрайте прижаты к нижней кромке клетки (bottomPad 0-2px, измерено),
     поэтому низ отрисовки совмещаем с низом хитбокса, а по X центрируем. */
  const dx = Math.round(a.x + a.w / 2 - dw / 2);
  const dy = Math.round(a.y + a.h - dh);

  ctx.save();
  if (a.grav < 0) {
    /* при инверсии переворачиваем спрайт */
    ctx.translate(0, a.y + a.h / 2);
    ctx.scale(1, -1);
    ctx.translate(0, -(a.y + a.h / 2));
  }
  /* мягкая тень под ногами */
  if (a.grav > 0) {
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(a.x + a.w / 2, a.y + a.h, 7, 2.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  if (state && state.invuln > 0 && Math.floor(state.invuln * 14) % 2) ctx.globalAlpha = 0.45;
  drawFrame(ctx, key, def, frame, dx, dy, dw, dh, a.facing < 0);
  ctx.restore();
}

function drawFox(ctx, f, t) {
  let name;
  if (!f.onGround) name = 'fox_jump';
  else if (Math.abs(f.vx) > 10) name = 'fox_run';
  else name = 'fox_idle';
  const def = SHEETS[name];
  const frame = animFrame(def, t);
  const dh = DRAW.FOX_H, dw = DRAW.FOX_W;
  /* В клетке 32x32 лис занимает только нижние ~11px (измерено), поэтому
     при выравнивании по низу клетки он «висел» бы над землёй. Сдвигаем вниз
     на пустой отступ, умноженный на масштаб. */
  const FOX_SCALE = dh / 32;
  const emptyBottom = 0;                  // bottomPad кадров = 0
  const dx = Math.round(f.x + f.w / 2 - dw / 2);
  const dy = Math.round(f.y + f.h - dh + emptyBottom * FOX_SCALE);
  if (!(f.grav < 0)) {
    ctx.save();
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(f.x + f.w / 2, f.y + f.h, 11, 3.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  /* при инверсии гравитации (ур.6) Лис висит на потолке — переворачиваем спрайт */
  if (f.grav < 0) {
    ctx.save();
    ctx.translate(0, Math.round(f.y + f.h / 2) * 2);
    ctx.scale(1, -1);
    drawFrame(ctx, 'fox', def, frame, dx, dy, dw, dh, f.facing < 0);
    ctx.restore();
  } else {
    drawFrame(ctx, 'fox', def, frame, dx, dy, dw, dh, f.facing < 0);
  }
}

function drawShadow(ctx, s, t) {
  /* невидимая тень (док. ур.3, п.3): не рисуется, пока крик её не проявил */
  if (s.hidden && !(s.revealT > 0)) return;
  const key = SHADOW_FRAMES[Math.floor(t * 8 + s.x * 0.1) % SHADOW_FRAMES.length];
  /* огромная тень (док. ур.7, п.6): scale меняет только рисунок, коллизия остаётся */
  const sc = s.scale || 1;
  const dh = DRAW.SHADOW_H * sc, dw = DRAW.SHADOW_W * sc;
  /* «Дрожит мир» (док. ур.7, п.4): спрайт тени дрожит на ±2 px, коллизия не меняется */
  const jit = s.jitter ? Math.round(Math.sin(t * 37 + s.x) * 2) : 0;
  const dx = Math.round(s.x + s.w / 2 - dw / 2) + jit;
  const dy = Math.round(s.y + s.h - dh);
  ctx.save();
  ctx.globalAlpha = (s.hidden ? Math.min(0.9, s.revealT / 0.3) : 0.9) * (s.pulseMul != null ? s.pulseMul : 1);
  drawImg(ctx, key, dx, dy, dw, dh, s.facing < 0);
  ctx.restore();
}

/* Зеркальный двойник — тот же спрайт, но тёмный силуэт */
function drawTwin(ctx, e, t) {
  if (!e.ready) return;
  const def = SHEETS.angel_walk;
  const frame = animFrame(def, t);
  const dh = DRAW.ANGEL_H, dw = DRAW.ANGEL_W;
  const dx = Math.round(e.x + e.w / 2 - dw / 2);
  const dy = Math.round(e.y + e.h - dh);
  ctx.save();
  ctx.globalAlpha = 0.85;
  /* рисуем в offscreen? проще — затемняем через фильтр */
  ctx.filter = 'brightness(0.15) saturate(0)';
  drawFrame(ctx, 'angel_walk', def, frame, dx, dy, dw, dh, e.facing < 0);
  ctx.filter = 'none';
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = 'rgba(120,150,220,0.35)';
  ctx.fillRect(dx, dy, dw, dh);
  ctx.restore();
}

/* Босс */
function drawBoss(ctx, b, t, L) {
  /* фон-арена: анимированные слои */
  const bgKey = BOSSBG_FRAMES[Math.floor(t * 4) % BOSSBG_FRAMES.length];
  ctx.save();
  ctx.globalAlpha = 0.5;
  drawImg(ctx, bgKey, 0, 0, CFG.VIEW_W, CFG.VIEW_H * 0.8);
  ctx.restore();

  /* лицо */
  const f = b.face;
  ctx.save();
  if (b.hurtFlash > 0 && Math.floor(b.hurtFlash * 20) % 2) ctx.filter = 'brightness(2.5)';
  const scale = b.face.open ? 1.12 : 1.0;
  const fw = f.w * scale, fh = f.h * scale;
  drawImg(ctx, 'boss_face', f.x + (f.w - fw) / 2, f.y + (f.h - fh) / 2, fw, fh);
  ctx.filter = 'none';
  /* свечение когда уязвим */
  if (b.vulnerable) {
    const p = 0.35 + 0.25 * Math.sin(t * 9);
    ctx.globalAlpha = p;
    ctx.strokeStyle = '#ff6060';
    ctx.lineWidth = 2;
    ctx.strokeRect(f.x - 2, f.y - 2, f.w + 4, f.h + 4);
  }
  ctx.restore();

  /* руки */
  for (const h of b.hands) {
    let key = 'boss_hand1';
    if (h.state === 'slam' || h.state === 'ground') key = 'boss_hand3';
    else if (h.state === 'aim') key = 'boss_hand2';
    const size = CFG.TILE * 3;        // совпадает с хитбоксом в bossHazards
    ctx.save();
    if (h.state === 'aim') {
      /* предупреждение — мигающая линия вниз */
      ctx.globalAlpha = 0.3 + 0.3 * Math.sin(t * 22);
      ctx.strokeStyle = '#ff5050';
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(h.x, h.y + size);
      ctx.lineTo(h.x, CFG.VIEW_H);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    drawImg(ctx, key, h.x - size / 2, h.y, size, size);
    ctx.restore();
  }
}

/* ───────────────────────── пост-обработка ───────────────────────── */

/* Кэш для зерна и виньетки — пересоздаём только при изменении размера кадра
   или параметров, а не каждый кадр. Это убирает ~120 drawImage/кадр для
   зерна и createRadialGradient/кадр для виньетки. */
let _grainPat = null, _grainW = 0, _grainH = 0;
let _vigGrad = null, _vigW = 0, _vigH = 0, _vigAlpha = -1;

function applyPost(srcCanvas, outCtx, c, t, extra) {
  const fxv = corruptionFx(c);
  const W = CFG.VIEW_W, Hh = CFG.VIEW_H;
  const glitch = (extra && extra.glitch) || 0;
  const flash = (extra && extra.flash) || 0;

  outCtx.save();
  outCtx.fillStyle = '#000';
  outCtx.fillRect(0, 0, W, Hh);

  /* десатурация + контраст одним фильтром */
  const sat = Math.round(fxv.saturation * 100);
  const con = fxv.contrast.toFixed(2);
  outCtx.filter = `saturate(${sat}%) contrast(${con})`;

  /* хроматическая аберрация: база + две смещённые копии, сложенные через
     'lighter' (аддитивно). Раньше копии рисовались source-over с alpha 0.25 —
     это не кайма, а полупрозрачное затирание базы, кадр выбеливается.
     Тумблер доступности fxChroma (настройки) выключает расщепление. */
  const ch = (fxEnabled('fxChroma') ? fxv.chroma : 0) + glitch * 4;
  if (ch > 0.4) {
    outCtx.drawImage(srcCanvas, 0, 0);
    outCtx.save();
    outCtx.globalCompositeOperation = 'lighter';
    outCtx.globalAlpha = 0.25;
    outCtx.drawImage(srcCanvas, -ch, 0);
    outCtx.drawImage(srcCanvas, ch, 0);
    outCtx.restore();
  } else {
    outCtx.drawImage(srcCanvas, 0, 0);
  }
  outCtx.filter = 'none';

  /* L8: четыре воспоминания читаются разной тональностью (док. ур.8, п.1):
     РАДОСТЬ — пересвет, СТРАХ — холодная тьма, ОДИНОЧЕСТВО — серая пустота,
     ДОМ — тёплый свет. Зона по X игрока (см. mech.zoneTints). */
  if (extra && extra.zoneTint) {
    outCtx.save();
    outCtx.globalCompositeOperation = 'overlay';
    outCtx.globalAlpha = extra.zoneTint.a != null ? extra.zoneTint.a : 0.22;
    outCtx.fillStyle = extra.zoneTint.color;
    outCtx.fillRect(0, 0, W, Hh);
    outCtx.restore();
  }

  /* глитч-полосы */
  if (glitch > 0.02) {
    const bands = Math.floor(2 + glitch * 7);
    for (let i = 0; i < bands; i++) {
      const y = Math.floor(Math.random() * Hh);
      const h = 2 + Math.floor(Math.random() * 10);
      const dx = (Math.random() - 0.5) * glitch * 34;
      outCtx.drawImage(srcCanvas, 0, y, W, h, dx, y, W, h);
    }
  }

  /* зерно — ОПТИМИЗАЦИЯ: кэшируем заполненный паттерн-канвас размером с
     экран, пересоздаём только при ресайзе. Раньше: ~120 drawImage(grainCv)
     каждый кадр. Теперь: 1 drawImage. */
  if (fxv.grain > 0.02) {
    if (_grainW !== W || _grainH !== Hh) {
      const gc = document.createElement('canvas');
      gc.width = W; gc.height = Hh;
      const gctx = gc.getContext('2d');
      const ox = Math.floor(Math.random() * 96), oy = Math.floor(Math.random() * 96);
      for (let x = -ox; x < W; x += 96)
        for (let y = -oy; y < Hh; y += 96)
          gctx.drawImage(R.grainCv, x, y);
      _grainPat = gc; _grainW = W; _grainH = Hh;
    }
    outCtx.save();
    outCtx.globalCompositeOperation = 'overlay';
    outCtx.globalAlpha = fxv.grain * 0.5;
    outCtx.drawImage(_grainPat, 0, 0);
    outCtx.restore();
  }

  /* виньетка — ОПТИМИЗАЦИЯ: кэшируем градиент, пересоздаём только при
     изменении размера или alpha. */
  if (fxv.vignette > 0.03) {
    const va = clamp(fxv.vignette, 0, 0.92);
    if (_vigW !== W || _vigH !== Hh || Math.abs(_vigAlpha - va) > 0.01) {
      const vc = document.createElement('canvas');
      vc.width = W; vc.height = Hh;
      const vctx = vc.getContext('2d');
      const g = vctx.createRadialGradient(W / 2, Hh / 2, Hh * 0.28, W / 2, Hh / 2, Hh * 0.82);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, `rgba(0,0,0,${va})`);
      vctx.fillStyle = g;
      vctx.fillRect(0, 0, W, Hh);
      _vigGrad = vc; _vigW = W; _vigH = Hh; _vigAlpha = va;
    }
    outCtx.drawImage(_vigGrad, 0, 0);
  }

  /* полная темнота сцены (док. ур.2): extra.darkness 0..1 — чёрный слой поверх мира */
  if (extra && extra.darkness > 0.01) {
    outCtx.save();
    outCtx.globalAlpha = clamp(extra.darkness, 0, 1);
    outCtx.fillStyle = '#000';
    outCtx.fillRect(0, 0, W, Hh);
    outCtx.restore();
  }

  /* вспышка */
  if (flash > 0.01) {
    outCtx.globalAlpha = clamp(flash, 0, 1);
    outCtx.fillStyle = (extra && extra.flashColor) || '#fff';
    outCtx.fillRect(0, 0, W, Hh);
    outCtx.globalAlpha = 1;
  }
  outCtx.restore();
}

/* Сброс кэшей пост-обработки при ресайзе */
function invalidatePostCache() {
  _grainW = 0; _vigW = 0; _vigAlpha = -1;
}

/* Вывод на экран 1:1 в буфер; растяжение делает CSS (pixelated) */
function present(srcCanvas) {
  R.ctx.imageSmoothingEnabled = false;
  R.ctx.drawImage(srcCanvas, 0, 0);
}

/* ── 11-я сцена (mech.cinematic): вместо карты — тёмный зал.
   Портрет Лиса — DOM-слой (.vn.cinematic), поэтому здесь только фон:
   вертикальный градиент, тёплое пятно за спиной и медленная пыль. ── */
function drawCinematicStage(ctx, st) {
  const w = CFG.VIEW_W, h = CFG.VIEW_H, t = st.t || 0;
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, '#0b0c10');
  bg.addColorStop(0.5, '#12141a');
  bg.addColorStop(1, '#040507');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  /* пятно света за Лисом «дышит» — сцена не выглядит статичным скриншотом */
  const pulse = 0.5 + 0.5 * Math.sin(t * 0.7);
  const cx = w / 2, cy = h * 0.42, r = 250 + pulse * 30;
  const rg = ctx.createRadialGradient(cx, cy, 8, cx, cy, r);
  rg.addColorStop(0, 'rgba(230,158,96,' + (0.20 + pulse * 0.06).toFixed(3) + ')');
  rg.addColorStop(0.55, 'rgba(130,86,60,0.07)');
  rg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = rg;
  ctx.fillRect(0, 0, w, h);

  /* пылинки всплывают вверх (детерминированно, без Math.random в кадре) */
  for (let i = 0; i < 46; i++) {
    const px = (i * 197.3) % w;
    const py = (((i * 83.7) - t * (6 + (i % 5) * 3)) % h + h) % h;
    const a = 0.05 + (i % 4) * 0.03 + pulse * 0.02;
    ctx.fillStyle = 'rgba(230,214,196,' + a.toFixed(3) + ')';
    ctx.fillRect(px, py, 2, 2);
  }

  /* затемнение под текстовое окно, чтобы строка читалась */
  const sh = ctx.createLinearGradient(0, h - 180, 0, h);
  sh.addColorStop(0, 'rgba(0,0,0,0)');
  sh.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = sh;
  ctx.fillRect(0, h - 180, w, 180);
}
