/* levels.js — геометрия 10 уровней + скрипты диалогов.
   Карты строятся билдером (а не рисуются строками) — так не съезжает ширина
   и легко проверить проходимость тестом. DOM не используется. */
'use strict';

if (typeof window === 'undefined' && typeof require === 'function') {
  Object.assign(globalThis, require('./utils'));
  Object.assign(globalThis, require('./config'));
  /* makeMap живёт в engine — нужен и здесь */
  Object.assign(globalThis, require('./engine'));
}

/* ───────────────────────── билдер карты ───────────────────────── */
function Builder(w, h) {
  this.w = w; this.h = h;
  this.g = [];
  for (let y = 0; y < h; y++) this.g.push(new Array(w).fill('.'));
  this.decor = [];      // {kind, tx, ty}
  this.shadows = [];    // {tx, ty, kind, speedMul}
  this.echoPlats = [];  // {tx, ty}
  this.reflectTiles = [];
  this.secrets = [];   // {tx, ty}: скрытое место (радар хвоста), подбирается касанием  // {tx, ty}: клетка-платформа существует только в отражении (ур.4)
  this.crumbles = [];   // {tx, ty}
  this.rifts = [];      // {tx, ty, dir}
  this.memory = [];     // {tx, ty}
  this.zones = [];      // {tx, ty, w, h, kind}
  this.lightWells = []; // {tx, ty, w, h} — безопасные столбы света
  this.keys = [];
  this.portals = [];
  this.fragments = [];
  this.rhythm = [];
  this.triggers = [];   // {tx, kind, id}
  this.start = { tx: 2, ty: 2 };
  this.foxStart = null;
  this.exit = null;
}
Builder.prototype.set = function (tx, ty, ch) {
  if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return this;
  this.g[ty][tx] = ch;
  return this;
};
Builder.prototype.at = function (tx, ty) {
  if (tx < 0 || ty < 0 || tx >= this.w || ty >= this.h) return '.';
  return this.g[ty][tx];
};
/* горизонтальная полоса */
Builder.prototype.row = function (ty, x0, x1, ch) {
  for (let x = x0; x <= x1; x++) this.set(x, ty, ch);
  return this;
};
Builder.prototype.box = function (x0, y0, x1, y1, ch) {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, ch);
  return this;
};
/* пол от ty до низа карты */
Builder.prototype.ground = function (x0, x1, ty) {
  for (let x = x0; x <= x1; x++)
    for (let y = ty; y < this.h; y++) this.set(x, y, '#');
  return this;
};
Builder.prototype.plat = function (tx, ty, len, ch) {
  this.row(ty, tx, tx + len - 1, ch || '=');
  return this;
};
Builder.prototype.spikes = function (tx, ty, len) {
  this.row(ty, tx, tx + len - 1, '^');
  return this;
};
Builder.prototype.water = function (x0, x1, ty) {
  for (let x = x0; x <= x1; x++)
    for (let y = ty; y < this.h; y++) this.set(x, y, 'W');
  return this;
};
Builder.prototype.dec = function (kind, tx, ty, text) { this.decor.push(text ? { kind, tx, ty, text } : { kind, tx, ty }); return this; };
Builder.prototype.light = function (tx, ty, w, h) {
  this.lightWells.push({ tx, ty, w: w || 3, h: h || 12 });
  return this;
};
/* destTx — координата портала, который ведёт в зону этого ключа (уровень 8).
   Хранится в данных ключа, а не только в таблице game.js: сдвиг ключа или
   портала в уровне раньше молча ломал сбор (ключ становился неберущимся). */
Builder.prototype.key = function (tx, ty, name, destTx) {
  this.keys.push({ tx, ty, name, destTx });
  return this;
};
Builder.prototype.portal = function (tx, ty, destTx) { this.portals.push({ tx, ty, destTx }); return this; };
Builder.prototype.fragment = function (tx, ty, name) { this.fragments.push({ tx, ty, name }); return this; };
Builder.prototype.beat = function (tx, ty, group) { this.rhythm.push({ tx, ty, group }); return this; };
Builder.prototype.shadow = function (tx, ty, kind, speedMul, hidden) {
  this.shadows.push({ tx, ty, kind: kind || 'chase', speedMul: speedMul || 0.55, hidden: !!hidden });
  return this;
};
Builder.prototype.setStart = function (tx, ty) { this.start = { tx, ty }; return this; };
Builder.prototype.setFox = function (tx, ty) { this.foxStart = { tx, ty }; return this; };
/* чекпойнт: точка возрождения после смерти. Активируется, когда Ангел проходит tx >= x. */
Builder.prototype.checkpoint = function (x, tx, ty) { this.checkpoints = this.checkpoints || []; this.checkpoints.push({ x, tx, ty }); return this; };
Builder.prototype.setExit = function (tx, ty) {
  this.exit = { tx, ty };
  this.set(tx, ty, 'E'); this.set(tx, ty - 1, 'E');
  return this;
};
Builder.prototype.rows = function () { return this.g.map(r => r.join('')); };

/* Насыпать травы/цветов на верхнюю кромку пола в диапазоне */
Builder.prototype.scatter = function (x0, x1, kinds, chance, rng) {
  for (let x = x0; x <= x1; x++) {
    if (rng() > chance) continue;
    /* найти верх пола */
    for (let y = 0; y < this.h; y++) {
      if (this.at(x, y) === '#') {
        const k = kinds[Math.floor(rng() * kinds.length)];
        /* rng вызван ДО проверки — поток не сдвигается, декор прочих клеток не едет.
           Не ставим декор поверх непустой клетки (шипы '^', вода 'W', выход 'E'):
           иначе артефакт вроде цветка на шипах L2 (81,13). */
        /* не дублируем декор: иначе scatter ставит цветок поверх уже
           поставленного вручную (L1: flower_pink на (20,13) дважды). */
        const taken = this.decor.some(d => d.tx === x && d.ty === y - 1);
        if (this.at(x, y - 1) === '.' && !taken) this.dec(k, x, y - 1);
        break;
      }
    }
  }
  return this;
};

/* ───────────────────────── общие детали ───────────────────────── */
const H = 20;   /* высота карт в тайлах (320px — камера следит по Y) */

function skyDecor(b, rng, cloudKind, birdCount) {
  for (let i = 0; i < Math.floor(b.w / 22); i++) {
    b.dec(cloudKind, Math.floor(rng() * b.w), 1 + Math.floor(rng() * 4));
  }
  for (let i = 0; i < (birdCount || 0); i++) {
    b.dec('bird', Math.floor(rng() * b.w), 2 + Math.floor(rng() * 3));
  }
}

/* ═══════════════════════ УРОВЕНЬ 1 — ПРОБУЖДЕНИЕ ═══════════════════════
   Знакомство: ходьба, прыжок, цветок, две ямы, встреча с Лисом. Врагов нет. */
function level1() {
  const rng = mulberry32(101);
  const b = new Builder(150, H);
  const GY = 14;                       // уровень пола

  b.ground(0, 26, GY);                 // 1. пробуждение на траве
  b.setStart(4, GY - 2);
  b.dec('flower_pink', 11, GY - 1);    // 4. первый цветок
  b.dec('flower_pink', 20, GY - 1);    // секретный цветок за деревом (док. ур.1, п.2)
  b.dec('tree', 18, GY - 4);
  b.dec('bush', 22, GY - 2);

  b.ground(30, 52, GY);                // 5. первая яма (3 тайла)
  b.dec('flower_white', 36, GY - 1);
  b.dec('tree', 45, GY - 4);

  b.ground(57, 78, GY);                // вторая яма, чуть шире (4)
  b.dec('bush', 61, GY - 2);
  b.dec('flower_pink', 68, GY - 1);

  /* 6. небольшая возвышенность + ступени */
  b.ground(82, 104, GY);
  b.plat(86, GY - 3, 4);
  b.plat(93, GY - 5, 4);
  b.ground(99, 104, GY - 2);
  b.dec('tree', 101, GY - 6);

  /* 7. встреча с Лисом — ровная площадка */
  b.ground(108, 132, GY);
  b.setFox(118, GY - 2);
  b.dec('bush', 112, GY - 2);
  b.dec('flower_white', 125, GY - 1);
  b.dec('tree', 129, GY - 4);

  /* 8. финал — выход */
  /* деревня (док. ур.1, п.4): дом у подножия, без врагов */
  b.dec('village_house', 130, GY - 1);
  b.dec('horizon_line', 60, 0);   /* невидим, включается сценой atX 60 */
  b.ground(136, 149, GY);
  b.setExit(145, GY - 1);
  b.dec('door', 145, GY - 3);   /* дверь у выхода (док. ур.1: «Дверь... Значит, есть куда идти») */
  b.dec('gray_leaf', 140, GY - 1);
  b.dec('tree', 140, GY - 4);   /* серый лист — на дереве (документ ур.1, п.6) */

  b.scatter(0, 149, ['grass_tuft', 'flower_pink', 'flower_white'], 0.14, rng);
  skyDecor(b, rng, 'cloud1', 4);

  return {
    meta: LEVELS_META[0],
    rows: b.rows(), b,
    tileset: { ground: 'ground_green', stone: 'stone', plat: 'platform' },
    /* Лис сидит в кустах и не следует за Ангелом, пока тот не дойдёт до
       сцены встречи (скрипт на tx 115) — иначе он «телепортируется»
       навстречу с первого кадра и знакомство теряет смысл. */
    mech: { foxWakeX: 113 },
    script: [
      { at: 'start', scene: 'l1_intro', sceneCap: 'Пролог. Ветер.', lines: [
        { who: 'angel', face: 'angel_normal', text: '...Где я?' },
        { who: 'angel', face: 'angel_normal2', text: 'Тут кто-нибудь есть?' },
      ]},
      { atX: 11, lines: [{ who: 'angel', face: 'angel_normal3', text: 'Красивый.' }] },
      /* секретный цветок: Ангел тянется, Лис одёргивает */
      { atX: 19, lines: [
        { who: 'angel', face: 'angel_normal3', text: 'Ой, цветок...' },
        { who: 'angel', face: 'angel_normal', text: 'Можно сорвать?' },
      ]},
      /* подсказка (просьба): зажать SPACE = длинный прыжок — ровно у первой ямы tx 27–29 */
      { atX: 25, hint: 'зажать SPACE — длинный прыжок', lines: [{ who: 'angel', face: 'angel_normal', text: 'Надо перепрыгнуть.' }] },
      /* Сцена обрыва (документ ур.1): Лис не прыгает через яму, «Могу. ...Теоретически.» */
      { atX: 50, camTo: 56, scene: 'l1_cliff', sceneCap: 'Обрыв.', lines: [
        { who: 'angel', face: 'angel_normal2', text: 'Там провал. Слишком широкий.' },
        { who: 'angel', face: 'angel_normal', text: 'Как сюда попасть?' },
      ]},
      /* чёрная линия на горизонте (док. ур.1, п.5) */
      { atX: 60, showDecor: 'horizon_line', showFor: 3.5, lines: [
        { who: 'angel', face: 'angel_fear', text: 'Там что-то чёрное...' },
        { who: 'angel', face: 'angel_normal', text: 'Показалось.' },
      ]},
      /* высокий уступ: Лис помогает забраться (док. ур.1, п.7) */
      { atX: 92, lines: [
        { who: 'angel', face: 'angel_normal', text: 'Слишком высоко.' },
        { who: 'angel', face: 'angel_normal2', text: 'Ещё раз.' },
        { who: 'angel', face: 'angel_hello', text: 'Вот бы кто-то помог.' },
      ]},
      /* деревня: Ангел замечает дом, Лис отвечает */
      { atX: 115, lines: [
        { who: 'angel', face: 'angel_hello', text: 'Ты кто?' },
        { who: 'fox', face: 'fox_hello', text: '...' },
        { who: 'angel', face: 'angel_normal', text: 'Ты умеешь говорить?' },
        { who: 'fox', face: 'fox_normal', text: 'Иногда.' },
        { who: 'angel', face: 'angel_normal2', text: 'А сейчас?' },
        { who: 'fox', face: 'fox_smile', text: 'Сейчас умею.' },
        { who: 'angel', face: 'angel_hello', text: 'Странный ты.' },
        { who: 'fox', face: 'fox_smile', text: 'Ты первая, кто это заметил.' },
      ]},
      { atX: 126, lines: [
        { who: 'angel', face: 'angel_normal', text: 'А ты давно здесь?' },
        { who: 'fox', face: 'fox_normal2', text: 'Да.' },
        { who: 'angel', face: 'angel_normal2', text: 'А я?' },
        { who: 'fox', face: 'fox_normal4', text: 'Не очень.' },
        { who: 'angel', face: 'angel_fear', text: 'Откуда ты знаешь?' },
        { who: 'fox', face: 'fox_normal', text: 'Знаю.' },
      ]},
      { atX: 128, scene: 'l1_village', sceneCap: 'Деревня.', lines: [
        { who: 'angel', face: 'angel_normal', text: 'Здесь кто-нибудь живёт?' },
        { who: 'angel', face: 'angel_fear', text: 'А сейчас?' },
      ]},
      { atX: 139, lines: [
        { who: 'angel', face: 'angel_normal', text: 'Здесь всегда так?' },
        { who: 'fox', face: 'fox_normal3', text: 'Обычно.' },
        { who: 'fox', face: 'fox_normal4', text: '...' },
        { who: 'angel', face: 'angel_fear', text: '...шорох' },
      ]},
    ],
  };
}

/* ═══════════════════════ УРОВЕНЬ 2 — ПЕРВЫЕ ТЕНИ ═══════════════════════
   Ломается цвет. Первые тени: патруль + «движется только когда ты движешься». */
function level2() {
  const rng = mulberry32(202);
  const b = new Builder(170, H);
  const GY = 14;

  b.ground(0, 30, GY);
  b.setStart(3, GY - 2);
  b.setFox(8, GY - 2);
  b.dec('tree_gray', 14, GY - 4);
  b.dec('flower_bw', 22, GY - 1);
  b.light(25, 2, 4, 12);

  /* первая тень — патруль по ровной площадке */
  b.ground(34, 62, GY);
  b.shadow(48, GY - 1, 'patrol');
  b.light(39, 4, 4, 10);
  b.plat(40, GY - 4, 3);
  b.dec('bush_bw', 56, GY - 2);

  /* платформенный участок над шипами */
  b.ground(66, 74, GY);
  b.spikes(75, GY - 1, 8);
  b.ground(75, 88, GY);
  b.plat(74, GY - 4, 3);
  b.plat(79, GY - 5, 3);
  b.plat(84, GY - 4, 3);

  /* тень-преследователь: двигается только пока движется игрок */
  b.ground(92, 126, GY);
  b.shadow(96, GY - 1, 'still', 0.7);
  b.light(108, 3, 4, 11);
  b.plat(104, GY - 4, 4);
  b.plat(112, GY - 6, 4);
  b.dec('tree_bw', 120, GY - 4);

  /* узкий проход с двумя патрулями */
  b.ground(130, 158, GY);
  b.shadow(138, GY - 1, 'patrol');
  b.shadow(150, GY - 1, 'patrol');
  /* Столб 6 тайлов выше прыжка. Ступень примыкает к столбу (до tx=133),
     чтобы перелезать движением вперёд, без возврата. */
  b.box(134, GY - 6, 134, GY - 1, '#');
  b.plat(131, GY - 3, 3);
  b.plat(136, GY - 5, 2);
  b.plat(142, GY - 4, 4);

  b.ground(162, 169, GY);
  b.setExit(166, GY - 1);
  b.dec('final_flower', 164, GY - 1);

  b.scatter(0, 169, ['grass_tuft', 'flower_bw'], 0.10, rng);
  skyDecor(b, rng, 'cloud_bw', 2);

  return {
    meta: LEVELS_META[1],
    rows: b.rows(), b,
    tileset: { ground: 'ground_l2', stone: 'stone', plat: 'platform' },
    mech: { shadowsFreeze: true, lightWells: true, shadowLightMul: 0.28, shadowDarkMul: 1.65, night: true },
    script: [
      { at: 'start', scene: 'l2_gray_tree', sceneCap: 'Серое дерево.', lines: [
        { who: 'fox', face: 'fox_normal4', text: 'Ангел. Посмотри.' },
        { who: 'angel', face: 'angel_normal', text: 'Что?' },
        { who: 'fox', face: 'fox_normal3', text: 'На дерево.' },
      ]},
      { atX: 28, lines: [
        { who: 'angel', face: 'angel_fear', text: 'Там что-то движется.' },
        { who: 'fox', face: 'fox_normal2', text: 'Кажется, ты им не нравишься.' },
        { who: 'angel', face: 'angel_normal2', text: 'Или я им слишком нравлюсь.' },
        { who: 'fox', face: 'fox_normal3', text: 'Всё-таки первое.' },
        { who: 'fox', face: 'fox_normal', text: 'Подожди, пока она замрёт. Потом выйди и беги.' },
      ]},
      /* полная темнота (док. ур.2, п.4): 12 с чёрного экрана, реплики в темноте */
      { atX: 131, darkFor: 7, lines: [
        { who: 'angel', face: 'angel_fear', text: '...' },
        { who: 'fox', face: 'fox_normal4', text: 'Не двигайся.' },
        { who: 'angel', face: 'angel_fear', text: 'Я и не могу.' },
      ]},
    ],
  };
}

/* ═══════════════════════ УРОВЕНЬ 3 — ЭХО ═══════════════════════
   Ломается звук. Крик (E) проявляет эхо-платформы на 2.2 сек. */
function level3() {
  const rng = mulberry32(303);
  const b = new Builder(175, H);
  const GY = 14;

  b.ground(0, 28, GY);
  /* вертикальная лестница (док. ур.3, п.8): три ступени вверх с земли, шаг ~3 тайла (проходим прыжком) */
  b.plat(19, GY - 4, 3);
  b.plat(21, GY - 7, 3);
  b.plat(23, GY - 10, 3);

  b.setStart(3, GY - 2);
  b.setFox(9, GY - 2);

  /* первая пропасть: одна эхо-платформа */
  b.ground(36, 56, GY);
  b.echoPlats.push({ tx: 31, ty: GY - 3 }, { tx: 32, ty: GY - 3 }, { tx: 33, ty: GY - 3 });

  /* ── лестница из эхо-платформ ──
     Земля разорвана: tx=63..77 — пропасть, единственный путь по эху.
     Высоты GY-3..GY-6 покрываются радиусом крика (см. mech.echoRadius). */
  b.checkpoint(55, 55, GY - 2);   /* на земле перед пропастью 57–61 (не над ней) */
  b.ground(62, 62, GY);
  b.ground(78, 78, GY);
  b.echoPlats.push({ tx: 58, ty: GY - 3 }, { tx: 59, ty: GY - 3 });
  b.plat(66, GY - 4, 3);
  b.echoPlats.push({ tx: 71, ty: GY - 4 }, { tx: 72, ty: GY - 4 });
  /* ложная платформа (док. ур.3, п.1): при лае кажется твёрдой, но под ногами пусто */
  b.echoPlats.push({ tx: 70, ty: GY - 4, fake: true });  /* пусто под ней — проваливается */
  /* Просьба: полоса земли, висевшая здесь над пропастью (ряд GY-1, tx 67–74),
     УБРАНА — она читалась как лишний «летающий» блок. Падение с ложной
     платформы теперь уводит в пропасть (смерть) — см. док. ур.3, п.2. */

  /* ── полоса шипов: земля есть, но идти по ней нельзя.
     Обход — по эхо-платформам над шипами. Берега стоят так, чтобы
     до КАЖДОЙ платформы крик дотягивался с ближайшего края (<=168px). */
  b.ground(82, 95, GY);
  b.spikes(96, GY - 1, 14);          // tx=96..109, лежат на земле
  b.ground(110, 118, GY);
  /* Платформы с шагом 4 тайла: 98 -> 102 -> 106. Достижимость:
     с берега tx=95 до 98 = 3 тайла, с 98 до 102 = 4 тайла (в радиусе 168px),
     с 106 до берега tx=110 = 4 тайла. Середина не «висит» без опоры. */
  /* ложный лай (док. ур.3, п.4): чужой круг эха активирует платформы впереди */
  b.checkpoint(93, 93, GY - 2);   /* перед шипами tx≈95 */
  b.triggers.push({ tx: 94, ty: GY - 3, kind: 'falseBark', id: 'falsebark1', radius: 260 });
  /* поздняя секция: эхо держится короче (док. ур.3, п.2: 2.2→1.2 с) */
  b.echoPlats.push({ tx: 98, ty: GY - 3, ttl: 1.2 },
                   { tx: 102, ty: GY - 3, ttl: 1.2 },
                   { tx: 106, ty: GY - 3, ttl: 1.2 });

  /* ── пропасть с тенью: переход по эхо на ту сторону.
     Платформы расставлены с шагом 4 тайла, каждая в радиусе от соседней стойки. */
  b.checkpoint(117, 117, GY - 2);   /* перед пропастью tx≈119 */
  b.ground(119, 123, GY);
  b.ground(137, 142, GY);
  b.shadow(139, GY - 1, 'patrol', undefined, true);   /* невидимая: проявляется криком (док. ур.3, п.3); над землёй, не над разрывом */
  /* Цепочка 125 -> 129 -> 133, берега 123 и 137: шаг между центрами 4 тайла,
     крик с соседней платформы достаёт (проверено audit_echo_radius). */
  b.echoPlats.push({ tx: 125, ty: GY - 3 },
                   { tx: 129, ty: GY - 3 },
                   { tx: 133, ty: GY - 3 });

  b.ground(148, 174, GY);
  b.shadow(158, GY - 1, 'still', 0.8);
  b.dec('sign', 150, GY - 1, 'НЕ СЛУШАЙ.');
  /* погоня (док. ур.3, п.6): тень chase за спиной в последнем коридоре, медленнее игрока */
  /* 150, а не 146: под 146 пола нет — там яма 143..147, тень падала сквозь карту.
     Стоит на твёрдом краю 148..152, у выхода из ямы. */
  b.shadow(150, GY - 1, 'chase', 0.5);   /* за спиной, у левого края коридора (док. ур.3, п.6) */
  b.setExit(170, GY - 1);
  b.dec('door', 172, GY - 3);   /* дверь финала: реплики «Дверь.» (atX 173) */

  b.scatter(0, 174, ['grass_tuft'], 0.08, rng);
  skyDecor(b, rng, 'cloud_bw', 1);

  return {
    meta: LEVELS_META[2],
    rows: b.rows(), b,
    tileset: { ground: 'ground_l3', stone: 'stone_dark', plat: 'platform_bw' },
    /* echoRadius 168px — НЕ произвольное число. Самая высокая эхо-платформа
       уровня (GY-6 = 192px над землёй) требует радиуса >=163px, чтобы её
       достал крик с земли. Прежние 108px покрывали лишь GY-3: половина
       платформ была физически недосягаема. Проверяется tools/audit_echo_radius.js */
    mech: { shout: true, foxBark: true, echoTtl: 2.2, echoRadius: 168, shadowsFreeze: true },
    script: [
      { at: 'start', lines: [
        { who: 'angel', face: 'angel_normal', text: 'Почему так глухо?' },
        { who: 'fox', face: 'fox_normal', text: 'Звук здесь — это опора. Позови меня: [E]' },
      ]},
      { atX: 29, lines: [
        { who: 'fox', face: 'fox_smile', text: 'ГАВ!' },
      ]},
      { atX: 90, lines: [{ who: 'fox', face: 'fox_normal3', text: 'Кричи чаще. Эхо держит недолго.' }] },
      { atX: 148, lines: [
        /* sfx: продолжительное нагнетание (5 с, см. sfxShadowLong в audio.js).
           Короткий шёпот в тишине уровня читался как щелчок, а не как угроза. */
        { who: 'fox', face: 'fox_normal4', text: 'Не слушай.', sfx: 'shadowLong' },
        { who: 'angel', face: 'angel_fear', text: 'Это ты?' },
        { who: 'fox', face: 'fox_cry', text: 'Нет. Бежим.' },
      ]},
      /* финальный диалог (док. ур.3, п.7) */
      { atX: 166, lines: [
        { who: 'angel', face: 'angel_fear', text: 'Что это было?' },
        { who: 'fox', face: 'fox_normal4', text: 'Не знаю.' },
        { who: 'angel', face: 'angel_normal2', text: 'Ты точно ничего не слышал?' },
        { who: 'fox', face: 'fox_normal', text: 'Слышал.' },
        { who: 'fox', face: 'fox_normal3', text: 'Но не это.' },
      ]},
      { atX: 168, lines: [{ who: 'angel', face: 'angel_cry', text: '...Ангел...' }] },
    ],
  };
}

/* ═══════════════════════ УРОВЕНЬ 4 — ЗЕРКАЛЬНЫЙ МИР ═══════════════════════
   Ломается пространство. Двойник повторяет движения с задержкой и убивает. */
function level4() {
  const rng = mulberry32(404);
  const b = new Builder(180, H);
  const GY = 14;

  b.ground(0, 34, GY);
  b.setStart(3, GY - 2);
  b.setFox(9, GY - 2);
  /* порталы по всему дну обрыва 35–40: любое падение переносит за обрыв */
  /* ОТРАЖЁННАЯ КОМНАТА (док. ур.4, п.1): платформы существуют ТОЛЬКО в отражении.
     Это путь к верхнему фрагменту (НЕБО, tx 118): без отражения вверх не забраться.
     Лестница из 5 уступов + площадка у фрагмента. */
  b.reflectTiles.push({ tx: 41, ty: 12 }, { tx: 42, ty: 12 }, { tx: 43, ty: 12 });
  b.reflectTiles.push({ tx: 46, ty: 10 }, { tx: 47, ty: 10 }, { tx: 48, ty: 10 });
  b.reflectTiles.push({ tx: 52, ty: 8 },  { tx: 53, ty: 8 },  { tx: 54, ty: 8 });
  b.reflectTiles.push({ tx: 58, ty: 6 },  { tx: 59, ty: 6 },  { tx: 60, ty: 6 });
  b.reflectTiles.push({ tx: 116, ty: 8 }, { tx: 117, ty: 8 }, { tx: 118, ty: 8 }, { tx: 119, ty: 8 });
  /* порталы по всему дну обрыва 71–76 */
  b.portal(137, GY - 9, 145);   /* (137,5): свободный тайл, а не стена (док. ур.4, п.4) */
  b.fragment(48, GY - 2, 'ТРАВА');
  b.fragment(118, GY - 2, 'НЕБО');
  b.fragment(162, GY - 2, 'ПЕРСОНАЖИ');
  /* Зеркальный блок 5 тайлов выше прыжка (4.3). Ступень ПРИМЫКАЕТ к стене
     (до tx=19), иначе игрок, идущий вперёд, упирается и должен возвращаться. */
  b.box(20, GY - 5, 20, GY - 1, 'm');
  b.plat(17, GY - 3, 3);
  b.plat(22, GY - 4, 2);

  /* двойник появляется здесь */
  b.ground(41, 70, GY);
  /* обрыв 35–40: вода на всю глубину. Триггер перехода в зазеркалье — невидимый, привязан к самой воде */
  for (let x = 35; x <= 40; x++) for (let y = GY; y < H; y++) b.set(x, y, 'v');
  b.plat(44, GY - 4, 4);
  b.plat(52, GY - 6, 4);
  b.box(60, GY - 6, 60, GY - 1, 'm');
  b.spikes(64, GY - 1, 4);
  b.ground(64, 70, GY);

  /* обрыв 71–76: вода на всю глубину. Невидимый триггер перехода — в самой воде */
  for (let x = 71; x <= 76; x++) for (let y = GY; y < H; y++) b.set(x, y, 'v');

  /* узкая полоска суши 77–78: сюда выныривает игрок из обрыва 2
     («Мы вернулись... кажется»). Дальше — сразу второй провал. */
  b.ground(77, 78, GY);

  /* обрыв 79–84: второй провал СРАЗУ после выхода из зазеркалья.
     Игрок ступает на сушу 77–78 и тут же проваливается — переход на 85. */
  for (let x = 79; x <= 84; x++) for (let y = GY; y < H; y++) b.set(x, y, 'v');

  /* коридор: нельзя стоять — догонит */
  b.ground(85, 112, GY);
  b.box(88, GY - 7, 88, GY - 3, '#');
  b.plat(84, GY - 4, 5);
  b.box(92, GY - 7, 92, GY - 3, '#');
  b.plat(96, GY - 5, 5);
  b.box(104, GY - 7, 104, GY - 3, '#');
  b.shadow(108, GY - 1, 'patrol');
  b.shadows[b.shadows.length - 1].reflectOnly = true;

  /* зеркальная шахта вверх */
  b.ground(116, 140, GY);
  b.plat(118, GY - 4, 3);
  b.plat(124, GY - 6, 3);
  b.plat(130, GY - 8, 3);
  b.box(136, GY - 9, 136, GY - 1, 'm');
  b.ground(136, 140, GY - 7);

  b.ground(144, 179, GY);
  b.spikes(150, GY - 1, 5);
  b.ground(150, 179, GY);
  b.plat(149, GY - 4, 7);
  b.shadow(164, GY - 1, 'still', 0.9);
  b.shadows[b.shadows.length - 1].reflectOnly = true;
  b.setExit(175, GY - 1);

  skyDecor(b, rng, 'cloud_bw', 0);

  return {
    meta: LEVELS_META[3],
    rows: b.rows(), b,
    tileset: { ground: 'ground_l4', stone: 'stone_dark', plat: 'platform_bw' },
    mech: { echoTwin: true, twinDelay: 1.15, twinFromX: 38 * CFG.TILE,
      mirrorPortals: true, shadowsFreeze: true,
      /* Двойник активен во ВСЁМ отражении — 42–137 (до портала-выхода на 137)
         и 92–136 в норме. Раньше граница была 78: двойник исчезал во всём
         втором зазеркалье (85–137), хотя коридор прямо спроектирован под
         погоню («нельзя стоять — догонит», реплика на 136 «Если я обернусь —
         увижу своё лицо?»). Отсечение 78 было костылем против смерти на
         площадке приземления 85; правильное лечение — отгул twinCd при
         ВТОРОМ входе (game.js, блок обрывов 'v'), а не выключение механики. */
      twinReflectTo: 137 * CFG.TILE,
      twinNormalFrom: 92 * CFG.TILE, twinNormalTo: 136 * CFG.TILE },
    script: [
      { at: 'start', scene: 'l4_pond_normal', sceneCap: 'Пруд. Отражение.', lines: [
        { who: 'fox', face: 'fox_normal4', text: 'Посмотри на воду.' },
        { who: 'angel', face: 'angel_normal', text: 'Твоё отражение повернуло голову.',
          swap: 'l4_pond_turned', swapCap: 'Отражение смотрит.' },
        { who: 'fox', face: 'fox_normal', text: 'Ничего.' },
      ]},
      { atX: 38, lines: [
        { who: 'angel', face: 'angel_fear', text: 'Она идёт за мной. Точно как я.' },
        { who: 'fox', face: 'fox_normal2', text: 'Это ты. На секунду назад. Не давай себя догнать.' },
      ]},
      { atX: 78, lines: [{ who: 'fox', face: 'fox_normal3', text: 'Не останавливайся. Стоять — значит встретиться.' }] },
      /* «мир в мире» (док. ур.4, п.5): Лис исчезает на 20 с, потом возвращается */
      { atX: 100, hideFoxFor: 20, scene: 'l4_mirror_world', sceneCap: 'Мир в мире.', lines: [
        { who: 'angel', face: 'angel_normal', text: 'Ты долго.' },
        { who: 'fox', face: 'fox_normal', text: 'Я тебя не видел.' },
        { who: 'angel', face: 'angel_hello', text: 'Я тебя видела.' },
      ]},
      { atX: 122, lines: [
        { who: 'fox', face: 'fox_normal4', text: 'Это не наше.' },
      ]},
      { atX: 136, lines: [{ who: 'angel', face: 'angel_fear', text: 'Если я обернусь — увижу своё лицо?' }] },
      { atX: 170, lines: [
        { who: 'angel', face: 'angel_hello', text: 'Получилось! Цвет вернулся.' },
        { who: 'fox', face: 'fox_cry', text: 'Нет, потому что мы опоздали.' },
      ]},
      /* финальный кадр (док. ур.4, п.4): отражение Лиса улыбается, чёрный экран */
      { atX: 173, darkFor: 4, lines: [
        { who: 'fox', face: 'fox_smile', text: '...' },
      ]},
    ],
  };
}

/* ═══════════════════════ УРОВЕНЬ 5 — ДЫХАНИЕ ПУСТОТЫ ═══════════════════════
   Ломается время. Зоны замедления/ускорения. */
function level5() {
  const rng = mulberry32(505);
  const b = new Builder(185, H);
  const GY = 14;

  b.ground(0, 32, GY);
  b.setStart(3, GY - 2);
  b.setFox(9, GY - 2);
  /* п.1 (док. ур.5): ритм-МОСТ через яму 33–40. Плитки на уровне пола (строка GY),
     одна группа → появляются и исчезают вместе. Окно 2 доли = 1.44 с; переход 8 тайлов
     = 1.0 с при 260 px/с. п.6 не даёт мосту исчезнуть под ногами: зайдя, не упадёшь. */
  for (let x = 33; x <= 40; x++) b.beat(x, GY, 1);
  b.beat(53, GY - 6, 2); b.beat(62, GY - 4, 3); b.beat(73, GY - 5, 3);
  b.beat(86, GY - 4, 4); b.beat(99, GY - 6, 4); b.beat(116, GY - 4, 5);
  b.beat(129, GY - 6, 5); b.beat(144, GY - 4, 6); b.beat(160, GY - 3, 6);
  /* ложь ритма (док. ур.5, п.3): группа 5 — звук есть, платформ нет. Земля под ней сплошная, путь не блокируется */
  b.rhythm.filter(p => p.group === 5).forEach(p => { p.liar = true; });
  /* «Сердце» (док. ур.5): точки группы 4 — только на сильном ударе (каждый 4-й). Земля под ними сплошная */
  b.rhythm.filter(p => p.group === 4).forEach(p => { p.strong = true; });
  /* «Лёгкие» (док. ур.5, п.7): визуальный световой колодец, вспыхивает в такт (только рендер, без механики) */
  b.light(120, 2, 8, 12);
  b.lightWells[b.lightWells.length - 1].pulseBeat = true;
  b.zones.push({ tx: 18, ty: GY - 8, w: 10, h: 8, kind: 'slow' });

  /* прыжки в замедлении.
     Зона НЕ должна начинаться на краю отталкивания: прежние tx=32..39
     накрывали всю яму tx=33..37, скорость в прыжке падала до 0.45×260,
     дальность прыжка — 2.68 тайла против ямы в 5. Уровень был непреодолим.
     Теперь замедление действует ПОСЛЕ приземления (tx=38+), а разбег и
     прыжок проходят на полной скорости. */
  /* п.1 (док. ур.5): секция tx 33–40 — путь ТОЛЬКО по ритм-платформам.
     Яма 8 тайлов не перепрыгивается (плоский прыжок ~7). Точки 34/37/40 — одна
     группа: появляются/исчезают вместе (окно 2 доли = 1.44 с). Перебежка 32→41 ≈ 9
     тайлов = 1.11 с при 260 px/с — влезает с запасом. Телеграф даёт контур заранее. */
  b.ground(41, 66, GY);
  b.zones.push({ tx: 42, ty: GY - 9, w: 8, h: 9, kind: 'slow' });
  b.plat(48, GY - 6, 3);
  b.plat(54, GY - 4, 3);
  b.spikes(60, GY - 1, 4);
  b.ground(60, 66, GY);

  /* п.1 (док. ур.5): ВТОРАЯ ритм-секция (ускорение). Геометрия правлена по
     просьбе: в оранжевой зоне пустоты быть не должно — земля сплошная,
     как в зоне 122–130 (пол + ритм-точки поверх него). Точки 73/86/99
     остаются над полом как «дыхание» уровня; единственный обязательный
     ритм-мост — секция 33–40. */
  b.ground(70, 104, GY);
  b.zones.push({ tx: 70, ty: GY - 9, w: 16, h: 9, kind: 'fast' });
  /* песчаная почва в оранжевой зоне: верхний ряд — песок ('s', SOLID),
     рельеф дюн (клины над полом) и пара коротких полос шипов для ритма.
     Земля остаётся сплошной — правка геометрии сохранена. */
  b.row(GY, 70, 104, 's');
  /* дюны: песчаные клины поверх ряда GY-1 (декоративно-проходимые) */
  b.row(GY - 1, 76, 78, 's'); b.row(GY - 1, 90, 92, 's'); b.row(GY - 1, 100, 101, 's');
  /* шипы на песке: короткие полосы, перепрыгиваются с разбега */
  b.spikes(83, GY - 1, 2);
  b.spikes(95, GY - 1, 3);

  /* дыхание: чередование зон */
  b.ground(108, 146, GY);
  b.zones.push({ tx: 108, ty: GY - 9, w: 9, h: 9, kind: 'slow' });
  b.zones.push({ tx: 122, ty: GY - 9, w: 9, h: 9, kind: 'fast' });
  b.zones.push({ tx: 136, ty: GY - 9, w: 9, h: 9, kind: 'slow' });
  /* Ступень GY-2 перед каждой высокой платформой: с пола перепад был
     5 тайлов (> прыжка 4) и на них было не забраться. */
  b.plat(109, GY - 2, 2);
  b.plat(112, GY - 5, 4);
  b.plat(120, GY - 7, 4);
  b.plat(125, GY - 2, 2);
  b.plat(128, GY - 5, 4);
  b.plat(136, GY - 7, 4);
  b.shadow(142, GY - 1, 'patrol');

  b.ground(150, 184, GY);
  b.shadow(158, GY - 1, 'chase', 0.6);
  b.zones.push({ tx: 150, ty: GY - 9, w: 12, h: 9, kind: 'slow' });
  b.plat(166, GY - 4, 5);
  b.setExit(180, GY - 1);

  skyDecor(b, rng, 'cloud_bw', 0);

  return {
    meta: LEVELS_META[4],
    rows: b.rows(), b,
    tileset: { ground: 'ground_l5', stone: 'stone_dark', plat: 'platform_bw' },
    mech: { timeZones: true, rhythm: true, beatPeriod: 0.72, slowMul: 0.45, fastMul: 1.7, shadowsFreeze: true,
      /* ур.5 «ДЫХАНИЕ ПУСТОТЫ»: гул коррупции 0.45 заглушал такт — ритм
         громче гула (beatGainMul) при приглушённом дроне (droneMul) */
      beatGainMul: 1.6, droneMul: 0.55 },
    script: [
      { at: 'start', lines: [
        { who: 'angel', face: 'angel_normal', text: 'Ты слышишь?' },
        { who: 'fox', face: 'fox_normal', text: 'Что?' },
        { who: 'angel', face: 'angel_fear', text: 'Будто кто-то дышит.' },
        { who: 'fox', face: 'fox_normal3', text: 'Не отставай.' },
      ]},
      { atX: 34, lines: [{ who: 'angel', face: 'angel_fear', text: 'Я двигаюсь как во сне.' }] },
      { atX: 72, lines: [{ who: 'fox', face: 'fox_normal3', text: 'Бум. От этого.' }] },
      /* кульминация БАХ (док. ур.5, п.2): музыка встаёт, все точки горят 2 с */
      { atX: 100, rhythmAllFor: 3, rhythmShift: 0.2, rhythmShiftFor: 3, boom: true, lines: [] },
      { atX: 124, lines: [{ who: 'angel', face: 'angel_fear', text: 'Сколько я уже здесь? Минуту? День?' }] },
      /* «Разрыв» (док. ур.5): огромная волна */
      { atX: 150, wave: 8, lines: [
        { who: 'angel', face: 'angel_fear', text: 'Что это?' },
      ]},
      { atX: 178, lines: [
        { who: 'angel', face: 'angel_cry', text: 'Тук... тук... тук...' },
        { who: 'fox', face: 'fox_cry', text: 'Это ещё слышно.' },
        { who: 'angel', face: 'angel_fear', text: 'Это не сердце.' },
      ]},
    ],
  };
}

/* ═══════════════════════ УРОВЕНЬ 6 — РАЗЛОМ ═══════════════════════
   Ломается физика. Разломы переворачивают гравитацию. */
function level6() {
  const rng = mulberry32(606);
  const b = new Builder(190, H);
  const GY = 14;
  const CY = 3;    /* потолок — второй «пол» при инверсии */

  b.ground(0, 30, GY);
  b.setStart(3, GY - 2);
  b.setFox(9, GY - 2);
  b.dec('door', 182, GY - 3);
  b.zones.push({ tx: 24, ty: GY - 3, w: 4, h: 3, kind: 'anchor' });
  /* п.3: зона накрывает и пол (центр Ангела ~12.5), и потолок — иначе не срабатывает */
  b.zones.push({ tx: 56, ty: CY + 1, w: 4, h: GY - CY - 1, kind: 'flip' });
  /* сломанная зона (док. ур.6, п.3): визуальный переворот отстаёт на 1 с */
  b.zones[b.zones.length - 1].broken = true;
  b.zones.push({ tx: 88, ty: CY + 1, w: 4, h: 4, kind: 'anchor' });
  b.zones.push({ tx: 146, ty: GY - 3, w: 4, h: 3, kind: 'flip' });

  /* первый разлом: пол -> потолок
     ВАЖНО: разлом ставим на GY-2. Ангел высотой 2 тайла стоит на полу
     ногами в ty=GY-1, корпус занимает GY-2..GY-1. При ty=GY-4 зона
     разлома (±1 тайл) до игрока не доставала и переворот не срабатывал. */
  b.row(CY, 20, 60, '#'); b.box(20, 0, 60, CY, '#');
  b.rifts.push({ tx: 28, ty: GY - 2, dir: -1 });
  b.ground(34, 46, GY);
  /* Полоса шипов 6 тайлов шире максимального прыжка (5) — без платформ
     участок непроходим. Ставим две опоры над шипами. */
  b.spikes(47, GY - 1, 6);
  b.ground(47, 60, GY);
  b.plat(47, GY - 4, 3);
  b.plat(51, GY - 5, 3);

  /* идём по потолку. Разлом обратно — на CY+2: при инверсии Ангел стоит
     ногами в CY+1, корпус CY+1..CY+2. */
  /* P0 (док. ур.6): шахты в потолке 61–63 и 97–99 закрыты — потолок непрерывен 20..99 */
  b.box(61, 0, 99, CY, '#');
  b.rifts.push({ tx: 92, ty: CY + 2, dir: 1 });
  b.row(CY + 4, 70, 74, '=');
  b.row(CY + 4, 82, 86, '=');
  /* P0: под якорем 88 и разломом 92 — твёрдая посадка (переворот безопасен);
     вода как опасность остаётся левее (64–87) */
  b.water(64, 87, GY + 2);
  b.ground(88, 99, GY);

  /* двойная инверсия + исчезающие блоки */
  b.ground(100, 134, GY);
  b.box(100, 0, 134, CY, '#');
  b.crumbles.push({ tx: 106, ty: GY - 4 }, { tx: 107, ty: GY - 4 });
  b.crumbles.push({ tx: 114, ty: CY + 4 }, { tx: 115, ty: CY + 4 });
  /* та же поправка высоты, что и для первых двух разломов */
  b.rifts.push({ tx: 110, ty: GY - 2, dir: -1 });
  b.rifts.push({ tx: 122, ty: CY + 2, dir: 1 });
  b.crumbles.push({ tx: 128, ty: GY - 4 }, { tx: 129, ty: GY - 4 });
  b.spikes(118, GY - 1, 5);
  b.shadow(132, GY - 1, 'patrol');
  /* Осколок (док. ур.6, п.5): ходячая тень, касание меняет гравитацию игрока */
  b.shadow(126, GY - 1, 'patrol'); b.shadows[b.shadows.length - 1].shard = true;

  /* большой разлом */
  b.ground(138, 189, GY);
  b.box(138, 0, 189, CY, '#');
  b.rifts.push({ tx: 146, ty: GY - 2, dir: -1 });
  b.row(CY + 4, 152, 158, '=');
  b.rifts.push({ tx: 164, ty: CY + 2, dir: 1 });
  b.plat(170, GY - 4, 5);
  b.shadow(178, GY - 1, 'chase', 0.62);
  b.setExit(185, GY - 1);

  return {
    meta: LEVELS_META[5],
    rows: b.rows(), b,
    tileset: { ground: 'ground_l6', stone: 'stone_dark', plat: 'platform_bw' },
    mech: { rifts: true, gravityZones: true, crumbleDelay: 0.42, crumbleRespawn: 2.4, shadowsFreeze: true,
      /* кульминация: на участке двойной инверсии гравитация «мечется» (док. ур.6, п.7).
         Бюджет переворотов конечен — затем гравитация возвращается вниз; ушёл с участка — заново. */
      gravChaos: true, gravChaosFrom: 108 * CFG.TILE, gravChaosTo: 136 * CFG.TILE, gravChaosFlips: 4 },
    script: [
      { at: 'start', lines: [
        { who: 'angel', face: 'angel_normal', text: 'Земля... гудит.' },
        { who: 'fox', face: 'fox_normal4', text: 'Не подходи.' },
        { who: 'angel', face: 'angel_normal2', text: 'Почему?' },
        { who: 'fox', face: 'fox_normal4', text: 'Я не знаю, что там.' },
        { who: 'angel', face: 'angel_hello', text: 'Тогда узнаем.' },
      ]},
      /* чёрная линия-граница (док. ур.6, п.1): предупреждение до первого входа в зону */
      { atX: 22, scene: 'l6_black_line', sceneCap: 'Первая граница.', lines: [
        { who: 'fox', face: 'fox_normal4', text: 'Не подходи.' },
      ]},
      { atX: 29, lines: [
        { who: 'fox', face: 'fox_normal2', text: 'Кажется... потолок теперь снизу.' },
        { who: 'angel', face: 'angel_normal2', text: 'Очень полезное наблюдение.' },
      ]},
      /* «Лис отстаёт» (док. ур.6, п.6): Лис не проходит разлом, стоит на месте */
      { atX: 88, foxStuck: true, lines: [
        { who: 'fox', face: 'fox_normal4', text: 'Я не могу здесь пройти.' },
      ]},
      { atX: 100, lines: [{ who: 'fox', face: 'fox_normal3', text: 'Пол здесь тоже не вечный. Не стой.' }] },
      /* игрок собрал путь — Лис догоняет */
      { atX: 106, foxStuck: false, lines: [
        { who: 'fox', face: 'fox_smile', text: 'Теперь могу.' },
      ]},
      /* предупреждение (по ТЗ): зона хаоса 108–136 гравитация мечется многократно */
      { atX: 114, lines: [
        { who: 'fox', face: 'fox_normal4', text: 'Будь осторожна! Ты можешь переворачиваться по нескольку раз!' },
      ]},
      { atX: 144, lines: [{ who: 'angel', face: 'angel_fear', text: 'Где верх? Я больше не понимаю.' }] },
      /* кульминация (док. ур.6, п.7): тряска, реплики убраны */
      { atX: 160, wave: 6, lines: [] },
      /* финал (док. ур.6, п.8): цвет уходит — кадр гаснет на 2 с (упрощённо: целиком, не слоями) */
      { atX: 181, darkFor: 2, lines: [
        { who: 'angel', face: 'angel_fear', text: 'Что это? Лис, ты знаешь эту дверь?' },
        { who: 'fox', face: 'fox_normal4', text: 'Нет.' },
        { who: 'angel', face: 'angel_fear', text: 'Ты врёшь.' },
        { who: 'fox', face: 'fox_cry', text: 'Я знаю.' },
        { who: 'angel', face: 'angel_fear', text: 'Тук. Тук. Тук.' },
      ]},
    ],
  };
}

/* ═══════════════════════ УРОВЕНЬ 7 — ТИШИНА ═══════════════════════
   Исчезает информация: HUD пропадает, подсказок нет, часть геометрии не видна. */
function level7() {
  const rng = mulberry32(707);
  const b = new Builder(180, H);
  const GY = 14;

  b.ground(0, 30, GY);
  /* секрет (док. ур.7, п.1): скрытая ниша — видна только радару хвоста.
     Ниша над ямой 59–63: невидимые блоки памяти ведут к секрету (иначе встать некуда). */
  b.secrets.push({ tx: 60, ty: GY - 3 });
  b.fragment(60, GY - 3, 'ТИШИНА');   /* награда ниши (док. ур.7, п.1) */
  b.memory.push({ tx: 59, ty: GY }, { tx: 60, ty: GY }, { tx: 61, ty: GY }, { tx: 62, ty: GY }, { tx: 63, ty: GY });   /* пол ниши до края ямы */
  /* «слепой слух» (док. ур.7, п.2): тень за стеной; подсказка — только реакция Лиса (👂), без текста */
  b.box(72, GY - 3, 72, GY - 1, '#');
  b.shadow(75, GY - 1, 'patrol', 0.6);
  b.shadows[b.shadows.length - 1].blind = true;
  /* «хвост врёт» (док. ур.7, п.5): ложная точка в конце — радар дрожит у пустоты */
  b.secrets.push({ tx: 150, ty: GY - 3, fake: true });
  /* п.2 (док. ур.7): секретная комната в стене — невидимый проход сквозь стену.
     Второй секрет в конце уровня, за твёрдой стеной (ищи по хвосту-радару). */
  /* п.2: свисающая стена (только верхние 2 тайла) — внизу у пола проход,
     визуально читается как стена; внутри ниши секрет и фрагмент */
  b.box(132, GY - 5, 132, GY - 3, '#');
  b.secrets.push({ tx: 134, ty: GY - 1 });
  b.fragment(134, GY - 2, 'ТИШИНА II');   /* было ТИШИНА_2 — техническое имя светилось в окне «Части цвета» */
  b.setStart(3, GY - 2);
  b.setFox(10, GY - 2);

  /* невидимые платформы — проявляются только частицами под ногами */
  b.ground(38, 58, GY);
  b.memory.push({ tx: 32, ty: GY - 3 }, { tx: 33, ty: GY - 3 }, { tx: 34, ty: GY - 3 });
  b.plat(44, GY - 4, 3);
  b.memory.push({ tx: 50, ty: GY - 6 }, { tx: 51, ty: GY - 6 });

  b.ground(64, 88, GY);
  b.spikes(89, GY - 1, 8);
  b.ground(89, 104, GY);
  b.memory.push({ tx: 90, ty: GY - 4 }, { tx: 91, ty: GY - 4 },
                 { tx: 95, ty: GY - 5 }, { tx: 96, ty: GY - 5 },
                 { tx: 100, ty: GY - 4 }, { tx: 101, ty: GY - 4 });

  /* тишина: тени без звука */
  b.ground(108, 142, GY);
  b.shadow(116, GY - 1, 'still', 0.85);
  b.shadow(130, GY - 1, 'patrol');
  /* «Дрожит мир» (док. ур.7, п.4): тень дрожит, сама геометрия спокойна */
  b.shadows[b.shadows.length - 1].jitter = true;
  /* огромная тень (док. ур.7, п.6): видна только её тень, фигуры нет (масштаб ×2.5, коллизия прежняя) */
  b.shadow(166, GY - 1, 'patrol', 0.4); b.shadows[b.shadows.length - 1].scale = 2.5;
  b.memory.push({ tx: 122, ty: GY - 4 }, { tx: 123, ty: GY - 4 });   /* было GY-5: 5 тайлов вверх недостижимы (прыжок ~4.2) */
  b.plat(134, GY - 4, 4);
  b.dec('eye', 126, GY - 8);

  b.ground(146, 179, GY);
  b.shadow(156, GY - 1, 'chase', 0.66);
  b.memory.push({ tx: 164, ty: GY - 4 }, { tx: 165, ty: GY - 4 }, { tx: 166, ty: GY - 4 });
  b.dec('eye', 170, GY - 7);
  b.setExit(175, GY - 1);

  return {
    meta: LEVELS_META[6],
    rows: b.rows(), b,
    tileset: { ground: 'ground_l7', stone: 'stone_dark', plat: 'platform_bw' },
    mech: { hideHud: true, tailRadar: true, visualPulse: true, shadowsFreeze: true, muffled: true },
    script: [
      { at: 'start', lines: [
        { who: 'angel', face: 'angel_fear', text: 'Лис?' },
        { who: 'fox', face: 'fox_normal4', text: '🤫' },
      ]},
      { atX: 30, lines: [
        { who: 'angel', face: 'angel_fear', text: 'Хвост дрожит. Там что-то есть?' },
        { who: 'fox', face: 'fox_normal3', text: '👉' },
      ]},
      { atX: 108, lines: [{ who: 'angel', face: 'angel_fear', text: 'Они идут молча.' }] },
      /* «Лис берёт за руку» (док. ур.7, п.7): жесты, без слов */
      { atX: 120, scene: 'l7_chair_shadow', sceneCap: 'Пустая комната.', lines: [
        { who: 'fox', face: 'fox_smile', text: '🤝' },
        { who: 'angel', face: 'angel_normal', text: '👍' },
      ]},
      /* «Лис показывает назад» (док. ур.7, п.6): жест перед финалом */
      { atX: 165, lines: [
        { who: 'fox', face: 'fox_normal4', text: '👈' },
      ]},
      { atX: 173, lines: [
        { who: 'angel', face: 'angel_fear', text: 'Стук. Стук. Стук. Что это?' },
        { who: 'fox', face: 'fox_normal4', text: 'Дверь.' },
        { who: 'angel', face: 'angel_fear', text: 'Та самая?' },
        { who: 'fox', face: 'fox_cry', text: 'Да.' },
      ]},
    ],
  };
}

/* ═══════════════════════ УРОВЕНЬ 8 — ЛАБИРИНТ ПАМЯТИ ═══════════════════════
   Ломается память: блоки видны только рядом, путь надо запоминать. */
function level8() {
  const rng = mulberry32(808);
  const b = new Builder(175, H);
  const GY = 14;

  b.ground(0, 26, GY);
  b.setStart(3, GY - 2);
  /* дверь в центре стартовой комнаты (док. ур.8, п.5): появляется после четырёх ключей */
  b.dec('door', 12, GY - 1); b.decor[b.decor.length - 1].onlyWhenKeys = true;
  b.setFox(10, GY - 2);
  b.setExit(24, GY - 1);
  b.portal(5, GY - 2, 24);
  b.portal(10, GY - 2, 38);
  b.portal(15, GY - 2, 87);
  b.portal(20, GY - 2, 108);
  b.key(34, GY - 2, 'РАДОСТЬ', 24);
  b.key(82, GY - 2, 'СТРАХ', 38);
  b.key(108, GY - 2, 'ОДИНОЧЕСТВО', 87);
  b.key(160, GY - 2, 'ДОМ', 108);

  /* лабиринт из блоков памяти */
  b.ground(30, 70, GY);
  for (let i = 0; i < 9; i++) {
    const tx = 32 + i * 4;
    const ty = GY - 3 - (i % 3) * 2;
    b.memory.push({ tx, ty }, { tx: tx + 1, ty });
  }
  b.spikes(40, GY - 1, 4);
  b.spikes(52, GY - 1, 4);
  b.spikes(62, GY - 1, 4);
  /* обваливающиеся мостики над шипами (тайл 'x'): помнишь дорогу — пробеги,
     пока держится (0.42 c); рассыпался — ждёшь возврата (2.4 c) или идёшь
     по платформам памяти. Тематика главы: «помнишь — держись». */
  b.crumbles.push({ tx: 41, ty: GY - 4 }, { tx: 42, ty: GY - 4 });
  b.crumbles.push({ tx: 53, ty: GY - 4 }, { tx: 54, ty: GY - 4 });
  b.crumbles.push({ tx: 63, ty: GY - 4 }, { tx: 64, ty: GY - 4 });

  /* вертикальная шахта памяти */
  b.ground(74, 100, GY);
  /* Левая стена шахты раньше шла до самого пола (10 тайлов) и полностью
     закрывала вход — попасть внутрь было нельзя. Оставляем проём снизу
     (GY-3..GY-1), игрок входит по земле и лезет вверх по блокам памяти. */
  b.box(74, GY - 10, 74, GY - 4, '#');
  b.box(100, GY - 10, 100, GY - 1, '#');
  /* Лестница памяти вверх по шахте. Раньше блоки чередовались между
     tx=78 и tx=90 — 12 тайлов по горизонтали при прыжке 5, подняться было
     невозможно. Теперь зигзаг с шагом 4 тайла и подъёмом 2. */
  /* Лестница идёт ВВЕРХ И ВПРАВО: шаг +4 тайла по X и -2 по Y укладывается
     в замеренный прыжок (при подъёме на 2 тайла разрыв до 6). Раньше блоки
     топтались на месте (tx 78/82) и до выхода на tx=94 было не добраться. */
  for (let i = 0; i < 5; i++) {
    const tx = 78 + i * 4;
    const ty = GY - 3 - i * 2;
    b.memory.push({ tx, ty }, { tx: tx + 1, ty }, { tx: tx + 2, ty });
  }
  /* верхняя площадка: перелезаем правую стену шахты (её верх на GY-10) */
  b.memory.push({ tx: 97, ty: GY - 11 }, { tx: 98, ty: GY - 11 },
                 { tx: 99, ty: GY - 11 });
  b.shadow(90, GY - 1, 'still', 0.9);

  /* ложный путь: тупик со шипами */
  b.ground(104, 140, GY);
  b.memory.push({ tx: 108, ty: GY - 4 }, { tx: 109, ty: GY - 4 });
  b.memory.push({ tx: 116, ty: GY - 6 }, { tx: 117, ty: GY - 6 });
  b.memory.push({ tx: 124, ty: GY - 4 }, { tx: 125, ty: GY - 4 });
  b.memory.push({ tx: 132, ty: GY - 6 }, { tx: 133, ty: GY - 6 });
  b.spikes(112, GY - 1, 3);
  b.spikes(120, GY - 1, 3);
  b.spikes(128, GY - 1, 3);
  b.shadow(138, GY - 1, 'patrol');
  b.dec('eye', 120, GY - 9);

  b.ground(144, 174, GY);
  b.shadow(152, GY - 1, 'chase', 0.7);
  b.memory.push({ tx: 160, ty: GY - 4 }, { tx: 161, ty: GY - 4 });

  return {
    meta: LEVELS_META[7],
    rows: b.rows(), b,
    tileset: { ground: 'ground_l8', stone: 'stone_dark', plat: 'platform_bw' },
    mech: { hideHud: true, memoryBlocks: true, memoryHub: true, memRadius: 64,
      crumbleDelay: 0.42, crumbleRespawn: 2.4,
      /* четыре воспоминания — разной тональностью (док. ур.8, п.1) */
      zoneTints: [
        { from: 30,  to: 70,  color: '#fff6c8', a: 0.20 },   /* РАДОСТЬ — пересвет */
        { from: 74,  to: 100, color: '#7a86c8', a: 0.26 },   /* СТРАХ — холодная тьма */
        { from: 104, to: 140, color: '#9aa0a8', a: 0.24 },   /* ОДИНОЧЕСТВО — серая пустота */
        { from: 150, to: 172, color: '#e8b878', a: 0.20 },   /* ДОМ — тёплый свет */
      ],
      memFade: true, shadowsFreeze: true },
    script: [
        { at: 'start', lines: [
          { who: 'angel', face: 'angel_hello', text: 'Мы здесь уже были.' },
          { who: 'fox', face: 'fox_normal', text: 'Да.' },
          { who: 'angel', face: 'angel_fear', text: 'Но это место... неправильное.' },
          { who: 'angel', face: 'angel_fear', text: 'Я уже была здесь. Или нет?' },
        ]},
        { atX: 10, allowInHub: true, lines: [
          { who: 'fox', face: 'fox_normal4', text: 'Не открывай.' },
          { who: 'angel', face: 'angel_normal2', text: 'Почему?' },
          { who: 'fox', face: 'fox_normal', text: 'Ты уже был там.' },
          { who: 'angel', face: 'angel_fear', text: 'Да.' },
        ]},
    ],
  };
}

/* ═══════════════════════ УРОВЕНЬ 9 — ПРЕДДВЕРИЕ ═══════════════════════
   Ломается доверие: Лис даёт ложные подсказки, участки с инверсией управления. */
function level9() {
  const rng = mulberry32(909);
  const b = new Builder(185, H);
  const GY = 14;

  b.ground(0, 28, GY);
  b.setStart(3, GY - 2);
  b.setFox(11, GY - 2);

  /* ложная подсказка: «прыгай» — там шипы */
  b.ground(32, 60, GY);
  b.spikes(38, GY - 1, 4);
  b.plat(37, GY - 4, 6);
  b.triggers.push({ tx: 34, kind: 'lie', id: 'lie1' });
  /* ступень: с пола до GY-5 перепад 5 тайлов (> прыжка 4),
     поэтому подъём разбит на две ступени: пол -> GY-2 (2) -> GY-5 (3) */
  b.plat(45, GY - 2, 2);
  b.plat(48, GY - 5, 5);
  b.spikes(54, GY - 1, 4);
  /* промежуточная ступень над второй половиной шипов (55-57, GY-3):
     прыжок сразу за шипы с пола был 6 тайлов — на пределе;
     теперь с пола на ступень 3 вверх, со ступени на пол 58 — 1 вниз */
  b.plat(55, GY - 3, 3);
  b.ground(54, 60, GY);

  /* инверсия управления */
  b.ground(64, 98, GY);
  b.zones.push({ tx: 64, ty: GY - 9, w: 16, h: 9, kind: 'invert' });
  b.plat(70, GY - 4, 4);
  b.plat(78, GY - 6, 4);
  b.spikes(84, GY - 1, 5);
  b.ground(84, 98, GY);
  b.plat(85, GY - 4, 6);
  b.shadow(94, GY - 1, 'patrol');

  /* коридор доверия: две дороги, одна смертельна */
  b.ground(102, 140, GY);
  b.box(110, GY - 8, 110, GY - 5, '#');
  b.plat(104, GY - 4, 5);
  b.spikes(116, GY - 1, 6);
  /* ступень перед высокой полосой над шипами */
  b.plat(111, GY - 2, 2);
  /* полоса над шипами 116-121 опущена с GY-5 на GY-4:
     с пола перепад был 5 тайлов (> прыжка 4), и в полосу можно было
     попасть только точным прыжком со ступени; теперь 4 — как у других
     платформ над шипами (37-42, 155-161) */
  b.plat(114, GY - 4, 8);
  b.triggers.push({ tx: 104, kind: 'lie', id: 'lie2' });
  /* «неправильные команды» (док. ур.9, п.2): «Прыгай.» — а платформы нет */
  b.triggers.push({ tx: 126, kind: 'lie', id: 'lie3' });
  b.zones.push({ tx: 124, ty: GY - 9, w: 14, h: 9, kind: 'invert' });
  /* п.7 (док. ур.9): платформа на 126 убрана — «Прыгай.» действительно ложь, платформы нет */
  b.shadow(136, GY - 1, 'chase', 0.72);
  b.dec('eye', 130, GY - 9);

  /* Лис отстаёт / исчезает */
  b.ground(144, 184, GY);
  b.triggers.push({ tx: 148, kind: 'foxLeaves', id: 'foxgone' });
  b.spikes(156, GY - 1, 5);
  b.plat(155, GY - 4, 7);
  b.shadow(166, GY - 1, 'chase', 0.78);
  b.shadow(174, GY - 1, 'patrol');
  b.dec('eye', 160, GY - 8);
  b.dec('eye', 178, GY - 7);
  b.dec('door', 181, GY - 3);
  b.setExit(181, GY - 1);

  return {
    meta: LEVELS_META[8],
    rows: b.rows(), b,
    tileset: { ground: 'ground_l9', stone: 'stone_void', plat: 'platform_bw' },
    mech: { hideHud: true, invertZones: true, foxLies: true, visionCone: true, shadowsFreeze: true,
      falseFox: true, falseFoxFrom: 102 * CFG.TILE, falseFoxTo: 140 * CFG.TILE,
      eliteAngel: true, hazardGlow: true },
    script: [
      { at: 'start', lines: [
        { who: 'fox', face: 'fox_normal', text: 'Уже близко. Я проведу.' },
        { who: 'angel', face: 'angel_fear', text: 'Ты идёшь как-то иначе.' },
      ]},
      /* «Лис ведёт» (док. ур.9, п.1): перед первой пропастью — доверие до того, как его начнут ломать */
      { atX: 26, lines: [
        { who: 'fox', face: 'fox_normal', text: 'Стой.' },
        { who: 'fox', face: 'fox_normal2', text: 'Теперь прыгай.' },
      ]},
      /* ТЗ (подсказки Лиса): истинные советы перед опасными участками —
         контраст с ложными «lie»-подсказками. Игрок учится отличать. */
      { atX: 36, lines: [
        { who: 'fox', face: 'fox_normal4', text: 'Впереди шипы. Прыгай по платформам сверху.' },
      ]},
      { atX: 50, lines: [
        { who: 'fox', face: 'fox_normal4', text: 'Ещё шипы. Иди по ступеням вверх, не низом.' },
      ]},
      { atX: 66, lines: [{ who: 'angel', face: 'angel_fear', text: 'Руки не слушаются. Всё наоборот.' }] },
      /* «Лис далеко позади» (док. ур.9, п.4): камера показывает пустоту за спиной Ангела */
      /* п.1: дубль «Ты идёшь рядом со мной?» убран отсюда — реплика живёт в 118.
         п.2: камера уходит на 150, когда Лис отстал. */
      { atX: 118, camTo: 150, scene: 'l9_fox_far_behind', sceneCap: 'Лис далеко позади.', lines: [
        { who: 'angel', face: 'angel_fear', text: 'Ты идёшь рядом со мной?' },
        { who: 'fox', face: 'fox_normal4', text: 'Да.' },
        { who: 'angel', face: 'angel_fear', text: 'Но я тебя не вижу.' },
        { who: 'fox', face: 'fox_cry', text: 'Не смотри назад.' },
      ]},
      /* «неправильные команды» (док. ур.9, п.6): после «Прыгай.» платформы нет — Лис извиняется */
      /* «два голоса» (док. ур.9): ложный Лис впереди и настоящий за спиной
         говорят разное. Игра не даёт правил отличия — выбирать игроку. */
      { atX: 132, lines: [
        { who: 'fox', face: 'fox_normal4', text: 'Прыгай. Здесь можно.' },
        { who: 'angel', face: 'angel_fear', text: 'Ты не там. Ты сзади.' },
        { who: 'fox', face: 'fox_cry', text: 'Не смотри на него. Смотри на меня.' },
        { who: 'fox', face: 'fox_normal4', text: 'Извини.' },
      ]},
      /* элитная тень копирует Ангела (док. ур.9, п.5) */
      { atX: 144, lines: [
        { who: 'fox', face: 'fox_normal4', text: 'Не смотри на неё.' },
        { who: 'angel', face: 'angel_fear', text: 'На кого?' },
        { who: 'fox', face: 'fox_cry', text: 'На себя.' },
      ]},
      { atX: 148, lines: [
        { who: 'angel', face: 'angel_fear', text: 'Лис? Куда ты?' },
      ]},
      { atX: 179, lines: [
        { who: 'angel', face: 'angel_cry', text: 'У нас есть ключи.' },
        { who: 'fox', face: 'fox_normal4', text: 'Я знаю.' },
        { who: 'angel', face: 'angel_fear', text: 'Тогда открываем?' },
        { who: 'fox', face: 'fox_cry', text: 'Нет. Ты ещё не вспомнила главное.' },
      ]},
      /* финал доверия (док. ур.9, п.8): после «ещё не вспомнила главное» */
      { atX: 180, scene: 'l9_foxes_door', sceneCap: 'Между ними.', lines: [
        { who: 'fox', face: 'fox_normal4', text: 'Ты мне верила?' },
        { who: 'fox', face: 'fox_cry', text: 'Даже когда не видела меня?' },
        { who: 'angel', face: 'angel_cry', text: 'А не надо было?' },
        { who: 'fox', face: 'fox_normal4', text: 'Потому что я тоже не всегда знаю, кто я.' },
      ]},
    ],
  };
}

/* ═══════════════════════ УРОВЕНЬ 10 — ДВЕРЬ В БЕЗДНУ ═══════════════════════
   Ломается правда. Арена босса: Лицо + 2 Руки. */
function level10() {
  const b = new Builder(34, H);
  const GY = 15;
  b.ground(0, 33, GY);
  b.box(0, 0, 0, GY, '#');
  b.box(33, 0, 33, GY, '#');
  b.setStart(4, GY - 2);
  b.setFox(7, GY - 2);
  b.dec('door', 16, GY - 3);
  /* Платформы для подъёма к лицу. Ступени GY-2: с пола до GY-5 перепад
     5 тайлов — выше прыжка (4), к лицу босса было не подобраться. */
  b.plat(4, GY - 2, 2);
  b.plat(6, GY - 5, 4);
  b.plat(11, GY - 3, 2);
  b.plat(14, GY - 7, 6);
  b.plat(22, GY - 2, 2);
  b.plat(24, GY - 5, 4);

  return {
    meta: LEVELS_META[9],
    rows: b.rows(), b,
    tileset: { ground: 'ground_l10', stone: 'stone_void', plat: 'platform_bw' },
    mech: { boss: true, bossHp: 5, hideHud: false, arena: true, angelColor: true },
    script: [
      { at: 'start', lines: [
        { who: 'angel', face: 'angel_fear', text: 'Ты знал?' },
        { who: 'fox', face: 'fox_normal4', text: 'Пойдём.' },
        { who: 'angel', face: 'angel_normal', text: 'Ты не ответил.' },
        { who: 'fox', face: 'fox_cry', text: 'Я знаю.' },
        { who: 'angel', face: 'angel_fear', text: 'Страж не нападает. Он смотрит.' },
        { who: 'fox', face: 'fox_normal4', text: 'Не разговаривай с ним. Просто поверь мне.' },
      ]},
      /* Страж (док. ур.10): «Не подходи. / Ты не понимаешь. / Тогда объясни.» */
      { atX: 10, scene: 'l10_door_final', sceneCap: 'Страж.', lines: [
        { who: 'angel', face: 'angel_fear', text: 'Не подходи.' },
        { who: 'angel', face: 'angel_normal', text: 'Ты не понимаешь.' },
        { who: 'fox', face: 'fox_normal4', text: 'Тогда объясни.' },
      ]},
    ],
  };
}


/* ═══════════════════════ УРОВЕНЬ 11 — ПРИЗНАНИЕ ═══════════════════════
   Не уровень, а сцена: Ангел никуда не идёт. Лис стоит в центре экрана
   (mech.cinematic) и говорит напрямую игроку. После последней реплики —
   финальный экран. Кадры рта fox_mono1/fox_mono2 чередует hud.js. */
function level11() {
  const b = new Builder(20, H);
  const GY = 15;
  b.ground(0, 19, GY);
  b.box(0, 0, 0, GY, '#');
  b.box(19, 0, 19, GY, '#');
  b.setStart(2, GY - 2);
  b.setFox(2, GY - 2);
  b.setExit(17, GY - 1);

  return {
    meta: LEVELS_META[10],
    rows: b.rows(), b,
    tileset: { ground: 'ground_l10', stone: 'stone_void', plat: 'platform_bw' },
    /* hideHud прячет полосу HUD; окно диалога живёт отдельно и остаётся */
    mech: { cinematic: true, hideHud: true },
    script: [
      { at: 'start', lines: [
        { who: 'fox', face: 'fox_mono1', text: 'Привет! Ты прошла игру.' },
        { who: 'fox', face: 'fox_mono1', text: 'Вообще, я планировал, что здесь будут переживания Лиса (то есть меня).' },
        { who: 'fox', face: 'fox_mono1', text: 'Но я пересмотрел свои планы, и они будут чуть позже.' },
        { who: 'fox', face: 'fox_mono1', text: 'Здесь я хочу сказать, что я тебя люблю.' },
        { who: 'fox', face: 'fox_mono1', text: 'Что я рад, что ты до сих пор со мной.' },
        { who: 'fox', face: 'fox_mono1', text: 'Что даже без желания общаться ты не бросаешь.' },
        { who: 'fox', face: 'fox_mono1', text: 'Честно, я иногда переживаю по этому поводу, но чаще дел так много, что уже и не думаю об этом.' },
        { who: 'fox', face: 'fox_mono1', text: 'Я знаю, что мой ангел меня любит, даже если мне кажется обратное.' },
        { who: 'fox', face: 'fox_mono1', text: 'Я знаю, точнее надеюсь, что это временно. Что всё у нас будет хорошо.' },
        { who: 'fox', face: 'fox_mono1', text: 'Главное — не опускать руки и стараться.' },
        { who: 'fox', face: 'fox_mono1', text: 'Даже когда я сейчас это говорю, я до конца не уверен, нужен ли я тебе.' },
        { who: 'fox', face: 'fox_mono1', text: 'Но, если ты это читаешь, то, скорее всего, нужен.' },
        { who: 'fox', face: 'fox_mono1', text: 'Ник.' },
        { who: 'fox', face: 'fox_mono1', text: 'Я тебя очень сильно люблю, спасибо, что ты есть, и именно ты.' },
        { who: 'fox', face: 'fox_mono1', text: 'И поздравляю тебя с тем, что мы вместе уже год!' },
        { who: 'fox', face: 'fox_mono1', text: 'И да, половину наших отношений мы проведём на расстоянии, но я уверен, что в один момент мы съедимся, и потом уже большую часть наших отношений мы будем не то что не на расстоянии, а под одной крышей, вместе.' },
        { who: 'fox', face: 'fox_mono1', text: 'И, конечно, я не мог тебя оставить без моих попыток петь.' },
        { who: 'fox', face: 'fox_mono1', text: 'И при выборе, что исполнить, я решил, что для наших отношений важна именно эта песня.' },
        { who: 'fox', face: 'fox_mono1', text: 'И так, приятного прослушивания.', song: true },
      ]},
    ],
  };
}

const LEVEL_BUILDERS = [level1, level2, level3, level4, level5, level6, level7, level8, level9, level10, level11];

function buildLevel(idx) {
  const L = LEVEL_BUILDERS[idx]();
  const b = L.b;
  const map = makeMap(L.rows);
  return {
    idx,
    meta: L.meta,
    map,
    tileset: L.tileset,
    mech: L.mech,
    script: L.script,
    decor: b.decor,
    shadows: b.shadows,
    echoPlats: b.echoPlats,
    reflectTiles: b.reflectTiles,
    secrets: b.secrets,
    crumbles: b.crumbles,
    rifts: b.rifts,
    memory: b.memory,
    zones: b.zones,
    lightWells: b.lightWells,
    keys: b.keys,
    portals: b.portals,
    fragments: b.fragments,
    checkpoints: b.checkpoints || [],
    rhythm: b.rhythm,
    triggers: b.triggers,
    start: b.start,
    foxStart: b.foxStart,
    exit: b.exit,
    widthPx: map.w * CFG.TILE,
    heightPx: map.h * CFG.TILE,
  };
}

function levelCount() { return LEVEL_BUILDERS.length; }

/* Все имена «частей цвета» по ДАННЫМ уровней, а не по литералу в main.js:
   список из 4 имён разошёлся с уровнями (пятый фрагмент «ТИШИНА II» кладётся
   в сейв, но счётчик показывал «4 из 4» ещё до его сбора). Строится одним
   проходом buildLevel по всем главам — функция чистая, в Node-тестах уже
   гоняется, стоимость на boot несущественна. */
let _fragmentNames = null;
function allFragmentNames() {
  if (_fragmentNames) return _fragmentNames;
  const seen = [];
  for (let i = 0; i < LEVEL_BUILDERS.length; i++) {
    for (const f of buildLevel(i).fragments) {
      if (!seen.includes(f.name)) seen.push(f.name);
    }
  }
  _fragmentNames = seen;
  return seen;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Builder, buildLevel, levelCount, allFragmentNames, LEVEL_BUILDERS };
}
