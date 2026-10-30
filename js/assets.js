/* assets.js — загрузка изображений и описание спрайт-листов.
   Раскадровка выверена по реальным непустым кадрам (измерено скриптом). */
'use strict';

const ASSETS = {
  img: {},          // key -> HTMLImageElement
  ready: false,
  errors: [],
};

/* Список файлов: key -> путь */
const ASSET_LIST = {
  /* Ангел: клетка 64x96 */
  angel_idle: 'assets/angel/idle.png',
  angel_walk: 'assets/angel/walk.png',
  angel_jump: 'assets/angel/jump.png',
  /* Лис: клетка 32x32 */
  fox: 'assets/fox/fox.png',

  /* Портреты 180x216 */
  angel_normal: 'assets/portrait/angel_normal.png',
  angel_normal2: 'assets/portrait/angel_normal2.png',
  angel_normal3: 'assets/portrait/angel_normal3.png',
  angel_fear: 'assets/portrait/angel_fear.png',
  angel_cry: 'assets/portrait/angel_cry.png',
  angel_hello: 'assets/portrait/angel_hello.png',
  fox_normal: 'assets/portrait/fox_normal.png',
  fox_normal2: 'assets/portrait/fox_normal2.png',
  fox_normal3: 'assets/portrait/fox_normal3.png',
  fox_normal4: 'assets/portrait/fox_normal4.png',
  fox_cry: 'assets/portrait/fox_cry.png',
  fox_hello: 'assets/portrait/fox_hello.png',
  fox_smile: 'assets/portrait/fox_smile.png',
  /* монолог после 10 уровня: рот закрыт / открыт (речь) */
  fox_mono1: 'assets/portrait/fox_mono1.png?v=2',
  fox_mono2: 'assets/portrait/fox_mono2.png?v=2',
  angel_new_normal: 'assets/portrait/angel_new_normal.png',
  angel_new_normal2: 'assets/portrait/angel_new_normal2.png',
  angel_new_normal3: 'assets/portrait/angel_new_normal3.png',
  angel_new_fear: 'assets/portrait/angel_new_fear.png',
  angel_new_cry: 'assets/portrait/angel_new_cry.png',
  angel_new_hello: 'assets/portrait/angel_new_hello.png',
  angel_new_alt: 'assets/portrait/angel_new_alt.png',
  fox_new_normal: 'assets/portrait/fox_new_normal.png',
  fox_new_normal2: 'assets/portrait/fox_new_normal2.png',
  fox_new_normal3: 'assets/portrait/fox_new_normal3.png',
  fox_new_normal4: 'assets/portrait/fox_new_normal4.png',
  fox_new_cry: 'assets/portrait/fox_new_cry.png',
  fox_new_cry2: 'assets/portrait/fox_new_cry2.png',
  fox_new_hello: 'assets/portrait/fox_new_hello.png',
  fox_new_smile: 'assets/portrait/fox_new_smile.png',
  fox_new_alt: 'assets/portrait/fox_new_alt.png',

  /* Окружение (авторские) */
  grass: 'assets/env/grass.png',
  tree: 'assets/env/tree.png',
  block_bw: 'assets/env/block_bw.png',
  grid_src: 'assets/env/grid.png',

  /* Тени — 6 отдельных кадров 32x32 */
  shadow1: 'assets/shadow/shadow1.png',
  shadow2: 'assets/shadow/shadow2.png',
  shadow3: 'assets/shadow/shadow3.png',
  shadow4: 'assets/shadow/shadow4.png',
  shadow5: 'assets/shadow/shadow5.png',
  shadow6: 'assets/shadow/shadow6.png',

  /* Босс */
  boss_face: 'assets/boss/face.png',
  boss_hand1: 'assets/boss/hand1.png',
  boss_hand2: 'assets/boss/hand2.png',
  boss_hand3: 'assets/boss/hand3.png',
  bossbg1: 'assets/bossbg/bg1.png',
  bossbg2: 'assets/bossbg/bg2.png',
  bossbg3: 'assets/bossbg/bg3.png',
  bossbg4: 'assets/bossbg/bg4.png',
  bossbg5: 'assets/bossbg/bg5.png',
  bossbg6: 'assets/bossbg/bg6.png',

  /* Сгенерированные тайлы */
  ground_green: 'assets/gen/ground_green.png',
  ground_l2: 'assets/gen/ground_l2.png',
  ground_l3: 'assets/gen/ground_l3.png',
  ground_l4: 'assets/gen/ground_l4.png',
  ground_l5: 'assets/gen/ground_l5.png',
  ground_l6: 'assets/gen/ground_l6.png',
  ground_l7: 'assets/gen/ground_l7.png',
  ground_l8: 'assets/gen/ground_l8.png',
  ground_l9: 'assets/gen/ground_l9.png',
  ground_l10: 'assets/gen/ground_l10.png',
  stone: 'assets/gen/stone.png',
  stone_dark: 'assets/gen/stone_dark.png',
  stone_void: 'assets/gen/stone_void.png',
  platform: 'assets/gen/platform.png',
  platform_bw: 'assets/gen/platform_bw.png',
  spikes: 'assets/gen/spikes.png',
  spikes_red: 'assets/gen/spikes_red.png',
  sand: 'assets/gen/sand.png',
  water1: 'assets/gen/water1.png',
  water2: 'assets/gen/water2.png',
  water3: 'assets/gen/water3.png',
  water4: 'assets/gen/water4.png',
  flower_pink: 'assets/gen/flower_pink.png',
  flower_white: 'assets/gen/flower_white.png',
  flower_bw: 'assets/gen/flower_bw.png',
  /* трава: render.js рисует 'tuft'/'tuft_bw' по коррупции уровня.
     Раньше файлы лежали на диске, но не были здесь — грузились лениво,
     и при строгой проверке загрузки трава бы отвалилась. */
  tuft: 'assets/gen/tuft.png',
  tuft_bw: 'assets/gen/tuft_bw.png',
  grid: 'assets/gen/grid.png',
  door: 'assets/gen/door.png',
  door_void: 'assets/gen/door_void.png',
  crumble1: 'assets/gen/crumble1.png',
  crumble2: 'assets/gen/crumble2.png',
  crumble3: 'assets/gen/crumble3.png',
  mirror: 'assets/gen/mirror.png',
  memory_on: 'assets/gen/memory_on.png',
  memory_off: 'assets/gen/memory_off.png',
  rift1: 'assets/gen/rift1.png',
  rift2: 'assets/gen/rift2.png',
  rift3: 'assets/gen/rift3.png',
  cloud1: 'assets/gen/cloud1.png',
  cloud2: 'assets/gen/cloud2.png',
  cloud3: 'assets/gen/cloud3.png',
  cloud_bw: 'assets/gen/cloud_bw.png',
  bird1: 'assets/gen/bird1.png',
  bird2: 'assets/gen/bird2.png',
  bush: 'assets/gen/bush.png',
  bush_bw: 'assets/gen/bush_bw.png',
  spark: 'assets/gen/spark.png',
  spark_cold: 'assets/gen/spark_cold.png',
  spark_fire: 'assets/gen/spark_fire.png',
  eye1: 'assets/gen/eye1.png',
  eye2: 'assets/gen/eye2.png',
  eye3: 'assets/gen/eye3.png',
};

/* ───────── раскадровка (измерено: только непустые кадры) ───────── */
const SHEETS = {
  angel_idle: { cw: 64, ch: 96, frames: [[0,0],[1,0],[2,0]], fps: 4 },
  angel_walk: { cw: 64, ch: 96, frames: [[0,0],[1,0],[2,0],[0,1],[1,1],[2,1]], fps: 10 },
  /* jump.png: 192x192 → 3x2, реально 4 кадра: подготовка, взлёт, вершина, падение */
  angel_jump: { cw: 64, ch: 96, frames: [[0,0],[1,0],[2,0],[0,1]], fps: 8 },

  fox_idle:   { sheet: 'fox', cw: 32, ch: 32, frames: [[0,0],[1,0],[2,0],[3,0]], fps: 5 },
  fox_run:    { sheet: 'fox', cw: 32, ch: 32, frames: [[0,1],[1,1],[2,1],[3,1]], fps: 12 },
  fox_jump:   { sheet: 'fox', cw: 32, ch: 32, frames: [[0,2],[1,2],[2,2],[3,2]], fps: 8 },
  fox_sniff:  { sheet: 'fox', cw: 32, ch: 32, frames: [[0,3],[1,3],[2,3],[3,3],[4,3],[5,3],[6,3]], fps: 7 },
  fox_alert:  { sheet: 'fox', cw: 32, ch: 32, frames: [[0,4],[1,4],[2,4]], fps: 8 },
  fox_sleep:  { sheet: 'fox', cw: 32, ch: 32, frames: [[0,5],[1,5],[2,5],[3,5],[4,5]], fps: 5 },
};

/* Масштабы отрисовки при VIEW 960x540 / тайл 32.
   Ангел: клетка 64x96, рисуем 1:1 — арт не сжимается, пиксели резкие.
   Лис: исходник 32x32 рисуем ×3 (96px) — он был заметно мелким рядом с
   Ангелом; целое число масштаба обязательно, иначе появляется «мыло». */
/* ВАЖНО: масштаб считаем от РЕАЛЬНОГО содержимого клетки, а не от её размера.
   Измерено скриптом: Ангел занимает 92 из 96px, Лис — только 11 из 32,
   тень — 19 из 32. Раньше всё масштабировалось по клетке, поэтому Ангел
   выглядел втрое крупнее врагов.
   Множители целые (1x/3x/4x) — пиксели остаются резкими.
   Итоговая видимая высота: Ангел 92px, тень 57px, Лис 44px. */
const DRAW = {
  ANGEL_W: 64,  ANGEL_H: 96,    // 1:1 → контент 92px
  FOX_W: 128,   FOX_H: 128,     // 4x  → контент 44px
  SHADOW_W: 96, SHADOW_H: 96,   // 3x  → контент 57px
};

const SHADOW_FRAMES = ['shadow1', 'shadow2', 'shadow3', 'shadow4', 'shadow5', 'shadow6'];
const BOSSBG_FRAMES = ['bossbg1', 'bossbg2', 'bossbg3', 'bossbg4', 'bossbg5', 'bossbg6'];
const BOSS_HANDS = ['boss_hand1', 'boss_hand2', 'boss_hand3'];
const WATER_FRAMES = ['water1', 'water2', 'water3', 'water4'];
const RIFT_FRAMES = ['rift1', 'rift2', 'rift3'];

function loadAssets(onProgress) {
  const keys = Object.keys(ASSET_LIST);
  let done = 0;
  return Promise.all(keys.map(k => new Promise(resolve => {
    const im = new Image();
    im.onload = () => {
      ASSETS.img[k] = im;
      done++;
      if (onProgress) onProgress(done / keys.length, k);
      resolve();
    };
    im.onerror = () => {
      ASSETS.errors.push(ASSET_LIST[k]);
      done++;
      if (onProgress) onProgress(done / keys.length, k);
      resolve();   // не валим загрузку из-за одного файла
    };
    im.src = ASSET_LIST[k];
  }))).then(() => { ASSETS.ready = true; return ASSETS; });
}

/* Текущий кадр анимации по времени */
function animFrame(def, t) {
  const n = def.frames.length;
  const i = Math.floor(t * def.fps) % n;
  return def.frames[i];
}

/* Нарисовать кадр спрайт-листа с флипом.
   dx,dy — левый верхний угол в мировых координатах, dw,dh — размер отрисовки. */
function drawFrame(ctx, imgKey, def, frame, dx, dy, dw, dh, flip) {
  const im = ASSETS.img[imgKey];
  if (!im) return;
  const sx = frame[0] * def.cw, sy = frame[1] * def.ch;
  ctx.save();
  if (flip) {
    ctx.translate(dx + dw, dy);
    ctx.scale(-1, 1);
    ctx.drawImage(im, sx, sy, def.cw, def.ch, 0, 0, dw, dh);
  } else {
    ctx.drawImage(im, sx, sy, def.cw, def.ch, dx, dy, dw, dh);
  }
  ctx.restore();
}

function drawImg(ctx, key, dx, dy, dw, dh, flip, alpha) {
  const im = ASSETS.img[key];
  if (!im) return;
  ctx.save();
  if (alpha != null) ctx.globalAlpha = alpha;
  const w = dw == null ? im.width : dw;
  const h = dh == null ? im.height : dh;
  if (flip) {
    ctx.translate(dx + w, dy);
    ctx.scale(-1, 1);
    ctx.drawImage(im, 0, 0, w, h);
  } else {
    ctx.drawImage(im, dx, dy, w, h);
  }
  ctx.restore();
}
