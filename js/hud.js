/* hud.js — HUD и диалоги в стиле визуальной новеллы (DOM поверх canvas).
   На уровнях 7-9 HUD скрывается по mech.hideHud — «исчезает информация». */
'use strict';

const HUD = {
  root: null, name: null, deaths: null,
  dialog: null, dName: null, dText: null,
  vnAngel: null, vnFox: null, vnCaret: null,
  hint: null, bossBar: null, bossFill: null,
  chapCard: null, chapN: null, chapName: null, chapSub: null,
  tShout: null,
  _lastText: '',
  _lastWho: null,
  _lastAngelSrc: '', _lastFoxSrc: '',
};

/* Кто вообще участвует в диалогах текущего уровня — чтобы не показывать
   Лиса там, где он ушёл (ур. 9 после триггера) или его нет. */
function hudInit() {
  HUD.root = document.getElementById('hud');
  HUD.name = document.getElementById('hudName');
  HUD.deaths = document.getElementById('hudDeaths');
  HUD.dialog = document.getElementById('dialog');
  HUD.dName = document.getElementById('dlgName');
  HUD.dText = document.getElementById('dlgText');
  HUD.vnAngel = document.getElementById('vnAngel');
  HUD.vnFox = document.getElementById('vnFox');
  HUD.vnCaret = document.getElementById('vnCaret');
  HUD.hint = document.getElementById('hint');
  HUD.bossBar = document.getElementById('bossBar');
  HUD.bossFill = document.getElementById('bossFill');
  HUD.chapCard = document.getElementById('chapterCard');
  HUD.chapN = document.getElementById('chapN');
  HUD.chapName = document.getElementById('chapName');
  HUD.chapSub = document.getElementById('chapSub');
  HUD.tShout = document.getElementById('tShout');
  /* на тач-раскладке подсказка «ENTER / SPACE» бессмысленна: диалог листается «▲» */
  if (HUD.vnCaret && typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) {
    HUD.vnCaret.textContent = '▲ ДАЛЬШЕ';
  }
}

function hudSetLevel(L) {
  if (!HUD.root) return;
  HUD.name.textContent = `${L.meta.n}. ${L.meta.name}`;
  HUD.root.classList.toggle('hidden', !!L.mech.hideHud);
  HUD.bossBar.classList.toggle('show', !!L.mech.boss);
  /* 11-я сцена: портрет Лиса переезжает в центр (styles.css .vn.cinematic) */
  HUD.dialog.classList.toggle('cinematic', !!L.mech.cinematic);
  /* кнопка «крик» активна только там, где механика есть — иначе мёртвая клавиша */
  if (HUD.tShout) HUD.tShout.classList.toggle('disabled', !L.mech.shout);

  /* карточка главы (~1.6 с): раньше название главы жило только мелкой строкой
     HUD, которая появлялась одновременно со стартовым диалогом и затиралась им */
  if (HUD.chapCard) {
    HUD.chapN.textContent = 'ГЛАВА ' + L.meta.n;
    HUD.chapName.textContent = L.meta.name;
    HUD.chapSub.textContent = L.meta.breaks;
    if (HUD._chapT1) clearTimeout(HUD._chapT1);
    if (HUD._chapT2) clearTimeout(HUD._chapT2);
    HUD.chapCard.hidden = false;
    HUD.chapCard.classList.remove('show');
    requestAnimationFrame(() => requestAnimationFrame(() => HUD.chapCard.classList.add('show')));
    HUD._chapT1 = setTimeout(() => {
      HUD.chapCard.classList.remove('show');
      HUD._chapT2 = setTimeout(() => { if (HUD.chapCard) HUD.chapCard.hidden = true; }, 480);
    }, 1600);
  }

  /* сброс портретов между уровнями */
  HUD._lastWho = null;
  HUD._lastText = '';
  HUD._lastAngelSrc = HUD._lastFoxSrc = '';
  for (const el of [HUD.vnAngel, HUD.vnFox]) {
    el.classList.remove('on', 'active', 'dim', 'gray');
    el.removeAttribute('src');
  }

  /* подсказка управления — только там, где механика новая */
  let hint = '';
  if (L.idx === 0) hint = '← →  двигаться      SPACE  прыжок';
  else if (L.mech.foxBark) hint = 'E — позвать Лиса: лай проявляет путь';
  else if (L.mech.shout) hint = 'E — крик: проявляет эхо-платформы';
  else if (L.mech.echoTwin) hint = 'не давай двойнику догнать себя';
  else if (L.mech.mirrorPortals) hint = 'вода переносит в отражение: мир переворачивается';
  else if (L.mech.rhythm) hint = 'платформы появляются в такт: жди удар';
  else if (L.mech.timeZones) hint = 'фиолетовые зоны тянут время, оранжевые гонят';
  else if (L.mech.rifts) hint = 'разломы переворачивают низ и верх';
  else if (L.mech.gravityZones) hint = 'синие зоны держат низ, красные переворачивают гравитацию';
  else if (L.mech.memoryBlocks) hint = 'путь виден только рядом — запоминай';
  else if (L.mech.invertZones) hint = 'в красных зонах управление наоборот';
  else if (L.mech.boss) hint = 'подведи руки Стража к двери; затем прыгай на Лиса сверху';
  /* стартовый диалог перекрывает подсказку: её 5.2 с тикали, пока игрок читал
     реплики, и текст молча уходил навсегда. Откладываем до закрытия диалога —
     показать её может nextDialog() (game.js) через HUD.pendingHint. */
  if ((Game.state && (Game.state.dialog || Game.state.dialogQueue.length))) {
    HUD.pendingHint = hint;
  } else {
    showHint(hint);
  }
}

let _hintT = null;
function showHint(text, ms) {
  if (!HUD.hint) return;
  if (_hintT) clearTimeout(_hintT);
  if (!text) { HUD.hint.classList.remove('show'); return; }
  HUD.hint.textContent = text;
  HUD.hint.classList.add('show');
  _hintT = setTimeout(() => HUD.hint.classList.remove('show'), ms || 5200);
}

const WHO_NAME = { angel: 'Ангел', fox: 'Лис' };
/* нейтральный портрет для молчащего персонажа */
const IDLE_FACE = { angel: 'angel_normal', fox: 'fox_normal' };

/* Кадры «рот закрыт / открыт»: пока реплика печатается, они чередуются,
   как в визуальной новелле. Ключ — спокойный кадр, значение — говорящий. */
const TALK_FACE = { fox_mono1: 'fox_mono2' };
function talkFace(key, d) {
  const open = TALK_FACE[key];
  if (!open || !d || d.done || d.shown >= d.text.length) return key;
  return Math.floor(d.t * 9) % 2 ? open : key;
}

function setFace(el, key, cacheField) {
  const src = ASSET_LIST[key];
  if (!src) return;
  if (HUD[cacheField] === src) return;
  el.setAttribute('src', src);
  HUD[cacheField] = src;
}

/* Убрать VN-слой целиком. Нужен при смене экрана: hudUpdate() в меню не
   вызывается, поэтому окно диалога и класс cinematic от 11-й сцены
   оставались висеть поверх меню и следующего уровня. */
function hudHide() {
  if (HUD.dialog) HUD.dialog.classList.remove('show', 'cinematic', 'over-scene');
  if (HUD.vnCaret) HUD.vnCaret.classList.remove('show');
  HUD._lastWho = null;
  HUD._lastText = null;
}

function hudUpdate() {
  const st = Game.state, L = Game.L;
  if (!st || !HUD.root) return;

  HUD.deaths.textContent = st.deaths > 0 ? ('смертей: ' + st.deaths) : '';

  const d = st.dialog;
  if (d) {
    HUD.dialog.classList.add('show');
    HUD.dialog.classList.toggle('over-scene', !!st.sceneImg);

    /* имя на плашке */
    if (HUD._lastWho !== d.who) {
      HUD.dName.textContent = WHO_NAME[d.who] || '';
      HUD.dName.className = 'vn-nameplate ' + d.who;
      HUD._lastWho = d.who;
    }

    /* печать текста */
    const txt = d.text.slice(0, d.shown);
    if (txt !== HUD._lastText) { HUD.dText.textContent = txt; HUD._lastText = txt; }

    /* портрет говорящего — эмоция из скрипта; слушающего — нейтральный */
    /* до встречи (st.foxActive=false) Лис не появляется в окне диалога вообще */
    const foxPresent = !!st.fox && !st.foxGone && !!st.foxActive;
    if (d.who === 'angel') {
      setFace(HUD.vnAngel, d.face, '_lastAngelSrc');
      HUD.vnAngel.classList.add('on', 'active');
      HUD.vnAngel.classList.remove('dim');
      if (foxPresent) {
        setFace(HUD.vnFox, IDLE_FACE.fox, '_lastFoxSrc');
        HUD.vnFox.classList.add('on', 'dim', 'gray');
        HUD.vnFox.classList.remove('active');
      } else {
        HUD.vnFox.classList.remove('on', 'active', 'dim');
      }
    } else {
      setFace(HUD.vnFox, talkFace(d.face, d), '_lastFoxSrc');
      HUD.vnFox.classList.add('on', 'active');
      HUD.vnFox.classList.remove('dim');
      setFace(HUD.vnAngel, IDLE_FACE.angel, '_lastAngelSrc');
      HUD.vnAngel.classList.add('on', 'dim');
      HUD.vnAngel.classList.remove('gray');
      HUD.vnFox.classList.remove('gray');
      HUD.vnAngel.classList.remove('active');
    }

    /* курсор «дальше» только когда фраза допечатана */
    HUD.vnCaret.classList.toggle('show', !!d.done);
  } else {
    HUD.dialog.classList.remove('show');
    HUD.vnCaret.classList.remove('show');
    HUD._lastWho = null;
  }

  /* полоса босса */
  if (HUD.tShout) {
    HUD.tShout.classList.toggle('cool', !!(Game.L && Game.L.mech.shout) && st.shoutCd > 0);
  }
  if (st.boss) {
    HUD.bossBar.classList.toggle('show', st.bossStage === 0);
    /* maxHp === 0 (makeBoss(0)) давал 0/0 = NaN в style.width; верхнего
       клампа не было — перелеченный босс рисовал полосу шире 100%. */
    const f = st.boss.maxHp > 0 ? Math.min(1, Math.max(0, st.boss.hp / st.boss.maxHp)) : 0;
    HUD.bossFill.style.width = (f * 100) + '%';
  }
}
