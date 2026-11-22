'use strict';
/* ============================================================================
   角色配置：孩子 / AI 改角色只碰这个文件。
   skills 里的名字对应 skills.js 的技能；名字 / 颜色 / 键位 / 图例 / 标题
   全部从这里生成——改一处，页面和游戏一起跟着变。
   keys 用键码（KeyW / ArrowUp 这种）；spawnX 是出生点横坐标（场地宽 960）。
   image 可选（素材占位）：透明底 PNG 路径，写了就用图片代替程序画的圆球和脸。
   ============================================================================ */
const CHARACTERS = [
  {
    name:'咕咕大王',
    color:'#f08c1e', dark:'#b5620a',
    keys:{ up:'KeyW', down:'KeyS', left:'KeyA', right:'KeyD' },
    skills:['sonic','coaster'],
    spawnX:200,
    // image:'assets/gugu.png',
  },
  {
    name:'泡泡法师',
    color:'#8a6cf0', dark:'#5a3fc0',
    keys:{ up:'ArrowUp', down:'ArrowDown', left:'ArrowLeft', right:'ArrowRight' },
    skills:[],
    spawnX:760,
    // image:'assets/paopao.png',
  },
];
