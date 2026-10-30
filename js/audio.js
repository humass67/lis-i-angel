/* audio.js — весь звук синтезируется через WebAudio, музыка уровней — <audio>.
   Коррупция уровня расстраивает тембры: detune + шум + сдвиг фильтра.
   Музыка идёт ОТДЕЛЬНОЙ шиной (musicGain → destination, мимо master/lp),
   чтобы «Тишина» (ур.7) глушила мир, а не музыку. */
'use strict';

const SND = {
  ctx: null,
  master: null,
  enabled: true,
  corruption: 0,
  muffle: 0,        // 0..1 — уровень «глухоты» (ур.7)
  _wind: null,
  _drone: null,
};

function audioInit() {
  if (SND.ctx) return SND.ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  SND.ctx = new AC();
  SND.master = SND.ctx.createGain();
  SND.master.gain.value = 0.55;
  /* музыкальная шина: напрямую в destination, мимо master и лоу-пасса */
  SND.musicGain = SND.ctx.createGain();
  SND.musicGain.gain.value = SND.enabled ? MUSIC_VOLUME : 0;
  SND.musicGain.connect(SND.ctx.destination);
  /* глобальный лоу-пасс: на ур.7 «затыкает» мир */
  SND.lp = SND.ctx.createBiquadFilter();
  SND.lp.type = 'lowpass';
  SND.lp.frequency.value = 18000;
  SND.master.connect(SND.lp);
  SND.lp.connect(SND.ctx.destination);
  audioApplyVolumes();   /* сохранённые громкости действуют с первого звука */
  return SND.ctx;
}

function audioResume() {
  if (!SND.ctx) audioInit();
  if (SND.ctx && SND.ctx.state === 'suspended') SND.ctx.resume();
}

function audioSetEnabled(v) {
  SND.enabled = !!v;
  /* Выключили звук — снимаем и уже запланированные «догоняющие» ноты,
     иначе они договаривают после mute. */
  if (!SND.enabled && typeof sfxCancelPending === 'function') sfxCancelPending();
  audioApplyVolumes();
}

/* Множитель громкости звучащего трека (у уровня 9 — 0.75, у остальных 1). */
function musicVolFactor() {
  return SND._music && SND._music.vol != null ? SND._music.vol : 1;
}

/* Ползунки настроек: volMusic/volSfx 0..1. Применяем к шинам.
   sfx = master (там все эффекты); музыка = musicGain поверх трека. */
function audioApplyVolumes() {
  const vm = (typeof getSave === 'function' ? (getSave().volMusic ?? 1) : 1);
  const vs = (typeof getSave === 'function' ? (getSave().volSfx ?? 1) : 1);
  const on = SND.enabled;
  const mv = MUSIC_VOLUME * vm * musicVolFactor();
  if (SND.master) SND.master.gain.value = on && SND.muffle < 1 ? 0.55 * vs : 0;
  if (SND.musicGain) SND.musicGain.gain.value = on ? mv : 0;
  /* Запасной путь: если трек не удалось завести в граф (нет ctx/WebAudio),
     он играет напрямую — тогда громкость даём самим элементом, иначе ползунок
     «Музыка» и «звук: выкл» на нём не срабатывают. */
  const m = SND._music;
  if (m && m.el && !m.routed) {
    m.el.volume = Math.max(0, Math.min(1, on ? mv : 0));
  }
  /* Тот же запасной путь для пула секций босса: под file:// они тоже не в графе. */
  if (SND._bossPool) {
    for (const k in SND._bossPool) {
      const b = SND._bossPool[k];
      if (b && b.el && !b.routed) b.el.volume = Math.max(0, Math.min(1, on ? mv : 0));
    }
  }
}

/* ───────────────── музыка уровней ─────────────────
   Треки выровнены ffmpeg loudnorm (I=-16 LUFS, TP=-1.5 dB) —
   разные исходники играют на одной громкости. */
const MUSIC_VOLUME = 0.6;
const MUSIC_TRACKS = {
  1: 'assets/music/level1.ogg',
  2: 'assets/music/level2.ogg',
  4: 'assets/music/level4.ogg',
  6: 'assets/music/level6.ogg',
  8: 'assets/music/level8.ogg',
  9: 'assets/music/level9.ogg',
};
/* Множитель громкости конкретного трека поверх MUSIC_VOLUME.
   Уровень 9 — 75 %: 0.6 x 0.75 = 0.45 при ползунке «Музыка» на 100 %. */
const MUSIC_TRACK_VOL = {
  9: 0.75,
};
/* Финальная песня (после 10 уровня). Файл кладёт автор проекта:
   assets/music/final_song.ogg; пока его нет — играет трек уровня 9. */
const FINAL_SONG = 'assets/music/final_song.ogg';
function musicFinal() { musicPlayUrl(FINAL_SONG, 0.85); }

/* ────────── плеер финальной песни («брызги») ──────────
   Песня играет через общий музыкальный канал (musicFinal() из последней
   реплики монолога). Плеер на экране финала управляет этим же элементом —
   второй <audio> не заводим, пауза/перемотка не спорят с музыкой меню. */
function finalSongEl() {
  return SND._music && SND._music.url === FINAL_SONG ? SND._music.el : null;
}
function finalSongPlaying() {
  const el = finalSongEl();
  return !!(el && !el.paused);
}
/* Тап-анализатор музыкальной шины: «брызги» рисуются по спектру того,
   что реально слышно (после musicGain). Узел-терминал, сигнал не меняет. */
function finalPlayerAnalyser() {
  if (SND._fpAn) return SND._fpAn;
  if (SND._fpAnTried) return null;                       /* один раз не вышло — не спамим */
  if (!SND.ctx || !SND.musicGain || !SND.ctx.createAnalyser) return null;
  let an = null;
  try {
    an = SND.ctx.createAnalyser();
    an.fftSize = 64;
    /* берём сигнал ДО регулятора громкости, иначе на тихом звуке столбики гаснут */
    const tap = (SND._music && SND._music.el && SND._music.el._src) || SND.musicGain;
    tap.connect(an);
  } catch (e) { an = null; }
  SND._fpAn = an;
  SND._fpAnTried = true;
  return an;
}

/* Громкость музыки из плеера финала — тот же ползунок, что «Музыка» в настройках. */
function finalPlayerVolume() {
  return (typeof getSave === 'function' ? (getSave().volMusic ?? 1) : 1);
}
function finalPlayerSetVolume(v) {
  v = Math.max(0, Math.min(1, v));
  if (typeof getSave === 'function') {
    const s = getSave();
    s.volMusic = v;
    if (typeof saveNow === 'function') saveNow();
  }
  audioApplyVolumes();
  /* держим ползунок в настройках в согласии — состояние одно */
  const rg = document.getElementById('rgMusic');
  if (rg) {
    rg.value = String(Math.round(v * 100));
    const lbl = document.getElementById('rgMusicVal');
    if (lbl) lbl.textContent = rg.value + '%';
  }
  return v;
}
/* Пауза/продолжить. true — после вызова песня играет. */
function finalPlayerToggle() {
  const el = finalSongEl();
  if (!el) { musicFinal(); return true; }   /* песня ещё не стартовала — стартуем */
  if (el.paused) {
    const p = el.play();
    if (p && p.catch) p.catch(() => {});
    return true;
  }
  el.pause();
  return false;
}
/* Перемотка (0..1) — по готовым метаданным. */
function finalPlayerSeek(f) {
  const el = finalSongEl();
  if (el && isFinite(el.duration) && el.duration > 0)
    el.currentTime = Math.max(0, Math.min(1, f)) * el.duration;
}

function musicSetEnabled(v) { audioApplyVolumes(); }

/* Играть трек по url. Нет url — тишина.
   Один <audio> на игру; тот же трек при retry не перезапускается. */
/* file:// — opaque origin: Chrome заводит <audio> в MediaElementSource, но
   выдаёт из узла ТИШИНУ (элемент «играет», звука нет). В этом режиме не
   роутим элемент в граф, а громкость отдаём самому элементу (см.
   audioApplyVolumes: ветка !routed). На http:// всё как раньше. */
function audioNoMediaRouting() {
  return typeof location !== 'undefined' && location.protocol === 'file:';
}

function musicPlayUrl(url, vol) {
  if (!url) { musicStop(); return; }
  const v = vol == null ? 1 : vol;
  /* тот же трек уже стоит: продолжаем с места (retry/возврат в меню) */
  if (SND._music && SND._music.url === url) {
    SND._music.vol = v;          /* громкость могла смениться вместе с уровнем */
    audioApplyVolumes();
    const cur = SND._music.el;
    if (cur && cur.paused) {
      const p2 = cur.play();
      if (p2 && p2.then) p2.then(() => { SND._musicGated = false; }).catch(() => { SND._musicGated = true; });
      else SND._musicGated = false;
    }
    return;
  }
  musicStop();
  /* Контекст обязан существовать ДО создания элемента: иначе
     createMediaElementSource не вызвать и трек уйдёт прямо в колонки,
     мимо musicGain (ползунок музыки/«выкл»/«Тишина» перестают работать). */
  audioResume();
  /* Один элемент на всю музыку уровней/меню, а не new Audio() на каждый трек.
     createMediaElementSource вызывается для элемента ТОЛЬКО ОДИН РАЗ, а
     созданный узел держит элемент живым: прежняя схема плодила пару
     «элемент + MediaElementAudioSourceNode» на каждую смену трека (уровень →
     меню → уровень) и в долгой сессии копила граф Web Audio впустую.
     Теперь элемент создаётся один раз, дальше меняется только src. */
  let el = SND._levelEl;
  if (!el) {
    el = new Audio();
    el._pooled = true;   /* musicStop не должен обнулять src у переиспользуемого */
    el.loop = true;
    el.preload = 'auto';
    if (SND.ctx && SND.musicGain && SND.ctx.createMediaElementSource && !audioNoMediaRouting()) {
      try {
        const src = SND.ctx.createMediaElementSource(el);
        src.connect(SND.musicGain);
        el._src = src;
        el._routed = true;
      } catch (e) { el._routed = false; /* без WebAudio — громкость через el.volume */ }
    }
    /* файла песни нет — откат на трек 9, чтобы финал не молчал */
    if (el.addEventListener) el.addEventListener('error', () => {
      if (SND._music && SND._music.url === FINAL_SONG) musicPlayUrl(MUSIC_TRACKS[9], MUSIC_TRACK_VOL[9]);
    });
    SND._levelEl = el;
  }
  const routed = !!el._routed;
  /* _url, а не getAttribute: в тестовом харнессе Audio — обычный объект. */
  if (el._url !== url) {
    try { el.pause(); } catch (e) {}
    el.src = url;
    el._url = url;
    try { el.currentTime = 0; } catch (e) {}
  }
  SND._music = { el, url, routed, vol: v };
  SND._lastTrack = url;   /* меню вернёт именно этот трек, даже если уровень был без музыки */
  SND._lastVol = v;
  audioApplyVolumes();    /* сразу применяем ползунки к новому треку */
  const p = el.play();
  if (p && p.catch) p.catch(() => { SND._musicGated = true; });
  /* autoplay-барьер: музыка стартует с первого жеста (см. main.js boot). */
}

function musicStart(idx) {
  musicPlayUrl(MUSIC_TRACKS[idx + 1], MUSIC_TRACK_VOL[idx + 1]);
}

function musicStop() {
  SND._bossWant = null;      /* вышли из боя — желаемая секция босса сброшена */
  SND._bossLock = false;
  if (!SND._music) return;
  const el = SND._music.el;
  SND._music = null;
  try { el.pause(); } catch (e) {}
  if (!el._pooled) { try { el.src = ''; } catch (e) {} }
}

/* Разблокировка autoplay: браузер запрещает звук до жеста пользователя.
   Вызывается из main.js на первый pointerdown/keydown. */
function musicUngate() {
  if (!SND._musicGated || !SND._music) return;
  audioResume();   /* ctx мог остаться suspended — без resume play() снова откажет */
  const el = SND._music.el;
  const p = el.play();
  /* Флаг снимаем ТОЛЬКО после реального старта: при отказе оставляем его,
     чтобы следующий жест попробовал снова (иначе музыка глохла навсегда). */
  if (p && p.then) p.then(() => { SND._musicGated = false; }).catch(() => {});
  else SND._musicGated = false;
}

/* Музыка меню: трек нынешнего уровня (ТЗ).
   Порядок: 1) уже играет — продолжаем, ничего не перезапуская;
   2) трек lastLevel; 3) последний реально звучавший трек (уровни 3/5/7/10
   без музыки — иначе меню оставалось глухим, баг «вышел в меню — тишина»);
   4) первый трек. Меню без музыки не остаётся. */
function musicMenu() {
  if (SND._music && SND._music.el && !SND._music.el.paused) return;
  let idx = 0;
  try { idx = (typeof getSave === 'function' ? (getSave().lastLevel | 0) : 0) || 0; } catch (e) { idx = 0; }
  if (MUSIC_TRACKS[idx + 1]) { musicStart(idx); return; }
  if (SND._lastTrack) { musicPlayUrl(SND._lastTrack, SND._lastVol); return; }
  musicStart(0);
}

/* ───────────── музыка секций босса (ур.10) ─────────────
   ТЗ: у каждой секции свой трек; трек ВСЕГДА доигрывает до конца,
   при длинной секции зацикливается, при смене секции НЕ обрезается —
   переключение только на естественном конце трека ('ended').
   Порядок (ТЗ): intro → attack → stan1 → attack2 → stan2 → stan3,
   дальше станы идут по кругу, а атаки всегда attack2. */
/* Номера секций идут ПО ФАЗАМ боя: 0 intro, 1 атака, 2 стан1, 3 атака2,
   4 стан2, 5 атака2, 6 стан3, 7 атака2, 8 стан1, … Каждая фаза меняет трек:
   станы идут по кругу 1→2→3, а все атаки после первой — attack2. */
function bossTrackAt(n) {
  const i = Math.max(0, n | 0);
  if (i === 0) return 'assets/music/boss_intro.ogg';
  if (i % 2 === 1) {
    return i === 1 ? 'assets/music/boss_attack.ogg'      /* первая атака */
                   : 'assets/music/boss_attack2.ogg';    /* все следующие */
  }
  const s = ((i / 2) - 1) % 3;               /* 2→stan1, 4→stan2, 6→stan3, 8→stan1 */
  return 'assets/music/boss_stan' + (s + 1) + '.ogg';
}

/* Номинальная длина трека (ffprobe: intro 4 с, атака 16 с, стан 8 с).
   Фаза боя живёт ровно столько — трек успевает доиграть до конца. */
const BOSS_TRACK_LEN = { boss_intro: 4, boss_attack: 16, boss_attack2: 16,
                         boss_stan1: 8, boss_stan2: 8, boss_stan3: 8 };

/* Пул дорожек боя: элемент создаётся и ДЕКОДИРУЕТСЯ заранее, один раз.
   На стыке секций остаётся только play() — иначе слышен провал тишины,
   пока браузер тянет и разбирает файл. */
const BOSS_PREWARM = ['boss_intro', 'boss_attack', 'boss_attack2',
                      'boss_stan1', 'boss_stan2', 'boss_stan3'];

function bossElFor(url) {
  SND._bossPool = SND._bossPool || {};
  if (SND._bossPool[url]) return SND._bossPool[url];
  const el = new Audio();
  el._pooled = true;
  el.loop = false;          /* конец трека обрабатываем сами: цикл или смена секции */
  el.preload = 'auto';
  el.src = url;
  let routed = false;
  let src = null;
  if (SND.ctx && SND.musicGain && SND.ctx.createMediaElementSource && !audioNoMediaRouting()) {
    try {
      src = SND.ctx.createMediaElementSource(el);
      src.connect(SND.musicGain);
      routed = true;
    } catch (e) { src = null; /* без WebAudio — громкость через el.volume */ }
  }
  try { el.load(); } catch (e) {}
  const ent = { el, routed };
  SND._bossPool[url] = ent;
  /* Первый play() на свежем элементе тратит 300-500 мс на инициализацию
     декодера — если это первый удар боя, слышен провал. Поэтому «прогреваем»
     элемент заранее: короткий проигрыш через gain=0 (тишина гарантирована,
     общий musicGain не трогаем), затем пауза и сброс в 0. Стык секций после
     прогрева — единицы миллисекунд. */
  if (src) {
    const warmup = function () {
      el.removeEventListener('canplay', warmup);
      const m = SND._music;
      if (m && m.el === el) return;              /* уже поёт в бою — не мешаем */
      let g = null;
      try { el.muted = true; } catch (e) {}
      try {
        g = SND.ctx.createGain();
        g.gain.value = 0;
        g.connect(SND.ctx.destination);
        src.disconnect();
        src.connect(g);
        const stop = function () {
          const cur = SND._music;
          if (!(cur && cur.el === el)) {         /* не перебили настоящий трек */
            try { el.pause(); el.currentTime = 0; } catch (e) {}
          }
          try { src.disconnect(); src.connect(SND.musicGain); } catch (e) {}
          try { g.disconnect(); } catch (e) {}
          try { el.muted = false; } catch (e) {}
        };
        const p = el.play();
        if (p && p.then) p.then(function () { setTimeout(stop, 90); }).catch(stop);
        else setTimeout(stop, 90);
      } catch (e) {
        try { el.muted = false; } catch (e2) {}
        try { if (g) g.disconnect(); } catch (e2) {}
        try { src.disconnect(); src.connect(SND.musicGain); } catch (e2) {}
      }
    };
    if (el.readyState >= 3) warmup();
    else el.addEventListener('canplay', warmup);
  }
  return ent;
}

/* Прогреть все секции один раз — на старте уровня, не в бою.
   audioResume обязателен: элемент, созданный до ctx, навсегда остаётся
   вне musicGain — ползунок «Музыка» и «звук: выкл» на нём не работают. */
function bossMusicPrewarm() {
  audioResume();
  for (const k of BOSS_PREWARM) bossElFor('assets/music/' + k + '.ogg');
}

/* Запустить трек секции с нуля. Предыдущий глушится — два трека разом нельзя. */
function bossMusicPlay(url) {
  audioResume();
  const prev = SND._music;
  const ent = bossElFor(url);
  const el = ent.el;
  el.onended = null;
  try { el.currentTime = 0; } catch (e) {}
  SND._music = { el, url, routed: ent.routed, vol: 1, boss: true, ended: false };
  /* Раньше здесь писалось SND._lastTrack = url, и после финала меню
     зацикливало 4–16-секундный боевой трек босса: musicMenu() для
     lastLevel=9 не находит MUSIC_TRACKS[10] и падает в _lastTrack.
     Боссовые треки «треком меню» быть не должны — не записываем их. */
  if (prev && prev.el && prev.el !== el) {
    try { prev.el.pause(); } catch (e) {}     /* предыдущий трек уходит мгновенно */
  }
  audioApplyVolumes();
  el.onended = function () {
    const m = SND._music;
    if (!m || m.el !== el) return;      /* трек уже сменили — этот конец не наш */
    m.ended = true;
    /* Конец трека = конец фазы. Движок объявит новую секцию в ближайшем
       кадре, поэтому опрос идёт ПО КАДРАМ, а не раз в 100мс: иначе на
       стыке слышен провал тишины. */
    let frames = 0;
    (function poll() {
      const m2 = SND._music;
      if (!m2 || m2.el !== el) return;  /* секцию уже сменили — не мешаем */
      if (SND._bossWant && SND._bossWant !== url) { bossMusicPlay(SND._bossWant); return; }
      if (++frames < 30) setTimeout(poll, 16);   /* ~0.5с, работает и в скрытой вкладке */
      else bossMusicPlay(SND._bossWant || url);         /* секция длиннее музыки */
    })();
  };
  const p = el.play();
  if (p && p.catch) p.catch(function () { SND._musicGated = true; });
}

/* Чего хотим слышать. Обрезки нет: пока трек играет — доиграет и
   переключится на 'ended'. Нужный уже звучит — не перезапускаем. */
function bossMusicSet(url) {
  SND._bossWant = url || null;
  const m = SND._music;
  if (m && m.boss && !m.ended) return;
  if (!url) { if (m && m.boss) musicStop(); return; }
  bossMusicPlay(url);
}

/* Возвращает длину трека секции (сек): её движок берёт как длительность
   фазы — трек атаки кончается ровно с концом атаки, трек стана — с концом
   окна уязвимости. */
function bossMusicSection(n, force) {
  if (!(n | 0)) bossMusicPrewarm();   /* подготовили все секции заранее */
  const url = bossTrackAt(n);
  /* force — начало боя: intro уже крутился сквозь вступительный диалог и
     зациклился, поэтому первую фазу начинаем с нуля (своя же дорожка). */
  if (!SND._bossLock) {
    if (force) bossMusicPlay(url); else bossMusicSet(url);
  }                                  /* босс мёртв: финальный трек уже выбран */
  const key = url.replace(/^assets\/music\//, '').replace(/\.ogg$/, '');
  return BOSS_TRACK_LEN[key] || 8;
}

/* Реальная длина играющего трека босса: Vorbis в браузере считает её чуть
   иначе, чем ffprobe, — движок подтягивает таймер фазы к ней. */
function bossMusicElDuration() {
  const m = SND._music;
  if (!m || !m.boss || !m.el) return 0;
  const d = m.el.duration;
  return (typeof d === 'number' && isFinite(d) && d > 2) ? d : 0;
}

/* Позиция трека секции: {dur, ct, playing} — по ней движок ведёт таймер
   фазы, чтобы стадия кончалась ровно с концом своего трека. Играет другая
   секция (url не совпал) — null: фаза идёт по dt. */
function bossMusicPos(url) {
  const m = SND._music;
  if (!m || !m.boss || !m.el) return null;
  if (url && m.url !== url) return null;
  const d = m.el.duration;
  if (!(typeof d === 'number' && isFinite(d) && d > 1)) return null;
  return { dur: d, ct: m.el.currentTime || 0, playing: !m.el.paused && !m.ended };
}

/* fox — диалог после смерти Стража, fox attack — бой с Лисом. */
function bossMusicFox(kind) {
  SND._bossLock = true;           /* дальше только финальные треки, удары не перебивают */
  bossMusicSet(kind === 'fight' ? 'assets/music/boss_fox_attack.ogg'
                               : 'assets/music/boss_fox.ogg');
}

function bossMusicStop() {
  SND._bossWant = null;
  SND._bossLock = false;
  if (SND._music && SND._music.boss) musicStop();
}

function audioSetCorruption(c) {
  SND.corruption = c;
  if (SND.lp) {
    /* чем выше коррупция, тем глуше и грязнее */
    const target = SND.muffle > 0 ? lerp(18000, 700, SND.muffle)
                                  : lerp(18000, 5200, c);
    SND.lp.frequency.value = target;
  }
}
function audioSetMuffle(m) {
  SND.muffle = m;
  audioSetCorruption(SND.corruption);
  /* раньше здесь жёстко писалось 0.55 — это обнуляло ползунок «Эффекты»
     (audioSetMuffle зовётся на каждом старте уровня и на сценах). */
  audioApplyVolumes();
}

/* Шумовой буфер (кэшируем) */
function noiseBuf() {
  if (SND._noise) return SND._noise;
  const ctx = SND.ctx;
  const len = Math.floor(ctx.sampleRate * 1.6);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  SND._noise = buf;
  return buf;
}

/* Базовый тон с конвертом */
function tone(freq, dur, type, vol, detuneCents, slideTo) {
  if (!SND.enabled || !SND.ctx) return;
  const ctx = SND.ctx, t = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type || 'sine';
  o.frequency.value = freq;
  const det = (detuneCents || 0) + (Math.random() - 0.5) * SND.corruption * 60;
  o.detune.value = det;
  if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
  const v = (vol == null ? 0.2 : vol);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(v, t + Math.min(0.02, dur * 0.2));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(SND.master);
  o.start(t); o.stop(t + dur + 0.02);
}

/* Шумовой всплеск через фильтр */
function noise(dur, freq, q, vol, type) {
  if (!SND.enabled || !SND.ctx) return;
  const ctx = SND.ctx, t = ctx.currentTime;
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf();
  s.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = type || 'bandpass';
  f.frequency.value = freq;
  f.Q.value = q == null ? 1 : q;
  const g = ctx.createGain();
  const v = vol == null ? 0.15 : vol;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(v, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(SND.master);
  s.start(t); s.stop(t + dur + 0.02);
}

/* ───────────────── игровые звуки ───────────────── */

function sfxJump() {
  tone(340, 0.16, 'triangle', 0.16, 0, 520);
  noise(0.08, 900, 0.8, 0.05);
}
function sfxLand() {
  tone(140, 0.10, 'sine', 0.14, 0, 90);
  noise(0.07, 380, 1.2, 0.07, 'lowpass');
}
function sfxStep(i) {
  noise(0.045, 500 + (i % 2) * 160, 1.5, 0.045);
}
function sfxDeath() {
  tone(220, 0.5, 'sawtooth', 0.18, -40, 60);
  noise(0.4, 300, 0.7, 0.14, 'lowpass');
}
function sfxFlower() {
  tone(880, 0.18, 'sine', 0.10, 0, 1180);
  tone(1320, 0.14, 'sine', 0.05);
}
function sfxShout() {
  /* крик Ангела — формантный, с эхом */
  if (!SND.enabled || !SND.ctx) return;
  tone(420, 0.30, 'sawtooth', 0.14, 0, 300);
  tone(640, 0.26, 'triangle', 0.08);
  sfxLater(() => { tone(380, 0.22, 'sine', 0.07, 0, 280); }, 170);
  sfxLater(() => { tone(340, 0.18, 'sine', 0.04, 0, 250); }, 340);
}
function sfxEchoAppear() {
  tone(660, 0.14, 'square', 0.06, 0, 880);
}
function sfxDenied() {
  /* «здесь это не работает»: короткий глухой щелчок — мёртвая клавиша
     раньше молчала, и игрок решал, что управление сломано */
  tone(140, 0.05, 'square', 0.04);
}
function sfxCheckpoint() {
  /* чекпойнт: мягкая восходящая пара, заметно тише «цветка» — сигнал «сохранило» */
  tone(520, 0.12, 'sine', 0.07, 0, 660);
  tone(780, 0.16, 'sine', 0.05);
}
function sfxShadow() {
  noise(0.35, 180, 0.6, 0.10, 'lowpass');
  tone(90, 0.4, 'sawtooth', 0.07, 0, 60);
}
/* Продолжительное нагнетание для реплики «Не слушай.» (ур.3).
   sfxShadow длится 0,4 с — в тишине уровня это читается как случайный
   щелчок, а не как угроза. Здесь пятисекундный подъём: два расстроенных
   тона ползут вверх (38→99 Гц и 57→148 Гц), шум нарастает по полосовому
   фильтру (240→2600 Гц), громкость «дышит» ускоряющимся тремоло. Узлы
   держим в SND._long, чтобы снять звук при смене уровня и выходе в меню. */
function sfxShadowLong() {
  if (!SND.enabled || !SND.ctx) return;
  sfxShadowLongStop();          /* повторный вызов не наслаивает два подъёма */
  const ctx = SND.ctx, t0 = ctx.currentTime, dur = 5;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.15, t0 + dur * 0.9);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + 0.3);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = 5;
  lp.frequency.setValueAtTime(160, t0);
  lp.frequency.exponentialRampToValueAtTime(760, t0 + dur);
  lp.connect(g); g.connect(SND.master);
  const voices = [38, 57].map((f, i) => {
    const o = ctx.createOscillator();
    o.type = i ? 'sawtooth' : 'sine';
    o.frequency.setValueAtTime(f, t0);
    o.frequency.exponentialRampToValueAtTime(f * 2.6, t0 + dur);
    o.connect(lp);
    o.start(t0); o.stop(t0 + dur + 0.4);
    return o;
  });
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf();
  s.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.Q.value = 1.2;
  bp.frequency.setValueAtTime(240, t0);
  bp.frequency.exponentialRampToValueAtTime(2600, t0 + dur);
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.0001, t0);
  ng.gain.exponentialRampToValueAtTime(0.06, t0 + dur);
  s.connect(bp); bp.connect(ng); ng.connect(g);
  s.start(t0); s.stop(t0 + dur + 0.4);
  /* тремоло ускоряется к концу — «нагнетает», а не просто гудит */
  const lfo = ctx.createOscillator();
  lfo.frequency.setValueAtTime(4.2, t0);
  lfo.frequency.exponentialRampToValueAtTime(7.5, t0 + dur);
  const lg = ctx.createGain();
  lg.gain.value = 0.045;
  lfo.connect(lg); lg.connect(g.gain);
  lfo.start(t0); lfo.stop(t0 + dur + 0.4);
  SND._long = { g, lp, bp, ng, lfo, lg, voices, s };
}
function sfxShadowLongStop() {
  const x = SND._long;
  if (!x) return;
  const kill = (n) => {
    try { n.stop(); } catch (e) { /* уже остановлен */ }
    try { n.disconnect(); } catch (e) { /* не был подключён */ }
  };
  x.voices.forEach(kill); kill(x.s); kill(x.lfo); kill(x.lg);
  kill(x.lp); kill(x.bp); kill(x.ng); kill(x.g);
  SND._long = null;
}
function sfxRift() {
  tone(70, 0.45, 'square', 0.12, 0, 180);
  noise(0.35, 240, 0.5, 0.12, 'lowpass');
}
function sfxCrumble() {
  noise(0.22, 420, 1.0, 0.10, 'bandpass');
  tone(160, 0.18, 'triangle', 0.07, 0, 90);
}
function sfxDoor() {
  tone(180, 0.6, 'sine', 0.12, 0, 320);
  tone(270, 0.5, 'sine', 0.08);
  sfxLater(() => tone(400, 0.4, 'sine', 0.06), 200);
}
function sfxDialog() {
  tone(1200 + Math.random() * 200, 0.02, 'square', 0.025);
}
function sfxBossSlam() {
  tone(60, 0.5, 'square', 0.22, 0, 40);
  noise(0.4, 200, 0.5, 0.2, 'lowpass');
}
function sfxBossHurt() {
  tone(300, 0.3, 'sawtooth', 0.2, -60, 140);
  noise(0.25, 900, 0.8, 0.12);
}
function sfxBossDie() {
  tone(120, 1.4, 'sawtooth', 0.22, -80, 40);
  noise(1.2, 300, 0.4, 0.18, 'lowpass');
}
/* Отложенные звуки: голый setTimeout не отменялся, поэтому аккорды и
   «догоняющие» ноты доигрывали после выключения звука, выхода в меню и смены
   уровня. Держим id, чтобы снимать их пачкой. */
function sfxLater(fn, ms) {
  const id = setTimeout(() => {
    SND._sfxT = (SND._sfxT || []).filter((x) => x !== id);
    fn();
  }, ms);
  (SND._sfxT = SND._sfxT || []).push(id);
  return id;
}
function sfxCancelPending() {
  const list = SND._sfxT || [];
  for (let i = 0; i < list.length; i++) clearTimeout(list[i]);
  SND._sfxT = [];
}
function sfxWin() {
  [523, 659, 784, 1047].forEach((f, i) =>
    sfxLater(() => tone(f, 0.35, 'sine', 0.13), i * 130));
}
/* Такт ритма (ур.5). mul — громкость такта относительно гула: на ур.5
   коррупция 0.45 держит дрон на ~0,031 непрерывно, и прежние 0,13/0,07
   в 90 мс тонули под ним. Тело удара (тот же низ, короче) добавляет
   плотности, чтобы такт читался сквозь гул. */
function sfxBeat(strong, mul) {
  const k = mul == null ? 1 : Math.max(0, mul);
  if (!(k > 0)) return;
  const f = strong ? 72 : 105;
  const v = (strong ? 0.13 : 0.07) * k;
  tone(f, strong ? 0.18 : 0.09, 'sine', v, 0, strong ? 46 : 75);
  tone(f * 0.6, strong ? 0.14 : 0.07, 'triangle', v * 0.55, 0, f * 0.35);
}
/* удар кульминации (док. ур.5, п.4): глубокий бас поверх тишины после замирания */
function sfxBoom() {
  tone(48, 0.9, 'sine', 0.22, 0, 30);
}

/* ───────────────── фон: ветер + дрон ───────────────── */
function ambientStart() {
  if (!SND.ctx || SND._wind) return;
  const ctx = SND.ctx;
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf();
  s.loop = true;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 420;
  const g = ctx.createGain();
  g.gain.value = 0.030;
  /* медленное «дыхание» ветра */
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.09;
  const lg = ctx.createGain();
  lg.gain.value = 0.018;
  lfo.connect(lg); lg.connect(g.gain);
  s.connect(f); f.connect(g); g.connect(SND.master);
  s.start(); lfo.start();
  SND._wind = { s, f, g, lfo, lg };

  /* дрон — включается с коррупцией */
  const o = ctx.createOscillator();
  o.type = 'sawtooth';
  o.frequency.value = 55;
  const og = ctx.createGain();
  og.gain.value = 0;
  const of_ = ctx.createBiquadFilter();
  of_.type = 'lowpass';
  of_.frequency.value = 260;
  o.connect(of_); of_.connect(og); og.connect(SND.master);
  o.start();
  SND._drone = { o, g: og, f: of_ };

  /* Коррупция уровня приходит РАНЬШЕ, чем создаётся фон (game.js:202 при
     построении уровня против ambientStart в gameStart), и раньше она молча
     терялась: обе ветки ambientSetCorruption под null-guard. Применяем
     сохранённое значение сразу после сборки графа. */
  if (SND._corr != null) {
    og.gain.value = (0.006 + SND._corr * 0.055) * (SND._droneMul == null ? 1 : SND._droneMul);
    f.frequency.value = lerp(420, 180, SND._corr);
  }
}

/* Остановить фон. Без этого ветер и дрон продолжают играть после выхода в меню:
   ambientStart() создаёт их один раз (SND._wind), а глушить их было нечем. */
function ambientStop() {
  /* stop() глушит звук, но узел остаётся в графе и держится за SND.master:
     ambientStart() на следующем входе строил новый комплект, и за сессию
     копились десятки GainNode/фильтров/осцилляторов. Отключаем явно. */
  const kill = (n) => {
    try { n.stop(); } catch (e) { /* не источник или уже остановлен */ }
    try { n.disconnect(); } catch (e) { /* не был подключён */ }
  };
  if (SND._wind) {
    kill(SND._wind.s); kill(SND._wind.lfo); kill(SND._wind.lg);
    kill(SND._wind.f); kill(SND._wind.g);
    SND._wind = null;
  }
  if (SND._drone) {
    kill(SND._drone.o); kill(SND._drone.f); kill(SND._drone.g);
    SND._drone = null;
  }
  sfxShadowLongStop();
  sfxCancelPending();
}

function ambientSetCorruption(c, droneMul) {
  SND._corr = c;   /* фон может быть ещё не создан — ambientStart применит */
  /* droneMul — приглушить гул уровня (ур.5: ритм должен быть громче гула) */
  SND._droneMul = droneMul == null ? 1 : droneMul;
  if (SND._drone) SND._drone.g.gain.value = (0.006 + c * 0.055) * SND._droneMul;
  if (SND._wind) SND._wind.f.frequency.value = lerp(420, 180, c);
  audioSetCorruption(c);
}
