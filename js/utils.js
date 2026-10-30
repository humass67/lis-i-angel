/* utils.js — чистые помощники. Работает и в браузере, и в Node. */
'use strict';

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function lerp(a, b, t) { return a + (b - a) * t; }
function invLerp(a, b, v) { return b === a ? 0 : (v - a) / (b - a); }
function approach(cur, target, delta) {
  if (cur < target) return Math.min(cur + delta, target);
  return Math.max(cur - delta, target);
}
function sign(v) { return v < 0 ? -1 : (v > 0 ? 1 : 0); }

/* mulberry32 — быстрый детерминированный PRNG */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* FNV-1a: строка -> 32-битный сид */
function hashStr(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/* AABB: {x,y,w,h} — x,y это левый верхний угол */
function aabb(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x &&
         a.y < b.y + b.h && a.y + a.h > b.y;
}
function aabbGrow(a, b, m) {
  return a.x < b.x + b.w + m && a.x + a.w > b.x - m &&
         a.y < b.y + b.h + m && a.y + a.h > b.y - m;
}
function rectCenter(r) { return { x: r.x + r.w / 2, y: r.y + r.h / 2 }; }
function dist2(ax, ay, bx, by) { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; }

/* Сглаживание для анимаций */
function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
function easeInCubic(t) { return t * t * t; }
function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    clamp, lerp, invLerp, approach, sign, mulberry32, hashStr,
    aabb, aabbGrow, rectCenter, dist2, easeOutCubic, easeInCubic, easeInOut,
  };
}
