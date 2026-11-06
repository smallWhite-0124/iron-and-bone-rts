export const WORLD = {
  width: 3200,
  height: 900,
  viewWidth: 1600,
  groundY: 684,
  battlefieldFarY: 515,
  battlefieldNearY: 704,
  horizonY: 305,
  playerBaseX: 110,
  enemyBaseX: 3090,
  baseArmyCap: 8,
  barracksBaseCap: 8,
  barracksCapPerLevel: 5,
  initialTerritory: 440,
  territoryMargin: 36,
  buildSpacing: 28,
  queueLimit: 5,
  startingGold: 240,
  baseWidth: 132,
  baseHeight: 212,
};

export const BUILDING_DEFS = {
  mine: {
    name: '资源建筑',
    cost: 80,
    buildTime: 1.35,
    hp: 520,
    width: 92,
    height: 118,
    upgradeCosts: [70, 115],
    income: [15, 22, 30],
  },
  barracks: {
    name: '兵营',
    cost: 120,
    buildTime: 1.8,
    hp: 760,
    width: 112,
    height: 142,
    upgradeCosts: [110, 175],
  },
  tower: {
    name: '防御塔',
    cost: 100,
    buildTime: 1.5,
    hp: 650,
    width: 84,
    height: 164,
    upgradeCosts: [95, 155],
    damage: [20, 31, 45],
    range: [310, 345, 385],
    attackInterval: [1.15, 1.0, 0.84],
  },
  base: {
    name: '基地',
    cost: 0,
    buildTime: 0,
    hp: 2600,
    width: 132,
    height: 212,
    maxLevel: 1,
  },
};

export const FACTIONS = {
  knight: {
    id: 'knight',
    name: '骑士团',
    short: '重甲 · 冲锋 · 火枪',
    color: '#79aefc',
    accent: '#f1c76b',
    dark: '#162844',
    baseName: '王城要塞',
    buildings: {
      mine: '采石场',
      barracks: '训练场',
      tower: '弩炮塔',
      base: '王城要塞',
    },
    units: ['swordKnight', 'shieldKnight', 'lightCavalry', 'gunner', 'heavyCavalry', 'paladin'],
  },
  skeleton: {
    id: 'skeleton',
    name: '骷髅族',
    short: '数量 · 复活 · 控制',
    color: '#b695ff',
    accent: '#76e5c1',
    dark: '#261b37',
    baseName: '骸骨王座',
    buildings: {
      mine: '墓碑',
      barracks: '埋骨地',
      tower: '骨刺塔',
      base: '骸骨王座',
    },
    units: ['boneSoldier', 'boneDog', 'boneShaman', 'boneGiant', 'boneDragon'],
  },
};

export const UNIT_DEFS = {
  swordKnight: {
    id: 'swordKnight', faction: 'knight', name: '剑骑士', role: '基础近战',
    cost: 45, trainTime: 2, hp: 138, damage: 18, attackInterval: 0.86, range: 48, speed: 66,
    mass: 2, radius: 17, damageType: 'melee', aggro: 470, drawType: 'sword',
    description: '低成本 frontline，数量起来后持续输出。',
  },
  shieldKnight: {
    id: 'shieldKnight', faction: 'knight', name: '盾骑士', role: '远程抗线',
    cost: 78, trainTime: 2.7, hp: 226, damage: 13, attackInterval: 1.02, range: 48, speed: 50,
    mass: 3, radius: 19, damageType: 'melee', aggro: 430, drawType: 'shield',
    resist: { ranged: 0.5 }, description: '受到物理远程伤害降低 50%，但移动较慢。',
  },
  lightCavalry: {
    id: 'lightCavalry', faction: 'knight', name: '轻骑兵', role: '快速突进',
    cost: 86, trainTime: 2.9, hp: 158, damage: 21, attackInterval: 0.78, range: 59, speed: 104,
    mass: 3, radius: 21, damageType: 'melee', aggro: 540, drawType: 'lightHorse',
    description: '高速接近远程单位，用长矛压制后排。',
  },
  gunner: {
    id: 'gunner', faction: 'knight', name: '火枪手', role: '破甲远程',
    cost: 72, trainTime: 2.6, hp: 102, damage: 27, attackInterval: 1.7, range: 330, speed: 45,
    mass: 2, radius: 16, damageType: 'ranged', aggro: 550, drawType: 'gunner',
    armorPierce: 0.5, projectileSpeed: 720, projectileColor: '#ffd27a',
    description: '射程远，破甲 50%，但装填慢且害怕近身。',
  },
  heavyCavalry: {
    id: 'heavyCavalry', faction: 'knight', name: '重骑兵', role: '冲锋突破',
    cost: 155, trainTime: 4.2, hp: 338, damage: 31, attackInterval: 1.08, range: 60, speed: 82,
    mass: 4, radius: 23, damageType: 'melee', aggro: 520, drawType: 'heavyHorse',
    charge: { distance: 125, impact: 4, multiplier: 1.5, cooldown: 8, knockdown: 1.25 },
    description: '进攻状态下蓄力冲锋，第一次命中造成高冲击和倒地。',
  },
  paladin: {
    id: 'paladin', faction: 'knight', name: '圣骑士', role: '精英重装',
    cost: 265, trainTime: 6, hp: 545, damage: 43, attackInterval: 1.16, range: 52, speed: 38,
    mass: 5, radius: 23, damageType: 'melee', aggro: 430, drawType: 'paladin',
    resist: { melee: 0.35, ranged: 0.7 }, description: '近战减伤 35%、远程减伤 70%，但速度极慢且造价高昂。',
  },

  boneSoldier: {
    id: 'boneSoldier', faction: 'skeleton', name: '骨兵', role: '数量炮灰',
    cost: 29, trainTime: 1.6, hp: 91, damage: 12, attackInterval: 0.73, range: 44, speed: 72,
    mass: 2, radius: 15, damageType: 'melee', aggro: 470, drawType: 'boneSoldier',
    deathValue: 1, description: '廉价而脆弱，用数量和复活拖垮敌人。',
  },
  boneDog: {
    id: 'boneDog', faction: 'skeleton', name: '骨头犬', role: '控制突击',
    cost: 44, trainTime: 1.9, hp: 74, damage: 8, attackInterval: 0.38, range: 37, speed: 130,
    mass: 1, radius: 16, damageType: 'melee', aggro: 560, drawType: 'boneDog',
    firstImpact: 2, deathValue: 1, description: '首次攻击拥有冲击力 2，可扑倒轻装单位。',
  },
  boneShaman: {
    id: 'boneShaman', faction: 'skeleton', name: '骨萨满', role: '复活辅助',
    cost: 98, trainTime: 3.2, hp: 112, damage: 13, attackInterval: 1.55, range: 230, speed: 44,
    mass: 2, radius: 17, damageType: 'magic', aggro: 500, drawType: 'shaman',
    projectileSpeed: 360, projectileColor: '#8df4cb', revive: true, deathValue: 3,
    description: '自动施放远程魔法；多个萨满共同积攒复活点数。',
  },
  boneGiant: {
    id: 'boneGiant', faction: 'skeleton', name: '骨巨人', role: '重型突破',
    cost: 218, trainTime: 5.2, hp: 640, damage: 49, attackInterval: 1.72, range: 63, speed: 33,
    mass: 5, radius: 28, damageType: 'melee', aggro: 450, drawType: 'boneGiant',
    heavyImpact: { impact: 4, cooldown: 4.2, knockdown: 1.0 }, deathValue: 6,
    description: '骨锤重击拥有冲击力 4，能撼动重装阵线。',
  },
  boneDragon: {
    id: 'boneDragon', faction: 'skeleton', name: '骨恶龙', role: '飞行范围',
    cost: 330, trainTime: 7, hp: 365, damage: 36, attackInterval: 2.05, range: 300, speed: 74,
    mass: 5, radius: 29, damageType: 'explosive', aggro: 620, drawType: 'boneDragon',
    flying: true, projectileSpeed: 300, projectileColor: '#a9ff8b', aoeRadius: 78,
    cannotRevive: true, description: '飞行远程范围攻击，所有远程单位和防御塔都能对空。',
  },
};

export const REVIVE_RULES = {
  interval: 9,
  pointsPerShaman: 3,
  corpseLifetime: 14,
  revivedHpRatio: 0.48,
};

export const COMMANDS = {
  attack: { label: '进攻', color: '#ff795e' },
  hold: { label: '驻守', color: '#74a9ff' },
  retreat: { label: '撤退', color: '#6ee7b7' },
};

export function getUnitDef(id) {
  return UNIT_DEFS[id];
}




