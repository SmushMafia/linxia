'use strict';
/* ============================================================================
   技能配置：孩子 / AI 改技能只碰这个文件。
   技能 = 配置对象，三层全参数化：
     spawn    生成什么（数量 / 位置 / 初速）
     entity   怎么动（behavior）+ 碰到人怎样（hit）
     look     长什么样（draw 函数名 + 颜色 / 大小）
   新技能 = 在 SKILLS 里加一个对象。引擎层免费送：屏震、闪白、击退、粒子。
   behavior 可选值见 engine.js 的 BEHAVIORS；draw 可选值见 render.js 的 LOOKS。
   完整示例（6 个能跑的技能，页面不加载）见 examples/skills.js：写新技能前先参考，可整段复制过来改。
   技能写好后，记得把 id 加进 characters.js 对应角色的 skills 列表。
   look.image 可选（素材占位）：透明底 PNG 路径，写了就画图片，不写用 draw 函数。
   hit.stop 可选：命中定格秒数，不写按伤害自动算。
   hit.slow 可选：{ factor 速度倍率, duration 秒 }；再配 hit.freeze（秒）则减速中再被命中会冰冻。
   key 是按键（字母直接写，如 'Q'；符号写 '.' '/' 等）；desc 显示在键位图例里。
   ============================================================================ */
const SKILLS = {
  sonic: { // 声波：从自身扩散的波纹，震到直接 KO
    label:'声波震击', key:'Q', cd:8, desc:'🔊 声波扩散，震到直接 KO',
    spawn:{ count:1, at:'self' },
    entity:{ behavior:'nova', radius:900, expand:.42, life:.9, damage:100,
      hit:{ knockback:380, shake:12, stop:.22, burst:'spark', pop:'震碎！' } },
    look:{ draw:'sonic', color:'#ffd34d' },
    shout:'声波，震！'
  },
  coaster: { // 过山车：车厢沿起伏轨道追着对手俯冲，撞到直接 KO
    label:'过山车', key:'E', cd:9, desc:'🎢 车厢俯冲撞飞，撞到直接 KO',
    spawn:{ count:1, at:'self' },
    entity:{ behavior:'seek', speed:520, accel:1500, life:4, r:30, damage:100,
      trail:'#ff5a3d',
      hit:{ knockback:520, shake:14, stop:.3, burst:'star', pop:'撞飞！' } },
    look:{ draw:'coaster' },
    shout:'过山车，出发！'
  },
};
