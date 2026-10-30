/* fx.js — частицы и экранные эффекты. Рисуются в тот же canvas, что и мир,
   но отдельным слоем (вызывается после мира, до HUD). */
'use strict';

const FX = {
  parts: [],
  shake: 0,
  shakeDecay: 6,
  flash: 0,
  flashColor: '#ffffff',
  glitch: 0,
};

function fxReset() {
  FX.parts.length = 0;
  FX.shake = 0;
  FX.flash = 0;
  FX.glitch = 0;
}

/* Доступность (раунд 2 UX, п.4): тряска/вспышки противопоказаны части игроков
   (вестибулярная чувствительность, эпилепсия). Тумблеры живут в сейве
   (storage.js: fxShake/fxFlash/fxChroma); null = авто — выключено, когда ОС
   просит prefers-reduced-motion. Читается на КАЖДЫЙ вызов: переключение
   в настройках действует немедленно, без перезапуска. */
function fxEnabled(key) {
  const s = (typeof getSave === 'function') ? getSave() : null;
  const v = s ? s[key] : null;
  if (v === true || v === false) return v;
  return !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
}

function fxShake(amount) { if (!fxEnabled('fxShake')) return; FX.shake = Math.max(FX.shake, amount); }
function fxFlash(amount, color) { if (!fxEnabled('fxFlash')) return; FX.flash = amount; FX.flashColor = color || '#ffffff'; }
function fxGlitch(amount) { FX.glitch = Math.max(FX.glitch, amount); }

/* Базовая частица */
function spawn(p) {
  if (FX.parts.length >= 420) FX.parts.shift();
  FX.parts.push(Object.assign({
    x: 0, y: 0, vx: 0, vy: 0, life: 0.6, t: 0,
    size: 2, color: '#fff', grav: 0, drag: 1, kind: 'rect', alpha: 1, spin: 0, rot: 0,
  }, p));
}

/* ─────────── готовые эффекты ─────────── */

function fxDust(x, y, dir, n) {
  for (let i = 0; i < (n || 5); i++) {
    spawn({
      x, y,
      vx: (dir || 0) * -18 + (Math.random() - 0.5) * 34,
      vy: -Math.random() * 30,
      life: 0.28 + Math.random() * 0.22,
      size: 1 + Math.random() * 2,
      color: 'rgba(230,225,210,0.75)',
      grav: 110, drag: 0.92,
    });
  }
}

function fxLand(x, y, power) {
  const n = 6 + Math.floor((power || 1) * 4);
  for (let i = 0; i < n; i++) {
    const a = Math.PI + (Math.random() - 0.5) * Math.PI * 0.9;
    const sp = 30 + Math.random() * 60;
    spawn({
      x, y,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.4,
      life: 0.3 + Math.random() * 0.25,
      size: 1 + Math.random() * 2,
      color: 'rgba(225,220,205,0.8)',
      grav: 160, drag: 0.9,
    });
  }
}

function fxJump(x, y) {
  for (let i = 0; i < 5; i++) {
    spawn({
      x: x + (Math.random() - 0.5) * 8, y,
      vx: (Math.random() - 0.5) * 26, vy: 10 + Math.random() * 18,
      life: 0.24, size: 1 + Math.random(), color: 'rgba(240,238,230,0.6)',
      grav: 40, drag: 0.94,
    });
  }
}

/* Свет/пыльца — тёплый уровень 1 */
function fxMote(x, y) {
  spawn({
    x, y, vx: (Math.random() - 0.5) * 8, vy: -4 - Math.random() * 8,
    life: 2.4 + Math.random() * 2.2, size: 1 + Math.random() * 1.6,
    color: 'rgba(255,248,196,0.85)', grav: -1.5, drag: 0.995, kind: 'glow',
  });
}

/* Тёмная пыль поздних уровней */
function fxAsh(x, y) {
  spawn({
    x, y, vx: (Math.random() - 0.5) * 12, vy: 6 + Math.random() * 12,
    life: 2.6 + Math.random() * 2.0, size: 1 + Math.random() * 1.8,
    color: 'rgba(40,40,46,0.7)', grav: 4, drag: 0.996,
  });
}

function fxDeath(x, y) {
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 40 + Math.random() * 130;
    spawn({
      x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40,
      life: 0.5 + Math.random() * 0.5, size: 1 + Math.random() * 2.4,
      color: i % 3 === 0 ? 'rgba(255,255,255,0.9)' : 'rgba(180,190,210,0.8)',
      grav: 240, drag: 0.93,
    });
  }
  fxShake(5);
}

function fxShoutRing(x, y) {
  spawn({ x, y, life: 0.5, size: 4, kind: 'ring', color: 'rgba(240,250,255,0.9)', grow: 200 });
  spawn({ x, y, life: 0.7, size: 2, kind: 'ring', color: 'rgba(200,220,255,0.5)', grow: 130 });
}

function fxEchoPop(x, y) {
  for (let i = 0; i < 7; i++) {
    const a = Math.random() * Math.PI * 2;
    spawn({
      x, y, vx: Math.cos(a) * 30, vy: Math.sin(a) * 30,
      life: 0.3, size: 1.4, color: 'rgba(210,235,255,0.9)', drag: 0.9,
    });
  }
}

function fxCrumbleBits(x, y) {
  for (let i = 0; i < 9; i++) {
    spawn({
      x: x + (Math.random() - 0.5) * 14, y: y + (Math.random() - 0.5) * 8,
      vx: (Math.random() - 0.5) * 50, vy: -10 + Math.random() * 30,
      life: 0.6, size: 1 + Math.random() * 2,
      color: 'rgba(150,132,110,0.9)', grav: 300, drag: 0.95, spin: Math.random() * 8,
    });
  }
}

function fxRiftBurst(x, y, dir) {
  for (let i = 0; i < 18; i++) {
    spawn({
      x, y, vx: (Math.random() - 0.5) * 70, vy: dir * (40 + Math.random() * 90),
      life: 0.5 + Math.random() * 0.3, size: 1 + Math.random() * 2,
      color: 'rgba(240,170,90,0.9)', drag: 0.94, kind: 'glow',
    });
  }
  fxShake(4);
}

function fxBossHit(x, y) {
  for (let i = 0; i < 22; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 50 + Math.random() * 140;
    spawn({
      x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
      life: 0.45, size: 1.5 + Math.random() * 2.5,
      color: i % 2 ? 'rgba(255,255,255,0.95)' : 'rgba(255,120,120,0.85)',
      drag: 0.9,
    });
  }
  fxShake(6);
  fxFlash(0.35, '#ffffff');
}

function fxSlamDust(x, y) {
  for (let i = 0; i < 16; i++) {
    const s = Math.random() < 0.5 ? -1 : 1;
    spawn({
      x, y, vx: s * (40 + Math.random() * 130), vy: -Math.random() * 50,
      life: 0.5 + Math.random() * 0.4, size: 2 + Math.random() * 3,
      color: 'rgba(60,58,56,0.75)', grav: 200, drag: 0.92,
    });
  }
  fxShake(7);
}

/* ─────────── обновление и отрисовка ─────────── */

function fxUpdate(dt) {
  FX.shake = Math.max(0, FX.shake - FX.shakeDecay * dt * (1 + FX.shake * 0.2));
  FX.flash = Math.max(0, FX.flash - dt * 2.4);
  FX.glitch = Math.max(0, FX.glitch - dt * 1.6);
  for (let i = FX.parts.length - 1; i >= 0; i--) {
    const p = FX.parts[i];
    p.t += dt;
    if (p.t >= p.life) { FX.parts.splice(i, 1); continue; }
    if (p.kind === 'ring') { p.size += (p.grow || 120) * dt; continue; }
    p.vy += p.grav * dt;
    p.vx *= Math.pow(p.drag, dt * 60);
    p.vy *= Math.pow(p.drag, dt * 60);
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.spin * dt;
  }
}

/* Рисуем в мировых координатах (ctx уже сдвинут камерой).
   ОПТИМИЗАЦИЯ: убраны save/restore на каждую частицу и createRadialGradient
   на каждую glow-частицу. Вместо этого — прямое управление globalAlpha и
   fillStyle, а glow рисуется через кэшированный спрайт (radial glow). */
let _glowSprite = null;
function getGlowSprite() {
  if (_glowSprite) return _glowSprite;
  const s = document.createElement('canvas');
  s.width = 64; s.height = 64;
  const c = s.getContext('2d');
  const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  c.fillStyle = g;
  c.fillRect(0, 0, 64, 64);
  _glowSprite = s;
  return s;
}

function fxDraw(ctx) {
  const glowSpr = getGlowSprite();
  for (const p of FX.parts) {
    const k = 1 - p.t / p.life;
    const a = Math.max(0, Math.min(1, k * p.alpha));
    if (a <= 0) continue;
    ctx.globalAlpha = a;
    if (p.kind === 'ring') {
      ctx.strokeStyle = p.color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.stroke();
    } else if (p.kind === 'glow') {
      /* вместо createRadialGradient на каждую частицу — кэшированный спрайт */
      const sz = p.size * 5;
      ctx.globalAlpha = a * 0.6;
      ctx.drawImage(glowSpr, p.x - sz / 2, p.y - sz / 2, sz, sz);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    } else {
      ctx.fillStyle = p.color;
      if (p.spin) {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        ctx.restore();
      } else {
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      }
    }
  }
  ctx.globalAlpha = 1;
}

/* Смещение камеры от тряски */
function fxShakeOffset() {
  if (FX.shake <= 0) return { x: 0, y: 0 };
  const s = FX.shake;
  return { x: (Math.random() - 0.5) * s * 2, y: (Math.random() - 0.5) * s * 2 };
}
