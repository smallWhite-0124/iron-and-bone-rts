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
  arcane: {
    id: 'arcane',
    name: '秘法教团',
    short: '魔法 · 召唤 · 治疗',
    color: '#d58cff',
    accent: '#75efd0',
    dark: '#241535',
    baseName: '秘法核心',
    buildings: {
      mine: '魔力祭坛',
      barracks: '召唤法阵',
      tower: '符文塔',
      base: '秘法核心',
    },
    units: ['warlock', 'wizard', 'occultist', 'hera', 'ancientBeast'],
  },
  special: {
    id: 'special',
    name: '特战部队',
    short: '枪械 · 装甲 · 压制',
    color: '#78c78d',
    accent: '#f2bd57',
    dark: '#172a24',
    baseName: '前线指挥部',
    buildings: {
      mine: '钻井平台',
      barracks: '特勤基地',
      tower: '哨戒炮',
      base: '前线指挥部',
    },
    units: ['swat', 'riotPolice', 'specialForces', 'tank', 'helicopter'],
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

  warlock: {
    id: 'warlock', faction: 'arcane', name: '术士', role: '远程魔法',
    cost: 90, trainTime: 2.5, hp: 128, damage: 18, attackInterval: 1.45, range: 260, speed: 48,
    mass: 2, radius: 17, damageType: 'magic', aggro: 540, drawType: 'warlock',
    projectileSpeed: 430, projectileColor: '#c58cff', description: '稳定的远程魔法输出。',
  },
  wizard: {
    id: 'wizard', faction: 'arcane', name: '巫师', role: '召唤法师',
    cost: 145, trainTime: 3.2, hp: 112, damage: 13, attackInterval: 1.7, range: 220, speed: 44,
    mass: 2, radius: 17, damageType: 'magic', aggro: 510, drawType: 'wizard',
    projectileSpeed: 390, projectileColor: '#8fe8ff',
    summon: { unitId: 'soulSwordsman', count: 2, cooldown: 11, maxActive: 8 },
    description: '自动召唤灵魂剑士，每次召唤 2 个。',
  },
  occultist: {
    id: 'occultist', faction: 'arcane', name: '秘术师', role: '范围控制',
    cost: 175, trainTime: 3.8, hp: 126, damage: 24, attackInterval: 2.1, range: 285, speed: 42,
    mass: 2, radius: 18, damageType: 'magic', aggro: 560, drawType: 'occultist',
    projectileSpeed: 320, projectileColor: '#df8cff', aoeRadius: 74,
    projectileImpact: 3, projectileKnockdown: 0.9,
    description: '范围魔法攻击，并根据质量概率击倒敌人。',
  },
  hera: {
    id: 'hera', faction: 'arcane', name: '希拉', role: '前线治疗',
    cost: 155, trainTime: 3.4, hp: 150, damage: 11, attackInterval: 1.8, range: 190, speed: 48,
    mass: 2, radius: 18, damageType: 'magic', aggro: 480, drawType: 'hera',
    projectileSpeed: 360, projectileColor: '#8dffd7',
    heal: { amount: 30, cooldown: 4.2, range: 175, depth: 72, maxTargets: 4 },
    description: '自动治疗前方一定范围内的友军。',
  },
  ancientBeast: {
    id: 'ancientBeast', faction: 'arcane', name: '远古巨兽', role: '推进范围',
    cost: 330, trainTime: 7, hp: 680, damage: 48, attackInterval: 2.2, range: 330, speed: 31,
    mass: 5, radius: 32, damageType: 'magic', aggro: 600, drawType: 'ancientBeast',
    projectileSpeed: 280, projectileColor: '#ff93ec', aoeRadius: 92, advanceWhileAttacking: true,
    tailSweep: { damage: 72, range: 96, depth: 62, cooldown: 7, impact: 5, knockdown: 1.3 },
    description: '边前进边发射范围激光，贴近后以强力尾击劈倒敌人。',
  },
  soulSwordsman: {
    id: 'soulSwordsman', faction: 'arcane', name: '灵魂剑士', role: '召唤近战',
    cost: 0, trainTime: 0, hp: 98, damage: 17, attackInterval: 0.82, range: 49, speed: 78,
    mass: 2, radius: 16, damageType: 'melee', aggro: 480, drawType: 'soulSword',
    summonOnly: true, description: '由巫师召唤的灵魂近战单位。',
  },

  swat: {
    id: 'swat', faction: 'special', name: '特警', role: '攻防兼备',
    cost: 85, trainTime: 2.7, hp: 220, damage: 16, attackInterval: 0.92, range: 50, speed: 56,
    mass: 3, radius: 19, damageType: 'melee', aggro: 450, drawType: 'swat',
    resist: { ranged: 0.35 }, description: '警棍与防爆盾组合，兼顾输出和生存。',
  },
  riotPolice: {
    id: 'riotPolice', faction: 'special', name: '防爆警', role: '震爆控制',
    cost: 105, trainTime: 3.0, hp: 165, damage: 15, attackInterval: 1.1, range: 235, speed: 50,
    mass: 3, radius: 18, damageType: 'ranged', aggro: 535, drawType: 'riotPolice',
    projectileSpeed: 680, projectileColor: '#ffd36e',
    flashbang: { cooldown: 6, range: 245, damage: 4, aoeRadius: 68, impact: 4, knockdown: 1.0 },
    description: '手枪射击并自动投掷震爆弹，高概率击倒敌人。',
  },
  specialForces: {
    id: 'specialForces', faction: 'special', name: '特种兵', role: '持续射击',
    cost: 135, trainTime: 3.2, hp: 148, damage: 7, attackInterval: 0.22, range: 285, speed: 55,
    mass: 2, radius: 17, damageType: 'ranged', aggro: 560, drawType: 'specialForces',
    projectileSpeed: 900, projectileColor: '#ffe083', resist: { ranged: 0.3 },
    description: '冲锋枪高射速输出，防弹衣降低远程伤害。',
  },
  tank: {
    id: 'tank', faction: 'special', name: '坦克', role: '重装炮击',
    cost: 290, trainTime: 6.5, hp: 650, damage: 55, attackInterval: 2.5, range: 360, speed: 30,
    mass: 5, radius: 30, damageType: 'explosive', aggro: 620, drawType: 'tank',
    projectileSpeed: 300, projectileColor: '#ffbf66', aoeRadius: 88,
    projectileImpact: 4, projectileKnockdown: 1.15, resist: { ranged: 0.3 },
    description: '炮火范围伤害，高冲击力有较大概率击倒敌人。',
  },
  helicopter: {
    id: 'helicopter', faction: 'special', name: '直升机', role: '飞行压制',
    cost: 310, trainTime: 7, hp: 280, damage: 5, attackInterval: 0.12, range: 320, speed: 105,
    mass: 3, radius: 28, damageType: 'ranged', aggro: 650, drawType: 'helicopter',
    flying: true, projectileSpeed: 920, projectileColor: '#ffe883',
    description: '高射速机枪持续压制目标。',
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




