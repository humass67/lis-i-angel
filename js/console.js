/* console.js — консоль разработчика (в духе Source): клавиша P, тумблер в
   настройках. Строка ввода с историей, читы под sv_cheats, переход на уровень,
   оверлеи показателей (fps, хитбоксы, координаты).
   Модуль необязательный: game.js обращается к нему через `typeof`, поэтому
   headless-стенды (tests/*) работают без него как раньше. */
'use strict';

const CON = {
  open: false,
  el: null, log: null, input: null,
  history: [], hIdx: -1,
  keys: {},              /* нажатые клавиши: noclip берёт отсюда W/S */
  line: '',              /* черновик строки ввода при открытии/закрытии */
  fps: 0, _fpsT: 0,
  _wasPaused: false,
  vars: {
    sv_cheats: 0,
    sv_fps: 0, sv_coords: 0, sv_hitboxes: 0, sv_state: 0,
    god: 0, noclip: 0, timescale: 1,
  },
};

const CON_MAX_LINES = 200;
const CON_HEADER = 'консоль разработчика · help — команды · ESC — закрыть';

/* Команды для help: [синтаксис, описание] */
const CON_CMDS = [
  ['help', 'список команд'],
  ['clear', 'очистить вывод'],
  ['sv_cheats <0|1>', 'разрешить читы (без него читы не работают)'],
  ['map <1..10|имя>', 'перейти на уровень (по номеру или части названия)'],
  ['restart', 'перезапустить текущий уровень'],
  ['respawn', 'вернуть Ангела на чекпойнт'],
  ['---', 'показатели ---'],
  ['sv_fps <0|1>', 'счётчик кадров'],
  ['sv_coords <0|1>', 'координаты Ангела, Лиса и камеры'],
  ['sv_state <0|1>', 'состояние уровня: ключи, смерти, механики, босс'],
  ['sv_hitboxes <0|1>', 'хитбоксы актёров, смертельные тайлы, выход'],
  ['---', 'читы (нужен sv_cheats 1) ---'],
  ['god <0|1>', 'неуязвимость: смерть не наступает'],
  ['noclip <0|1>', 'полёт сквозь стены: ←→ и W/S (Space) — вверх/вниз'],
  ['timescale <0.1..3>', 'скорость времени (1 = норма)'],
  ['give keys|fragments', 'выдать ключи уровня / части цвета'],
  ['kill', 'убить Ангела'],
];

/* Тумблер живёт в сейве (настройки -> «консоль»). getSave есть и в стенде. */
function conEnabled() {
  try { return typeof getSave === 'function' && !!getSave().svConsole; }
  catch (e) { return false; }
}

/* ─────────────────────────── вывод ─────────────────────────── */
function conPrint(text, cls) {
  if (!CON.log) return;
  const row = document.createElement('div');
  row.className = 'devcon-row' + (cls ? ' ' + cls : '');
  row.textContent = text;
  CON.log.appendChild(row);
  /* история вывода не растёт бесконечно */
  while (CON.log.childElementCount > CON_MAX_LINES) CON.log.removeChild(CON.log.firstChild);
  CON.log.scrollTop = CON.log.scrollHeight;
}

/* ─────────────────────────── открыть/закрыть ─────────────────────────── */
function conOpen() {
  if (CON.open || !CON.el) return;
  CON.open = true;
  CON.el.classList.add('on');
  /* игра на паузе, пока печатаем — иначе Ангел умирает под курсором */
  CON._wasPaused = (typeof Game !== 'undefined' && Game.paused) ? true : false;
  if (typeof gamePause === 'function') gamePause(true);
  conClearInput();
  if (CON.log && CON.log.childElementCount === 0) conPrint(CON_HEADER);
  if (CON.input) CON.input.focus();
}
function conClose() {
  if (!CON.open) return;
  CON.open = false;
  if (CON.el) CON.el.classList.remove('on');
  if (CON.input) CON.input.blur();
  conClearInput();
  if (typeof gamePause === 'function') gamePause(CON._wasPaused);
}
function conToggle() { if (CON.open) conClose(); else conOpen(); }

/* Обнуляем ввод игры: клавиша, зажатая до открытия консоли, не должна
   «залипнуть» (Ангел иначе идёт сам, пока мы печатаем). */
function conClearInput() {
  if (typeof INPUT === 'undefined') return;
  for (const k in INPUT) INPUT[k] = false;
}

/* ─────────────────────────── история ─────────────────────────── */
function conHist(dir) {
  const n = CON.history.length;
  if (!n || !CON.input) return;
  if (CON.hIdx === -1) CON.hIdx = n;              /* «ниже конца» — пустая строка */
  CON.hIdx = Math.max(0, Math.min(n, CON.hIdx + (dir < 0 ? -1 : 1)));
  CON.input.value = CON.hIdx >= n ? '' : CON.history[CON.hIdx];
}

/* ─────────────────────────── разбор команд ─────────────────────────── */
/* 0/1/on/off/вкл/выкл; мусор -> null (оставляем прежнее значение) */
function conBool(arg, cur) {
  if (arg == null || arg === '') return cur;
  if (arg === '1' || arg === 'on' || arg === 'true' || arg === 'вкл' || arg === 'да') return 1;
  if (arg === '0' || arg === 'off' || arg === 'false' || arg === 'выкл' || arg === 'нет') return 0;
  return null;
}

function conExec(src) {
  const line = String(src == null ? '' : src).trim();
  if (!line) return;
  conPrint('] ' + line, 'cmd');
  if (CON.history[CON.history.length - 1] !== line) CON.history.push(line);
  if (CON.history.length > 60) CON.history.shift();

  const parts = line.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const arg = parts.length > 1 ? parts[1].toLowerCase() : '';
  const argRaw = parts.slice(1).join(' ');

  /* ── служебные ── */
  if (cmd === 'help' || cmd === '?') {
    for (const row of CON_CMDS) {
      const c = row[0], d = row[1];
      if (c === '---') { conPrint('  ' + d, 'dim'); continue; }
      conPrint('  ' + c + ' '.repeat(Math.max(1, 22 - c.length)) + '— ' + d);
    }
    return;
  }
  if (cmd === 'clear' || cmd === 'cls') {
    if (CON.log) CON.log.innerHTML = '';
    conPrint(CON_HEADER);
    return;
  }

  /* ── читы разрешены? ── */
  if (cmd === 'sv_cheats') {
    const v = conBool(arg, CON.vars.sv_cheats);
    if (v === null) { conPrint('sv_cheats = ' + CON.vars.sv_cheats + '  (нужно 0 или 1)', 'warn'); return; }
    CON.vars.sv_cheats = v;
    conPrint('sv_cheats = ' + v);
    /* выключили читы — снимаем всё, что ими выдано */
    if (!v) { CON.vars.god = CON.vars.noclip = 0; CON.vars.timescale = 1; }
    return;
  }
  const CHEAT_CMDS = { god: 1, noclip: 1, timescale: 1, host_timescale: 1, give: 1, kill: 1 };
  if (Object.prototype.hasOwnProperty.call(CHEAT_CMDS, cmd) && !CON.vars.sv_cheats) {
    conPrint('чит "' + cmd + '": сначала sv_cheats 1', 'warn');
    return;
  }

  /* ── скорость времени ── */
  if (cmd === 'timescale' || cmd === 'host_timescale') {
    const v = parseFloat(argRaw);
    if (!isFinite(v)) { conPrint('timescale = ' + CON.vars.timescale + '  (0.1..3)', 'warn'); return; }
    CON.vars.timescale = Math.max(0.1, Math.min(3, v));
    conPrint('timescale = ' + CON.vars.timescale);
    return;
  }

  /* ── уровень ── */
  if (cmd === 'map' || cmd === 'level') {
    if (!argRaw) { conPrint('использование: map <1..10|имя>', 'warn'); return; }
    const total = (typeof levelCount === 'function') ? levelCount() : 10;
    const n = parseInt(argRaw, 10);
    let idx = -1;
    if (/^\d+$/.test(argRaw.trim())) idx = n - 1;
    else if (typeof LEVELS_META !== 'undefined' && LEVELS_META.findIndex) {
      const q = argRaw.toLowerCase();
      idx = LEVELS_META.findIndex(m => String(m.name).toLowerCase().indexOf(q) >= 0);
    }
    if (idx < 0 || idx >= total) { conPrint('нет такого уровня: ' + argRaw, 'warn'); return; }
    conPrint('уровень ' + (idx + 1) + ': ' + LEVELS_META[idx].name + '  (что ломается: ' + LEVELS_META[idx].breaks + ')');
    conClose();
    if (typeof startGame === 'function') startGame(idx);
    else conPrint('не могу запустить уровень: нет startGame', 'warn');
    return;
  }
  if (cmd === 'restart' || cmd === 'retry') {
    const idx = (typeof Game !== 'undefined' && Game.L) ? Game.L.idx : 0;
    conPrint('перезапуск уровня ' + (idx + 1));
    conClose();
    if (typeof startGame === 'function') startGame(idx);
    return;
  }
  if (cmd === 'respawn') {
    if (typeof Game === 'undefined' || !Game.state) { conPrint('нет активного уровня', 'warn'); return; }
    if (typeof respawn === 'function') { respawn(); conPrint('Ангел на чекпойнте'); }
    return;
  }

  /* ── читы ── */
  if (cmd === 'kill') {
    if (typeof Game === 'undefined' || !Game.state) { conPrint('нет активного уровня', 'warn'); return; }
    if (conVarOn('god')) { conPrint('god активен — смерть не наступает', 'warn'); return; }
    /* killAngel молча выходит при st.dying > 0 / st.done (game.js:420):
       повторный kill во время анимации смерти раньше печатал «Ангел убит». */
    const d0 = Game.state.deaths;
    killAngel('консоль', true);
    if (Game.state.deaths === d0) conPrint('смерть не наступила (уже умирает или уровень завершён)', 'warn');
    else conPrint('Ангел убит (смертей ' + Game.state.deaths + ')');
    return;
  }
  if (cmd === 'give') {
    if (typeof Game === 'undefined' || !Game.state) { conPrint('нет активного уровня', 'warn'); return; }
    const st = Game.state;
    if (arg !== 'keys' && arg !== 'fragments' && arg !== 'all') { conPrint('give: keys | fragments | all', 'warn'); return; }
    if (arg === 'keys' || arg === 'all') {
      /* Имена обязаны совпадать с настоящими: ключи уровня кладутся как
         st.keys.push(k.name) (game.js:1047), а портал памяти ищет
         st.keys.includes('РАДОСТЬ'|'СТРАХ'|'ОДИНОЧЕСТВО'|'ДОМ') (game.js:822).
         Заглушки 'КЛЮЧ-N' проходили только проверку длины — хабы не открывались. */
      for (const n of ['РАДОСТЬ', 'СТРАХ', 'ОДИНОЧЕСТВО', 'ДОМ']) {
        if (st.keys.indexOf(n) < 0) st.keys.push(n);
      }
      conPrint('ключей: ' + st.keys.length + ' — ' + st.keys.join(', '));
    }
    if (arg === 'fragments' || arg === 'all') {
      const s = getSave();
      for (const f of ['ТРАВА', 'НЕБО', 'ПЕРСОНАЖИ', 'ТИШИНА']) if (s.fragments.indexOf(f) < 0) s.fragments.push(f);
      if (typeof saveNow === 'function') saveNow();
      conPrint('части цвета: ' + s.fragments.length + ' (открой «ЧАСТИ ЦВЕТА» в меню)');
    }
    return;
  }

  /* ── переключатели показателей и читов-флагов ── */
  /* hasOwnProperty, а не in: у обычного объекта в цепочке прототипов живут
     constructor/toString/valueOf — команда «constructor» попадала в ветку
     переменных и затирала CON.vars.constructor вместо «неизвестной команды». */
  if (Object.prototype.hasOwnProperty.call(CON.vars, cmd)) {
    const v = conBool(arg, CON.vars[cmd]);
    if (v === null) { conPrint(cmd + ' = ' + CON.vars[cmd] + '  (нужно 0 или 1)', 'warn'); return; }
    CON.vars[cmd] = v;
    conPrint(cmd + ' = ' + v);
    return;
  }

  conPrint('неизвестная команда: ' + cmd + '  (help — список)', 'warn');
}

/* ─────────────────── noclip: движение без коллизий ─────────────────── */
/* Заменяет updateAngel, когда чит включён. Возвращает null — как res от
   updateAngel (в game.js это значение нигде не читается). */
function conNoclipStep(a, dt) {
  const sp = (CFG.RUN_SPEED || 200) * 1.6;
  const k = CON.keys || {};
  const dx = (typeof INPUT !== 'undefined') ? ((INPUT.right ? 1 : 0) - (INPUT.left ? 1 : 0)) : 0;
  const up = (k.KeyW || k.ArrowUp || k.Space) ? 1 : 0;
  const dn = (k.KeyS || k.ArrowDown) ? 1 : 0;
  const dy = up - dn;
  const len = Math.sqrt(dx * dx + dy * dy) || 1;   /* по диагонали — та же скорость */
  a.vx = dx / len * sp;
  a.vy = dy / len * sp;
  a.x += a.vx * dt;
  a.y += a.vy * dt;
  a.grav = 1;
  a.onGround = false;
  if (dx) a.facing = dx > 0 ? 1 : -1;
  /* за карту не выпускаем: иначе чекпойнт/смерть по y ломают сессию */
  const m = (typeof Game !== 'undefined' && Game.L) ? Game.L.map : null;
  if (m) {
    a.x = Math.max(0, Math.min(m.w * CFG.TILE - a.w, a.x));
    a.y = Math.max(0, Math.min(m.h * CFG.TILE - a.h, a.y));
  }
  return null;
}

/* ─────────────────── оверлеи поверх кадра ─────────────────── */
function conDrawOverlay(ctx, L, st, camX, camY) {
  if (!ctx || !L || !st) return;
  /* оверлей зовётся ровно раз в кадр — fps считаем прямо здесь */
  const now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  if (CON._fpsT) {
    const inst = 1000 / Math.max(1, now - CON._fpsT);
    CON.fps = CON.fps ? CON.fps * 0.85 + inst * 0.15 : inst;
  }
  CON._fpsT = now;

  const v = CON.vars;
  if (!v.sv_fps && !v.sv_coords && !v.sv_state && !v.sv_hitboxes) return;
  if (v.sv_hitboxes) { conDrawHitboxes(ctx, L, st, camX, camY); conDrawBossBox(ctx, st); }

  const lines = [];
  if (v.sv_state) lines.push.apply(lines, conStateLines(L, st));
  if (v.sv_coords) lines.push.apply(lines, conCoordLines(st));
  if (v.sv_fps) lines.push(conFpsLine());
  if (!lines.length) return;

  const lh = 17, pad = 6;
  ctx.save();
  ctx.font = '13px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  let w = 0;
  for (const s of lines) w = Math.max(w, ctx.measureText(s).width);
  const h = lines.length * lh + pad * 2;
  const x = 8, y = 8;   /* слева сверху: здесь ничего не рисует HUD и не закрывает консоль */
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(x, y, w + pad * 2, h);
  ctx.strokeStyle = 'rgba(232,162,74,0.45)';
  ctx.strokeRect(x + 0.5, y + 0.5, w + pad * 2 - 1, h - 1);
  ctx.fillStyle = '#e8dccb';
  for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], x + pad, y + pad + i * lh);
  ctx.restore();
}

function conFpsLine() {
  const v = CON.vars;
  return 'fps ' + CON.fps.toFixed(1) +
    (v.timescale !== 1 ? '   ×' + v.timescale : '') +
    (v.sv_cheats ? '   [читы]' : '');
}

function conCoordLines(st) {
  const T = CFG.TILE, a = st.angel, out = [];
  out.push('ангел  x ' + a.x.toFixed(1) + '  y ' + a.y.toFixed(1) +
    '   тайл ' + Math.floor(a.x / T) + ',' + Math.floor(a.y / T) +
    '   v ' + Math.round(a.vx) + ',' + Math.round(a.vy) +
    '   гравитация ' + (a.grav < 0 ? 'вверх' : 'вниз') + (a.onGround ? '  на земле' : ''));
  if (st.fox && !st.foxGone)
    out.push('лис    x ' + st.fox.x.toFixed(1) + '  y ' + st.fox.y.toFixed(1) +
      '   тайл ' + Math.floor(st.fox.x / T) + ',' + Math.floor(st.fox.y / T));
  out.push('камера ' + Math.round(st.camX) + ',' + Math.round(st.camY) +
    '   кадр ' + CFG.VIEW_W + '×' + CFG.VIEW_H);
  return out;
}

function conStateLines(L, st) {
  const m = L.meta, out = [];
  out.push('уровень ' + m.n + '. ' + m.name + '   коррупция ' + Math.round(m.corruption * 100) + '%' +
    (st.done ? '   ПРОЙДЕН' : ''));
  out.push('ключи ' + (st.keys ? st.keys.length : 0) + '/4   смерти ' + st.deaths +
    '   время ' + st.t.toFixed(1) + 'с' + (st.invuln > 0 ? '   неуязвим ' + st.invuln.toFixed(1) + 'с' : ''));
  const flags = [];
  for (const k in L.mech) {
    const val = L.mech[k];
    if (val === true) flags.push(k);
    else if (typeof val === 'number' || typeof val === 'string') flags.push(k + '=' + val);
  }
  if (flags.length) out.push('механики: ' + flags.join(' '));
  if (st.boss) out.push('босс hp ' + st.boss.hp + '/' + st.boss.maxHp + '   стадия ' + st.bossStage);
  return out;
}

function conDrawHitboxes(ctx, L, st, camX, camY) {
  const T = CFG.TILE;
  ctx.save();
  ctx.lineWidth = 1;
  ctx.translate(-camX, -camY);
  const tx0 = Math.max(0, Math.floor(camX / T)), tx1 = Math.min(L.map.w - 1, Math.floor((camX + CFG.VIEW_W) / T));
  const ty0 = Math.max(0, Math.floor(camY / T)), ty1 = Math.min(L.map.h - 1, Math.floor((camY + CFG.VIEW_H) / T));
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const c = tileAt(L.map, tx, ty);
      if (c === '.') continue;
      const x = tx * T, y = ty * T;
      if (DEADLY.has(c)) { ctx.fillStyle = 'rgba(255,48,64,0.30)'; ctx.fillRect(x, y, T, T); }
      else if (SOLID.has(c)) { ctx.strokeStyle = 'rgba(140,200,255,0.30)'; ctx.strokeRect(x + 0.5, y + 0.5, T - 1, T - 1); }
      else if (c === '=') { ctx.strokeStyle = 'rgba(120,220,120,0.65)'; ctx.beginPath(); ctx.moveTo(x, y + 0.5); ctx.lineTo(x + T, y + 0.5); ctx.stroke(); }
      else if (c === 'E') { ctx.strokeStyle = '#ffd84a'; ctx.strokeRect(x + 1.5, y + 1.5, T - 3, T - 3); }
      else if (c === 'r') { ctx.strokeStyle = 'rgba(200,150,255,0.85)'; ctx.strokeRect(x + 1.5, y + 1.5, T - 3, T - 3); }
    }
  }
  conBox(ctx, st.angel, '#5aff8a', 'ангел');
  if (st.fox && !st.foxGone) conBox(ctx, st.fox, '#ffb04a', 'лис');
  if (st.twin) conBox(ctx, st.twin, '#7ae8ff', 'двойник');
  if (st.shadows) for (const sh of st.shadows) conBox(ctx, sh, '#ff7ae8', null);
  ctx.restore();
}

/* босс рисуется в экранных координатах — бокс тоже */
function conDrawBossBox(ctx, st) {
  const b = st.boss;
  if (!b || !b.face || st.bossStage !== 0) return;
  const f = b.face;
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#ff4040';
  ctx.strokeRect(f.x + 0.5, f.y + 0.5, f.w - 1, f.h - 1);
  ctx.restore();
}

function conBox(ctx, r, color, label) {
  if (!r || typeof r.x !== 'number' || typeof r.w !== 'number') return;
  ctx.strokeStyle = color;
  ctx.strokeRect(r.x + 0.5, r.y + 0.5, r.w - 1, r.h - 1);
  ctx.fillStyle = color;
  ctx.fillRect(r.x + r.w / 2 - 1, r.y + r.h / 2 - 1, 2, 2);
  if (label) {
    ctx.font = '11px monospace';
    ctx.fillText(label, r.x + 2, r.y - 12);
  }
}

/* ─────────────────────────── инициализация ─────────────────────────── */
function conInit() {
  CON.el = document.getElementById('devConsole');
  if (!CON.el) return;                     /* разметки нет — консоль молчит */
  CON.log = document.getElementById('devconLog');
  CON.input = document.getElementById('devconInput');

  window.addEventListener('keydown', (e) => {
    CON.keys[e.code] = true;
    if (e.code === 'KeyP' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      /* в открытой консоли «p» — это буква, а не тумблер */
      if (CON.open && document.activeElement === CON.input) return;
      if (conEnabled()) { e.preventDefault(); conToggle(); }
      return;
    }
    if (e.code === 'Escape' && CON.open) { e.stopImmediatePropagation(); conClose(); }
  });
  window.addEventListener('keyup', (e) => { CON.keys[e.code] = false; });
  window.addEventListener('blur', () => { CON.keys = {}; });
  /* клик по логу снимал фокус с input: ввод молча терялся, а «p» закрывала
     консоль. Возвращаем фокус в строку ввода. */
  if (CON.log) CON.log.addEventListener('mousedown', (e) => { e.preventDefault(); if (CON.input) CON.input.focus(); });

  /* клавиши в строке ввода не отдаём игре (она слушает window) */
  CON.input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.code === 'Enter') { const s = CON.input.value; CON.input.value = ''; CON.hIdx = -1; conExec(s); }
    else if (e.code === 'ArrowUp') { e.preventDefault(); conHist(-1); }
    else if (e.code === 'ArrowDown') { e.preventDefault(); conHist(1); }
    else if (e.code === 'Escape') { e.stopImmediatePropagation(); conClose(); }
  });
}