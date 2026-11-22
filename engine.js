'use strict';
/* ============================================================================
   引擎：游戏状态 + 规则。读 skills.js / characters.js 的配置，调 fx.js 出特效。
   不碰 DOM——KO 只改 state，弹层由 main.js 负责；画面由 render.js 负责。
   ============================================================================ */
const W = 960, H = 560, WALL = 14, TOP = 78;
const ENTITY_CAP = 200; // 观赏兜底：点子不拒绝，量级悄悄截断
const TUNING = { moveSpeed:230, moveAccel:1700, friction:.0008 }; // 「想跑得更快」改这里
const isMoving = p => ['up','down','left','right'].some(k => keys[p.kmap[k]]); // 是否正按着方向键

/* ---------- 键位标注 ↔ 键码（SKILLS.key 写 'Q' / '.'，这里换算成 e.code） ---------- */
const LABEL_CODE = { '.':'Period', '/':'Slash', ',':'Comma', ';':'Semicolon', ' ':'Space' };
function skillKeyCode(label){
  if (/^[a-z]$/i.test(label)) return 'Key' + label.toUpperCase();
  if (/^[0-9]$/.test(label)) return 'Digit' + label;
  return LABEL_CODE[label] || label;
}
function keyLabelOf(code){
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return { ArrowUp:'↑', ArrowDown:'↓', ArrowLeft:'←', ArrowRight:'→',
    Period:'.', Slash:'/', Comma:',', Semicolon:';', Space:'空格' }[code] || code;
}

/* ---------- 状态 ---------- */
let p1, p2, entities, state, stateT, slowmo, winner, koShown, hitstop;

function mkPlayer(c){
  const kmap = { up:c.keys.up, down:c.keys.down, left:c.keys.left, right:c.keys.right };
  c.skills.forEach((id, i) => kmap['s'+i] = skillKeyCode(SKILLS[id].key));
  return { name:c.name, color:c.color, dark:c.dark, image:c.image, x:c.spawnX, y:(H+TOP)/2, vx:0, vy:0,
    r:26, baseR:26, scale:1, scaleV:0, hp:100, kmap, skills:c.skills.map(id => ({ id, t:0 })),
    facing:c.spawnX < W/2 ? 1 : -1,
    stun:0, slowT:0, slowF:1, frozen:0, spin:0, flash:0, wince:0, hitAng:0, castT:0, stompCd:0, mods:null, blink:0, dead:false };
}

function reset(){
  p1 = mkPlayer(CHARACTERS[0]); p2 = mkPlayer(CHARACTERS[1]);
  entities = []; resetFx();
  state = 'countdown'; stateT = 3.4; slowmo = 0; winner = null; koShown = false; hitstop = 0;
}
const other = p => p === p1 ? p2 : p1;

function keyPressed(code){
  if (state !== 'play') return;
  for (const p of [p1, p2]) p.skills.forEach((s, i) => {
    if (p.kmap['s'+i] === code && s.t <= 0 && p.stun <= 0 && p.frozen <= 0) cast(p, s);
  });
}

/* ---------- 施放：唯一的代码路径，所有技能都从这走 ---------- */
function cast(p, slot){
  const cfg = SKILLS[slot.id]; slot.t = cfg.cd;
  shout(p, cfg.shout);
  p.castT = .18; // 施法蓄力：渲染层据此压扁角色
  const foe = other(p), sp = cfg.spawn;
  for (let i = 0; i < sp.count; i++){
    if (entities.length >= ENTITY_CAP) break;
    let x = p.x, y = p.y, vx = 0, vy = 0;
    if (sp.at === 'ring'){ const a = i/sp.count*Math.PI*2; x += Math.cos(a)*sp.ringR; y += Math.sin(a)*sp.ringR; }
    if (sp.at === 'behind'){ x -= p.facing * (p.r + sp.dist); }
    if (sp.at === 'muzzle'){
      const a = Math.atan2(foe.y - p.y, foe.x - p.x);
      x += Math.cos(a)*(p.r + sp.dist); y += Math.sin(a)*(p.r + sp.dist);
      vx = Math.cos(a)*sp.speed; vy = Math.sin(a)*sp.speed;
      if (i === 0){ p.vx -= Math.cos(a)*110; p.vy -= Math.sin(a)*110; ring(x, y, '#ffb13d', 22); } // 后坐力 + 枪口光圈
    }
    spawnEntity(p, cfg.entity, cfg.look, x, y, vx, vy, i);
  }
}
function spawnEntity(owner, e, look, x, y, vx, vy, seed){
  entities.push({ owner, cfg:e, look:look || e.look, x, y, vx, vy,
    life:e.life ?? e.duration ?? 5, age:0, r:e.r || 10, seed:seed || 0, armed:!e.armDelay });
  if (e.behavior === 'aura'){
    owner.mods = e.mods; owner.auraT = e.duration;
    popText(owner.x, owner.y - 50, '变大了！', '#fff', 26);
    ring(owner.x, owner.y, '#fff', 90); bump(6);
  }
}

/* ---------- 行为库：behavior 字段挑一个 ---------- */
const BEHAVIORS = {
  seek(en, dt){
    const foe = other(en.owner);
    const a = Math.atan2(foe.y - en.y, foe.x - en.x);
    en.vx += Math.cos(a) * en.cfg.accel * dt; en.vy += Math.sin(a) * en.cfg.accel * dt;
    const v = Math.hypot(en.vx, en.vy), max = en.cfg.speed;
    if (v > max){ en.vx *= max/v; en.vy *= max/v; }
    en.x += en.vx*dt; en.y += en.vy*dt;
    hitCheck(en, foe);
  },
  projectile(en, dt){
    en.x += en.vx*dt; en.y += en.vy*dt;
    const s = en.cfg.split;
    if (s && en.age >= s.after){
      const base = Math.atan2(en.vy, en.vx);
      boom(en.x, en.y, '#ff8a3d', 10); bump(3);
      for (let i = 0; i < s.count; i++){
        const a = base + (i - (s.count-1)/2) * s.fanDeg * Math.PI/180;
        spawnEntity(en.owner, s.child, s.child.look, en.x, en.y, Math.cos(a)*s.child.speed, Math.sin(a)*s.child.speed, i);
      }
      en.life = 0; return;
    }
    if (en.x < WALL || en.x > W-WALL || en.y < TOP || en.y > H-WALL){ boom(en.x, en.y, '#ff8a3d', 6); en.life = 0; }
    hitCheck(en, other(en.owner));
  },
  trap(en, dt){
    if (!en.armed && en.age >= en.cfg.armDelay) en.armed = true;
    if (en.armed) hitCheck(en, other(en.owner));
  },
  aura(en, dt){
    const o = en.owner; en.x = o.x; en.y = o.y;
    if (en.life - dt <= 0){ o.mods = null; puff(o.x, o.y, o.color, 14); popText(o.x, o.y-50, '变回来了', '#fff', 18); }
  },
  nova(en, dt){ // 范围类：从施放点向外扩散的圈，圈扫到对手时命中一次
    const c = en.cfg, foe = other(en.owner);
    en.radius = c.radius * Math.min(1, en.age / c.expand);
    if (!en.done && !foe.dead && Math.hypot(foe.x - en.x, foe.y - en.y) <= en.radius + foe.r){
      en.done = true;
      damage(foe, c.damage || 0, en.x, en.y, c.hit || {});
      burst(foe.x, foe.y, (c.hit && c.hit.burst) || 'star', 12);
    }
  },
  zone(en, dt){ // 区域类：飘到对手头顶（hover 高度），每 every 秒对 zapR 范围放一次电
    const foe = other(en.owner), z = en.cfg.zone;
    const k = Math.min(1, dt * z.follow);
    en.x += (foe.x - en.x) * k;
    en.y += (foe.y - z.hover - en.y) * k;
    en.y = Math.max(TOP + 10, en.y);
    en.boltT = Math.max(0, (en.boltT || 0) - dt);
    en.zapT = (en.zapT || 0) + dt;
    if (en.zapT >= z.every){
      en.zapT = 0;
      if (!foe.dead && Math.hypot(en.x - foe.x, en.y - foe.y) <= z.zapR){
        en.boltT = .16; en.boltX = foe.x; en.boltY = foe.y;
        flash(.15);
        damage(foe, en.cfg.damage || 0, en.x, en.y, en.cfg.hit || {});
        burst(foe.x, foe.y, (en.cfg.hit && en.cfg.hit.burst) || 'star', 8);
      }
    }
  },
};

/* ---------- 命中：引擎层统一打击感 ---------- */
function hitCheck(en, foe){
  if (foe.dead) return;
  if (Math.hypot(en.x - foe.x, en.y - foe.y) > en.r + foe.r) return;
  const h = en.cfg.hit || {};
  if (h.requireMoving && !isMoving(foe)){ // 静止目标打不中：穿过去，弹提示
    if (!en.tipShown){ en.tipShown = true; popText(foe.x, foe.y - foe.r - 18, '静止打不中！', '#8a6cf0', 18); }
    return;
  }
  damage(foe, en.cfg.damage || 0, en.x, en.y, h);
  if (h.stun){ foe.stun = Math.max(foe.stun, h.stun); const a = Math.atan2(foe.y-en.y, foe.x-en.x); foe.vx = Math.cos(a)*h.slide; foe.vy = Math.sin(a)*h.slide; }
  burst(en.x, en.y, h.burst || 'star', 10);
  en.life = 0;
}
function damage(foe, dmg, fx, fy, h){
  foe.hp = Math.max(0, foe.hp - dmg);
  const a = Math.atan2(foe.y - fy, foe.x - fx);
  foe.vx += Math.cos(a) * (h.knockback || 120); foe.vy += Math.sin(a) * (h.knockback || 120);
  foe.flash = .14; foe.wince = .4; foe.hitAng = a;
  bump(h.shake || 4, Math.cos(a), Math.sin(a));
  hitstop = Math.max(hitstop, h.stop ?? Math.min(.11, dmg*.008)); // 命中定格：伤害越高冻得越久
  popText(foe.x, foe.y - foe.r - 18, h.pop || ('-'+dmg), '#fff', 18 + Math.min(14, dmg*.8), h.pop ? '-'+dmg : null);
  if (h.slow){ // 减速；已经在减速中又被命中、且配了 freeze，就冰冻
    if (foe.slowT > 0 && h.freeze){ foe.slowT = 0; foe.frozen = h.freeze; foe.vx = foe.vy = 0; popText(foe.x, foe.y - foe.r - 48, '冻住了！', '#bff0ff', 24); }
    else { foe.slowT = h.slow.duration; foe.slowF = h.slow.factor; }
  }
  if (foe.hp <= 0) ko(foe);
}
function ko(loser){
  loser.dead = true; state = 'ko'; stateT = 0; winner = other(loser);
  slowmo = REDUCED ? 0 : .9; bump(12); flash(.6); hitstop = .3;
  confetti(REDUCED ? 12 : 60);
}
function shout(p, text){ popText(p.x, p.y - p.r*p.scale - 30, text, '#fff', 18); }

/* ---------- 更新 ---------- */
function updatePlayer(p, dt){
  if (p.dead){ p.spin += dt*6; return; }
  const mods = p.mods, speed = TUNING.moveSpeed * (mods ? mods.speed : 1) * (p.slowT > 0 ? p.slowF : 1);
  p.scaleV += (((mods ? mods.scale : 1) - p.scale)*180 - p.scaleV*14) * dt; // 弹簧：变身时先冲过头再回落
  p.scale += p.scaleV*dt;
  p.r = p.baseR * p.scale;
  if (p.stun > 0){ p.stun -= dt; p.spin += dt*14; p.vx *= Math.pow(.6, dt*2); p.vy *= Math.pow(.6, dt*2); }
  else if (p.frozen > 0){ // 冰冻：不能动、不能放技能
    p.frozen -= dt; p.vx *= Math.pow(.001, dt); p.vy *= Math.pow(.001, dt);
    if (p.frozen <= 0) burst(p.x, p.y, 'frost', 14);
  }
  else {
    p.spin = 0;
    let ax = 0, ay = 0;
    if (state === 'play'){
      ax = (keys[p.kmap.right] ? 1:0) - (keys[p.kmap.left] ? 1:0);
      ay = (keys[p.kmap.down] ? 1:0) - (keys[p.kmap.up] ? 1:0);
    }
    const l = Math.hypot(ax, ay) || 1;
    p.vx += ax/l * TUNING.moveAccel * dt; p.vy += ay/l * TUNING.moveAccel * dt;
    const fr = Math.pow(TUNING.friction, dt); p.vx *= fr; p.vy *= fr;
    const v = Math.hypot(p.vx, p.vy); if (v > speed){ p.vx *= speed/v; p.vy *= speed/v; }
    if (ax) p.facing = ax > 0 ? 1 : -1;
  }
  p.x += p.vx*dt; p.y += p.vy*dt;
  p.x = Math.max(WALL + p.r, Math.min(W - WALL - p.r, p.x));
  p.y = Math.max(TOP + p.r, Math.min(H - WALL - p.r, p.y));
  p.flash = Math.max(0, p.flash - dt); p.wince = Math.max(0, p.wince - dt);
  p.castT = Math.max(0, p.castT - dt);
  p.slowT = Math.max(0, p.slowT - dt);
  p.stompCd = Math.max(0, p.stompCd - dt);
  p.blink -= dt; if (p.blink < -.12) p.blink = 2.2 + Math.random()*2;
  p.skills.forEach(s => s.t = Math.max(0, s.t - dt));
  if (mods && mods.contactDamage){
    const foe = other(p);
    if (!foe.dead && p.stompCd <= 0 && Math.hypot(p.x-foe.x, p.y-foe.y) < p.r + foe.r){
      p.stompCd = .55;
      damage(foe, mods.contactDamage, p.x, p.y, { knockback:mods.contactKnockback, shake:mods.stompShake, pop:'咚！！' });
      burst(foe.x, foe.y, 'star', 12);
    }
  }
}
function update(dt){
  stateT -= dt;
  if (state === 'countdown' && stateT <= 0) state = 'play';
  if (hitstop > 0){ hitstop -= dt; updateFx(dt, true); return; }
  const ts = slowmo > 0 ? .22 : 1; slowmo = Math.max(0, slowmo - dt);
  dt *= ts;
  updatePlayer(p1, dt); updatePlayer(p2, dt);
  for (const en of entities){ en.age += dt; en.life -= dt; BEHAVIORS[en.cfg.behavior](en, dt); }
  entities = entities.filter(e => e.life > 0);
  updateFx(dt);
}
