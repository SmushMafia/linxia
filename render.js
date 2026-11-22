/* ============================================================================
   渲染层（three.js + three.quarks + postprocessing）：只读状态、只管画。
   - 坐标：游戏的 (x, y) 平面 = three 的 XZ 地面，1 像素 = 1 单位，Y 朝上。
   - LOOKS 按 look.draw 挑造型：make(en) 建模型，返回的 update(en, t) 每帧摆姿势。
   - FX 按 fx.js 排进来的事件类型挑特效，粒子交给 three.quarks。
   - 发光靠 bloom：只有亮度超过阈值 1.3 的颜色（hdr() 放大过的）会发光，地面和角色不会被洗白。
   - HUD / 漂浮字 / 大字 / 闪白画在上层 2D 画布 #hud。
   素材占位：角色或 look 写了 image 就用图片面片，没写就用程序建的模型。
   ============================================================================ */
import * as THREE from 'three';
import { BatchedRenderer, ParticleSystem, ConstantValue, IntervalValue, ConstantColor, Gradient,
  PiecewiseBezier, Bezier, SphereEmitter, PointEmitter, RenderMode,
  ColorOverLife, SizeOverLife, ApplyForce, SpeedOverLife, RotationOverLife } from 'three.quarks';
import { EffectComposer, RenderPass, EffectPass, BloomEffect, VignetteEffect } from 'postprocessing';

const AW = W - 2*WALL, AH = H - WALL - TOP;                 // 可活动地面大小
const CX = W/2, CZ = (TOP + H - WALL)/2;                     // 地面中心（游戏坐标）
const wx = x => x - CX, wz = y => y - CZ;
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const V4 = (r, g, b, a = 1) => new THREE.Vector4(r, g, b, a);
const hdrC = (hex, k = 1) => new THREE.Color(hex).multiplyScalar(k);
const hdr = (hex, k = 1, a = 1) => { const c = hdrC(hex, k); return V4(c.r, c.g, c.b, a); };
const easeOut = k => 1 - (1-k)*(1-k);

/* ---------- 渲染器 / 场景 / 后期 ---------- */
const cv = document.getElementById('cv'), hud = document.getElementById('hud'), hctx = hud.getContext('2d');
const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: false, powerPreference: 'high-performance' });
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
const scene = new THREE.Scene(); scene.background = new THREE.Color('#e7cf98');
const camera = new THREE.PerspectiveCamera(30, W/H, 10, 6000);
const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 4 });
composer.addPass(new RenderPass(scene, camera));
composer.addPass(new EffectPass(camera,
  new BloomEffect({ luminanceThreshold: 1.3, luminanceSmoothing: .2, intensity: 1.4, mipmapBlur: true, radius: .7 }),
  new VignetteEffect({ offset: .35, darkness: .3 })));

scene.add(new THREE.HemisphereLight('#fff6e4', '#b08a58', .95));
const sun = new THREE.DirectionalLight('#fff0d0', .95);
sun.position.set(-260, 720, 420); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -600, right: 600, top: 420, bottom: -420, near: 100, far: 2000 });
sun.shadow.bias = -.0006; sun.shadow.normalBias = .6;
scene.add(sun, sun.target);

const LIGHTS = Array.from({ length: 4 }, () => { // 固定光源池：数量不变，避免材质重新编译卡顿
  const l = new THREE.PointLight('#ff8a3d', 0, 260, 2); scene.add(l); return { l, owner: null, pulse: 0 };
});
function takeLight(owner, color){ const s = LIGHTS.find(s => !s.owner); if (!s) return null; s.owner = owner; s.l.color.set(color); return s; }
function freeLight(s){ if (s){ s.owner = null; s.l.intensity = 0; } }
function pulseLight(x, y, color, power){
  const s = LIGHTS.find(s => !s.owner && s.pulse <= 0) || LIGHTS.find(s => !s.owner); if (!s) return;
  s.l.color.set(color); s.l.position.set(wx(x), 30, wz(y)); s.pulse = 1; s.power = power;
}

/* ---------- 共享几何 / 材质 ---------- */
const ramp = new THREE.DataTexture(new Uint8Array([95, 175, 255]), 3, 1, THREE.RedFormat);
ramp.minFilter = ramp.magFilter = THREE.NearestFilter; ramp.needsUpdate = true;
const toon = (color, o = {}) => new THREE.MeshToonMaterial({ color, gradientMap: ramp, ...o });
const basic = (color, o = {}) => new THREE.MeshBasicMaterial({ color, ...o });
const GEO = {
  sphere: new THREE.SphereGeometry(1, 32, 20), lowSphere: new THREE.SphereGeometry(1, 14, 10),
  cone: new THREE.ConeGeometry(1, 1, 12), plane: new THREE.PlaneGeometry(1, 1),
  smile: new THREE.TorusGeometry(.2, .045, 6, 16, Math.PI), banana: new THREE.TorusGeometry(13, 4.5, 10, 24, Math.PI*.5),
  ring: new THREE.TorusGeometry(1, .05, 6, 48), star: starGeometry(),
  box: new THREE.BoxGeometry(1, 1, 1),
  flatRing: new THREE.RingGeometry(.9, 1, 72), disc: new THREE.CircleGeometry(1, 48), crystal: new THREE.IcosahedronGeometry(1, 1),
};
const MAT = {
  ink: basic('#2d2418'), eyeWhite: basic('#ffffff'),
  chicken: toon('#ffffff'), chickenLine: basic('#8d8170', { side: THREE.BackSide }),
  comb: toon('#e8453c'), beak: toon('#ffac12'), wing: toon('#e9e2d4'),
  banana: toon('#f5c518'), bananaLine: basic('#9c7a12', { side: THREE.BackSide }),
  cloud: toon('#727888'), cloudLine: basic('#3c404b', { side: THREE.BackSide }),
  star: basic(hdrC('#ffd34d', 2.2)), aura: basic(hdrC('#ffffff', 2.4), { transparent: true, opacity: .85 }),
  ice: toon('#c8f2ff', { emissive: '#3aaee8', emissiveIntensity: .35 }),
  iceBlock: new THREE.MeshPhongMaterial({ color: '#d6f6ff', specular: '#ffffff', shininess: 90, transparent: true, opacity: .55, flatShading: true, depthWrite: false }),
  bolt: basic(hdrC('#bff6ff', 6)), boltGlow: basic(hdrC('#4fc8ff', 2.5), { transparent: true, opacity: .5, depthWrite: false }),
};
function mesh(geo, mat, shadow = true){ const m = new THREE.Mesh(geo, mat); m.castShadow = shadow; return m; }
function outline(m, mat, k = 1.08){ const o = new THREE.Mesh(m.geometry, mat); o.scale.setScalar(k); m.add(o); return m; } // 背面外扩描边
function starGeometry(){
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++){ const a = i*Math.PI/5 - Math.PI/2, r = i%2 ? .45 : 1; s[i ? 'lineTo' : 'moveTo'](Math.cos(a)*r, Math.sin(a)*r); }
  const g = new THREE.ExtrudeGeometry(s, { depth: .35, bevelEnabled: false }); g.center(); return g;
}

/* ---------- 程序贴图：粒子形状 / 地面 ---------- */
function canvasTex(size, paint, srgb = false){
  const c = document.createElement('canvas'); c.width = c.height = size;
  paint(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t;
}
const TEX = {
  soft: canvasTex(64, (g, s) => { const r = g.createRadialGradient(s/2, s/2, 0, s/2, s/2, s/2);
    r.addColorStop(0, '#fff'); r.addColorStop(.35, 'rgba(255,255,255,.6)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, s, s); }),
  star: canvasTex(64, (g, s) => { g.fillStyle = '#fff'; g.beginPath();
    for (let i = 0; i < 10; i++){ const a = i*Math.PI/5 - Math.PI/2, r = (i%2 ? .2 : .48)*s; g.lineTo(s/2 + Math.cos(a)*r, s/2 + Math.sin(a)*r); }
    g.closePath(); g.shadowColor = '#fff'; g.shadowBlur = 6; g.fill(); }),
  feather: canvasTex(64, (g, s) => { g.fillStyle = '#fff'; g.strokeStyle = '#9c8f7a'; g.lineWidth = 4; // 描边：白羽毛在沙地上才看得见
    g.beginPath(); g.ellipse(s/2, s/2, s*.42, s*.15, .5, 0, 7); g.fill(); g.stroke(); }),
  ring: canvasTex(128, (g, s) => { g.strokeStyle = '#fff'; g.lineWidth = s*.07; g.shadowColor = '#fff'; g.shadowBlur = s*.08;
    g.beginPath(); g.arc(s/2, s/2, s*.4, 0, 7); g.stroke(); }),
  square: canvasTex(16, (g, s) => { g.fillStyle = '#fff'; g.fillRect(2, 4, s-4, s-8); }),
  scorch: canvasTex(64, (g, s) => { const r = g.createRadialGradient(s/2, s/2, 0, s/2, s/2, s/2);
    r.addColorStop(0, 'rgba(40,24,8,.85)'); r.addColorStop(.55, 'rgba(60,36,10,.45)'); r.addColorStop(1, 'rgba(60,36,10,0)');
    g.fillStyle = r; g.fillRect(0, 0, s, s); }),
};
function seeded(s){ return () => (s = s*16807 % 2147483647) / 2147483647; }
function sandTexture(){
  const c = document.createElement('canvas'), k = 2; c.width = AW*k; c.height = AH*k;
  const g = c.getContext('2d'); g.scale(k, k);
  const R = seeded(20261119);
  g.fillStyle = '#f2dfb2'; g.fillRect(0, 0, AW, AH);
  g.fillStyle = 'rgba(200,160,90,.12)';
  for (let gx = 0; gx < AW/60; gx++) for (let gy = 0; gy < AH/60; gy++) if ((gx+gy)%2) g.fillRect(gx*60, gy*60, 60, 60);
  for (let i = 0; i < 1400; i++){
    g.fillStyle = R() < .55 ? 'rgba(160,120,60,.16)' : 'rgba(255,255,255,.45)';
    g.beginPath(); g.arc(R()*AW, R()*AH, .5 + R()*1.4, 0, 7); g.fill();
  }
  g.strokeStyle = 'rgba(180,130,55,.55)'; g.lineWidth = 3; g.setLineDash([14, 12]);
  g.beginPath(); g.arc(AW/2, AH/2, 120, 0, 7); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

/* ---------- 竞技场 ---------- */
const world = new THREE.Group(); scene.add(world);   // 每局会清空的东西（实体、焦痕）
const fxRoot = new THREE.Group(); scene.add(fxRoot); // 粒子发射器都挂这里
{
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(AW, AH), new THREE.MeshLambertMaterial({ map: sandTexture() }));
  floor.rotation.x = -Math.PI/2; floor.receiveShadow = true; scene.add(floor);
  const outside = new THREE.Mesh(new THREE.PlaneGeometry(4000, 3000), new THREE.MeshLambertMaterial({ color: '#d6b26c' }));
  outside.rotation.x = -Math.PI/2; outside.position.y = -1; outside.receiveShadow = true; scene.add(outside);
  const rrShape = (w, h, r, s) => { const x = -w/2, y = -h/2;
    s.moveTo(x+r, y); s.lineTo(x+w-r, y); s.quadraticCurveTo(x+w, y, x+w, y+r); s.lineTo(x+w, y+h-r);
    s.quadraticCurveTo(x+w, y+h, x+w-r, y+h); s.lineTo(x+r, y+h); s.quadraticCurveTo(x, y+h, x, y+h-r);
    s.lineTo(x, y+r); s.quadraticCurveTo(x, y, x+r, y); return s; };
  const shape = rrShape(AW + WALL*3, AH + WALL*3, 26, new THREE.Shape());
  shape.holes.push(rrShape(AW, AH, 12, new THREE.Path()));
  const wall = mesh(new THREE.ExtrudeGeometry(shape, { depth: 26, bevelEnabled: true, bevelThickness: 3, bevelSize: 3, bevelSegments: 3, curveSegments: 10 }), toon('#d2a54c'));
  wall.rotation.x = -Math.PI/2; wall.receiveShadow = true; scene.add(wall);
  const R = seeded(7);
  for (let i = 0; i < 18; i++){ // 小石子
    const st = mesh(GEO.lowSphere, toon(R() < .5 ? '#d8bf8a' : '#c9ab72'));
    const r = 3 + R()*4; st.scale.set(r, r*.55, r*(.7 + R()*.4)); st.rotation.y = R()*6;
    st.position.set((R() - .5)*(AW - 60), r*.25, (R() - .5)*(AH - 60)); st.receiveShadow = true; scene.add(st);
  }
  const grassMat = toon('#a8b65a');
  for (let i = 0; i < 26; i++){ // 草丛
    const tuft = new THREE.Group(), x = (R() - .5)*(AW - 60), z = (R() - .5)*(AH - 60);
    for (let j = 0; j < 3; j++){ const b = mesh(GEO.cone, grassMat); b.scale.set(1.6, 9 + R()*5, 1.6);
      b.position.set((j-1)*2.6, 4.5, (R()-.5)*2); b.rotation.z = (j-1)*.35; tuft.add(b); }
    tuft.position.set(x, 0, z); scene.add(tuft);
  }
}

/* ---------- 镜头：自动缩放到整片场地刚好放下，顶部留给 HUD ---------- */
const CAM = { pos: V3(0, 0, 0), target: V3(0, 0, 0) };
function fitCamera(){
  const pitch = 58*Math.PI/180, dir = V3(0, Math.sin(pitch), Math.cos(pitch)), v = V3(0, 0, 0);
  const ex = AW/2 + WALL*1.5, ez = AH/2 + WALL*1.5, pts = [];
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const y of [0, 30]) pts.push([sx*ex, y, sz*ez]);
  const top = 1 - 2*(TOP - 14)/H, bottom = -.97;
  let d = 1400, tz = 0;
  for (let i = 0; i < 80; i++){
    camera.position.set(0, 0, tz).addScaledVector(dir, d); camera.lookAt(0, 0, tz); camera.updateMatrixWorld();
    let xm = 0, y0 = 9, y1 = -9;
    for (const p of pts){ v.set(...p).project(camera); xm = Math.max(xm, Math.abs(v.x)); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); }
    d *= Math.max(xm/.98, (y1 - y0)/(top - bottom))**.5;
    tz -= ((y1 + y0)/2 - (top + bottom)/2) * 60;
  }
  CAM.pos.copy(camera.position); CAM.target.set(0, 0, tz);
}
fitCamera();

/* ---------- 一次性粒子特效（three.quarks） ---------- */
const BATCH = new BatchedRenderer(); scene.add(BATCH);
const FX_SYSTEM_CAP = 90; // 观赏兜底：同时存在的特效数量
const fade = (a0 = 1) => new ColorOverLife(new Gradient([[V3(1, 1, 1), 0], [V3(1, 1, 1), 1]], [[a0, 0], [0, 1]]));
const curve = (a, b, c, d) => new PiecewiseBezier([[new Bezier(a, b, c, d), 0]]);
const gravity = g => new ApplyForce(V3(0, -1, 0), new ConstantValue(g));
const pmat = (map, additive) => new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false,
  blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, side: THREE.DoubleSide });
const PMAT = { softAdd: pmat(TEX.soft, true), soft: pmat(TEX.soft, false), star: pmat(TEX.star, true),
  feather: pmat(TEX.feather, false), ring: pmat(TEX.ring, true), square: pmat(TEX.square, false) };

function proto(o){
  return new ParticleSystem({
    duration: 1, looping: false, autoDestroy: true, worldSpace: true,
    startLife: o.life, startSpeed: o.speed ?? new ConstantValue(0), startSize: o.size,
    startColor: new ConstantColor(o.color ?? V4(1, 1, 1, 1)), startRotation: o.rot ?? new ConstantValue(0),
    emissionOverTime: new ConstantValue(0),
    emissionBursts: [{ time: 0, count: new ConstantValue(o.n ?? 10), cycle: 1, interval: .01, probability: 1 }],
    shape: o.shape ?? new SphereEmitter({ radius: 4, thickness: 1 }),
    material: o.mat, renderMode: o.mode ?? RenderMode.BillBoard, rendererEmitterSettings: o.stretch,
    behaviors: o.behaviors ?? [],
  });
}
const shrink = () => new SizeOverLife(curve(1, .8, .4, 0));
const FXP = {
  star: proto({ life: new IntervalValue(.45, .8), speed: new IntervalValue(90, 230), size: new IntervalValue(9, 16),
    color: hdr('#ffd34d', 2.6), mat: PMAT.star, rot: new IntervalValue(0, 6.28), behaviors: [gravity(260), shrink(), fade(), new RotationOverLife(new IntervalValue(-6, 6))] }),
  feather: proto({ life: new IntervalValue(.7, 1.1), speed: new IntervalValue(60, 160), size: new IntervalValue(9, 13),
    mat: PMAT.feather, rot: new IntervalValue(0, 6.28), behaviors: [gravity(120), new SpeedOverLife(curve(1, .4, .2, .1)), fade(), new RotationOverLife(new IntervalValue(-4, 4))] }),
  ember: proto({ life: new IntervalValue(.3, .55), speed: new IntervalValue(140, 340), size: new IntervalValue(3, 5),
    color: hdr('#ff7a2a', 4), mat: PMAT.softAdd, mode: RenderMode.StretchedBillBoard, stretch: { speedFactor: .07, lengthFactor: 1 },
    behaviors: [gravity(320), shrink(), fade()] }),
  spark: proto({ life: new IntervalValue(.25, .5), speed: new IntervalValue(160, 360), size: new IntervalValue(3, 5),
    color: hdr('#7fe3ff', 4.5), mat: PMAT.softAdd, mode: RenderMode.StretchedBillBoard, stretch: { speedFactor: .07, lengthFactor: 1 },
    behaviors: [gravity(200), shrink(), fade()] }),
  fire: proto({ life: new IntervalValue(.25, .45), speed: new IntervalValue(20, 90), size: new IntervalValue(26, 46), n: 12,
    color: hdr('#ff8a3d', 3.2), mat: PMAT.softAdd, behaviors: [new SizeOverLife(curve(.6, 1, 1.1, 1.2)), fade()] }),
  smoke: proto({ life: new IntervalValue(.8, 1.3), speed: new IntervalValue(15, 50), size: new IntervalValue(18, 30),
    color: V4(.42, .37, .33, .5), mat: PMAT.soft, behaviors: [new ApplyForce(V3(0, 1, 0), new ConstantValue(40)), new SizeOverLife(curve(.6, 1, 1.3, 1.6)), fade()] }),
  dust: proto({ life: new IntervalValue(.35, .5), speed: new IntervalValue(20, 60), size: new IntervalValue(8, 14),
    mat: PMAT.soft, behaviors: [new SizeOverLife(curve(.8, 1.1, 1.2, 1.3)), fade(.8)] }),
  shock: proto({ life: new ConstantValue(.35), size: new ConstantValue(1), n: 1, shape: new PointEmitter(),
    mat: PMAT.ring, mode: RenderMode.HorizontalBillBoard, behaviors: [new SizeOverLife(curve(.15, .75, .95, 1)), fade()] }),
  frost: proto({ life: new IntervalValue(.4, .7), speed: new IntervalValue(100, 240), size: new IntervalValue(8, 14),
    color: hdr('#a8ecff', 2.4), mat: PMAT.star, rot: new IntervalValue(0, 6.28), behaviors: [gravity(180), shrink(), fade(), new RotationOverLife(new IntervalValue(-5, 5))] }),
  frostSpark: proto({ life: new IntervalValue(.25, .45), speed: new IntervalValue(160, 320), size: new IntervalValue(3, 5),
    color: hdr('#9be8ff', 4), mat: PMAT.softAdd, mode: RenderMode.StretchedBillBoard, stretch: { speedFactor: .07, lengthFactor: 1 },
    behaviors: [gravity(150), shrink(), fade()] }),
  confetti: proto({ life: new IntervalValue(1.6, 2.2), speed: new IntervalValue(20, 90), size: new IntervalValue(6, 9),
    mat: PMAT.square, rot: new IntervalValue(0, 6.28), shape: new SphereEmitter({ radius: 60, thickness: 1 }),
    behaviors: [gravity(170), new RotationOverLife(new IntervalValue(-8, 8)), fade()] }),
};
function play(p, x, y, h, o = {}){
  if (fxRoot.children.length >= FX_SYSTEM_CAP) return;
  const s = p.clone();
  if (o.n != null) s.emissionBursts[0].count = new ConstantValue(Math.max(1, Math.round(o.n * (REDUCED ? .4 : 1))));
  if (o.color) s.startColor = new ConstantColor(o.color);
  if (o.size) s.startSize = new ConstantValue(o.size);
  s.emitter.position.set(x, h, y);
  fxRoot.add(s.emitter); BATCH.addSystem(s);
}
const BURST_COLOR = { star: '#ffd34d', feather: '#ffffff', ember: '#ff7a2a', spark: '#4fc8ff', frost: '#9be8ff' };
const CONFETTI = ['#ff6a6a', '#ffd34d', '#6adf7e', '#6ab8ff', '#c98bff'];
const FX = { // 键 = fx.js 事件的 type
  burst(e){ const k = FXP[e.kind] ? e.kind : 'star';
    play(FXP[k], wx(e.x), wz(e.y), 24, { n: e.n });
    if (k === 'feather') play(FXP.star, wx(e.x), wz(e.y), 24, { n: e.n/2 });
    if (k === 'frost') play(FXP.frostSpark, wx(e.x), wz(e.y), 24, { n: e.n });
    play(FXP.shock, wx(e.x), wz(e.y), 2, { color: hdr(BURST_COLOR[k], 1.6), size: 76 }); },
  boom(e){ const x = wx(e.x), z = wz(e.y);
    play(FXP.fire, x, z, 22); play(FXP.ember, x, z, 22, { n: e.n*2 }); play(FXP.smoke, x, z, 22, { n: 5 });
    play(FXP.shock, x, z, 2, { color: hdr(e.color, 1.8), size: 92 });
    addScorch(e.x, e.y, 22); pulseLight(e.x, e.y, '#ff8a3d', 9000); },
  ring(e){ play(FXP.shock, wx(e.x), wz(e.y), 2, { color: hdr(e.color, 1.6), size: e.size*2 }); },
  puff(e){ play(FXP.dust, wx(e.x), wz(e.y), 20, { n: e.n, color: hdr(e.color, 1, .8) }); },
  smoke(e){ play(FXP.smoke, wx(e.x), wz(e.y), 20, { n: e.n }); },
  scorch(e){ addScorch(e.x, e.y, e.r); },
  confetti(e){ const per = Math.ceil(e.n / 10);
    for (let i = 0; i < 10; i++) play(FXP.confetti, (Math.random() - .5)*AW*.9, (Math.random() - .5)*AH*.9, 260 + Math.random()*80,
      { n: per, color: hdr(CONFETTI[i % 5]) }); },
};

/* ---------- 地面焦痕 ---------- */
const decals = [];
function addScorch(x, y, r){
  const m = new THREE.Mesh(GEO.plane, new THREE.MeshBasicMaterial({ map: TEX.scorch, transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI/2; m.position.set(wx(x), .6, wz(y)); m.scale.set(r*2.6, r*2, 1);
  world.add(m); decals.push({ m, t: 6 });
  if (decals.length > 30) dropDecal(decals.shift());
}
function dropDecal(d){ world.remove(d.m); d.m.material.dispose(); }
function updateDecals(dt){
  for (const d of decals){ d.t -= dt; d.m.material.opacity = Math.min(1, d.t/1.5); }
  while (decals.length && decals[0].t <= 0) dropDecal(decals.shift());
}

/* ---------- 跟随实体的拖尾 ---------- */
function makeTrail(color, size){
  return new ParticleSystem({ duration: 1, looping: true, autoDestroy: true, worldSpace: true,
    startLife: new IntervalValue(.16, .28), startSpeed: new IntervalValue(0, 15), startSize: new IntervalValue(size*1.3, size*1.9),
    startColor: new ConstantColor(hdr(color, 3)), emissionOverTime: new ConstantValue(110),
    shape: new SphereEmitter({ radius: size*.3, thickness: 1 }), material: PMAT.softAdd, renderMode: RenderMode.BillBoard,
    behaviors: [shrink(), fade()] });
}

/* ---------- 图片素材（占位接口） ---------- */
const IMGS = {};
function imageTex(src){
  if (!src) return null;
  let e = IMGS[src];
  if (!e){ e = IMGS[src] = { tex: null }; new THREE.TextureLoader().load(src, t => { t.colorSpace = THREE.SRGBColorSpace; e.tex = t; }); }
  return e.tex;
}
function imageView(src, size){
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true }));
  const g = new THREE.Group(); g.add(sp);
  return { obj: g, update(x, y, r){ const t = imageTex(src); if (t && sp.material.map !== t){ sp.material.map = t; sp.material.needsUpdate = true; }
    sp.visible = !!t; sp.scale.setScalar(r*size); g.position.set(wx(x), r*size/2, wz(y)); } };
}

/* ---------- 实体造型库：look.draw 字段挑一个 ---------- */
const LOOKS = {
  chicken(en){
    const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
    body.add(outline(mesh(GEO.sphere, MAT.chicken), MAT.chickenLine, 1.12));
    const comb = mesh(GEO.lowSphere, MAT.comb); comb.scale.setScalar(.34); comb.position.set(-.1, 1, 0);
    const beak = mesh(GEO.cone, MAT.beak); beak.scale.set(.3, .7, .3); beak.rotation.z = -Math.PI/2; beak.position.set(1.1, .05, 0);
    body.add(comb, beak);
    for (const s of [-1, 1]){ const e = mesh(GEO.lowSphere, MAT.ink, false); e.scale.setScalar(.15); e.position.set(.62, .38, s*.48); body.add(e); }
    const wings = [-1, 1].map(s => { const w = mesh(GEO.lowSphere, MAT.wing); w.scale.set(.55, .35, .2); w.position.set(-.15, -.05, s*.92); body.add(w); return w; });
    body.scale.setScalar(9);
    return { obj: g, update(en, t){
      g.position.set(wx(en.x), 9 + Math.abs(Math.sin(t*18 + en.seed*2))*4, wz(en.y));
      g.rotation.y = -Math.atan2(en.vy, en.vx);
      wings.forEach((w, i) => w.rotation.x = Math.sin(t*30 + en.seed) * .6 * (i ? 1 : -1));
    } };
  },
  banana(en){
    const g = new THREE.Group(), b = outline(mesh(GEO.banana, MAT.banana), MAT.bananaLine, 1.06);
    b.rotation.x = -Math.PI/2; b.position.set(0, 4, 6); g.add(b);
    return { obj: g, update(en, t){ g.position.set(wx(en.x), 0, wz(en.y)); g.rotation.y = en.seed - .3; b.visible = en.armed || Math.sin(t*20) > 0; } };
  },
  fireball(en){
    const c = (en.look && en.look.color) || '#ff6a2a', g = new THREE.Group();
    const core = mesh(GEO.sphere, basic(hdrC('#fff0c0', 4)), false); core.scale.setScalar(en.r*.55);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.soft, color: hdrC(c, 2.6), blending: THREE.AdditiveBlending, depthWrite: false }));
    halo.scale.setScalar(en.r*4); g.add(core, halo);
    const light = takeLight(en, c);
    return { obj: g, light, update(en, t){
      const f = 1 + Math.sin(t*40 + en.seed*3)*.12;
      g.position.set(wx(en.x), 22, wz(en.y)); core.scale.setScalar(en.r*.55*f); halo.scale.setScalar(en.r*4*f);
      if (light){ light.l.position.copy(g.position); light.l.intensity = 2600 * (en.r/13) * f; }
    } };
  },
  cloud(en){
    const g = new THREE.Group(), mat = MAT.cloud.clone(), body = new THREE.Group(); g.add(body);
    for (const [x, y, z, r] of [[-16, 2, 0, 12], [0, 6, -2, 16], [16, 2, 0, 12], [0, -2, 6, 13], [-6, 4, -8, 11]])
      { const p = outline(mesh(GEO.sphere, mat), MAT.cloudLine, 1.07); p.scale.setScalar(r); p.position.set(x, y, z); body.add(p); }
    for (const s of [-1, 1]){ const e = mesh(GEO.lowSphere, MAT.ink, false); e.scale.setScalar(2.4); e.position.set(s*7, 2, 16.5); body.add(e); }
    const bolt = new THREE.Group(); world.add(bolt);
    const light = takeLight(en, '#9ff3ff');
    return { obj: g, light, extra: bolt, update(en, t){
      const hover = (en.cfg.zone && en.cfg.zone.hover) || 0;
      g.position.set(wx(en.x), 100 + Math.sin(t*3 + en.seed)*4, wz(en.y + hover)); // 游戏里 hover 是往北偏，3D 里画成悬在头顶
      const lit = en.boltT > 0;
      mat.emissive.set(lit ? '#7fdcff' : '#000000'); mat.emissiveIntensity = lit ? 1.6 : 0;
      bolt.clear();
      if (light){ light.l.position.set(g.position.x, 60, g.position.z); light.l.intensity = lit ? 9000 : 0; }
      if (!lit) return;
      const a = V3(g.position.x, g.position.y - 14, g.position.z), b = V3(wx(en.boltX), 24, wz(en.boltY)), path = new THREE.CurvePath();
      let prev = a;
      for (let i = 1; i <= 6; i++){
        const f = i/6, j = i < 6 ? 14 : 0, p = a.clone().lerp(b, f).add(V3((Math.random()-.5)*j*2, 0, (Math.random()-.5)*j*2));
        path.add(new THREE.LineCurve3(prev, p)); prev = p;
      }
      bolt.add(new THREE.Mesh(new THREE.TubeGeometry(path, 36, 1.8, 5), MAT.bolt), new THREE.Mesh(new THREE.TubeGeometry(path, 36, 5, 6), MAT.boltGlow));
    } };
  },
  frostnova(en){ // 地面冰圈 + 一圈冒出来的冰刺，跟着 en.radius 扩散
    const g = new THREE.Group(), ringM = basic(hdrC('#9be8ff', 2.2), { transparent: true, depthWrite: false }),
      discM = basic('#c9f3ff', { transparent: true, opacity: .3, depthWrite: false });
    const ring = new THREE.Mesh(GEO.flatRing, ringM), disc = new THREE.Mesh(GEO.disc, discM);
    ring.rotation.x = disc.rotation.x = -Math.PI/2; ring.position.y = 1.5; disc.position.y = 1; g.add(disc, ring);
    const shards = Array.from({ length: 16 }, (_, i) => { const s = mesh(GEO.cone, MAT.ice);
      s.userData.a = i/16*Math.PI*2 + Math.random()*.2; s.userData.h = 14 + Math.random()*12; g.add(s); return s; });
    const life0 = en.life; pulseLight(en.x, en.y, '#7fd8ff', 7000);
    return { obj: g, update(en, t){
      const r = Math.max(1, en.radius || 0), fadeK = Math.min(1, en.life/.25), grow = Math.min(1, (life0 - en.life)/.15);
      g.position.set(wx(en.x), 0, wz(en.y));
      ring.scale.set(r, r, 1); disc.scale.set(r, r, 1);
      ringM.opacity = fadeK; discM.opacity = .3*fadeK;
      for (const s of shards){ const h = s.userData.h * grow * fadeK;
        s.position.set(Math.cos(s.userData.a)*r*.9, h/2, Math.sin(s.userData.a)*r*.9); s.scale.set(4, Math.max(.01, h), 4); }
    } };
  },
  coaster(en){ // 过山车：一节俯冲的车厢，四个轮子 + 露头的乘客，沿轨道起伏俯仰
    const g = new THREE.Group(), car = new THREE.Group(); g.add(car);
    const body = mesh(GEO.box, toon('#e8433c')); body.scale.set(46, 20, 30); car.add(body);
    const stripe = mesh(GEO.box, MAT.star); stripe.scale.set(47, 5, 31); stripe.position.y = 8; car.add(stripe);
    for (const s of [-1, 1]){
      const rail = mesh(GEO.box, basic('#8d2b22')); rail.scale.set(50, 4, 4); rail.position.set(0, 13, s*14); car.add(rail);
      const head = mesh(GEO.lowSphere, toon('#f08c1e')); head.scale.setScalar(8); head.position.set(s*11, 18, 0); car.add(head);
      const eye = mesh(GEO.lowSphere, MAT.ink, false); eye.scale.setScalar(2); eye.position.set(s*11 + 5, 19, 6); car.add(eye);
    }
    const wheels = [];
    for (const sx of [-1, 1]) for (const sz of [-1, 1]){
      const w = mesh(GEO.lowSphere, MAT.ink); w.scale.setScalar(7); w.position.set(sx*15, -12, sz*13); car.add(w); wheels.push(w);
    }
    const light = takeLight(en, '#ff5a3d');
    return { obj:g, light, update(en, t){
      const bob = Math.sin(en.age*11)*7, pitch = Math.cos(en.age*11)*.22; // 沿轨道起伏 + 俯仰
      g.position.set(wx(en.x), 26 + bob, wz(en.y));
      g.rotation.y = -Math.atan2(en.vy, en.vx);
      car.rotation.z = pitch;
      wheels.forEach(w => w.rotation.x = en.age*30);
      if (light){ light.l.position.copy(g.position); light.l.intensity = 3200; }
    } };
  },
  sonic(en){ // 声波：几圈同心波纹跟着 en.radius 扩散
    const c = (en.look && en.look.color) || '#ffd34d', g = new THREE.Group();
    const rings = [1, .78, .56].map((k, i) => {
      const m = basic(hdrC(c, 2.6 - i*.5), { transparent:true, opacity:1, depthWrite:false, side:THREE.DoubleSide });
      const r = new THREE.Mesh(GEO.flatRing, m); r.rotation.x = -Math.PI/2; r.position.y = 2 + i; g.add(r);
      return { mesh:r, mat:m, k };
    });
    pulseLight(en.x, en.y, c, 6000);
    return { obj:g, update(en, t){
      const rad = Math.max(1, en.radius || 0), fadeK = Math.min(1, en.life/.25);
      g.position.set(wx(en.x), 0, wz(en.y));
      for (const { mesh, mat, k } of rings){ mesh.scale.set(rad*k, rad*k, 1); mat.opacity = fadeK; }
    } };
  },
  none(){ return { obj: new THREE.Group(), update(){} }; },
};

const views = new Map(); // entity → 造型
function makeView(en){
  const look = en.look || {};
  let v;
  if (look.image){ const iv = imageView(look.image, 2.4); v = { obj: iv.obj, update: en => iv.update(en.x, en.y, en.r) }; }
  else v = (LOOKS[look.draw] || LOOKS.none)(en);
  world.add(v.obj);
  if (en.cfg.trail){ v.trail = makeTrail(en.cfg.trail, en.r); v.obj.add(v.trail.emitter); BATCH.addSystem(v.trail); }
  return v;
}
function dropView(v){
  if (v.trail){ fxRoot.attach(v.trail.emitter); v.trail.endEmit(); } // 拖尾留在原地自然消散
  world.remove(v.obj); if (v.extra){ v.extra.clear(); world.remove(v.extra); }
  freeLight(v.light);
}
function syncEntities(t){
  const live = new Set(entities);
  for (const [en, v] of views) if (!live.has(en)){ dropView(v); views.delete(en); }
  for (const en of entities){ let v = views.get(en); if (!v){ v = makeView(en); views.set(en, v); } v.update(en, t); }
}

/* ---------- 角色 ---------- */
function makePlayerView(p){
  const root = new THREE.Group(), yaw = new THREE.Group(), squash = new THREE.Group(), unyaw = new THREE.Group(), spin = new THREE.Group();
  root.add(yaw); yaw.add(squash); squash.add(unyaw); unyaw.add(spin); scene.add(root);
  const mat = toon(p.color), body = outline(mesh(GEO.sphere, mat), basic(p.dark, { side: THREE.BackSide }), 1.07);
  const face = new THREE.Group(), eyes = new THREE.Group(); face.add(eyes); spin.add(body, face);
  for (const s of [-1, 1]){
    const w = mesh(GEO.lowSphere, MAT.eyeWhite, false); w.scale.set(.12, .3, .22); w.position.set(.84, .18, s*.34);
    const pu = mesh(GEO.lowSphere, MAT.ink, false); pu.scale.set(.08, .18, .13); pu.position.set(.95, .17, s*.33);
    const hl = mesh(GEO.lowSphere, MAT.eyeWhite, false); hl.scale.setScalar(.045); hl.position.set(1.02, .26, s*.3);
    eyes.add(w, pu, hl);
  }
  const mouthHolder = new THREE.Group(), mouth = mesh(GEO.smile, MAT.ink, false);
  mouthHolder.position.set(.9, -.2, 0); mouthHolder.rotation.y = Math.PI/2; mouthHolder.add(mouth); face.add(mouthHolder);
  const aura = new THREE.Mesh(GEO.ring, MAT.aura); aura.rotation.x = -Math.PI/2; scene.add(aura);
  const stars = [0, 1, 2].map(() => { const s = mesh(GEO.star, MAT.star, false); s.scale.setScalar(6); scene.add(s); return s; });
  const img = p.image ? imageView(p.image, 2.3) : null; if (img) scene.add(img.obj);
  const ice = mesh(GEO.crystal, MAT.iceBlock, false); ice.rotation.set(.3, .5, .1); scene.add(ice);
  return { p, root, yaw, squash, unyaw, spin, mat, face, eyes, mouth, aura, stars, img, body, ice };
}
function disposePlayerView(v){ scene.remove(v.root, v.aura, v.ice, ...v.stars); if (v.img) scene.remove(v.img.obj); }
function updatePlayerView(v, p, t){
  const r = p.r, foe = other(p);
  let ang = Math.atan2(p.vy, p.vx), k = Math.min(.16, Math.hypot(p.vx, p.vy)/1600);
  if (p.wince > 0){ ang = p.hitAng; k = -p.wince*.55; }
  if (p.dead) k = 0;
  const b = p.frozen > 0 ? 1 : (1 + Math.sin(t*5)*.025) * (1 - p.castT); // 呼吸 + 施法前竖向压扁；冰冻时不动
  v.yaw.rotation.y = -ang; v.unyaw.rotation.y = ang;
  v.squash.scale.set((1 + k)/Math.sqrt(b), b, 1/((1 + k)*Math.sqrt(b)));
  v.spin.scale.setScalar(r);
  v.spin.rotation.set(p.stun > 0 && !p.dead ? Math.sin(p.spin)*.5 : 0, 0, p.dead ? p.spin : 0);
  const jx = p.wince > 0 && !REDUCED ? (Math.random() - .5)*p.wince*20 : 0, jz = p.wince > 0 && !REDUCED ? (Math.random() - .5)*p.wince*20 : 0;
  v.root.position.set(wx(p.x) + jx, r*b, wz(p.y) + jz);
  const dx = foe.x - p.x, dz = foe.y - p.y, l = Math.hypot(dx, dz) || 1; // 脸：朝对手，同时偏向镜头
  v.face.rotation.set(0, -Math.atan2(dz/l*.5 + 1.2, dx/l*.5), .5);
  v.eyes.scale.y = p.dead || p.blink < 0 || p.wince > 0 ? .15 : 1;
  v.mouth.rotation.z = p.wince > 0 || p.stun > 0 || p.frozen > 0 || p.dead ? 0 : Math.PI;
  const f = p.flash/.14, red = p.wince*1.4;
  const cold = p.frozen > 0 ? .7 : p.slowT > 0 ? .35 : 0; // 减速发蓝，冰冻更蓝
  v.mat.emissive.setRGB(f*2.5 + red*.9, f*2.5 + red*.15 + cold*.45, f*2.5 + red*.1 + cold); // 闪白超过 1 会被 bloom 点亮
  v.ice.visible = p.frozen > 0;
  if (p.frozen > 0){ v.ice.position.set(wx(p.x), r, wz(p.y)); v.ice.scale.setScalar(r*1.45); }
  v.aura.visible = !!p.mods;
  if (p.mods){ v.aura.position.set(wx(p.x), 3, wz(p.y)); v.aura.scale.setScalar(r + 10 + Math.sin(t*10)*3); }
  v.stars.forEach((s, i) => { s.visible = p.stun > 0;
    const a = t*5 + i*2.1; s.position.set(wx(p.x) + Math.cos(a)*20, r*2*b + 16, wz(p.y) + Math.sin(a)*8); s.rotation.set(0, t*4, 0); });
  if (v.img){ v.img.update(p.x, p.y, r); const show = v.img.obj.children[0].visible; v.body.visible = v.face.visible = !show; }
}
let pviews = [];
function syncPlayers(t){
  if (!pviews.length || pviews[0].p !== p1 || pviews[1].p !== p2){ pviews.forEach(disposePlayerView); pviews = [makePlayerView(p1), makePlayerView(p2)]; }
  updatePlayerView(pviews[0], p1, t); updatePlayerView(pviews[1], p2, t + 3);
}

/* ---------- 每局重置：清掉上一局的实体、焦痕、粒子 ---------- */
let epoch = -1;
function clearWorld(){
  for (const v of views.values()) dropView(v); // 拖尾会被挪进 fxRoot，下一行一起清掉
  views.clear();
  for (const e of [...fxRoot.children]) e.system.dispose();
  while (decals.length) dropDecal(decals.pop());
  LIGHTS.forEach(s => { s.owner = null; s.pulse = 0; s.l.intensity = 0; });
}
function updateLights(dt){
  for (const s of LIGHTS) if (!s.owner && s.pulse > 0){ s.pulse = Math.max(0, s.pulse - dt*4); s.l.intensity = s.power * s.pulse; }
}

/* ---------- 镜头：屏震 + KO 推近 ---------- */
const camTarget = V3(0, 0, 0);
function placeCamera(t){
  camera.position.copy(CAM.pos); camTarget.copy(CAM.target);
  if (state === 'ko' && winner && !REDUCED){
    const L = other(winner), k = easeOut(Math.min(1, -stateT/.45)), lp = V3(wx(L.x), L.r, wz(L.y));
    camTarget.lerp(lp, k*.7);
    camera.position.copy(camTarget).add(CAM.pos.clone().sub(CAM.target).multiplyScalar(1 - .35*k));
  }
  if (shake > 0){
    let ox, oz;
    if (shakeDir){ const o = Math.sin(t*90)*shake*.8; ox = shakeDir.x*o + (Math.random()-.5)*shake*.4; oz = shakeDir.y*o + (Math.random()-.5)*shake*.4; }
    else { ox = (Math.random()-.5)*shake; oz = (Math.random()-.5)*shake; }
    camera.position.x += ox; camera.position.z += oz; camTarget.x += ox; camTarget.z += oz;
  }
  camera.lookAt(camTarget);
}

/* ---------- 上层 2D：HUD / 漂浮字 / 大字 / 闪白 ---------- */
function rr(x, y, w, h, r){ r = Math.min(r, w/2, h/2); hctx.beginPath(); hctx.roundRect(x, y, w, h, r); }
const popScale = age => age < .1 ? .4 + age*8 : Math.max(1, 1.2 - (age - .1)*1.5);
function outlined(text, x, y, size, color, lw){
  hctx.font = size + 'px "ZCOOL KuaiLe", sans-serif';
  hctx.lineWidth = lw; hctx.strokeStyle = 'rgba(60,40,10,.6)'; hctx.strokeText(text, x, y);
  hctx.fillStyle = color; hctx.fillText(text, x, y);
}
const pv = V3(0, 0, 0);
function toScreen(x, y, h){ pv.set(wx(x), h, wz(y)).project(camera); return [(pv.x + 1)/2*W, (1 - pv.y)/2*H]; }
function drawFloats(){
  hctx.textAlign = 'center'; hctx.textBaseline = 'middle';
  for (const f of floats){
    const [sx, sy] = toScreen(f.x, f.y, 40), sc = popScale(f.max - f.t);
    hctx.globalAlpha = Math.min(1, f.t*3);
    hctx.save(); hctx.translate(sx, sy); hctx.scale(sc, sc);
    outlined(f.text, 0, 0, f.size, f.color, 4);
    if (f.sub) outlined(f.sub, 0, f.size*.95, f.size*.85, '#ffd34d', 4);
    hctx.restore();
  }
  hctx.globalAlpha = 1;
}
const ghost = new WeakMap();
function drawHUD(fdt){
  for (const [p, left] of [[p1, true], [p2, false]]){
    const bw = 330, x = left ? 22 : W - 22 - bw, y = 18;
    let gh = ghost.get(p); if (gh == null || gh < p.hp) gh = p.hp;
    gh += (p.hp - gh) * Math.min(1, fdt*2.5); ghost.set(p, gh);
    const bar = (v, c) => { const w = bw * v/100; if (w > 1){ hctx.fillStyle = c; rr(left ? x : x + bw - w, y, w, 20, 10); hctx.fill(); } };
    hctx.fillStyle = 'rgba(40,25,5,.35)'; rr(x, y, bw, 20, 10); hctx.fill();
    bar(gh, '#fff1c2'); bar(p.hp, p.hp > 35 ? '#5fd068' : '#f2574b');
    hctx.fillStyle = 'rgba(255,255,255,.25)'; rr(x + 6, y + 3, bw - 12, 6, 3); hctx.fill();
    hctx.fillStyle = '#3a2c10'; hctx.font = '15px "ZCOOL KuaiLe", sans-serif';
    hctx.textAlign = left ? 'left' : 'right'; hctx.textBaseline = 'middle';
    hctx.fillText(p.name + '  ' + Math.ceil(p.hp), left ? x + 10 : x + bw - 10, y + 11);
    p.skills.forEach((s, i) => {
      const cfg = SKILLS[s.id], sx = left ? x + i*150 : x + bw - 150 - i*150, sy = y + 28;
      hctx.fillStyle = s.t > 0 ? 'rgba(40,25,5,.3)' : 'rgba(255,255,255,.8)';
      rr(sx, sy, 140, 24, 8); hctx.fill();
      if (s.t > 0){ hctx.fillStyle = 'rgba(255,255,255,.55)';
        const frac = 1 - s.t/cfg.cd; if (frac > 0){ rr(sx, sy, 140*frac, 24, 8); hctx.fill(); } }
      hctx.fillStyle = '#3a2c10'; hctx.textAlign = 'left';
      hctx.fillText(cfg.key + ' · ' + cfg.label, sx + 9, sy + 13);
    });
  }
}
function drawOverlay(fdt){
  hctx.setTransform(hud.width/W, 0, 0, hud.height/H, 0, 0);
  hctx.clearRect(0, 0, W, H);
  drawFloats();
  if (flashA > 0){ hctx.fillStyle = `rgba(255,255,255,${flashA})`; hctx.fillRect(0, 0, W, H); }
  hctx.textAlign = 'center'; hctx.textBaseline = 'middle';
  if (state === 'countdown'){
    const n = Math.ceil(stateT - .4), label = n >= 1 ? n : '开打！', sc = popScale((n >= 1 ? n : 0) + .4 - stateT);
    hctx.save(); hctx.translate(W/2, H/2 - 20); hctx.scale(sc, sc);
    outlined(label, 0, 0, 86, n >= 1 ? '#fff' : '#ffd34d', 8); hctx.restore();
  }
  if (state === 'ko' && !koShown){
    hctx.save(); hctx.translate(W/2, H/2 - 10); hctx.rotate(-.05); const sc = popScale(-stateT); hctx.scale(sc, sc);
    outlined('KO！', 0, 0, 110, '#ffd34d', 10); hctx.restore();
  }
  drawHUD(fdt);
}

/* ---------- 对外：main.js 调这两个 ---------- */
export function fit(){
  const w = cv.clientWidth || W, h = Math.round(w * H / W), dpr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(dpr); composer.setSize(w, h, false);
  hud.width = Math.round(w * dpr); hud.height = Math.round(h * dpr);
}
addEventListener('resize', fit);

let lastT = 0;
export function draw(t){
  const rdt = Math.min(.05, Math.max(0, t - lastT)); lastT = t;
  if (epoch !== fxEpoch){ epoch = fxEpoch; clearWorld(); }
  for (const e of takeFx()) (FX[e.type] || (() => {}))(e);
  syncPlayers(t); syncEntities(t);
  updateDecals(rdt); updateLights(rdt);
  BATCH.update(hitstop > 0 ? 0 : rdt * (slowmo > 0 ? .22 : 1)); // 粒子跟着定格 / 慢动作
  placeCamera(t);
  composer.render(rdt);
  drawOverlay(rdt);
}
