/* engine.js — ЧИСТЫЕ правила игры: физика, коллизии, поведение сущностей.
   Никакого DOM/canvas/audio. Запускается в браузере и в Node (для тестов). */
'use strict';

if (typeof window === 'undefined' && typeof require === 'function') {
  Object.assign(globalThis, require('./utils'));
  Object.assign(globalThis, require('./config'));
}

/* ─────────────────────────── Карта уровня ───────────────────────────
   Карта — массив строк. Символы:
     '.' пусто            '#' твердый блок        '=' платформа (проход снизу)
     '^' шипы/смерть      'W' вода (смерть)       'S' старт Ангела
     'E' выход            'F' старт Лиса          'x' исчезающий блок
     'm' зеркальный блок  't' блок-память (виден только рядом)
     'o' цветок           'T' дерево (декор)      'g' решётка (декор)
     'r' разлом (переворот гравитации)            'c' точка крика (эхо)
     's' песчаный блок (твердый, визуальная смена почвы)
     'v' видимая вода-портал (L4): НЕ твёрдая и НЕ смертельная
     '~' невидимый триггер перехода: не рисуется, НЕ твёрдый, НЕ смертельный */
const SOLID = new Set(['#', 'x', 'm', 't', 's']);
const DEADLY = new Set(['^', 'W']);

function makeMap(rows) {
  const h = rows.length;
  const w = Math.max(...rows.map(r => r.length));
  const grid = rows.map(r => r.padEnd(w, '.').split(''));
  return { w, h, grid, rows };
}

function tileAt(map, tx, ty) {
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return '.';
  return map.grid[ty][tx];
}
function setTile(map, tx, ty, ch) {
  if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return;
  map.grid[ty][tx] = ch;
}

/* Найти все клетки с символом */
function findTiles(map, ch) {
  const out = [];
  for (let y = 0; y < map.h; y++)
    for (let x = 0; x < map.w; x++)
      if (map.grid[y][x] === ch) out.push({ tx: x, ty: y });
  return out;
}

/* ───────────────────── Проверки столкновений ───────────────────── */

/* Твердо ли в этой точке мира. hidden — набор "выключенных" клеток "tx,ty" */
function solidAtPoint(map, px, py, hidden) {
  const tx = Math.floor(px / CFG.TILE), ty = Math.floor(py / CFG.TILE);
  const ch = tileAt(map, tx, ty);
  if (!SOLID.has(ch)) return false;
  if (hidden && hidden.has(tx + ',' + ty)) return false;
  return true;
}

/* Пересекает ли прямоугольник твердую геометрию */
function rectSolid(map, r, hidden) {
  const x0 = Math.floor(r.x / CFG.TILE), x1 = Math.floor((r.x + r.w - 0.001) / CFG.TILE);
  const y0 = Math.floor(r.y / CFG.TILE), y1 = Math.floor((r.y + r.h - 0.001) / CFG.TILE);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const ch = tileAt(map, tx, ty);
      if (!SOLID.has(ch)) continue;
      if (hidden && hidden.has(tx + ',' + ty)) continue;
      return true;
    }
  }
  return false;
}

/* Платформа '=' — твёрдая только со стороны, ОТКУДА на неё падают.
   grav > 0: падаем вниз, опора — верхняя грань тайла.
   grav < 0 (разлом): «падаем» вверх, опора — нижняя грань тайла.
   Без параметра grav тайлы "=" на уровнях с перевёрнутой гравитацией
   не твердели вообще: prevBottom при движении вверх только растёт. */
function platformBelow(map, r, prevFeet, hidden, grav) {
  const g = (grav < 0) ? -1 : 1;
  const feet = g > 0 ? (r.y + r.h) : r.y;
  const x0 = Math.floor(r.x / CFG.TILE), x1 = Math.floor((r.x + r.w - 0.001) / CFG.TILE);
  const ty = Math.floor(feet / CFG.TILE);
  for (let tx = x0; tx <= x1; tx++) {
    if (tileAt(map, tx, ty) !== '=') continue;
    if (hidden && hidden.has(tx + ',' + ty)) continue;
    const surf = g > 0 ? ty * CFG.TILE : (ty + 1) * CFG.TILE;
    if (g > 0) { if (prevFeet <= surf + 0.5 && feet >= surf) return surf; }
    else { if (prevFeet >= surf - 0.5 && feet <= surf) return surf; }
  }
  return null;
}

function rectDeadly(map, r) {
  const x0 = Math.floor(r.x / CFG.TILE), x1 = Math.floor((r.x + r.w - 0.001) / CFG.TILE);
  const y0 = Math.floor(r.y / CFG.TILE), y1 = Math.floor((r.y + r.h - 0.001) / CFG.TILE);
  for (let ty = y0; ty <= y1; ty++)
    for (let tx = x0; tx <= x1; tx++)
      if (DEADLY.has(tileAt(map, tx, ty))) return true;
  return false;
}

/* ─────────────────────────── Актёр ─────────────────────────── */

function makeActor(x, y, w, h) {
  return {
    x, y, w, h,
    vx: 0, vy: 0,
    onGround: false,
    grav: 1,            // 1 = вниз, -1 = вверх (разлом)
    facing: 1,
    coyote: 0,
    jumpBuf: 0,
    dead: false,
  };
}

function actorRect(a) { return { x: a.x, y: a.y, w: a.w, h: a.h }; }

/* Перемещение с разрешением коллизий по осям.
   Снапим РОВНО к границе тайла — иначе остаётся щель в доли пикселя
   и onGround мерцает через кадр. */
function moveActor(map, a, dt, hidden) {
  const res = { hitWall: false, hitCeil: false, landed: false };
  const prevBottom = a.y + a.h;
  const T = CFG.TILE;

  /* ── X ── */
  if (a.vx !== 0) {
    a.x += a.vx * dt;
    if (rectSolid(map, actorRect(a), hidden)) {
      if (a.vx > 0) {
        const tx = Math.floor((a.x + a.w - 0.001) / T);
        a.x = tx * T - a.w;
      } else {
        const tx = Math.floor(a.x / T);
        a.x = (tx + 1) * T;
      }
      /* страховка: если снап не помог (угловой случай) — отступаем пикселями */
      let guard = 0;
      const step = a.vx > 0 ? -1 : 1;
      while (rectSolid(map, actorRect(a), hidden) && guard++ < 64) a.x += step;
      a.vx = 0;
      res.hitWall = true;
    }
  }

  /* ── Y ── */
  const movingDown = a.vy > 0;
  const wasFalling = a.grav > 0 ? a.vy > 0 : a.vy < 0;
  a.y += a.vy * dt;
  if (rectSolid(map, actorRect(a), hidden)) {
    if (movingDown) {
      const ty = Math.floor((a.y + a.h - 0.001) / T);
      a.y = ty * T - a.h;
    } else {
      const ty = Math.floor(a.y / T);
      a.y = (ty + 1) * T;
    }
    let guard = 0;
    const step = movingDown ? -1 : 1;
    while (rectSolid(map, actorRect(a), hidden) && guard++ < 64) a.y += step;
    if (wasFalling) res.landed = true;
    else res.hitCeil = true;
    a.vy = 0;
  } else if (a.vy * a.grav > 0) {
    /* односторонняя платформа — только при движении в сторону гравитации */
    const prevFeet = a.grav > 0 ? prevBottom : (prevBottom - a.h);
    const top = platformBelow(map, actorRect(a), prevFeet, hidden, a.grav);
    if (top !== null) {
      a.y = a.grav > 0 ? top - a.h : top;
      a.vy = 0;
      res.landed = true;
    }
  }

  /* onGround считаем щупом, а не фактом столкновения в этом кадре:
     так флаг стабилен между кадрами. */
  a.onGround = groundCheck(map, a, hidden) && Math.abs(a.vy) < 1;
  return res;
}

/* Стоит ли актёр на земле сейчас (проверка щупом под ногами) */
function groundCheck(map, a, hidden) {
  const probe = { x: a.x + 1, y: a.y + (a.grav > 0 ? a.h : -1), w: a.w - 2, h: 1 };
  if (rectSolid(map, probe, hidden)) return true;
  /* '=' — односторонняя платформа: опора та, на которую «падаем».
     grav > 0 — верхняя грань тайла под ногами, grav < 0 — нижняя грань
     тайла над головой (симметрично platformBelow). */
  const g = (a.grav < 0) ? -1 : 1;
  const x0 = Math.floor(a.x / CFG.TILE), x1 = Math.floor((a.x + a.w - 0.001) / CFG.TILE);
  if (g > 0) {
    const ty = Math.floor((a.y + a.h + 0.5) / CFG.TILE);
    for (let tx = x0; tx <= x1; tx++) {
      if (tileAt(map, tx, ty) === '=' && Math.abs((a.y + a.h) - ty * CFG.TILE) < 1.5) return true;
    }
  } else {
    const ty = Math.floor((a.y - 0.5) / CFG.TILE);
    for (let tx = x0; tx <= x1; tx++) {
      if (tileAt(map, tx, ty) === '=' && Math.abs(a.y - (ty + 1) * CFG.TILE) < 1.5) return true;
    }
  }
  return false;
}

/* ─────────────── Управление Ангелом ─────────────── */
/* input: {left,right,jumpHeld,jumpPressed} */
function updateAngel(map, a, input, dt, hidden, mods) {
  mods = mods || {};
  const speedMul = mods.speedMul == null ? 1 : mods.speedMul;
  const gravMul = mods.gravMul == null ? 1 : mods.gravMul;
  const inverted = !!mods.invertControls;

  let left = input.left, right = input.right;
  if (inverted) { const t = left; left = right; right = t; }

  /* горизонталь */
  const target = (right ? 1 : 0) - (left ? 1 : 0);
  const maxSp = CFG.RUN_SPEED * speedMul;
  const accel = (a.onGround ? CFG.RUN_ACCEL : CFG.AIR_ACCEL) * dt;
  if (target !== 0) {
    a.vx = approach(a.vx, target * maxSp, accel);
    a.facing = target;
  } else {
    a.vx = approach(a.vx, 0, (a.onGround ? CFG.RUN_DECEL : CFG.AIR_ACCEL) * dt);
  }

  /* таймеры прыжка */
  /* mods.coyoteBonus — мягкая помощь после серии смертей (config AID_*) */
  const coyoteFull = CFG.COYOTE + (mods.coyoteBonus || 0);
  if (groundCheck(map, a, hidden)) a.coyote = coyoteFull;
  else a.coyote = Math.max(0, a.coyote - dt);
  if (input.jumpPressed) a.jumpBuf = CFG.JUMP_BUFFER;
  else a.jumpBuf = Math.max(0, a.jumpBuf - dt);

  /* прыжок */
  if (a.jumpBuf > 0 && a.coyote > 0) {
    a.vy = -CFG.JUMP_VEL * a.grav;
    a.jumpBuf = 0;
    a.coyote = 0;
    a.onGround = false;
  }
  /* обрезка прыжка при отпускании */
  const rising = a.grav > 0 ? a.vy < 0 : a.vy > 0;
  if (rising && !input.jumpHeld) a.vy *= Math.pow(CFG.JUMP_CUT, dt * 60);

  /* гравитация */
  const falling = a.grav > 0 ? a.vy > 0 : a.vy < 0;
  const g = CFG.GRAVITY * gravMul * (falling ? CFG.GRAVITY_FALL_MULT : 1);
  a.vy += g * a.grav * dt;
  const maxF = CFG.MAX_FALL;
  if (a.grav > 0) a.vy = Math.min(a.vy, maxF); else a.vy = Math.max(a.vy, -maxF);

  return moveActor(map, a, dt, hidden);
}

/* ─────────────── Лис: следует за Ангелом ───────────────
   Умнее прежнего «беги и иногда прыгай»:
     1) держит мёртвую зону, чтобы не толкаться под ногами;
     2) видит стену перед собой и перепрыгивает её;
     3) видит обрыв и прыгает через него, если впереди есть земля;
     4) прыгает, когда Ангел выше — с учётом реальной высоты уступа;
     5) если застрял (упирается и не движется) — прыжок, потом телепорт;
     6) если отстал слишком далеко или потерялся по вертикали — появляется
        рядом «из кустов» (по документу Лис обходит своим путём).
   Состояние живёт в самом объекте f (f.stuckT, f.jumpCd). */
function updateFox(map, f, targetX, targetY, dt, hidden) {
  const T = CFG.TILE;
  if (f.stuckT == null) f.stuckT = 0;
  if (f.jumpCd == null) f.jumpCd = 0;
  if (f.grav == null) f.grav = 1;   /* Лис переворачивается вместе с Ангелом (ур.6) */
  f.jumpCd = Math.max(0, f.jumpCd - dt);

  const cx = f.x + f.w / 2;
  const dx = targetX - cx;
  const adx = Math.abs(dx);
  const dir = sign(dx);
  const onGr = groundCheck(map, f, hidden);

  /* ── бег с мёртвой зоной ── */
  if (adx > CFG.FOX_DEADZONE) {
    f.vx = approach(f.vx, dir * CFG.FOX_SPEED, 1800 * dt);
    f.facing = dir;
  } else {
    f.vx = approach(f.vx, 0, 2000 * dt);
    /* в мёртвой зоне смотрит на Ангела */
    if (adx > 6) f.facing = dir;
  }

  const moveDir = f.vx !== 0 ? sign(f.vx) : f.facing;

  /* ── зрение: что впереди ── */
  const probeX = moveDir > 0 ? f.x + f.w + 2 : f.x - 3;
  /* стена на уровне тела */
  const wallAhead = rectSolid(map, { x: probeX, y: f.y + 4, w: 2, h: f.h - 8 }, hidden);
  /* земля под следующим шагом */
  const groundAhead = rectSolid(map, { x: probeX, y: f.y + f.h + 1, w: 2, h: 6 }, hidden);
  /* есть ли опора чуть дальше — значит обрыв перепрыгиваемый */
  const landingX = moveDir > 0 ? f.x + f.w + T * 2 : f.x - T * 2;
  const landingAhead =
    rectSolid(map, { x: landingX, y: f.y + f.h + 1, w: T, h: T * 3 }, hidden) ||
    rectSolid(map, { x: landingX, y: f.y, w: T, h: T * 2 }, hidden);

  /* ── высота уступа, если впереди стена: перепрыгнем или нет ── */
  let ledgeTiles = 0;
  if (wallAhead) {
    const tx = Math.floor((moveDir > 0 ? f.x + f.w + 3 : f.x - 4) / T);
    const feetTy = Math.floor((f.y + f.h - 1) / T);
    for (let up = 1; up <= 5; up++) {
      const ch = tileAt(map, tx, feetTy - up + 1);
      if (!SOLID.has(ch) && ch !== '=') { ledgeTiles = up - 1; break; }
      ledgeTiles = up;
    }
  }

  /* ── причины прыгнуть ── */
  const wantUp = targetY < f.y - T * 1.5 && adx < T * 9;   // Ангел реально выше (ступни), не на одной земле
  const wantWall = wallAhead && ledgeTiles > 0 && ledgeTiles <= 4;
  const wantGap = !groundAhead && landingAhead && adx > CFG.FOX_DEADZONE;
  const wantUnstick = f.stuckT > CFG.FOX_STUCK_TIME;

  if (onGr && f.jumpCd <= 0 && (wantUp || wantWall || wantGap || wantUnstick)) {
    f.vy = -(CFG.FOX_JUMP_VEL || CFG.JUMP_VEL * 0.9) * f.grav;
    f.jumpCd = 0.28;
    if (wantUnstick) f.stuckT = 0;
  }

  /* ── детектор застревания ── */
  const tryingToMove = adx > CFG.FOX_DEADZONE;
  const barelyMoving = Math.abs(f.vx) < CFG.FOX_SPEED * 0.25;
  if (tryingToMove && onGr && barelyMoving) f.stuckT += dt;
  else if (Math.abs(f.vx) > CFG.FOX_SPEED * 0.5) f.stuckT = 0;

  /* ── гравитация и движение ── */
  f.vy += CFG.GRAVITY * f.grav * dt;
  f.vy = f.grav > 0 ? Math.min(f.vy, CFG.MAX_FALL) : Math.max(f.vy, -CFG.MAX_FALL);
  const res = moveActor(map, f, dt, hidden);

  /* ── совсем отстал/потерялся: появляется рядом ──
     Условия: далеко по X, или сильно ниже (упал в яму), или долго застрял. */
  const lostX = adx > (CFG.FOX_TELEPORT_DIST || 900);
  const lostY = (f.y - targetY) > T * 7;
  const reallyStuck = f.stuckT > CFG.FOX_STUCK_TIME * 3.5;
  if (lostX || lostY || reallyStuck) {
    const side = dir !== 0 ? -dir : -1;              // появляется позади Ангела
    const spot = findFoxSpot(map, targetX + side * T * 2.2, targetY, f, hidden);
    if (spot) {
      f.x = spot.x; f.y = spot.y;
      f.vx = 0; f.vy = 0;
      f.stuckT = 0;
      f.respawned = (f.respawned || 0) + 1;
    }
  }
  return res;
}

/* Свободная точка на земле возле (wantX, nearY) — куда Лису «выйти из кустов» */
function findFoxSpot(map, wantX, nearY, f, hidden) {
  const T = CFG.TILE;
  const startTx = Math.floor(wantX / T);
  const baseTy = Math.floor(nearY / T);
  for (let spread = 0; spread <= 6; spread++) {
    for (const s of (spread === 0 ? [0] : [-spread, spread])) {
      const tx = startTx + s;
      if (tx < 0 || tx >= map.w) continue;
      /* ищем поверхность в пределах пары тайлов от уровня Ангела */
      for (let dy = -2; dy <= 4; dy++) {
        const ty = baseTy + dy;
        if (ty < 0 || ty + 1 >= map.h) continue;
        /* при перевёрнутой гравитации опора — потолок: твёрдое сверху тайла,
           а Лис встаёт к верхней грани (y = ty * T), а не к полу. */
        const g = (f.grav < 0) ? -1 : 1;
        const supportTy = g > 0 ? ty + 1 : ty - 1;
        if (supportTy < 0 || supportTy >= map.h) continue;
        const below = tileAt(map, tx, supportTy);
        const isFloor = SOLID.has(below) || below === '=';
        if (!isFloor) continue;
        const cand = g > 0
          ? { x: tx * T + (T - f.w) / 2, y: (ty + 1) * T - f.h }
          : { x: tx * T + (T - f.w) / 2, y: ty * T };
        if (rectSolid(map, { x: cand.x, y: cand.y, w: f.w, h: f.h }, hidden)) continue;
        if (rectDeadly(map, { x: cand.x, y: cand.y, w: f.w, h: f.h })) continue;
        return cand;
      }
    }
  }
  return null;
}

/* ─────────────── Тень: враг-преследователь ───────────────
   Правило по документу: тень движется только когда движется игрок. */
function updateShadow(map, s, angel, dt, hidden, playerMoving) {
  if (s.kind === 'still' && !playerMoving) {
    s.vx = 0;
  } else if (s.kind === 'patrol') {
    const dir = sign(s.vx) || 1;
    s.vx = dir * CFG.RUN_SPEED * 0.42 * (s.speedMul || 1);
    const ahead = { x: s.x + (s.vx > 0 ? s.w + 1 : -2), y: s.y, w: 1, h: s.h };
    /* пол пробуем со стороны ОПОРЫ: при grav<0 тень ходит по потолку, и проба
       «под ногами» внизу всегда пуста — тень разворачивалась каждый кадр и
       дрожала на месте. Симметрично groundCheck. */
    const floor = (s.grav || 1) > 0
      ? { x: s.x + (s.vx > 0 ? s.w : -1), y: s.y + s.h + 1, w: 1, h: 2 }
      : { x: s.x + (s.vx > 0 ? s.w : -1), y: s.y - 3, w: 1, h: 2 };
    if (rectSolid(map, ahead, hidden) || !rectSolid(map, floor, hidden)) s.vx = -s.vx;
    s.facing = sign(s.vx);
  } else {
    /* chase: догоняет по X только пока игрок шевелится */
    const dx = (angel.x + angel.w / 2) - (s.x + s.w / 2);
    const spd = CFG.RUN_SPEED * (s.speedMul || 0.55);
    s.vx = playerMoving ? sign(dx) * spd : approach(s.vx, 0, 600 * dt);
    s.facing = sign(dx) || s.facing;
  }
  /* Гравитация тени — по её собственной оси: в разломе тень тоже падает
     вверх, иначе она уходит в «пол», пока игрок летит к потолку.
     Кламп двусторонний: Math.min ограничивал только положительную скорость. */
  s.vy += CFG.GRAVITY * (s.grav || 1) * dt;
  s.vy = Math.max(-CFG.MAX_FALL, Math.min(s.vy, CFG.MAX_FALL));
  return moveActor(map, s, dt, hidden);
}

/* Попадание тени/угрозы по Ангелу */
function hitsAngel(angel, e) {
  return aabb({ x: angel.x + 2, y: angel.y + 3, w: angel.w - 4, h: angel.h - 4 },
              { x: e.x + 2, y: e.y + 2, w: Math.max(1, e.w - 4), h: Math.max(1, e.h - 4) });
}

/* ─────────────── Зеркальный двойник (ур. 4) ───────────────
   Пишем историю позиций Ангела, двойник воспроизводит её с задержкой. */
function makeEcho(delaySec) {
  return { buf: [], delay: delaySec, x: 0, y: 0, w: CFG.ANGEL_W, h: CFG.ANGEL_H, facing: 1, ready: false };
}
function pushEcho(echo, t, angel) {
  echo.buf.push({ t, x: angel.x, y: angel.y, facing: angel.facing });
  /* держим буфер компактным */
  while (echo.buf.length > 2 && echo.buf[1].t < t - echo.delay - 0.5) echo.buf.shift();
}
function sampleEcho(echo, t) {
  const want = t - echo.delay;
  if (!echo.buf.length || echo.buf[0].t > want) { echo.ready = false; return echo; }
  let i = 0;
  while (i < echo.buf.length - 1 && echo.buf[i + 1].t <= want) i++;
  const a = echo.buf[i], b = echo.buf[Math.min(i + 1, echo.buf.length - 1)];
  const span = b.t - a.t;
  const k = span > 0 ? clamp((want - a.t) / span, 0, 1) : 0;
  echo.x = lerp(a.x, b.x, k);
  echo.y = lerp(a.y, b.y, k);
  echo.facing = a.facing;
  echo.ready = true;
  return echo;
}

/* ─────────────── Эхо-платформы (ур. 3) ───────────────
   Крик делает платформы видимыми/твердыми на TTL секунд. */
function makeEchoPlatforms(list, ttl) {
  return { list: list.map(p => ({ ...p, alive: 0 })), ttl };
}
function shout(ep, cx, cy, radius) {
  let n = 0;
  for (const p of ep.list) {
    const pc = { x: p.tx * CFG.TILE + CFG.TILE / 2, y: p.ty * CFG.TILE + CFG.TILE / 2 };
    if (dist2(cx, cy, pc.x, pc.y) <= radius * radius) { p.alive = p.ttl != null ? p.ttl : ep.ttl; n++; }
  }
  return n;
}
function tickEchoPlatforms(ep, map, dt) {
  for (const p of ep.list) {
    if (p.alive > 0) p.alive = Math.max(0, p.alive - dt);
    /* пишем желаемое состояние, а не только переход: иначе первый tick
       после shout() не успевает сделать клетку твердой */
    /* ложная эхо-платформа (док. ур.3): выглядит настоящей (alive>0),
       но клетка остаётся пустой — игрок проваливается, смерти нет. */
    const want = p.alive > 0 && !p.fake ? '#' : '.';
    if (tileAt(map, p.tx, p.ty) !== want) setTile(map, p.tx, p.ty, want);
  }
}

/* ─────────────── Блоки памяти (ур. 8) ───────────────
   Видны только в радиусе; вне радиуса — исчезают из рендера, но остаются твердыми,
   если игрок уже их «запомнил». */
function memoryVisible(memSet, tx, ty, angelCX, angelCY, radius) {
  const cx = tx * CFG.TILE + CFG.TILE / 2, cy = ty * CFG.TILE + CFG.TILE / 2;
  const near = dist2(angelCX, angelCY, cx, cy) <= radius * radius;
  if (near) memSet.add(tx + ',' + ty);
  return near;
}

/* ─────────────── Исчезающие блоки (ур. 6) ───────────────
   Наступил -> через delay исчезает на respawn секунд. */

/* Занята ли клетка (tx,ty) каким-нибудь живым актёром. Нужна перед
   восстановлением блока: иначе тайл появляется ВНУТРИ игрока. */
function cellBusy(map, tx, ty, actors) {
  if (!actors || !actors.length) return false;
  const T = CFG.TILE;
  const cell = { x: tx * T, y: ty * T, w: T, h: T };
  for (const a of actors) {
    if (!a || a.dead) continue;
    if (aabb(cell, actorRect(a))) return true;
  }
  return false;
}

function tickCrumble(state, map, dt, actors) {
  for (const c of state) {
    if (c.phase === 'armed') {
      c.t -= dt;
      if (c.t <= 0) { c.phase = 'gone'; c.t = c.respawn; setTile(map, c.tx, c.ty, '.'); }
    } else if (c.phase === 'gone') {
      c.t -= dt;
      if (c.t <= 0) {
        /* клетка занята игроком/Лисом — ждём освобождения, иначе moveActor
           вытолкнет актёра рывком из свежего тайла */
        if (cellBusy(map, c.tx, c.ty, actors)) { c.t = 0.1; }
        else { c.phase = 'idle'; setTile(map, c.tx, c.ty, 'x'); }
      }
    }
  }
}
function armCrumble(state, tx, ty, delay, respawn) {
  const c = state.find(s => s.tx === tx && s.ty === ty);
  if (c && c.phase === 'idle') { c.phase = 'armed'; c.t = delay; c.respawn = respawn; }
}

/* ─────────────── Босс (ур. 10) ───────────────
   Лицо + 2 Руки. Цикл: slam -> stomp -> face-открыт (окно урона). */
/* Координаты арены рассчитываются от CFG.VIEW_W/H, а не числами:
   при смене внутреннего разрешения босс иначе уезжал за кадр. */
function makeBoss(hp) {
  const W = CFG.VIEW_W;
  const handY = -CFG.TILE * 2.5;
  const fw = CFG.TILE * 3, fh = CFG.TILE * 4;
  return {
    hp, maxHp: hp,
    /* Фазы синхронны с музыкой (см. js/audio.js): длительность фазы равна
       длительности её трека. intro 4 с, атака 16 с, стан 8 с. */
    phase: 'intro', t: BOSS_PHASE_LEN.intro, phaseLen: BOSS_PHASE_LEN.intro,
    phaseInit: false,
    slamsPerAttack: 0, slamsLeft: 0, slamSlot: 0, slamCd: 0,
    onPhase: null, phasePosFn: null,
    vulnerable: false,
    hands: [
      { x: W * 0.22, y: handY, tx: W * 0.22, ty: handY, state: 'up', t: 0 },
      { x: W * 0.78, y: handY, tx: W * 0.78, ty: handY, state: 'up', t: 0 },
    ],
    face: { x: W / 2 - fw / 2, y: CFG.TILE * 2, w: fw, h: fh, open: false },
    handY,
    hurtFlash: 0,
  };
}

/* Возвращает список опасных прямоугольников на этом кадре */
function bossHazards(b) {
  const out = [];
  const S = CFG.TILE * 3;            // рука 3x3 тайла
  for (const h of b.hands) {
    /* рука, врезавшаяся в дверь, не опасна (док. ур.10: победа — стоять между
       Стражем и дверью, пока она бьёт по двери) */
    if ((h.state === 'slam' || h.state === 'ground') && !h._safe) {
      out.push({ x: h.x - S / 2, y: h.y, w: S, h: S, kind: 'hand' });
    }
  }
  return out;
}

/* Длительности фаз по умолчанию — ровно как треки (сек): intro 4, attack 16,
   стан 8. Это запасной отсчёт (нет музыки); при живом треке фазу ведёт
   позиция аудиоэлемента — см. phasePosFn в updateBoss. */
const BOSS_PHASE_LEN = { intro: 4.0, attack: 16.0, open: 8.0 };

/* Длительность фазы: спрашиваем снаружи (музыкальную секцию), иначе номинал. */
function bossPhaseLen(b, phase, force) {
  if (typeof b.onPhase === 'function') {
    const d = b.onPhase(phase, force);
    if (typeof d === 'number' && isFinite(d) && d > 0) return d;
  }
  return BOSS_PHASE_LEN[phase] || 1.0;
}

/* Фаза атаки — 3–4 удара (ТЗ: «не 2, а 3–4»). */
function bossSlamsPerAttack() { return 3 + (Math.random() < 0.5 ? 1 : 0); }

/* Вход в фазу. 'attack' — серия ударов, 'open' — «стан»: лицо открыто,
   Ангел бьёт по лицу; окно живёт до конца трека стана. */
function bossBeginPhase(b, phase, force) {
  b.phase = phase;
  b.phaseLen = bossPhaseLen(b, phase, force);
  b.t = b.phaseLen;
  if (phase === 'attack') {
    b.slamsPerAttack = bossSlamsPerAttack();
    b.slamsLeft = b.slamsPerAttack;
    b.slamSlot = b.phaseLen / b.slamsPerAttack;   /* удары равномерно по треку */
    b.slamCd = 0;
    b.vulnerable = false;
    b.face.open = false;
  } else if (phase === 'open') {
    b.vulnerable = true;
    b.face.open = true;
  } else {
    b.vulnerable = false;
    b.face.open = false;
  }
  return b;
}

function updateBoss(b, dt, angelCX, groundY) {
  b.hurtFlash = Math.max(0, b.hurtFlash - dt);
  if (b.phase === 'dying') { b.vulnerable = false; b.face.open = false; return b; }
  /* Первый кадр: intro объявляет СВОЮ секцию музыки (иначе секции съезжают
     на одну и атака получает длину intro). */
  if (!b.phaseInit) { b.phaseInit = true; bossBeginPhase(b, b.phase || 'intro', true); }

  const hpFrac = b.hp / b.maxHp;
  const speedUp = 1 + (1 - hpFrac) * 0.6;   // чем меньше HP, тем резче удары

  /* Фазу ведёт МУЗЫКА: пока играет трек текущей секции, остаток фазы равен
     остатку трека. Тогда смена стадии совпадает с концом трека (ТЗ: «под
     конец атаки закончился трек», «уязвимость до конца трека стана»), и
     диалоги не сбивают синхрон: мир заморожен, трек играет, а после
     диалога таймер сам подтягивается к позиции трека.
     Если трека нет (autoplay-барьер, «звук: выкл») или играет другая
     секция — обычный отсчёт по dt, фаза не встаёт. */
  let musicClock = false;
  if (typeof b.phasePosFn === 'function') {
    const p = b.phasePosFn();
    if (p && p.playing && p.dur > 1) {
      b.phaseLen = p.dur;
      b.t = Math.max(0, p.dur - p.ct);
      if (b.phase === 'attack' && b.slamsPerAttack > 0) {
        b.slamSlot = p.dur / b.slamsPerAttack;
      }
      musicClock = true;
    }
  }
  if (!musicClock) b.t -= dt;

  /* Руки живут в любой фазе: aim -> slam -> ground -> retract -> up */
  for (const h of b.hands) {
    if (h.state === 'aim') {
      h.t -= dt;
      h.x = lerp(h.x, h.tx, clamp(dt * 6, 0, 1));
      if (h.t <= 0) { h.state = 'slam'; h.t = 0.32; }
    } else if (h.state === 'slam') {
      /* Рука 3 тайла высотой: садится так, чтобы низ лёг на грунт.
         Скорости тоже от TILE, иначе при смене разрешения удар «плывёт». */
      const restY = groundY - CFG.TILE * 3;
      h.y = approach(h.y, restY, CFG.TILE * 88 * dt);
      if (h.y >= restY - 2) { h.y = restY; h.state = 'ground'; h.t = 0.7 / speedUp; }
    } else if (h.state === 'ground') {
      h.t -= dt;
      if (h.t <= 0) h.state = 'retract';
    } else if (h.state === 'retract') {
      h.y = approach(h.y, b.handY, CFG.TILE * 20 * dt);
      if (h.y <= b.handY + 2) { h.state = 'up'; h.y = b.handY; }
    }
  }

  if (b.phase === 'attack') {
    b.vulnerable = false;
    b.face.open = false;
    b.slamCd -= dt;
    const busy = b.hands.some(h => h.state !== 'up');
    /* Бьём ближайшей рукой, но не чаще, чем раз в слот: за фазу их 3–4,
       удары распределены по всему треку. */
    /* если до конца фазы меньше 3 c, а удары ещё остались — бьём без паузы,
       чтобы заявленные 3-4 удара состоялись все */
    if (b.slamsLeft > 0 && b.slamCd <= 0 && (!busy || b.t < 3)) {
      const hand = b.hands.reduce((p, c) =>
        Math.abs(c.x - angelCX) < Math.abs(p.x - angelCX) ? c : p);
      hand.state = 'aim';
      hand.tx = clamp(angelCX, CFG.TILE * 2, CFG.VIEW_W - CFG.TILE * 2);
      hand.t = 0.55 / speedUp;
      hand._dust = false; hand._safe = false;
      b.slamsLeft--;
      b.slamCd = b.slamSlot;
    }
  } else if (b.phase === 'open') {
    /* «стан»: лицо открыто ВСЮ фазу — до конца трека стана, даже после удара */
    b.face.open = true;
  }

  /* Конец фазы: intro -> attack -> open -> attack -> open … */
  if (b.t <= 0) {
    if (b.phase === 'attack') {
      /* в окно уязвимости входим с поднятыми руками: несправедливых ударов нет */
      for (const h of b.hands) if (h.state !== 'up') h.state = 'retract';
      bossBeginPhase(b, 'open');
    } else {
      bossBeginPhase(b, 'attack');
    }
  }
  return b;
}

/* Удар по лицу Стража — только когда лицо открыто и Ангел коснулся его.
   Урон начисляет вызывающий код (game.js: -1 hp за удар; окно 'open' даёт
   ровно один удар, т.к. здесь снимается vulnerable).
   Возвращает true, если удар засчитан.
   ВАЖНО: удар закрывает окно И уводит босса из фазы 'open'. Иначе case 'open'
   в updateBoss() каждый кадр заново ставил vulnerable=true, и одно касание
   лицом снимало ВСЕ hp за несколько кадров (проба: босс умирал сразу после
   диалога первого удара). */
function tryHitBoss(b, angel) {
  if (!b.vulnerable || b.hp <= 0) return false;
  if (!aabb(actorRect(angel), b.face)) return false;
  b.hurtFlash = 0.35;
  b.vulnerable = false;   /* один удар за окно, но окно («стан») не закрываем: */
  return true;            /* лицо остаётся открытым до конца трека стана */
}

/* ─────────────── Прогресс уровня ─────────────── */
function reachedExit(map, angel) {
  const r = actorRect(angel);
  const x0 = Math.floor(r.x / CFG.TILE), x1 = Math.floor((r.x + r.w) / CFG.TILE);
  const y0 = Math.floor(r.y / CFG.TILE), y1 = Math.floor((r.y + r.h) / CFG.TILE);
  for (let ty = y0; ty <= y1; ty++)
    for (let tx = x0; tx <= x1; tx++)
      if (tileAt(map, tx, ty) === 'E') return true;
  return false;
}

/* Смерть: шипы/вода или падение за карту */
function checkDeath(map, angel) {
  if (rectDeadly(map, actorRect(angel))) return 'hazard';
  if (angel.y > map.h * CFG.TILE + 40) return 'fall';
  /* Уровень 10: во время переворота гравитации (st.foxGravOn) или в режиме
     арены Ангел падает вверх и может улететь за y=-200, но это не должно
     быть смертью, т.к. арена имеет потолок выше этой границы. */
  /* вне браузера глобального Game может не быть (тесты чистого ядра) */
  const G = (typeof Game !== 'undefined') ? Game : null;
  const inArena = !!(G && G.L && G.L.mech && G.L.mech.arena);
  /* Исключение только для арены L10 (mech.arena) и переворота гравитации
     Лисом (st.foxGravOn). angel.grav сюда НЕ входит намеренно: улёт за верх
     карты при обычной перевёрнутой гравитации должен оставаться смертью —
     контракт зафиксирован тестом «без исключений улёт вверх = смерть». */
  const gravFlipped = !!(G && G.state && G.state.foxGravOn > 0);
  if (!(inArena || gravFlipped) && angel.y < -200) return 'fall';
  return null;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SOLID, DEADLY, makeMap, tileAt, setTile, findTiles,
    solidAtPoint, rectSolid, rectDeadly, platformBelow,
    makeActor, actorRect, moveActor, groundCheck,
    updateAngel, updateFox, findFoxSpot, updateShadow, hitsAngel,
    makeEcho, pushEcho, sampleEcho,
    makeEchoPlatforms, shout, tickEchoPlatforms,
    memoryVisible, tickCrumble, armCrumble,
    makeBoss, updateBoss, bossHazards, tryHitBoss, bossBeginPhase, BOSS_PHASE_LEN,
    reachedExit, checkDeath,
  };
}
