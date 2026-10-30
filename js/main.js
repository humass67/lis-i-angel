/* main.js — экраны, навигация, выбор уровня, склейка всего вместе. */
'use strict';

const UI = {
  screens: {},
  current: 'load',
};

/* Отложенный переход на экран перехода между уровнями (onLevelDone ждёт
   1.1s, чтобы игрок увидел финальный кадр). Handle хранится здесь, чтобы
   отменить его при уходе с уровня: иначе ESC/⟲ в этом окне выбрасывали
   игрока на outro уже закрытого уровня. */
let _outroT = null;

/* Состояние плеера финальной песни («брызги»): DOM-ссылки и флаг
   «игрок держит ползунок перемотки» (чтобы прогресс не дёргал его). */
const FP = { box: null, viz: null, ctx2d: null, play: null, restart: null, seek: null, time: null, _seekHeld: false };

function showScreen(name) {
  /* любая смена экрана гасит отложенный outro — он принадлежит прошлому уровню */
  if (_outroT) { clearTimeout(_outroT); _outroT = null; }
  /* окна поверх меню: открывают/закрывают оверлей, экран меню остаётся под ними */
  const WINS = { parts: 'winParts', settings: 'winSettings', levels: 'winLevels' };
  for (const k in WINS) document.getElementById(WINS[k]).classList.toggle('active', k === name);
  if (name in WINS) return;
  for (const k in UI.screens) UI.screens[k].classList.toggle('active', k === name);
  UI.current = name;
  const inGame = name === 'game';
  /* Окно диалога, портреты и сцена-картинка принадлежат конкретному
     уровню. При любой смене экрана гасим их — иначе картинка сцены
     «доживает» поверх меню и другого уровня (баг из отчёта). */
  if (typeof hudHide === 'function') hudHide();
  if (typeof sceneForceHide === 'function') sceneForceHide();
  /* оверлей паузы принадлежит уходящему экрану игры */
  const pov = document.getElementById('pauseOv');
  if (pov) pov.hidden = true;
  /* сцена меню живёт только пока открыт экран меню */
  if (name === 'menu' && window.MenuScene) MenuScene.start(); else if (window.MenuScene) MenuScene.stop();
  /* Пересчитываем размер canvas ПОСЛЕ показа экрана: до этого родитель
     скрыт и его clientWidth/Height равны нулю. */
  if (inGame) renderResize();
  gamePause(!inGame);
  if (!inGame) gameStop();
  /* Музыку меню зовём ПОСЛЕ gameStop(): тот глушит трек босса
     (bossMusicStop -> musicStop), и musicMenu(), вызванный раньше, выходил
     по guard'у «уже играет» — меню оставалось без музыки (баг #5). */
  if (name === 'menu' && typeof musicMenu === 'function') musicMenu();
  if (name === 'menu') applyMenuState();
}

/* ───────────────────── экран уровней ───────────────────── */
const _fmtTime = (sec) => Math.floor(sec / 60) + ':' + String(Math.floor(sec % 60)).padStart(2, '0');

function buildLevelGrid() {
  const grid = document.getElementById('lvlGrid');
  grid.innerHTML = '';
  const s = getSave();
  /* дефолт выбора — последний открытый уровень, а не всегда первый:
     игрок, дошедший до девятой главы, не должен листать список заново.
     Сравнение с == null, а не !: выбор главы 1 — это _selLevel = 0,
     и «!» считал его отсутствующим, сбрасывая выбор на последний открытый
     (жалоба: «1 уровень не выбирается — выбирается 10»). */
  if (window._selLevel == null || window._selLevel >= s.unlocked) {
    window._selLevel = Math.max(0, Math.min(s.unlocked, levelCount()) - 1);
  }
  for (let i = 0; i < levelCount(); i++) {
    const meta = LEVELS_META[i];
    const open = (i + 1) <= s.unlocked;
    const b = s.best && s.best[i];
    /* пройден → лучший результат (сейв best[] раньше вообще не читался) */
    let status, statColor = '#7a6a52';
    if (!open) status = 'закрыто';
    else if (b && (b.timeSec != null || b.deaths != null)) {
      const parts = [];
      if (b.timeSec != null) parts.push(_fmtTime(b.timeSec));
      if (b.deaths != null) parts.push(b.deaths + '✕');
      status = '✓ ' + (parts.join(' · ') || 'пройден');
      statColor = '#7dd3a0';
    } else status = meta.breaks;
    const row = document.createElement('div');
    row.className = 'hradio' + (open ? '' : ' locked') + (window._selLevel === i ? ' on' : '');
    row.innerHTML = `<i></i><span>${meta.n}. ${meta.name}</span>` +
      `<span style="margin-left:auto;color:${statColor}">${status}</span>`;
    /* клавиатура и скринридер: раньше список был доступен только мышью */
    row.setAttribute('role', 'radio');
    row.setAttribute('aria-checked', String(window._selLevel === i));
    if (open) {
      row.tabIndex = 0;
      row.setAttribute('aria-label', `Уровень ${meta.n}. ${meta.name}`);
      row.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); row.click(); }
      });
    } else {
      row.setAttribute('aria-disabled', 'true');
    }
    row.addEventListener('click', () => {
      if (!open) return;
      window._selLevel = i;
      buildLevelGrid();
    });
    grid.appendChild(row);
  }
}

/* ───────────────────── состояние меню ─────────────────────
   Бейдж «ПРОЙДЕНО» и три состояния кнопки «Играть»:
   новый игрок — ИГРАТЬ; в процессе — ПРОДОЛЖИТЬ · ГЛАВА N;
   увидел финал (finished) — ПЕРЕСМОТРЕТЬ ФИНАЛ (последняя сцена).
   Вызывается при каждом показе меню и при смене сейва (сброс/финал). */
function applyMenuState() {
  const s = getSave();
  const badge = document.getElementById('vmDone');
  if (badge) badge.hidden = !s.finished;
  const play = document.getElementById('btnPlay');
  if (!play) return;
  if (s.finished) play.textContent = 'ПЕРЕСМОТРЕТЬ ФИНАЛ';
  else if (s.unlocked > 1) play.textContent = `ПРОДОЛЖИТЬ · ГЛАВА ${Math.min(s.unlocked, levelCount())}`;
  else play.textContent = 'ИГРАТЬ';
}

/* ───────────────────── пауза ─────────────────────
   ESC в игре больше не выбрасывает в меню (прогресс отрезка терялся,
   а «Играть» возвращал в бой с боссом): показываем оверлей и ставим мир
   на gamePause(true). Позицию не сохраняем — напряжение глав держится
   на цене ошибки. Тот же путь — авто-пауза при потере фокуса окна. */
function togglePause(force) {
  if (UI.current !== 'game' || !Game.running) return;
  const on = force == null ? !Game.paused : !!force;
  gamePause(on);
  const ov = document.getElementById('pauseOv');
  if (ov) ov.hidden = !on;
  /* звук под окном глушим; при возврате восстанавливаем уровень ковра
     (L7 и сцены держат muffle постоянно — см. audioSetMuffle) */
  if (Game.L && typeof audioSetMuffle === 'function') {
    audioSetMuffle(on ? 1 : (Game.L.mech.muffled ? 1 : 0));
  }
  /* edge-флаги, накопленные за паузу, не должны сработать на первом кадре */
  if (!on) {
    INPUT.jumpPressed = INPUT.actionPressed = INPUT.shoutPressed = false;
    INPUT.leftPressed = INPUT.rightPressed = false;
  }
}

/* ───────────────────── запуск уровня ───────────────────── */
function startGame(idx) {
  /* консоль, открытая в меню, до сих пор оставалась открытой в игре:
     CON.open глушит ввод, а _wasPaused=true при закрытии ставил уже
     запущенный уровень на паузу. Закрываем при старте уровня. */
  if (typeof CON !== 'undefined' && CON.open && typeof conClose === 'function') conClose();
  /* Звук поднимаем ДО gameStart: он запускает музыку, и ей нужен живой
     AudioContext, иначе трек играет мимо musicGain (ползунки не работают). */
  audioResume();
  showScreen('game');
  gameStart(idx);
  hudSetLevel(Game.L);
}

/* Победа на уровне -> экран перехода */
function onLevelDone(idx, st) {
  const meta = LEVELS_META[idx];
  const last = idx >= levelCount() - 1;
  /* handle в UI._outroT — showScreen() отменит его при уходе с уровня */
  _outroT = setTimeout(() => {
    _outroT = null;
    const t = document.getElementById('outroText');
    const h = document.getElementById('outroTitle');
    const nextBtn = document.getElementById('btnNext');
    h.textContent = idx === 0 ? 'УРОВЕНЬ 1 — ПРОБУЖДЕНИЕ' : `${meta.n}. ${meta.name} — пройден`;
    const mins = Math.floor(st.t / 60), secs = Math.floor(st.t % 60);
    t.textContent = idx === 0 ? 'Шелест листьев. ...шорох' :
      `Время ${mins}:${String(secs).padStart(2, '0')}   ·   смертей ${st.deaths == null ? 0 : st.deaths}`;
    if (last) {
      nextBtn.textContent = 'к финалу';
      nextBtn.onclick = () => showScreen('final');
    } else {
      const nm = LEVELS_META[idx + 1];
      nextBtn.textContent = `дальше: ${nm.n}. ${nm.name}`;
      nextBtn.onclick = () => startGame(idx + 1);
    }
    buildLevelGrid();
    showScreen('outro');
  }, 1100);
}

/* Финал игры после босса */
function onGameDone() {
  /* «Пройдено» = увиден финал (11-я сцена закрыта), а не «3-й удар по Лису».
     unlocked здесь уже levelCount(): unlockLevel(9) сработал при победе на L10. */
  markFinished();
  applyMenuState();
  /* сводка всего прохождения: данные копились в сейве, но нигде не показывались */
  const fs = document.getElementById('finalStats');
  if (fs) {
    const s = getSave();
    const rows = [];
    rows.push(`смертей всего: ${s.deathsTotal || 0}`);
    const fr = Array.isArray(s.fragments) ? s.fragments.filter(n => allFragmentNames().includes(n)).length : 0;
    rows.push(`части цвета: ${fr} из ${allFragmentNames().length}`);
    const times = [];
    for (let i = 0; i < levelCount(); i++) {
      const b = s.best && s.best[i];
      if (b && b.timeSec != null) times.push(`${LEVELS_META[i].n}—${_fmtTime(b.timeSec)}`);
    }
    if (times.length) rows.push('лучшее время по главам: ' + times.join(' · '));
    fs.innerHTML = rows.map(r => `<p>${r}</p>`).join('');
    fs.hidden = false;
  }
  showScreen('final');
  /* плеер песни: сама песня уже играет (musicFinal из последней реплики
     монолога), здесь только показываем управление */
  if (FP.box) FP.box.hidden = false;
}

/* ────────── плеер финальной песни («брызги») ──────────
   Экран финала после 11-й сцены: пауза/заново/перемотка и визуализация
   «брызг» по спектру музыкальной шины. Песню не перезапускаем — она
   стартует с последней реплики монолога и играет по кругу. */
function finalPlayerInit() {
  const box = document.getElementById('finalPlayer');
  if (!box || box._fpInit) return;
  box._fpInit = true;
  FP.box = box;
  FP.viz = document.getElementById('fpViz');
  FP.ctx2d = FP.viz.getContext('2d');
  FP.play = document.getElementById('fpPlay');
  FP.restart = document.getElementById('fpRestart');
  FP.seek = document.getElementById('fpSeek');
  FP.time = document.getElementById('fpTime');
  FP.vol = document.getElementById('fpVol');
  FP.volVal = document.getElementById('fpVolVal');
  if (FP.vol) {
    FP.vol.value = String(Math.round(finalPlayerVolume() * 100));
    if (FP.volVal) FP.volVal.textContent = FP.vol.value + '%';
    FP.vol.addEventListener('input', () => {
      const v = finalPlayerSetVolume(FP.vol.value / 100);
      if (FP.volVal) FP.volVal.textContent = Math.round(v * 100) + '%';
    });
  }

  const fmt = (t) => Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0');
  const data = new Uint8Array(32);

  FP.play.onclick = () => { finalPlayerToggle(); };
  FP.restart.onclick = () => { finalPlayerSeek(0); if (!finalSongPlaying()) finalPlayerToggle(); };
  /* клик по визуализации — тоже пауза/продолжить (крупная цель) */
  FP.viz.addEventListener('click', () => { finalPlayerToggle(); });
  /* перемотка мышью: применяем сразу, прогресс не перебивает, пока держат */
  FP.seek.addEventListener('input', () => { finalPlayerSeek(FP.seek.value / 1000); });
  FP.seek.addEventListener('pointerdown', () => { FP._seekHeld = true; });
  window.addEventListener('pointerup', () => { FP._seekHeld = false; });

  function frame() {
    if (UI.current === 'final' && !FP.box.hidden) {
      const el = finalSongEl();
      const playing = finalSongPlaying();
      const dur = el && isFinite(el.duration) ? el.duration : 0;
      const cur = el && isFinite(el.currentTime) ? el.currentTime : 0;
      FP.time.textContent = fmt(cur) + ' / ' + (dur ? fmt(dur) : '—:—');
      if (!FP._seekHeld && dur > 0) FP.seek.value = String(Math.round(1000 * cur / dur));
      FP.play.textContent = playing ? 'пауза' : 'играть';

      /* «брызги»: бары спектра + летящие точки */
      const w = FP.ctx2d.canvas.width, h = FP.ctx2d.canvas.height;
      const an = finalPlayerAnalyser();
      if (an) an.getByteFrequencyData(data); else data.fill(0);
      FP.ctx2d.clearRect(0, 0, w, h);
      FP.ctx2d.fillStyle = '#0a0c0f';
      FP.ctx2d.fillRect(0, 0, w, h);
      const n = data.length, bw = w / n;
      for (let i = 0; i < n; i++) {
        const v = Math.min(1, (data[i] / 255) * 2.4);   /* буст: трек играет через musicGain не на полной шкале */
        const bh = Math.max(2, v * h * 0.92);
        FP.ctx2d.fillStyle = 'rgba(224,145,40,' + (0.3 + v * 0.55).toFixed(3) + ')';
        FP.ctx2d.fillRect(i * bw + 1, h - bh, Math.max(1, bw - 2), bh);
      }
      const t = performance.now() / 1000;
      for (let i = 0; i < 26; i++) {
        const v = data[(i * 5) % n] / 255;
        if (v < 0.12) continue;
        const life = (t * (0.35 + v * 1.1) + i * 0.41) % 1;
        const y = h - 3 - life * (h - 8);
        const x = ((i * 61.03 + v * 77) % w + w) % w;
        FP.ctx2d.fillStyle = 'rgba(200,184,216,' + (0.75 * (1 - life) * Math.min(1, v * 2)).toFixed(3) + ')';
        FP.ctx2d.fillRect(x, y, 2, 2);
      }
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

/* ───────────────────── старт приложения ───────────────────── */
function boot() {
  UI.screens = {
    load: document.getElementById('scrLoad'),
    menu: document.getElementById('scrMenu'),

    game: document.getElementById('scrGame'),
    outro: document.getElementById('scrOutro'),
    final: document.getElementById('scrFinal'),
  };

  renderInit(document.getElementById('cv'));
  hudInit();
  /* плеер финальной песни (экран финала, после 11-й сцены-монолога) */
  finalPlayerInit();
  /* консоль разработчика (клавиша P) — модуль необязательный */
  if (typeof conInit === 'function') conInit();
  inputAttach();
  Game.onLevelDone = onLevelDone;
  Game.onGameDone = onGameDone;

  window.addEventListener('resize', renderResize);

  /* Сохраняем прогресс при уходе со страницы: deathsTotal копится и без
     записи на диск, а закрытие вкладки — самый частый способ «бросить». */
  window.addEventListener('pagehide', saveNow);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveNow();
  });

  /* авто-пауза при потере фокуса/сворачивании: раньше Ангел продолжал бежать,
     тени — атаковать, а счётчик смертей — расти, пока игрок отвечал в мессенджере */
  const autoPause = () => { if (UI.current === 'game' && !Game.paused) togglePause(true); };
  window.addEventListener('blur', autoPause);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') autoPause();
  });

  /* кнопки оверлея паузы */
  const pb = document.getElementById('btnResume');
  if (pb) pb.onclick = () => togglePause(false);
  document.getElementById('btnPauseRetry').onclick = () => startGame(Game.L ? Game.L.idx : 0);
  document.getElementById('btnPauseQuit').onclick = () => showScreen('menu');

  /* кнопки */
  document.getElementById('btnPlay').onclick = () => {
    const s = getSave();
    /* «Играть» — продолжить с последнего доступного */
    const idx = Math.min(levelCount() - 1, Math.max(0, s.unlocked - 1));
    startGame(idx);
  };
  document.getElementById('btnLevels').onclick = () => {
    buildLevelGrid();
    showScreen('levels');
    /* фокус на первый открытый уровень: список сразу управляется клавиатурой */
    const first = document.querySelector('#lvlGrid .hradio:not(.locked)');
    if (first) first.focus();
  };
  /* стрелки двигают фокус по открытым строкам списка (Tab/Enter уже работали) */
  const lvlGridEl = document.getElementById('lvlGrid');
  lvlGridEl.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const rows = [...lvlGridEl.querySelectorAll('.hradio:not(.locked)')];
    if (!rows.length) return;
    const cur = rows.indexOf(document.activeElement);
    const next = e.key === 'ArrowDown'
      ? rows[(Math.max(cur, 0) + 1) % rows.length]
      : rows[(Math.max(cur, 0) - 1 + rows.length) % rows.length];
    next.focus();
  });
  document.getElementById('btnBackMenu').onclick = () => showScreen('menu');
  /* startGame() сам вызывает showScreen('game'); прежний showScreen('menu')
     на один клик поднимал MenuScene и меню-музыку, чтобы сразу их снести. */
  document.getElementById('btnLevelPlay').onclick = () => { startGame(window._selLevel || 0); };

  /* ЧАСТИ ЦВЕТА: список фрагментов, собранных за всё время.
     Имена берём из ДАННЫХ уровней (allFragmentNames), а не из литерала:
     захардкоженные 4 имени не знали о пятом фрагменте ТИШИНА_2 (ур.7),
     и счётчик врал в обе стороны. */
  const FRAGMENT_ORDER = allFragmentNames();
  /* глава, где лежит каждый фрагмент: один проход buildLevel по всем уровням
     (та же чистая функция, что питает список имён) */
  let _fragmentChapter = null;
  const fragmentChapter = () => {
    if (_fragmentChapter) return _fragmentChapter;
    const map = {};
    for (let i = 0; i < levelCount(); i++) {
      const n = LEVELS_META[i].n;
      for (const f of buildLevel(i).fragments) if (!map[f.name]) map[f.name] = n;
    }
    _fragmentChapter = map;
    return map;
  };
  const showParts = () => {
    /* не-массив (объект/число) из подделанного localStorage ронял
       .includes() прямо в обработчике клика — окно не открывалось. */
    const rawFrag = getSave().fragments;
    const have = Array.isArray(rawFrag) ? rawFrag : [];
    const list = document.getElementById('partsList');
    list.innerHTML = '';
    const chap = fragmentChapter();
    for (const name of FRAGMENT_ORDER) {
      const row = document.createElement('div');
      const got = have.includes(name);
      row.className = 'part-row' + (got ? '' : ' missing');
      row.textContent = (got ? name : '???') + ' · глава ' + (chap[name] || '?');
      list.appendChild(row);
    }
    /* считаем СОВПАВШИЕ имена: подделанный/устаревший сейв с мусорными
       строками давал «собрано: 4 из 4» при четырёх «???» */
    const got = FRAGMENT_ORDER.filter(n => have.includes(n)).length;
    document.getElementById('partsCount').textContent = `собрано: ${got} из ${FRAGMENT_ORDER.length}`;
    showScreen('parts');
  };
  document.getElementById('btnParts').onclick = showParts;
  document.getElementById('btnBackPartsMenu').onclick = () => showScreen('menu');
  document.getElementById('xParts').onclick = () => showScreen('menu');
  document.getElementById('xSettings').onclick = () => showScreen('menu');
  document.getElementById('xLevels').onclick = () => showScreen('menu');

  /* НАСТРОЙКИ: звук и сброс; сброс использует ту же логику, что и кнопка в меню */
  /* Консоль разработчика: тумблер в настройках (клавиша P). Сама консоль
     живёт в js/console.js; здесь только переключатель. */
  const applySettingsConsole = () => {
    const on = !!getSave().svConsole;
    document.getElementById('btnSettingsConsole').textContent = on ? 'консоль: вкл' : 'консоль: выкл';
  };
  document.getElementById('btnSettingsConsole').onclick = () => {
    const s = getSave();
    s.svConsole = !s.svConsole;
    saveNow();
    applySettingsConsole();
    /* выключили на открытой консоли — закрываем её */
    if (!s.svConsole && typeof CON !== 'undefined' && CON.open && typeof conClose === 'function') conClose();
  };
  document.getElementById('btnSettings').onclick = () => { applySettingsSound(); applySettingsConsole(); applyFxSettings(); showScreen('settings'); };

  /* Доступность: тряска/вспышки/аберрация (авто → вкл → выкл) и скорость текста.
     «Авто» = по prefers-reduced-motion (fx.js fxEnabled). Гейтится на каждый
     вызов, поэтому смена действует немедленно — даже посреди уровня. */
  const fxLabel = (v) => v === true ? 'вкл' : v === false ? 'выкл' : 'авто';
  const applyFxSettings = () => {
    const s = getSave();
    for (const [id, key] of [['btnFxShake', 'fxShake'], ['btnFxFlash', 'fxFlash'], ['btnFxChroma', 'fxChroma']]) {
      const b = document.getElementById(id);
      if (b) b.textContent = fxLabel(s[key]);
    }
    const tb = document.getElementById('btnTextSpeed');
    if (tb) tb.textContent = s.textSpeed === 'fast' ? 'быстрая' : s.textSpeed === 'instant' ? 'мгновенно' : 'обычная';
  };
  const bindFxToggle = (id, key) => {
    const b = document.getElementById(id);
    if (!b) return;
    b.onclick = () => {
      const s = getSave();
      s[key] = s[key] === null ? true : (s[key] === true ? false : null);
      saveNow();
      applyFxSettings();
    };
  };
  bindFxToggle('btnFxShake', 'fxShake');
  bindFxToggle('btnFxFlash', 'fxFlash');
  bindFxToggle('btnFxChroma', 'fxChroma');
  const tsBtn = document.getElementById('btnTextSpeed');
  if (tsBtn) tsBtn.onclick = () => {
    const s = getSave();
    s.textSpeed = s.textSpeed === 'normal' ? 'fast' : (s.textSpeed === 'fast' ? 'instant' : 'normal');
    saveNow();
    applyFxSettings();
  };
  document.getElementById('btnBackSettingsMenu').onclick = () => showScreen('menu');
  document.getElementById('btnSettingsSound').onclick = () => { document.getElementById('btnSound').click(); applySettingsSound(); };
  document.getElementById('btnSettingsReset').onclick = () => document.getElementById('btnReset').click();
  const applySettingsSound = () => {
    const on = !!getSave().sound;
    document.getElementById('btnSettingsSound').textContent = on ? 'звук: вкл' : 'звук: выкл';
  };
  document.getElementById('btnFinalMenu').onclick = () => showScreen('menu');
  document.getElementById('btnOutroMenu').onclick = () => showScreen('menu');

  document.getElementById('btnRetry').onclick = () => {
    /* ⟲ раньше убивал попытку одним случайным тапом без вопросов */
    if (!window.confirm('Начать уровень заново? Время и смерти текущей попытки обнулятся.')) return;
    startGame(Game.L ? Game.L.idx : 0);
  };
  document.getElementById('btnQuit').onclick = () => { showScreen('menu'); };

  const sndBtn = document.getElementById('btnSound');
  const applySound = () => {
    const s = getSave();
    audioSetEnabled(s.sound);
    if (typeof musicSetEnabled === 'function') musicSetEnabled(s.sound);
    sndBtn.textContent = s.sound ? 'звук: вкл' : 'звук: выкл';
    sndBtn.classList.toggle('on', s.sound);
    applyVolumes();
  };
  /* ТЗ: ползунки громкости музыки/эффектов в настройках. */
  const rgMusic = document.getElementById('rgMusic');
  const rgSfx = document.getElementById('rgSfx');
  const applyVolumes = () => {
    if (rgMusic) rgMusic.value = Math.round(getSave().volMusic * 100);
    if (rgSfx) rgSfx.value = Math.round(getSave().volSfx * 100);
    const mv = document.getElementById('rgMusicVal'), sv = document.getElementById('rgSfxVal');
    if (mv) mv.textContent = rgMusic ? rgMusic.value + '%' : '';
    if (sv) sv.textContent = rgSfx ? rgSfx.value + '%' : '';
  };
  const onSlide = (key, rg) => () => {
    const s = getSave();
    s[key] = rg.value / 100;
    saveNow();
    if (typeof audioApplyVolumes === 'function') audioApplyVolumes();
    applyVolumes();
  };
  if (rgMusic) rgMusic.addEventListener('input', onSlide('volMusic', rgMusic));
  if (rgSfx) rgSfx.addEventListener('input', onSlide('volSfx', rgSfx));
  sndBtn.onclick = () => { const s = getSave(); s.sound = !s.sound; saveNow(); applySound(); audioResume(); };

  document.getElementById('btnReset').onclick = () => {
    /* один клик раньше стирал сейв без вопросов; спрашиваем всегда,
       чтобы случайное нажатие не убивало прогресс */
    if (!window.confirm('Сбросить весь прогресс?')) return;
    resetSave();
    /* сейв вернулся к sound:true и громкостям 1 — движок, подпись кнопки и
       ползунки обязаны подхватить это сразу, иначе «звук: выкл» и тишина
       остаются до перезагрузки страницы. */
    applySound();
    buildLevelGrid();
    showScreen('menu');
  };

  /* пауза по Escape */
  /* Зум браузера запрещён: Ctrl+колесо и Ctrl+= / Ctrl+- / Ctrl+0 отменяем.
     Ctrl+0 тоже блокируем, чтобы не сбросить блокировку. */
  window.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });
  window.addEventListener('keydown', (e) => {
    if (e.ctrlKey && (e.key === '=' || e.key === '+' || e.key === '-' || e.key === '_' || e.key === '0' || e.code === 'Equal' || e.code === 'Minus' || e.code === 'Digit0' || e.code === 'NumpadAdd' || e.code === 'NumpadSubtract' || e.code === 'Numpad0')) {
      e.preventDefault();
    }
  }, true);
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Escape') return;
    /* консоль открыта — ESC закрывает её, а не уводит в меню */
    if (typeof CON !== 'undefined' && CON.open) { if (typeof conClose === 'function') conClose(); return; }
    /* окна (настройки/уровни/части) живут поверх меню и не меняют
       UI.current — без этой ветки ESC их не закрывал */
    const winOpen = document.querySelector('.win-dim.active');
    if (winOpen) { showScreen('menu'); return; }
    /* игра: пауза-оверлей вместо выброса в меню (см. togglePause) */
    if (UI.current === 'game') togglePause();
  });

  /* сенсорные кнопки */
  bindTouch(document.getElementById('tLeft'), 'left');
  bindTouch(document.getElementById('tRight'), 'right');
  bindTouch(document.getElementById('tJump'), 'jump');
  bindTouch(document.getElementById('tShout'), 'shout');

  /* загрузка ассетов */
  const bar = document.getElementById('loadFill');
  const lbl = document.getElementById('loadLbl');
  loadAssets((p) => {
    bar.style.width = Math.round(p * 100) + '%';
    lbl.textContent = Math.round(p * 100) + '%';
  }).then(() => {
    applySound();
    buildLevelGrid();
    applyMenuState();
    /* литерал в разметке не может знать число глав: ставим из levelCount() */
    const loadSub = document.getElementById('loadSub');
    if (loadSub) loadSub.textContent = levelCount() + ' уровней';
    if (ASSETS.errors.length) {
      console.warn('не загрузились:', ASSETS.errors);
      lbl.textContent = 'часть текстур не найдена — см. консоль';
    }
    showScreen('menu');
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

/* Autoplay-барьер: музыка (меню/уровень) ждёт первого жеста пользователя.
   Каждый keydown/pointerdown пытается разблокировать, пока не получится. */
function musicUngateOnce() {
  if (typeof musicUngate === 'function') musicUngate();
}
window.addEventListener('pointerdown', musicUngateOnce);
window.addEventListener('keydown', musicUngateOnce);
