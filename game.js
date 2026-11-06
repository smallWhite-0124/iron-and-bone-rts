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
const camera = { x: 0, velocity: 0 };
const pressedKeys = new Set();
let toastTimer = 0;
let hintTimer = 0;
let hudAccumulator = 0;
let lastFrameTime = performance.now();
let nextId = 1;
let frameFailure = false;
const TARGET_FRAME_MS = 1000 / 60;
const MAX_PARTICLES = 420;
const AUTOSAVE_KEY = 'iron-and-bone-rts.autosave.v1';
const AUTOSAVE_VERSION = 1;
const AUTOSAVE_INTERVAL = 1.5;
const AUTOSAVE_MAX_AGE = 24 * 60 * 60 * 1000;
let autosaveAccumulator = 0;
let restoringSave = false;

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

function saveGame() {
  if (!state || state.ended || restoringSave) return;
  try {
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({
      version: AUTOSAVE_VERSION,
      savedAt: Date.now(),
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
    localStorage.removeItem(AUTOSAVE_KEY);
  } catch {
    // Storage may be unavailable.
  }
  autosaveAccumulator = 0;
}

function loadAutosave() {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (!raw) return null;
    const payload = JSON.parse(raw);
    if (payload.version !== AUTOSAVE_VERSION) throw new Error('Autosave version mismatch');
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
    const confirmed = window.confirm('放弃当前对局并重新开始？');
    if (!confirmed) return;
  }
  startGame(selectedFaction);
}

function startGame(factionId = selectedFaction, options = {}) {
  const resumeSnapshot = options.snapshot || null;
  if (!resumeSnapshot) clearAutosave();
  selectedFaction = resumeSnapshot?.player?.faction || factionId;
  const enemyFactionId = factionId === 'knight' ? 'skeleton' : 'knight';

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
    stepDustTimer: rand(0.05, 0.25),
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
  if (!def) return false;
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
    unit.moveBlend = Math.max(0, unit.moveBlend - dt * 8);
    unit.stepDustTimer -= dt;
    unit.commandFlash = Math.max(0, unit.commandFlash - dt);
    unit.chargeCooldown = Math.max(0, unit.chargeCooldown - dt);
    unit.impactCooldown = Math.max(0, unit.impactCooldown - dt);
    unit.spawnGrace = Math.max(0, unit.spawnGrace - dt);
    unit.retargetTimer = Math.max(0, unit.retargetTimer - dt);

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
    } else if (unit.attackCooldown <= 0) {
      performAttack(unit, target);
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
  unit.walkPhase += dt * (4.5 + unit.def.speed * 0.055) * (0.72 + Math.abs(dirX) * 0.28);

  if (!unit.def.flying && unit.stepDustTimer <= 0) {
    addParticles(unit.x - dirX * 10, unit.y - 2, '#b59a6a', 2, { speed: 18, size: 2, life: 0.28, gravity: -8 });
    unit.stepDustTimer = unit.def.drawType.includes('Horse') || unit.defId === 'boneDog' ? 0.12 : 0.22;
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
    spawnProjectile({
      side: unit.side,
      source: unit,
      target,
      x: unit.x,
      y: unit.y - (def.flying ? 180 : 52),
      damage: attack.damage,
      damageType: attack.damageType,
      speed: def.projectileSpeed || 430,
      color: def.projectileColor || '#f4d787',
      size: def.drawType === 'boneDragon' ? 8 : def.damageType === 'magic' ? 6 : 3,
      aoeRadius: def.aoeRadius || 0,
    });
    return;
  }

  const survived = dealDamage(unit, target, attack.damage, attack.damageType);
  addParticles(target.x, target.y - (target.isBuilding ? target.height * 0.35 : target.def?.flying ? 185 : 30), def.faction === 'skeleton' ? '#c6b5e8' : '#ffd98d', 8, {
    speed: 110,
    size: 2.5,
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
  target.hitFlash = 0.13;

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
        dealDamage(projectile.source, unit, projectile.damage, projectile.damageType);
      }
    }
    if (target.isBuilding) {
      dealDamage(projectile.source, target, projectile.damage, projectile.damageType);
    }
    addParticles(target.x, target.y - (target.def?.flying ? 180 : 35), '#ffb867', 24, { speed: 135 });
    addRing(target.x, target.y - 25, '#ffac61', 14, 0.5);
    return;
  }

  dealDamage(projectile.source, target, projectile.damage, projectile.damageType);
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
      vx: rand(-1, 1) * (options.speed ?? 55),
      vy: rand(-1, 0.2) * (options.speed ?? 55),
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
  ctx.fillStyle = '#9ed0d8';
  ctx.fillRect(0, 0, WORLD.width, 392);
  ctx.fillStyle = '#c7dfc8';
  ctx.fillRect(0, 392, WORLD.width, 152);
  ctx.fillStyle = '#b8d2b4';
  ctx.fillRect(0, 544, WORLD.width, WORLD.battlefieldFarY - 510);

  ctx.save();
  ctx.fillStyle = '#ffe4a0';
  ctx.strokeStyle = '#5a4934';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(1245, 128, 47, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  drawClouds(time);
  drawMountains();
  drawDistantRuins();
  drawGround(time);
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
    ctx.beginPath();
    ctx.moveTo(-58, 12);
    ctx.quadraticCurveTo(-76, -4, -48, -18);
    ctx.quadraticCurveTo(-30, -44, 3, -27);
    ctx.quadraticCurveTo(31, -48, 52, -18);
    ctx.quadraticCurveTo(84, -12, 74, 12);
    ctx.closePath();
    ctx.fill();
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
  } else {
    drawSkeletonBase(base);
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
    else drawSkeletonMine(building);
  } else if (building.type === 'barracks') {
    if (building.faction === 'knight') drawKnightBarracks(building);
    else drawSkeletonBarracks(building);
  } else if (building.type === 'tower') {
    if (building.faction === 'knight') drawKnightTower(building);
    else drawSkeletonTower(building);
  }

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
function drawUnit(unit, time) {
  if (unit.dead) return;
  const def = unit.def;
  const selected = selectedUnits.includes(unit);
  const facing = unit.side === 'player' ? 1 : -1;
  const stepBob = Math.abs(Math.sin(unit.walkPhase)) * 2.4 * unit.moveBlend;
  const bob = def.flying ? Math.sin(time * 2.6 + unit.bobSeed) * 4 : idleBreath(unit, time) + stepBob;
  const down = unit.downTimer > 0;

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
  ctx.ellipse(unit.x, unit.y + 1, def.flying ? 31 : def.radius * (0.9 + unit.moveBlend * 0.16), def.flying ? 7 : 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.save();
  const lunge = unit.def.damageType === 'melee' ? attackPulse(unit) * 5 : 0;
  const visualY = unit.y - (def.flying ? 150 : 0);
  ctx.translate(unit.x + facing * lunge, visualY + bob);
  ctx.shadowColor = '#241a13';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 2;
  ctx.shadowOffsetY = 3;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (down) {
    ctx.translate(0, -2);
    ctx.rotate(unit.side === 'player' ? -1.16 : 1.16);
    ctx.translate(-6, -4);
  }
  const depthScale = 0.82 + clamp((unit.y - WORLD.battlefieldFarY) / (WORLD.battlefieldNearY - WORLD.battlefieldFarY), 0, 1) * 0.24;
  ctx.scale(facing * depthScale, depthScale);
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
    default:
      break;
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
  const stride = Math.sin(phase) * 4.5 * move;
  const armSwing = Math.sin(phase + Math.PI) * 4 * move;
  const stepLift = Math.abs(Math.sin(phase)) * 1.3 * move;
  const ink = '#241a13';
  ctx.translate(0, -stepLift);

  ctx.strokeStyle = ink;
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-5, -20);
  ctx.lineTo(-9 + stride, -2);
  ctx.moveTo(5, -20);
  ctx.lineTo(9 - stride, -2);
  ctx.stroke();

  ctx.fillStyle = colors.armor;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(-13, -47);
  ctx.lineTo(-9, -53);
  ctx.lineTo(9, -53);
  ctx.lineTo(14, -44);
  ctx.lineTo(10, -26);
  ctx.lineTo(-10, -26);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = ink;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(-10, -43);
  ctx.lineTo(-18 + armSwing * 0.35, -31 + stride * 0.3);
  ctx.moveTo(10, -43);
  ctx.lineTo(18 - armSwing * 0.35, -32 - stride * 0.3);
  ctx.stroke();

  ctx.fillStyle = colors.skin;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(0, -61, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = colors.helmet;
  ctx.beginPath();
  ctx.arc(0, -63, 10, Math.PI, Math.PI * 2);
  ctx.lineTo(10, -59);
  ctx.lineTo(-10, -59);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#241a13';
  ctx.beginPath();
  ctx.arc(3, -61, 1.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
function drawSwordKnight(unit, time) {
  const colors = { body: '#4c6b96', armor: '#8fa5be', legs: '#313b4a', skin: '#d6b89e', helmet: '#748ba3', visor: '#182330' };
  drawHumanoidBase(colors, unit);
  const swing = attackSwingCurve(unit);
  const attack = 0.18 + swing;
  const pulse = attackPulse(unit);

  if (pulse > 0.12) {
    ctx.save();
    ctx.globalAlpha = pulse * 0.34;
    ctx.strokeStyle = '#fff0b0';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(13, -35, 38, -1.0, 0.35);
    ctx.stroke();
    ctx.restore();
  }

  ctx.save();
  ctx.translate(12, -35);
  ctx.rotate(attack);
  ctx.strokeStyle = '#241a13';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(34, 0);
  ctx.stroke();
  ctx.strokeStyle = '#eef2f5';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(34, 0);
  ctx.stroke();
  ctx.strokeStyle = '#e9c36b';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(0, -7);
  ctx.lineTo(0, 7);
  ctx.stroke();
  ctx.restore();
}
function drawShieldKnight(unit, time) {
  const colors = { body: '#3d587d', armor: '#b1c0d1', legs: '#293241', skin: '#d8b99d', helmet: '#7e91a6', visor: '#121c27' };
  drawHumanoidBase(colors, unit, 1.06);
  const brace = Math.sin(unit.walkPhase) * 0.05 * unit.moveBlend + attackPulse(unit) * 0.12;
  const swing = attackSwingCurve(unit);

  ctx.save();
  ctx.translate(14, -34);
  ctx.rotate(-0.08 + brace);
  ctx.fillStyle = '#3e78bd';
  ctx.strokeStyle = '#241a13';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-3, -14);
  ctx.lineTo(11, -9);
  ctx.lineTo(12, 11);
  ctx.quadraticCurveTo(4, 21, -3, 14);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = '#e9c36b';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(4, -8);
  ctx.lineTo(4, 10);
  ctx.moveTo(-1, 1);
  ctx.lineTo(9, 1);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.translate(8, -34);
  ctx.rotate(-0.55 + swing * 0.8);
  ctx.strokeStyle = '#241a13';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(37, 0);
  ctx.stroke();
  ctx.strokeStyle = '#eef2f5';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(37, 0);
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

  ctx.strokeStyle = ink;
  ctx.lineWidth = heavy ? 7 : 6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-16, -17);
  ctx.lineTo(-23 + strideA, 0);
  ctx.moveTo(-4, -18);
  ctx.lineTo(1 - strideB, 0);
  ctx.moveTo(20, -18);
  ctx.lineTo(28 + strideB, 0);
  ctx.moveTo(30, -18);
  ctx.lineTo(38 - strideA, 0);
  ctx.stroke();

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

  ctx.strokeStyle = ink;
  ctx.lineWidth = heavy ? 7 : 6;
  ctx.beginPath();
  ctx.moveTo(4, riderY + 6);
  ctx.lineTo(54 + thrust, riderY - 20 + thrust * 0.08);
  ctx.stroke();
  ctx.strokeStyle = heavy ? '#d8e1eb' : '#d8c596';
  ctx.lineWidth = heavy ? 3 : 2.5;
  ctx.beginPath();
  ctx.moveTo(4, riderY + 6);
  ctx.lineTo(54 + thrust, riderY - 20 + thrust * 0.08);
  ctx.stroke();

  ctx.fillStyle = heavy ? '#e9c36b' : '#cfc09a';
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(54 + thrust, riderY - 20 + thrust * 0.08);
  ctx.lineTo(69 + thrust, riderY - 25 + thrust * 0.08);
  ctx.lineTo(58 + thrust, riderY - 13 + thrust * 0.08);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

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
  const p = attackProgress(unit);
  const recoil = p > 0 && p < 0.52 ? attackPulse(unit) * 5 : 0;

  ctx.save();
  ctx.translate(4 - recoil, -38);
  ctx.rotate(-0.03 + (p > 0 ? Math.sin(p * Math.PI * 2) * 0.015 : 0));
  ctx.strokeStyle = '#241a13';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(-6, 5);
  ctx.lineTo(44, -7);
  ctx.stroke();
  ctx.strokeStyle = '#8a6844';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-6, 5);
  ctx.lineTo(44, -7);
  ctx.stroke();
  ctx.strokeStyle = '#eef2f5';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(20, -3);
  ctx.lineTo(49, -8);
  ctx.stroke();

  if (p > 0 && p < 0.34) {
    ctx.fillStyle = '#ffd778';
    ctx.strokeStyle = '#241a13';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(53, -8, 7 + p * 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}
function drawPaladin(unit, time) {
  ctx.save();
  ctx.scale(1.15, 1.15);
  const colors = { body: '#b6c2d1', armor: '#e1e7ef', legs: '#4c5968', skin: '#e0c3a9', helmet: '#d6c076', visor: '#28313c' };
  const flutter = Math.sin(unit.walkPhase * 0.8) * 4 * unit.moveBlend;
  drawHumanoidBase(colors, unit);
  ctx.strokeStyle = '#f1d373';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-13, -47);
  ctx.lineTo(13, -47);
  ctx.moveTo(-10, -28);
  ctx.lineTo(10, -28);
  ctx.stroke();

  ctx.save();
  ctx.translate(14, -34);
  ctx.rotate(-0.04 + Math.sin(unit.walkPhase) * 0.04 * unit.moveBlend);
  ctx.fillStyle = '#e9c36b';
  ctx.strokeStyle = '#241a13';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-3, -15);
  ctx.lineTo(13, -20);
  ctx.lineTo(15, 2);
  ctx.quadraticCurveTo(7, 14, -2, 11);
  ctx.lineTo(-5, -4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#a87524';
  ctx.fillRect(4, -11, 4, 17);
  ctx.fillRect(-1, -4, 14, 4);
  ctx.restore();

  ctx.save();
  ctx.translate(-5, -38);
  ctx.rotate(-0.95 + attackSwingCurve(unit) * 1.1);
  ctx.strokeStyle = '#241a13';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-39, -27);
  ctx.stroke();
  ctx.strokeStyle = '#f8f1d8';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-39, -27);
  ctx.stroke();
  ctx.fillStyle = '#e9c36b';
  ctx.strokeStyle = '#241a13';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-39 + flutter * 0.2, -27);
  ctx.lineTo(-30, -38);
  ctx.lineTo(-32, -20);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  ctx.restore();
}
function drawSkeletonFrame(unit, color = '#eadfc7') {
  const ink = '#241a13';
  const phase = unit.walkPhase;
  const move = unit.moveBlend;
  const stride = Math.sin(phase) * 4.5 * move;
  const armSwing = Math.sin(phase + Math.PI) * 3.5 * move;
  const bob = Math.abs(Math.sin(phase)) * 1.2 * move;

  ctx.save();
  ctx.translate(0, -bob);
  const drawBoneLines = () => {
    ctx.beginPath();
    ctx.moveTo(0, -25);
    ctx.lineTo(0, -49);
    ctx.moveTo(-10, -42);
    ctx.lineTo(10, -42);
    ctx.moveTo(-8, -36);
    ctx.lineTo(8, -36);
    ctx.moveTo(-7, -30);
    ctx.lineTo(7, -30);
    ctx.moveTo(-4, -22);
    ctx.lineTo(-9 + stride, -3);
    ctx.moveTo(4, -22);
    ctx.lineTo(9 - stride, -3);
    ctx.moveTo(-9, -43);
    ctx.lineTo(-17 + armSwing, -30);
    ctx.moveTo(9, -43);
    ctx.lineTo(17 - armSwing, -31);
  };

  ctx.lineCap = 'round';
  ctx.strokeStyle = ink;
  ctx.lineWidth = 6;
  drawBoneLines();
  ctx.stroke();

  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  drawBoneLines();
  ctx.stroke();

  ctx.fillStyle = color;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(0, -58, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#241a13';
  ctx.beginPath();
  ctx.ellipse(-3.5, -59, 2.2, 3.3, 0, 0, Math.PI * 2);
  ctx.ellipse(3.5, -59, 2.2, 3.3, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(-4, -52, 8, 2);
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

  ctx.save();
  ctx.translate(2, -36);
  ctx.rotate(-0.28 + swing * 0.85);
  ctx.strokeStyle = '#241a13';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(22, 0);
  ctx.stroke();
  ctx.strokeStyle = '#d7c49e';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(22, 0);
  ctx.stroke();
  ctx.fillStyle = '#f0e2c4';
  ctx.strokeStyle = '#241a13';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(21, -5);
  ctx.lineTo(33, -9);
  ctx.lineTo(29, 0);
  ctx.lineTo(36, 6);
  ctx.lineTo(21, 4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
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

  ctx.save();
  ctx.translate(11, -35);
  ctx.rotate(-0.08 - cast * 0.18);
  ctx.strokeStyle = ink;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(11, -25);
  ctx.stroke();
  ctx.strokeStyle = '#7d654f';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(11, -25);
  ctx.stroke();

  const orbPulse = 0.65 + Math.sin(time * 3 + unit.bobSeed) * 0.12 + cast * 0.2;
  ctx.fillStyle = `rgba(117, 239, 200, ${orbPulse})`;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(11, -30, 6 + cast * 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  if (cast > 0.12) {
    ctx.strokeStyle = `rgba(117, 239, 200, ${0.4 * cast})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(11, -30, 14 + cast * 10, 0, Math.PI * 2);
    ctx.stroke();
  }
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
  ctx.translate(-camera.x, 0);
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
    if (state && !paused && !state.ended) {
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
  refreshHud: () => updateHud(true),
};

requestAnimationFrame(frame);
























































