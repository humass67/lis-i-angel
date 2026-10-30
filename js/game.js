/* game.js — контроллер сессии: ввод, загрузка уровня, механики, диалоги,
   смерть/респавн, бой с боссом, финал. Связывает engine + render + audio + fx. */
'use strict';

const Game = {
  L: null,              // текущий уровень
  state: null,          // игровое состояние
  running: false,
  paused: false,
  lastT: 0,
  acc: 0,
  onLevelDone: null,    // колбэк в main.js
  onGameDone: null,
};

const INPUT = {
  left: false, right: false, jumpHeld: false, jumpPressed: false,
  leftPressed: false, rightPressed: false,   /* новое нажатие (для закрытия сцены) */
  shoutPressed: false, actionPressed: false,
};

const FIXED_DT = 1 / 60;

/* ───────────────────────── ввод ───────────────────────── */
const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  Space: 'jump', ArrowUp: 'jump', KeyW: 'jump',
  KeyE: 'shout', ShiftLeft: 'shout',
  Enter: 'action', KeyZ: 'action',
};
/* Фолбэк по СИМВОЛУ клавиши (e.key): KEYMAP — по физической позиции (e.code),
   и на AZERTY клавиша с надписью «A» даёт код KeyQ — «влево» не работало.
   Фолбэк ловит и ShiftRight, которого в KEYMAP нет. Приоритет у e.code:
   на AZERTY клавиша ZQSD «Z» (код KeyW) остаётся прыжком, а не действием. */
const KEYMAP_BY_CHAR = {
  arrowleft: 'left', arrowright: 'right', arrowup: 'jump', ' ': 'jump',
  a: 'left', d: 'right', w: 'jump',
  e: 'shout', shift: 'shout',
  enter: 'action', z: 'action',
};
function keyAction(e) {
  if (KEYMAP[e.code]) return KEYMAP[e.code];
  const k = (e.key || '').toLowerCase();
  return KEYMAP_BY_CHAR[k] || null;
}

function inputAttach() {
  window.addEventListener('keydown', (e) => {
    /* консоль открыта — клавиатура принадлежит ей */
    if (conIsOpen()) return;
    /* Игровая клавиатура живёт только на экране игры: иначе preventDefault
       съедал стрелки в ползунках громкости и не давал жать кнопки меню с
       клавиатуры (Tab → Enter). Оверлеи (настройки/уровни/части) не меняют
       UI.current — они живут поверх меню, там ввод тоже свободен. */
    if (typeof UI === 'undefined' || UI.current !== 'game') return;
    const a = keyAction(e);
    if (!a) return;
    e.preventDefault();
    audioResume();
    if (a === 'left') { INPUT.left = true; INPUT.leftPressed = true; }
    else if (a === 'right') { INPUT.right = true; INPUT.rightPressed = true; }
    else if (a === 'jump') { if (!INPUT.jumpHeld) INPUT.jumpPressed = true; INPUT.jumpHeld = true; }
    else if (a === 'shout') INPUT.shoutPressed = true;
    else if (a === 'action') INPUT.actionPressed = true;
  });
  window.addEventListener('keyup', (e) => {
    if (conIsOpen()) return;
    const a = keyAction(e);
    if (!a) return;
    if (a === 'left') INPUT.left = false;
    else if (a === 'right') INPUT.right = false;
    else if (a === 'jump') INPUT.jumpHeld = false;
  });
  window.addEventListener('blur', () => {
    INPUT.left = INPUT.right = INPUT.jumpHeld = false;
    /* п.4: edge-флаги тоже гасим — иначе зажатый при alt-tab Space/Enter
       срабатывает на первом кадре после возврата фокуса. */
    INPUT.jumpPressed = INPUT.shoutPressed = INPUT.actionPressed = false;
    INPUT.leftPressed = INPUT.rightPressed = false;
  });
}

/* Сенсорное управление (мобильные) */
function bindTouch(el, action) {
  if (!el) return;
  const on = (e) => {
    e.preventDefault();
    audioResume();
    if (action === 'left') { INPUT.left = true; INPUT.leftPressed = true; }
    else if (action === 'right') { INPUT.right = true; INPUT.rightPressed = true; }
    else if (action === 'jump') { if (!INPUT.jumpHeld) INPUT.jumpPressed = true; INPUT.jumpHeld = true; }
    else if (action === 'shout') INPUT.shoutPressed = true;
    else if (action === 'action') INPUT.actionPressed = true;
    el.classList.add('held');
  };
  const off = (e) => {
    e.preventDefault();
    if (action === 'left') INPUT.left = false;
    else if (action === 'right') INPUT.right = false;
    else if (action === 'jump') INPUT.jumpHeld = false;
    el.classList.remove('held');
  };
  el.addEventListener('pointerdown', on);
  el.addEventListener('pointerup', off);
  el.addEventListener('pointercancel', off);
  el.addEventListener('pointerleave', off);
}

/* ───────────────────────── загрузка уровня ───────────────────────── */
function loadLevel(idx) {
  const L = buildLevel(idx);
  Game.L = L;
  const T = CFG.TILE;

  /* нагнетание ур.3 живёт 5 с — при смене уровня его нельзя тянуть с собой */
  if (typeof sfxShadowLongStop === 'function') sfxShadowLongStop();
  const angel = makeActor(L.start.tx * T, L.start.ty * T, CFG.ANGEL_W, CFG.ANGEL_H);
  const fox = L.foxStart
    ? makeActor(L.foxStart.tx * T, L.foxStart.ty * T, CFG.FOX_W, CFG.FOX_H)
    : null;

  const shadows = L.shadows.map(s => {
    /* размеры из CFG, а не 14x14 под старый тайл 16 */
    const a = makeActor(s.tx * T, s.ty * T - CFG.SHADOW_H, CFG.SHADOW_W, CFG.SHADOW_H);
    a.kind = s.kind;
    a.speedMul = s.speedMul;
    a.reflectOnly = !!s.reflectOnly;
    /* перенос флагов из данных уровня: невидимость (ур.3) и осколок (ур.6) */
    a.hidden = !!s.hidden;
    a.shard = !!s.shard;
    a.jitter = !!s.jitter;
    a.blind = !!s.blind;
    a.scale = s.scale || 1;
    return a;
  });

  /* эхо-платформы: символы в карте пока пустые, engine включит их сам */
  const echo = L.echoPlats.length
    ? makeEchoPlatforms(L.echoPlats, L.mech.echoTtl || 2.2)
    : null;

  /* исчезающие блоки: ставим символы 'x' в карту */
  const crumbles = L.crumbles.map(c => ({ tx: c.tx, ty: c.ty, phase: 'idle', t: 0, respawn: L.mech.crumbleRespawn || 2.4 }));
  for (const c of crumbles) setTile(L.map, c.tx, c.ty, 'x');
  const crumbleMap = new Map(crumbles.map(c => [c.tx + ',' + c.ty, c]));

  /* блоки памяти: твердые всегда, но видны по радиусу */
  for (const m of L.memory) setTile(L.map, m.tx, m.ty, 't');

  const twin = L.mech.echoTwin ? makeEcho(L.mech.twinDelay || 1.15) : null;
  const foxEchoBuf = (L.mech.visionCone && fox) ? makeEcho(0.9) : null;
  /* элитная тень-копия Ангела (док. ур.9, п.5): повторяет её движения с задержкой */
  const angelEcho = L.mech.eliteAngel ? makeEcho(1.4) : null;
  const boss = L.mech.boss ? makeBoss(L.mech.bossHp || 5) : null;

  Game.state = {
    t: 0,
    angel, fox, shadows, echo, crumbles, crumbleMap, twin, boss,
    memSeen: new Set(),
    camX: 0, camY: 0,
    deaths: 0,
    invuln: 0,
    dying: 0,
    /* 11-я сцена (mech.cinematic): уровень считается пройденным сразу —
       финал открывается, когда опустеет очередь монолога. */
    done: !!L.mech.cinematic,
    won: !!L.mech.cinematic,
    cinematic: !!L.mech.cinematic,
    stepT: 0,
    moteT: 0,
    shoutCd: 0,
    dialog: null,
    dialogQueue: [],
    firedScripts: new Set(),
    foxGone: false,
    /* Лис начинает следовать только после сцены встречи (mech.foxWakeX).
       Для уровней без этого поля порог 0 — значит идёт следом сразу. */
    foxActive: !L.mech.foxWakeX,
    gravFlipCd: 0,
    gravChaosT: 0,          /* таймер кульминации L6 */
    gravChaosLeft: null,    /* бюджет переворотов хаоса L6 (null — ещё не входил) */
    usedRifts: new Set(),   /* разломы одноразовые: сработал — больше не срабатывает */
    bossDeadT: 0,
    bossStage: 0,
    foxBoss: null,
    keys: [],
    fragments: [],
    checkpoint: null,   /* активный чекпойнт; null — старт уровня */
    colorWave: 0,
    colorHold: 0,
    foxHideT: 0,
    foxStuck: false,       /* Лис отстал (не следует), пока сцена не снимет флаг */
    rhythmAll: 0,
    rhythmShift: 0,
    viewGrav: null,
    viewGravT: 0,       /* сек, сдвиг фазы такта */
    rhythmShiftT: 0,      /* сек, сколько длится сдвиг */         /* сек, когда все ритмические точки горят (кульминация БАХ) */           /* сек, пока Лис не виден и не следует (док. ур.4, «мир в мире») */          /* сек полного цвета (мгновенно, без плавного падения) */
    darkness: 0,           /* 0..1: затемнение сцены */
    darkT: 0,              /* таймер полной темноты, сек */
    sceneCam: null,        /* X (в тайлах) сценической камеры, null = следит за Ангелом */
    reflected: false,
    portalCd: 0,
    /* L4: обрыв, из которого Ангел только что вышел (защёлка вместо
       временного кулдауна — см. блок порталов 'v' в step()). */
    pitLock: 0,
    /* сек: двойник «потерял след» после перехода и не бьёт из точки выхода */
    twinCd: 0,
    memoryPortalCd: 0,
    memRadiusNow: null,
    joyT: 0,
    lookBackSeen: false,   /* «Не смотри назад»: одноразовый разворот уже был */
    lookBackT: 0,          /* сек, пока видна огромная тень-Лис за спиной */
    doorTailJerk: 0,       /* сек, пока хвост дёргается у двери */
    doorTailSeen: false,
    bossTalkSeen: false,   /* перелом Стража: диалог однократно */
    foxCallT: 0,           /* кулдаун подсказок Лиса в бою (док. ур.10) */
    foxEcho: foxEchoBuf,   /* копия Лиса для элитной тени (ур.9) */
    angelEcho,             /* копия Ангела (элитная тень, док. ур.9, п.5) */
    falseFox: null,        /* ложный Лис впереди (док. ур.9): силуэт-приманка */
    /* рывок у двери уже был */               /* сек до возврата из зоны РАДОСТЬ (зацикливание) */    /* текущий радиус видимости воспоминаний (гаснет в СТРАХ) */
    rhythmBeat: -1,
    gravityZone: null,
    aidFlashT: 0,          /* сек усиленной подсветки опасных тайлов после респавна (мягкая помощь) */
    doorHits: 0,           /* трещины двери (для рендера) */
    bossDmg: 0,            /* суммарный урон Стражу: трещины + прямые удары */
    arenaPhase2: false,    /* опоры II фазы уже добавлены */
    arenaPlates: null,     /* какие плиты добавили — чтобы убрать при смерти */
    /* endingT — держит гейт step() `done && endingT<=0` ОТКРЫТЫМ для босса и
       11-й сцены: у них done ставится ДО конца сюжета (3-й удар / загрузка),
       и мир обязан продолжать тикать, пока игрок листает финальные реплики.
       На обычных уровнях endingT=0 — после выхода мир заморожен до outro.
       Поле НЕ тикает вниз: экран переключает main.js, freeze не нужен. */
    endingT: L.mech.cinematic ? 0.001 : 0,
  };

  /* стартовый диалог */
  const startScript = L.script.find(s => s.at === 'start');
  /* вступление (док. ур.1, п.8): затемнение «чёрный экран» на старте */
  if (startScript && L.idx === 0) fxFlash(0.9, '#000');
  if (startScript && startScript.scene) showSceneImage(startScript.scene, startScript.sceneCap);
  if (startScript) queueDialog(startScript.lines);
  Game.state.firedScripts.add('start');

  ambientSetCorruption(L.meta.corruption, L.mech.droneMul);
  audioSetMuffle(L.mech.muffled ? 1 : 0);
  fxReset();
  updateCamera(true);
  return L;
}

/* ───────────────────────── сцены-картинки (сюжет/0810) ─────────────────────────
   Важный момент уровня показывает кадр поверх игры. Мир замирает, диалог
   ставится на паузу; закрывается ENTER/SPACE (см. main.js). */
function showSceneImage(name, cap) {
  const st = Game.state;
  if (!st || st.sceneImg) return;
  const el = document.getElementById('sceneImg');
  const pic = document.getElementById('sceneImgPic');
  const capEl = document.getElementById('sceneImgCap');
  if (!el || !pic) return;
  pic.src = 'assets/scenes/' + name + '.png';
  capEl.textContent = cap || '';
  pic.style.opacity = ''; pic.style.transition = '';   /* сброс возможного 0.15 от прерванной подмены */
  el.hidden = false;
  /* плавный переход картинка→игра (просьба): не жёсткий кат, а растворение.
     Начинаем с прозрачности 0 и даём браузеру кадр, потом проявляем. */
  el.classList.add('pre');
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('pre')));
  st.sceneImg = name;
  st.sceneClock = 0;   /* защита: первую 1 с сцену не пропустить */
  st.sceneGen = (st.sceneGen || 0) + 1;   /* новая сцена отменяет «растворение» прошлой */
  if (typeof audioSetMuffle === 'function') audioSetMuffle(1);
}
/* Подмена кадра внутри уже открытой сцены (для многофазных сцен):
   переход цветной цветок → серый без закрытия сцены. */
function swapSceneImage(name, cap) {
  const st = Game.state;
  if (!st || !st.sceneImg || st.sceneFadeBusy) return false;
  const el = document.getElementById('sceneImg');
  const pic = document.getElementById('sceneImgPic');
  const capEl = document.getElementById('sceneImgCap');
  if (!el || !pic) return false;
  st.sceneFadeBusy = true;
  const prevCap = capEl.textContent;
  const gen = st.sceneGen;
  const apply = () => {
    st.sceneFadeBusy = false;
    if (st.sceneGen !== gen) {            /* сцену уже закрыли/сменили */
      pic.style.opacity = ''; pic.style.transition = '';   /* иначе 0.15 остаётся навсегда */
      return;
    }
    pic.src = 'assets/scenes/' + name + '.png';
    capEl.textContent = cap || prevCap || '';
    st.sceneImg = name;
    st.sceneClock = 0;
    pic.style.transition = 'opacity .35s ease';
    pic.style.opacity = '1';
    setTimeout(() => { pic.style.transition = ''; }, 400);
  };
  /* быстро притушить → подменить → проявить */
  pic.style.transition = 'opacity .3s ease';
  pic.style.opacity = '0.15';
  setTimeout(apply, 310);
  return true;
}
/* Принудительно убрать картинку сцены при уходе с уровня.
   closeSceneImage() требует живого st.sceneImg, а после выхода в меню
   состояния уже нет — картинка оставалась висеть поверх меню и
   следующего уровня. */
function sceneForceHide() {
  const el = document.getElementById('sceneImg');
  if (!el) return;
  el.hidden = true;
  el.classList.remove('pre');
  const pic = document.getElementById('sceneImgPic');
  const capEl = document.getElementById('sceneImgCap');
  if (pic) { pic.style.opacity = ''; pic.style.transition = ''; }
  if (capEl) capEl.textContent = '';
  if (Game.state) { Game.state.sceneImg = null; Game.state.sceneFadeBusy = false; }
  if (typeof audioSetMuffle === 'function') audioSetMuffle(0);
}
function closeSceneImage() {
  const st = Game.state;
  if (!st || !st.sceneImg) return false;
  const el = document.getElementById('sceneImg');
  /* растворение: мир возобновляется сразу, картинка уходит поверх него */
  st.sceneImg = null;
  if (el) {
    el.classList.add('pre');
    /* «поколение» сцены: если за время растворения покажут новую сцену,
       старый обработчик не должен её спрятать (иначе картинка мигает). */
    st.sceneGen = (st.sceneGen || 0) + 1;
    const gen = st.sceneGen;
    const done = () => {
      el.removeEventListener('transitionend', done);
      if (st.sceneGen !== gen) return;   /* уже показана другая сцена — не трогаем */
      el.hidden = true; el.classList.remove('pre');
    };
    el.addEventListener('transitionend', done);
    setTimeout(done, 700);   /* страховка, если transitionend не придёт */
  }
  if (typeof audioSetMuffle === 'function') audioSetMuffle(Game.L.mech.muffled ? 1 : 0);
  return true;
}

/* ───────────────────────── диалоги ───────────────────────── */
/* Фазы босса ↔ секции музыки. Каждая фаза просит у музыки свою секцию и
   получает её длину: атака живёт столько же, сколько трек атаки, стан —
   сколько трек стана. Трек при этом никогда не обрезается. */
function bossWirePhases(st) {
  const b = st && st.boss;
  if (!b) return;
  st.bossPhaseN = -1;                 /* первая фаза (intro) = секция 0 */
  b.onPhase = function (phase, force) {
    st.bossPhaseN++;
    if (typeof bossMusicSection !== 'function') return 0;
    return bossMusicSection(st.bossPhaseN, force);
  };
  /* Позиция трека текущей фазы — по ней движок ведёт таймер фазы. */
  b.phasePosFn = function () {
    if (typeof bossMusicPos !== 'function') return null;
    return bossMusicPos(bossTrackAt(st.bossPhaseN));
  };
}

/* Звук реплики: у строки диалога может быть необязательное поле sfx.
   Данные уровня называют ЗВУК, а не функцию, — работает только белый
   список ниже, чтобы levels.js не мог выполнить произвольный код. */
const DIALOG_SFX = {
  shadow: () => sfxShadow(),   /* шёпот тени (audio.js:505) — короткий, для угроз вблизи */
  shadowLong: () => sfxShadowLong(),   /* нагнетание на 5 с (audio.js) — «Не слушай.» (ур.3) */
};
function playDialogSfx(name) {
  /* hasOwnProperty обязателен: без него 'constructor'/'toString' находятся
     в прототипе объекта и вызываются как «звук» (проверено пробой). */
  if (!Object.prototype.hasOwnProperty.call(DIALOG_SFX, name)) return false;
  const fn = DIALOG_SFX[name];
  if (typeof fn !== 'function') return false;
  fn();
  return true;
}
/* Скорость печати реплик — настройка «Скорость текста» (обычная/быстрая/мгновенно).
   Раньше самой длинной реплике (216 символов при 38 CPS) требовалось 5.7 с,
   и всё это время мир был заморожен. */
function dialogCPS() {
  const s = (typeof getSave === 'function') ? getSave() : null;
  const m = s && s.textSpeed;
  if (m === 'fast') return 70;
  if (m === 'instant') return Infinity;
  return CFG.DIALOG_CPS;
}
function queueDialog(lines) {
  for (const l of lines) Game.state.dialogQueue.push(l);
  if (!Game.state.dialog) nextDialog();
}
function nextDialog() {
  const st = Game.state;
  /* маркер возврата камеры: снимает сценическую камеру и пропускается */
  while (st.dialogQueue.length && st.dialogQueue[0]._camReturn) {
    st.dialogQueue.shift();
    st.sceneCam = null;
  }
  if (!st.dialogQueue.length) {
    st.dialog = null;
    /* очередь опустела — время отложенной подсказки уровня: пока шёл
       стартовый диалог, показывать её было бессмысленно (hudSetLevel). */
    if (typeof HUD !== 'undefined' && HUD.pendingHint) {
      const h = HUD.pendingHint;
      HUD.pendingHint = '';
      showHint(h);
    }
    return;
  }
  const l = st.dialogQueue.shift();
  /* звук реплики (необязательное поле sfx) — играем в момент ПОКАЗА строки,
     а не в момент постановки в очередь: иначе шёпот прозвучал бы заранее,
     пока игрок ещё читает предыдущую реплику. */
  if (l.sfx) playDialogSfx(l.sfx);
  /* последняя реплика запускает песню (финал после 10 уровня) */
  if (l.song && typeof musicFinal === 'function') musicFinal();
  /* многофазная сцена: реплика может подменить кадр прямо в открытой сцене
     (цветной цветок → серый), не закрывая её */
  if (l.swap && st.sceneImg) swapSceneImage(l.swap, l.swapCap);
  st.dialog = { who: l.who, face: l.face, text: l.text, sfx: l.sfx, shown: 0, done: false, t: 0 };
}
function advanceDialog() {
  const st = Game.state;
  if (!st.dialog) return false;
  if (!st.dialog.done) {
    st.dialog.shown = st.dialog.text.length;
    st.dialog.done = true;
  } else {
    nextDialog();
  }
  return true;
}
/* ВНИМАНИЕ: диалог БЛОКИРУЕТ мир — см. ветку `if (st.dialog) { … return; }`
   в step(). Отдельная функция не нужна (прежний dialogBlocking() возвращал
   false и вводил в заблуждение — удалена). */

/* ───────────────────────── камера ───────────────────────── */
function updateCamera(snap) {
  const st = Game.state, L = Game.L;
  const a = st.angel;
  /* Сценическая камера: если активна сцена с camTo (tx), камера смотрит
     на эту точку вместо Ангела. Сбрасывается, когда реплики закрыты. */
  let camCX = a.x + a.w / 2;
  if (st.sceneCam != null) camCX = st.sceneCam * CFG.TILE;
  const targetX = clamp(camCX - CFG.VIEW_W / 2, 0, Math.max(0, L.widthPx - CFG.VIEW_W));
  const targetY = clamp(a.y + a.h / 2 - CFG.VIEW_H * 0.58, 0, Math.max(0, L.heightPx - CFG.VIEW_H));
  if (snap) { st.camX = targetX; st.camY = targetY; return; }
  st.camX = lerp(st.camX, targetX, 0.12);
  st.camY = lerp(st.camY, targetY, 0.08);
}

/* ───────────────────────── механики по зонам ───────────────────────── */
function zoneAt(L, a) {
  const T = CFG.TILE;
  const cx = a.x + a.w / 2, cy = a.y + a.h / 2;
  for (const z of L.zones) {
    if (cx >= z.tx * T && cx <= (z.tx + z.w) * T &&
        cy >= z.ty * T && cy <= (z.ty + z.h) * T) return z;
  }
  return null;
}

/* Безопасный переворот (док. ур.6, вариант B): ищем первую непустую клетку
   по направлению новой гравитации от центра Ангела. Если это вода/шипы,
   край карты (пустота) или исчезающий блок сверху (переворот вниз: он
   провалится под ногами) — переворот опасен, его пропускаем. */
function flipIsSafe(L, a, dir) {
  const T = CFG.TILE;
  const cx = Math.floor((a.x + a.w / 2) / T);
  let ty = Math.floor((a.y + a.h / 2) / T);
  const step = dir;                       /* +1 — вниз, -1 — вверх */
  for (let i = 0; i < 40; i++) {
    ty += step;
    if (ty < 0 || ty >= L.map.h) return false;      /* край карты: падение за пределы */
    const ch = tileAt(L.map, cx, ty);
    if (ch === 'W' || ch === '^') return false;      /* вода или шипы под новой гравитацией */
    if (ch === 'x' && step > 0) return false;        /* исчезающий блок: сверху он
                                                        провалится под ногами */
    if (SOLID.has(ch)) return true;                  /* нашли опору */
  }
  return false;                                      /* опоры нет: падение через пустоту */
}

function riftAt(L, a) {
  const T = CFG.TILE;
  const r = actorRect(a);
  for (const rf of L.rifts) {
    const zone = { x: rf.tx * T - 2, y: (rf.ty - 1) * T, w: T + 4, h: T * 3 };
    if (aabb(r, zone)) return rf;
  }
  return null;
}

function inLightWell(L, actor) {
  if (!L.lightWells || !L.lightWells.length) return false;
  const cx = actor.x + actor.w / 2, cy = actor.y + actor.h / 2, T = CFG.TILE;
  return L.lightWells.some(w => cx >= w.tx * T && cx <= (w.tx + w.w) * T &&
    cy >= w.ty * T && cy <= (w.ty + w.h) * T);
}

/* ── консоль разработчика (js/console.js) ──
   Модуль необязательный: в headless-стендах (tests/*) его нет, поэтому
   спрашиваем через `typeof`, а не напрямую. */
function conIsOpen() { return typeof CON !== 'undefined' && !!CON.open; }
function conVarOn(name) { return typeof CON !== 'undefined' && !!(CON.vars && CON.vars[name]); }

/* ───────────────────────── смерть ───────────────────────── */
function killAngel(reason, ignoreInvuln) {
  const st = Game.state;
  /* чит консоли: god — смерть не наступает вовсе */
  if (conVarOn('god')) return;
  /* ignoreInvuln: падение ЗА карту — не «урон», а выход из мира: грация
     респавна на него не распространяется (иначе Ангел до секунды
     тонет ниже линии смерти, пока не кончится неуязвимость). */

  if (st.dying > 0 || (st.invuln > 0 && !ignoreInvuln) || st.done) return;
  /* смерть снимает ПОКАЗАННУЮ реплику: иначе диалог, выданный в кадр гибели,
     висит поверх позы смерти и ждёт нажатия игрока. Очередь НЕ стираем —
     в ней лежат реплики сюжета (их флаг done уже сожжён и повтора не будет)
     и маркер _camReturn, без которого камера застрянет на сцене. */
  st.dialogDropped = !!st.dialog;
  /* Снимок недоигранных реплик. Пока тикает смерть, очередь могут
     израсходовать другие ветки step() — тогда сюжетная реплика теряется
     навсегда: флаг done у скрипта уже сожжён, повторного триггера нет. */
  st.dialogResume = st.dialogQueue.slice();
  st.dialog = null;
  st.dying = CFG.RESPAWN_DELAY;
  st.deaths++;
  addDeath();
  fxDeath(st.angel.x + st.angel.w / 2, st.angel.y + st.angel.h / 2);
  fxFlash(0.3, '#ff3040');
  sfxDeath();
}

function respawn() {
  const st = Game.state, L = Game.L, T = CFG.TILE;
  const a = st.angel;
  const cp = st.checkpoint;
  a.x = (cp ? cp.tx : L.start.tx) * T; a.y = (cp ? cp.ty : L.start.ty) * T;
  a.vx = 0; a.vy = 0; a.grav = 1; a.onGround = false;
  st.invuln = 1.0;
  st.dying = 0;
  /* мягкая помощь: после многих смертей на пару секунд подсвечиваем опасное */
  if (CFG.AID_HINT_TIME > 0 && st.deaths >= CFG.AID_HINT_DEATHS) st.aidFlashT = CFG.AID_HINT_TIME;
  /* сбрасываем состояние механик */
  if (st.twin) { st.twin.buf.length = 0; st.twin.ready = false; }
  st.reflected = false;
  st.portalCd = 0;
  st.pitLock = 0;
  st.twinCd = 0;
  st.memoryPortalCd = 0;
  st.gravityZone = null;
  st.gravChaosLeft = null;   /* кульминация L6 начинается заново после смерти */
  st.gravChaosT = 0;
  st.usedRifts.clear();      /* разломы взводятся заново после смерти */
  /* предупреждения у заблокированного выхода показываются заново после смерти */
  st.fragmentGateWarned = false;
  st.keyGateWarned = false;
  st.exitHintShown = false;
  st.viewGravT = 0; st.viewGrav = 1;   /* картинка догоняет реальную гравитацию */
  st.joyT = 0;   /* п.8: таймер РАДОСТИ не переживает смерть */
  if (st.echo) for (const p of st.echo.list) { p.alive = 0; setTile(L.map, p.tx, p.ty, '.'); }
  for (const c of st.crumbles) { c.phase = 'idle'; c.t = 0; setTile(L.map, c.tx, c.ty, 'x'); }
  /* тени по местам */
  L.shadows.forEach((s, i) => {
    const sh = st.shadows[i];
    if (!sh) return;
    sh.dead = false;   /* упавшая тень тоже возвращается на пост */
    sh.x = s.tx * T;
    sh.y = s.ty * T - CFG.SHADOW_H;
    sh.vx = 0; sh.vy = 0;
  });
  /* Лис возвращается в исходную точку и снова ждёт сцены встречи —
     иначе после смерти он остаётся в конце уровня. */
  if (st.fox && L.foxStart) {
    st.fox.x = L.foxStart.tx * T;
    st.fox.y = L.foxStart.ty * T;
    st.fox.vx = 0; st.fox.vy = 0;
    st.foxActive = !L.mech.foxWakeX;
  }
  /* foxGone (ур. 9): уход Лиса — окончательный. Триггер foxLeaves уже лежит в
     st.firedScripts и второй раз не сработает, поэтому снимать флаг после
     смерти нельзя: Лис молча «возвращался» и висел невидимкой до выхода.
     Исключение — босс (ур. 10): там foxGone ставит переход фазы (hp → 0), и
     при пересоздании босса Лис обязан вернуться в бой. */
  const foxLeftForGood = L.triggers.some(tr => tr.kind === 'foxLeaves' && st.firedScripts.has(tr.id));
  if (!foxLeftForGood) st.foxGone = false;
  /* Босс пересоздаётся: иначе после смерти в бою он остаётся с прежними HP,
     фазой и позициями рук. Игрок возрождается у входа, а рука может висеть
     в середине slam прямо над точкой респавна — бой становится непроходимым
     (или наоборот тривиальным, если лицо уже открыто). */
  if (L.mech.boss) {
    st.boss = makeBoss(L.mech.bossHp || 5);
    st.bossStage = 0;
    st.foxBoss = null;
    st.foxCopies = null;
    st.foxGravOn = 0;
    st.foxGravT = 0;
    /* Смерть = бой начинается заново: Страж полностью здоров, дверь целая.
       Раньше трещины сохранялись (hp = maxHp - doorHits), и после гибели
       здоровье не восстанавливалось, а при hp 0 бой оставался мёртвым. */
    if (st.arenaPlates) {
      for (const tx of st.arenaPlates) if (tileAt(L.map, tx, 12) === '=') setTile(L.map, tx, 12, '.');
      st.arenaPlates = null;
    }
    st.arenaPhase2 = false;
    st.doorHits = 0;
    st.bossDmg = 0;
    st.boss.hp = st.boss.maxHp;
    st.bossDeadT = 0;
  }
  /* Лис: снять «отстал/замер». Скрипт foxStuck=false к этому моменту уже сожжён,
     поэтому без сброса Лис замирает до конца уровня (после смерти — сдвиг 0 px). */
  st.foxStuck = false;
  updateCamera(true);
  /* если смерть сняла показанную реплику, а очередь не пуста — продолжаем
     сюжет с того места, где оборвались, а не молчим до следующего триггера */
  if (st.dialogDropped) {
    st.dialogDropped = false;
    const resume = st.dialogResume || [];
    st.dialogResume = null;
    /* Возвращаем снимок, только если за время смерти очередь реально
       опустела — иначе реплики задвоятся. */
    if (!st.dialogQueue.length) for (const l of resume) st.dialogQueue.push(l);
    if (!st.dialog && st.dialogQueue.length) nextDialog();
  }
}

/* ───────────────────────── основной шаг ───────────────────────── */
function step(dt) {
  /* host_timescale из консоли: масштабируем шаг физики (1 = норма) */
  if (typeof CON !== 'undefined' && CON.vars.timescale !== 1) dt *= CON.vars.timescale || 1;
  /* «Твой лай... стал ступенькой.» — только когда лай реально стал ступенькой:
     Ангел стоит на живой (не ложной) эхо-платформе. Один раз за уровень. */
  if (Game.L && Game.L.mech && Game.L.mech.foxBark && Game.state && Game.state.echo && !Game.state.echoStepSaid) {
    const a = Game.state.angel;
    const feetY = a.y + a.h;
    for (const p of Game.state.echo.list) {
      if (p.fake || !(p.alive > 0)) continue;
      const px = p.tx * CFG.TILE, py = p.ty * CFG.TILE;
      const onTop = Math.abs(feetY - py) < 3 && a.x + a.w > px && a.x < px + CFG.TILE;
      if (onTop && a.onGround) {
        Game.state.echoStepSaid = true;
        queueDialog([{ who: 'angel', face: 'angel_normal2', text: 'Твой лай... стал ступенькой.' }]);
        break;
      }
    }
  }
  /* чекпойнты: активируем, когда Ангел прошёл точку по X (не откатываем назад) */
  if (Game.L && Game.L.checkpoints && Game.state && Game.state.angel) {
    const ax = Game.state.angel.x / CFG.TILE;
    for (const cp of Game.L.checkpoints) {
      if (ax >= cp.x && (!Game.state.checkpoint || cp.x > Game.state.checkpoint.x)) {
        Game.state.checkpoint = cp;
        /* отклик сохранения: раньше чекпойнт срабатывал абсолютно молча —
           игрок узнавал о нём только после смерти. Однократность на точку
           даёт условие cp.x > checkpoint.x выше. */
        sfxCheckpoint();
        showHint('ЧЕКПОЙНТ', 1100);
        fxEchoPop(cp.tx * CFG.TILE + 8, cp.ty * CFG.TILE);
      }
    }
  }
  const st = Game.state, L = Game.L;
  if (!st || st.done && st.endingT <= 0) return;
  /* диалог печатается */
  if (st.dialog && !st.dialog.done) {
    st.dialog.t += dt;
    const cps = dialogCPS();
    const target = cps === Infinity ? st.dialog.text.length : Math.floor(st.dialog.t * cps);
    if (target > st.dialog.shown) {
      st.dialog.shown = Math.min(st.dialog.text.length, target);
      if (st.dialog.shown % 3 === 0 && cps !== Infinity) sfxDialog();
    }
    if (st.dialog.shown >= st.dialog.text.length) st.dialog.done = true;
  }
  /* action и jump листают диалог: первое нажатие допечатывает фразу, второе — дальше.
     Это работает и поверх сцены-картинки. */
  if (INPUT.actionPressed) {
    INPUT.actionPressed = false;
    if (!advanceDialog() && st.done && st.won) { /* финал — main.js обработает */ }
  }
  if (st.dialog && INPUT.jumpPressed) {
    INPUT.jumpPressed = false;
    advanceDialog();
    if (!st.dialog) st.angel.jumpBuf = CFG.JUMP_BUFFER;
  }
  /* сцена-картинка: кадр держится, пока идёт диалог — реплики печатаются
     поверх картинки (портреты в этот момент скрыты, см. CSS .over-scene).
     Мир стоит; когда диалог закончился, кадр уходит по нажатию или сам. */
  if (st.sceneImg) {
    /* Таймеры сцены — на игровом клоке, а не на performance.now():
       иначе пауза их не останавливает и кадр «доживает» своё время,
       пока игра стоит, — сцена закрывается без игрока. */
    st.sceneClock = (st.sceneClock || 0) + dt;
    const held = st.sceneClock < 1.0;
    const dialogueDone = !st.dialog && !st.dialogQueue.length;
    if (!held && dialogueDone) {
      if (!st.sceneDoneAt) st.sceneDoneAt = st.sceneClock;
      const pressed = INPUT.actionPressed || INPUT.jumpPressed || INPUT.leftPressed || INPUT.rightPressed;
      if (pressed || st.sceneClock - st.sceneDoneAt > 2.6) {
        INPUT.actionPressed = false; INPUT.jumpPressed = false;
        INPUT.leftPressed = false; INPUT.rightPressed = false;
        st.sceneDoneAt = 0;
        closeSceneImage();
      }
    } else {
      st.sceneDoneAt = 0;
    }
    fxUpdate(dt);
    updateCamera(false);
    return;
  }
  st.t += dt;
  /* Мир заморожен на время реплики — таймеры механик тоже стоят
     (иначе portalCd/memoryPortalCd истекают за время диалога и переход
     срабатывает сразу после закрытия, без ввода игрока). */
  if (!st.dialog) {
  st.shoutCd = Math.max(0, st.shoutCd - dt);
  st.invuln = Math.max(0, st.invuln - dt);
  st.gravFlipCd = Math.max(0, st.gravFlipCd - dt);
  st.portalCd = Math.max(0, st.portalCd - dt);
  st.twinCd = Math.max(0, st.twinCd - dt);
  st.memoryPortalCd = Math.max(0, st.memoryPortalCd - dt);
  st.colorWave = Math.max(0, st.colorWave - dt);
  if (st.doorShakeT > 0) st.doorShakeT = Math.max(0, st.doorShakeT - dt);
  /* серое дерево: тикаем кулдаун, чтобы касание снова дало волну (док. ур.2, п.1) */
  if (L.decor) for (const d of L.decor) {
    if (d._cd > 0) {
      d._cd -= dt;
      if (d._cd <= 0) { d._cd = 0; d._touched = false; }
    }
  }
  if (st.foxHideT > 0 && !st.dialog) st.foxHideT = Math.max(0, st.foxHideT - dt);
  if (st.rhythmAll > 0 && !st.dialog) st.rhythmAll = Math.max(0, st.rhythmAll - dt);
  /* зацикливание РАДОСТИ: по истечении joyT Ангел возвращается к входу зоны */
  /* рывок хвоста у двери — один раз при первом подходе */
  if (L.mech.memoryHub && st.doorTailJerk > 0) st.doorTailJerk = Math.max(0, st.doorTailJerk - dt);
  if (L.mech.memoryHub && !st.doorTailSeen) {
    const door = L.decor.find(d => d.kind === 'door');
    if (door && st.angel && Math.abs(st.angel.x - door.tx * CFG.TILE) < 4 * CFG.TILE) {
      st.doorTailSeen = true;
      st.doorTailJerk = 0.4;
    }
  }
  /* «Не смотри назад» (док. ур.9, п.5): первый разворот на поздней части уровня показывает тень-Лиса 1.2 с */
  if (L.mech.visionCone && st.angel) {
    if (st.lookBackT > 0) st.lookBackT = Math.max(0, st.lookBackT - dt);
    if (!st.lookBackSeen && st.angel.facing === -1 && st.angel.x > 118 * CFG.TILE) {
      st.lookBackSeen = true;
      st.lookBackT = 1.2;
      queueDialog([{ who: 'angel', face: 'angel_fear', text: 'Там кто-то...' }]);
    }
  }
  if (st.joyT > 0) {
    st.joyT = Math.max(0, st.joyT - dt);
    if (st.joyT === 0 && L.mech.memoryHub) {
      const ang = st.angel;   /* a здесь ещё не объявлена — берём из состояния */
      /* Возврат «к входу» = на стартовую площадку хаба, а НЕ на тайл портала
         (tx=5). Портал стоит ровно там: Ангел попадал на него, и после
         истечения memoryPortalCd портал снова уносил в РАДОСТЬ — бесконечный
         цикл без участия игрока (проба: 3 входа за 75 с, уйти было нельзя).
         Плюс держим портал на кулдауне, чтобы случайное перекрытие в одном
         кадре тоже не склеило два перехода. */
      ang.x = L.start.tx * CFG.TILE; ang.y = L.start.ty * CFG.TILE;
      ang.vx = 0; ang.vy = 0;
      st.memoryPortalCd = 0.9;
      queueDialog([{ who: 'angel', face: 'angel_fear', text: 'Ты всё ещё идёшь?' }]);
      fxFlash(0.5, '#c7b8e8');
    }
  }
  /* визуальная гравитация догоняет физику с задержкой (сломанная зона) */
  if (st.angel) {
    if (st.viewGravT > 0) st.viewGravT = Math.max(0, st.viewGravT - dt);
    if (st.viewGravT <= 0 && st.viewGrav !== st.angel.grav) st.viewGrav = st.angel.grav;
  }
  if (st.rhythmShiftT > 0) { st.rhythmShiftT -= dt; if (st.rhythmShiftT <= 0) { st.rhythmShiftT = 0; st.rhythmShift = 0; } }
  if (st.aidFlashT > 0) st.aidFlashT = Math.max(0, st.aidFlashT - dt);
  if (st.colorHold > 0) {
    st.colorHold = Math.max(0, st.colorHold - dt);
    if (st.colorHold === 0) queueDialog([{ who: 'angel', face: 'angel_fear', text: 'Мы опоздали.' }]);
  }
  if (st.darkT > 0) { st.darkT -= dt; st.darkness = st.darkT > 0.6 ? 1 : st.darkT / 0.6; if (st.darkT <= 0) { st.darkT = 0; st.darkness = 0; } }
  }   /* конец if (!st.dialog) — таймеры механик */

  /* смерть -> респавн. ОБРАБАТЫВАЕМ ДО ДИАЛОГА: иначе реплика, выданная в
     кадр гибели, замораживает таймер смерти и респавн не наступает, пока
     игрок не пролистает текст. */
  if (st.dying > 0) {
    st.dying -= dt;
    if (st.dying <= 0) respawn();
    fxUpdate(dt);
    updateCamera(false);
    return;
  }

  /* ── ДИАЛОГ ОСТАНАВЛИВАЕТ ИГРУ ──
     Пока реплика на экране, мир не обновляется и управление не проходит:
     Ангел не идёт, тени/двойник/босс замирают, таймеры механик стоят.
     Автопролистывания нет — игрок сам решает, когда продолжить. */
  if (st.dialog) {
    INPUT.jumpPressed = false;
    INPUT.leftPressed = false; INPUT.rightPressed = false; INPUT.actionPressed = false;
    /* Музыка ИГРАЕТ во время диалогов (жалоба: «в диалогах не играет»).
       Мир заморожен, трек продолжается; таймер фазы после диалога сам
       подтянется к позиции трека (updateBoss, musicClock). */
    fxUpdate(dt);          // частицы и тряска продолжают жить — картинка не «мертвеет»
    updateCamera(false);
    /* st.t стоит вместе с миром (строка st.t += dt — внутри if(!st.dialog)),
       поэтому эхо-двойник не получает скачка времени и не «возвращается»
       на до-диалоговую позицию. Буфер всё равно сбрасываем — как при
       телепорте через портал: после реплики двойник заново «вооружается»
       через twinDelay секунд честной игры, без риска мгновенной смерти
       от aabb в кадре закрытия диалога. */
    if (st.twin && st.twin.buf.length) { st.twin.buf.length = 0; st.twin.ready = false; }
    return;
  }
  if (st.done && st.won && (L.mech.boss || L.mech.cinematic) && !st.endingShown) {
    st.endingShown = true;
    /* 10-й уровень больше не финал: после боя босса идёт 11-я сцена-монолог,
       и уже она (mech.cinematic) отдаёт игрока на финальный экран. */
    if (L.mech.cinematic) { if (Game.onGameDone) Game.onGameDone(); }
    else if (Game.onLevelDone) Game.onLevelDone(L.idx, st);
    return;
  }

  const a = st.angel;

  /* ── модификаторы от зон ──
     Каждая ветка гейтится своим mech-флагом: без этого любой b.zones.push
     в новом уровне молча включал бы механику (slow/fast/invert/gravity),
     даже если флаг не выставлен. */
  const mods = {};
  /* мягкая помощь: после серии смертей прыжок с края прощает чуть больше */
  if (st.deaths >= CFG.AID_COYOTE_DEATHS && CFG.AID_COYOTE_BONUS > 0) {
    mods.coyoteBonus = CFG.AID_COYOTE_BONUS;
  }
  const z = zoneAt(L, a);
  if (z) {
    if (z.kind === 'slow' && L.mech.timeZones) mods.speedMul = L.mech.slowMul || 0.45;
    else if (z.kind === 'fast' && L.mech.timeZones) mods.speedMul = L.mech.fastMul || 1.7;
    else if (z.kind === 'invert' && L.mech.invertZones) mods.invertControls = true;
    else if ((z.kind === 'anchor' || z.kind === 'flip') && L.mech.gravityZones && st.gravityZone !== z
             && flipIsSafe(L, a, z.kind === 'anchor' ? 1 : -1)) {
      a.grav = z.kind === 'anchor' ? 1 : -1;
      /* сломанная зона: визуал переворачивается с задержкой 1 с (док. ур.6, п.3) */
      if (z.broken) st.viewGravT = 1.0;
      a.vy = 0;
      st.gravityZone = z;
      fxRiftBurst(a.x + a.w / 2, a.y + a.h / 2, a.grav);
    }
  }
  if (!z || (z.kind !== 'anchor' && z.kind !== 'flip')) st.gravityZone = null;
  /* Зеркальный портал L4 больше НЕ инвертирует управление: вместо этого
     drawFrameAll() переворачивает сам вид (камеру) при st.reflected —
     «отражение» читается визуально, а кнопки остаются привычными. */

  /* ── разлом: переворот гравитации ──
     Пока кульминация тратит бюджет, разломы в её зоне молчат (иначе спорят друг
     с другом рывками по 0.2 с). Когда хаос отбушевал — разлом снова работает. */
  /* у самого разлома хаос молчит: там работает обычный разлом — один переворот,
     как на всех остальных (иначе на 3-м разломе шла череда переворотов). */
  const nearRift = L.rifts && L.rifts.some(rf =>
    Math.abs(a.x + a.w / 2 - (rf.tx + 0.5) * CFG.TILE) <= CFG.TILE * 1.5);
  const inChaosX = L.mech.gravChaos &&
    a.x >= (L.mech.gravChaosFrom || 0) && a.x <= (L.mech.gravChaosTo || 1e9);
  const inChaos = inChaosX && !nearRift;
  const chaosFiring = inChaos && st.gravChaosLeft > 0;
  if (L.mech.rifts && st.gravFlipCd <= 0 && !chaosFiring) {
    const rf = riftAt(L, a);
    /* ТЗ: разлом перемещает Ангела только ОДИН раз. Повторный заход в зону
       (гравитацию вернули хаос или осколок) больше не переворачивает гравитацию. */
    const rfKey = rf ? (rf.tx + ',' + rf.ty) : null;
    if (rf && rfKey && !st.usedRifts.has(rfKey) &&
        a.grav !== rf.dir && flipIsSafe(L, a, rf.dir)) {
      st.usedRifts.add(rfKey);
      a.grav = rf.dir;
      a.vy = 0;
      st.gravFlipCd = 0.65;
      fxRiftBurst(a.x + a.w / 2, a.y + a.h / 2, rf.dir);
      sfxRift();
    }
  }
  /* кульминация L6 (док. ур.6, п.7): «гравитация мечется» — но БЮДЖЕТОМ, и после
     неё гравитация возвращается вниз (док.: Лис «Сейчас.»). Ушёл с участка —
     кульминация взводится заново, механика не «умирает» навсегда. */
  if (inChaosX) {
    if (st.gravChaosLeft == null) st.gravChaosLeft = L.mech.gravChaosFlips == null ? 4 : L.mech.gravChaosFlips;
    /* У разлома (nearRift) хаос молчит, но бюджет НЕ перезаряжается.
       Раньше «выключение» inChaos через nearRift обнуляло gravChaosLeft,
       и у КАЖДОГО разлома внутри зоны 108–136 Ангел получал свежие
       4 мечения: вместо «бюджет конечен» выходило 12+ переворотов,
       и гравитация не возвращалась вниз до самого конца участка.
       Сброс бюджета — только при реальном выходе за X-границы зоны
       (else ниже) или при смерти (respawn). */
    if (st.gravChaosLeft > 0 && !nearRift) {
      st.gravChaosT = (st.gravChaosT || 0) - dt;
      if (st.gravChaosT <= 0 && st.gravFlipCd <= 0) {
        if (flipIsSafe(L, a, -a.grav)) {
          a.grav = -a.grav; a.vy = 0;
          st.gravChaosLeft--;
          st.gravChaosT = 0.9;
          st.gravFlipCd = 0.65;   /* общий кулдаун с разломами/зоной/осколком */
          fxRiftBurst(a.x + a.w / 2, a.y + a.h / 2, a.grav);
          sfxRift();
        } else {
          st.gravChaosT = 0.2;   /* небезопасно — повторим попытку, бюджет не тратим */
        }
      }
    } else if (st.gravChaosLeft === 0 && a.grav < 0 && st.gravFlipCd <= 0 && flipIsSafe(L, a, 1)) {
      /* хаос отбушевал — гравитация возвращается вниз (как в док.).
         Кулдаун ОБЩИЙ: без него осколок/разлом, перевернувший кадром раньше,
         тут же получал второй переворот (зазор 0.017 с вместо 0.65 с — рывок). */
      a.grav = 1; a.vy = 0;
      st.gravFlipCd = 0.65;
      st.gravChaosLeft = -1;   /* итог зафиксирован: больше в гравитацию не вмешиваемся */
      fxRiftBurst(a.x + a.w / 2, a.y + a.h / 2, a.grav);
      sfxRift();
    }
  } else st.gravChaosLeft = null;   /* вне участка — кульминация взводится заново */

  /* ── ввод: прыжок ── */
  const inp = {
    left: INPUT.left, right: INPUT.right,
    jumpHeld: INPUT.jumpHeld, jumpPressed: INPUT.jumpPressed,
  };
  INPUT.jumpPressed = false;
  INPUT.leftPressed = false; INPUT.rightPressed = false;

  const wasGround = a.onGround;
  const prevVy = a.vy;

  /* hidden-набор: блоки памяти, которых игрок ещё «не знает», остаются твердыми
     (по дизайну они физически есть, просто не видны) — поэтому hidden пуст. */
  /* клетки отражения (ур.4): '=' только когда reflected, иначе пусто */
  if (L.reflectTiles && L.reflectTiles.length) {
    const want = st.reflected ? '=' : '.';
    for (const rt of L.reflectTiles) {
      if (tileAt(L.map, rt.tx, rt.ty) !== want) setTile(L.map, rt.tx, rt.ty, want);
    }
  }
  /* noclip: консольный полёт мимо физики (res в этом месте не читается) */
  const res = (typeof conNoclipStep === 'function' && conVarOn('noclip'))
    ? conNoclipStep(a, dt)
    : updateAngel(L.map, a, inp, dt, null, mods);

  if (L.mech.memoryHub && st.memoryPortalCd <= 0) {
    const p = (L.portals || []).find(p => !st.keys.includes(
      ({24:'РАДОСТЬ',38:'СТРАХ',87:'ОДИНОЧЕСТВО',108:'ДОМ'})[p.destTx]) &&
      aabb(actorRect(a), { x:p.tx * CFG.TILE, y:p.ty * CFG.TILE,
        w:CFG.TILE, h:CFG.TILE * 2 }));
    if (p) {
      a.x = p.destTx * CFG.TILE;
      a.y = 14 * CFG.TILE - a.h;
      a.vx = 0; a.vy = 0;
      st.memoryPortalCd = 0.9;
      fxFlash(0.5, '#c7b8e8');
      /* Помечаем зону как посещённую — при возврате сюда ключ можно будет собрать */
      st[`zone_${p.destTx}_visited`] = true;
      /* СТРАХ (док. ур.8, п.3): колодцы гаснут — радиус видимости с каждым входом меньше */
      /* РАДОСТЬ (док. ур.8, п.2): зона зацикливается — через 30 с возврат к входу */
      if (p.destTx === 24) st.joyT = 30;   /* РАДОСТЬ: вход — портал с destTx 24 (см. словарь выше и keyToDestTx) */
      if (p.destTx === 38) st.memRadiusNow = Math.max(16, (st.memRadiusNow || L.mech.memRadius || 44) - 6);   /* СТРАХ: портал destTx 38 */
    }
  }

  /* L4: невидимый триггер в самой воде 'v' (видимый тайл — обрыв);
     попадание в такую воду = переход в зазеркалье за обрыв.
     Кулдаун здесь ВРЕМЕННОЙ быть не может: между выходом на сушу 77–78 и
     следующим обрывом 79–84 всего 2 тайла (≈0,25 с хода), а прежние 1,5 с
     не давали сработать второму переходу — Ангел падал в пустоту и умирал
     (проба: выход на 78 в t=0,32, смерть в t=1,02 при остатке portalCd 0,80).
     Вместо времени — защёлка по обрыву: пока Ангел в воде, повторно из того
     же обрыва не переходим; как только он вне воды (вышел на твёрдое) —
     защёлка снята, и любой обрыв снова доступен. Дребезг не возвращается:
     стоя/падая в воде, повторного срабатывания нет. */
  if (L.idx === 3) {
    const fx = Math.floor((a.x + a.w / 2) / CFG.TILE);
    const fy = Math.floor((a.y + a.h - 1) / CFG.TILE);
    const inWater = !!(L.map.grid[fy] && L.map.grid[fy][fx] === 'v');
    // назначение: какой обрыв, туда и выйти (35–40 → 42, 71–76 → 78, 79–84 → 85)
    const pitOf = (col) =>
      (col >= 35 && col <= 40) ? 42 :
      (col >= 71 && col <= 76) ? 78 :
      (col >= 79 && col <= 84) ? 85 : 0;
    /* Страховка от «пролёта» воды за один кадр (быстрое падение): если Ангел
       уже ниже карты, но по колонке это обрыв — это провал, а не смерть.
       Проба: падение ботом давало 'fall' ровно в колонке 40, минуя проверку
       тайла (Ангел успевал уйти ниже сетки за один шаг). */
    const belowMap = (a.y + a.h) > L.map.grid.length * CFG.TILE;
    const pitDest = inWater ? pitOf(fx) : (belowMap ? pitOf(fx) : 0);
    if (!inWater) st.pitLock = 0;              /* Ангел вне воды — защёлка снята */
    if (pitDest && st.pitLock !== pitDest) {   /* в воде и это не тот же обрыв */
      const destTx = pitDest;
      a.x = destTx * CFG.TILE;
      a.y = Math.min(a.y, 14 * CFG.TILE - a.h);
      a.vx = 0; a.vy = 0;
      st.reflected = !st.reflected;
      st.pitLock = destTx;                     /* держим, пока Ангел в воде */
      st.portalCd = 1.5;                       /* для mirrorPortals-блока ниже */
      /* Вход в ПЕРВОЕ зазеркалье (42) — без отгула: коридор 42–78 короткий,
         двойник должен проявиться сразу (жалоба «в первый раз не появляется»).
         Вход во ВТОРОЕ (85) и выход (78) — с отгулом: без него двойник
         материализуется ровно на площадке, где игрок ещё стоит (проба:
         смерть 'twin' на 78 и 85). */
      st.twinCd = st.twin
        ? (st.reflected && destTx === 42 ? 0 : st.twin.delay + 0.65)
        : 0;
      if (st.twin) { st.twin.buf.length = 0; st.twin.ready = false; }
      fxFlash(0.8, '#ffffff');
      sfxRift();
      queueDialog([{ who: 'angel', face: 'angel_fear', text: st.reflected ?
        'Мы по другую сторону отражения.' : 'Мы вернулись... кажется.' }]);
    }
  }
  if (L.mech.mirrorPortals && st.portalCd <= 0) {
    const p = (L.portals || []).find(p => aabb(actorRect(a), {
      x: p.tx * CFG.TILE, y: p.ty * CFG.TILE - CFG.TILE,
      w: CFG.TILE * 2, h: CFG.TILE * 2,
    }));
    if (p) {
      a.x = p.destTx * CFG.TILE;
      a.y = Math.min(a.y, 14 * CFG.TILE - a.h);
      a.vx = 0; a.vy = 0;
      st.reflected = !st.reflected;
      st.portalCd = 1.5;
      /* та же логика, что и у обрывов 'v': вход — без отгула, выход — с отгулом */
      st.twinCd = st.twin ? (st.reflected ? 0 : st.twin.delay + 0.65) : 0;
      if (st.twin) { st.twin.buf.length = 0; st.twin.ready = false; }
      fxFlash(0.8, '#ffffff');
      sfxRift();
      queueDialog([{ who: 'angel', face: 'angel_fear', text: st.reflected ?
        'Мы по другую сторону отражения.' : 'Мы вернулись... кажется.' }]);
    }
  }

  /* секреты (док. ур.7, п.1): касание открывает скрытую нишу — реплика и звук.
     Фрагмент не выдаётся: FRAGMENT_ORDER фиксирован (4 имени), секрет в него не входит. */
  for (const sec of (L.secrets || [])) {
    if (sec.found || sec.fake) continue;   /* ложный секрет — радар врёт, касание пустое */
    /* хитбокс в 2 тайла: секрет на уровне головы Ангела (как у фрагмента) */
    if (aabb(actorRect(a), { x: sec.tx * CFG.TILE, y: sec.ty * CFG.TILE, w: CFG.TILE, h: CFG.TILE * 2 })) {
      sec.found = true;
      fxFlash(0.3, '#b8eff0');
      sfxFlower();
      queueDialog([{ who: 'angel', face: 'angel_hello', text: 'Здесь что-то было...' }]);
    }
  }
  for (const f of (L.fragments || [])) {
    if (f.taken) continue;
    if (aabb(actorRect(a), { x: f.tx * CFG.TILE, y: f.ty * CFG.TILE,
      w: CFG.TILE, h: CFG.TILE * 2 })) {
      f.taken = true;
      st.fragments.push(f.name);
      if (typeof collectFragment === 'function') collectFragment(f.name);
      st.colorWave = f.name === 'ПЕРСОНАЖИ' ? 3.0 : 1.3;
      /* ПЕРСОНАЖИ (док. ур.4, п.3): мгновенный полный цвет на 3.5 с, потом резкий возврат */
      if (f.name === 'ПЕРСОНАЖИ') st.colorHold = 3.5;
      fxFlash(0.45, '#e9ffb8');
      sfxFlower();
      queueDialog([{ who: 'angel', face: 'angel_hello', text: `Фрагмент света: ${f.name}.` }]);
    }
  }

  if (L.mech.rhythm) {
    const period = L.mech.beatPeriod || 0.72;
    /* стоит ли Ангел на тайле (tx, ty): его нижняя грань касается верха тайла */
    const standsOn = (tx, ty) => a.onGround && Math.floor((a.x + a.w / 2) / CFG.TILE) === tx && Math.floor((a.y + a.h + 1) / CFG.TILE) === ty;
    /* запаздывание/опережение (док. ур.5, п.4): сдвиг фазы такта на rhythmShift сек */
    const beat = Math.floor((st.t + (st.rhythmShift || 0)) / period);
    if (beat !== st.rhythmBeat) {
      st.rhythmBeat = beat;
      if (!L.mech.muffled) sfxBeat(beat % 4 === 0, L.mech.beatGainMul);
    }
    for (const p of (L.rhythm || [])) {
      /* кульминация БАХ (док. ур.5, п.2): все точки горят, пока st.rhythmAll > 0 */
      /* ложь ритма (док. ур.5, п.3): точка-«ложь» никогда не становится платформой,
         звук такта при этом играется (см. sfxBeat выше). */
      /* «Сердце» (док. ур.5): strong-точка появляется только на сильном ударе (каждый 4-й) */
      /* п.3: в кульминации strong-правило не действует — все точки горят вместе */
      const strongOk = st.rhythmAll > 0 || !p.strong || beat % 4 === 0;
      const inWindow = strongOk && (st.rhythmAll > 0 || beat % 4 === (p.group - 1) % 4 || beat % 4 === p.group % 4);
      /* ВИД точки для рендера: «ложь ритма» рисуется как обычная платформа
         (иначе в оранжевой зоне на месте платформы зияет пустота — читается
         как поломка карты). Твердь от этого не зависит: active ниже. */
      const ch = tileAt(L.map, p.tx, p.ty);
      /* Тайл под стоящим Ангелом не убирается (п.6) — значит он остаётся
         опорой, и гаснуть визуально не должен: игрок стоял на невидимом. */
      p.lit = inWindow || (ch === '=' && standsOn(p.tx, p.ty));
      const active = !p.liar && inWindow;
      if (active && ch !== '=') setTile(L.map, p.tx, p.ty, '=');
      /* п.6: не убираем платформу, если на ней стоит Ангел — иначе падение без причины */
      else if (!active && ch === '=' && !standsOn(p.tx, p.ty)) setTile(L.map, p.tx, p.ty, '.');
    }
  }

  if (inp.jumpPressed === false && !wasGround && a.onGround && Math.abs(prevVy) > 120) {
    fxLand(a.x + a.w / 2, a.y + a.h, clamp(prevVy / 300, 0.4, 1.6));
    sfxLand();
    /* «визуальные звуки» (док. ур.7, п.3): на L7 звук заглушён — приземление
       показываем расходящимся кругом воздуха, чтобы мир не казался мёртвым */
    if (L.mech.visualPulse) fxEchoPop(a.x + a.w / 2, a.y + a.h);
  }
  if (!wasGround && a.onGround) {
    /* приземление */
  }
  if (wasGround && !a.onGround && a.vy * (a.grav || 1) < 0) {
    fxJump(a.x + a.w / 2, a.y + a.h);
    sfxJump();
    if (L.mech.visualPulse) fxEchoPop(a.x + a.w / 2, a.y + a.h);   /* круг воздуха: «визуальный звук» L7 */
    /* подсказка «← → SPACE» на первом уровне скрывается после первого прыжка */
    if (L.idx === 0 && !st.firstJumpDone) { st.firstJumpDone = true; showHint(''); }
  }

  /* шаги */
  if (a.onGround && Math.abs(a.vx) > 20) {
    st.stepT += Math.abs(a.vx) * dt;
    if (st.stepT > 22) { st.stepT = 0; sfxStep(Math.floor(st.t * 10)); fxDust(a.x + a.w / 2, a.y + a.h, sign(a.vx), 2); }
  }

  /* ── крик (ур.3) ── */
  if (INPUT.shoutPressed) {
    INPUT.shoutPressed = false;
    if (L.mech.shout && st.shoutCd <= 0) {
      st.shoutCd = 0.55;
      sfxShout();
      const voice = L.mech.foxBark && st.fox && !st.foxGone ? st.fox : a;
      fxShoutRing(voice.x + voice.w / 2, voice.y + voice.h / 2);
      if (st.echo) {
        /* Кнопка E просит Лиса лаять. Радиус центрируем между героями:
           инструмент принадлежит Лису, но остаётся управляемым и проходимым. */
        const sx = L.mech.foxBark ? (a.x + a.w / 2 + voice.x + voice.w / 2) / 2 : a.x + a.w / 2;
        const sy = L.mech.foxBark ? (a.y + a.h / 2 + voice.y + voice.h / 2) / 2 : a.y + a.h / 2;
        const n = shout(st.echo, sx, sy, L.mech.echoRadius || 108);
        /* невидимые тени в радиусе крика проявляются на 1.5 с */
        for (const sh of st.shadows) {
          if (!sh.hidden) continue;
          if (dist2(sx, sy, sh.x + sh.w / 2, sh.y + sh.h / 2) <= (L.mech.echoRadius || 108) ** 2) sh.revealT = 1.5;
        }
        if (n > 0) {
          sfxEchoAppear();
          for (const p of st.echo.list) {
            if (p.alive > 0) fxEchoPop(p.tx * CFG.TILE + 8, p.ty * CFG.TILE + 8);
          }
        }
      }
    } else {
      /* отказ вместо тишины: на уровнях без крика (и на кулдауне) клавиша
         раньше молчала — игрок решал, что управление сломано */
      sfxDenied();
    }
  }
  if (st.echo) tickEchoPlatforms(st.echo, L.map, dt);
  for (const sh of st.shadows) if (sh.revealT > 0) sh.revealT = Math.max(0, sh.revealT - dt);

  /* ── исчезающие блоки: наступил — взвели ── */
  if (st.crumbles.length) {
    const T = CFG.TILE;
    const footY = Math.floor((a.y + a.h + 1) / T);
    const x0 = Math.floor(a.x / T), x1 = Math.floor((a.x + a.w - 0.01) / T);
    for (let tx = x0; tx <= x1; tx++) {
      const key = tx + ',' + footY;
      const c = st.crumbleMap.get(key);
      if (c && c.phase === 'idle' && a.onGround) {
        armCrumble(st.crumbles, c.tx, c.ty, L.mech.crumbleDelay || 0.42, L.mech.crumbleRespawn || 2.4);
        sfxCrumble();
      }
    }
    const before = st.crumbles.filter(c => c.phase === 'armed').length;
    tickCrumble(st.crumbles, L.map, dt, [st.angel, st.fox]);
    for (const c of st.crumbles) {
      if (c.phase === 'gone' && c.t > (c.respawn - dt - 0.001)) {
        fxCrumbleBits(c.tx * CFG.TILE + 8, c.ty * CFG.TILE + 8);
      }
    }
  }

  /* ── блоки памяти: запоминаем увиденное ── */
  if (L.mech.memoryBlocks) {
    const acx = a.x + a.w / 2, acy = a.y + a.h / 2;
    for (const m of L.memory) {
      memoryVisible(st.memSeen, m.tx, m.ty, acx, acy, st.memRadiusNow || L.mech.memRadius || 44);
    }
  }
  /* ── сбор ключей (L8) ── */
  for (const k of L.keys || []) {
    if (k.taken) continue;
    const kr = { x: k.tx * CFG.TILE, y: k.ty * CFG.TILE, w: CFG.TILE, h: CFG.TILE };
    if (aabb(actorRect(a), kr)) {
      /* Уровень 8: ключ собирается только ПОСЛЕ посещения зоны воспоминания
         (при обратном возврате из портала), а не при первой телепортации туда */
      if (L.mech.memoryHub) {
        /* Маппинг: координата ключа → координата телепорта (destTx портала) */
        /* destTx берём из данных ключа (k.destTx); таблица — запасной путь
           для старых уровней. Нет соответствия — громко предупреждаем:
           иначе ключ молча становится неберущимся. */
        const keyToDestTx = {34: 24, 82: 38, 108: 87, 160: 108};
        const destTx = (k.destTx != null) ? k.destTx : keyToDestTx[k.tx];
        if (destTx == null) {
          console.warn('[L8] ключ без destTx: tx=' + k.tx);
          continue;
        }
        const zoneVisited = st[`zone_${destTx}_visited`];
        if (!zoneVisited) continue;  /* ещё не были в зоне — пропускаем сбор */
      }
      k.taken = true;
      st.keys.push(k.name);
      fxFlash(0.18, '#fff0a0');
      queueDialog([{ who: 'angel', face: 'angel_normal2', text: `Ключ: ${k.name}.` }]);
      if (L.mech.memoryHub) {
        const memories = {
          'ОДИНОЧЕСТВО': [
            { who: 'angel', face: 'angel_fear', text: 'Лис?' },
            { who: 'fox', face: 'fox_normal4', text: 'А ты кто? Я тебя не знаю.' },
          ],
          'ДОМ': [
            { who: 'angel', face: 'angel_normal', text: 'Здесь хорошо. Давай останемся?' },
            { who: 'fox', face: 'fox_cry', text: 'Нельзя.' },
          ],
        };
        queueDialog(memories[k.name] || []);
        a.x = L.start.tx * CFG.TILE;
        a.y = L.start.ty * CFG.TILE;
        a.vx = 0; a.vy = 0;
        st.memoryPortalCd = 0.9;
        /* ключ собран — зона воспоминания покинута: остаточный joyT иначе
           через N секунд рывком утащил бы игрока назад и выдал «Ты всё ещё
           идёшь?» уже в хабе (проба: рывок tx=12 → tx=5, а затем портал). */
        st.joyT = 0;
      }
    }
  }

  /* ── Лис ── */
  if (st.fox && !st.foxGone && !(st.foxHideT > 0)) {
    if (!st.foxActive && a.x >= (L.mech.foxWakeX || 0) * CFG.TILE) {
      st.foxActive = true;               // встретились — дальше идёт следом
    }
    /* пока не активен, целью считаем его же позицию: стоит на месте,
       но гравитация и коллизии продолжают работать */
    /* «Лис отстаёт» (док. ур.6, п.6): пока st.foxStuck — Лис стоит на месте, даже если игрок ушёл */
    const stuck = !!st.foxStuck;
    const tx = (st.foxActive && !stuck) ? a.x + a.w / 2 : st.fox.x + st.fox.w / 2;
    const ty = (st.foxActive && !stuck) ? a.y + a.h - st.fox.h : st.fox.y;   /* сравниваем ступни, не макушки */
    if (st.fox.grav !== st.angel.grav) { st.fox.grav = st.angel.grav; st.fox.vy = 0; }
    updateFox(L.map, st.fox, tx, ty, dt, null);
  }

  /* ── ложный Лис и «два голоса» (док. ур.9): пока Ангел в коридоре лжи,
       впереди держится бледный силуэт Лиса, который говорит противоположное
       настоящему Лису за спиной. Игра не даёт правил отличия — игрок выбирает. */
  if (L.mech.falseFox && st.angel) {
    const a2 = st.angel, T = CFG.TILE;
    const inZone = a2.x >= (L.mech.falseFoxFrom || 0) && a2.x <= (L.mech.falseFoxTo || 1e9);
    if (inZone) {
      /* силуэт держится на 3 тайла впереди по ходу */
      st.falseFox = { x: a2.x + a2.facing * T * 3, y: a2.y, shown: (st.falseFox && st.falseFox.shown) || 0 };
    } else {
      st.falseFox = null;
    }
  }

  /* ── элитная тень-копия Лиса (ур.9, п.2): повторяет позицию Лиса с задержкой.
       Только визуал — не убивает (смерть пока не вводится, чтобы не было
       непредсказуемой гибели). */
  if (L.mech.visionCone && st.fox && st.foxEcho) {
    pushEcho(st.foxEcho, st.t, st.fox);
    sampleEcho(st.foxEcho, st.t);
  }
  /* элитная тень-копия Ангела (док. ур.9, п.5): ведём буфер её позиций */
  if (L.mech.eliteAngel && st.angelEcho) {
    pushEcho(st.angelEcho, st.t, st.angel);
    sampleEcho(st.angelEcho, st.t);
  }

  /* ── зеркальный двойник ── */
  const twinInNormal = L.mech.twinNormalFrom != null && a.x >= L.mech.twinNormalFrom && a.x <= L.mech.twinNormalTo;
  /* Зона двойника: в отражении — twinFromX..twinReflectTo (первое зазеркалье,
     там он и появляется впервые), в норме — twinNormalFrom..To. */

  const twinZone = L.mech.twinNormalFrom == null ? true
    : st.reflected
      ? a.x <= (L.mech.twinReflectTo == null ? Infinity : L.mech.twinReflectTo)
      : twinInNormal;
  /* st.twinCd — «двойник потерял след» после перехода (см. блоки порталов 'v'
     и mirrorPortals): иначе он через twinDelay бьёт ровно в точке выхода, где
     ещё стоит игрок (проба: смерть 'twin' на 78 через 1,15 с, смертей 1/1). */
  const twinActive = !!(st.twin && st.twinCd <= 0 && twinZone
                        && a.x >= (L.mech.twinFromX || 0));
  /* Выход из зоны двойника: буфер замирает со старыми отметками st.t, и при
     повторном входе sampleEcho получает время, ушедшее на секунды вперёд —
     двойник телепортируется в игрока и убивает. Сбрасываем буфер так же,
     как при смерти и при закрытии диалога. */
  if (st.twin && !twinActive && st.twin.buf.length) { st.twin.buf.length = 0; st.twin.ready = false; }
  if (twinActive) {
    pushEcho(st.twin, st.t, a);
    sampleEcho(st.twin, st.t);
    if (st.twin.ready && st.invuln <= 0) {
      if (aabb({ x: a.x + 3, y: a.y + 4, w: a.w - 6, h: a.h - 6 },
               { x: st.twin.x + 3, y: st.twin.y + 4, w: st.twin.w - 6, h: st.twin.h - 6 })) {
        killAngel('twin');
      }
    }
  }

  /* ── тени ── */
  const playerMoving = Math.abs(a.vx) > 12 || Math.abs(a.vy) > 40;
  for (const s of st.shadows) {
    if (s.dead) continue;   /* мёртвая тень ждёт respawn() на месте */
    if (s.reflectOnly && !st.reflected) continue;
    /* Враги НЕ переворачиваются вместе с Ангелом (решение автора, 27.10):
       при разломах, зонах и хаосе L6 тени остаются на своём полу с grav=1.
       Раньше тени синхронизировались с гравитацией игрока — по потолку
       они становились либо безвредными, либо несправедливыми. Лис — не
       враг: он переворачивается вместе с Ангелом (см. блок Лиса выше). */
    const baseMul = s.speedMul;
    if (L.mech.lightWells) {
      s.speedMul = baseMul * (inLightWell(L, s) ? (L.mech.shadowLightMul || 0.3) : (L.mech.shadowDarkMul || 1.6));
    }
    updateShadow(L.map, s, a, dt, null, L.mech.shadowsFreeze ? playerMoving : true);
    s.speedMul = baseMul;
    /* Тень, выпавшая за нижнюю границу карты, уже не вернётся: без этого она
       вечно падает в пустоте (L3: chase-тень стартовала над ямой на 146,13 —
       проба показала y=87 тайла при высоте карты 17 и vy на терминальной).
       Помечаем здесь и вычищаем после цикла: мутировать массив в for..of нельзя. */
    if (s.y > L.map.grid.length * CFG.TILE + CFG.TILE * 2) s.dead = true;
    /* Осколок (док. ур.6, п.5): касание меняет гравитацию игрока, а не убивает */
    /* «слепой слух» (док. ур.7, п.2): тень за стеной — Лис реагирует жестом, без текста-подсказки */
    if (s.blind && !s.blindSeen && Math.abs((s.x + s.w / 2) - (a.x + a.w / 2)) < 4 * CFG.TILE) {
      s.blindSeen = true;
      queueDialog([{ who: 'fox', face: 'fox_normal4', text: '👂' }]);
    }
    if (s.shard) {
      if (st.gravFlipCd <= 0 && hitsAngel(a, s)) {
        a.grav = -a.grav; a.vy = 0;
        st.gravFlipCd = 0.65;
        fxRiftBurst(a.x + a.w / 2, a.y + a.h / 2, a.grav);
        if (st.viewGravT != null) st.viewGravT = 0;
      }
      continue;
    }
    if (st.invuln <= 0 && hitsAngel(a, s)) killAngel('shadow');
  }
  /* НЕ вычищаем мёртвых из массива: индексы st.shadows обязаны совпадать с
     L.shadows, иначе respawn() переставит выжившую тень на чужой стартовый
     тайл, а хвост списка не вернётся вовсе (число теней уменьшалось навсегда). */
  for (const s of st.shadows) if (s.dead) { s.x = -1e5; s.y = -1e5; s.vx = 0; s.vy = 0; }

  /* ── босс ── */
  if (st.boss) {
    const b = st.boss;
    if (!b.onPhase) bossWirePhases(st);    /* фазы босса ↔ секции музыки */
    const arenaGroundY = 15 * CFG.TILE;
    if (b.hp > 0) {
      /* Пол арены: в level10() b.ground(0,33,GY) при GY=15, значит
         поверхность на 15*TILE. Держим в переменной, чтобы не дублировать. */
      updateBoss(b, dt, a.x + a.w / 2 - st.camX, arenaGroundY);
      /* Руки Стража бьют по земле; трещины двери (их число = mech.bossHp, L10 — 5) открывают путь.
         ВАЖНО: проверяем и 'slam', и 'ground'. Рука за один кадр проходит
         шаг TILE*88*dt (~47px) и в кадре, где y пробивает restY, сразу
         переводится в state='ground' (engine.updateBoss). Поэтому окно
         'slam' И y >= arenaGroundY - TILE*3.5 (порог 368 при restY 384)
         может быть ПРОПУЩЕНО: рука прыгает y=342 -> 384 мимо окна.
         Раньше dust/урон не срабатывали НИКОГДА — босс был непроходим
         (проверено пробой: doorHits=0 за 40с). Ловим 'ground' — он живёт
         0.7с и заведомо ниже порога. */
      for (const h of b.hands) {
        if ((h.state === 'slam' || h.state === 'ground') &&
            h.y >= arenaGroundY - CFG.TILE * 3.5 && !h._dust) {
          h._dust = true;
          fxSlamDust(h.x, arenaGroundY);
          sfxBossSlam();
          const doorX = 16.5 * CFG.TILE - st.camX;
          if (Math.abs(h.x - doorX) < CFG.TILE * 2.6) {
            st.doorHits++;
            st.bossDmg++;
            /* Трещина = урон Стражу (док. ур.10, п.2: Страж неуязвим, «снять
               здоровье» можно только заставив его бить по двери). hp и doorHits
               — одно и то же число: hp = maxHp − трещины. */
            b.hp = Math.max(0, b.maxHp - st.bossDmg);
            /* док. ур.10: победа — «встать между Стражем и дверью, рука бьёт по двери».
               Рука, врезавшаяся в дверь, не убивает: иначе стоять у двери невозможно
               и бой непроходим (проверено: 54 смерти, doorHits=0). */
            h._safe = true;
            st.doorShakeT = 0.25;
            fxFlash(0.25, '#ffffff');
            if (st.doorHits === 1) queueDialog([
              { who: 'angel', face: 'angel_fear', text: 'Он разбивает дверь своими руками.' },
              { who: 'fox', face: 'fox_normal4', text: 'Ангел, назад!' },
            ]);
            if (st.doorHits === 2) queueDialog([
              { who: 'angel', face: 'angel_fear', text: 'Ещё одна трещина...' },
              { who: 'fox', face: 'fox_cry', text: 'Он знает, что там.' },
            ]);
            if (b.hp <= 0) {
              b.phase = 'dying';
              st.bossDeadT = 0.001;
              sfxBossDie();
            }
          }
        }
        /* Музыку двигают ФАЗЫ боя (см. bossWirePhases), а не трещины:
           атака = трек атаки, стан = трек стана. */
        if (h.state === 'up') { h._dust = false; h._safe = false; }
      }
      /* Помощь Лиса в бою (док. ур.10): подсказывает момент — «Стой.», когда
         рука занесена, «Теперь.», когда ушла в пол. Через полосу подсказок,
         НЕ через диалог: диалог замораживает бой. */
      if (b.hp > 0 && st.fox && !st.foxGone && st.foxCallT <= 0) {
        const aimed = b.hands.some(h => h.state === 'aim');
        const openFace = b.phase === 'open' && b.vulnerable;
        const say = aimed ? 'Лис: «Стой.»'
                  : (openFace ? 'Лис: «Теперь.»'
                  : (b.hands.some(h => h.state === 'ground') ? 'Лис: «Теперь.»' : null));
        if (say) { st.foxCallT = 2.6; showHint(say); }
      }
      if (st.foxCallT > 0) st.foxCallT -= dt;

      /* Фаза II Стража (док. ур.10): после 2-й трещины руки «переписывают»
         арену — на полу появляются новые опоры, путь к двери меняется. */
      if (st.doorHits >= 2 && !st.arenaPhase2) {
        st.arenaPhase2 = true;
        st.arenaPlates = [8, 12, 20, 28].filter(tx => tileAt(L.map, tx, 12) === '.');
        for (const tx of st.arenaPlates) setTile(L.map, tx, 12, '=');
        fxFlash(0.4, '#c8c8ff');
        queueDialog([{ who: 'angel', face: 'angel_fear', text: 'Пол меняется...' }]);
      }
      /* лицо и руки босса заданы в экранных координатах — приводим Ангела к ним */
      const aScreen = { x: a.x - st.camX, y: a.y - st.camY, w: a.w, h: a.h };
      if (b.hp > 0 && b.vulnerable && tryHitBoss(b, aScreen)) {
        fxFlash(0.3, '#ff6666');
        sfxBossHurt();
        /* Урон: -1 hp за удар в открытое лицо. Окно 'open' даёт ровно один удар
           (tryHitBoss снимает vulnerable), так что 5 hp не слетают за кадр.
           Первый удар дополнительно запускает «перелом» — разговор о том, чего
           он хочет. Смерть наступает и от ударов, и от трещин двери. */
        st.bossDmg++;
        b.hp = Math.max(0, b.maxHp - st.bossDmg);
        if (b.hp <= 0) {
          b.phase = 'dying';
          st.bossDeadT = 0.001;
          sfxBossDie();
        }
        if (!st.bossTalkSeen) {
          st.bossTalkSeen = true;
          queueDialog([
            { who: 'angel', face: 'angel_fear', text: 'Ты хочешь меня убить?' },
            { who: 'fox', face: 'fox_normal4', text: 'Нет.' },
            { who: 'angel', face: 'angel_normal', text: 'Тогда чего ты хочешь?' },
            { who: 'fox', face: 'fox_normal2', text: 'Чтобы ты вернулась.' },
            { who: 'angel', face: 'angel_normal2', text: 'Ты тоже это знаешь.' },
          ]);
        }
      }
      for (const hz of bossHazards(b)) {
        const worldHazard = { x: hz.x + st.camX, y: hz.y + st.camY,
          w: hz.w, h: hz.h };
        if (st.invuln <= 0 && aabb(actorRect(a), worldHazard)) killAngel('boss');
      }
    } else {
      st.bossDeadT += dt;
      fxGlitch(clamp(st.bossDeadT * 0.4, 0, 0.9));
      if (st.bossStage === 0 && st.bossDeadT > 2.6) {
        st.bossStage = 1;
        st.bossDeadT = 0;
        st.foxGone = true;
        if (typeof bossMusicFox === 'function') bossMusicFox('dialog');   /* fox */
        st.foxBoss = { x: 23 * CFG.TILE, y: arenaGroundY - CFG.FOX_H,
          w: CFG.FOX_W, h: CFG.FOX_H, vx: 0, facing: -1,
          hits: 0, invuln: 0, attackT: 0, dashT: 0 };
        queueDialog([
          { who: 'angel', face: 'angel_fear', text: 'Страж пытался остановить нас.' },
          { who: 'fox', face: 'fox_cry', text: 'Потому что за дверью ты увидишь меня.' },
          { who: 'angel', face: 'angel_fear', text: 'Лис?' },
          { who: 'fox', face: 'fox_cry', text: 'Не надо. Остановись. Пожалуйста.' },
        ]);
      } else if (st.bossStage === 1 && st.bossDeadT > 0.7 && !st.dialog) {
        st.bossStage = 2;
        st.bossDeadT = 0;
        showHint('Победите Лиса');
        if (typeof bossMusicFox === 'function') bossMusicFox('fight');    /* fox attack */
        queueDialog([
          { who: 'fox', face: 'fox_cry', text: 'Я не хочу с тобой драться.' },
          { who: 'angel', face: 'angel_cry', text: 'Тогда отойди от двери.' },
        ]);
      }
    }
  }

  /* Лис атакует рывком. Удар сверху переводит бой в следующую фазу. */
  if (st.foxBoss && st.bossStage === 2 && !st.done) {
      const f = st.foxBoss;
      f.invuln = Math.max(0, f.invuln - dt);
      /* Таймер бездействия: если игрок не атакует 5с, показываем подсказку */
      st.foxIdleT = (st.foxIdleT || 0) + dt;
      /* Фаза I (док. ур.10): мир дышит гравитацией — каждые ~5.5 с пол
         переворачивается на 1.5 с, Ангел падает на потолок. */
      st.foxGravT = (st.foxGravT || 0) - dt;
      if (f.hits >= 2 && st.foxGravT <= 0 && !st.foxGravOn) {
        st.foxGravOn = 1.5; st.foxGravT = 5.5;
        a.grav = -a.grav; a.vy = 0;
        fxRiftBurst(a.x + a.w / 2, a.y + a.h / 2, a.grav);
      }
      if (st.foxGravOn > 0) {
        st.foxGravOn -= dt;
        if (st.foxGravOn <= 0) { st.foxGravOn = 0; a.grav = 1; a.vy = 0; }
      }
      /* Фаза II (док. ур.10): после второго удара Лис зовёт копий — три силуэта
         повторяют его рывки. Копии не убивают: отбрасывают и путают, найти
         настоящего можно по тени. */
      if (f.hits >= 2 && !st.foxCopies) {
        st.foxCopies = [0, 1, 2].map(i => ({ x: (6 + i * 9) * CFG.TILE, y: f.y,
          w: f.w, h: f.h, facing: 1, dashT: 0, attackT: 1 + i * 0.6 }));
      }
      if (st.foxCopies) for (const c of st.foxCopies) {
        c.attackT -= dt;
        c.pushCd = Math.max(0, (c.pushCd || 0) - dt);
        if (c.attackT <= 0) { c.facing = a.x < c.x ? -1 : 1; c.dashT = 0.42; c.attackT = 2.0 + Math.random(); }
        if (c.dashT > 0) {
          c.dashT -= dt;
          c.x = clamp(c.x + c.facing * 200 * dt, CFG.TILE, Game.L.widthPx - CFG.TILE - c.w);
        }
        if (aabb(actorRect(a), { x: c.x, y: c.y, w: c.w, h: c.h })) {
          /* без кулдауна перекрытие пинало Ангела каждый кадр (60 раз в секунду) */
          if (!(c.pushCd > 0)) {
            c.pushCd = 0.4;
            a.vx = (a.x < c.x ? -1 : 1) * 220;   /* не смерть — отбрасывает */
          }
        }
      }
      f.attackT -= dt;
    if (f.attackT <= 0) {
      f.facing = a.x < f.x ? -1 : 1;
      f.dashT = 0.48 + f.hits * 0.13;
      f.attackT = 2.2 - f.hits * 0.35;
    }
    if (f.dashT > 0) {
      f.dashT -= dt;
      f.x = clamp(f.x + f.facing * (240 + f.hits * 95) * dt,
        CFG.TILE, Game.L.widthPx - CFG.TILE - f.w);
    }
    const contact = aabb(actorRect(a), { x: f.x, y: f.y, w: f.w, h: f.h });
    if (contact && f.invuln <= 0 && Math.abs(a.vy) > 20 && a.y + a.h < f.y + f.h * 0.55) {
      f.hits++;
      f.invuln = 1.4;
      f.dashT = 0;
      a.vy = -CFG.JUMP_VEL * 0.65;
      fxBossHit(f.x + f.w / 2, f.y + f.h / 2);
      sfxBossHurt();
      st.foxIdleT = 0;  /* сброс таймера бездействия */
      if (f.hits === 1) queueDialog([
        { who: 'fox', face: 'fox_cry', text: 'Я пытаюсь тебя защитить.' },
        { who: 'angel', face: 'angel_cry', text: 'Я не хочу с тобой драться.' },
      ]);
      if (f.hits === 2) queueDialog([
        { who: 'fox', face: 'fox_cry', text: 'Если пойдёшь дальше... я тебя не пущу.' },
      ]);
      if (f.hits >= 3) {
        st.done = true; st.won = true; st.endingT = 0.001;
        sfxWin();   /* финальная победа: джингл был определён, но не вызывался */
        recordLevel(L.idx, st.deaths, st.t);   /* финал — тоже уровень: иначе у L10 нет рекорда */
        unlockLevel(L.idx);
        queueDialog([
          { who: 'angel', face: 'angel_cry', text: 'Почему?' },
          { who: 'fox', face: 'fox_cry', text: 'Потому что я боялся. Не двери.' },
          { who: 'fox', face: 'fox_cry', text: 'Того, что ты увидишь за ней.' },
          { who: 'angel', face: 'angel_cry', text: 'Что там?' },
          { who: 'fox', face: 'fox_normal4', text: 'Всё, что я пытался от тебя спрятать.' },
          { who: 'fox', face: 'fox_normal', text: 'Теперь можешь идти.' },
          { who: 'fox', face: 'fox_cry', text: 'Не думай, что я тебя не любил.' },
        ]);
        /* markFinished() здесь больше НЕ зовётся: раньше «игра пройдена»
           ставилась на 3-м ударе по Лису — до 11-й сцены-монолога, то есть
           игрок, ушедший на письме, навсегда числился прошедшим финал.
           Флаг теперь ставит onGameDone() (main.js) — после монолога. */
      }
    } else if (contact && f.dashT > 0 && st.invuln <= 0) {
      killAngel('fox');
    }
  }

  /* ── скрипты по X ── */
  /* п.1: на L8 диалог у двери — по близости, а не по atX (atX глушится memoryHub) */
  if (L.mech.memoryHub) {
    const door = L.decor.find(d => d.kind === 'door');
    if (door && Math.abs(a.x - door.tx * CFG.TILE) < 4 * CFG.TILE) {
      /* Пятый ключ — Память (док. ур.8, п.6): дверь не открывается на 4 ключа;
         пятый даётся здесь же, когда игрок вернулся к двери со всеми четырьмя.
         Латч doorDialogDone ставим ТОЛЬКО на ветке предупреждения: раньше он
         стоял до проверки ключей, и первый же проход зоны двери (игрок всегда
         идёт через неё к порталам) навсегда отменял выдачу пятого ключа. */
      if (st.keys.length >= 4 && !st.keys.includes('ПАМЯТЬ')) {
        st.keys.push('ПАМЯТЬ');
        fxFlash(0.5, '#f0e0ff');
        queueDialog([
          { who: 'angel', face: 'angel_normal', text: 'Не открывай.' },
          { who: 'fox', face: 'fox_normal4', text: 'Почему?' },
          { who: 'angel', face: 'angel_fear', text: 'Ты уже был там.' },
          { who: 'fox', face: 'fox_normal', text: 'Да.' },
          { who: 'angel', face: 'angel_cry', text: 'Пятый ключ. Память.' },
        ]);
        /* рывок хвоста у двери (док. ур.8): один раз при подходе */
        st.doorTailJerk = 1.2;
      } else if (!st.doorDialogDone) {
        st.doorDialogDone = true;
        queueDialog([
          { who: 'angel', face: 'angel_normal', text: 'Не открывай.' },
          { who: 'fox', face: 'fox_normal4', text: 'Почему?' },
          { who: 'angel', face: 'angel_fear', text: 'Ты уже был там.' },
          { who: 'fox', face: 'fox_normal', text: 'Да.' },
        ]);
        st.doorTailJerk = 1.2;
      }
      /* диалог у двери выдан ветками if/else выше; старый дубль обращался
         к неопределённой nearDoor (ReferenceError) — удалён ещё раньше. */
    }
  }
  for (const s of L.script) {
    if (s.atX == null) continue;
    if (L.mech.memoryHub && !s.allowInHub) continue;
    const key = 'x' + s.atX;
    if (st.firedScripts.has(key)) continue;
    if (a.x >= s.atX * CFG.TILE) {
      st.firedScripts.add(key);
      if (s.scene) showSceneImage(s.scene, s.sceneCap);
      /* подсказка в полосе подсказок: script-поле hint (ур.1 — длинный прыжок) */
      if (s.hint) showHint(s.hint);
      queueDialog(s.lines);
      if (s.hideFoxFor) st.foxHideT = s.hideFoxFor;
      if (s.foxStuck != null) st.foxStuck = !!s.foxStuck;
      if (s.rhythmAllFor) st.rhythmAll = s.rhythmAllFor;
      if (s.boom) sfxBoom();
      if (s.rhythmShift != null) { st.rhythmShift = s.rhythmShift; st.rhythmShiftT = s.rhythmShiftFor || 3; }
      /* показать декор на время сцены (горизонт L1): d.visible + таймер скрытия */
      if (s.darkFor) st.darkT = s.darkFor;
      /* «Разрыв» (док. ур.5): огромная волна на пустом участке — тряска + вспышка */
      if (s.wave) { fxShake(s.wave); fxFlash(0.45, '#c7b8e8'); }
      if (s.showDecor) {
        for (const d of L.decor) {
          if (d.kind === s.showDecor) { d.visible = true; d._hideAt = st.t + (s.showFor || 3.5); }
        }
      }
      /* камера уезжает на точку сцены; маркер возврата — ПОСЛЕ реплик */
      if (s.camTo != null) {
        st.sceneCam = s.camTo;
        st.dialogQueue.push({ _camReturn: true });
        if (!st.dialog) nextDialog();
      }
    }
  }
  for (const d of L.decor) {
    if (d.visible && d._hideAt != null && st.t >= d._hideAt) { d.visible = false; d._hideAt = null; }
  }
  /* триггеры */
  for (const tr of L.triggers) {
    if (st.firedScripts.has(tr.id)) continue;
    if (a.x >= tr.tx * CFG.TILE) {
      st.firedScripts.add(tr.id);
      if (tr.kind === 'foxLeaves') { st.foxGone = true; fxFlash(0.2, '#000'); }
      /* ложный лай (док. ур.3, п.4): чужой круг эха далеко впереди — активирует
         эхо-платформы в точке триггера, Ангел не кричал. */
      else if (tr.kind === 'falseBark' && st.echo) {
        /* точка круга — на высоте эхо-платформ (GY-3 у L3), иначе радиус их не достанет */
        const fx0 = tr.tx * CFG.TILE, fy0 = (tr.ty != null ? tr.ty : 11) * CFG.TILE + CFG.TILE / 2;
        const n = shout(st.echo, fx0, fy0, tr.radius || L.mech.echoRadius || 108);
        fxShoutRing(fx0, fy0 - 16);
        if (n > 0) sfxEchoAppear();
        showHint('Лес откликнулся... не тем голосом.');
      }
      /* Ложная подсказка Лиса (ур. 9 «ломается доверие»): раньше триггеры
         kind:'lie' были мёртвым кодом — обработчик знал только 'foxLeaves'.
         Теперь показываем заведомо неверный совет в полосе подсказок, пока
         флаг mech.foxLies включён. Игрок, поверивший Лису, идёт на шипы. */
      else if (tr.kind === 'lie' && L.mech.foxLies) {
        const lieText = { lie1: 'Лис: «Иди низом. Там чисто.»', lie2: 'Лис: «Прямо. Не сворачивай.»', lie3: 'Лис: «Прыгай.»' };
        showHint(lieText[tr.id] || 'Лис: «Здесь безопасно.»');
        fxFlash(0.12, '#3a2a2a');
      }
    }
  }

  /* ── цветок: реакция ── */
  for (const d of L.decor) {
    if (d.kind.indexOf('flower') !== 0 && d.kind !== 'final_flower' && d.kind !== 'gray_leaf' && d.kind !== 'tree_gray') continue;
    if (d._touched) continue;
    /* у дерева хитбокс — весь ствол (4 тайла вверх от d.ty+4), чтобы Ангел доставал касанием */
    const fr = d.kind === 'tree_gray'
      ? { x: d.tx * CFG.TILE, y: d.ty * CFG.TILE, w: CFG.TILE, h: CFG.TILE * 4 }
      : { x: d.tx * CFG.TILE, y: d.ty * CFG.TILE, w: CFG.TILE, h: CFG.TILE };
    if (aabb(actorRect(a), fr)) {
      d._touched = true;
      sfxFlower();
      for (let i = 0; i < 5; i++) fxMote(fr.x + 8 + (Math.random() - 0.5) * 8, fr.y + 6);
      if (d.kind === 'gray_leaf') queueDialog([{ who: 'fox', face: 'fox_normal4', text: '...' }]);
      /* серое дерево (док. ур.2): касание → волна цвета сверху вниз, серость возвращается */
      if (d.kind === 'tree_gray') {
        /* док. ур.2, п.1: эффект повторяемый — серость возвращается, можно
           подойти снова (кулдаун, чтобы не спамить волну каждый кадр) */
        st.colorWave = 1.0;
        fxFlash(0.3, '#ffffff');
        /* _touched оставляем true, пока идёт кулдаун: по его истечении
           блок ниже снимет флаг, и касание снова даст волну */
        d._cd = 6.0;
        queueDialog([{ who: 'angel', face: 'angel_hello', text: 'Ангел как-то связана с цветом.' }]);
      }
      if (d.kind === 'final_flower') {
        /* Финальный цветок (док. ур.2): сцена и диалог — ПРИ КАСАНИИ цветка
           (как было изначально), а не на проходе. Двухфазно: сначала цветной
           кадр, «О, смотри, цветок.», затем кадр сереет — «Я сделала хуже?». */
        st.colorWave = Math.max(st.colorWave, 1.5);
        fxFlash(0.55, '#b0b0b0');
        st.sceneCam = d.tx;                       /* камера — на цветок */
        showSceneImage('l2_final_flower_color', 'Цветок.');
        queueDialog([
          { who: 'angel', face: 'angel_normal2', text: 'Тут ничего нет.' },
          { who: 'fox', face: 'fox_normal', text: 'Есть. Смотри.' },
          { who: 'angel', face: 'angel_hello', text: 'О, смотри, цветок.' },
          { who: 'angel', face: 'angel_fear', text: 'Он... гаснет.',
            swap: 'l2_final_flower_gray', swapCap: 'Цветок.' },
          { who: 'angel', face: 'angel_cry', text: 'Я сделала хуже?' },
          { who: 'fox', face: 'fox_normal4', text: 'Нет.' },
          { who: 'fox', face: 'fox_cry', text: 'Просто... идём.' },
          { _camReturn: true },
        ]);
      }
    }
  }

  /* ── атмосферные частицы ── */
  st.moteT += dt;
  const moteRate = L.meta.corruption < 0.3 ? 0.18 : 0.30;
  if (st.moteT > moteRate) {
    st.moteT = 0;
    const px = st.camX + Math.random() * CFG.VIEW_W;
    const py = st.camY + Math.random() * CFG.VIEW_H;
    if (L.meta.corruption < 0.35) fxMote(px, py);
    else fxAsh(px, st.camY - 8);
  }

  /* ── смерть от геометрии ── */
  /* Арена L10: потолок. При перевороте гравитации Лиса (st.foxGravOn) Ангел
     «падает вверх»; без потолка он улетал за карту (y=-8000) и НЕ умирал —
     checkDeath глушит смерть по y<-200 для арены и foxGravOn, полагаясь на потолок
     («арена имеет потолок выше этой границы»), которого в данных уровня не было.
     Держим Ангела в границах арены: переворот кончится — гравитация вернётся и он опустится. */
  if ((L.mech.arena || st.foxGravOn > 0) && a.y < 0) { a.y = 0; a.vy = 0; }

  /* noclip: сквозь шипы и воду Ангел не умирает */
  const dcause = conVarOn('noclip') ? null : checkDeath(L.map, a);
  /* ложные воспоминания (док. ур.8, п.4): на L8 падение в шипы переносит в хаб, а не убивает */
  if (dcause === 'hazard' && L.mech.memoryHub) {
    if (st.invuln <= 0) {
      /* в хаб — на стартовую площадку: tx=5 это тайл портала, попадать на
         него нельзя (иначе сразу телепорт в РАДОСТЬ, см. блок joyT выше) */
      a.x = L.start.tx * CFG.TILE; a.y = L.start.ty * CFG.TILE;
      a.vx = 0; a.vy = 0;
      st.joyT = 0;        /* зона покинута: цикл РАДОСТИ снят */
      fxFlash(0.4, '#c7b8e8');
      queueDialog([{ who: 'angel', face: 'angel_fear', text: 'Это было не здесь.' }]);
    }
  } else if (dcause && (st.invuln <= 0 || dcause === 'fall')) killAngel(dcause, dcause === 'fall');

  /* ── выход ── */
  if (!st.done && !L.mech.boss && reachedExit(L.map, a)) {
    if (L.idx === 0 && !L.decor.some(d => d.kind === 'gray_leaf' && d._touched)) {
      /* тупик: без серого листа выход молча не работает — даём подсказку один раз */
      if (!st.exitHintShown) {
        st.exitHintShown = true;
        queueDialog([{ who: 'angel', face: 'angel_normal2', text: 'Тут что-то не так... Что-то должно быть здесь.' }]);
      }
      fxUpdate(dt); updateCamera(false); return;
    }
    /* как в соседних ветках (L4/L8): на выходе не замораживаем VFX и камеру */
    if (L.idx === 1 && !L.decor.some(d => d.kind === 'final_flower' && d._touched)) { fxUpdate(dt); updateCamera(false); return; }
    if (L.idx === 3 && st.fragments.length < 3) {
      /* флаг сбрасывается при respawn, чтобы предупреждение повторялось */
      if (!st.fragmentGateWarned) {
        st.fragmentGateWarned = true;
        queueDialog([{ who: 'fox', face: 'fox_normal4', text: 'Свет расколот на три фрагмента. Найди их.' }]);
      }
      fxUpdate(dt); updateCamera(false); return;
    }
    if (L.idx === 7 && st.keys.length < 4) {
      if (!st.keyGateWarned) {
        st.keyGateWarned = true;
        queueDialog([{ who: 'fox', face: 'fox_normal4', text: 'Сначала найди четыре ключа памяти.' }]);
      }
      fxUpdate(dt);
      updateCamera(false);
      return;
    }
    st.done = true; st.won = true;
    sfxDoor();
    fxFlash(0.5, '#ffffff');
    recordLevel(L.idx, st.deaths, st.t);
    unlockLevel(L.idx);
    if (Game.onLevelDone) Game.onLevelDone(L.idx, st);
  }

  fxUpdate(dt);
  updateCamera(false);
}

/* ───────────────────────── отрисовка кадра ───────────────────────── */
function drawFrameAll() {
  const st = Game.state, L = Game.L;
  if (!st) return;
  const ctx = R.bctx;
  /* 11-я сцена: мира нет — тёмный зал, свет и пыль; портрет Лиса в центре
     рисует DOM-слой (.vn.cinematic), здесь только фон. */
  if (st.cinematic) {
    drawCinematicStage(ctx, st);
    /* зал рисуется в offscreen R.buf: без пост-обработки и present() на экране
       остаётся последний кадр мира. Гоним сцену по той же цепочке, что и мир,
       но без коррупции/глитча/тьмы — это финальная сцена, а не уровень. */
    applyPost(R.buf, R.pctx, 0, st.t, {
      glitch: 0, flash: FX.flash, flashColor: FX.flashColor,
      darkness: 0, zoneTint: null,
    });
    present(R.post);
    return;
  }
  const shake = fxShakeOffset();
  const camX = Math.round(st.camX + shake.x);
  const camY = Math.round(st.camY + shake.y);

  /* Переворот ВИДА вместо инверсии управления:
     L4 — после зеркального портала мир отражён «как в воде» (вертикальный
     флип): лево/право остаются собой, отражение читается визуально.
     L6 — при отрицательной гравитации камера переворачивается, поэтому
     потолок выглядит полом, а спрайт Ангела (flip в drawAngel при grav<0)
     на экране снова стоит прямо. */
  /* сломанная зона (док. ур.6, п.3): визуальный переворот отстаёт на 1 с от физики */
const flipView = (L.mech.mirrorPortals && st.reflected) ||
                   (st.viewGrav != null ? st.viewGrav < 0 : (st.angel && st.angel.grav < 0));

  if (flipView) {
    ctx.save();
    ctx.translate(0, CFG.VIEW_H);
    ctx.scale(1, -1);
  }

  drawSky(ctx, L.meta, camX, camY, st.t);

  ctx.save();
  ctx.translate(-camX, -camY);

  drawDecor(ctx, L, st.t, true);       // облака, птицы
  drawLightWells(ctx, L, st.t);
  drawZones(ctx, L, st.t);
  drawHazardGlow(ctx, L, st.t, (st.aidFlashT || 0) > 0 ? CFG.AID_GLOW_BOOST : 1);   /* подсветка опасных участков (ТЗ L9); буст — мягкая помощь */
  drawTiles(ctx, L, camX, camY, st.t, st);
  drawMemoryBlocks(ctx, L, st, st.angel);
  drawVisualPulse(ctx, L, st.t, st);
  drawKeys(ctx, L, st.t);
  drawMirrorFeatures(ctx, L, st.t, st);
  drawEchoPlats(ctx, L, st);
  if (L.rifts.length) drawRifts(ctx, L, st.t, st.usedRifts);
  drawDecor(ctx, L, st.t, false);      // деревья, кусты, цветы

  for (const s of st.shadows) if (!s.reflectOnly || st.reflected) {
    /* пульсация теней в такт (док. ур.5, п.5): на L5 тень видна в сильной фазе такта,
       в слабой — полупрозрачна. Только отрисовка, коллизия не меняется. */
    if (L.mech.rhythm) {
      s.pulseMul = (st.rhythmBeat % 2 === 0) ? 1 : 0.25;
      drawShadow(ctx, s, st.t);
    } else {
      drawShadow(ctx, s, st.t);
    }
  }
  if (st.twin && st.reflected) drawTwin(ctx, st.twin, st.t);
  if (st.fox && !st.foxGone && !(st.foxHideT > 0)) drawFox(ctx, st.fox, st.t);
  /* ложный Лис (док. ур.9): бледный силуэт впереди по ходу — манит за собой */
  if (L.mech.visionCone && L.mech.falseFox && st.falseFox && st.angel) {
    const ff = st.falseFox;
    ctx.save();
    ctx.globalAlpha = 0.42 + 0.12 * Math.sin(st.t * 2.4);
    drawFox(ctx, { x: ff.x, y: ff.y, w: st.fox ? st.fox.w : 28, h: st.fox ? st.fox.h : 22,
      facing: -1, vx: 0, onGround: true }, st.t);
    ctx.restore();
  }
  /* элитная тень-копия Лиса (ур.9): полупрозрачный силуэт по задержанной позиции */
  if (L.mech.visionCone && st.foxEcho && st.foxEcho.ready) {
    ctx.save(); ctx.globalAlpha = 0.25;
    drawFox(ctx, { x: st.foxEcho.x, y: st.foxEcho.y, w: st.fox.w, h: st.fox.h, facing: st.foxEcho.facing, vx: 0, onGround: true }, st.t);
    ctx.restore();
  }
  if (L.mech.tailRadar && st.fox && !st.foxGone) drawTailRadar(ctx, L, st);
  /* элитная тень-копия Ангела (док. ур.9, п.5): серый силуэт, повторяющий
     движения Ангела с задержкой — «не смотри на неё. / На кого? / На себя.» */
  if (L.mech.eliteAngel && st.angelEcho && st.angelEcho.ready) {
    const ae = st.angelEcho;
    ctx.save();
    ctx.globalAlpha = 0.4;
    ctx.filter = 'grayscale(1) brightness(0.45)';
    drawShadow(ctx, { x: ae.x, y: ae.y + st.angel.h - CFG.SHADOW_H,
      w: CFG.SHADOW_W, h: CFG.SHADOW_H, facing: ae.facing || 1, scale: 3.0,
      kind: 'still', jitter: false }, st.t);
    ctx.restore();
  }
  if (L.mech.memoryHub && st.fox) drawDoorTail(ctx, L, st);
  /* «Не смотри назад»: огромная тень-Лис за спиной (визуал, без коллизии), пока lookBackT > 0 */
  if (st.lookBackT > 0 && st.angel) {
    const ang = st.angel;
    const ghost = { x: ang.x + ang.w / 2 + 40, y: ang.y + ang.h - CFG.SHADOW_H, w: CFG.SHADOW_W, h: CFG.SHADOW_H, facing: 1, scale: 3.2, kind: 'still', jitter: false };
    ghost.pulseMul = Math.min(0.55, st.lookBackT) / 0.9;   /* drawShadow ставит alpha 0.9*pulseMul */
    drawShadow(ctx, ghost, st.t);
  }
  if (st.foxBoss && st.bossStage > 0) {
      /* копии Лиса (Фаза II, док. ур.10): полупрозрачные силуэты, путают игрока */
      if (st.foxCopies) for (const c of st.foxCopies) {
        ctx.save(); ctx.globalAlpha = 0.38;
        drawFox(ctx, { x: c.x, y: c.y, w: c.w, h: c.h, facing: c.facing, vx: 0, onGround: true }, st.t);
        ctx.restore();
      }
      ctx.save();
    ctx.globalAlpha = st.foxBoss.invuln > 0 ? 0.55 : 1;
    ctx.filter = `grayscale(${Math.min(0.9, st.foxBoss.hits * 0.3)})`;
    drawFox(ctx, st.foxBoss, st.t);
    ctx.restore();
  }
  /* «Ангел — единственный цвет» (док. ур.10): в мире НЕ рисуем — иначе виден
     обесцвеченный дубль под цветным Ангелом. Цветной рисуется поверх пост-фильтра. */
  if (st.dying <= 0 && !L.mech.angelColor) drawAngel(ctx, st.angel, st.t, st);

  fxDraw(ctx);
  ctx.restore();

  if (L.mech.visionCone) {
    const ax = st.angel.x + st.angel.w / 2 - camX;
    const ay = st.angel.y + st.angel.h / 2 - camY;
    const dir = st.angel.facing || 1;
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.88)';
    ctx.beginPath();
    ctx.rect(0, 0, CFG.VIEW_W, CFG.VIEW_H);
    ctx.moveTo(ax, ay);
    /* сектор взгляда: по часовой от начала до конца дуги — передний сектор при любом facing */
    /* сектор взгляда: центр дуги — направление взгляда, половина раствора 0.62 рад.
       Так дуга всегда спереди, независимо от знака facing. */
    const c = dir > 0 ? 0 : Math.PI;
    ctx.arc(ax, ay, 260, c - 0.62, c + 0.62, false);
    ctx.closePath();
    ctx.fill('evenodd');
    ctx.restore();
  }

  /* босс рисуется в экранных координатах (арена фиксирована) */
  if (st.boss && st.bossStage === 0 && st.boss.hp > 0) drawBoss(ctx, st.boss, st.t, L);
  else if (st.boss && st.bossStage === 0) {
    ctx.save(); ctx.globalAlpha = clamp(1 - st.bossDeadT / 2.6, 0, 1);
    drawBoss(ctx, st.boss, st.t, L); ctx.restore();
  }

  /* Мигающая подсказка при бездействии в бою с Лисом */
  if (st.foxBoss && st.bossStage === 2 && !st.done && st.foxIdleT > 5) {
    const blink = Math.sin(st.t * 5) * 0.5 + 0.5;  /* мигание 0→1 */
    ctx.save();
    ctx.globalAlpha = 0.75 * blink;
    ctx.fillStyle = '#d84040';
    ctx.font = 'bold 64px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 12;
    ctx.fillText('ПРЫГНИТЕ НА ЛИСА СВЕРХУ', CFG.VIEW_W / 2, CFG.VIEW_H / 2);
    ctx.restore();
  }

  if (flipView) ctx.restore();

  /* пост-эффекты */
  applyPost(R.buf, R.pctx,
    st.colorHold > 0 ? 0 : (st.colorWave > 0 ? L.meta.corruption * (1 - Math.min(1, st.colorWave / 3)) : L.meta.corruption),
    st.t, {
    glitch: FX.glitch + (st.boss && st.boss.hp <= 0 ? 0.3 : 0),
    flash: FX.flash, flashColor: FX.flashColor,
    darkness: st.darkness || 0,
    /* L8: тональность текущего воспоминания по X (док. ур.8, п.1) */
    zoneTint: (L.mech.zoneTints || []).find(z => { const ax = st.angel.x / CFG.TILE; return ax >= z.from && ax <= z.to; }) || null,
  });

  /* «Ангел — единственный цвет» (док. ур.10): Ангел рисуется поверх пост-фильтра без обесцвечивания.
     R.pctx — это post-canvas БЕЗ камеры, поэтому применяем тот же translate + shake, что и на основном ctx. */
  if (L.mech.angelColor && st.dying <= 0) {
    R.pctx.save();
    R.pctx.translate(-camX, -camY);
    if (FX.shake > 0) {
      const dx = (Math.random() - 0.5) * FX.shake * 18;
      const dy = (Math.random() - 0.5) * FX.shake * 18;
      R.pctx.translate(dx, dy);
    }
    drawAngel(R.pctx, st.angel, st.t, st);
    R.pctx.restore();
  }
  /* оверлеи консоли (fps/координаты/хитбоксы/состояние) — поверх пост-эффектов */
  if (typeof conDrawOverlay === 'function') conDrawOverlay(R.pctx, L, st, camX, camY);
  present(R.post);
}

/* ───────────────────────── цикл ───────────────────────── */
function gameLoop(now) {
  if (!Game.running) return;
  Game._raf = requestAnimationFrame(gameLoop);
  const t = now / 1000;
  let dt = Game.lastT ? t - Game.lastT : FIXED_DT;
  Game.lastT = t;
  if (dt > 0.25) dt = 0.25;           // свернули вкладку — не проваливаемся

  if (!Game.paused) {
    Game.acc += dt;
    let guard = 0;
    while (Game.acc >= FIXED_DT && guard++ < 6) {
      step(FIXED_DT);
      Game.acc -= FIXED_DT;
    }
    /* Если упёрлись в guard (долгая свёрнутая вкладка / лаг), аккумулятор
       остаётся переполненным и игра «догоняет» рывками по 6 шагов каждый
       кадр. Режем остаток — лучше потерять симуляционное время, чем
       ускоряться несколько секунд после возврата. */
    if (guard >= 6) Game.acc = 0;
    drawFrameAll();
    if (typeof hudUpdate === 'function') hudUpdate();
  }
}

function gameStart(idx) {
  /* Защита от дублирования цикла: ⟲(retry) вызывает startGame при
     Game.running===true, и showScreen('game') НЕ зовёт gameStop()
     (inGame===true). Прежний код просто ставил ЕЩЁ ОДИН RAF без отмены
     старого → два gameLoop крутились параллельно, step() и drawFrameAll()
     выполнялись дважды за кадр (двойная физика, ускорение, просадка FPS).
     Проверено пробой (probe_loop.js: rafQueue 1 → 2). Отменяем прежний. */
  if (Game._raf != null) { cancelAnimationFrame(Game._raf); Game._raf = null; }
  loadLevel(idx);
  /* Нажатия, сделанные в меню/на экране выбора уровня, не должны дёргать
     Ангела на первом кадре: keydown-хендлер (inputAttach) не проверяет
     текущий экран, поэтому флаги jumpPressed/actionPressed переживают
     gameStart. Даёт прыжок «сам собой» сразу после «Играть». */
  INPUT.left = INPUT.right = INPUT.jumpHeld = false;
  INPUT.leftPressed = INPUT.rightPressed = false;
  INPUT.jumpPressed = INPUT.actionPressed = INPUT.shoutPressed = false;
  Game.running = true;
  Game.paused = false;
  Game.lastT = 0;
  Game.acc = 0;
  ambientStart();
  if (typeof musicStart === 'function' && !(Game.L.mech && Game.L.mech.cinematic))
    musicStart(idx);   /* музыка уровня (11-я сцена живёт без трека — там песня) */
  /* ур.10: вступление звучит уже во время стартового диалога (жалоба:
     «в диалогах не играет»). Дальше секциями ведут фазы босса. */
  if (Game.L && Game.L.mech && Game.L.mech.boss &&
      typeof bossMusicSection === 'function') bossMusicSection(0);
  Game._raf = requestAnimationFrame(gameLoop);
}

function gameStop() {
  Game.running = false;
  if (Game._raf != null) { cancelAnimationFrame(Game._raf); Game._raf = null; }
  /* фон (ветер/дрон) глушим вместе с уровнем — иначе он звучит и в меню.
     Музыку НЕ глушим: в меню продолжает играть трек уровня (ТЗ). */
  if (typeof ambientStop === 'function') ambientStop();
  if (typeof bossMusicStop === 'function') bossMusicStop();
  /* Уровень 7 и открытые сцены держат SND.muffle = 1, то есть master.gain = 0.
     В меню никто не снимал заглушку — вышли из L7/со сцены и все звуки меню
     немые. Снимаем здесь: это единственный путь «игра → меню». */
  if (typeof audioSetMuffle === 'function') audioSetMuffle(0);
}
function gamePause(v) { Game.paused = v; if (!v) Game.lastT = 0; }
