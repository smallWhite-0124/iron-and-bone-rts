import {
  WORLD,
  BUILDING_DEFS,
  FACTIONS,
  UNIT_DEFS,
  REVIVE_RULES,
  COMMANDS,
} from './data.js';

const $ = (id) => document.getElementById(id);
const canvas = $('gameCanvas');
const ctx = canvas.getContext('2d');

const ui = {
  app: $('app'),
  uiLayer: $('uiLayer'),
  canvas,
  playerFaction: $('playerFaction'),
  enemyFaction: $('enemyFaction'),
  playerBaseHp: $('playerBaseHp'),
  enemyBaseHp: $('enemyBaseHp'),
  playerBaseBar: $('playerBaseBar'),
  enemyBaseBar: $('enemyBaseBar'),
  playerArmy: $('playerArmy'),
  enemyArmy: $('enemyArmy'),
  goldAmount: $('goldAmount'),
  incomeAmount: $('incomeAmount'),
  matchClock: $('matchClock'),
  pauseBtn: $('pauseBtn'),
  speedBtn: $('speedBtn'),
  newGameBtn: $('newGameBtn'),
  soundBtn: $('soundBtn'),
  hintBar: $('hintBar'),
  buildCards: [...document.querySelectorAll('.build-card')],
  buildHint: $('buildHint'),
  selectionTitle: $('selectionTitle'),
  selectionSub: $('selectionSub'),
  selectionActions: $('selectionActions'),
  unitButtons: $('unitButtons'),
  commandButtons: [...document.querySelectorAll('.command-btn')],
  toast: $('toast'),
  startScreen: $('startScreen'),
  endScreen: $('endScreen'),
  endTitle: $('endTitle'),
  endDescription: $('endDescription'),
  pauseOverlay: $('pauseOverlay'),
  startBtn: $('startBtn'),
  restartBtn: $('restartBtn'),
  factionChoices: [...document.querySelectorAll('.faction-choice')],
  errorOverlay: $('errorOverlay'),
};

if (!ctx) {
  throw new Error('Canvas 2D context is not available.');
}

const LONG_PRESS_MS = 165;
const COMMAND_KEYS = { attack: 'A', hold: 'H', retreat: 'R' };
const DEFAULT_HINT = '建筑卡自由放置，兵种卡每次训练一个。右键己方建筑可拆除并返还 50%。方向键或滚轮移动镜头。';

let state = null;
let selectedFaction = 'knight';
let buildMode = null;
let demolishMode = false;
let selectedBuilding = null;
let selectedUnits = [];
let paused = false;
let gameSpeed = 1;
let pointer = null;
let hoverPoint = null;
let hoverScreenPoint = null;
const camera = { x: 0, velocity: 0, shakeX: 0, shakeY: 0, shakeTime: 0, shakePower: 0 };
const pressedKeys = new Set();
let toastTimer = 0;
let hintTimer = 0;
let hudAccumulator = 0;
let lastFrameTime = performance.now();
let nextId = 1;
let frameFailure = false;
const TARGET_FRAME_MS = 1000 / 60;
const MAX_PARTICLES = 420;
const AUTOSAVE_KEY_PREFIX = 'iron-and-bone-rts.autosave.v2:';
const LEGACY_AUTOSAVE_KEY = 'iron-and-bone-rts.autosave.v1';
const TAB_SESSION_KEY = 'iron-and-bone-rts.tab-session';
const AUTOSAVE_VERSION = 2;
const tabSessionId = (() => {
  try {
    let id = sessionStorage.getItem(TAB_SESSION_KEY);
    if (!id) {
      id = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      sessionStorage.setItem(TAB_SESSION_KEY, id);
    }
    return id;
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
})();
const autosaveKey = () => `${AUTOSAVE_KEY_PREFIX}${tabSessionId}`;
const AUTOSAVE_INTERVAL = 1.5;
const AUTOSAVE_MAX_AGE = 24 * 60 * 60 * 1000;
let autosaveAccumulator = 0;
let restoringSave = false;
let hitStopTimer = 0;
let hitStopCooldown = 0;
let soundEnabled = true;
let audioContext = null;
let lastCombatSoundAt = 0;
let lastFootstepSoundAt = 0;

const backgroundSeeds = Array.from({ length: 180 }, (_, index) => {
  const seed = (index * 16807 + 77) % 2147483647;
  return {
    x: (seed % WORLD.width),
    y: WORLD.groundY + 12 + ((seed >> 4) % 178),
    w: 3 + ((seed >> 7) % 28),
    a: 0.03 + ((seed >> 9) % 10) / 200,
  };
});

function uid(prefix = 'id') {
  return `${prefix}-${nextId++}`;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function formatTime(seconds) {
  const whole = Math.max(0, Math.floor(seconds));
  const mins = String(Math.floor(whole / 60)).padStart(2, '0');
  const secs = String(whole % 60).padStart(2, '0');
  return `${mins}:${secs}`;
}

function otherSide(side) {
  return side.id === 'player' ? state.enemy : state.player;
}

function factionIdOf(side) {
  return side.faction;
}

function factionOf(side) {
  return FACTIONS[side.faction];
}

function initAudio() {
  if (!soundEnabled) return;
  try {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return;
    if (!audioContext) audioContext = new AudioCtor();
    if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
  } catch {
    audioContext = null;
  }
}

function audioReady() {
  return soundEnabled && audioContext && audioContext.state === 'running';
}

function playTone(frequency, duration, volume, type = 'sine', endFrequency = frequency, delay = 0) {
  if (!audioReady()) return;
  const now = audioContext.currentTime + delay;
  const oscillator = audioContext.createOscillator();
  const gain = audioContext.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(Math.max(30, frequency), now);
  oscillator.frequency.exponentialRampToValueAtTime(Math.max(30, endFrequency), now + duration);
  gain.gain.setValueAtTime(Math.max(0.0001, volume), now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  oscillator.connect(gain).connect(audioContext.destination);
  oscillator.start(now);
  oscillator.stop(now + duration + 0.02);
}

function playNoise(duration, volume, cutoff = 900, delay = 0) {
  if (!audioReady()) return;
  const now = audioContext.currentTime + delay;
  const sampleCount = Math.max(1, Math.floor(audioContext.sampleRate * duration));
  const buffer = audioContext.createBuffer(1, sampleCount, audioContext.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < sampleCount; index += 1) {
    const envelope = 1 - index / sampleCount;
    data[index] = (Math.random() * 2 - 1) * envelope;
  }
  const source = audioContext.createBufferSource();
  const filter = audioContext.createBiquadFilter();
  const gain = audioContext.createGain();
  source.buffer = buffer;
  filter.type = 'lowpass';
  filter.frequency.value = cutoff;
  gain.gain.setValueAtTime(volume, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  source.connect(filter).connect(gain).connect(audioContext.destination);
  source.start(now);
  source.stop(now + duration + 0.02);
}

function playCombatSound(kind, strength = 1, delay = 0) {
  if (!audioReady()) return;
  const now = performance.now();
  if (!delay && now - lastCombatSoundAt < 42) return;
  if (!delay) lastCombatSoundAt = now;
  const power = clamp(strength, 0.35, 1.6);
  if (kind === 'magic') {
    playTone(520 * power, 0.13, 0.025, 'triangle', 210, delay);
    playTone(840, 0.09, 0.012, 'sine', 430, delay);
  } else if (kind === 'explosive') {
    playTone(92 * power, 0.28, 0.06, 'sine', 42, delay);
    playNoise(0.22, 0.055, 620, delay);
  } else if (kind === 'ranged') {
    playNoise(0.07, 0.035, 2200, delay);
    playTone(170, 0.045, 0.016, 'square', 95, delay);
  } else if (kind === 'bone') {
    playNoise(0.09, 0.035, 1250, delay);
    playTone(240, 0.07, 0.022, 'triangle', 130, delay);
  } else {
    playNoise(0.08, 0.04, 1050, delay);
    playTone(125, 0.09, 0.03, 'triangle', 72, delay);
  }
}

function playFootstep(strength = 0.5) {
  if (!audioReady()) return;
  const now = performance.now();
  if (now - lastFootstepSoundAt < 95) return;
  lastFootstepSoundAt = now;
  playNoise(0.045, 0.008 * strength, 420);
}

function toggleSound() {
  soundEnabled = !soundEnabled;
  if (soundEnabled) initAudio();
  if (ui.soundBtn) ui.soundBtn.textContent = soundEnabled ? '音效 开' : '音效 关';
}

function showFatal(error) {
  const message = error?.stack || error?.message || String(error);
  ui.errorOverlay.textContent = `游戏运行出错\n\n${message}`;
  ui.errorOverlay.classList.add('visible');
  console.error(error);
}

window.addEventListener('error', (event) => showFatal(event.error || event.message));
window.addEventListener('unhandledrejection', (event) => showFatal(event.reason));

function setToast(message, duration = 2300) {
  ui.toast.textContent = message;
  ui.toast.classList.add('show');
  toastTimer = duration / 1000;
}

function setHint(message, duration = 0) {
  ui.hintBar.textContent = message;
  ui.hintBar.style.opacity = '1';
  hintTimer = duration;
}

function resetHint() {
  setHint(DEFAULT_HINT);
}

function makeBase(sideId, factionId) {
  const x = sideId === 'player' ? WORLD.playerBaseX : WORLD.enemyBaseX;
  return {
    id: uid('base'),
    kind: 'base',
    isBuilding: true,
    isBase: true,
    type: 'base',
    side: sideId,
    faction: factionId,
    name: FACTIONS[factionId].baseName,
    x,
    y: sideId === 'player' ? 682 : 676,
    width: WORLD.baseWidth,
    height: WORLD.baseHeight,
    hp: BUILDING_DEFS.base.hp,
    maxHp: BUILDING_DEFS.base.hp,
    level: 1,
    buildProgress: 1,
    completed: true,
    selected: false,
  };
}

function createSide(sideId, factionId, isPlayer) {
  const base = makeBase(sideId, factionId);
  const initialFrontier = sideId === 'player'
    ? base.x + WORLD.initialTerritory
    : base.x - WORLD.initialTerritory;

  return {
    id: sideId,
    faction: factionId,
    isPlayer,
    gold: WORLD.startingGold,
    base,
    frontierX: initialFrontier,
    initialFrontierX: initialFrontier,
    buildings: [],
    units: [],
    graveyard: [],
    barracksUnit: FACTIONS[factionId].units[0],
    shamanTimer: REVIVE_RULES.interval,
    aiThinkTimer: 0.8,
    aiSwitchTimer: 0,
    aiProduceTimer: 1.2,
    aiUpgradeTimer: 6,
  };
}

function serializeSide(side) {
  return {
    faction: side.faction,
    gold: side.gold,
    baseHp: side.base.hp,
    baseMaxHp: side.base.maxHp,
    frontierX: side.frontierX,
    initialFrontierX: side.initialFrontierX,
    barracksUnit: side.barracksUnit,
    shamanTimer: side.shamanTimer,
    aiThinkTimer: side.aiThinkTimer,
    aiSwitchTimer: side.aiSwitchTimer,
    aiProduceTimer: side.aiProduceTimer,
    aiUpgradeTimer: side.aiUpgradeTimer,
    buildings: side.buildings.map((building) => ({
      type: building.type,
      x: building.x,
      y: building.y,
      level: building.level,
      hp: building.hp,
      maxHp: building.maxHp,
      invested: building.invested,
      completed: building.completed,
      buildProgress: building.buildProgress,
      buildTime: building.buildTime,
      queue: [...building.queue],
      trainTimer: building.trainTimer,
      attackCooldown: building.attackCooldown,
    })),
    units: side.units.map((unit) => ({
      defId: unit.defId,
      x: unit.x,
      y: unit.y,
      preferredY: unit.preferredY,
      hp: unit.hp,
      command: unit.command,
      revived: unit.revived,
    })),
  };
}

function cleanupStaleAutosaves() {
  try {
    const now = Date.now();
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (!key || !key.startsWith(AUTOSAVE_KEY_PREFIX) || key === autosaveKey()) continue;
      try {
        const payload = JSON.parse(localStorage.getItem(key));
        if (!Number.isFinite(payload.savedAt) || now - payload.savedAt > AUTOSAVE_MAX_AGE) {
          localStorage.removeItem(key);
        }
      } catch {
        localStorage.removeItem(key);
      }
    }
  } catch {
    // Storage cleanup is best-effort.
  }
}

function saveGame() {
  if (!state || state.ended || restoringSave) return;
  try {
    localStorage.setItem(autosaveKey(), JSON.stringify({
      version: AUTOSAVE_VERSION,
      savedAt: Date.now(),
      sessionId: tabSessionId,
      selectedFaction,
      time: state.time,
      cameraX: camera.x,
      gameSpeed,
      player: serializeSide(state.player),
      enemy: serializeSide(state.enemy),
    }));
  } catch (error) {
    console.warn('Autosave failed', error);
  }
}

function clearAutosave() {
  try {
    localStorage.removeItem(autosaveKey());
    localStorage.removeItem(LEGACY_AUTOSAVE_KEY);
  } catch {
    // Storage may be unavailable.
  }
  autosaveAccumulator = 0;
}

function loadAutosave() {
  try {
    const raw = localStorage.getItem(autosaveKey());
    if (!raw) return null;
    const payload = JSON.parse(raw);
    if (payload.version !== AUTOSAVE_VERSION || payload.sessionId !== tabSessionId) throw new Error('Autosave session mismatch');
    if (!payload.player || !FACTIONS[payload.player.faction]) throw new Error('Invalid autosave');
    if (!Number.isFinite(payload.savedAt) || Date.now() - payload.savedAt > AUTOSAVE_MAX_AGE) {
      clearAutosave();
      return null;
    }
    return payload;
  } catch {
    clearAutosave();
    return null;
  }
}

function restoreSide(side, data) {
  if (!data) return;
  side.gold = Number.isFinite(data.gold) ? Math.max(0, data.gold) : side.gold;
  side.base.maxHp = Number.isFinite(data.baseMaxHp) ? data.baseMaxHp : side.base.maxHp;
  side.base.hp = clamp(Number.isFinite(data.baseHp) ? data.baseHp : side.base.maxHp, 1, side.base.maxHp);
  side.initialFrontierX = Number.isFinite(data.initialFrontierX) ? data.initialFrontierX : side.initialFrontierX;
  side.frontierX = Number.isFinite(data.frontierX) ? data.frontierX : side.frontierX;
  side.shamanTimer = Number.isFinite(data.shamanTimer) ? data.shamanTimer : REVIVE_RULES.interval;
  side.aiThinkTimer = Number.isFinite(data.aiThinkTimer) ? data.aiThinkTimer : 0.8;
  side.aiSwitchTimer = Number.isFinite(data.aiSwitchTimer) ? data.aiSwitchTimer : 0;
  side.aiProduceTimer = Number.isFinite(data.aiProduceTimer) ? data.aiProduceTimer : 1.2;
  side.aiUpgradeTimer = Number.isFinite(data.aiUpgradeTimer) ? data.aiUpgradeTimer : 6;
  if (UNIT_DEFS[data.barracksUnit] && UNIT_DEFS[data.barracksUnit].faction === side.faction) {
    side.barracksUnit = data.barracksUnit;
  }

  side.buildings = [];
  for (const buildingData of data.buildings || []) {
    if (!BUILDING_DEFS[buildingData.type]) continue;
    const building = makeBuilding(side, buildingData.type, buildingData.x, buildingData.y);
    building.level = clamp(Number(buildingData.level) || 1, 1, 3);
    building.maxHp = Number.isFinite(buildingData.maxHp)
      ? buildingData.maxHp
      : Math.round(BUILDING_DEFS[buildingData.type].hp * buildingHpMultiplier(building.level));
    building.hp = clamp(Number.isFinite(buildingData.hp) ? buildingData.hp : building.maxHp, 1, building.maxHp);
    building.invested = Number.isFinite(buildingData.invested) ? buildingData.invested : BUILDING_DEFS[buildingData.type].cost;
    building.completed = Boolean(buildingData.completed);
    building.buildProgress = clamp(Number(buildingData.buildProgress) || 0, 0, 1);
    building.buildTime = Number.isFinite(buildingData.buildTime) ? buildingData.buildTime : BUILDING_DEFS[buildingData.type].buildTime;
    building.queue = Array.isArray(buildingData.queue)
      ? buildingData.queue.filter((unitId) => UNIT_DEFS[unitId]?.faction === side.faction).slice(0, WORLD.queueLimit)
      : [];
    building.trainTimer = Number.isFinite(buildingData.trainTimer) ? buildingData.trainTimer : 0;
    building.attackCooldown = Number.isFinite(buildingData.attackCooldown) ? buildingData.attackCooldown : 0;
    side.buildings.push(building);
  }

  side.units = [];
  for (const unitData of data.units || []) {
    const def = UNIT_DEFS[unitData.defId];
    if (!def || def.faction !== side.faction) continue;
    const unit = spawnUnit(side, unitData.defId, {
      x: unitData.x,
      preferredY: unitData.preferredY,
      command: ['attack', 'hold', 'retreat'].includes(unitData.command) ? unitData.command : 'hold',
      revived: Boolean(unitData.revived),
      ignoreCap: true,
      silent: true,
    });
    if (!unit) continue;
    unit.y = clampBattlefieldY(Number.isFinite(unitData.y) ? unitData.y : unit.preferredY);
    unit.x = clamp(Number(unitData.x) || unit.x, 24, WORLD.width - 24);
    unit.preferredY = clampBattlefieldY(Number.isFinite(unitData.preferredY) ? unitData.preferredY : unit.y);
    unit.hp = clamp(Number.isFinite(unitData.hp) ? unitData.hp : unit.maxHp, 1, unit.maxHp);
    unit.target = null;
    unit.pendingAttack = null;
    unit.detour = null;
  }
}

function restoreGameState(snapshot) {
  restoringSave = true;
  state.time = Math.max(0, Number(snapshot.time) || 0);
  camera.x = clamp(Number(snapshot.cameraX) || 0, 0, WORLD.width - WORLD.viewWidth);
  camera.velocity = 0;
  gameSpeed = [1, 2, 3].includes(snapshot.gameSpeed) ? snapshot.gameSpeed : 1;
  restoreSide(state.player, snapshot.player);
  restoreSide(state.enemy, snapshot.enemy);
  state.projectiles = [];
  state.particles = [];
  state.floaters = [];
  state.commandBursts = [];
  state.hitBursts = [];
  selectedUnits = [];
  selectedBuilding = null;
  buildMode = null;
  paused = false;
  ui.pauseBtn.textContent = '暂停';
  ui.pauseOverlay.classList.remove('visible');
  ui.speedBtn.textContent = `${gameSpeed}×`;
  updateHud(true);
  restoringSave = false;
}

function startFreshGame() {
  if (state && !state.ended) {
    const confirmed = window.confirm('放弃当前对局并返回阵营选择？');
    if (!confirmed) return;
  }
  clearAutosave();
  state = null;
  paused = false;
  buildMode = null;
  selectedBuilding = null;
  selectedUnits = [];
  pointer = null;
  hoverPoint = null;
  hoverScreenPoint = null;
  camera.x = 0;
  camera.velocity = 0;
  ui.startScreen.classList.add('visible');
  ui.endScreen.classList.remove('visible');
  ui.pauseOverlay.classList.remove('visible');
  ui.pauseBtn.textContent = '暂停';
  ui.toast.classList.remove('show');
  ui.factionChoices.forEach((choice) => choice.classList.toggle('selected', choice.dataset.faction === selectedFaction));
}

function startGame(factionId = selectedFaction, options = {}) {
  const resumeSnapshot = options.snapshot || null;
  if (!resumeSnapshot) clearAutosave();
  selectedFaction = resumeSnapshot?.player?.faction || factionId;
  const enemyFactionId = ({ knight: 'skeleton', skeleton: 'knight', arcane: 'special', special: 'arcane' })[factionId] || 'knight';

  state = {
    time: 0,
    ended: false,
    winner: null,
    player: createSide('player', factionId, true),
    enemy: createSide('enemy', enemyFactionId, false),
    projectiles: [],
    particles: [],
    floaters: [],
    commandBursts: [],
    hitBursts: [],
    deathMarks: [],
    noticeFlags: new Set(),
  };

  buildMode = null;
  demolishMode = false;
  selectedBuilding = null;
  selectedUnits = [];
  pointer = null;
  hoverPoint = null;
  hoverScreenPoint = null;
  camera.x = 0;
  camera.velocity = 0;
  camera.shakeX = 0;
  camera.shakeY = 0;
  camera.shakeTime = 0;
  camera.shakePower = 0;
  hitStopTimer = 0;
  hitStopCooldown = 0;
  pressedKeys.clear();
  paused = false;
  gameSpeed = 1;
  toastTimer = 0;
  hintTimer = 0;
  ui.toast.classList.remove('show');
  ui.startScreen.classList.remove('visible');
  ui.endScreen.classList.remove('visible');
  ui.pauseOverlay.classList.remove('visible');
  ui.pauseBtn.textContent = '暂停';
  ui.speedBtn.textContent = '1×';
  autosaveAccumulator = 0;
  ui.buildHint.textContent = '选择建筑后点击己方领地内的空地';

  syncFactionUi();
  populateUnitButtons();
  updateHud(true);
  if (resumeSnapshot) {
    restoreGameState(resumeSnapshot);
    setHint(DEFAULT_HINT, 8);
    setToast('已自动恢复上次对局。', 2600);
  } else {
    setHint(DEFAULT_HINT, 10);
    setToast('先建造矿机与兵营，再选择兵营的生产兵种。', 3200);
  }
  autosaveAccumulator = 0;
  saveGame();
}

function syncFactionUi() {
  const playerFaction = FACTIONS[state.player.faction];
  const enemyFaction = FACTIONS[state.enemy.faction];
  ui.playerFaction.textContent = playerFaction.name;
  ui.enemyFaction.textContent = enemyFaction.name;

  for (const card of ui.buildCards) {
    const type = card.dataset.building;
    const def = BUILDING_DEFS[type];
    card.querySelector('[data-role="building-name"]').textContent = playerFaction.buildings[type];
    card.querySelector('[data-role="building-cost"]').textContent = def.cost;
  }

  const unitButtons = ui.unitButtons.querySelectorAll('[data-unit]');
  for (const button of unitButtons) {
    const def = UNIT_DEFS[button.dataset.unit];
    button.querySelector('b').textContent = def.name;
    button.querySelector('small').textContent = `${def.cost} 资源 · ${def.role}`;
  }
}

function populateUnitButtons() {
  const unitIds = FACTIONS[state.player.faction].units;
  ui.unitButtons.innerHTML = unitIds
    .map((unitId) => {
      const def = UNIT_DEFS[unitId];
      return `
        <button class="unit-btn" type="button" data-unit="${unitId}">
          <span class="unit-dot"></span>
          <b>${def.name}</b>
          <small>${def.cost} 资源 · ${def.role}</small>
        </button>`;
    })
    .join('');
}

function setBuildMode(type) {
  if (!state || state.ended) return;
  buildMode = buildMode === type ? null : type;
  if (buildMode) {
    const name = FACTIONS[state.player.faction].buildings[buildMode];
    setHint(`在己方建筑边界内点击空地，放置${name}。红色椭圆内不可建造。`, 5);
    ui.buildHint.textContent = `正在选择${name}的建造位置`;
  } else {
    resetHint();
    ui.buildHint.textContent = '选择建筑后点击己方领地内的空地';
  }
  ui.buildCards.forEach((card) => {
    card.classList.toggle('active', card.dataset.building === buildMode);
  });
}

function selectPlayerBuilding(building) {
  selectedUnits = [];
  selectedBuilding = building;
  buildMode = null;
  ui.buildCards.forEach((card) => card.classList.remove('active'));
  updateHud(true);
}

function clearSelection() {
  selectedUnits = [];
  selectedBuilding = null;
  updateHud(true);
}

function pointInPolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const xi = points[i].x;
    const yi = points[i].y;
    const xj = points[j].x;
    const yj = points[j].y;
    const intersects = (yi > y) !== (yj > y)
      && x < ((xj - xi) * (y - yi)) / ((yj - yi) || 0.000001) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function lassoMetrics(points) {
  let area = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current.x * next.y - next.x * current.y;
    minX = Math.min(minX, current.x);
    minY = Math.min(minY, current.y);
    maxX = Math.max(maxX, current.x);
    maxY = Math.max(maxY, current.y);
  }
  return {
    area: Math.abs(area) * 0.5,
    width: maxX - minX,
    height: maxY - minY,
    centerX: (minX + maxX) * 0.5,
    centerY: (minY + maxY) * 0.5,
  };
}

function selectUnitsInLasso(points) {
  if (!state || state.ended) return;
  const metrics = points.length >= 3 ? lassoMetrics(points) : { area: 0, width: 0, height: 0 };
  if (points.length < 3 || metrics.area < 120 || (metrics.width < 18 && metrics.height < 18)) {
    setToast('请按住左键，画出一个封闭的圈选轨迹。', 1800);
    return;
  }

  const nextSelection = state.player.units.filter((unit) => {
    if (unit.dead) return false;
    const visualY = unit.y - (unit.def.flying ? 170 : 28);
    return pointInPolygon(unit.x, visualY, points);
  });

  selectedUnits = nextSelection;
  selectedBuilding = null;
  if (selectedUnits.length > 0) {
    setToast(`已选中 ${selectedUnits.length} 名士兵。按 A 进攻、H 驻守、R 撤退。`, 2300);
  } else {
    setToast('圈选范围内没有己方士兵。', 1500);
  }
  updateHud(true);
}

function appendLassoPoint(pointerState, point) {
  const points = pointerState.points;
  const last = points[points.length - 1];
  if (!last || Math.hypot(point.x - last.x, point.y - last.y) >= 5) {
    points.push({ x: point.x, y: point.y });
  }
}

function handleWorldClick(point) {
  if (!state || state.ended) return;

  if (buildMode) {
    tryPlaceBuilding(state.player, buildMode, point.x, point.y, true);
    return;
  }

  const ownBuilding = findOwnBuildingAt(point);
  if (ownBuilding) {
    selectPlayerBuilding(ownBuilding);
    return;
  }

  selectedBuilding = null;
  updateHud(true);
}

function pointInRect(point, x, y, width, height) {
  return point.x >= x && point.x <= x + width && point.y >= y && point.y <= y + height;
}

function findOwnBuildingAt(point) {
  const player = state.player;
  if (!player) return null;
  if (pointInRect(point, player.base.x - player.base.width / 2, player.base.y - player.base.height, player.base.width, player.base.height)) {
    return player.base;
  }
  for (const building of player.buildings) {
    if (building.dead) continue;
    if (pointInRect(
      point,
      building.x - building.width / 2,
      building.y - building.height,
      building.width,
      building.height,
    )) {
      return building;
    }
  }
  return null;
}

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  const viewX = ((event.clientX - rect.left) / rect.width) * WORLD.viewWidth;
  const viewY = ((event.clientY - rect.top) / rect.height) * WORLD.height;
  hoverScreenPoint = { x: viewX, y: viewY };
  return {
    x: viewX + camera.x,
    y: viewY,
  };
}
function beginPointer(event) {
  if (!state || state.ended || paused || event.button !== 0) return;
  const point = canvasPoint(event);
  pointer = {
    id: event.pointerId,
    start: point,
    current: point,
    down: true,
    selecting: false,
    points: [],
    building: Boolean(buildMode),
    timer: 0,
  };
  if (!pointer.building) {
    pointer.timer = window.setTimeout(() => {
      if (pointer && pointer.down) {
        pointer.selecting = true;
        pointer.points = [{ x: pointer.start.x, y: pointer.start.y }];
        appendLassoPoint(pointer, pointer.current);
        selectedBuilding = null;
        updateHud(true);
      }
    }, LONG_PRESS_MS);
  }

  try {
    canvas.setPointerCapture(event.pointerId);
  } catch {
    // Pointer capture is best-effort.
  }
}

function movePointer(event) {
  const point = canvasPoint(event);
  hoverPoint = point;
  if (pointer && pointer.down && event.pointerId === pointer.id) {
    pointer.current = point;
    if (pointer.selecting) appendLassoPoint(pointer, point);
  }
}

function endPointer(event) {
  if (!pointer || event.pointerId !== pointer.id) return;
  window.clearTimeout(pointer.timer);
  const released = pointer;
  pointer = null;

  if (!released.down) return;
  released.down = false;
  if (released.selecting) {
    appendLassoPoint(released, released.current);
    selectUnitsInLasso(released.points);
  } else {
    handleWorldClick(released.current);
  }
  updateHud(true);
}

function cancelPointer(event) {
  if (!pointer) return;
  window.clearTimeout(pointer.timer);
  if (event) {
    try {
      canvas.releasePointerCapture(event.pointerId);
    } catch {
      // Ignore pointer capture release failures.
    }
  }
  pointer = null;
}

function togglePause() {
  if (!state || state.ended) return;
  paused = !paused;
  ui.pauseBtn.textContent = paused ? '继续' : '暂停';
  ui.pauseOverlay.classList.toggle('visible', paused);
}

function cycleSpeed() {
  if (!state || state.ended) return;
  const speeds = [1, 2, 3];
  const current = speeds.indexOf(gameSpeed);
  gameSpeed = speeds[(current + 1) % speeds.length];
  ui.speedBtn.textContent = `${gameSpeed}×`;
}

function endGame(winner) {
  if (!state || state.ended) return;
  state.ended = true;
  state.winner = winner;
  selectedUnits = [];
  selectedBuilding = null;
  buildMode = null;
  paused = false;
  ui.pauseOverlay.classList.remove('visible');
  clearAutosave();
  ui.endTitle.textContent = winner === 'player' ? '胜利' : '战败';
  ui.endTitle.style.color = winner === 'player' ? '#e9c36b' : '#ff795e';
  ui.endDescription.textContent = winner === 'player'
    ? `敌方基地已被摧毁。战斗用时 ${formatTime(state.time)}。`
    : `己方基地失守。战斗用时 ${formatTime(state.time)}。`;
  window.setTimeout(() => {
    if (state?.ended) ui.endScreen.classList.add('visible');
  }, 650);
  updateHud(true);
}

ui.factionChoices.forEach((button) => {
  button.addEventListener('click', () => {
    selectedFaction = button.dataset.faction;
    ui.factionChoices.forEach((choice) => choice.classList.toggle('selected', choice === button));
  });
});

ui.startBtn.addEventListener('click', () => startGame(selectedFaction));
ui.restartBtn.addEventListener('click', () => startGame(selectedFaction));
ui.pauseBtn.addEventListener('click', togglePause);
ui.speedBtn.addEventListener('click', cycleSpeed);
ui.newGameBtn.addEventListener('click', startFreshGame);
if (ui.soundBtn) ui.soundBtn.addEventListener('click', toggleSound);
window.addEventListener('pointerdown', initAudio, { passive: true });
window.addEventListener('keydown', initAudio, { passive: true });

ui.buildCards.forEach((card) => {
  card.addEventListener('click', () => setBuildMode(card.dataset.building));
});

ui.unitButtons.addEventListener('click', (event) => {
  const button = event.target.closest('[data-unit]');
  if (!button || !state || state.ended) return;
  const availableBarracks = state.player.buildings
    .filter((building) => building.type === 'barracks' && building.completed && !building.dead)
    .sort((a, b) => a.queue.length - b.queue.length || a.level - b.level);
  let barracks = selectedBuilding?.type === 'barracks' && selectedBuilding.completed && !selectedBuilding.dead
    ? selectedBuilding
    : availableBarracks[0];
  if (!barracks) {
    setToast('需要先建造兵营。', 1800);
    return;
  }
  if (enqueueUnit(state.player, barracks, button.dataset.unit, true)) {
    selectedBuilding = barracks;
    selectedUnits = [];
  }
  updateHud(true);
});

ui.selectionActions.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action="upgrade"]');
  if (button) upgradeSelectedBuilding();
});

ui.commandButtons.forEach((button) => {
  button.addEventListener('click', () => issueCommand(button.dataset.command));
});

canvas.addEventListener('pointerdown', beginPointer);
canvas.addEventListener('pointermove', movePointer);
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', cancelPointer);
canvas.addEventListener('pointerleave', () => {
  if (!pointer) {
    hoverPoint = null;
    hoverScreenPoint = null;
  }
});
canvas.addEventListener('wheel', (event) => {
  if (!state || state.ended) return;
  event.preventDefault();
  const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
  camera.x = clamp(camera.x + delta * 0.72, 0, WORLD.width - WORLD.viewWidth);
}, { passive: false });
canvas.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  if (!state || state.ended) return;
  handleRightClick(canvasPoint(event));
});

window.addEventListener('keydown', (event) => {
  if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
    pressedKeys.add(event.code);
    event.preventDefault();
    return;
  }
  if (event.repeat) return;
  const key = event.key.toLowerCase();
  if (key === ' ' || event.code === 'Space') {
    event.preventDefault();
    if (state && !state.ended) togglePause();
    return;
  }
  if (key === 'escape') {
    buildMode = null;
    ui.buildCards.forEach((card) => card.classList.remove('active'));
    resetHint();
    return;
  }
  if (!state) {
    if (key === 'enter') startGame(selectedFaction);
    return;
  }
  if (state.ended) {
    if (key === 'enter') startGame(selectedFaction);
    return;
  }
  if (key === 'a') issueCommand('attack');
  if (key === 'h') issueCommand('hold');
  if (key === 'r') issueCommand('retreat');
});

window.addEventListener('keyup', (event) => {
  pressedKeys.delete(event.code);
});
window.addEventListener('blur', () => pressedKeys.clear());
window.addEventListener('pagehide', () => saveGame());
document.addEventListener('visibilitychange', () => { if (document.hidden) saveGame(); });
function sideById(sideId) {
  return sideId === 'player' ? state.player : state.enemy;
}

function makeBuilding(side, type, x, y) {
  const def = BUILDING_DEFS[type];
  return {
    id: uid(type),
    kind: 'building',
    isBuilding: true,
    isBase: false,
    type,
    side: side.id,
    faction: side.faction,
    name: factionOf(side).buildings[type],
    x,
    y,
    width: def.width,
    height: def.height,
    hp: def.hp,
    maxHp: def.hp,
    invested: def.cost,
    level: 1,
    buildProgress: 0,
    buildTime: def.buildTime,
    completed: false,
    dead: false,
    queue: [],
    trainTimer: 0,
    attackCooldown: 0.25,
    hitFlash: 0,
  };
}

function footprintDepthForBuilding(building) {
  if (!building) return 18;
  return building.isBase ? 34 : 18;
}

function placementExclusionFor(candidateWidth, structure) {
  return {
    rx: candidateWidth / 2 + structure.width / 2 + WORLD.buildSpacing,
    ry: 18 + footprintDepthForBuilding(structure) + WORLD.buildSpacing * 0.8,
  };
}

function getPlacementError(side, type, x, y) {
  const def = BUILDING_DEFS[type];
  if (!def) return '未知建筑。';
  if (x - def.width / 2 < 20 || x + def.width / 2 > WORLD.width - 20) return '建筑超出地图范围。';
  if (y < WORLD.battlefieldFarY + 10 || y > WORLD.battlefieldNearY - 4) return '必须放在可建造的地面区域内。';

  const halfWidth = def.width / 2;
  if (side.id === 'player') {
    if (x + halfWidth > side.frontierX) return '不能建在己方领地的更前方。';
  } else {
    if (x - halfWidth < side.frontierX) return '不能建在己方领地的更前方。';
  }

  const structures = [side.base, ...side.buildings];
  for (const structure of structures) {
    if (!structure || structure.dead) continue;
    const exclusion = placementExclusionFor(def.width, structure);
    const dx = (x - structure.x) / exclusion.rx;
    const dy = (y - structure.y) / exclusion.ry;
    if (dx * dx + dy * dy < 1) {
      return '建筑之间需要留出足够空地。';
    }
  }
  return null;
}

function tryPlaceBuilding(side, type, x, y, isPlayerAction = false) {
  const error = getPlacementError(side, type, x, y);
  if (error) {
    if (isPlayerAction) setToast(error, 1800);
    return false;
  }

  const def = BUILDING_DEFS[type];
  if (side.gold < def.cost) {
    if (isPlayerAction) setToast(`资源不足，还需要 ${Math.ceil(def.cost - side.gold)}。`, 1600);
    return false;
  }

  side.gold -= def.cost;
  const building = makeBuilding(side, type, x, y);
  side.buildings.push(building);
  addParticles(x, y - 8, factionOf(side).accent, 15, { speed: 85 });

  if (isPlayerAction) {
    selectedBuilding = building;
    selectedUnits = [];
    buildMode = null;
    ui.buildCards.forEach((card) => card.classList.remove('active'));
    ui.buildHint.textContent = '选择建筑后点击己方领地内的空地';
    setToast(`${building.name}开始建造。`, 1600);
    updateHud(true);
    saveGame();
  }

  return true;
}

function getArmyCap(side) {
  return side.buildings.reduce((cap, building) => {
    if (building.dead || !building.completed || building.type !== 'barracks') return cap;
    return cap + WORLD.barracksBaseCap + (building.level - 1) * WORLD.barracksCapPerLevel;
  }, WORLD.baseArmyCap);
}
function incomeForSide(side) {
  return side.buildings.reduce((total, building) => {
    if (building.dead || !building.completed || building.type !== 'mine') return total;
    return total + BUILDING_DEFS.mine.income[building.level - 1];
  }, 0);
}

function towerDamage(building) {
  return BUILDING_DEFS.tower.damage[building.level - 1];
}

function towerRange(building) {
  return BUILDING_DEFS.tower.range[building.level - 1];
}

function towerInterval(building) {
  return BUILDING_DEFS.tower.attackInterval[building.level - 1];
}

function buildingHpMultiplier(level) {
  return [1, 1.38, 1.82][level - 1] || 1;
}

function upgradeBuilding(side, building, notify = false) {
  if (!building || building.dead || building.isBase || building.level >= 3) return false;
  const def = BUILDING_DEFS[building.type];
  const cost = def.upgradeCosts[building.level - 1];
  if (side.gold < cost) {
    if (notify) setToast(`升级需要 ${cost} 资源。`, 1600);
    return false;
  }

  side.gold -= cost;
  building.invested = (building.invested || def.cost) + cost;
  const oldMax = building.maxHp;
  building.level += 1;
  building.maxHp = Math.round(def.hp * buildingHpMultiplier(building.level));
  building.hp = Math.min(building.maxHp, building.hp + (building.maxHp - oldMax));
  addParticles(building.x, building.y - building.height * 0.55, factionOf(side).accent, 24, { speed: 105 });

  if (notify) {
    setToast(`${building.name}已升级到 Lv.${building.level}。`, 1800);
    updateHud(true);
  }
  saveGame();
  return true;
}

function upgradeSelectedBuilding() {
  if (!state || !selectedBuilding || selectedBuilding.isBase || selectedBuilding.dead) return;
  upgradeBuilding(state.player, selectedBuilding, true);
}

function spawnUnit(side, unitId, options = {}) {
  if (!state || state.ended) return null;
  if (!options.ignoreCap && side.units.length >= getArmyCap(side)) return null;
  const def = UNIT_DEFS[unitId];
  if (!def) return null;

  let spawnX = options.x;
  if (spawnX === undefined) {
    const barracks = options.source;
    if (barracks) {
      spawnX = barracks.x + (side.id === 'player' ? 56 : -56);
    } else {
      spawnX = side.base.x + (side.id === 'player' ? 145 : -145);
    }
  }

  const laneRows = [534, 560, 588, 616, 644, 672, 698];
  const preferredY = options.preferredY ?? (options.source ? options.source.y : laneRows[side.units.length % laneRows.length]);
  const spawnY = clamp(preferredY + rand(-4, 4), WORLD.battlefieldFarY + 7, WORLD.battlefieldNearY - 2);
  const unit = {
    id: uid(unitId),
    kind: 'unit',
    isBuilding: false,
    side: side.id,
    faction: side.faction,
    defId: unitId,
    def,
    preferredY,
    x: clamp(spawnX, 26, WORLD.width - 26),
    y: spawnY,
    hp: def.hp * (options.hpRatio ?? 1),
    maxHp: def.hp,
    command: options.command || 'attack',
    target: null,
    dead: false,
    revived: Boolean(options.revived),
    attackCooldown: rand(0, 0.3),
    downTimer: 0,
    knockdownImmune: 0,
    hitFlash: 0,
    attackTimer: 0,
    attackDuration: 0.36,
    pendingAttack: null,
    moveBlend: 0,
    walkPhase: rand(0, Math.PI * 2),
    moveDirX: side.id === 'player' ? 1 : -1,
    stepDustTimer: rand(0.05, 0.25),
    stepImpact: 0,
    knockbackX: 0,
    knockbackY: 0,
    hitStun: 0,
    hitStunMax: 0.12,
    hitDir: side.id === 'player' ? 1 : -1,
    summonCooldown: def.summon ? rand(1.2, 2.5) : 0,
    healCooldown: def.heal ? rand(0.8, 1.8) : 0,
    flashCooldown: def.flashbang ? rand(1.5, 3) : 0,
    sweepCooldown: def.tailSweep ? rand(1.5, 3) : 0,
    commandFlash: 0,
    chargeDistance: 0,
    chargeCooldown: 0,
    impactCooldown: 0,
    firstHitTargets: new Set(),
    spawnGrace: 0.35,
    retargetTimer: rand(0, 0.3),
    detour: null,
    bobSeed: rand(0, 100),
  };

  if (options.hpRatio) {
    unit.hp = Math.max(1, unit.maxHp * options.hpRatio);
  }

  side.units.push(unit);
  if (!options.silent) addParticles(unit.x, unit.y - 24, factionOf(side).accent, 8, { speed: 45 });
  return unit;
}

function updateGame(dt) {
  if (!state || state.ended) return;

  state.time += dt;
  state.player.gold += incomeForSide(state.player) * dt;
  state.enemy.gold += incomeForSide(state.enemy) * dt;

  updateAI(dt);
  updateBuildings(state.player, dt);
  updateBuildings(state.enemy, dt);
  updateShamanPulses(state.player, dt);
  updateShamanPulses(state.enemy, dt);
  updateUnits(state.player, dt);
  updateUnits(state.enemy, dt);
  resolveUnitSpacing(state.player);
  resolveUnitSpacing(state.enemy);
  resolveOpposingCollisions();
  updateTerritory(state.player);
  updateTerritory(state.enemy);
  updateProjectiles(dt);
  updateEffects(dt);

  cleanupDead();
  if (state.player.base.hp <= 0) endGame('enemy');
  if (state.enemy.base.hp <= 0) endGame('player');
}

function updateBuildings(side, dt) {
  for (const building of side.buildings) {
    if (building.dead) continue;
    building.hitFlash = Math.max(0, building.hitFlash - dt);

    if (!building.completed) {
      building.buildProgress = Math.min(1, building.buildProgress + dt / building.buildTime);
      if (building.buildProgress >= 1) {
        building.completed = true;
        addParticles(building.x, building.y - building.height * 0.5, factionOf(side).accent, 18, { speed: 80 });
      }
      continue;
    }

    if (building.type === 'barracks') {
      updateBarracks(side, building, dt);
    } else if (building.type === 'tower') {
      updateTower(side, building, dt);
    }
  }
}

function trainingSpeedForBarracks(building) {
  return 1 + (building.level - 1) * 0.2;
}

function enqueueUnit(side, barracks, unitId, notify = false) {
  if (!barracks || barracks.dead || !barracks.completed || barracks.type !== 'barracks') return false;
  const def = UNIT_DEFS[unitId];
  if (!def || def.faction !== side.faction || def.summonOnly) return false;
  if (barracks.queue.length >= WORLD.queueLimit) {
    if (notify) setToast('这所兵营的训练队列已满。', 1600);
    return false;
  }
  if (side.gold < def.cost) {
    if (notify) setToast(`资源不足，还需要 ${Math.ceil(def.cost - side.gold)}。`, 1600);
    return false;
  }

  side.gold -= def.cost;
  barracks.queue.push(unitId);
  side.barracksUnit = unitId;
  if (notify) {
    setToast(`${barracks.name}已加入 ${def.name}（${barracks.queue.length}/${WORLD.queueLimit}）。`, 1700);
  }
  saveGame();
  return true;
}

function updateBarracks(side, building, dt) {
  if (!building.completed || building.queue.length === 0) {
    building.trainTimer = 0;
    return;
  }
  if (side.units.length >= getArmyCap(side)) return;

  const unitId = building.queue[0];
  const def = UNIT_DEFS[unitId];
  if (!def) {
    building.queue.shift();
    building.trainTimer = 0;
    return;
  }

  if (building.trainTimer <= 0) {
    building.trainTimer = def.trainTime / trainingSpeedForBarracks(building);
  }
  building.trainTimer -= dt;
  if (building.trainTimer > 0) return;

  const unit = spawnUnit(side, unitId, {
    source: building,
    command: side.isPlayer ? 'hold' : 'attack',
  });
  if (!unit) {
    building.trainTimer = 0.35;
    return;
  }

  building.queue.shift();
  building.trainTimer = 0;
}
function updateTower(side, building, dt) {
  building.attackCooldown = Math.max(0, building.attackCooldown - dt);
  if (building.attackCooldown > 0) return;

  const enemy = otherSide(side);
  const range = towerRange(building);
  let target = null;
  let bestDistance = Infinity;

  for (const unit of enemy.units) {
    if (unit.dead) continue;
    const distance = Math.hypot(unit.x - building.x, unit.y - building.y);
    if (distance <= range && distance < bestDistance) {
      target = unit;
      bestDistance = distance;
    }
  }

  if (!target) return;

  building.attackCooldown = towerInterval(building);
  spawnProjectile({
    side: side.id,
    source: { def: { armorPierce: 0.15 }, kind: 'building' },
    target,
    x: building.x,
    y: building.y - building.height - 10,
    damage: towerDamage(building),
    damageType: 'ranged',
    speed: 520,
    color: side.faction === 'skeleton' ? '#a8ffd9' : '#ffd788',
    size: 4,
  });
  addParticles(building.x, building.y - building.height - 10, factionOf(side).accent, 5, { speed: 45, size: 2 });
}

function updateShamanPulses(side, dt) {
  const shamans = side.units.filter((unit) => !unit.dead && unit.def.revive);
  if (shamans.length === 0) return;

  side.shamanTimer -= dt;
  if (side.shamanTimer > 0) return;
  side.shamanTimer = REVIVE_RULES.interval;

  const available = side.graveyard
    .filter((entry) => !entry.revived && state.time - entry.deadAt <= REVIVE_RULES.corpseLifetime)
    .sort((a, b) => b.deathValue - a.deathValue || b.deadAt - a.deadAt);

  let points = shamans.length * REVIVE_RULES.pointsPerShaman;
  const revived = [];

  while (points > 0 && side.units.length < getArmyCap(side)) {
    const index = available.findIndex((entry) => !entry.revived && entry.deathValue <= points);
    if (index === -1) break;
    const entry = available[index];
    entry.revived = true;
    const unit = spawnUnit(side, entry.defId, {
      x: entry.x,
      preferredY: entry.y,
      command: 'attack',
      revived: true,
      hpRatio: REVIVE_RULES.revivedHpRatio,
    });
    if (!unit) break;
    points -= entry.deathValue;
    revived.push(unit);
  }

  if (revived.length > 0) {
    for (const shaman of shamans) {
      addRing(shaman.x, shaman.y - 28, '#75efc8', 8, 0.75);
      addParticles(shaman.x, shaman.y - 45, '#75efc8', 12, { speed: 75 });
    }
    for (const unit of revived) {
      addFloater('复活', unit.x, unit.y - 72, '#83f5cf', 15);
      addRing(unit.x, unit.y - 8, '#83f5cf', 12, 0.6);
    }
    if (side.isPlayer) {
      setToast(`骨萨满共同复活了 ${revived.length} 个单位。`, 1800);
    }
  }
}

function targetAlive(target) {
  return Boolean(target && !target.dead && target.hp > 0);
}

function canTarget(unit, target) {
  if (!targetAlive(target)) return false;
  if (target.kind === 'unit' && target.def.flying && unit.def.damageType === 'melee') return false;
  return true;
}

function clampBattlefieldY(value) {
  return clamp(value, WORLD.battlefieldFarY + 6, WORLD.battlefieldNearY - 2);
}

function chooseTarget(unit) {
  const enemy = otherSide(sideById(unit.side));
  const hold = unit.command === 'hold';
  const unitDetection = hold ? unit.def.range + 80 : Math.max(unit.def.aggro, unit.def.range + 140);
  let best = null;
  let bestDistance = Infinity;

  for (const candidate of enemy.units) {
    if (!canTarget(unit, candidate)) continue;
    const distance = Math.hypot(candidate.x - unit.x, candidate.y - unit.y);
    if (distance <= unitDetection && distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }

  if (best) return best;

  const structures = [...enemy.buildings, enemy.base];
  const structureDetection = hold ? unit.def.range + 180 : unitDetection + 170;
  for (const structure of structures) {
    if (!targetAlive(structure)) continue;
    const footprintX = structure.width * 0.42;
    const footprintY = structure.isBase ? 27 : 19;
    const edgeX = Math.max(0, Math.abs(structure.x - unit.x) - footprintX);
    const edgeY = Math.max(0, Math.abs(structure.y - unit.y) - footprintY);
    const edgeDistance = Math.hypot(edgeX, edgeY);
    if (edgeDistance <= structureDetection && edgeDistance < bestDistance) {
      best = structure;
      bestDistance = edgeDistance;
    }
  }

  return best;
}

function updateUnits(side, dt) {
  const enemy = otherSide(side);
  for (const unit of side.units) {
    if (unit.dead) continue;
    unit.attackCooldown = Math.max(0, unit.attackCooldown - dt);
    unit.downTimer = Math.max(0, unit.downTimer - dt);
    unit.knockdownImmune = Math.max(0, unit.knockdownImmune - dt);
    unit.hitFlash = Math.max(0, unit.hitFlash - dt);
    unit.attackTimer = Math.max(0, unit.attackTimer - dt);
    unit.hitStun = Math.max(0, unit.hitStun - dt);
    unit.stepImpact = Math.max(0, unit.stepImpact - dt * 8);
    unit.moveBlend = Math.max(0, unit.moveBlend - dt * 8);
    unit.stepDustTimer -= dt;
    unit.commandFlash = Math.max(0, unit.commandFlash - dt);
    unit.chargeCooldown = Math.max(0, unit.chargeCooldown - dt);
    unit.impactCooldown = Math.max(0, unit.impactCooldown - dt);
    unit.spawnGrace = Math.max(0, unit.spawnGrace - dt);
    unit.retargetTimer = Math.max(0, unit.retargetTimer - dt);
    unit.summonCooldown = Math.max(0, unit.summonCooldown - dt);
    unit.healCooldown = Math.max(0, unit.healCooldown - dt);
    unit.flashCooldown = Math.max(0, unit.flashCooldown - dt);
    unit.sweepCooldown = Math.max(0, unit.sweepCooldown - dt);

    if (Math.abs(unit.knockbackX) > 0.5 || Math.abs(unit.knockbackY) > 0.5) {
      unit.x = clamp(unit.x + unit.knockbackX * dt, 24, WORLD.width - 24);
      unit.y = clampBattlefieldY(unit.y + unit.knockbackY * dt);
      const damping = Math.exp(-dt * 10);
      unit.knockbackX *= damping;
      unit.knockbackY *= damping;
      resolveUnitBuildingCollision(unit);
    } else {
      unit.knockbackX = 0;
      unit.knockbackY = 0;
    }

    if (unit.hitStun > 0) {
      unit.target = null;
      unit.detour = null;
      continue;
    }

    if (unit.downTimer > 0 || unit.command === 'retreat') {
      unit.pendingAttack = null;
    }

    if (unit.pendingAttack) {
      unit.pendingAttack.delay -= dt;
      if (unit.pendingAttack.delay <= 0) {
        const pending = unit.pendingAttack;
        unit.pendingAttack = null;
        resolveAttack(unit, pending);
      }
    }

    if (unit.downTimer > 0) {
      unit.target = null;
      unit.detour = null;
      continue;
    }

    if (unit.command === 'retreat') {
      unit.target = null;
      const homeX = side.base.x + (side.id === 'player' ? 154 : -154);
      const homeY = clampBattlefieldY(side.base.y + (unit.preferredY - WORLD.groundY) * 0.42);
      const dx = homeX - unit.x;
      const dy = homeY - unit.y;
      if (Math.hypot(dx, dy) <= 15) {
        unit.command = 'hold';
        unit.commandFlash = 0.4;
      } else {
        moveUnit(unit, dx, dy, dt, false);
      }
      continue;
    }

    updateSupportAbilities(unit, side, dt);

    if (unit.retargetTimer <= 0 || !canTarget(unit, unit.target)) {
      unit.target = chooseTarget(unit);
      unit.retargetTimer = rand(0.28, 0.48);
    }
    const target = unit.target;

    if (!target) {
      if (unit.command === 'attack') {
        const goalX = enemy.base.x + (unit.side === 'player' ? -80 : 80);
        const goalY = clampBattlefieldY(unit.preferredY);
        const dx = goalX - unit.x;
        const dy = goalY - unit.y;
        if (Math.hypot(dx, dy) > 7) moveUnit(unit, dx, dy, dt, true);
      }
      continue;
    }

    const targetHalfWidth = target.isBuilding ? target.width * 0.42 : target.def.radius * 0.65;
    const dx = target.x - unit.x;
    const dy = target.y - unit.y;
    const distance = Math.hypot(dx, dy);
    const reach = unit.def.range + targetHalfWidth;

    if (distance > reach) {
      if (unit.command === 'hold') {
        unit.target = null;
        continue;
      }
      moveUnit(unit, dx, dy, dt, true);
    } else {
      if (unit.def.flashbang && unit.flashCooldown <= 0 && distance <= unit.def.flashbang.range) {
        triggerFlashbang(unit, target);
      }
      if (unit.def.tailSweep && unit.sweepCooldown <= 0 && distance <= unit.def.tailSweep.range) {
        performTailSweep(unit, side);
        unit.sweepCooldown = unit.def.tailSweep.cooldown;
        unit.attackCooldown = 0.85;
        continue;
      }
      if (unit.attackCooldown <= 0) {
        performAttack(unit, target);
      }
    }
  }
}

function ownStructureCollisionAt(unit, x, y) {
  const side = sideById(unit.side);
  const structures = [side.base, ...side.buildings];
  for (const structure of structures) {
    if (!structure || structure.dead) continue;
    const halfWidth = structure.width * 0.43 + unit.def.radius * 0.45;
    const halfDepth = footprintDepthForBuilding(structure) + unit.def.radius * 0.55 + 3;
    if (Math.abs(x - structure.x) < halfWidth && Math.abs(y - structure.y) < halfDepth) {
      return structure;
    }
  }
  return null;
}

function chooseDetourY(unit, structure) {
  const clearance = footprintDepthForBuilding(structure) + unit.def.radius + 18;
  const candidates = [
    structure.y - clearance,
    structure.y + clearance,
  ].filter((candidateY) => candidateY >= WORLD.battlefieldFarY + 6 && candidateY <= WORLD.battlefieldNearY - 2);

  let best = null;
  let bestDistance = Infinity;
  for (const candidateY of candidates) {
    if (ownStructureCollisionAt(unit, structure.x, candidateY)) continue;
    const distance = Math.abs(candidateY - unit.y);
    if (distance < bestDistance) {
      best = candidateY;
      bestDistance = distance;
    }
  }
  return best;
}

function moveUnit(unit, dx, dy, dt, canCharge) {
  const length = Math.hypot(dx, dy);
  if (length < 0.0001) return;
  let dirX = dx / length;
  let dirY = dy / length;
  const step = unit.def.speed * dt;

  if (!unit.def.flying) {
    if (unit.detour) {
      const ddx = unit.detour.x - unit.x;
      const ddy = unit.detour.y - unit.y;
      const detourLength = Math.hypot(ddx, ddy);
      if (detourLength <= 4) {
        unit.detour = null;
      } else {
        dirX = ddx / detourLength;
        dirY = ddy / detourLength;
      }
    }

    if (!unit.detour) {
      const lookAhead = Math.max(16, step * 2.4);
      const blocker = ownStructureCollisionAt(unit, unit.x + dirX * lookAhead, unit.y + dirY * lookAhead);
      if (blocker) {
        const detourY = chooseDetourY(unit, blocker);
        if (detourY !== null && Math.abs(detourY - unit.y) > 2) {
          unit.detour = { x: unit.x, y: detourY };
          dirX = 0;
          dirY = Math.sign(detourY - unit.y);
        }
      }
    }
  }

  unit.x = clamp(unit.x + dirX * step, 24, WORLD.width - 24);
  unit.y = clampBattlefieldY(unit.y + dirY * step);
  resolveUnitBuildingCollision(unit);
  unit.moveBlend = Math.min(1, unit.moveBlend + dt * 12);
  unit.moveDirX = dirX;
  const previousPhase = unit.walkPhase;
  unit.walkPhase += dt * (4.5 + unit.def.speed * 0.055) * (0.72 + Math.abs(dirX) * 0.28);

  if (!unit.def.flying) {
    const previousFootfall = Math.floor((previousPhase + Math.PI * 0.5) / Math.PI);
    const currentFootfall = Math.floor((unit.walkPhase + Math.PI * 0.5) / Math.PI);
    if (previousFootfall !== currentFootfall) {
      const heavyStep = unit.def.drawType.includes('Horse') || unit.def.mass >= 5;
      unit.stepImpact = heavyStep ? 0.17 : 0.11;
      addParticles(
        unit.x - dirX * 5 + rand(-5, 5),
        unit.y - 1,
        heavyStep ? '#c5a16c' : '#bda275',
        heavyStep ? 4 : 2,
        { speed: heavyStep ? 30 : 20, size: heavyStep ? 2.8 : 2.1, life: 0.24, gravity: -9 }
      );
      if (unit.side === 'player') playFootstep(heavyStep ? 1 : 0.55);
    }
  }

  if (canCharge && unit.def.charge && unit.chargeCooldown <= 0) {
    unit.chargeDistance += step;
  } else if (!canCharge || unit.command !== 'attack') {
    unit.chargeDistance = 0;
  }
}

function resolveUnitBuildingCollision(unit) {
  const structures = [
    ...state.player.buildings,
    state.player.base,
    ...state.enemy.buildings,
    state.enemy.base,
  ];

  for (const structure of structures) {
    if (!structure || structure.dead) continue;
    const halfWidth = structure.width * 0.43 + unit.def.radius * 0.45;
    const halfDepth = (structure.isBase ? 28 : 20) + unit.def.radius * 0.38;
    const dx = unit.x - structure.x;
    const dy = unit.y - structure.y;
    const overlapX = halfWidth - Math.abs(dx);
    const overlapY = halfDepth - Math.abs(dy);
    if (overlapX <= 0 || overlapY <= 0) continue;

    if (overlapX < overlapY) {
      unit.x = clamp(unit.x + Math.sign(dx || 1) * overlapX, 24, WORLD.width - 24);
    } else {
      unit.y = clampBattlefieldY(unit.y + Math.sign(dy || -1) * overlapY);
    }
  }
}
function updateSupportAbilities(unit, side, dt) {
  if (unit.def.summon) {
    if (unit.summonCooldown <= 0) {
      const summonDef = unit.def.summon;
      const currentSummons = side.units.filter((ally) => ally.defId === summonDef.unitId && !ally.dead).length;
      const availableSlots = Math.max(0, getArmyCap(side) - side.units.length);
      const count = Math.min(summonDef.count, summonDef.maxActive - currentSummons, availableSlots);
      if (count > 0) {
        const direction = unit.side === 'player' ? 1 : -1;
        for (let index = 0; index < count; index += 1) {
          spawnUnit(side, summonDef.unitId, {
            x: unit.x + direction * (28 + index * 20),
            preferredY: unit.y + (index - 0.5) * 14,
            command: unit.command === 'hold' ? 'hold' : 'attack',
          });
        }
        unit.summonCooldown = summonDef.cooldown;
        unit.attackTimer = 0.5;
        unit.attackDuration = 0.5;
        addRing(unit.x, unit.y - 18, '#c895ff', 12, 0.7);
        addFloater(`召唤 ×${count}`, unit.x, unit.y - 82, '#e0b4ff', 15);
      } else {
        unit.summonCooldown = 1.5;
      }
    }
  }

  if (unit.def.heal && unit.healCooldown <= 0) {
    const healDef = unit.def.heal;
    const direction = unit.side === 'player' ? 1 : -1;
    const targets = side.units
      .filter((ally) => {
        if (ally === unit || ally.dead || ally.hp >= ally.maxHp) return false;
        const forward = (ally.x - unit.x) * direction;
        return forward >= -18 && forward <= healDef.range && Math.abs(ally.y - unit.y) <= healDef.depth;
      })
      .sort((a, b) => a.hp / a.maxHp - b.hp / b.maxHp)
      .slice(0, healDef.maxTargets);
    if (targets.length > 0) {
      for (const ally of targets) {
        const healed = Math.min(healDef.amount, ally.maxHp - ally.hp);
        ally.hp += healed;
        addFloater(`+${Math.round(healed)}`, ally.x, ally.y - 65, '#67f0b2', 12);
        addRing(ally.x, ally.y - 5, '#67f0b2', 9, 0.45);
      }
      unit.healCooldown = healDef.cooldown;
      unit.attackTimer = 0.4;
      unit.attackDuration = 0.4;
      addParticles(unit.x, unit.y - 52, '#67f0b2', 12, { speed: 65 });
    } else {
      unit.healCooldown = 0.6;
    }
  }
}

function triggerFlashbang(unit, target) {
  const flash = unit.def.flashbang;
  if (!flash || !targetAlive(target)) return;
  unit.flashCooldown = flash.cooldown;
  spawnProjectile({
    side: unit.side,
    source: unit,
    target,
    x: unit.x,
    y: unit.y - 52,
    damage: flash.damage,
    damageType: 'magic',
    speed: 420,
    color: '#fff2a8',
    size: 7,
    aoeRadius: flash.aoeRadius,
    impact: flash.impact,
    knockdownDuration: flash.knockdown,
  });
  addParticles(unit.x + (unit.side === 'player' ? 34 : -34), unit.y - 52, '#fff2a8', 8, {
    speed: 75,
    size: 3.2,
    life: 0.2,
    gravity: -20,
    vx: unit.side === 'player' ? 90 : -90,
    vy: -35,
  });
  addRing(unit.x, unit.y - 3, '#ffe69a', 8, 0.28);
  playCombatSound('explosive', 0.9);
  addFloater('震爆弹', unit.x, unit.y - 84, '#ffe7a0', 14);
}

function performTailSweep(unit, side) {
  const sweep = unit.def.tailSweep;
  if (!sweep) return;
  const enemy = otherSide(side);
  for (const target of [...enemy.units]) {
    if (!targetAlive(target) || target.def.flying) continue;
    if (Math.abs(target.x - unit.x) > sweep.range || Math.abs(target.y - unit.y) > sweep.depth) continue;
    const survived = dealDamage(unit, target, sweep.damage, 'melee', {
      heavy: true,
      direction: Math.sign(target.x - unit.x) || 1,
    });
    if (survived) tryKnockdown(target, sweep.impact, sweep.knockdown);
  }
  unit.attackTimer = 0.45;
  unit.attackDuration = 0.45;
  addFloater('尾扫!', unit.x, unit.y - 92, '#ffb4e7', 18);
  addRing(unit.x, unit.y - 5, '#e18dff', 24, 0.65);
  addParticles(unit.x, unit.y - 18, '#cf9bff', 20, { speed: 130 });
}

function performAttack(unit, target) {
  const def = unit.def;
  unit.attackCooldown = def.attackInterval;
  const animationDuration = def.drawType === 'boneGiant' ? 0.62 : def.drawType === 'boneDragon' ? 0.5 : def.drawType === 'gunner' ? 0.3 : 0.38;
  unit.attackTimer = animationDuration;
  unit.attackDuration = animationDuration;
  let damage = def.damage;
  let impact = null;
  let knockdownDuration = 0;

  if (def.charge && unit.chargeDistance >= def.charge.distance && unit.chargeCooldown <= 0) {
    damage *= def.charge.multiplier;
    impact = def.charge.impact;
    knockdownDuration = def.charge.knockdown;
    unit.chargeDistance = 0;
    unit.chargeCooldown = def.charge.cooldown;
    addFloater('冲锋!', unit.x, unit.y - 86, '#ffd57a', 15);
    addParticles(unit.x, unit.y - 20, '#ffd57a', 15, { speed: 95 });
  }

  if (def.firstImpact && target.kind === 'unit' && !unit.firstHitTargets.has(target.id)) {
    unit.firstHitTargets.add(target.id);
    if (!impact) {
      impact = def.firstImpact;
      knockdownDuration = 0.8;
    }
  }

  if (def.heavyImpact && unit.impactCooldown <= 0) {
    impact = def.heavyImpact.impact;
    knockdownDuration = def.heavyImpact.knockdown;
    unit.impactCooldown = def.heavyImpact.cooldown;
  }

  const strikeDelay = animationDuration * (def.damageType === 'melee' ? 0.44 : 0.36);
  unit.pendingAttack = {
    target,
    delay: strikeDelay,
    damage,
    damageType: def.damageType,
    impact,
    knockdownDuration,
  };
}

function resolveAttack(unit, attack) {
  const target = attack.target;
  if (!targetAlive(target) || unit.dead) return;
  const def = unit.def;

  if (attack.damageType !== 'melee') {
    const facing = unit.side === 'player' ? 1 : -1;
    const muzzleDistance = def.drawType === 'tank' ? 88 : def.drawType === 'helicopter' ? 72 : def.flying ? 62 : 48;
    const muzzleX = unit.x + facing * muzzleDistance;
    const muzzleY = unit.y - (def.flying ? 178 : 48);
    const muzzleColor = def.projectileColor || '#f4d787';
    const explosiveShot = attack.damageType === 'explosive';
    addParticles(muzzleX, muzzleY, muzzleColor, explosiveShot ? 10 : 3, {
      speed: explosiveShot ? 115 : 48,
      size: explosiveShot ? 4.5 : 2.3,
      life: explosiveShot ? 0.2 : 0.1,
      gravity: -12,
      vx: facing * (explosiveShot ? 125 : 72),
      vy: -18,
    });
    if (explosiveShot) {
      addRing(muzzleX, muzzleY + 8, muzzleColor, 6, 0.24);
      camera.shakePower = Math.max(camera.shakePower, 3.4);
      camera.shakeTime = Math.max(camera.shakeTime, 0.09);
    }
    playCombatSound(
      attack.damageType === 'magic' ? 'magic' : explosiveShot ? 'explosive' : 'ranged',
      explosiveShot ? 1.15 : 0.55
    );
    spawnProjectile({
      side: unit.side,
      source: unit,
      target,
      x: muzzleX,
      y: muzzleY,
      damage: attack.damage,
      damageType: attack.damageType,
      speed: def.projectileSpeed || 430,
      color: muzzleColor,
      size: def.drawType === 'boneDragon' ? 8 : def.damageType === 'magic' ? 6 : 3,
      aoeRadius: def.aoeRadius || 0,
      impact: def.projectileImpact || 0,
      knockdownDuration: def.projectileKnockdown || 0,
    });
    return;
  }

  const survived = dealDamage(unit, target, attack.damage, attack.damageType, {
    heavy: Boolean(attack.impact) || attack.damage >= 35,
    direction: Math.sign(target.x - unit.x) || 1,
  });

  if (survived && attack.impact && attack.knockdownDuration > 0) {
    tryKnockdown(target, attack.impact, attack.knockdownDuration);
  }
}
function tryKnockdown(target, impact, duration) {
  if (!target || target.kind !== 'unit' || target.dead || target.def.flying) return false;
  if (target.knockdownImmune > 0) {
    addFloater('抗性', target.x, target.y - 62, '#8b93a5', 11);
    return false;
  }

  const diff = impact - target.def.mass;
  let chance = 0;
  if (diff >= 2) chance = 0.8;
  else if (diff === 1) chance = 0.6;
  else if (diff === 0) chance = 0.35;
  else if (diff === -1) chance = 0.15;

  if (Math.random() > chance) return false;

  target.downTimer = Math.max(target.downTimer, duration);
  target.knockdownImmune = duration + 5;
  target.target = null;
  target.pendingAttack = null;
  addFloater('倒地!', target.x, target.y - 70, '#ffe6a4', 14);
  addParticles(target.x, target.y - 18, '#dfcc9d', 10, { speed: 75 });
  return true;
}

function addImpactBurst(x, y, color, heavy = false, direction = 1) {
  if (!state) return;
  state.hitBursts.push({
    id: uid('impact'),
    x,
    y,
    color,
    heavy,
    direction,
    angle: rand(-0.35, 0.35),
    life: heavy ? 0.26 : 0.16,
    maxLife: heavy ? 0.26 : 0.16,
  });
  if (state.hitBursts.length > 70) state.hitBursts.splice(0, state.hitBursts.length - 70);
}

function triggerHitFeedback(source, target, finalDamage, damageType, options) {
  if (!state) return;
  const sourceX = Number.isFinite(source?.x) ? source.x : target.x - 1;
  const direction = Number.isFinite(options.direction)
    ? Math.sign(options.direction) || 1
    : Math.sign(target.x - sourceX) || 1;
  const heavy = Boolean(options.heavy) || damageType === 'explosive' || finalDamage >= 38;
  const color = damageType === 'magic'
    ? '#a7ffe3'
    : damageType === 'explosive'
      ? '#ffb05f'
      : '#fff4c9';
  const impactY = target.y - (target.isBuilding
    ? Math.min(target.height * 0.5, 42)
    : target.def?.flying
      ? 164
      : 31);
  const onScreen = Math.abs(target.x - camera.x - WORLD.viewWidth * 0.5) < WORLD.viewWidth * 0.62;

  if (target.kind === 'unit') {
    const mass = Math.max(1, target.def.mass || 2);
    const massFactor = clamp(3.7 / (mass + 1.25), 0.24, 1.45);
    const basePush = damageType === 'explosive' ? 112 : damageType === 'magic' ? 48 : 56;
    const push = (basePush + Math.min(52, finalDamage * 0.9)) * massFactor;
    target.knockbackX += direction * push;
    target.knockbackY += rand(-0.16, 0.16) * push;
    target.hitDir = direction;
    const stun = clamp((damageType === 'explosive' ? 0.2 : 0.105) * massFactor, 0.045, 0.22);
    target.hitStunMax = Math.max(0.05, stun);
    target.hitStun = Math.max(target.hitStun, stun);
    target.pendingAttack = null;
  }

  addImpactBurst(
    target.x - direction * (target.kind === 'unit' ? 10 : 18),
    impactY,
    color,
    heavy,
    direction,
  );
  addParticles(target.x - direction * 7, impactY, color, heavy ? 20 : 9, {
    speed: heavy ? 145 : 92,
    size: heavy ? 3.2 : 2.3,
    life: heavy ? 0.42 : 0.28,
    gravity: 260,
    vx: direction * (heavy ? 100 : 58),
    vy: -45,
  });
  if (heavy) {
    addParticles(target.x, target.y - 4, '#c7ad7d', 7, {
      speed: 90,
      size: 3.8,
      life: 0.34,
      gravity: -18,
      vx: direction * 48,
      vy: -28,
    });
    addRing(target.x, target.y - 3, color, 8, 0.36);
  }

  if (onScreen) {
    camera.shakePower = Math.max(camera.shakePower, heavy ? 8 : 3.2);
    camera.shakeTime = Math.max(camera.shakeTime, heavy ? 0.2 : 0.1);
    if (hitStopCooldown <= 0) {
      hitStopTimer = Math.max(hitStopTimer, heavy ? 0.085 : 0.042);
      hitStopCooldown = heavy ? 0.14 : 0.09;
    }
    const soundKind = damageType === 'magic'
      ? 'magic'
      : damageType === 'explosive'
        ? 'explosive'
        : damageType === 'ranged'
          ? 'ranged'
          : source?.faction === 'skeleton'
            ? 'bone'
            : 'melee';
    playCombatSound(soundKind, heavy ? 1.4 : 0.85);
  }
}

function dealDamage(source, target, amount, damageType, options = {}) {

  if (!targetAlive(target)) return false;
  let resist = 0;
  if (target.kind === 'unit' && target.def.resist) {
    resist = target.def.resist[damageType] || 0;
  }

  const armorPierce = source?.def?.armorPierce || 0;
  if (damageType === 'ranged' && armorPierce > 0) {
    resist *= 1 - armorPierce;
  }

  const finalDamage = Math.max(1, amount * (1 - resist));
  target.hp -= finalDamage;
  target.hitFlash = 0.15;
  triggerHitFeedback(source, target, finalDamage, damageType, options);

  const color = damageType === 'magic'
    ? '#9bf5d7'
    : damageType === 'explosive'
      ? '#ffad67'
      : '#fff1c8';
  addFloater(`-${Math.round(finalDamage)}`, target.x + rand(-8, 8), target.y - (target.isBuilding ? 42 : 55), color, 11);

  if (target.hp <= 0) {
    if (target.kind === 'unit') killUnit(target);
    else killBuilding(target);
    return false;
  }
  return true;
}

function killUnit(unit) {
  if (unit.dead) return;
  unit.dead = true;
  unit.hp = 0;
  addParticles(unit.x, unit.y - (unit.def.flying ? 175 : 20), unit.faction === 'skeleton' ? '#d9cdf0' : '#83a9e8', 14, { speed: 105 });

  const side = sideById(unit.side);
  const owner = sideById(unit.side);
  if (owner.faction === 'skeleton' && unit.def.deathValue && !unit.def.cannotRevive && !unit.revived) {
    side.graveyard.push({
      defId: unit.defId,
      x: unit.x,
      y: unit.y,
      deadAt: state.time,
      deathValue: unit.def.deathValue,
      revived: false,
    });
  }

  if (selectedUnits.includes(unit)) {
    selectedUnits = selectedUnits.filter((selected) => selected !== unit);
  }
}

function queuedUnitCost(building) {
  return (building.queue || []).reduce((total, unitId) => total + (UNIT_DEFS[unitId]?.cost || 0), 0);
}

function demolitionRefund(building) {
  if (!building || building.isBase) return 0;
  const invested = building.invested || BUILDING_DEFS[building.type]?.cost || 0;
  return Math.floor((invested + queuedUnitCost(building)) * 0.5);
}

function demolishBuilding(building) {
  if (!building || building.dead || building.isBase) return false;
  const side = sideById(building.side);
  const refund = demolitionRefund(building);
  side.gold += refund;
  const buildingName = building.name;
  killBuilding(building);
  addFloater(`+${refund}`, building.x, building.y - 45, '#6ee7b7', 16);
  setToast(`${buildingName}已拆除，返还 ${refund} 资源。`, 1800);
  updateHud(true);
  saveGame();
  return true;
}

function handleRightClick(point) {
  const ownBuilding = findOwnBuildingAt(point);
  if (ownBuilding?.isBase) {
    setToast('基地无法拆除。', 1400);
    return;
  }
  if (ownBuilding && demolishBuilding(ownBuilding)) {
    buildMode = null;
    ui.buildCards.forEach((card) => card.classList.remove('active'));
    ui.buildHint.textContent = '选择建筑后点击己方领地内的空地';
    resetHint();
    return;
  }
  if (buildMode) {
    buildMode = null;
    ui.buildCards.forEach((card) => card.classList.remove('active'));
    ui.buildHint.textContent = '选择建筑后点击己方领地内的空地';
    resetHint();
  }
}

function killBuilding(building) {
  if (building.dead) return;
  building.dead = true;
  building.hp = 0;
  if (building.pad) building.pad.building = null;
  addParticles(building.x, building.y - building.height * 0.45, '#c79b70', 28, { speed: 130 });
  addRing(building.x, building.y - 12, '#ffab6d', 20, 0.6);

  if (selectedBuilding === building) selectedBuilding = null;
  if (building.isBase) {
    endGame(building.side === 'player' ? 'enemy' : 'player');
  }
}

function spawnProjectile(config) {
  state.projectiles.push({
    id: uid('projectile'),
    side: config.side,
    source: config.source,
    target: config.target,
    x: config.x,
    y: config.y,
    damage: config.damage,
    damageType: config.damageType,
    speed: config.speed,
    color: config.color,
    size: config.size || 3,
    aoeRadius: config.aoeRadius || 0,
    impact: config.impact || 0,
    knockdownDuration: config.knockdownDuration || 0,
    life: 0,
  });
}

function updateProjectiles(dt) {
  if (!state) return;
  const survivors = [];

  for (const projectile of state.projectiles) {
    projectile.life += dt;
    if (!targetAlive(projectile.target) || projectile.life > 4.5) continue;

    const target = projectile.target;
    const targetY = target.y - (target.isBuilding ? target.height * 0.55 : target.def?.flying ? 180 : 36);
    const dx = target.x - projectile.x;
    const dy = targetY - projectile.y;
    const distance = Math.hypot(dx, dy);
    const step = projectile.speed * dt;

    if (distance <= step + 12) {
      impactProjectile(projectile);
      continue;
    }

    projectile.x += (dx / distance) * step;
    projectile.y += (dy / distance) * step;

    if (Math.random() < 0.35) {
      addParticles(projectile.x, projectile.y, projectile.color, 1, {
        speed: 12,
        size: projectile.size * 0.55,
        life: 0.22,
        gravity: 0,
      });
    }

    survivors.push(projectile);
  }

  state.projectiles = survivors;
}

function impactProjectile(projectile) {
  const target = projectile.target;
  if (!targetAlive(target)) return;

  if (projectile.aoeRadius > 0) {
    const enemy = sideById(projectile.side === 'player' ? 'enemy' : 'player');
    const candidates = [...enemy.units];
    for (const unit of candidates) {
      if (!canTarget({ def: { damageType: 'explosive' } }, unit)) continue;
      if (Math.hypot(unit.x - target.x, unit.y - target.y) <= projectile.aoeRadius) {
        const survived = dealDamage(projectile.source, unit, projectile.damage, projectile.damageType, {
          heavy: Boolean(projectile.impact) || Boolean(projectile.aoeRadius),
          direction: Math.sign(unit.x - target.x) || Math.sign(target.x - projectile.source?.x) || 1,
        });
        if (survived && projectile.impact && projectile.knockdownDuration > 0) {
          tryKnockdown(unit, projectile.impact, projectile.knockdownDuration);
        }
      }
    }
    if (target.isBuilding) {
      dealDamage(projectile.source, target, projectile.damage, projectile.damageType);
    }
    addParticles(target.x, target.y - (target.def?.flying ? 180 : 35), '#ffb867', 24, { speed: 135 });
    addRing(target.x, target.y - 25, '#ffac61', 14, 0.5);
    return;
  }

  const survived = dealDamage(projectile.source, target, projectile.damage, projectile.damageType, {
    heavy: Boolean(projectile.impact) || Boolean(projectile.aoeRadius),
    direction: Math.sign(target.x - (projectile.source?.x ?? target.x - 1)) || 1,
  });
  if (survived && target.kind === 'unit' && projectile.impact && projectile.knockdownDuration > 0) {
    tryKnockdown(target, projectile.impact, projectile.knockdownDuration);
  }
  addParticles(target.x, target.y - (target.isBuilding ? target.height * 0.4 : 32), projectile.color, 8, {
    speed: 85,
    size: 2,
  });
}

function resolveUnitSpacing(side) {
  const units = side.units.filter((unit) => !unit.dead);
  for (let i = 0; i < units.length; i += 1) {
    for (let j = i + 1; j < units.length; j += 1) {
      const left = units[i];
      const right = units[j];
      if (Boolean(left.def.flying) !== Boolean(right.def.flying)) continue;
      const minimumGap = (left.def.radius + right.def.radius) * 0.62;
      let dx = right.x - left.x;
      let dy = right.y - left.y;
      let distance = Math.hypot(dx, dy);
      if (distance >= minimumGap) continue;
      if (distance < 0.001) {
        dx = 1;
        dy = 0;
        distance = 1;
      }
      const push = (minimumGap - distance) * 0.5;
      const nx = dx / distance;
      const ny = dy / distance;
      left.x = clamp(left.x - nx * push, 24, WORLD.width - 24);
      left.y = clampBattlefieldY(left.y - ny * push);
      right.x = clamp(right.x + nx * push, 24, WORLD.width - 24);
      right.y = clampBattlefieldY(right.y + ny * push);
    }
  }

  for (const unit of units) resolveUnitBuildingCollision(unit);
}

function resolveOpposingCollisions() {
  const leftSide = state.player.units.filter((unit) => !unit.dead);
  const rightSide = state.enemy.units.filter((unit) => !unit.dead);

  for (const left of leftSide) {
    for (const right of rightSide) {
      if (Boolean(left.def.flying) !== Boolean(right.def.flying)) continue;
      const minimumGap = (left.def.radius + right.def.radius) * 0.56;
      let dx = right.x - left.x;
      let dy = right.y - left.y;
      let distance = Math.hypot(dx, dy);
      if (distance >= minimumGap) continue;
      if (distance < 0.001) {
        dx = 1;
        dy = 0;
        distance = 1;
      }
      const push = (minimumGap - distance) * 0.52;
      const nx = dx / distance;
      const ny = dy / distance;
      left.x = clamp(left.x - nx * push, 24, WORLD.width - 24);
      left.y = clampBattlefieldY(left.y - ny * push);
      right.x = clamp(right.x + nx * push, 24, WORLD.width - 24);
      right.y = clampBattlefieldY(right.y + ny * push);
    }
  }

  for (const unit of [...leftSide, ...rightSide]) resolveUnitBuildingCollision(unit);
}
function updateTerritory(side) {
  if (side.units.length === 0) {
    side.frontierX = side.initialFrontierX;
    return;
  }

  if (side.id === 'player') {
    const leadingX = Math.max(...side.units.map((unit) => unit.x));
    side.frontierX = Math.max(side.initialFrontierX, leadingX - WORLD.territoryMargin);
  } else {
    const leadingX = Math.min(...side.units.map((unit) => unit.x));
    side.frontierX = Math.min(side.initialFrontierX, leadingX + WORLD.territoryMargin);
  }
}
function cleanupDead() {
  if (!state) return;
  state.player.units = state.player.units.filter((unit) => !unit.dead);
  state.enemy.units = state.enemy.units.filter((unit) => !unit.dead);
  state.player.buildings = state.player.buildings.filter((building) => !building.dead);
  state.enemy.buildings = state.enemy.buildings.filter((building) => !building.dead);
  state.player.graveyard = state.player.graveyard.filter((entry) => state.time - entry.deadAt <= REVIVE_RULES.corpseLifetime + 1);
  state.enemy.graveyard = state.enemy.graveyard.filter((entry) => state.time - entry.deadAt <= REVIVE_RULES.corpseLifetime + 1);
  selectedUnits = selectedUnits.filter((unit) => !unit.dead && state.player.units.includes(unit));
  if (selectedBuilding?.dead) selectedBuilding = null;
}

function updateAI(dt) {
  if (!state || state.ended) return;
  const ai = state.enemy;
  ai.aiThinkTimer -= dt;
  ai.aiSwitchTimer -= dt;
  ai.aiProduceTimer -= dt;
  ai.aiUpgradeTimer -= dt;

  if (ai.aiThinkTimer <= 0) {
    ai.aiThinkTimer = 1.05;
    aiThinkBuild();
  }

  if (ai.aiSwitchTimer <= 0) {
    ai.aiSwitchTimer = 6;
    aiChooseProduction();
  }

  if (ai.aiProduceTimer <= 0) {
    ai.aiProduceTimer = 2.2;
    aiQueueUnit();
  }

  if (ai.aiUpgradeTimer <= 0 && state.time > 25) {
    ai.aiUpgradeTimer = 9;
    aiTryUpgrade();
  }
}

function findAIBuildSpot(ai, type) {
  const def = BUILDING_DEFS[type];
  const halfWidth = def.width / 2;
  const minX = ai.frontierX + halfWidth + 18;
  const maxX = ai.base.x - 80 - halfWidth;
  if (minX > maxX) return null;

  const baseY = [
    WORLD.battlefieldFarY + 20,
    WORLD.battlefieldFarY + 52,
    WORLD.battlefieldFarY + 84,
    WORLD.battlefieldFarY + 116,
    WORLD.battlefieldFarY + 148,
    WORLD.battlefieldNearY - 8,
  ];
  const startY = ai.buildings.length % baseY.length;
  const yCandidates = baseY.map((_, index) => baseY[(startY + index) % baseY.length]);

  for (const y of yCandidates) {
    if (type === 'tower') {
      for (let x = minX; x <= maxX; x += 34) {
        if (!getPlacementError(ai, type, x, y)) return { x, y };
      }
    } else {
      for (let x = maxX; x >= minX; x -= 34) {
        if (!getPlacementError(ai, type, x, y)) return { x, y };
      }
    }
  }
  return null;
}

function aiThinkBuild() {
  const ai = state.enemy;
  const mines = ai.buildings.filter((building) => building.type === 'mine' && !building.dead).length;
  const barracks = ai.buildings.filter((building) => building.type === 'barracks' && !building.dead).length;
  const towers = ai.buildings.filter((building) => building.type === 'tower' && !building.dead).length;

  let type = null;
  if (mines === 0) type = 'mine';
  else if (barracks === 0) type = 'barracks';
  else if (mines < 2) type = 'mine';
  else if (towers === 0) type = 'tower';
  else if (barracks < 2) type = 'barracks';
  else if (mines < 4) type = 'mine';
  else if (barracks < 3) type = 'barracks';
  else if (towers < 2) type = 'tower';

  if (!type) return;
  const spot = findAIBuildSpot(ai, type);
  if (spot) tryPlaceBuilding(ai, type, spot.x, spot.y, false);
}

function aiQueueUnit() {
  const ai = state.enemy;
  const barracks = ai.buildings
    .filter((building) => building.type === 'barracks' && building.completed && !building.dead)
    .sort((a, b) => a.queue.length - b.queue.length || a.level - b.level);
  if (barracks.length === 0) return;
  const building = barracks[0];
  if (building.queue.length >= 2) return;
  enqueueUnit(ai, building, ai.barracksUnit, false);
}
function aiChooseProduction() {
  const ai = state.enemy;
  const player = state.player;
  const playerUnits = player.units;
  const aiUnits = ai.units;
  const countType = (list, predicate) => list.filter(predicate).length;

  if (ai.faction === 'knight') {
    const hasLargeSkeleton = playerUnits.some((unit) => ['boneGiant', 'boneDragon'].includes(unit.defId));
    const gunners = countType(aiUnits, (unit) => unit.defId === 'gunner');
    const shields = countType(aiUnits, (unit) => unit.defId === 'shieldKnight');
    const paladins = countType(aiUnits, (unit) => unit.defId === 'paladin');
    if (hasLargeSkeleton && gunners < 2) {
      ai.barracksUnit = 'gunner';
      return;
    }
    if (playerUnits.filter((unit) => unit.defId === 'boneDog').length >= 4 && shields < 2) {
      ai.barracksUnit = 'shieldKnight';
      return;
    }
    const rotation = ['swordKnight', 'shieldKnight', 'lightCavalry', 'gunner', 'heavyCavalry', 'swordKnight'];
    const index = Math.floor(state.time / 10 + aiUnits.length) % rotation.length;
    ai.barracksUnit = state.time > 75 && ai.gold > 280 && paladins < 2 ? 'paladin' : rotation[index];
    return;
  }

  if (ai.faction === 'arcane') {
    const wizards = countType(aiUnits, (unit) => unit.defId === 'wizard');
    const heras = countType(aiUnits, (unit) => unit.defId === 'hera');
    const beasts = countType(aiUnits, (unit) => unit.defId === 'ancientBeast');
    if (wizards < 2 && state.time > 18) {
      ai.barracksUnit = 'wizard';
    } else if (heras < 1 && state.time > 30) {
      ai.barracksUnit = 'hera';
    } else if (beasts < 1 && state.time > 75 && ai.gold > 280) {
      ai.barracksUnit = 'ancientBeast';
    } else {
      const rotation = ['warlock', 'occultist', 'warlock', 'wizard', 'warlock'];
      ai.barracksUnit = rotation[Math.floor(state.time / 7 + aiUnits.length) % rotation.length];
    }
    return;
  }

  if (ai.faction === 'special') {
    const tanks = countType(aiUnits, (unit) => unit.defId === 'tank');
    const helicopters = countType(aiUnits, (unit) => unit.defId === 'helicopter');
    if (tanks < 1 && state.time > 60 && ai.gold > 240) {
      ai.barracksUnit = 'tank';
    } else if (helicopters < 1 && state.time > 90 && ai.gold > 260) {
      ai.barracksUnit = 'helicopter';
    } else {
      const rotation = ['swat', 'riotPolice', 'specialForces', 'swat', 'riotPolice'];
      ai.barracksUnit = rotation[Math.floor(state.time / 7 + aiUnits.length) % rotation.length];
    }
    return;
  }

  const shamans = countType(aiUnits, (unit) => unit.defId === 'boneShaman');
  const giants = countType(aiUnits, (unit) => unit.defId === 'boneGiant');
  const dragons = countType(aiUnits, (unit) => unit.defId === 'boneDragon');
  if (shamans < 1 && state.time > 22) {
    ai.barracksUnit = 'boneShaman';
  } else if (giants < 2 && state.time > 45 && ai.gold > 190) {
    ai.barracksUnit = 'boneGiant';
  } else if (dragons < 1 && state.time > 105 && ai.gold > 300) {
    ai.barracksUnit = 'boneDragon';
  } else if (playerUnits.filter((unit) => ['shieldKnight', 'paladin'].includes(unit.defId)).length >= 2) {
    ai.barracksUnit = Math.random() < 0.4 ? 'boneGiant' : 'boneDog';
  } else {
    const rotation = ['boneSoldier', 'boneSoldier', 'boneDog', 'boneSoldier', 'boneShaman'];
    ai.barracksUnit = rotation[Math.floor(state.time / 8) % rotation.length];
  }
  if (ai.barracksUnit === 'boneShaman' && shamans >= 3) ai.barracksUnit = 'boneSoldier';
  if (ai.barracksUnit === 'boneGiant' && giants >= 2) ai.barracksUnit = 'boneDog';
}

function aiTryUpgrade() {
  const ai = state.enemy;
  if (ai.gold < 255) return;
  const candidates = [...ai.buildings]
    .filter((building) => building.completed && building.level < 3 && !building.dead)
    .sort((a, b) => {
      const priority = { barracks: 0, mine: 1, tower: 2 };
      return priority[a.type] - priority[b.type];
    });
  if (candidates.length > 0) upgradeBuilding(ai, candidates[0], false);
}

function issueCommand(command) {
  if (!state || state.ended) return;
  selectedUnits = selectedUnits.filter((unit) => !unit.dead && state.player.units.includes(unit));
  if (selectedUnits.length === 0) {
    setToast('先用长按左键自由圈选己方士兵。', 1800);
    return;
  }

  const commandInfo = COMMANDS[command];
  for (const unit of selectedUnits) {
    unit.command = command;
    unit.target = null;
    unit.pendingAttack = null;
    unit.detour = null;
    unit.commandFlash = 0.65;
    if (command !== 'attack') unit.chargeDistance = 0;
  }

  const centerX = selectedUnits.reduce((sum, unit) => sum + unit.x, 0) / selectedUnits.length;
  const centerY = selectedUnits.reduce((sum, unit) => sum + unit.y, 0) / selectedUnits.length;
  addRing(centerX, centerY - 12, commandInfo.color, 16, 0.7);
  addFloater(commandInfo.label, centerX, centerY - 78, commandInfo.color, 20);
  setToast(`${selectedUnits.length} 名士兵：${commandInfo.label}。`, 1400);
  updateHud(true);
  saveGame();
}

function addParticles(x, y, color, count = 6, options = {}) {
  if (!state) return;
  for (let index = 0; index < count; index += 1) {
    const life = options.life ?? rand(0.25, 0.62);
    state.particles.push({
      x: x + rand(-7, 7),
      y: y + rand(-7, 7),
      vx: (options.vx ?? 0) + rand(-1, 1) * (options.speed ?? 55),
      vy: (options.vy ?? 0) + rand(-1, 0.2) * (options.speed ?? 55),
      size: options.size ?? rand(1.5, 4),
      color,
      life,
      maxLife: life,
      gravity: options.gravity ?? 120,
    });
  }
  if (state.particles.length > MAX_PARTICLES) {
    state.particles.splice(0, state.particles.length - MAX_PARTICLES);
  }
}

function addFloater(text, x, y, color, size = 13) {
  if (!state) return;
  state.floaters.push({ id: uid('float'), text, x, y, color, size, life: 0.9, maxLife: 0.9 });
  if (state.floaters.length > 90) state.floaters.splice(0, state.floaters.length - 90);
}

function addRing(x, y, color, radius = 10, duration = 0.6) {
  if (!state) return;
  state.commandBursts.push({ id: uid('ring'), x, y, color, radius, life: duration, maxLife: duration });
}

function updateEffects(dt) {
  if (!state) return;

  for (const particle of state.particles) {
    particle.life -= dt;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.vy += particle.gravity * dt;
  }
  state.particles = state.particles.filter((particle) => particle.life > 0);

  for (const floater of state.floaters) {
    floater.life -= dt;
    floater.y -= 30 * dt;
  }
  state.floaters = state.floaters.filter((floater) => floater.life > 0);

  for (const ring of state.commandBursts) {
    ring.life -= dt;
  }
  state.commandBursts = state.commandBursts.filter((ring) => ring.life > 0);

  for (const burst of state.hitBursts) {
    burst.life -= dt;
  }
  state.hitBursts = state.hitBursts.filter((burst) => burst.life > 0);
}

function updateHud(force = false) {
  if (!state) return;
  const player = state.player;
  const enemy = state.enemy;
  const playerHpRatio = clamp(player.base.hp / player.base.maxHp, 0, 1);
  const enemyHpRatio = clamp(enemy.base.hp / enemy.base.maxHp, 0, 1);

  ui.playerBaseBar.style.width = `${playerHpRatio * 100}%`;
  ui.enemyBaseBar.style.width = `${enemyHpRatio * 100}%`;
  ui.playerBaseHp.textContent = `${Math.max(0, Math.ceil(player.base.hp))} / ${player.base.maxHp}`;
  ui.enemyBaseHp.textContent = `${Math.max(0, Math.ceil(enemy.base.hp))} / ${enemy.base.maxHp}`;
  ui.playerArmy.textContent = `${player.units.length} / ${getArmyCap(player)}`;
  ui.enemyArmy.textContent = `${enemy.units.length} / ${getArmyCap(enemy)}`;
  ui.goldAmount.textContent = Math.floor(player.gold);
  ui.incomeAmount.textContent = incomeForSide(player);
  ui.matchClock.textContent = formatTime(state.time);

  const hasBarracks = player.buildings.some((building) => building.type === 'barracks' && building.completed && !building.dead);
  for (const button of ui.unitButtons.querySelectorAll('[data-unit]')) {
    const unitId = button.dataset.unit;
    button.classList.toggle('active', selectedBuilding?.type === 'barracks' && selectedBuilding.queue[0] === unitId);
    button.classList.toggle('unavailable', !hasBarracks);
  }

  for (const card of ui.buildCards) {
    const type = card.dataset.building;
    card.classList.toggle('poor', player.gold < BUILDING_DEFS[type].cost);
  }

  const commandsEnabled = selectedUnits.length > 0;
  ui.commandButtons.forEach((button) => {
    button.disabled = !commandsEnabled;
  });

  let signature = `none:${player.gold < 0}`;
  let selectionTitle = '尚未选择';
  let selectionSub = '长按左键自由圈选己方士兵';
  let actions = '';

  if (selectedBuilding && !selectedBuilding.dead) {
    const hp = `${Math.max(0, Math.ceil(selectedBuilding.hp))} / ${selectedBuilding.maxHp}`;
    if (selectedBuilding.isBase) {
      selectionTitle = selectedBuilding.name;
      selectionSub = `基地耐久 ${hp} · 当前军队上限 ${getArmyCap(player)}`;
    } else if (!selectedBuilding.completed) {
      selectionTitle = `${selectedBuilding.name} · 建造中`;
      selectionSub = `完成度 ${Math.round(selectedBuilding.buildProgress * 100)}%`;
    } else {
      selectionTitle = `${selectedBuilding.name} · Lv.${selectedBuilding.level}`;
      const extra = selectedBuilding.type === 'mine'
        ? `产量 ${BUILDING_DEFS.mine.income[selectedBuilding.level - 1]}/秒`
        : selectedBuilding.type === 'barracks'
          ? `人口 +${WORLD.barracksBaseCap + (selectedBuilding.level - 1) * WORLD.barracksCapPerLevel} · 训练速度 ${Math.round(trainingSpeedForBarracks(selectedBuilding) * 100)}% · 队列 ${selectedBuilding.queue.length}/${WORLD.queueLimit}${selectedBuilding.queue.length > 0 && selectedBuilding.trainTimer > 0 ? ` · ${selectedBuilding.trainTimer.toFixed(1)}s` : ''}`
          : `伤害 ${towerDamage(selectedBuilding)} · 射程 ${towerRange(selectedBuilding)}`;
      selectionSub = `${extra} · 耐久 ${hp} · 右键拆除并返还 ${demolitionRefund(selectedBuilding)}`;
      if (selectedBuilding.level < 3) {
        const cost = BUILDING_DEFS[selectedBuilding.type].upgradeCosts[selectedBuilding.level - 1];
        const disabled = player.gold < cost ? 'disabled' : '';
        actions = `<button class="action-btn" type="button" data-action="upgrade" ${disabled}>升级 · ${cost} 资源</button>`;
      } else {
        actions = '<button class="action-btn" type="button" disabled>已满级</button>';
      }
    }
    signature = `building:${selectedBuilding.id}:${selectedBuilding.level}:${Math.ceil(selectedBuilding.hp)}:${selectedBuilding.completed}:${selectedBuilding.queue?.length || 0}:${player.gold >= (selectedBuilding.level < 3 ? BUILDING_DEFS[selectedBuilding.type]?.upgradeCosts?.[selectedBuilding.level - 1] ?? 9999 : 9999)}`;
  } else if (selectedUnits.length > 0) {
    selectedUnits = selectedUnits.filter((unit) => !unit.dead && player.units.includes(unit));
    const states = [...new Set(selectedUnits.map((unit) => COMMANDS[unit.command].label))];
    selectionTitle = `已选中 ${selectedUnits.length} 名士兵`;
    selectionSub = `当前指令：${states.join(' / ')} · 可重新自由圈选`;
    signature = `units:${selectedUnits.map((unit) => unit.id).join(',')}:${states.join(',')}`;
  }

  const previousSignature = ui.selectionActions.dataset.signature || '';
  ui.selectionTitle.textContent = selectionTitle;
  ui.selectionSub.textContent = selectionSub;
  if (force || previousSignature !== signature) {
    ui.selectionActions.innerHTML = actions;
    ui.selectionActions.dataset.signature = signature;
  }
}
function roundRectPath(x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function fillRoundRect(x, y, width, height, radius, color) {
  roundRectPath(x, y, width, height, radius);
  ctx.fillStyle = color;
  ctx.fill();
}

function strokeRoundRect(x, y, width, height, radius, color, lineWidth = 1) {
  roundRectPath(x, y, width, height, radius);
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

function drawBackground(time) {
  const sky = ctx.createLinearGradient(0, 0, 0, 585);
  sky.addColorStop(0, '#78bdd9');
  sky.addColorStop(0.45, '#a9d9dd');
  sky.addColorStop(0.78, '#d9d9b6');
  sky.addColorStop(1, '#efd29b');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, WORLD.width, 590);

  const haze = ctx.createLinearGradient(0, 430, 0, 600);
  haze.addColorStop(0, 'rgba(235, 222, 169, 0)');
  haze.addColorStop(1, 'rgba(235, 222, 169, 0.48)');
  ctx.fillStyle = haze;
  ctx.fillRect(0, 430, WORLD.width, 170);

  const sunGlow = ctx.createRadialGradient(1245, 128, 4, 1245, 128, 145);
  sunGlow.addColorStop(0, 'rgba(255, 244, 195, 0.72)');
  sunGlow.addColorStop(0.28, 'rgba(255, 226, 145, 0.2)');
  sunGlow.addColorStop(1, 'rgba(255, 226, 145, 0)');
  ctx.fillStyle = sunGlow;
  ctx.fillRect(1090, -30, 310, 320);

  ctx.save();
  ctx.fillStyle = '#ffe5a3';
  ctx.strokeStyle = '#715838';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(1245, 128, 47, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255, 250, 211, 0.65)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(1234, 116, 33, Math.PI * 1.1, Math.PI * 1.75);
  ctx.stroke();
  ctx.restore();

  drawBirds(time);
  drawClouds(time);
  drawMountains();
  drawDistantRuins();
  drawGround(time);
  drawBattlefieldProps(time);
}

function drawBirds(time) {
  ctx.save();
  ctx.strokeStyle = 'rgba(58, 72, 70, 0.58)';
  ctx.lineWidth = 2;
  const birds = [
    [640, 178, 0.7, 0.8],
    [684, 154, 0.5, 1.15],
    [742, 196, 0.62, 0.55],
    [1810, 132, 0.65, 0.9],
    [1850, 110, 0.45, 1.3],
  ];
  for (const [x, y, scale, speed] of birds) {
    const flap = Math.sin(time * 2.2 * speed + x) * 3;
    ctx.beginPath();
    ctx.moveTo(x - 9 * scale, y + flap);
    ctx.quadraticCurveTo(x - 4 * scale, y - 3 * scale, x, y);
    ctx.quadraticCurveTo(x + 4 * scale, y - 3 * scale, x + 9 * scale, y + flap);
    ctx.stroke();
  }
  ctx.restore();
}

function drawClouds(time) {
  const clouds = [
    { x: 120, y: 116, scale: 1.15, speed: 4 },
    { x: 520, y: 78, scale: 0.82, speed: 6 },
    { x: 910, y: 150, scale: 1.0, speed: 3.5 },
    { x: 1370, y: 70, scale: 0.72, speed: 5 },
    { x: 1850, y: 132, scale: 0.95, speed: 4.5 },
    { x: 2380, y: 82, scale: 1.08, speed: 3.8 },
    { x: 2860, y: 146, scale: 0.78, speed: 5.6 },
  ];

  for (const cloud of clouds) {
    const x = ((cloud.x + time * cloud.speed) % (WORLD.width + 200)) - 120;
    ctx.save();
    ctx.translate(x, cloud.y);
    ctx.scale(cloud.scale, cloud.scale);
    ctx.fillStyle = '#f7f0d6';
    ctx.strokeStyle = '#4c6664';
    ctx.lineWidth = 3;
    ctx.shadowColor = 'rgba(52, 78, 80, 0.24)';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 4;
    ctx.shadowOffsetY = 6;
    ctx.beginPath();
    ctx.moveTo(-58, 12);
    ctx.quadraticCurveTo(-76, -4, -48, -18);
    ctx.quadraticCurveTo(-30, -44, 3, -27);
    ctx.quadraticCurveTo(31, -48, 52, -18);
    ctx.quadraticCurveTo(84, -12, 74, 12);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = 'rgba(255,255,255,0.38)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-38, 4);
    ctx.quadraticCurveTo(-9, -17, 7, -21);
    ctx.stroke();
    ctx.restore();
  }
}
function drawMountains() {
  ctx.save();
  ctx.scale(WORLD.width / 1600, 1);
  ctx.fillStyle = '#85aa91';
  ctx.strokeStyle = '#456a59';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(-40, 574);
  ctx.lineTo(105, 356);
  ctx.lineTo(255, 525);
  ctx.lineTo(425, 320);
  ctx.lineTo(610, 535);
  ctx.lineTo(795, 348);
  ctx.lineTo(980, 540);
  ctx.lineTo(1155, 330);
  ctx.lineTo(1340, 532);
  ctx.lineTo(1510, 372);
  ctx.lineTo(1640, 568);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = 'rgba(245, 238, 195, 0.16)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(425, 320);
  ctx.lineTo(332, 438);
  ctx.moveTo(795, 348);
  ctx.lineTo(716, 445);
  ctx.moveTo(1155, 330);
  ctx.lineTo(1070, 442);
  ctx.stroke();

  ctx.fillStyle = '#628b73';
  ctx.strokeStyle = '#3d5f4d';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(-80, 630);
  ctx.lineTo(155, 470);
  ctx.lineTo(315, 585);
  ctx.lineTo(520, 430);
  ctx.lineTo(700, 607);
  ctx.lineTo(880, 466);
  ctx.lineTo(1090, 615);
  ctx.lineTo(1300, 458);
  ctx.lineTo(1480, 600);
  ctx.lineTo(1680, 490);
  ctx.lineTo(1680, 680);
  ctx.lineTo(-80, 680);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#4c765e';
  ctx.beginPath();
  ctx.moveTo(-100, 682);
  ctx.quadraticCurveTo(220, 570, 490, 664);
  ctx.quadraticCurveTo(760, 738, 1050, 646);
  ctx.quadraticCurveTo(1360, 564, 1700, 672);
  ctx.lineTo(1700, 705);
  ctx.lineTo(-100, 705);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawDistantRuins() {
  drawCartoonTree(110, 607, 1.15, '#35624a', '#253d31');
  drawCartoonTree(620, 611, 0.8, '#39684e', '#253d31');
  drawCartoonTree(1130, 600, 1.0, '#3f7255', '#253d31');
  drawCartoonTree(1780, 608, 0.92, '#35624a', '#253d31');
  drawCartoonTree(2350, 600, 1.12, '#39684e', '#253d31');
  drawCartoonTree(2830, 610, 0.84, '#3f7255', '#253d31');
  drawCartoonTree(3060, 596, 1.05, '#35624a', '#253d31');

  ctx.save();
  ctx.strokeStyle = '#5c432e';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(-10, 625);
  ctx.lineTo(78, 625);
  ctx.moveTo(8, 625);
  ctx.lineTo(8, 600);
  ctx.moveTo(34, 625);
  ctx.lineTo(34, 594);
  ctx.moveTo(61, 625);
  ctx.lineTo(61, 603);
  ctx.stroke();
  ctx.restore();
}
function drawCartoonTree(x, groundY, scale, canopyColor, outlineColor) {
  ctx.save();
  ctx.translate(x, groundY);
  ctx.scale(scale, scale);
  ctx.strokeStyle = outlineColor;
  ctx.fillStyle = '#725036';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.rect(-8, -92, 16, 92);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = canopyColor;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(-42, -82);
  ctx.quadraticCurveTo(-58, -108, -33, -122);
  ctx.quadraticCurveTo(-18, -148, 9, -131);
  ctx.quadraticCurveTo(38, -146, 49, -115);
  ctx.quadraticCurveTo(71, -100, 52, -77);
  ctx.quadraticCurveTo(54, -55, 28, -52);
  ctx.quadraticCurveTo(-5, -44, -22, -59);
  ctx.quadraticCurveTo(-45, -61, -42, -82);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
function drawGround(time) {
  const planeTop = WORLD.battlefieldFarY - 26;
  const dirtTop = WORLD.battlefieldFarY + 36;

  ctx.fillStyle = '#79a25a';
  ctx.strokeStyle = '#314b30';
  ctx.lineWidth = 4;
  ctx.fillRect(0, planeTop, WORLD.width, dirtTop - planeTop + 2);
  ctx.beginPath();
  ctx.moveTo(0, planeTop);
  ctx.lineTo(WORLD.width, planeTop);
  ctx.stroke();

  ctx.fillStyle = '#98714a';
  ctx.fillRect(0, dirtTop, WORLD.width, WORLD.height - dirtTop);
  ctx.strokeStyle = '#5b402d';
  ctx.beginPath();
  ctx.moveTo(0, dirtTop);
  ctx.lineTo(WORLD.width, dirtTop);
  ctx.stroke();

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, planeTop, WORLD.width, WORLD.height - planeTop);
  ctx.clip();

  const vanishingX = WORLD.width / 2;
  const vanishingY = planeTop - 42;
  ctx.strokeStyle = 'rgba(67, 91, 47, 0.22)';
  ctx.lineWidth = 2;
  for (let frontX = -220; frontX <= WORLD.width + 220; frontX += 170) {
    ctx.beginPath();
    ctx.moveTo(vanishingX, vanishingY);
    ctx.lineTo(frontX, WORLD.height);
    ctx.stroke();
  }

  for (let row = 0; row < 8; row += 1) {
    const y = dirtTop + 12 + row * 22;
    ctx.strokeStyle = `rgba(75, 52, 34, ${0.12 + row * 0.014})`;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.quadraticCurveTo(WORLD.width / 2, y + row * 1.2, WORLD.width, y);
    ctx.stroke();
  }
  ctx.restore();

  ctx.strokeStyle = 'rgba(47, 77, 39, 0.92)';
  ctx.lineWidth = 3;
  for (let x = 8; x < WORLD.width; x += 29) {
    const sway = Math.sin(time * 1.8 + x * 0.09) * 2;
    ctx.beginPath();
    ctx.moveTo(x, planeTop + 6);
    ctx.lineTo(x - 5 + sway, planeTop - 7);
    ctx.moveTo(x, planeTop + 6);
    ctx.lineTo(x + 3 + sway, planeTop - 11);
    ctx.stroke();
  }

  ctx.fillStyle = 'rgba(58, 42, 29, 0.28)';
  for (const detail of backgroundSeeds) {
    const y = planeTop + 12 + (detail.y - WORLD.groundY + 90) % 115;
    ctx.beginPath();
    ctx.ellipse(detail.x, y, Math.max(2, detail.w * 0.22), 1.6, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}
function drawBattlefieldProps(time) {
  const bushes = [
    [420, 600, 0.72], [980, 588, 0.55], [1540, 604, 0.66],
    [2140, 592, 0.8], [2740, 602, 0.58],
  ];
  for (const [x, y, scale] of bushes) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.fillStyle = '#47724d';
    ctx.strokeStyle = '#2b4935';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(-18, 0, 19, Math.PI, Math.PI * 2);
    ctx.arc(4, -8, 25, Math.PI, Math.PI * 2);
    ctx.arc(28, 1, 17, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(169, 215, 139, 0.35)';
    ctx.beginPath();
    ctx.arc(-2, -21, 10, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  const rocks = [[720, 614, 1], [1290, 602, 0.7], [1980, 618, 1.2], [2540, 608, 0.85]];
  for (const [x, y, scale] of rocks) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.fillStyle = '#72776c';
    ctx.strokeStyle = '#3e443d';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-20, 0);
    ctx.lineTo(-12, -16);
    ctx.lineTo(9, -20);
    ctx.lineTo(23, -7);
    ctx.lineTo(18, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = 'rgba(220, 220, 190, 0.3)';
    ctx.beginPath();
    ctx.moveTo(-7, -14);
    ctx.lineTo(5, -16);
    ctx.lineTo(12, -9);
    ctx.stroke();
    ctx.restore();
  }

  ctx.save();
  ctx.strokeStyle = '#3f6c46';
  ctx.lineWidth = 2;
  for (let x = 60; x < WORLD.width; x += 87) {
    const sway = Math.sin(time * 1.4 + x * 0.07) * 4;
    const y = WORLD.battlefieldFarY + 22 + (x % 5) * 9;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - 4 + sway, y - 12);
    ctx.moveTo(x, y);
    ctx.lineTo(x + 4 + sway, y - 9);
    ctx.stroke();
    if (x % 261 === 0) {
      ctx.fillStyle = '#f1c25f';
      ctx.beginPath();
      ctx.arc(x + 3 + sway, y - 12, 2.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.72;
  for (let index = 0; index < 18; index += 1) {
    const x = (index * 233 + time * (4 + index % 3)) % WORLD.width;
    const y = 250 + (index * 41) % 280;
    ctx.fillStyle = '#fff1b7';
    ctx.beginPath();
    ctx.arc(x, y, index % 4 === 0 ? 1.8 : 1.1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawTerritoryBoundary(side) {
  const color = side.id === 'player' ? '#3d86d8' : '#9b65c7';
  const x = side.frontierX;
  ctx.save();
  ctx.setLineDash([8, 7]);
  ctx.lineWidth = 3;
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.72;
  ctx.beginPath();
  ctx.moveTo(x, WORLD.battlefieldFarY - 46);
  ctx.lineTo(x, WORLD.battlefieldNearY + 4);
  ctx.stroke();
  ctx.setLineDash([]);

  const label = side.id === 'player' ? '己方建筑边界' : '敌方建筑边界';
  ctx.font = '900 10px "Microsoft YaHei UI", sans-serif';
  const width = ctx.measureText(label).width + 14;
  const labelX = side.id === 'player' ? x - width / 2 : x - width / 2;
  fillRoundRect(labelX, WORLD.battlefieldFarY - 72, width, 18, 4, '#fff0c9');
  strokeRoundRect(labelX, WORLD.battlefieldFarY - 72, width, 18, 4, '#241a13', 2);
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.fillText(label, x, WORLD.battlefieldFarY - 59);
  ctx.restore();
}

function drawBuildExclusionZones(side, type) {
  const def = BUILDING_DEFS[type];
  if (!def) return;
  const structures = [side.base, ...side.buildings];
  for (const structure of structures) {
    if (!structure || structure.dead) continue;
    const exclusion = placementExclusionFor(def.width, structure);
    ctx.save();
    ctx.fillStyle = 'rgba(213, 83, 63, 0.075)';
    ctx.strokeStyle = 'rgba(181, 63, 48, 0.58)';
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 5]);
    ctx.beginPath();
    ctx.ellipse(structure.x, structure.y - 2, exclusion.rx, exclusion.ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

function drawBuildGhost() {
  if (!state || !buildMode || !hoverPoint) return;
  const player = state.player;
  const def = BUILDING_DEFS[buildMode];
  const error = getPlacementError(player, buildMode, hoverPoint.x, hoverPoint.y);
  const valid = !error;
  const ghost = {
    id: 'ghost',
    kind: 'building',
    isBuilding: true,
    isBase: false,
    type: buildMode,
    side: 'player',
    faction: player.faction,
    name: factionOf(player).buildings[buildMode],
    x: hoverPoint.x,
    y: clampBattlefieldY(hoverPoint.y),
    width: def.width,
    height: def.height,
    hp: def.hp,
    maxHp: def.hp,
    level: 1,
    completed: true,
    buildProgress: 1,
    dead: false,
    queue: [],
    hitFlash: 0,
  };

  ctx.save();
  ctx.globalAlpha = valid ? 0.5 : 0.3;
  drawBuilding(ghost);
  ctx.restore();

  ctx.save();
  ctx.strokeStyle = valid ? '#2f9b5f' : '#d5533f';
  ctx.fillStyle = valid ? 'rgba(63, 155, 101, 0.15)' : 'rgba(213, 83, 63, 0.16)';
  ctx.lineWidth = 3;
  ctx.setLineDash([7, 5]);
  ctx.beginPath();
  ctx.ellipse(ghost.x, ghost.y - 2, def.width * 0.5, 18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.font = '900 11px "Microsoft YaHei UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = valid ? '#1f6f43' : '#a72f22';
  ctx.fillText(valid ? `放置 ${ghost.name}` : error, ghost.x, ghost.y - def.height - 20);
  ctx.restore();
}
function drawSelectionGlow(target, color = '#f0cf7e') {
  if (selectedBuilding !== target) return;
  ctx.save();
  ctx.setLineDash([6, 5]);
  ctx.lineWidth = 2;
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.ellipse(target.x, target.y - 2, target.width * 0.5, footprintDepthForBuilding(target), 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawBase(base) {
  const faction = FACTIONS[base.faction];
  const x = base.x;
  const y = base.y;

  drawSelectionGlow(base);
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.34)';
  ctx.beginPath();
  ctx.ellipse(x, y + 3, base.width * 0.58, 18, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.translate(x, y);
  ctx.shadowColor = '#241a13';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 3;
  ctx.shadowOffsetY = 3;
  ctx.lineJoin = 'round';
  const dir = base.side === 'player' ? 1 : -1;
  const depthScale = 0.84 + clamp((base.y - WORLD.battlefieldFarY) / (WORLD.battlefieldNearY - WORLD.battlefieldFarY), 0, 1) * 0.22;
  ctx.scale(dir * depthScale, depthScale);

  if (base.faction === 'knight') {
    drawKnightBase(base);
  } else if (base.faction === 'skeleton') {
    drawSkeletonBase(base);
  } else if (base.faction === 'arcane') {
    drawArcaneBase(base);
  } else {
    drawSpecialBase(base);
  }
  ctx.restore();

  drawBuildingLabel(base, faction.accent);
  drawBuildingHealth(base);
}

function drawKnightBase(base) {
  const h = base.height;
  fillRoundRect(-56, -h + 45, 112, h - 45, 9, '#596473');
  fillRoundRect(-52, -h + 58, 104, h - 58, 6, '#6d7886');
  ctx.fillStyle = '#3c4654';
  ctx.fillRect(-11, -46, 22, 46);
  ctx.beginPath();
  ctx.arc(0, -46, 11, Math.PI, 0);
  ctx.fill();

  const towerXs = [-48, 48];
  for (const towerX of towerXs) {
    fillRoundRect(towerX - 18, -h + 10, 36, h - 10, 4, '#4b5666');
    ctx.fillStyle = '#737f90';
    ctx.fillRect(towerX - 22, -h + 4, 44, 11);
    ctx.fillStyle = '#303946';
    ctx.fillRect(towerX - 4, -h + 31, 8, 22);
  }

  ctx.strokeStyle = '#c5b37a';
  ctx.lineWidth = 2;
  for (let row = 0; row < 4; row += 1) {
    ctx.beginPath();
    ctx.moveTo(-45, -h + 85 + row * 28);
    ctx.lineTo(45, -h + 85 + row * 28);
    ctx.stroke();
  }

  ctx.fillStyle = '#2f8bd8';
  ctx.beginPath();
  ctx.moveTo(-42, -h + 35);
  ctx.lineTo(-42, -h - 34);
  ctx.lineTo(-8, -h - 18);
  ctx.lineTo(-42, -h - 2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#f1c76b';
  ctx.beginPath();
  ctx.arc(-42, -h + 31, 3, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(245, 213, 132, 0.7)';
  ctx.beginPath();
  ctx.arc(0, -h + 20, 4, 0, Math.PI * 2);
  ctx.fill();
}

function drawSkeletonBase(base) {
  const h = base.height;
  ctx.fillStyle = '#211b2b';
  ctx.beginPath();
  ctx.moveTo(-60, 0);
  ctx.lineTo(-44, -h + 52);
  ctx.lineTo(-20, -h + 25);
  ctx.lineTo(0, -h + 8);
  ctx.lineTo(22, -h + 34);
  ctx.lineTo(48, -h + 64);
  ctx.lineTo(62, 0);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = '#6c5b84';
  ctx.lineWidth = 7;
  for (let i = -2; i <= 2; i += 1) {
    ctx.beginPath();
    ctx.moveTo(i * 22, -h + 55);
    ctx.lineTo(i * 15, -28);
    ctx.stroke();
  }

  ctx.fillStyle = '#b9a7d2';
  ctx.beginPath();
  ctx.arc(0, -h + 66, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#231b30';
  ctx.beginPath();
  ctx.ellipse(-8, -h + 64, 5, 7, 0, 0, Math.PI * 2);
  ctx.ellipse(8, -h + 64, 5, 7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(-9, -h + 79, 18, 5);

  ctx.strokeStyle = '#8f78b2';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-52, -h + 8);
  ctx.lineTo(-68, -h - 26);
  ctx.moveTo(-52, -h + 8);
  ctx.lineTo(-32, -h - 22);
  ctx.stroke();

  ctx.fillStyle = 'rgba(126, 239, 202, 0.75)';
  ctx.beginPath();
  ctx.arc(0, -h + 92, 8, 0, Math.PI * 2);
  ctx.fill();
  const glow = ctx.createRadialGradient(0, -h + 92, 2, 0, -h + 92, 35);
  glow.addColorStop(0, 'rgba(118, 239, 201, 0.26)');
  glow.addColorStop(1, 'rgba(118, 239, 201, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(-38, -h + 54, 76, 76);
}

function drawBuilding(building) {
  if (building.dead) return;
  const faction = FACTIONS[building.faction];
  drawSelectionGlow(building, faction.accent);
  const progress = building.completed ? 1 : Math.max(0.18, building.buildProgress);

  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.32)';
  ctx.beginPath();
  ctx.ellipse(building.x, building.y + 3, building.width * 0.52, 14, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = progress;
  ctx.translate(building.x, building.y);
  ctx.shadowColor = '#241a13';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 3;
  ctx.shadowOffsetY = 3;
  ctx.lineJoin = 'round';
  const dir = building.side === 'player' ? 1 : -1;
  const depthScale = 0.82 + clamp((building.y - WORLD.battlefieldFarY) / (WORLD.battlefieldNearY - WORLD.battlefieldFarY), 0, 1) * 0.24;
  ctx.scale(dir * depthScale, depthScale);

  if (building.type === 'mine') {
    if (building.faction === 'knight') drawKnightMine(building);
    else if (building.faction === 'skeleton') drawSkeletonMine(building);
    else if (building.faction === 'arcane') drawArcaneMine(building);
    else drawSpecialMine(building);
  } else if (building.type === 'barracks') {
    if (building.faction === 'knight') drawKnightBarracks(building);
    else if (building.faction === 'skeleton') drawSkeletonBarracks(building);
    else if (building.faction === 'arcane') drawArcaneBarracks(building);
    else drawSpecialBarracks(building);
  } else if (building.type === 'tower') {
    if (building.faction === 'knight') drawKnightTower(building);
    else if (building.faction === 'skeleton') drawSkeletonTower(building);
    else if (building.faction === 'arcane') drawArcaneTower(building);
    else drawSpecialTower(building);
  }
  drawBuildingDecor(building);

  ctx.globalAlpha = 1;
  if (!building.completed) {
    ctx.strokeStyle = 'rgba(240, 208, 141, 0.55)';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(-building.width * 0.52, -building.height, building.width * 1.04, building.height);
    ctx.setLineDash([]);
  }
  ctx.restore();

  drawBuildingLabel(building, faction.accent);
  drawBuildingHealth(building);
}

function drawKnightMine(building) {
  const h = building.height;
  ctx.strokeStyle = '#8c6d49';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(-30, 0);
  ctx.lineTo(-19, -h + 18);
  ctx.lineTo(29, -h + 18);
  ctx.lineTo(24, 0);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-30, -h * 0.55);
  ctx.lineTo(28, -h * 0.55);
  ctx.moveTo(0, -h + 18);
  ctx.lineTo(0, -h * 0.55);
  ctx.stroke();

  ctx.fillStyle = '#59616a';
  ctx.beginPath();
  ctx.moveTo(-34, -h * 0.42);
  ctx.lineTo(34, -h * 0.42);
  ctx.lineTo(22, 0);
  ctx.lineTo(-22, 0);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = '#c4ab72';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(0, -h * 0.27, 19, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-19, -h * 0.27);
  ctx.lineTo(19, -h * 0.27);
  ctx.moveTo(0, -h * 0.27 - 19);
  ctx.lineTo(0, -h * 0.27 + 19);
  ctx.stroke();

  ctx.fillStyle = '#d8b867';
  ctx.beginPath();
  ctx.arc(24, -h + 11, 5, 0, Math.PI * 2);
  ctx.fill();
}

function drawSkeletonMine(building) {
  const h = building.height;
  ctx.fillStyle = '#262132';
  ctx.beginPath();
  ctx.ellipse(0, -10, 38, 16, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#8c8195';
  roundRectPath(-27, -h + 22, 54, h - 30, 12);
  ctx.fill();
  ctx.fillStyle = '#645b73';
  roundRectPath(-21, -h + 33, 42, h - 46, 8);
  ctx.fill();

  ctx.strokeStyle = '#c7b7d6';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, -h + 58);
  ctx.lineTo(0, -h + 92);
  ctx.moveTo(-12, -h + 70);
  ctx.lineTo(12, -h + 82);
  ctx.moveTo(12, -h + 70);
  ctx.lineTo(-12, -h + 82);
  ctx.stroke();

  const glow = ctx.createRadialGradient(0, -h + 6, 1, 0, -h + 6, 30);
  glow.addColorStop(0, 'rgba(125, 238, 202, 0.68)');
  glow.addColorStop(1, 'rgba(125, 238, 202, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(-35, -h - 25, 70, 70);
  ctx.fillStyle = '#8df1cf';
  ctx.beginPath();
  ctx.arc(0, -h + 10, 4, 0, Math.PI * 2);
  ctx.fill();
}

function drawKnightBarracks(building) {
  const h = building.height;
  ctx.fillStyle = '#555f6d';
  ctx.beginPath();
  ctx.moveTo(-50, 0);
  ctx.lineTo(-45, -h + 57);
  ctx.lineTo(0, -h + 20);
  ctx.lineTo(46, -h + 57);
  ctx.lineTo(51, 0);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#768294';
  ctx.beginPath();
  ctx.moveTo(-59, -h + 62);
  ctx.lineTo(0, -h + 8);
  ctx.lineTo(60, -h + 62);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#263141';
  ctx.fillRect(-14, -45, 28, 45);
  ctx.beginPath();
  ctx.arc(0, -45, 14, Math.PI, 0);
  ctx.fill();

  ctx.strokeStyle = '#b7a36f';
  ctx.lineWidth = 2;
  ctx.strokeRect(-37, -h + 72, 74, 29);
  ctx.fillStyle = '#65a7ee';
  ctx.beginPath();
  ctx.moveTo(32, -h + 66);
  ctx.lineTo(32, -h + 124);
  ctx.lineTo(58, -h + 112);
  ctx.lineTo(32, -h + 100);
  ctx.closePath();
  ctx.fill();
}

function drawSkeletonBarracks(building) {
  const h = building.height;
  ctx.fillStyle = '#2d253b';
  ctx.beginPath();
  ctx.ellipse(0, -h + 44, 58, h * 0.66, 0, Math.PI, 0);
  ctx.lineTo(54, 0);
  ctx.lineTo(-54, 0);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#17131f';
  ctx.beginPath();
  ctx.arc(0, -40, 22, Math.PI, 0);
  ctx.lineTo(22, 0);
  ctx.lineTo(-22, 0);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = '#8b7aa4';
  ctx.lineWidth = 4;
  for (let i = -2; i <= 2; i += 1) {
    ctx.beginPath();
    ctx.moveTo(i * 20, -h + 50);
    ctx.lineTo(i * 14 + 12, -h + 6);
    ctx.stroke();
  }

  ctx.fillStyle = '#c9b7dc';
  ctx.beginPath();
  ctx.arc(0, -h + 42, 16, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2a2035';
  ctx.beginPath();
  ctx.ellipse(-5, -h + 40, 3.5, 5, 0, 0, Math.PI * 2);
  ctx.ellipse(5, -h + 40, 3.5, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(123, 239, 201, 0.7)';
  ctx.beginPath();
  ctx.arc(0, -h + 72, 4, 0, Math.PI * 2);
  ctx.fill();
}

function drawKnightTower(building) {
  const h = building.height;
  ctx.fillStyle = '#535e6c';
  ctx.beginPath();
  ctx.moveTo(-26, 0);
  ctx.lineTo(-21, -h + 31);
  ctx.lineTo(21, -h + 31);
  ctx.lineTo(26, 0);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#707c8e';
  ctx.fillRect(-34, -h + 22, 68, 14);
  ctx.fillRect(-20, -h + 8, 8, 20);
  ctx.fillRect(12, -h + 8, 8, 20);

  ctx.fillStyle = '#3a414b';
  ctx.fillRect(-16, -h + 47, 32, 26);
  ctx.strokeStyle = '#e3bf65';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-6, -h + 58);
  ctx.lineTo(18, -h + 50);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(13, -h + 52, 8, -0.8, 1.2);
  ctx.stroke();

  if (building.level >= 2) {
    ctx.fillStyle = '#8aa8d4';
    ctx.fillRect(-30, -h + 41, 9, 8);
  }
  if (building.level >= 3) {
    ctx.fillStyle = '#f1c76b';
    ctx.beginPath();
    ctx.arc(0, -h + 4, 5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawSkeletonTower(building) {
  const h = building.height;
  ctx.strokeStyle = '#7a688e';
  ctx.lineWidth = 12;
  ctx.beginPath();
  ctx.moveTo(-12, 0);
  ctx.quadraticCurveTo(-26, -h * 0.5, -8, -h + 22);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(12, 0);
  ctx.quadraticCurveTo(24, -h * 0.48, 10, -h + 22);
  ctx.stroke();
  ctx.lineWidth = 7;
  for (let y = -h + 50; y < -20; y += 28) {
    ctx.beginPath();
    ctx.moveTo(-18, y);
    ctx.lineTo(18, y - 5);
    ctx.stroke();
  }

  ctx.fillStyle = '#c6b4d8';
  ctx.beginPath();
  ctx.arc(0, -h + 25, 17, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2a2035';
  ctx.beginPath();
  ctx.ellipse(-6, -h + 23, 4, 6, 0, 0, Math.PI * 2);
  ctx.ellipse(6, -h + 23, 4, 6, 0, 0, Math.PI * 2);
  ctx.fill();

  const glow = ctx.createRadialGradient(0, -h + 10, 2, 0, -h + 10, 28);
  glow.addColorStop(0, 'rgba(118, 239, 201, 0.55)');
  glow.addColorStop(1, 'rgba(118, 239, 201, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(-30, -h - 20, 60, 60);
}

function drawArcaneBase(base) {
  const h = base.height;
  ctx.fillStyle = '#302640';
  ctx.strokeStyle = '#211828';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-52, 0);
  ctx.lineTo(-30, -h + 70);
  ctx.lineTo(-8, -h + 28);
  ctx.lineTo(16, -h + 12);
  ctx.lineTo(43, -h + 58);
  ctx.lineTo(56, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#58406e';
  ctx.beginPath();
  ctx.moveTo(0, -h + 54);
  ctx.lineTo(25, -h + 92);
  ctx.lineTo(5, -h + 132);
  ctx.lineTo(-24, -h + 92);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#d88cff';
  ctx.beginPath();
  ctx.moveTo(0, -h + 68);
  ctx.lineTo(12, -h + 92);
  ctx.lineTo(0, -h + 115);
  ctx.lineTo(-12, -h + 92);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(136, 255, 220, 0.8)';
  ctx.beginPath();
  ctx.arc(0, -h + 91, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#8fe8d0';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, -h + 92, 24, 0, Math.PI * 2);
  ctx.stroke();
}

function drawSpecialBase(base) {
  const h = base.height;
  ctx.fillStyle = '#43534a';
  ctx.strokeStyle = '#241a13';
  ctx.lineWidth = 3;
  roundRectPath(-58, -h + 72, 116, h - 72, 9);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#5e7366';
  roundRectPath(-49, -h + 86, 98, 52, 6);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#26362e';
  ctx.fillRect(-17, -48, 34, 48);
  ctx.beginPath();
  ctx.arc(0, -48, 17, Math.PI, 0);
  ctx.fill();
  ctx.strokeStyle = '#92a89a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, -h + 78);
  ctx.lineTo(0, -h + 20);
  ctx.moveTo(-18, -h + 50);
  ctx.lineTo(18, -h + 50);
  ctx.stroke();
  ctx.fillStyle = '#e5b74d';
  ctx.beginPath();
  ctx.moveTo(36, -h + 75);
  ctx.lineTo(36, -h + 133);
  ctx.lineTo(64, -h + 119);
  ctx.lineTo(36, -h + 105);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#768c7c';
  for (let x = -44; x <= 44; x += 22) {
    ctx.beginPath();
    ctx.ellipse(x, -8, 13, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

function drawArcaneMine(building) {
  const h = building.height;
  ctx.fillStyle = '#33263f';
  ctx.strokeStyle = '#211828';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-30, 0);
  ctx.lineTo(-18, -h + 52);
  ctx.lineTo(0, -h + 32);
  ctx.lineTo(19, -h + 54);
  ctx.lineTo(30, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#9b69b8';
  ctx.beginPath();
  ctx.moveTo(0, -h + 9);
  ctx.lineTo(18, -h + 41);
  ctx.lineTo(0, -h + 72);
  ctx.lineTo(-18, -h + 41);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#e8a8ff';
  ctx.beginPath();
  ctx.arc(0, -h + 40, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(141, 255, 221, 0.7)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, -h + 40, 23, 0, Math.PI * 2);
  ctx.stroke();
}

function drawSpecialMine(building) {
  const h = building.height;
  ctx.fillStyle = '#56675d';
  ctx.strokeStyle = '#241a13';
  ctx.lineWidth = 3;
  roundRectPath(-38, -20, 76, 20, 4);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = '#3f5148';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(-28, -18);
  ctx.lineTo(-12, -h + 20);
  ctx.lineTo(12, -h + 20);
  ctx.lineTo(28, -18);
  ctx.moveTo(-19, -h * 0.58);
  ctx.lineTo(19, -h * 0.58);
  ctx.moveTo(0, -h + 20);
  ctx.lineTo(0, -h * 0.58);
  ctx.stroke();
  ctx.fillStyle = '#96a59c';
  ctx.beginPath();
  ctx.arc(0, -h * 0.58, 17, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#241a13';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-17, -h * 0.58);
  ctx.lineTo(17, -h * 0.58);
  ctx.moveTo(0, -h * 0.58 - 17);
  ctx.lineTo(0, -h * 0.58 + 17);
  ctx.stroke();
  ctx.fillStyle = '#e6b84d';
  ctx.beginPath();
  ctx.arc(25, -h + 16, 4, 0, Math.PI * 2);
  ctx.fill();
}

function drawArcaneBarracks(building) {
  const h = building.height;
  ctx.fillStyle = '#2e253b';
  ctx.strokeStyle = '#211828';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(0, -12, 54, 23, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = '#9b77bf';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(0, -h * 0.55, 35, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = '#6fd7c2';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, -h * 0.55, 45, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#8b5cab';
  ctx.beginPath();
  ctx.moveTo(-27, 0);
  ctx.lineTo(-21, -h * 0.38);
  ctx.lineTo(0, -h * 0.25);
  ctx.lineTo(21, -h * 0.38);
  ctx.lineTo(27, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#d899ff';
  ctx.beginPath();
  ctx.moveTo(0, -h * 0.36);
  ctx.lineTo(13, -h * 0.5);
  ctx.lineTo(0, -h * 0.64);
  ctx.lineTo(-13, -h * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

function drawSpecialBarracks(building) {
  const h = building.height;
  ctx.fillStyle = '#4b6253';
  ctx.strokeStyle = '#241a13';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-52, 0);
  ctx.lineTo(-45, -h * 0.52);
  ctx.lineTo(0, -h * 0.78);
  ctx.lineTo(45, -h * 0.52);
  ctx.lineTo(52, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#738b79';
  ctx.beginPath();
  ctx.moveTo(-57, -h * 0.47);
  ctx.lineTo(0, -h * 0.84);
  ctx.lineTo(57, -h * 0.47);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#26342c';
  ctx.fillRect(-14, -40, 28, 40);
  ctx.strokeStyle = '#a8b8aa';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(24, -h * 0.58);
  ctx.lineTo(24, -h + 16);
  ctx.moveTo(14, -h * 0.58);
  ctx.lineTo(34, -h * 0.58);
  ctx.stroke();
  ctx.fillStyle = '#e6b84d';
  ctx.beginPath();
  ctx.arc(24, -h + 13, 4, 0, Math.PI * 2);
  ctx.fill();
}

function drawArcaneTower(building) {
  const h = building.height;
  ctx.fillStyle = '#392b48';
  ctx.strokeStyle = '#211828';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-24, 0);
  ctx.lineTo(-14, -h + 35);
  ctx.lineTo(0, -h + 7);
  ctx.lineTo(15, -h + 38);
  ctx.lineTo(24, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#ad78ca';
  ctx.beginPath();
  ctx.moveTo(0, -h + 22);
  ctx.lineTo(14, -h + 55);
  ctx.lineTo(0, -h + 92);
  ctx.lineTo(-14, -h + 55);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(124, 241, 210, 0.8)';
  ctx.beginPath();
  ctx.arc(0, -h + 57, 5, 0, Math.PI * 2);
  ctx.fill();
}

function drawSpecialTower(building) {
  const h = building.height;
  ctx.fillStyle = '#52645a';
  ctx.strokeStyle = '#241a13';
  ctx.lineWidth = 3;
  roundRectPath(-27, -h * 0.6, 54, 52, 6);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#38473f';
  ctx.fillRect(-18, -h * 0.43, 36, 18);
  ctx.strokeStyle = '#2b3831';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(-18, 0);
  ctx.lineTo(-12, -h * 0.6);
  ctx.moveTo(18, 0);
  ctx.lineTo(12, -h * 0.6);
  ctx.stroke();
  ctx.fillStyle = '#1e2b25';
  roundRectPath(-16, -h * 0.72, 38, 16, 5);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = '#d3ddcf';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(16, -h * 0.67);
  ctx.lineTo(49, -h * 0.67);
  ctx.stroke();
  ctx.fillStyle = '#e6b84d';
  ctx.beginPath();
  ctx.arc(0, -h * 0.6, 4, 0, Math.PI * 2);
  ctx.fill();
}

function drawBuildingDecor(building) {
  if (building.isBase) return;
  const def = BUILDING_DEFS[building.type];
  if (!def) return;
  const teamColor = FACTIONS[building.faction]?.color || '#e9c36b';
  const h = building.height;

  ctx.save();
  ctx.fillStyle = '#f0c96d';
  ctx.strokeStyle = '#241a13';
  ctx.lineWidth = 1.5;
  for (let index = 0; index < building.level; index += 1) {
    const x = -12 + index * 12;
    ctx.beginPath();
    ctx.moveTo(x, -h + 9);
    ctx.lineTo(x + 4, -h + 14);
    ctx.lineTo(x, -h + 19);
    ctx.lineTo(x - 4, -h + 14);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  const poleX = building.width * 0.32;
  const poleTop = -h + 42;
  ctx.strokeStyle = '#4b3727';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(poleX, -12);
  ctx.lineTo(poleX, poleTop);
  ctx.stroke();
  ctx.fillStyle = teamColor;
  ctx.strokeStyle = '#241a13';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(poleX, poleTop);
  ctx.lineTo(poleX + 24, poleTop + 7);
  ctx.lineTo(poleX, poleTop + 15);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = 'rgba(255, 245, 209, 0.28)';
  ctx.beginPath();
  ctx.ellipse(-building.width * 0.28, -h * 0.55, 8, 13, -0.25, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBuildingLabel(building, color) {
  if (selectedBuilding !== building) return;
  const label = building.isBase ? building.name : `${building.name} Lv.${building.level}`;
  ctx.save();
  ctx.font = '900 11px "Microsoft YaHei UI", sans-serif';
  const width = ctx.measureText(label).width + 16;
  fillRoundRect(building.x - width / 2, building.y - building.height - 32, width, 20, 4, '#fff0c9');
  strokeRoundRect(building.x - width / 2, building.y - building.height - 32, width, 20, 4, '#241a13', 2);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#241a13';
  ctx.fillText(label, building.x, building.y - building.height - 18);
  ctx.restore();
}
function drawBuildingHealth(building) {
  if (building.hp >= building.maxHp && selectedBuilding !== building) return;
  const width = Math.max(44, Math.min(94, building.width * 0.86));
  drawHealthBar(
    building.x - width / 2,
    building.y - building.height - 12,
    width,
    clamp(building.hp / building.maxHp, 0, 1),
    building.faction === 'knight' ? '#79b5ff' : '#bd8fff',
  );
}

function drawHealthBar(x, y, width, ratio, color) {
  fillRoundRect(x, y, width, 8, 4, '#241a13');
  if (ratio > 0) fillRoundRect(x + 2, y + 2, Math.max(1, (width - 4) * ratio), 4, 2, color);
  fillRoundRect(x + 3, y + 2, Math.max(1, (width - 6) * ratio), 1.5, 1, 'rgba(255, 245, 207, 0.55)');
}
function smoothStep(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function attackProgress(unit) {
  if (!unit.attackTimer || !unit.attackDuration) return 0;
  return clamp(1 - unit.attackTimer / unit.attackDuration, 0, 1);
}

function attackSwingCurve(unit) {
  const p = attackProgress(unit);
  if (p <= 0) return 0;
  if (p < 0.28) return lerp(0, -0.9, smoothStep(p / 0.28));
  if (p < 0.56) return lerp(-0.9, 1.15, smoothStep((p - 0.28) / 0.28));
  return lerp(1.15, 0, smoothStep((p - 0.56) / 0.44));
}

function attackPulse(unit) {
  const p = attackProgress(unit);
  return p > 0 ? Math.sin(p * Math.PI) : 0;
}

function idleBreath(unit, time) {
  return Math.sin(time * 2.1 + unit.bobSeed) * (1 - unit.moveBlend) * 0.9;
}

function getHumanoidHandAnchor(unit, scale = 1, rear = false) {
  const phase = unit.walkPhase;
  const move = unit.moveBlend;
  const swingPose = attackSwingCurve(unit);
  const strikePose = attackPulse(unit);
  const worldFacing = unit.side === 'player' ? 1 : -1;
  const lean = clamp((unit.moveDirX ?? 1) * worldFacing, -1, 1) * 0.045 * move;
  const bodyAngle = lean + clamp(swingPose, -0.9, 1.15) * 0.035;
  const stanceDrop = Math.abs(Math.sin(phase)) * 0.75 * move + strikePose * 0.85;
  const offset = rear ? Math.PI : 0;
  const armSwing = Math.sin(phase + offset) * (rear ? 5.5 : 3.2) * move;
  const shoulderX = rear ? -9.5 : 9.5;
  const actionReach = strikePose * (rear ? -2.2 : 6.2);
  const handX = shoulderX + (rear ? -6.5 : 7.5) + armSwing + actionReach;
  const handY = -29 + Math.sin(phase + offset + 0.5) * 1.8 * move;
  const cos = Math.cos(bodyAngle);
  const sin = Math.sin(bodyAngle);
  return {
    x: scale * (cos * handX - sin * handY),
    y: scale * (sin * handX + cos * handY + stanceDrop),
    angle: bodyAngle,
  };
}

function getSkeletonHandAnchor(unit, rear = false) {
  const phase = unit.walkPhase;
  const move = unit.moveBlend;
  const offset = rear ? Math.PI : 0;
  const armSwing = Math.sin(phase + offset) * (rear ? 5 : 3.2) * move;
  const attackReach = attackPulse(unit) * (rear ? -2 : 5.5);
  const handX = (rear ? -8 : 8) + (rear ? -7 : 6.5) + armSwing + attackReach;
  const handY = -30 + Math.sin(phase + offset) * 1.7 * move;
  return { x: handX, y: handY, angle: 0 };
}

function drawGripHand(radius = 2.8, color = '#d6b89e') {
  ctx.fillStyle = color;
  ctx.strokeStyle = '#241a13';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}
function drawUnit(unit, time) {
  if (unit.dead) return;
  const def = unit.def;
  const selected = selectedUnits.includes(unit);
  const facing = unit.side === 'player' ? 1 : -1;
  const stepBob = (Math.abs(Math.sin(unit.walkPhase)) * 2.3 + (unit.stepImpact || 0) * 3.2) * unit.moveBlend;
  const bob = def.flying ? Math.sin(time * 2.6 + unit.bobSeed) * 4 : idleBreath(unit, time) + stepBob;
  const down = unit.downTimer > 0;
  const hitRecoil = down ? 0 : clamp(unit.hitStun / (unit.hitStunMax || 0.12), 0, 1);

  if (selected) {
    ctx.save();
    ctx.strokeStyle = 'rgba(241, 204, 113, 0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(unit.x, unit.y - 1, def.radius + 9, 7, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  if (unit.commandFlash > 0) {
    ctx.save();
    ctx.globalAlpha = unit.commandFlash / 0.65 * 0.28;
    ctx.fillStyle = COMMANDS[unit.command].color;
    ctx.beginPath();
    ctx.arc(unit.x, unit.y - (def.flying ? 172 : 25), def.radius + 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  ctx.fillStyle = def.flying ? 'rgba(36, 26, 19, 0.2)' : 'rgba(36, 26, 19, 0.28)';
  ctx.beginPath();
  const shadowStretch = 0.9 + unit.moveBlend * 0.16 + (unit.stepImpact || 0) * 0.7;
  ctx.ellipse(unit.x, unit.y + 1, def.flying ? 31 : def.radius * shadowStretch, def.flying ? 7 : 4.6, 0, 0, Math.PI * 2);
  ctx.fill();
  if (!def.flying && unit.stepImpact > 0) {
    ctx.globalAlpha = unit.stepImpact * 2.2;
    ctx.strokeStyle = '#8c7653';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(unit.x, unit.y + 1, def.radius * (1.05 + (1 - unit.stepImpact / 0.17) * 0.3), 5.5, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();

  ctx.save();
  const lunge = unit.def.damageType === 'melee' ? attackPulse(unit) * 5 : 0;
  const visualY = unit.y - (def.flying ? 150 : 0);
  ctx.translate(unit.x + facing * lunge, visualY + bob);
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (down) {
    ctx.translate(0, -2);
    ctx.rotate(unit.side === 'player' ? -1.16 : 1.16);
    ctx.translate(-6, -4);
  } else if (hitRecoil > 0) {
    const localDirection = unit.hitDir * facing;
    ctx.rotate(localDirection * hitRecoil * 0.13);
    ctx.translate(-localDirection * hitRecoil * 2.2, -hitRecoil * 1.4);
  }
  const depthScale = 0.88 + clamp((unit.y - WORLD.battlefieldFarY) / (WORLD.battlefieldNearY - WORLD.battlefieldFarY), 0, 1) * 0.26;
  ctx.scale(facing * depthScale * (1 - hitRecoil * 0.035), depthScale * (1 + hitRecoil * 0.025));
  if (unit.revived) ctx.globalAlpha = 0.92;

  switch (def.drawType) {
    case 'sword':
      drawSwordKnight(unit, time);
      break;
    case 'shield':
      drawShieldKnight(unit, time);
      break;
    case 'lightHorse':
      drawCavalry(unit, time, false);
      break;
    case 'heavyHorse':
      drawCavalry(unit, time, true);
      break;
    case 'gunner':
      drawGunner(unit, time);
      break;
    case 'paladin':
      drawPaladin(unit, time);
      break;
    case 'boneSoldier':
      drawBoneSoldier(unit, time);
      break;
    case 'boneDog':
      drawBoneDog(unit, time);
      break;
    case 'shaman':
      drawBoneShaman(unit, time);
      break;
    case 'boneGiant':
      drawBoneGiant(unit, time);
      break;
    case 'boneDragon':
      drawBoneDragon(unit, time);
      break;
    case 'warlock':
      drawWarlock(unit, time);
      break;
    case 'wizard':
      drawWizard(unit, time);
      break;
    case 'occultist':
      drawOccultist(unit, time);
      break;
    case 'hera':
      drawHera(unit, time);
      break;
    case 'ancientBeast':
      drawAncientBeast(unit, time);
      break;
    case 'soulSword':
      drawSoulSwordsman(unit, time);
      break;
    case 'swat':
      drawSwat(unit, time);
      break;
    case 'riotPolice':
      drawRiotPolice(unit, time);
      break;
    case 'specialForces':
      drawSpecialForces(unit, time);
      break;
    case 'tank':
      drawTank(unit, time);
      break;
    case 'helicopter':
      drawHelicopter(unit, time);
      break;
    default:
      break;
  }

  if (unit.hitFlash > 0) {
    const flash = clamp(unit.hitFlash / 0.15, 0, 1);
    ctx.save();
    ctx.globalAlpha = flash * 0.5;
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = '#fff3cf';
    ctx.beginPath();
    ctx.ellipse(0, -34, Math.max(12, def.radius * 1.3), Math.max(23, def.radius * 2.1), 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();

  drawUnitOverlay(unit, selected, down);
}

function drawUnitOverlay(unit, selected, down) {
  const def = unit.def;
  const visualY = unit.y - (def.flying ? 150 : 0);
  const width = def.flying ? 62 : Math.max(32, def.radius * 2.5);
  if (unit.hp < unit.maxHp || selected) {
    drawHealthBar(unit.x - width / 2, visualY - 70, width, clamp(unit.hp / unit.maxHp, 0, 1), unit.side === 'player' ? '#6eafff' : '#bd8fff');
  }

  if (selected) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.font = '800 9px "Microsoft YaHei UI", sans-serif';
    fillRoundRect(unit.x - 20, visualY - 91, 40, 16, 4, '#fff0c9');
    strokeRoundRect(unit.x - 20, visualY - 91, 40, 16, 4, '#241a13', 2);
    ctx.fillStyle = COMMANDS[unit.command].color;
    ctx.fillText(`M${def.mass} · ${COMMANDS[unit.command].label}`, unit.x, visualY - 78);
    ctx.restore();
  }

  if (down) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffe6a4';
    ctx.font = '800 10px "Microsoft YaHei UI", sans-serif';
    ctx.fillText('倒地', unit.x, visualY - 64);
    ctx.restore();
  }

  if (unit.revived) {
    ctx.save();
    ctx.globalAlpha = 0.5 + Math.sin(performance.now() * 0.007) * 0.2;
    ctx.strokeStyle = '#78efc9';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.ellipse(unit.x, unit.y - 1, def.radius + 3, 4, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

function drawHumanoidBase(colors, unit, scale = 1) {
  ctx.save();
  ctx.scale(scale, scale);

  const phase = unit.walkPhase;
  const move = unit.moveBlend;
  const ink = '#21170f';
  const teamColor = FACTIONS[unit.faction]?.color || colors.armor;
  const worldFacing = unit.side === 'player' ? 1 : -1;
  const lean = clamp((unit.moveDirX ?? 1) * worldFacing, -1, 1) * 0.045 * move;
  const swingPose = attackSwingCurve(unit);
  const strikePose = attackPulse(unit);
  const stanceDrop = Math.abs(Math.sin(phase)) * 0.75 * move + strikePose * 0.85;
  ctx.translate(0, stanceDrop);
  ctx.rotate(lean + clamp(swingPose, -0.9, 1.15) * 0.035);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  function drawLeg(offset, rear) {
    const swing = Math.sin(phase + offset) * 8.5 * move;
    const lift = Math.max(0, Math.cos(phase + offset)) * 3.2 * move;
    const hipX = rear ? -3.2 : 3.2;
    const attackBrace = strikePose * (rear ? -2.4 : 3.8);
    const footX = hipX + swing + attackBrace;
    const footY = -2 - lift;
    const kneeX = (hipX + footX) * 0.5 + (rear ? 0.8 : 3.2) * move;
    const kneeY = (hipX * 0 + -23 + footY) * 0.5 - 0.6 * move;

    ctx.globalAlpha = rear ? 0.78 : 1;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(hipX, -23);
    ctx.quadraticCurveTo(kneeX + 1, kneeY, footX, footY);
    ctx.lineTo(footX + 4.5, footY);
    ctx.stroke();

    ctx.strokeStyle = colors.legs || '#303947';
    ctx.lineWidth = 3.8;
    ctx.beginPath();
    ctx.moveTo(hipX, -23);
    ctx.quadraticCurveTo(kneeX + 1, kneeY, footX, footY);
    ctx.lineTo(footX + 3.5, footY);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 244, 210, 0.26)';
    ctx.lineWidth = 1.15;
    ctx.beginPath();
    ctx.moveTo(hipX + 1.2, -22);
    ctx.quadraticCurveTo(kneeX + 1.5, kneeY - 1, footX + 1, footY - 0.5);
    ctx.stroke();

    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.ellipse(footX + 2, footY + 0.2, 4.8, 2.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function drawArm(offset, rear) {
    const armSwing = Math.sin(phase + offset) * (rear ? 5.5 : 3.2) * move;
    const shoulderX = rear ? -9.5 : 9.5;
    const actionReach = strikePose * (rear ? -2.2 : 6.2);
    const elbowX = shoulderX + (rear ? -2 : 2.5) + armSwing * 0.45 + actionReach * 0.55;
    const handX = shoulderX + (rear ? -6.5 : 7.5) + armSwing + actionReach;
    const elbowY = -35 + Math.abs(armSwing) * 0.08;
    const handY = -29 + Math.sin(phase + offset + 0.5) * 1.8 * move;

    ctx.globalAlpha = rear ? 0.72 : 1;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 6.2;
    ctx.beginPath();
    ctx.moveTo(shoulderX, -44);
    ctx.lineTo(elbowX, elbowY);
    ctx.lineTo(handX, handY);
    ctx.stroke();

    ctx.strokeStyle = colors.body || colors.armor;
    ctx.lineWidth = 3.2;
    ctx.beginPath();
    ctx.moveTo(shoulderX, -44);
    ctx.lineTo(elbowX, elbowY);
    ctx.lineTo(handX, handY);
    ctx.stroke();

    ctx.fillStyle = colors.skin;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(handX, handY, 2.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  drawArm(Math.PI, true);
  drawLeg(Math.PI, true);

  const clothWave = Math.sin(phase + 0.8) * 2.2 * move;
  ctx.fillStyle = teamColor;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-8, -49);
  ctx.quadraticCurveTo(-17 - clothWave, -43, -13 - clothWave * 1.4, -32);
  ctx.lineTo(-6, -37);
  ctx.lineTo(-4, -47);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = colors.body || colors.armor;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2.7;
  ctx.beginPath();
  ctx.moveTo(-12, -50);
  ctx.quadraticCurveTo(-16, -43, -11, -27);
  ctx.lineTo(-5, -24);
  ctx.lineTo(6, -24);
  ctx.lineTo(12, -28);
  ctx.quadraticCurveTo(15, -43, 11, -50);
  ctx.lineTo(5, -54);
  ctx.lineTo(-6, -54);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = colors.armor;
  ctx.beginPath();
  ctx.moveTo(-9, -49);
  ctx.lineTo(3, -52);
  ctx.lineTo(12, -46);
  ctx.lineTo(9, -31);
  ctx.lineTo(1, -27);
  ctx.lineTo(-8, -31);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.beginPath();
  ctx.moveTo(-8, -47);
  ctx.lineTo(2, -49);
  ctx.lineTo(7, -45);
  ctx.lineTo(-1, -42);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = teamColor;
  ctx.lineWidth = 3.2;
  ctx.beginPath();
  ctx.moveTo(-9, -46);
  ctx.lineTo(7, -32);
  ctx.stroke();

  ctx.fillStyle = '#3a2a20';
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.4;
  fillRoundRect(-9.5, -29.5, 19, 4.2, 1.5, '#3a2a20');
  ctx.strokeRect(-9.5, -29.5, 19, 4.2);
  ctx.fillStyle = '#d9b45f';
  ctx.fillRect(-2, -29.5, 4, 4.2);

  ctx.fillStyle = colors.armor;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(-10.5, -45, 5.2, 0, Math.PI * 2);
  ctx.arc(10.5, -45, 5.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.25)';
  ctx.beginPath();
  ctx.arc(-11.5, -46.5, 2.3, Math.PI, Math.PI * 2);
  ctx.arc(9.5, -46.5, 2.3, Math.PI, Math.PI * 2);
  ctx.fill();

  drawLeg(0, false);
  drawArm(0, false);

  ctx.fillStyle = colors.skin;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.ellipse(0.5, -61, 8.7, 9.2, -0.03, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.beginPath();
  ctx.ellipse(3.7, -62, 3.5, 4.8, -0.25, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = colors.helmet;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2.3;
  ctx.beginPath();
  ctx.moveTo(-9.5, -63);
  ctx.quadraticCurveTo(-8, -73, 0, -73);
  ctx.quadraticCurveTo(9, -72, 10.5, -62);
  ctx.lineTo(8, -58);
  ctx.lineTo(-8, -58);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = colors.visor || '#18212a';
  ctx.fillRect(-8, -65.5, 16, 3.4);
  ctx.fillStyle = '#e8ddb8';
  ctx.fillRect(2.5, -65, 4.5, 2.1);
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.arc(4.5, -63.9, 1.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(8, -61.5);
  ctx.lineTo(3, -60.2);
  ctx.stroke();

  ctx.fillStyle = teamColor;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(-3, -71);
  ctx.quadraticCurveTo(-12 - clothWave * 0.4, -80, 1, -81);
  ctx.quadraticCurveTo(7, -80, 4, -70);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.32)';
  ctx.beginPath();
  ctx.moveTo(-4, -70);
  ctx.lineTo(1, -76);
  ctx.lineTo(4, -70);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}
function drawSwordKnight(unit, time) {
  const colors = { body: '#4c6b96', armor: '#8fa5be', legs: '#313b4a', skin: '#d6b89e', helmet: '#748ba3', visor: '#182330' };
  drawHumanoidBase(colors, unit);
  const grip = getHumanoidHandAnchor(unit);
  const swing = attackSwingCurve(unit);
  const attack = 0.18 + swing;
  const pulse = attackPulse(unit);

  if (pulse > 0.12) {
    ctx.save();
    ctx.translate(grip.x, grip.y);
    ctx.rotate(grip.angle);
    ctx.globalAlpha = pulse * 0.34;
    ctx.strokeStyle = '#fff0b0';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(5, 0, 39, -1.05, 0.42);
    ctx.stroke();
    ctx.restore();
  }

  ctx.save();
  ctx.translate(grip.x, grip.y);
  ctx.rotate(grip.angle + attack);
  ctx.strokeStyle = '#3f2819';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(-6, 0);
  ctx.lineTo(4, 0);
  ctx.stroke();
  ctx.fillStyle = '#d5ad55';
  ctx.strokeStyle = '#241a13';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(-6, 0, 2.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = '#241a13';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(4, 0);
  ctx.lineTo(39, 0);
  ctx.stroke();
  ctx.strokeStyle = '#eef2f5';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(4, 0);
  ctx.lineTo(39, 0);
  ctx.stroke();
  ctx.strokeStyle = '#e9c36b';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(4, -8);
  ctx.lineTo(4, 8);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.72)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(8, -1.2);
  ctx.lineTo(35, -1.2);
  ctx.stroke();
  drawGripHand(3, colors.skin);
  ctx.restore();
}
function drawShieldKnight(unit, time) {
  const colors = { body: '#3d587d', armor: '#b1c0d1', legs: '#293241', skin: '#d8b99d', helmet: '#7e91a6', visor: '#121c27' };
  drawHumanoidBase(colors, unit, 1.06);
  const grip = getHumanoidHandAnchor(unit, 1.06);
  const brace = Math.sin(unit.walkPhase) * 0.05 * unit.moveBlend + attackPulse(unit) * 0.12;
  const swing = attackSwingCurve(unit);

  ctx.save();
  ctx.translate(grip.x, grip.y);
  ctx.rotate(grip.angle - 0.08 + brace);
  ctx.fillStyle = '#3e78bd';
  ctx.strokeStyle = '#241a13';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(1, -15);
  ctx.lineTo(15, -10);
  ctx.lineTo(16, 10);
  ctx.quadraticCurveTo(8, 20, 1, 13);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = '#e9c36b';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(8, -9);
  ctx.lineTo(8, 9);
  ctx.moveTo(3, 0);
  ctx.lineTo(13, 0);
  ctx.stroke();
  drawGripHand(3.2, colors.skin);
  ctx.restore();

  ctx.save();
  ctx.translate(grip.x + 1, grip.y + 2);
  ctx.rotate(grip.angle - 0.55 + swing * 0.8);
  ctx.strokeStyle = '#241a13';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(-4, 0);
  ctx.lineTo(4, 0);
  ctx.stroke();
  ctx.strokeStyle = '#eef2f5';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(4, 0);
  ctx.lineTo(38, 0);
  ctx.stroke();
  ctx.strokeStyle = '#e9c36b';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(4, -5);
  ctx.lineTo(4, 5);
  ctx.stroke();
  ctx.restore();
}
function drawCavalry(unit, time, heavy) {
  const phase = unit.walkPhase;
  const move = unit.moveBlend;
  const strideA = Math.sin(phase) * (heavy ? 6 : 8) * move;
  const strideB = Math.sin(phase + Math.PI) * (heavy ? 6 : 8) * move;
  const gallopBob = Math.abs(Math.sin(phase)) * (heavy ? 1.5 : 2.3) * move;
  const horseColor = heavy ? '#596779' : '#7a5d47';
  const armorColor = heavy ? '#9eaec2' : '#768ca5';
  const ink = '#241a13';
  const thrust = attackPulse(unit) * (heavy ? 18 : 12);

  ctx.save();
  ctx.translate(0, -gallopBob);

  const horseLegColor = heavy ? '#4d5968' : '#6d513e';
  function drawHorseLeg(baseX, offset, rear) {
    const swing = Math.sin(phase + offset) * (heavy ? 7 : 9) * move;
    const lift = Math.max(0, Math.cos(phase + offset)) * (heavy ? 2.5 : 3.5) * move;
    const kneeX = baseX + swing * 0.45 + (rear ? -1.5 : 1.5) * move;
    const kneeY = -9 - lift * 0.25;
    const hoofX = baseX + swing;
    const hoofY = -lift;
    ctx.globalAlpha = rear ? 0.7 : 1;
    ctx.strokeStyle = ink;
    ctx.lineWidth = heavy ? 7 : 6;
    ctx.beginPath();
    ctx.moveTo(baseX, -18);
    ctx.lineTo(kneeX, kneeY);
    ctx.lineTo(hoofX, hoofY);
    ctx.stroke();
    ctx.strokeStyle = horseLegColor;
    ctx.lineWidth = heavy ? 3.8 : 3.2;
    ctx.beginPath();
    ctx.moveTo(baseX, -18);
    ctx.lineTo(kneeX, kneeY);
    ctx.lineTo(hoofX, hoofY);
    ctx.stroke();
    ctx.fillStyle = '#2c2119';
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(hoofX + 1, hoofY, 3.6, 1.8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  drawHorseLeg(-15, Math.PI, true);
  drawHorseLeg(-5, Math.PI * 0.82, true);
  drawHorseLeg(21, Math.PI * 0.2, false);
  drawHorseLeg(30, 0, false);

  ctx.fillStyle = horseColor;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(7, -31, 32, 17, -0.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(35, -44, 11, 17, 0.45, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(40, -55);
  ctx.lineTo(47, -66);
  ctx.lineTo(48, -51);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = '#3f2c20';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(-23, -34);
  ctx.quadraticCurveTo(-40, -44 + Math.sin(phase) * 4, -33, -58);
  ctx.stroke();

  const riderY = heavy ? -64 : -58;
  ctx.fillStyle = armorColor;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2.5;
  roundRectPath(-9, riderY, 20, 30, 5);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#d8baa0';
  ctx.beginPath();
  ctx.arc(0, riderY - 8, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = heavy ? '#7f91a7' : '#5c718a';
  ctx.beginPath();
  ctx.arc(0, riderY - 10, 9, Math.PI, Math.PI * 2);
  ctx.lineTo(9, riderY - 7);
  ctx.lineTo(-9, riderY - 7);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  const riderHandX = 12;
  const riderHandY = riderY + 9;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(7, riderY + 8);
  ctx.lineTo(riderHandX, riderHandY);
  ctx.stroke();
  ctx.strokeStyle = armorColor;
  ctx.lineWidth = 2.8;
  ctx.beginPath();
  ctx.moveTo(7, riderY + 8);
  ctx.lineTo(riderHandX, riderHandY);
  ctx.stroke();

  ctx.save();
  ctx.translate(riderHandX, riderHandY);
  ctx.rotate(-0.48);
  ctx.strokeStyle = ink;
  ctx.lineWidth = heavy ? 7 : 6;
  ctx.beginPath();
  ctx.moveTo(-13, 0);
  ctx.lineTo(58 + thrust, 0);
  ctx.stroke();
  ctx.strokeStyle = heavy ? '#d8e1eb' : '#d8c596';
  ctx.lineWidth = heavy ? 3 : 2.5;
  ctx.beginPath();
  ctx.moveTo(-13, 0);
  ctx.lineTo(58 + thrust, 0);
  ctx.stroke();
  ctx.fillStyle = heavy ? '#e9c36b' : '#cfc09a';
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(58 + thrust, 0);
  ctx.lineTo(74 + thrust, -5);
  ctx.lineTo(63 + thrust, 7);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  drawGripHand(2.8, '#d8baa0');
  ctx.restore();

  ctx.fillStyle = heavy ? '#e9c36b' : '#6aa8ef';
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-7, riderY + 3);
  ctx.lineTo(-20 - Math.sin(phase) * 3 * move, riderY + 16);
  ctx.lineTo(-7, riderY + 20);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  if (unit.chargeDistance >= (unit.def.charge?.distance || 999)) {
    ctx.save();
    ctx.globalAlpha = 0.72;
    ctx.strokeStyle = '#f4c85d';
    ctx.lineWidth = 3;
    for (let index = 0; index < 3; index += 1) {
      ctx.beginPath();
      ctx.moveTo(-40 - index * 10, -58 + index * 15);
      ctx.lineTo(-72 - index * 14, -58 + index * 15);
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();
}
function drawGunner(unit, time) {
  const colors = { body: '#4f6e8a', armor: '#8ea2b3', legs: '#303944', skin: '#d2aa8d', helmet: '#6c7d8e', visor: '#17212b' };
  drawHumanoidBase(colors, unit, 0.94);
  const grip = getHumanoidHandAnchor(unit, 0.94);
  const p = attackProgress(unit);
  const recoilKick = p > 0 && p < 0.52 ? attackPulse(unit) * 1.8 : 0;

  ctx.save();
  ctx.translate(grip.x, grip.y);
  ctx.rotate(grip.angle - 0.03 - recoilKick * 0.025);
  ctx.strokeStyle = '#241a13';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(-9, 4);
  ctx.lineTo(45, -6);
  ctx.stroke();
  ctx.strokeStyle = '#8a6844';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-7, 3);
  ctx.lineTo(20, -2);
  ctx.stroke();
  ctx.strokeStyle = '#eef2f5';
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.moveTo(20, -2);
  ctx.lineTo(51, -7);
  ctx.stroke();
  ctx.fillStyle = '#c8a76d';
  ctx.strokeStyle = '#241a13';
  ctx.lineWidth = 1.2;
  ctx.fillRect(4, 1, 8, 4);
  ctx.strokeRect(4, 1, 8, 4);
  if (p > 0 && p < 0.34) {
    ctx.fillStyle = '#ffd778';
    ctx.strokeStyle = '#241a13';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(55 + recoilKick * 4, -8, 6 + p * 7, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  drawGripHand(3, colors.skin);
  ctx.restore();
}
function drawPaladin(unit, time) {
  ctx.save();
  ctx.scale(1.15, 1.15);
  const colors = { body: '#b6c2d1', armor: '#e1e7ef', legs: '#4c5968', skin: '#e0c3a9', helmet: '#d6c076', visor: '#28313c' };
  const flutter = Math.sin(unit.walkPhase * 0.8) * 4 * unit.moveBlend;
  drawHumanoidBase(colors, unit);
  const grip = getHumanoidHandAnchor(unit);
  ctx.strokeStyle = '#f1d373';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-13, -47);
  ctx.lineTo(13, -47);
  ctx.moveTo(-10, -28);
  ctx.lineTo(10, -28);
  ctx.stroke();

  ctx.save();
  ctx.translate(grip.x, grip.y);
  ctx.rotate(grip.angle - 0.04 + Math.sin(unit.walkPhase) * 0.04 * unit.moveBlend);
  ctx.fillStyle = '#e9c36b';
  ctx.strokeStyle = '#241a13';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(1, -15);
  ctx.lineTo(17, -20);
  ctx.lineTo(19, 2);
  ctx.quadraticCurveTo(11, 14, 2, 11);
  ctx.lineTo(-1, -4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#a87524';
  ctx.fillRect(8, -11, 4, 17);
  ctx.fillRect(3, -4, 14, 4);
  drawGripHand(3.2, colors.skin);
  ctx.restore();

  ctx.save();
  ctx.translate(grip.x + 1, grip.y - 1);
  ctx.rotate(grip.angle - 0.92 + attackSwingCurve(unit) * 1.1);
  ctx.strokeStyle = '#3b2b1c';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(-7, 0);
  ctx.lineTo(6, 0);
  ctx.stroke();
  ctx.strokeStyle = '#241a13';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(6, 0);
  ctx.lineTo(47, 0);
  ctx.stroke();
  ctx.strokeStyle = '#f8f1d8';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(6, 0);
  ctx.lineTo(47, 0);
  ctx.stroke();
  ctx.fillStyle = '#e9c36b';
  ctx.strokeStyle = '#241a13';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(47 + flutter * 0.2, 0);
  ctx.lineTo(41, -5);
  ctx.lineTo(41, 5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = '#e9c36b';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(6, -6);
  ctx.lineTo(6, 6);
  ctx.stroke();
  ctx.restore();
  ctx.restore();
}
function drawSkeletonFrame(unit, color = '#eadfc7') {
  const ink = '#241a13';
  const phase = unit.walkPhase;
  const move = unit.moveBlend;
  const teamColor = FACTIONS[unit.faction]?.color || '#9b82bf';
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  function drawBoneLeg(offset, rear) {
    const swing = Math.sin(phase + offset) * 9 * move;
    const lift = Math.max(0, Math.cos(phase + offset)) * 3 * move;
    const hipX = rear ? -2.7 : 2.7;
    const footX = hipX + swing + attackPulse(unit) * (rear ? -2.2 : 3.4);
    const footY = -2 - lift;
    const kneeX = (hipX + footX) * 0.5 + (rear ? 0.3 : 2.8) * move;
    const kneeY = -13 + lift * 0.12;
    ctx.globalAlpha = rear ? 0.7 : 1;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(hipX, -22);
    ctx.lineTo(kneeX, kneeY);
    ctx.lineTo(footX, footY);
    ctx.lineTo(footX + 4, footY + 0.3);
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.8;
    ctx.beginPath();
    ctx.moveTo(hipX, -22);
    ctx.lineTo(kneeX, kneeY);
    ctx.lineTo(footX, footY);
    ctx.lineTo(footX + 3.5, footY + 0.3);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(kneeX, kneeY, 2.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawBoneArm(offset, rear) {
    const swing = Math.sin(phase + offset) * (rear ? 5 : 3.2) * move;
    const shoulderX = rear ? -8 : 8;
    const attackReach = attackPulse(unit) * (rear ? -2 : 5.5);
    const elbowX = shoulderX + (rear ? -2.6 : 2.2) + swing * 0.55 + attackReach * 0.55;
    const handX = shoulderX + (rear ? -7 : 6.5) + swing + attackReach;
    const elbowY = -35 + Math.abs(swing) * 0.08;
    const handY = -30 + Math.sin(phase + offset) * 1.7 * move;
    ctx.globalAlpha = rear ? 0.64 : 1;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 5.4;
    ctx.beginPath();
    ctx.moveTo(shoulderX, -43);
    ctx.lineTo(elbowX, elbowY);
    ctx.lineTo(handX, handY);
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.3;
    ctx.beginPath();
    ctx.moveTo(shoulderX, -43);
    ctx.lineTo(elbowX, elbowY);
    ctx.lineTo(handX, handY);
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.strokeStyle = ink;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.arc(elbowX, elbowY, 1.8, 0, Math.PI * 2);
    ctx.arc(handX, handY, 2.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  drawBoneArm(Math.PI, true);
  drawBoneLeg(Math.PI, true);

  ctx.fillStyle = teamColor;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.8;
  const clothWave = Math.sin(phase + 0.8) * 2.2 * move;
  ctx.beginPath();
  ctx.moveTo(-7, -29);
  ctx.lineTo(-14 - clothWave, -17);
  ctx.lineTo(-5, -20);
  ctx.lineTo(2, -29);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = ink;
  ctx.lineWidth = 6.2;
  ctx.beginPath();
  ctx.moveTo(0, -22);
  ctx.lineTo(0, -49);
  ctx.moveTo(-9, -39);
  ctx.lineTo(9, -39);
  ctx.moveTo(-7.5, -34);
  ctx.lineTo(7.5, -34);
  ctx.moveTo(-6, -29);
  ctx.lineTo(6, -29);
  ctx.stroke();

  ctx.strokeStyle = color;
  ctx.lineWidth = 2.8;
  ctx.beginPath();
  ctx.moveTo(0, -22);
  ctx.lineTo(0, -49);
  ctx.stroke();

  ctx.lineWidth = 1.9;
  for (let index = 0; index < 3; index += 1) {
    const y = -39 + index * 5;
    const width = 8.5 - index * 1.2;
    ctx.beginPath();
    ctx.moveTo(-width, y);
    ctx.quadraticCurveTo(0, y + 2.2, width, y);
    ctx.stroke();
  }
  ctx.strokeStyle = ink;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(-5, -48);
  ctx.lineTo(0, -52);
  ctx.lineTo(5, -48);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.1;
  ctx.beginPath();
  ctx.moveTo(-5, -48);
  ctx.lineTo(0, -52);
  ctx.lineTo(5, -48);
  ctx.stroke();

  drawBoneLeg(0, false);
  drawBoneArm(0, false);

  ctx.fillStyle = color;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2.4;
  ctx.beginPath();
  ctx.ellipse(0.5, -59, 8.8, 9.2, -0.06, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#2a2032';
  ctx.beginPath();
  ctx.ellipse(-3.2, -60, 2.5, 3.4, -0.1, 0, Math.PI * 2);
  ctx.ellipse(3.2, -60, 2.5, 3.4, 0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = teamColor;
  ctx.beginPath();
  ctx.arc(-3.2, -60, 1.15, 0, Math.PI * 2);
  ctx.arc(3.2, -60, 1.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#2a2032';
  ctx.beginPath();
  ctx.moveTo(1, -55.5);
  ctx.lineTo(6, -53.7);
  ctx.lineTo(1, -52);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-4, -52);
  ctx.lineTo(4, -52);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-7, -66);
  ctx.lineTo(-11, -72);
  ctx.lineTo(-4, -68);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
function drawBoneSoldier(unit, time) {
  drawSkeletonFrame(unit);
  const swing = attackSwingCurve(unit);
  const pulse = attackPulse(unit);

  if (pulse > 0.15) {
    ctx.save();
    ctx.globalAlpha = pulse * 0.26;
    ctx.strokeStyle = '#fff0c9';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(6, -31, 28, -0.9, 0.45);
    ctx.stroke();
    ctx.restore();
  }

  const grip = getSkeletonHandAnchor(unit);
  ctx.save();
  ctx.translate(grip.x, grip.y);
  ctx.rotate(grip.angle - 0.28 + swing * 0.85);
  ctx.strokeStyle = '#241a13';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(-5, 0);
  ctx.lineTo(6, 0);
  ctx.stroke();
  ctx.strokeStyle = '#8d7358';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-5, 0);
  ctx.lineTo(6, 0);
  ctx.stroke();
  ctx.strokeStyle = '#241a13';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(6, 0);
  ctx.lineTo(23, 0);
  ctx.stroke();
  ctx.strokeStyle = '#d7c49e';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(6, 0);
  ctx.lineTo(23, 0);
  ctx.stroke();
  ctx.fillStyle = '#f0e2c4';
  ctx.strokeStyle = '#241a13';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(22, -5);
  ctx.lineTo(34, -9);
  ctx.lineTo(30, 0);
  ctx.lineTo(37, 6);
  ctx.lineTo(22, 4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  drawGripHand(2.4, '#d9cbb2');
  ctx.restore();
}
function drawBoneDog(unit, time) {
  const phase = unit.walkPhase;
  const move = unit.moveBlend;
  const stride = Math.sin(phase) * 8 * move;
  const strideBack = Math.sin(phase + Math.PI) * 8 * move;
  const bob = Math.abs(Math.sin(phase * 1.5)) * 2.5 * move;
  const bite = attackPulse(unit);
  const ink = '#241a13';

  ctx.save();
  ctx.translate(0, -bob);
  ctx.strokeStyle = ink;
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-16, -14);
  ctx.lineTo(-24 + stride, 0);
  ctx.moveTo(-5, -15);
  ctx.lineTo(-2 - strideBack, 0);
  ctx.moveTo(16, -15);
  ctx.lineTo(24 + strideBack, 0);
  ctx.moveTo(24, -17);
  ctx.lineTo(32 - stride, 0);
  ctx.stroke();

  ctx.strokeStyle = '#cbbfae';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-16, -14);
  ctx.lineTo(-24 + stride, 0);
  ctx.moveTo(-5, -15);
  ctx.lineTo(-2 - strideBack, 0);
  ctx.moveTo(16, -15);
  ctx.lineTo(24 + strideBack, 0);
  ctx.moveTo(24, -17);
  ctx.lineTo(32 - stride, 0);
  ctx.stroke();

  ctx.fillStyle = '#cfc5b5';
  ctx.strokeStyle = ink;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(0, -22, 24, 11, -0.05, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.save();
  ctx.translate(24 + bite * 8, -27 - bite * 2);
  ctx.rotate(-bite * 0.22);
  ctx.fillStyle = '#cfc5b5';
  ctx.beginPath();
  ctx.ellipse(5, 0, 10, 8, 0.18, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#2a2032';
  ctx.beginPath();
  ctx.arc(7, -2, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ece2cf';
  ctx.beginPath();
  ctx.moveTo(9, 6);
  ctx.lineTo(18, 9);
  ctx.lineTo(7, 11);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  ctx.strokeStyle = '#cbbfae';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-21, -25);
  ctx.quadraticCurveTo(-38, -33 + Math.sin(phase) * 5, -34, -43);
  ctx.stroke();
  ctx.restore();
}
function drawBoneShaman(unit, time) {
  const phase = unit.walkPhase;
  const move = unit.moveBlend;
  const sway = Math.sin(phase) * 2.5 * move;
  const cast = attackPulse(unit);
  const ink = '#241a13';

  ctx.save();
  ctx.strokeStyle = ink;
  ctx.lineWidth = 3;
  ctx.fillStyle = '#372b45';
  ctx.beginPath();
  ctx.moveTo(-13 + sway, 0);
  ctx.lineTo(-8, -44);
  ctx.quadraticCurveTo(0, -53, 8, -44);
  ctx.lineTo(14 + sway, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#574267';
  ctx.beginPath();
  ctx.moveTo(-15, -43);
  ctx.quadraticCurveTo(0, -66, 15, -43);
  ctx.lineTo(9, -39);
  ctx.quadraticCurveTo(0, -50, -9, -39);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#c9bdcf';
  ctx.beginPath();
  ctx.arc(0, -48, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#211927';
  ctx.beginPath();
  ctx.arc(-2.5, -49, 1.5, 0, Math.PI * 2);
  ctx.arc(2.5, -49, 1.5, 0, Math.PI * 2);
  ctx.fill();

  const grip = { x: 15, y: -31 };
  ctx.strokeStyle = ink;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(8, -42);
  ctx.lineTo(12, -36);
  ctx.lineTo(grip.x, grip.y);
  ctx.stroke();
  ctx.strokeStyle = '#c9bdcf';
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(8, -42);
  ctx.lineTo(12, -36);
  ctx.lineTo(grip.x, grip.y);
  ctx.stroke();

  ctx.save();
  ctx.translate(grip.x, grip.y);
  ctx.rotate(-0.08 - cast * 0.18);
  ctx.strokeStyle = ink;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(-7, 9);
  ctx.lineTo(7, -27);
  ctx.stroke();
  ctx.strokeStyle = '#7d654f';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-7, 9);
  ctx.lineTo(7, -27);
  ctx.stroke();

  const orbPulse = 0.65 + Math.sin(time * 3 + unit.bobSeed) * 0.12 + cast * 0.2;
  ctx.fillStyle = `rgba(117, 239, 200, ${orbPulse})`;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(7, -32, 6 + cast * 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  if (cast > 0.12) {
    ctx.strokeStyle = `rgba(117, 239, 200, ${0.4 * cast})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(7, -32, 14 + cast * 10, 0, Math.PI * 2);
    ctx.stroke();
  }
  drawGripHand(2.5, '#c9bdcf');
  ctx.restore();
  ctx.restore();
}
function drawBoneGiant(unit, time) {
  const phase = unit.walkPhase;
  const move = unit.moveBlend;
  const stride = Math.sin(phase) * 5 * move;
  const stepBob = Math.abs(Math.sin(phase)) * 2.2 * move;
  const swing = attackSwingCurve(unit);
  const ink = '#241a13';
  const bone = '#cfc2b0';

  ctx.save();
  ctx.scale(1.65, 1.65);
  ctx.translate(0, -stepBob);
  ctx.lineCap = 'round';

  ctx.strokeStyle = ink;
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(-8, -28);
  ctx.lineTo(-11 + stride, -2);
  ctx.moveTo(8, -28);
  ctx.lineTo(11 - stride, -2);
  ctx.moveTo(0, -48);
  ctx.lineTo(0, -23);
  ctx.moveTo(-13, -44);
  ctx.lineTo(13, -44);
  ctx.moveTo(-10, -37);
  ctx.lineTo(10, -37);
  ctx.moveTo(-8, -30);
  ctx.lineTo(8, -30);
  ctx.stroke();
  ctx.strokeStyle = bone;
  ctx.lineWidth = 4;
  ctx.stroke();

  ctx.fillStyle = bone;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(0, -56, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#241b2b';
  ctx.beginPath();
  ctx.ellipse(-4, -57, 2.5, 4, 0, 0, Math.PI * 2);
  ctx.ellipse(4, -57, 2.5, 4, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = ink;
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.moveTo(-11, -43);
  ctx.lineTo(-20, -23);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(10, -43);
  ctx.lineTo(24, -37);
  ctx.stroke();
  ctx.strokeStyle = bone;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(-11, -43);
  ctx.lineTo(-20, -23);
  ctx.moveTo(10, -43);
  ctx.lineTo(24, -37);
  ctx.stroke();

  ctx.save();
  ctx.translate(24, -37);
  ctx.rotate(0.2 + swing * 0.95);
  ctx.strokeStyle = ink;
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(24, -22);
  ctx.stroke();
  ctx.strokeStyle = '#806849';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(24, -22);
  ctx.stroke();
  ctx.fillStyle = '#a59076';
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(18, -28);
  ctx.lineTo(38, -33);
  ctx.lineTo(41, -12);
  ctx.lineTo(21, -16);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  drawGripHand(2.8, bone);
  ctx.restore();
  ctx.restore();
}
function drawBoneDragon(unit, time) {
  const flap = Math.sin(time * 4.8 + unit.bobSeed) * 0.3;
  const moveFlap = unit.moveBlend * Math.sin(unit.walkPhase) * 0.08;
  const cast = attackPulse(unit);
  const ink = '#241a13';

  ctx.save();
  ctx.translate(0, -12 + Math.sin(time * 2.2 + unit.bobSeed) * 2);
  ctx.strokeStyle = ink;
  ctx.lineWidth = 5;
  ctx.lineJoin = 'round';

  ctx.fillStyle = '#453950';
  ctx.beginPath();
  ctx.moveTo(-16, -22);
  ctx.quadraticCurveTo(-58, -68 - flap * 30, -83, -34);
  ctx.quadraticCurveTo(-52, -35, -38, -12);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#5a4968';
  ctx.beginPath();
  ctx.moveTo(-14, -20);
  ctx.quadraticCurveTo(-43, -44 - (flap + moveFlap) * 20, -67, -27);
  ctx.quadraticCurveTo(-43, -24, -31, -9);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#382e43';
  ctx.beginPath();
  ctx.ellipse(0, -20, 39, 18, -0.05, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = ink;
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(-34, -15);
  ctx.quadraticCurveTo(-64, -2 + Math.sin(time * 3 + unit.bobSeed) * 6, -82, 7);
  ctx.stroke();
  ctx.strokeStyle = '#8e7c9e';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(-34, -15);
  ctx.quadraticCurveTo(-64, -2 + Math.sin(time * 3 + unit.bobSeed) * 6, -82, 7);
  ctx.stroke();

  ctx.fillStyle = '#c7b6d3';
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.ellipse(37, -30, 15, 11, 0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#2a2131';
  ctx.beginPath();
  ctx.arc(43, -33, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#c7b6d3';
  ctx.beginPath();
  ctx.moveTo(32, -39);
  ctx.lineTo(28, -49);
  ctx.lineTo(38, -42);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = ink;
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(5, -11);
  ctx.lineTo(-2 + Math.sin(time * 3) * 2, 8);
  ctx.moveTo(-14, -12);
  ctx.lineTo(-22 - Math.sin(time * 3) * 2, 7);
  ctx.stroke();
  ctx.strokeStyle = '#7c6a8c';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(5, -11);
  ctx.lineTo(-2 + Math.sin(time * 3) * 2, 8);
  ctx.moveTo(-14, -12);
  ctx.lineTo(-22 - Math.sin(time * 3) * 2, 7);
  ctx.stroke();

  ctx.fillStyle = cast > 0.1 ? '#f4ffd0' : '#a7ff7d';
  ctx.strokeStyle = ink;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(49, -27, 4 + cast * 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  if (cast > 0.18) {
    ctx.strokeStyle = `rgba(167, 255, 125, ${0.5 * cast})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(50, -27, 11 + cast * 9, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}
function drawArcaneCaster(unit, palette, variant) {
  const phase = unit.walkPhase;
  const move = unit.moveBlend;
  const stride = Math.sin(phase) * 3 * move;
  const cast = attackSwingCurve(unit);
  const pulse = attackPulse(unit);
  const ink = '#241a13';

  ctx.save();
  ctx.translate(0, -Math.abs(Math.sin(phase)) * 1.2 * move);
  ctx.strokeStyle = ink;
  ctx.lineWidth = 3;
  ctx.fillStyle = palette.robe;
  ctx.beginPath();
  ctx.moveTo(-15 + stride, 0);
  ctx.lineTo(-9, -45);
  ctx.quadraticCurveTo(0, -56, 9, -45);
  ctx.lineTo(15 - stride, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = palette.trim;
  ctx.beginPath();
  ctx.moveTo(-11, -8);
  ctx.lineTo(11, -8);
  ctx.lineTo(14 - stride, 0);
  ctx.lineTo(-15 + stride, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = palette.hood;
  ctx.beginPath();
  ctx.moveTo(-14, -43);
  ctx.quadraticCurveTo(0, -68, 14, -43);
  ctx.lineTo(9, -34);
  ctx.quadraticCurveTo(0, -43, -9, -34);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#d8cbdc';
  ctx.beginPath();
  ctx.arc(0, -47, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = palette.glow;
  ctx.beginPath();
  ctx.arc(-2.6, -48, 1.8, 0, Math.PI * 2);
  ctx.arc(2.6, -48, 1.8, 0, Math.PI * 2);
  ctx.fill();

  if (variant === 'wizard') {
    ctx.fillStyle = palette.trim;
    ctx.beginPath();
    ctx.moveTo(-17, -58);
    ctx.lineTo(1, -91);
    ctx.lineTo(16, -58);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (variant === 'warlock') {
    ctx.strokeStyle = ink;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(-8, -54);
    ctx.quadraticCurveTo(-19, -67, -13, -77);
    ctx.moveTo(8, -54);
    ctx.quadraticCurveTo(19, -67, 13, -77);
    ctx.stroke();
    ctx.strokeStyle = palette.trim;
    ctx.lineWidth = 3;
    ctx.stroke();
  } else if (variant === 'hera') {
    ctx.strokeStyle = ink;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(0, -66, 13, Math.PI, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = '#f2d77f';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  const grip = { x: 15, y: -31 };
  ctx.strokeStyle = ink;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(8, -43);
  ctx.lineTo(12, -36);
  ctx.lineTo(grip.x, grip.y);
  ctx.stroke();
  ctx.strokeStyle = palette.robe;
  ctx.lineWidth = 2.8;
  ctx.beginPath();
  ctx.moveTo(8, -43);
  ctx.lineTo(12, -36);
  ctx.lineTo(grip.x, grip.y);
  ctx.stroke();

  ctx.save();
  ctx.translate(grip.x, grip.y);
  ctx.rotate(-0.13 - cast * 0.18 - pulse * 0.08);
  ctx.strokeStyle = ink;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(-5, 8);
  ctx.lineTo(8, -29);
  ctx.stroke();
  ctx.strokeStyle = palette.trim;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-5, 8);
  ctx.lineTo(8, -29);
  ctx.stroke();
  ctx.fillStyle = palette.glow;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(8, -34, 6 + pulse * 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  if (pulse > 0.18 || variant === 'wizard') {
    ctx.strokeStyle = `${palette.glow}88`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(8, -34, 13 + pulse * 11, 0, Math.PI * 2);
    ctx.stroke();
  }
  drawGripHand(2.5, '#d8cbdc');
  ctx.restore();
  ctx.restore();
}

function drawWarlock(unit, time) {
  drawArcaneCaster(unit, { robe: '#4a335f', trim: '#a876d1', hood: '#332442', glow: '#d58cff' }, 'warlock');
}

function drawWizard(unit, time) {
  drawArcaneCaster(unit, { robe: '#3c4b79', trim: '#8dc7ff', hood: '#28375d', glow: '#90e7ff' }, 'wizard');
}

function drawOccultist(unit, time) {
  drawArcaneCaster(unit, { robe: '#5b2b55', trim: '#e09bff', hood: '#3c1d3d', glow: '#ff8ff1' }, 'occultist');
  ctx.save();
  ctx.translate(0, -70);
  ctx.strokeStyle = 'rgba(255, 151, 243, 0.7)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, 13 + Math.sin(time * 3 + unit.bobSeed) * 2, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, 8, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawHera(unit, time) {
  drawArcaneCaster(unit, { robe: '#e2d7bd', trim: '#e5bd61', hood: '#bda56c', glow: '#8dffd7' }, 'hera');
}

function drawSoulSwordsman(unit, time) {
  ctx.save();
  ctx.globalAlpha = 0.84;
  drawSkeletonFrame(unit, '#bffcff');
  const swing = attackSwingCurve(unit);
  const grip = getSkeletonHandAnchor(unit);
  ctx.translate(grip.x, grip.y);
  ctx.rotate(grip.angle - 0.2 + swing * 0.9);
  ctx.strokeStyle = '#241a13';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(-5, 0);
  ctx.lineTo(5, 0);
  ctx.stroke();
  ctx.strokeStyle = '#d7ffff';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(5, 0);
  ctx.lineTo(31, 0);
  ctx.stroke();
  ctx.strokeStyle = '#8cf5ee';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(13, -1, 23, -0.9, 0.4);
  ctx.stroke();
  drawGripHand(2.3, '#bffcff');
  ctx.restore();
}

function drawAncientBeast(unit, time) {
  const phase = unit.walkPhase;
  const move = unit.moveBlend;
  const stride = Math.sin(phase) * 5 * move;
  const cast = attackPulse(unit);
  const ink = '#241a13';
  const body = '#6f477e';
  const spine = '#d9b5e7';

  ctx.save();
  ctx.translate(0, -Math.abs(Math.sin(phase)) * 2 * move);
  ctx.strokeStyle = ink;
  ctx.lineWidth = 8;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-20, -24);
  ctx.lineTo(-28 + stride, 0);
  ctx.moveTo(-2, -25);
  ctx.lineTo(4 - stride, 0);
  ctx.moveTo(27, -24);
  ctx.lineTo(34 + stride, 0);
  ctx.moveTo(39, -25);
  ctx.lineTo(47 - stride, 0);
  ctx.stroke();

  ctx.fillStyle = body;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.ellipse(2, -40, 43, 25, -0.08, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.ellipse(44, -54, 20, 16, 0.18, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = spine;
  for (let index = -2; index <= 2; index += 1) {
    ctx.beginPath();
    ctx.moveTo(index * 15, -61);
    ctx.lineTo(index * 15 - 5, -79);
    ctx.lineTo(index * 15 + 5, -63);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  ctx.fillStyle = '#f1d7ff';
  ctx.beginPath();
  ctx.arc(51, -61, 4 + cast * 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  if (cast > 0.12) {
    ctx.strokeStyle = `rgba(255, 126, 235, ${0.55 * cast})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(51, -61, 15 + cast * 18, 0, Math.PI * 2);
    ctx.stroke();
  }

  const tailAngle = Math.sin(phase) * 0.12 * move - attackPulse(unit) * 0.55;
  ctx.save();
  ctx.translate(-38, -38);
  ctx.rotate(tailAngle);
  ctx.strokeStyle = ink;
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(-35, -18, -57, 2);
  ctx.stroke();
  ctx.strokeStyle = '#b48bc3';
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.fillStyle = spine;
  ctx.beginPath();
  ctx.moveTo(-56, -2);
  ctx.lineTo(-73, 1);
  ctx.lineTo(-58, 9);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  ctx.restore();
}

function drawSwat(unit, time) {
  const colors = { body: '#293b42', armor: '#52656b', legs: '#20282c', skin: '#d4b193', helmet: '#37494f', visor: '#10171a' };
  drawHumanoidBase(colors, unit, 1.04);
  const grip = getHumanoidHandAnchor(unit, 1.04);
  const brace = Math.sin(unit.walkPhase) * 0.05 * unit.moveBlend + attackPulse(unit) * 0.1;
  const swing = attackSwingCurve(unit);
  ctx.save();
  ctx.translate(grip.x, grip.y);
  ctx.rotate(grip.angle - 0.08 + brace);
  ctx.fillStyle = '#d9e0dd';
  ctx.strokeStyle = '#241a13';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(1, -15);
  ctx.lineTo(16, -10);
  ctx.lineTo(17, 10);
  ctx.quadraticCurveTo(7, 20, 0, 12);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#4c6870';
  ctx.fillRect(6, -8, 7, 17);
  drawGripHand(3.1, colors.skin);
  ctx.restore();

  ctx.save();
  ctx.translate(grip.x + 1, grip.y + 1);
  ctx.rotate(grip.angle - 0.5 + swing * 0.9);
  ctx.strokeStyle = '#241a13';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(-6, 0);
  ctx.lineTo(34, 0);
  ctx.stroke();
  ctx.strokeStyle = '#b9c5c8';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-6, 0);
  ctx.lineTo(34, 0);
  ctx.stroke();
  ctx.strokeStyle = '#2c3538';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(-6, 0);
  ctx.lineTo(-1, 0);
  ctx.stroke();
  ctx.restore();
}
function drawRiotPolice(unit, time) {
  const colors = { body: '#2f4350', armor: '#607985', legs: '#24313a', skin: '#d9b59a', helmet: '#445a65', visor: '#131b20' };
  drawHumanoidBase(colors, unit, 0.98);
  const grip = getHumanoidHandAnchor(unit, 0.98);
  const recoil = attackPulse(unit) * 1.4;
  ctx.save();
  ctx.translate(grip.x, grip.y);
  ctx.rotate(grip.angle - recoil * 0.02);
  ctx.strokeStyle = '#241a13';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(-8, 4);
  ctx.lineTo(32, -5);
  ctx.stroke();
  ctx.strokeStyle = '#c4d0d2';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-6, 3);
  ctx.lineTo(32, -5);
  ctx.stroke();
  ctx.fillStyle = '#26343a';
  ctx.fillRect(1, 1, 8, 3);
  drawGripHand(2.8, colors.skin);
  ctx.restore();
  ctx.fillStyle = '#e3bd58';
  ctx.strokeStyle = '#241a13';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(-13, -42, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#4d5660';
  ctx.fillRect(-16, -48, 6, 5);
}
function drawSpecialForces(unit, time) {
  const colors = { body: '#344d43', armor: '#667f70', legs: '#26352f', skin: '#d0a98d', helmet: '#42584c', visor: '#101713' };
  drawHumanoidBase(colors, unit, 1.0);
  const grip = getHumanoidHandAnchor(unit, 1.0);
  const recoil = attackPulse(unit) * 1.2;
  ctx.save();
  ctx.translate(grip.x, grip.y);
  ctx.rotate(grip.angle - recoil * 0.018);
  ctx.strokeStyle = '#241a13';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(-9, 4);
  ctx.lineTo(45, -5);
  ctx.stroke();
  ctx.strokeStyle = '#48544d';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(-7, 3);
  ctx.lineTo(43, -5);
  ctx.stroke();
  ctx.strokeStyle = '#d9dfd9';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(23, -1);
  ctx.lineTo(48, -6);
  ctx.stroke();
  ctx.fillStyle = '#1d2521';
  ctx.fillRect(3, 2, 10, 6);
  if (unit.attackTimer > 0) {
    ctx.fillStyle = '#ffe28a';
    ctx.beginPath();
    ctx.arc(50, -6, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  drawGripHand(2.8, colors.skin);
  ctx.restore();
}
function drawTank(unit, time) {
  const recoil = attackPulse(unit) * 8;
  const ink = '#241a13';
  ctx.save();
  ctx.fillStyle = '#26302c';
  ctx.strokeStyle = ink;
  ctx.lineWidth = 3;
  roundRectPath(-46, -20, 92, 20, 8);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#53655b';
  roundRectPath(-43, -36, 84, 21, 7);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#415047';
  roundRectPath(-24, -52, 50, 20, 8);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#2d3933';
  ctx.fillRect(-12, -57, 25, 8);
  ctx.save();
  ctx.translate(18, -45);
  ctx.rotate(-0.04 + attackPulse(unit) * 0.025);
  ctx.fillStyle = '#6b7e72';
  ctx.strokeStyle = ink;
  ctx.lineWidth = 3;
  roundRectPath(-5, -6, 56, 12, 4);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#2d3933';
  ctx.fillRect(38, -4, 23, 8);
  ctx.restore();
  for (const x of [-32, 0, 32]) {
    ctx.beginPath();
    ctx.arc(x, -10, 8, 0, Math.PI * 2);
    ctx.fillStyle = '#7b8d83';
    ctx.fill();
    ctx.stroke();
  }
  ctx.translate(-recoil, 0);
  ctx.restore();
}

function drawHelicopter(unit, time) {
  const rotor = time * 28 + unit.bobSeed;
  const ink = '#241a13';
  ctx.save();
  ctx.translate(0, -20);
  ctx.strokeStyle = ink;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(-48, 8);
  ctx.lineTo(35, 8);
  ctx.moveTo(-28, 10);
  ctx.lineTo(-28, 22);
  ctx.moveTo(12, 10);
  ctx.lineTo(12, 22);
  ctx.moveTo(-34, 24);
  ctx.lineTo(-20, 24);
  ctx.moveTo(4, 24);
  ctx.lineTo(18, 24);
  ctx.stroke();

  ctx.fillStyle = '#4b6756';
  ctx.strokeStyle = ink;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.ellipse(-5, -3, 38, 17, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(38, -7, 17, 9, 0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#25352d';
  ctx.beginPath();
  ctx.ellipse(32, -9, 11, 7, 0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = '#3d4c44';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-30, -10);
  ctx.lineTo(-30, -40);
  ctx.moveTo(18, -10);
  ctx.lineTo(18, -40);
  ctx.stroke();

  ctx.save();
  ctx.translate(-6, -45);
  ctx.rotate(rotor * 0.08);
  ctx.strokeStyle = '#20251f';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-48, 0);
  ctx.lineTo(48, 0);
  ctx.moveTo(0, -10);
  ctx.lineTo(0, 10);
  ctx.stroke();
  ctx.restore();

  ctx.strokeStyle = '#8affb0';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(46, -8);
  ctx.lineTo(67, -8);
  ctx.stroke();
  ctx.fillStyle = '#ffe47b';
  if (unit.attackTimer > 0) {
    ctx.beginPath();
    ctx.arc(69, -8, 4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawProjectiles() {
  if (!state) return;
  for (const projectile of state.projectiles) {
    ctx.save();
    ctx.strokeStyle = projectile.color;
    ctx.lineWidth = Math.max(2, projectile.size * 0.8);
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    ctx.moveTo(projectile.x - projectile.size * 3, projectile.y + projectile.size * 1.5);
    ctx.lineTo(projectile.x, projectile.y);
    ctx.stroke();

    ctx.globalAlpha = 1;
    ctx.fillStyle = projectile.color;
    ctx.strokeStyle = '#241a13';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(projectile.x, projectile.y, projectile.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}
function drawEffects() {
  if (!state) return;

  for (const ring of state.commandBursts) {
    const progress = 1 - ring.life / ring.maxLife;
    ctx.save();
    ctx.globalAlpha = Math.max(0, 1 - progress) * 0.75;
    ctx.strokeStyle = ring.color;
    ctx.lineWidth = 3 - progress * 2;
    ctx.beginPath();
    ctx.ellipse(ring.x, ring.y, ring.radius + progress * 62, (ring.radius + progress * 62) * 0.38, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  for (const burst of state.hitBursts) {
    const progress = 1 - burst.life / burst.maxLife;
    const alpha = Math.max(0, 1 - progress);
    const length = (burst.heavy ? 34 : 21) * (0.45 + progress * 0.9);
    ctx.save();
    ctx.translate(burst.x, burst.y);
    ctx.rotate(burst.angle);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = burst.color;
    ctx.fillStyle = burst.color;
    ctx.lineWidth = burst.heavy ? 4.5 : 2.8;
    ctx.lineCap = 'round';
    for (let index = 0; index < (burst.heavy ? 8 : 5); index += 1) {
      const angle = (Math.PI * 2 * index) / (burst.heavy ? 8 : 5) + (index % 2) * 0.16;
      const inner = burst.heavy ? 8 : 5;
      const outer = length * (index % 2 ? 0.72 : 1);
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * inner, Math.sin(angle) * inner);
      ctx.lineTo(Math.cos(angle) * outer, Math.sin(angle) * outer);
      ctx.stroke();
    }
    ctx.globalAlpha = alpha * 0.24;
    ctx.beginPath();
    ctx.arc(0, 0, (burst.heavy ? 30 : 18) * (0.4 + progress), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  for (const particle of state.particles) {
    ctx.save();
    const alpha = clamp(particle.life / particle.maxLife, 0, 1);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = particle.color;
    ctx.beginPath();
    ctx.arc(particle.x, particle.y, particle.size * (0.5 + alpha * 0.5), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  for (const floater of state.floaters) {
    const alpha = clamp(floater.life / floater.maxLife, 0, 1);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = 'center';
    ctx.font = `800 ${floater.size}px "Microsoft YaHei UI", sans-serif`;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.62)';
    ctx.strokeText(floater.text, floater.x, floater.y);
    ctx.fillStyle = floater.color;
    ctx.fillText(floater.text, floater.x, floater.y);
    ctx.restore();
  }
}

function drawDemolishHint() {
  if (!state || buildMode || !hoverPoint) return;
  const building = findOwnBuildingAt(hoverPoint);
  if (!building || building.isBase) return;
  const refund = demolitionRefund(building);
  const text = `右键拆除 · 返还 ${refund}`;
  ctx.save();
  ctx.font = '900 11px "Microsoft YaHei UI", sans-serif';
  const width = ctx.measureText(text).width + 18;
  const y = building.y - building.height - 58;
  fillRoundRect(building.x - width / 2, y, width, 20, 4, '#fff0c9');
  strokeRoundRect(building.x - width / 2, y, width, 20, 4, '#d5533f', 2);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#a72f22';
  ctx.fillText(text, building.x, y + 14);
  ctx.restore();
}

function drawSelectionOverlay() {
  if (!state || !pointer || !pointer.selecting || !pointer.points || pointer.points.length < 2) return;
  const points = pointer.points;
  const metrics = lassoMetrics(points);
  const count = state.player.units.filter((unit) => {
    if (unit.dead) return false;
    const visualY = unit.y - (unit.def.flying ? 170 : 28);
    return pointInPolygon(unit.x, visualY, points);
  }).length;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let index = 1; index < points.length; index += 1) {
    ctx.lineTo(points[index].x, points[index].y);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(229, 194, 107, 0.11)';
  ctx.fill();
  ctx.strokeStyle = '#241a13';
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.strokeStyle = '#f1cf7e';
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.fillStyle = '#fff0c9';
  ctx.strokeStyle = '#241a13';
  ctx.lineWidth = 2;
  const label = `可选中 ${count} 名士兵`;
  ctx.font = '900 13px "Microsoft YaHei UI", sans-serif';
  const labelWidth = ctx.measureText(label).width + 18;
  const labelY = Math.max(38, metrics.centerY - metrics.height * 0.5 - 31);
  fillRoundRect(metrics.centerX - labelWidth / 2, labelY, labelWidth, 22, 4, '#fff0c9');
  strokeRoundRect(metrics.centerX - labelWidth / 2, labelY, labelWidth, 22, 4, '#241a13', 2);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#241a13';
  ctx.fillText(label, metrics.centerX, labelY + 15);
  ctx.restore();
}

function drawBattleScene(time) {
  ctx.save();
  ctx.translate(-camera.x + camera.shakeX, camera.shakeY);
  drawBackground(time);

  if (!state) {
    ctx.save();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = '#101722';
    for (let index = 0; index < 7; index += 1) {
      const x = 250 + index * 155;
      ctx.beginPath();
      ctx.arc(x, WORLD.groundY - 30, 18 + (index % 3) * 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    ctx.restore();
    return;
  }

  drawTerritoryBoundary(state.player);
  drawTerritoryBoundary(state.enemy);
  if (buildMode) drawBuildExclusionZones(state.player, buildMode);

  const structures = [
    state.player.base,
    state.enemy.base,
    ...state.player.buildings,
    ...state.enemy.buildings,
  ];
  const units = [...state.player.units, ...state.enemy.units];
  const renderables = [...structures, ...units].sort((a, b) => {
    if (a.y !== b.y) return a.y - b.y;
    return a.x - b.x;
  });

  for (const entity of renderables) {
    if (entity.dead) continue;
    if (entity.kind === 'unit') drawUnit(entity, time);
    else if (entity.isBase) drawBase(entity);
    else drawBuilding(entity);
  }

  drawProjectiles();
  drawEffects();
  drawSelectionOverlay();
  drawBuildGhost();
  drawDemolishHint();
  ctx.restore();
}
function fitUiLayer() {
  if (!ui.app || !ui.uiLayer) return;
  const scale = ui.app.clientWidth / 1600;
  ui.uiLayer.style.transform = `scale(${scale})`;
}

window.addEventListener('resize', fitUiLayer);
if (window.ResizeObserver) {
  new ResizeObserver(fitUiLayer).observe(ui.app);
}
fitUiLayer();

function updateAmbientTimers(dt) {
  if (toastTimer > 0) {
    toastTimer = Math.max(0, toastTimer - dt);
    if (toastTimer === 0) ui.toast.classList.remove('show');
  }

  if (hintTimer > 0) {
    hintTimer = Math.max(0, hintTimer - dt);
    if (hintTimer === 0 && !buildMode) resetHint();
  }
}

function updateCamera(dt) {
  if (camera.shakeTime > 0) {
    camera.shakeTime = Math.max(0, camera.shakeTime - dt);
    const fade = camera.shakeTime > 0 ? Math.min(1, camera.shakeTime * 12) : 0;
    const power = camera.shakePower * fade;
    camera.shakeX = rand(-power, power);
    camera.shakeY = rand(-power * 0.55, power * 0.55);
    if (camera.shakeTime === 0) {
      camera.shakePower = 0;
      camera.shakeX = 0;
      camera.shakeY = 0;
    }
  } else {
    camera.shakeX = lerp(camera.shakeX, 0, 1 - Math.exp(-dt * 24));
    camera.shakeY = lerp(camera.shakeY, 0, 1 - Math.exp(-dt * 24));
  }

  if (!state || state.ended) {
    camera.velocity = lerp(camera.velocity, 0, 1 - Math.exp(-dt * 12));
    return;
  }

  let desiredVelocity = 0;
  if (pressedKeys.has('ArrowLeft')) desiredVelocity -= 900;
  if (pressedKeys.has('ArrowRight')) desiredVelocity += 900;
  if (!pointer && hoverScreenPoint) {
    if (hoverScreenPoint.x < 38) desiredVelocity -= 620;
    if (hoverScreenPoint.x > WORLD.viewWidth - 38) desiredVelocity += 620;
  }

  camera.velocity = lerp(camera.velocity, desiredVelocity, 1 - Math.exp(-dt * 10));
  if (Math.abs(camera.velocity) < 1) camera.velocity = 0;
  camera.x = clamp(camera.x + camera.velocity * dt, 0, WORLD.width - WORLD.viewWidth);
  if (camera.x <= 0 || camera.x >= WORLD.width - WORLD.viewWidth) camera.velocity = 0;
  if (hoverScreenPoint) {
    hoverPoint = { x: hoverScreenPoint.x + camera.x, y: hoverScreenPoint.y };
  }
}
function frame(now) {
  requestAnimationFrame(frame);
  if (frameFailure) return;

  const elapsedMs = now - lastFrameTime;
  if (elapsedMs < TARGET_FRAME_MS) return;
  lastFrameTime = now;

  try {
    const rawDt = Math.min(0.05, elapsedMs / 1000);
    hitStopCooldown = Math.max(0, hitStopCooldown - rawDt);
    hitStopTimer = Math.max(0, hitStopTimer - rawDt);
    const frozenByImpact = hitStopTimer > 0;
    if (state && !paused && !state.ended && !frozenByImpact) {
      let remaining = rawDt * gameSpeed;
      while (remaining > 0.0001 && !state.ended) {
        const step = Math.min(0.025, remaining);
        updateGame(step);
        remaining -= step;
      }
    }

    updateAmbientTimers(rawDt);
    updateCamera(rawDt);
    if (state && !paused && !state.ended && !restoringSave) {
      autosaveAccumulator += rawDt;
      if (autosaveAccumulator >= AUTOSAVE_INTERVAL) {
        autosaveAccumulator = 0;
        saveGame();
      }
    }
    hudAccumulator += rawDt;
    if (state && hudAccumulator >= 0.08) {
      hudAccumulator = 0;
      updateHud(false);
    }

    drawBattleScene(now / 1000);
  } catch (error) {
    frameFailure = true;
    paused = true;
    showFatal(error);
  }
}

const debugParams = new URLSearchParams(window.location.search);
const autostart = debugParams.get('autostart');
cleanupStaleAutosaves();
const savedGame = loadAutosave();
if (autostart && FACTIONS[autostart]) {
  window.setTimeout(() => startGame(autostart), 120);
} else if (savedGame) {
  window.setTimeout(() => startGame(savedGame.player.faction, { snapshot: savedGame }), 80);
}

window.__RTS_DEBUG__ = {
  startGame,
  getState: () => state,
  issueCommand,
  tryPlaceBuilding,
  enqueueUnit,
  upgradeBuilding,
  getCamera: () => ({ ...camera }),
  setCameraX: (x) => { camera.x = clamp(x, 0, WORLD.width - WORLD.viewWidth); },
  getArmyCap,
  getPlacementError,
  spawnUnit,
  updateGame,
  dealDamage,
  render: () => drawBattleScene(performance.now() / 1000),
  refreshHud: () => updateHud(true),
};

requestAnimationFrame(frame);
























































