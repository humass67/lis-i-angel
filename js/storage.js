/* storage.js — сохранение прогресса в localStorage. Версионированный ключ,
   слияние с defaults: битые/отсутствующие данные не ломают игру. */
'use strict';

const SAVE_KEY = 'fox-angel-save-v1';

const SAVE_DEFAULTS = {
  unlocked: 1,        // сколько уровней открыто (1..10)
  best: {},           // idx -> {deaths, timeSec}
  finished: false,
  sound: true,
  svConsole: false,   // консоль разработчика (клавиша P): тумблер в настройках
  volMusic: 1,        // громкость музыки 0..1 (ползунок в настройках)
  volSfx: 1,          // громкость эффектов 0..1 (ползунок в настройках)
  /* Доступность (fx.js fxEnabled): null = авто по prefers-reduced-motion,
     true/false — ручной выбор в настройках. По умолчанию всё включено. */
  fxShake: null,      // тряска экрана
  fxFlash: null,      // полноэкранные вспышки
  fxChroma: null,     // хроматическая аберрация
  textSpeed: 'normal', // 'normal' | 'fast' | 'instant' — скорость печати реплик
  deathsTotal: 0,
  lastLevel: 0,
  fragments: [],   // имена собранных «частей цвета» (без повторов)
};

let _save = null;

function getSave() {
  if (_save) return _save;
  let raw = null;
  try { raw = localStorage.getItem(SAVE_KEY); } catch (e) { raw = null; }
  const base = JSON.parse(JSON.stringify(SAVE_DEFAULTS));
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        Object.assign(base, parsed);
        /* best-массив (битый/правленый руками сейв) оставлял дыры null и ломал
           список уровней — массив тоже считаем невалидным. */
        if (!base.best || typeof base.best !== 'object' || Array.isArray(base.best)) base.best = {};
        /* Старые сейвы (до фикса recordLevel) хранят best[idx]={timeSec}
           без поля deaths — нормализуем null (нет данных), иначе deaths
           останется undefined и UI напечатает «undefined смертей».
           НЕ 0: нуль — это легитимный рекорд («0 смертей»), и сравнение
           deaths < 0 в recordLevel навсегда заблокировало бы запись. */
        for (const k in base.best) {
          const b = base.best[k];
          /* не-объект ({"best":{"0":5}} или {"0":"12:30"}) — мусор: раньше
             оставался как есть, и recordLevel падал на cur.timeSec = … с
             TypeError в strict mode. Уровень при этом уже помечен пройденным,
             но unlockLevel/onLevelDone не вызывались — игра замирала. */
          if (!b || typeof b !== 'object' || Array.isArray(b)) {
            delete base.best[k];
            continue;
          }
          if (typeof b.deaths !== 'number') b.deaths = null;
          if (typeof b.timeSec !== 'number') b.timeSec = null;
        }
        base.unlocked = Math.max(1, Math.min((typeof levelCount === 'function' ? levelCount() : 11), base.unlocked | 0));
        /* числа/булевы — тоже: битый сейв («{}» в deathsTotal) давал NaN
           ({}++ → NaN, в JSON уходил null) и счётчик смертей умирал навсегда. */
        /* отрицательное из битого сейва ({"deathsTotal":-5}) — не рекорд, а мусор:
           иначе счётчик так и живёт в минусе и врёт в статистике. */
        if (typeof base.deathsTotal !== 'number' || !isFinite(base.deathsTotal)) base.deathsTotal = 0;
        else base.deathsTotal = Math.max(0, Math.floor(base.deathsTotal));
        if (typeof base.lastLevel !== 'number' || base.lastLevel < 0) base.lastLevel = 0;
        if (typeof base.sound !== 'boolean') base.sound = true;
        base.finished = !!base.finished;
        if (typeof base.svConsole !== 'boolean') base.svConsole = false;
        /* громкости из битого сейва (строка/null/NaN) — дефолт 1 */
        for (const vk of ['volMusic', 'volSfx']) {
          const v = base[vk];
          if (typeof v !== 'number' || !isFinite(v)) base[vk] = 1;
          else base[vk] = Math.max(0, Math.min(1, v));
        }
        /* тумблеры доступности: только boolean или null (авто) */
        for (const fk of ['fxShake', 'fxFlash', 'fxChroma']) {
          const v = base[fk];
          if (v !== true && v !== false) base[fk] = null;
        }
        if (base.textSpeed !== 'fast' && base.textSpeed !== 'instant') base.textSpeed = 'normal';
        /* fragments из битого сейва строкой («"fragments":"нет"») — не список:
           main.js считает .length, и строка давала «3 из 5 памяти» на пустом сейве. */
        if (!Array.isArray(base.fragments)) base.fragments = [];
        /* миграция: фрагмент «ТИШИНА_2» переименован в «ТИШИНА II» (техническое
           имя светилось в окне частей) — иначе собравшие его теряли находку */
        base.fragments = base.fragments.map(n => (n === 'ТИШИНА_2' ? 'ТИШИНА II' : n));
      }
    } catch (e) { /* битый сейв — остаёмся на defaults */ }
  }
  _save = base;
  return _save;
}

function saveNow() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(getSave())); }
  catch (e) { /* приватный режим — играем без сохранения */ }
}

/* запоминаем фрагмент света навсегда (между сессиями) */
function collectFragment(name) {
  if (name === 'ТИШИНА_2') name = 'ТИШИНА II';   /* миграция старого технического имени */
  const s = getSave();
  if (!Array.isArray(s.fragments)) s.fragments = [];
  if (!s.fragments.includes(name)) { s.fragments.push(name); saveNow(); }
}

function unlockLevel(idx) {
  const s = getSave();
  /* потолок — фактическое число уровней: при хардкоде 10 не открывался 11-й */
  const want = Math.min((typeof levelCount === 'function' ? levelCount() : 11), idx + 2);   // idx 0-based -> открыть следующий
  if (want > s.unlocked) { s.unlocked = want; saveNow(); }
}

function recordLevel(idx, deaths, timeSec) {
  const s = getSave();
  let cur = s.best[idx];
  /* защита от не-объекта: рекорд не должен ронять завершение уровня */
  if (cur && (typeof cur !== 'object' || Array.isArray(cur))) { cur = null; s.best[idx] = null; }
  /* Рекорд по времени И по смертям независимо: раньше deaths перезаписывались
     вместе с timeSec, и забег с 99 смертями показывался «лучшим», если он был
     быстрее. UI (main.js) печатает именно best[idx].deaths. */
  if (!cur) s.best[idx] = { deaths, timeSec };
  else {
    if (cur.timeSec === null || cur.timeSec === undefined || timeSec < cur.timeSec) cur.timeSec = timeSec;
    if (cur.deaths === null || cur.deaths === undefined || deaths < cur.deaths) cur.deaths = deaths;
  }
  s.lastLevel = idx;
  saveNow();
}

function addDeath() {
  const s = getSave();
  s.deathsTotal++;
  /* Пишем СРАЗУ: смерть — единственное событие, после которого игрок легко
     бросает игру (закрыл вкладку, ушёл в меню), и без немедленной записи
     счётчик терялся. Не пишем только счётчик st.deaths — он живёт в Game.state
     и сохраняется вместе с рекордом уровня в recordLevel(). */
  saveNow();
}

function markFinished() {
  const s = getSave();
  s.finished = true;
  s.unlocked = (typeof levelCount === 'function' ? levelCount() : 11);
  saveNow();
}

function resetSave() {
  _save = JSON.parse(JSON.stringify(SAVE_DEFAULTS));
  saveNow();
}

/* Node-экспорт для тестов (tests/invariants_progress.js): в браузере не нужен,
   в Node getSave/saveNow работают — localStorage-обращения обёрнуты в try/catch. */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SAVE_KEY, SAVE_DEFAULTS,
    getSave, saveNow, collectFragment, unlockLevel, recordLevel, addDeath,
    markFinished, resetSave,
  };
}
