"use strict";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const startButton = document.getElementById("startButton");

const W = canvas.width;
const H = canvas.height;
const CX = W / 2;
const lanes = [-1, 0, 1];
const debugMode = new URLSearchParams(window.location.search).get("debug") === "1";

const config = {
  fallTime: 0.9,
  reload: 1.6,
  life: 3,
  baseMaxCars: 2,
  birdSpeedU: 9.0,
  unit: H / 14,
  aimY: H * 0.62,
  spawnMaxYUnits: 11.5,
  removeYUnits: -4.2,
  fireWindowU: 0.16,
  laneGap: W * 0.205,
  roadW: W * 0.74,
  warningDuration: 0.5,
  swerveDuration: 0.7,
  speedEvasionDuration: 1.5,
  focusScale: 0.45,
  focusMax: 100,
  focusMinToStart: 20,
  focusRegenPerSecond: 10,
  focusDrainPerSecond: 33,
  quickBankDistance: 40,
  quickBankTime: 0.25,
  quickBankDuration: 0.15,
  quickBankCooldown: 1.0,
  maxPayloadTokens: 2,
  snackMinInterval: 20,
  snackMaxInterval: 30,
  snackTravelTime: 4,
  lunchDuration: 8,
};

const vehicleTypes = [
  { key: "open", label: "OPEN CAR", score: 1000, relSpeed: 2.5, size: 1, color: "#ff4fd8", weight: 50, target: true },
  { key: "limo", label: "LIMO", score: 600, relSpeed: 3.5, size: 1.45, color: "#60f6ff", weight: 20, target: false },
  { key: "bike", label: "BIKE", score: 2500, relSpeed: 1.5, size: 0.62, color: "#ffea4d", weight: 15, target: true },
  { key: "roof", label: "SUNROOF", score: 2000, relSpeed: 2.5, size: 1, color: "#9dff70", weight: 13, target: true },
  { key: "gold", label: "GOLD", score: 10000, relSpeed: 2.0, size: 1.05, color: "#ffc247", weight: 2, target: false },
];

const profiles = [
  "TARGET: IT CEO",
  "TARGET: NARCISSIST ACTOR",
  "TARGET: CRYPTO PRINCE",
  "TARGET: FLEX DRIVER",
  "TARGET: LUXURY BLOGGER",
];

const bombPhaseDurations = {
  cutin: 1.4,
  dive: 1.5,
  impact: 0.5,
  replay: 2.5,
  result: 1.0,
};

let state = makeState();
let lastTime = performance.now();
let roadOffset = 0;
let buildingOffset = 0;
let flash = 0;

function makeState() {
  return {
    mode: "ready",
    time: 0,
    score: 0,
    combo: 0,
    bestCombo: 0,
    life: config.life,
    bomb: 0,
    cooldown: 0,
    spawnCheckTimer: 0.1,
    cars: [],
    drops: [],
    splashes: [],
    popups: [],
    message: "TAP TO DROP",
    messageTimer: 0,
    profile: "",
    profileTimer: 0,
    pointer: null,
    bombCinematic: null,
    bombCinematicPlayed: false,
    hitstop: 0,
    reloadNagTimer: 0,
    quickBankCooldown: 0,
    quickBank: null,
    focus: null,
    focusGauge: config.focusMax,
    payloadTokens: 0,
    rookieOvershoots: 0,
    snacks: [],
    snackTimer: rand(config.snackMinInterval, config.snackMaxInterval),
    lunchBreak: 0,
    lunchSnackBurst: 0,
    lunchStartedPhase: 1,
    shots: 0,
    hits: 0,
    birdX: laneX(1),
    birdTargetX: laneX(1),
    bank: 0,
    lastPhase: 1,
  };
}

function resetGame() {
  state = makeState();
  state.mode = "playing";
  startButton.classList.add("hidden");
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function chooseVehicle() {
  const total = vehicleTypes.reduce((sum, v) => sum + v.weight, 0);
  let pick = Math.random() * total;
  for (const vehicle of vehicleTypes) {
    pick -= vehicle.weight;
    if (pick <= 0) return vehicle;
  }
  return vehicleTypes[0];
}

function laneX(laneIndex, drift = 0) {
  return CX + (lanes[laneIndex] + drift) * config.laneGap;
}

function laneScalarX(laneScalar, drift = 0) {
  return CX + (laneScalar - 1 + drift) * config.laneGap;
}

function nearestLaneIndex(x) {
  let best = 1;
  let bestDistance = Infinity;
  for (let lane = 0; lane < lanes.length; lane++) {
    const distance = Math.abs(x - laneX(lane));
    if (distance < bestDistance) {
      best = lane;
      bestDistance = distance;
    }
  }
  return best;
}

function screenYFromUnits(yUnits) {
  return config.aimY - yUnits * config.unit;
}

function scaleFromY(y) {
  if (y <= config.aimY) {
    const t = clamp((y - 120) / (config.aimY - 120), 0, 1);
    return lerp(0.78, 1.0, t);
  }
  const t = clamp((y - config.aimY) / (H - config.aimY), 0, 1);
  return lerp(1.0, 1.06, t);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function easeInQuad(t) {
  return t * t;
}

function easeOutQuad(t) {
  return 1 - (1 - t) * (1 - t);
}

function getPhase() {
  if (state.score >= 150000) return 5;
  if (state.score >= 80000) return 4;
  if (state.score >= 40000) return 3;
  if (state.score >= 15000) return 2;
  return 1;
}

function getTargetMinGap() {
  const phase = getPhase();
  if (phase <= 1) return 3.0;
  if (phase === 2) return 2.6;
  if (phase === 3) return 2.3;
  return 2.0;
}

function getSpeedBoost() {
  const phase = getPhase();
  if (phase === 1) return 0.85;
  const phaseBoost = phase <= 4 ? 1 + (phase - 1) * 0.1 : 1.3 + (phase - 4) * 0.05;
  return phaseBoost + Math.min(0.12, state.score / 500000);
}

function getMaxCars() {
  const phase = getPhase();
  if (phase >= 5) return 4;
  if (phase >= 3) return 3;
  return config.baseMaxCars;
}

function effectiveRelSpeed(car) {
  return Math.max(0.45, car.type.relSpeed + (car.speedDelta || 0)) * car.speedBoost;
}

function targetReleaseAt(car) {
  return state.time + timeToRelease(car);
}

function futureYUnits(car) {
  return car.yUnits - effectiveRelSpeed(car) * config.fallTime;
}

function timeToRelease(car) {
  return (car.yUnits - effectiveRelSpeed(car) * config.fallTime) / effectiveRelSpeed(car);
}

function getAim() {
  return { x: state.birdX, y: config.aimY, locked: getLockedCar() };
}

function getLockedCar() {
  let best = null;
  let bestScore = Infinity;

  for (const car of state.cars) {
    if (car.hit || car.overshot || car.yUnits <= -0.15) continue;
    const remaining = timeToRelease(car);
    const score = remaining >= 0 ? remaining : 100 + Math.abs(remaining);
    if (score < bestScore) {
      best = car;
      bestScore = score;
    }
  }

  return best;
}

function inFireWindow(locked) {
  if (!locked) return false;
  return Math.abs(futureYUnits(locked)) <= config.fireWindowU;
}

function awarenessReserveFor(carOrType) {
  const type = carOrType.type || carOrType;
  return getPhase() >= 2 && type.target ? 0.6 : 0;
}

function releaseGapBetween(type, existingCar) {
  if (type.target && existingCar.type.target) {
    return getTargetMinGap() + Math.max(awarenessReserveFor(type), awarenessReserveFor(existingCar));
  }
  return 1.2;
}

function releaseAtForNewCar(type, releaseDelay) {
  const speed = type.relSpeed * getSpeedBoost();
  return state.time + releaseDelay;
}

function yUnitsForReleaseDelay(type, releaseDelay) {
  return type.relSpeed * getSpeedBoost() * (releaseDelay + config.fallTime);
}

function trySpawnCar() {
  if (state.cars.length >= getMaxCars()) return false;

  const type = chooseVehicle();
  const speed = type.relSpeed * getSpeedBoost();
  const maxDelay = config.spawnMaxYUnits / speed - config.fallTime;
  const baseMin = type.target ? 2.1 : 0.9;
  const baseMax = type.target ? 3.2 : 2.4;
  let releaseDelay = clamp(rand(baseMin, baseMax), 0.5, maxDelay);
  let releaseAt = releaseAtForNewCar(type, releaseDelay);

  for (let guard = 0; guard < 24; guard++) {
    let shifted = false;
    for (const car of getAliveCarsForScheduling()) {
      const gap = releaseGapBetween(type, car);
      const existingRelease = targetReleaseAt(car);
      if (Math.abs(releaseAt - existingRelease) < gap) {
        releaseAt = existingRelease + gap;
        shifted = true;
      }
    }
    releaseDelay = releaseAt - state.time;
    if (releaseDelay > maxDelay) return false;
    if (!shifted) break;
  }

  const yUnits = yUnitsForReleaseDelay(type, releaseDelay);
  if (yUnits > config.spawnMaxYUnits) return false;
  spawnCar(type, yUnits);
  return true;
}

function getAliveCarsForScheduling() {
  return state.cars.filter((car) => !car.hit && !car.overshot && car.yUnits > -0.2);
}

function spawnCar(type, yUnits) {
  const lane = Math.floor(Math.random() * lanes.length);
  const idSource = globalThis.crypto && globalThis.crypto.randomUUID
    ? globalThis.crypto.randomUUID()
    : String(Math.random());
  const car = {
    id: idSource,
    type,
    speedBoost: getSpeedBoost(),
    lane,
    laneFloat: lane,
    laneStart: lane,
    laneEnd: lane,
    yUnits,
    hit: false,
    overshot: false,
    roofClosed: false,
    roofState: type.key === "roof" ? "open" : "",
    age: 0,
    wiggle: Math.random() * Math.PI * 2,
    awareness: "none",
    noticeChecked: false,
    evasionType: null,
    evasionDir: 0,
    warningTime: 0,
    evasionTime: 0,
    speedDelta: 0,
    focusUsed: false,
    bustedEligible: false,
    screen: { x: laneX(lane), y: -100 },
    w: 0,
    h: 0,
    hitW: 0,
    hitH: 0,
  };
  state.cars.push(car);

  if (type.key === "gold" || type.key === "bike" || type.key === "open") {
    state.profile = `${profiles[Math.floor(Math.random() * profiles.length)]} / REL ${type.relSpeed.toFixed(1)}U/S`;
    state.profileTimer = 2;
  }
}

function styleRank() {
  if (state.combo >= 25) return { label: "SSS", mult: 3 };
  if (state.combo >= 15) return { label: "S", mult: 2.5 };
  if (state.combo >= 10) return { label: "A", mult: 2 };
  if (state.combo >= 6) return { label: "B", mult: 1.6 };
  if (state.combo >= 3) return { label: "C", mult: 1.3 };
  return { label: "D", mult: 1 };
}

function fireDrop() {
  if (state.mode !== "playing" || isBombCinematicActive()) return;
  if (state.cooldown > 0) {
    if (state.reloadNagTimer <= 0) {
      state.popups.push({ x: state.birdX, y: config.aimY - 130, text: "RELOADING", life: 0.4, maxLife: 0.4, groundLocked: false });
      state.reloadNagTimer = 0.45;
    }
    return;
  }

  if (state.payloadTokens > 0) {
    state.payloadTokens -= 1;
    state.cooldown = 0;
  } else {
    state.cooldown = config.reload;
  }
  state.shots += 1;
  state.drops.push({
    x: state.birdX,
    y: config.aimY,
    t: 0,
    duration: config.fallTime,
  });
}

function isBombCinematicActive() {
  return Boolean(state.bombCinematic);
}

function isCarOnScreen(car) {
  return car.screen.y > -220 && car.screen.y < H + 220;
}

function snapshotCar(car) {
  return {
    id: car.id,
    typeKey: car.type.key,
    label: car.type.label,
    color: car.type.color,
    size: car.type.size,
    score: car.type.score,
    x: car.screen.x,
    y: car.screen.y,
    w: car.w,
    h: car.h,
    hitW: car.hitW,
    hitH: car.hitH,
    releaseDelta: Math.abs(timeToRelease(car)),
  };
}

function selectBombMainCar(candidates) {
  return candidates.reduce((best, car) => {
    if (!best) return car;
    if (car.type.score !== best.type.score) return car.type.score > best.type.score ? car : best;
    return Math.abs(timeToRelease(car)) < Math.abs(timeToRelease(best)) ? car : best;
  }, null);
}

function triggerBomb() {
  if (state.mode !== "playing" || state.bomb < 100 || isBombCinematicActive()) return;
  const targets = state.cars.filter((car) => !car.hit && !car.overshot && isCarOnScreen(car));
  const mainCar = selectBombMainCar(targets);
  if (!mainCar) {
    state.message = "NO TARGETS";
    state.messageTimer = 0.8;
    return;
  }

  const mainSnapshot = snapshotCar(mainCar);
  const hitSnapshots = targets.map(snapshotCar);
  state.bomb = 0;
  state.focus = null;
  state.message = "";
  state.messageTimer = 0;
  state.bombCinematic = {
    phase: "cutin",
    t: 0,
    total: 0,
    main: mainSnapshot,
    targetIds: hitSnapshots.map((car) => car.id),
    hits: hitSnapshots,
    hitApplied: false,
    hitCount: hitSnapshots.length,
    totalGain: 0,
    skippable: state.bombCinematicPlayed,
    profile: state.profile ? state.profile.split(" / ")[0] : profiles[Math.floor(Math.random() * profiles.length)],
  };
}

function updateBombCinematic(dt) {
  const cinematic = state.bombCinematic;
  if (!cinematic) return;

  cinematic.t += dt;
  cinematic.total += dt;

  if (cinematic.phase === "impact" && !cinematic.hitApplied && cinematic.t >= 0.2) {
    applyBombCinematicHits(cinematic);
  }

  if (cinematic.t < bombPhaseDurations[cinematic.phase]) return;

  if (cinematic.phase === "cutin") {
    enterBombPhase("dive");
  } else if (cinematic.phase === "dive") {
    enterBombPhase("impact");
  } else if (cinematic.phase === "impact") {
    if (!cinematic.hitApplied) applyBombCinematicHits(cinematic);
    enterBombPhase("replay");
  } else if (cinematic.phase === "replay") {
    enterBombPhase("result");
  } else {
    finishBombCinematic();
  }
}

function enterBombPhase(phase) {
  if (!state.bombCinematic) return;
  state.bombCinematic.phase = phase;
  state.bombCinematic.t = 0;
}

function applyBombCinematicHits(cinematic) {
  const scoreBefore = state.score;
  const popupStart = state.popups.length;
  const splashStart = state.splashes.length;
  for (const id of cinematic.targetIds) {
    const car = state.cars.find((candidate) => candidate.id === id);
    if (car && !car.hit && !car.overshot) awardHit(car, false, 1.5);
  }
  state.popups.length = popupStart;
  state.splashes.length = splashStart;
  state.hitstop = 0;
  cinematic.hitApplied = true;
  cinematic.totalGain = Math.max(0, state.score - scoreBefore);
  state.bomb = 0;
  state.message = "";
  state.messageTimer = 0;
  flash = 1;
  if (navigator.vibrate) navigator.vibrate([60, 35, 90, 35, 120]);
}

function skipBombCinematic() {
  const cinematic = state.bombCinematic;
  if (!cinematic || cinematic.phase !== "replay" || !cinematic.skippable) return false;
  enterBombPhase("result");
  return true;
}

function finishBombCinematic() {
  state.bombCinematicPlayed = true;
  state.bombCinematic = null;
  state.bomb = 0;
  state.message = "TARGET NEUTRALIZED";
  state.messageTimer = 0.8;
}

function awardHit(car, just, bombBonus = 1, specialLabel = "") {
  car.hit = true;
  state.hits += 1;
  state.combo += 1;
  state.bestCombo = Math.max(state.bestCombo, state.combo);
  const rank = styleRank();
  const bustedBonus = car.bustedEligible ? 1.5 : 1;
  const gain = Math.round(car.type.score * rank.mult * (just ? 3 : 1) * bombBonus * bustedBonus);
  state.score += gain;
  state.bomb = car.type.key === "gold" ? 100 : Math.min(100, state.bomb + (just ? 20 : 12));
  if (just || car.bustedEligible || specialLabel === "PIERCED!") {
    state.focusGauge = Math.min(config.focusMax, state.focusGauge + 25);
  }
  state.splashes.push({ x: car.screen.x, y: car.screen.y, r: 0, life: 0.55, maxLife: 0.55, color: car.type.color });
  const label = specialLabel || (just ? "JUST " : "HIT ");
  state.popups.push({ x: car.screen.x, y: car.screen.y - 46, text: `${label}+${gain}`, life: 0.75, maxLife: 0.75, groundLocked: true });
  if (car.bustedEligible) {
    state.popups.push({ x: car.screen.x, y: car.screen.y - 92, text: "BUSTED!", life: 0.85, maxLife: 0.85, groundLocked: true, color: "#ffea4d" });
  }
  state.message = specialLabel || (car.bustedEligible ? "BUSTED!" : just ? "JUST SNIPE" : "TARGET HIT");
  state.messageTimer = 0.8;
  state.hitstop = just ? 0.09 : 0.035;
  flash = just ? 1 : 0.45;
  if (navigator.vibrate) navigator.vibrate(just ? [30, 30, 45] : 25);
}

function resolveDrop(drop) {
  let best = null;
  let bestDistance = Infinity;

  for (const car of state.cars) {
    if (car.hit || car.overshot) continue;
    const dx = drop.x - car.screen.x;
    const dy = drop.y - car.screen.y;
    const rx = car.hitW * 0.5;
    const ry = car.hitH * 0.5;
    const normalized = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
    if (normalized <= 1 && normalized < bestDistance) {
      best = car;
      bestDistance = normalized;
    }
  }

  if (best) {
    const centerDistance = Math.hypot(drop.x - best.screen.x, drop.y - best.screen.y);
    const justRadius = Math.min(best.hitW, best.hitH) * 0.15;
    const just = centerDistance <= justRadius;
    if (best.type.key === "roof" && best.roofState === "closed") {
      if (just) {
        awardHit(best, true, 2, "PIERCED!");
      } else {
        state.popups.push({ x: best.screen.x, y: best.screen.y - 46, text: "DEFLECT", life: 0.75, maxLife: 0.75, groundLocked: true, color: "#dcecff" });
        state.splashes.push({ x: best.screen.x, y: best.screen.y, r: 0, life: 0.3, maxLife: 0.3, color: "#dcecff" });
        state.message = "DEFLECT";
        state.messageTimer = 0.55;
      }
    } else {
      awardHit(best, just);
    }
  } else {
    state.combo = 0;
    state.splashes.push({ x: drop.x, y: drop.y, r: 0, life: 0.38, maxLife: 0.38, color: "#dcecff" });
    state.popups.push({ x: drop.x, y: drop.y - 36, text: "MISS", life: 0.5, maxLife: 0.5, groundLocked: true });
    state.message = "SHOT WASTED";
    state.messageTimer = 0.55;
    maybeSpawnRecoverySnack();
  }
}

function update(realDt) {
  if (state.mode !== "playing") return;

  if (isBombCinematicActive()) {
    updateBombCinematic(realDt);
    flash = Math.max(0, flash - realDt * 2.6);
    return;
  }

  if (state.hitstop > 0) {
    state.hitstop -= realDt;
    return;
  }

  const worldScale = state.focus ? config.focusScale : 1;
  const dt = realDt * worldScale;

  state.time += dt;
  state.cooldown = Math.max(0, state.cooldown - realDt);
  state.spawnCheckTimer -= dt;
  state.messageTimer = Math.max(0, state.messageTimer - realDt);
  state.profileTimer = Math.max(0, state.profileTimer - realDt);
  state.reloadNagTimer = Math.max(0, state.reloadNagTimer - realDt);
  state.quickBankCooldown = Math.max(0, state.quickBankCooldown - realDt);
  flash = Math.max(0, flash - realDt * 2.6);

  updatePhaseMessage();
  updateFocus(realDt);

  const groundScrollPx = config.birdSpeedU * config.unit * dt;
  roadOffset = (roadOffset + groundScrollPx) % 210;
  buildingOffset = (buildingOffset + groundScrollPx * 1.35) % 360;

  if (state.lunchBreak > 0) {
    state.lunchBreak = Math.max(0, state.lunchBreak - dt);
    state.spawnCheckTimer = Math.max(state.spawnCheckTimer, 0.2);
    if (state.lunchBreak <= 0) {
      state.message = "REFUEL COMPLETE";
      state.messageTimer = 1.0;
    }
  } else if (state.spawnCheckTimer <= 0) {
    const spawned = trySpawnCar();
    state.spawnCheckTimer = spawned ? 0.45 : 0.22;
  }

  const locked = getLockedCar();
  updateBird(realDt, locked);
  updateAwareness(dt, locked);
  updateCars(dt);
  updateOvershoots();
  updateDrops(dt);
  updateSnacks(dt);
  updateEffects(dt, groundScrollPx);

  if (state.life <= 0) {
    state.mode = "gameover";
    state.message = "MISSION FAILED";
    state.messageTimer = 99;
    startButton.textContent = "RETRY SORTIE";
    startButton.classList.remove("hidden");
  }
}

function updatePhaseMessage() {
  const phase = getPhase();
  if (phase !== state.lastPhase) {
    state.lastPhase = phase;
    state.message = `PHASE ${String(phase).padStart(2, "0")}`;
    state.messageTimer = 1.1;
    startLunchBreak(phase);
  }
}

function startLunchBreak(phase) {
  if (phase <= 1 || state.lunchStartedPhase === phase) return;
  state.lunchStartedPhase = phase;
  state.lunchBreak = config.lunchDuration;
  state.lunchSnackBurst = 8 + Math.floor(Math.random() * 5);
  state.spawnCheckTimer = config.lunchDuration;
  state.message = "LUNCH BREAK";
  state.messageTimer = 1.4;
  for (let i = 0; i < state.lunchSnackBurst; i++) {
    spawnSnack(i * 0.45, true);
  }
}

function updateFocus(dt) {
  if (state.focus) {
    state.focusGauge = Math.max(0, state.focusGauge - config.focusDrainPerSecond * dt);
    if (state.focusGauge <= 0) {
      stopFocus();
    }
    return;
  }
  state.focusGauge = Math.min(config.focusMax, state.focusGauge + config.focusRegenPerSecond * dt);
}

function toggleFocus() {
  if (state.mode !== "playing") return;
  if (state.focus) {
    stopFocus();
    return;
  }
  if (state.focusGauge >= config.focusMinToStart) {
    state.focus = { manual: true };
    state.message = "HUNT FOCUS";
    state.messageTimer = 0.6;
  }
}

function stopFocus() {
  state.focus = null;
}

function updateBird(realDt, locked) {
  if (state.quickBank) {
    state.quickBank.t += realDt;
    const p = clamp(state.quickBank.t / state.quickBank.duration, 0, 1);
    const beforeX = state.birdX;
    state.birdX = lerp(state.quickBank.fromX, state.quickBank.toX, easeOutQuad(p));
    state.birdTargetX = state.quickBank.toX;
    state.bank = lerp(state.bank, Math.sign(state.quickBank.toX - state.quickBank.fromX) * 0.13, 0.35);
    if (p >= 1) state.quickBank = null;
    if (Math.abs(beforeX - state.birdX) > 0.01) return;
  }

  state.birdTargetX = locked ? laneScalarX(locked.laneFloat) : laneX(1);
  const beforeX = state.birdX;
  const maxMove = (config.laneGap / 0.6) * realDt;
  const delta = clamp(state.birdTargetX - state.birdX, -maxMove, maxMove);
  state.birdX += delta;
  const desiredBank = clamp((state.birdX - beforeX) / Math.max(1, maxMove), -1, 1) * 0.075;
  state.bank = lerp(state.bank, desiredBank, 0.22);
}

function updateAwareness(dt, locked) {
  if (!locked || getPhase() < 3 || !locked.type.target) return;
  if (locked.noticeChecked || locked.awareness !== "none") return;
  const releaseIn = timeToRelease(locked);
  if (releaseIn > 0.6 || releaseIn <= -0.15) return;

  locked.noticeChecked = true;
  const chance = Math.min(0.5, 0.2 + (getPhase() - 3) * 0.1);
  if (Math.random() > chance) return;

  const evasion = chooseEvasion(locked);
  locked.awareness = "warning";
  locked.evasionType = evasion.type;
  locked.evasionDir = evasion.dir;
  locked.warningTime = 0;
}

function chooseEvasion(car) {
  const options = [];
  for (const dir of [-1, 1]) {
    const lane = car.lane + dir;
    if (lane >= 0 && lane <= 2 && laneAvailable(lane, car)) options.push({ type: "swerve", dir });
  }
  const roll = Math.random();
  if (options.length && roll < 0.45) return options[Math.floor(Math.random() * options.length)];
  return roll < 0.72 ? { type: "brake", dir: 0 } : { type: "accel", dir: 0 };
}

function laneAvailable(lane, self) {
  return !state.cars.some((car) => (
    car !== self
    && !car.hit
    && !car.overshot
    && Math.round(car.laneFloat) === lane
    && Math.abs(car.yUnits - self.yUnits) < 1.2
  ));
}

function startEvasion(car) {
  car.awareness = "evading";
  car.evasionTime = 0;
  car.bustedEligible = true;

  if (car.evasionType === "swerve") {
    car.laneStart = car.laneFloat;
    car.laneEnd = clamp(car.lane + car.evasionDir, 0, 2);
  } else if (car.evasionType === "brake") {
    car.speedDelta = 1.5;
  } else if (car.evasionType === "accel") {
    car.speedDelta = -1.5;
  }

  car.focusUsed = true;
}

function updateCars(dt) {
  for (const car of state.cars) {
    car.age += dt;

    updateRoofState(car);

    updateCarEvasion(car, dt);

    car.yUnits -= effectiveRelSpeed(car) * dt;
    const drift = car.type.key === "bike" ? Math.sin(car.age * 5.2 + car.wiggle) * 0.13 : 0;
    const y = screenYFromUnits(car.yUnits);
    const scale = scaleFromY(y);
    car.screen = { x: laneScalarX(car.laneFloat, drift), y };
    car.w = 92 * scale * car.type.size;
    car.h = 150 * scale * car.type.size;
    car.hitW = car.w * (car.type.key === "bike" ? 0.95 : 1.08);
    car.hitH = car.h * 0.82;
  }
}

function updateRoofState(car) {
  if (car.type.key !== "roof" || car.hit) return;
  const cycle = car.age % 6.7;
  if (cycle < 3.5) {
    car.roofState = "open";
    car.roofClosed = false;
  } else if (cycle < 4.2) {
    car.roofState = "warning";
    car.roofClosed = false;
  } else {
    car.roofState = "closed";
    car.roofClosed = true;
  }
}

function updateCarEvasion(car, dt) {
  if (car.awareness === "warning") {
    car.warningTime += dt;
    if (car.warningTime >= config.warningDuration) startEvasion(car);
    return;
  }

  if (car.awareness !== "evading") return;

  car.evasionTime += dt;
  if (car.evasionType === "swerve") {
    const p = clamp(car.evasionTime / config.swerveDuration, 0, 1);
    car.laneFloat = lerp(car.laneStart, car.laneEnd, easeOutQuad(p));
    if (p >= 1) {
      car.lane = Math.round(car.laneEnd);
      car.laneFloat = car.lane;
      car.awareness = "done";
    }
  } else {
    if (car.evasionTime >= config.speedEvasionDuration) {
      car.speedDelta = 0;
      car.awareness = "done";
    }
  }
}

function updateOvershoots() {
  for (const car of state.cars) {
    if (car.yUnits < config.removeYUnits && !car.hit) {
      if (car.type.key === "roof" && car.roofState === "closed" && !car.overshot) {
        car.overshot = true;
        state.message = "DEFENDED";
        state.messageTimer = 0.8;
        state.popups.push({ x: car.screen.x, y: car.screen.y - 48, text: "DEFENDED", life: 0.75, maxLife: 0.75, groundLocked: true, color: "#9dff70" });
      } else if (car.type.target && !car.overshot) {
        car.overshot = true;
        if (state.rookieOvershoots < 3) {
          state.rookieOvershoots += 1;
          state.message = "ROOKIE PROTECTION";
        } else {
          state.life -= 1;
          state.combo = 0;
          state.message = "OVERSHOOT";
        }
        state.messageTimer = 0.8;
        maybeSpawnRecoverySnack();
        flash = 0.7;
      } else {
        car.hit = true;
      }
    }
  }

  state.cars = state.cars.filter((car) => car.yUnits > config.removeYUnits - 1.0 && !(car.hit && car.yUnits < -1.0));
}

function updateDrops(dt) {
  for (const drop of state.drops) {
    drop.t += dt;
    if (drop.t >= drop.duration && !drop.done) {
      drop.done = true;
      resolveDrop(drop);
    }
  }
  state.drops = state.drops.filter((drop) => drop.t < drop.duration + 0.1);
}

function updateSnacks(dt) {
  state.snackTimer -= dt;
  if (state.lunchBreak <= 0 && state.snackTimer <= 0) {
    spawnSnack(0, false);
    state.snackTimer = rand(config.snackMinInterval, config.snackMaxInterval);
  }

  const locked = getLockedCar();
  const marker = getBirdShadowMarker(locked);
  for (const snack of state.snacks) {
    snack.t += dt;
    const p = clamp((snack.t - snack.delay) / snack.duration, 0, 1);
    snack.x = lerp(snack.startX, snack.endX, p);
    snack.y = snack.baseY + Math.sin((p * Math.PI * 4) + snack.phase) * snack.amp;
    if (!snack.caught && snack.t >= snack.delay) {
      const markerHit = Math.hypot(snack.x - marker.x, snack.y - marker.y) < 86;
      const aimHit = Math.hypot(snack.x - state.birdX, snack.y - config.aimY) < 74;
      if (markerHit || aimHit) catchSnack(snack);
    }
    if (p >= 1 && snack.t >= snack.delay) snack.done = true;
  }
  state.snacks = state.snacks.filter((snack) => !snack.done);
}

function spawnSnack(delay = 0, lunch = false) {
  const dir = Math.random() < 0.5 ? 1 : -1;
  const yCenter = lunch ? rand(H * 0.28, H * 0.64) : rand(H * 0.32, H * 0.55);
  state.snacks.push({
    x: dir > 0 ? -80 : W + 80,
    y: yCenter,
    startX: dir > 0 ? -80 : W + 80,
    endX: dir > 0 ? W + 80 : -80,
    baseY: yCenter,
    amp: rand(18, 52),
    phase: rand(0, Math.PI * 2),
    t: 0,
    delay,
    duration: config.snackTravelTime,
    caught: false,
    done: false,
    lunch,
  });
}

function maybeSpawnRecoverySnack() {
  if (Math.random() < 0.5) spawnSnack(0, false);
}

function catchSnack(snack) {
  snack.caught = true;
  snack.done = true;
  if (state.payloadTokens < config.maxPayloadTokens) {
    state.payloadTokens += 1;
  } else {
    state.score += 500;
    state.bomb = Math.min(100, state.bomb + 5);
  }
  state.popups.push({ x: snack.x, y: snack.y - 30, text: "GULP!", life: 0.65, maxLife: 0.65, groundLocked: false, color: "#9dff70" });
}

function updateEffects(dt, groundScrollPx) {
  for (const splash of state.splashes) {
    splash.life -= dt;
    splash.r += dt * 210;
    splash.y += groundScrollPx;
  }
  state.splashes = state.splashes.filter((splash) => splash.life > 0 && splash.y < H + 160);

  for (const popup of state.popups) {
    popup.life -= dt;
    popup.y += popup.groundLocked ? groundScrollPx - dt * 24 : -dt * 64;
  }
  state.popups = state.popups.filter((popup) => popup.life > 0 && popup.y < H + 120);
}

function quickBank(direction) {
  if (state.quickBankCooldown > 0) return;
  const currentLane = nearestLaneIndex(state.birdX);
  const nextLane = clamp(currentLane + direction, 0, 2);
  if (nextLane === currentLane) return;
  state.quickBankCooldown = config.quickBankCooldown;
  state.quickBank = {
    fromX: state.birdX,
    toX: laneX(nextLane),
    t: 0,
    duration: config.quickBankDuration,
  };
}

function canvasPointFromEvent(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) * (W / rect.width),
    y: (event.clientY - rect.top) * (H / rect.height),
  };
}

function getBankButtonZones() {
  const top = config.aimY - 185;
  const height = 370;
  return [
    { direction: -1, x: 18, y: top, w: 112, h: height },
    { direction: 1, x: W - 130, y: top, w: 112, h: height },
  ];
}

function getBankButtonDirection(point) {
  for (const zone of getBankButtonZones()) {
    if (
      point.x >= zone.x
      && point.x <= zone.x + zone.w
      && point.y >= zone.y
      && point.y <= zone.y + zone.h
    ) {
      return zone.direction;
    }
  }
  return 0;
}

function getFocusButtonZone() {
  return { x: 36, y: H - 290, r: 72 };
}

function isInFocusButton(point) {
  const zone = getFocusButtonZone();
  return Math.hypot(point.x - zone.x, point.y - zone.y) <= zone.r;
}

function drawBackground() {
  const phase = getPhase();
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  if (phase === 1) {
    sky.addColorStop(0, "#102438");
    sky.addColorStop(0.42, "#172642");
    sky.addColorStop(1, "#08111b");
  } else if (phase === 2) {
    sky.addColorStop(0, "#2a1836");
    sky.addColorStop(0.5, "#30213d");
    sky.addColorStop(1, "#090811");
  } else {
    sky.addColorStop(0, "#071122");
    sky.addColorStop(0.38, "#10182a");
    sky.addColorStop(1, "#05070c");
  }
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  drawBuildings();

  ctx.fillStyle = "#101923";
  roundRect(CX - config.roadW / 2, 118, config.roadW, H + 140, 0);
  ctx.fill();

  const roadGlow = ctx.createLinearGradient(CX - config.roadW / 2, 0, CX + config.roadW / 2, 0);
  roadGlow.addColorStop(0, "rgba(80, 238, 255, 0.35)");
  roadGlow.addColorStop(0.08, "rgba(80, 238, 255, 0.05)");
  roadGlow.addColorStop(0.5, "rgba(255, 79, 216, 0.04)");
  roadGlow.addColorStop(0.92, "rgba(80, 238, 255, 0.05)");
  roadGlow.addColorStop(1, "rgba(80, 238, 255, 0.35)");
  ctx.fillStyle = roadGlow;
  ctx.fillRect(CX - config.roadW / 2, 118, config.roadW, H + 140);

  ctx.strokeStyle = "rgba(80, 238, 255, 0.72)";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(CX - config.roadW / 2, 118);
  ctx.lineTo(CX - config.roadW / 2, H);
  ctx.moveTo(CX + config.roadW / 2, 118);
  ctx.lineTo(CX + config.roadW / 2, H);
  ctx.stroke();

  drawLaneMarks();
  drawRoadMarkings();
}

function drawBuildings() {
  for (const side of [-1, 1]) {
    for (let i = -1; i < 8; i++) {
      const y = i * 360 + buildingOffset - 360;
      const w = 112 + ((i * 37) % 76);
      const h = 260 + ((i * 53) % 90);
      const x = side < 0 ? 0 : W - w;
      ctx.fillStyle = i % 2 === 0 ? "#11182b" : "#0c1324";
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = "rgba(83, 235, 255, 0.22)";
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 8, y + 8, w - 16, h - 16);
      ctx.fillStyle = "rgba(255, 234, 77, 0.18)";
      ctx.fillRect(x + 22, y + 38, w - 44, 18);
      ctx.fillStyle = "rgba(92, 247, 255, 0.13)";
      for (let vent = 0; vent < 3; vent++) {
        ctx.fillRect(x + 24 + vent * 31, y + h - 74, 20, 38);
      }
    }
  }
}

function drawLaneMarks() {
  ctx.strokeStyle = "rgba(230, 255, 255, 0.7)";
  ctx.lineWidth = 4;
  ctx.setLineDash([48, 56]);
  ctx.lineDashOffset = -roadOffset;
  for (const split of [-0.5, 0.5]) {
    const x = CX + split * config.laneGap;
    ctx.beginPath();
    ctx.moveTo(x, 110);
    ctx.lineTo(x, H + 120);
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

function drawRoadMarkings() {
  ctx.save();
  ctx.strokeStyle = "rgba(255, 79, 216, 0.18)";
  ctx.lineWidth = 3;
  for (let i = -1; i < 12; i++) {
    const y = i * 210 + roadOffset - 210;
    ctx.beginPath();
    ctx.moveTo(CX - config.roadW * 0.42, y);
    ctx.lineTo(CX + config.roadW * 0.42, y + 80);
    ctx.stroke();
  }
  ctx.restore();
}

function drawWorld() {
  ctx.save();
  ctx.translate(CX, config.aimY);
  ctx.rotate(state.bank);
  ctx.translate(-CX, -config.aimY);

  drawBackground();
  drawSnacks();
  drawImpactZone();
  drawCars();
  drawDrops();
  drawEffects();

  ctx.restore();
}

function drawSnacks() {
  for (const snack of state.snacks) {
    if (snack.t < snack.delay) continue;
    ctx.save();
    ctx.translate(snack.x, snack.y);
    ctx.rotate(Math.sin(state.time * 5 + snack.phase) * 0.28);
    ctx.shadowColor = "#9dff70";
    ctx.shadowBlur = 12;
    ctx.fillStyle = "#9dff70";
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.arc(-24 + i * 16, Math.sin(i + state.time * 8) * 4, 11, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#101923";
    ctx.beginPath();
    ctx.arc(25, -4, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawImpactZone() {
  const aim = getAim();
  const ready = state.cooldown <= 0;
  const hot = ready && inFireWindow(aim.locked);
  const pulse = Math.sin(state.time * 7) * 0.06 + 1;

  drawBirdShadowMarker(aim.locked, hot);

  ctx.save();
  ctx.translate(aim.x, aim.y);
  ctx.strokeStyle = hot ? "rgba(255, 79, 216, 0.98)" : ready ? "rgba(90, 239, 255, 0.9)" : "rgba(120, 150, 160, 0.72)";
  ctx.shadowColor = hot ? "#ff4fd8" : ready ? "#4eefff" : "transparent";
  ctx.shadowBlur = hot ? 28 : 18;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(0, 0, 88 * (hot ? pulse * 1.1 : pulse), 0, Math.PI * 2);
  ctx.stroke();

  const reload = 1 - state.cooldown / config.reload;
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.arc(0, 0, 110, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * reload);
  ctx.stroke();

  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-142, 0);
  ctx.lineTo(-52, 0);
  ctx.moveTo(52, 0);
  ctx.lineTo(142, 0);
  ctx.moveTo(0, -142);
  ctx.lineTo(0, -52);
  ctx.moveTo(0, 52);
  ctx.lineTo(0, 142);
  ctx.stroke();
  ctx.restore();

  if (!ready) {
    ctx.save();
    ctx.fillStyle = "rgba(233, 251, 255, 0.8)";
    ctx.font = "700 26px Consolas, monospace";
    ctx.textAlign = "center";
    ctx.fillText("RELOADING", aim.x, aim.y + 154);
    ctx.restore();
  }
}

function getBirdShadowMarker(locked) {
  const speed = locked ? effectiveRelSpeed(locked) : 2.5;
  return {
    x: state.birdX,
    y: config.aimY - speed * config.fallTime * config.unit,
    alpha: locked ? 0.52 : 0.18,
  };
}

function drawBirdShadowMarker(locked, hot) {
  const marker = getBirdShadowMarker(locked);
  const pulse = hot ? 1 + Math.sin(state.time * 18) * 0.08 : 1;
  const w = 150 * pulse;
  const h = 88 * pulse;

  ctx.save();
  ctx.translate(marker.x, marker.y);
  ctx.globalAlpha = marker.alpha;
  ctx.fillStyle = "rgba(0, 0, 0, 0.82)";
  ctx.strokeStyle = hot ? "rgba(255, 79, 216, 0.98)" : "rgba(90, 239, 255, 0.72)";
  ctx.shadowColor = hot ? "#ff4fd8" : "#4eefff";
  ctx.shadowBlur = hot ? 22 : 10;
  ctx.lineWidth = 4;

  ctx.beginPath();
  ctx.ellipse(0, 4, 22, 42, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(-12, -4);
  ctx.quadraticCurveTo(-74, -44, -w / 2, 2);
  ctx.quadraticCurveTo(-78, 20, -28, 24);
  ctx.quadraticCurveTo(-22, 10, -12, -4);
  ctx.moveTo(12, -4);
  ctx.quadraticCurveTo(74, -44, w / 2, 2);
  ctx.quadraticCurveTo(78, 20, 28, 24);
  ctx.quadraticCurveTo(22, 10, 12, -4);
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(0, -42);
  ctx.lineTo(-14, -12);
  ctx.lineTo(14, -12);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  if (hot) {
    ctx.save();
    ctx.fillStyle = "rgba(255, 79, 216, 0.95)";
    ctx.font = "900 30px Consolas, monospace";
    ctx.shadowColor = "#ff4fd8";
    ctx.shadowBlur = 18;
    ctx.textAlign = "center";
    ctx.fillText("FIRE!", marker.x, marker.y - h * 0.62);
    ctx.restore();
  }
}

function drawCars() {
  const cars = [...state.cars].sort((a, b) => b.yUnits - a.yUnits);
  const locked = getLockedCar();

  for (const car of cars) {
    if (car.screen.y < -220 || car.screen.y > H + 220) continue;
    const { x, y } = car.screen;
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = car.hit || car.overshot ? 0.35 : 1;
    ctx.shadowColor = car.type.color;
    ctx.shadowBlur = 16;

    const yaw = getCarYaw(car);
    ctx.rotate(yaw);

    const bodyRadius = 8;
    ctx.fillStyle = car.roofClosed ? "#54606b" : car.type.color;
    roundRect(-car.w / 2, -car.h / 2, car.w, car.h, bodyRadius);
    ctx.fill();

    ctx.fillStyle = "rgba(5, 7, 12, 0.78)";
    roundRect(-car.w * 0.3, -car.h * 0.22, car.w * 0.6, car.h * 0.38, 6);
    ctx.fill();

    if (car.type.key === "roof") {
      if (car.roofState === "warning" && Math.floor(car.age * 10) % 2 === 0) {
        ctx.strokeStyle = "#ffea4d";
        ctx.lineWidth = 5;
        ctx.strokeRect(-car.w * 0.34, -car.h * 0.28, car.w * 0.68, car.h * 0.5);
      } else if (car.roofState === "closed") {
        ctx.fillStyle = "rgba(210, 245, 255, 0.42)";
        roundRect(-car.w * 0.33, -car.h * 0.27, car.w * 0.66, car.h * 0.48, 6);
        ctx.fill();
        ctx.strokeStyle = "rgba(233, 251, 255, 0.82)";
        ctx.lineWidth = 3;
        ctx.strokeRect(-car.w * 0.33, -car.h * 0.27, car.w * 0.66, car.h * 0.48);
      }
    }

    drawCarLights(car);
    drawEvasionTell(car);

    if (car === locked || isBombCinematicActive() || car.awareness === "warning" || car.awareness === "evading") {
      const focusFlash = state.focus && (car === locked || car.awareness === "evading") && Math.sin(state.time * 30) > 0;
      ctx.strokeStyle = isBombCinematicActive() ? "#ff5d6c" : focusFlash ? "#ffffff" : car.awareness !== "none" && car.awareness !== "done" ? "#ffea4d" : "#51ffa8";
      ctx.lineWidth = 4;
      ctx.strokeRect(-car.hitW / 2, -car.hitH / 2, car.hitW, car.hitH);
      ctx.fillStyle = "#e9fbff";
      ctx.font = "700 20px Segoe UI";
      ctx.textAlign = "center";
      ctx.fillText(car === locked ? "LOCK" : "BOMB", 0, -car.hitH / 2 - 12);
    }

    ctx.fillStyle = "#e9fbff";
    ctx.font = "700 18px Segoe UI";
    ctx.textAlign = "center";
    ctx.fillText(car.type.label, 0, car.h / 2 + 24);
    ctx.restore();
  }
}

function getCarYaw(car) {
  if (car.awareness === "warning" && car.evasionType === "swerve") {
    return car.evasionDir * 0.12 * clamp(car.warningTime / config.warningDuration, 0, 1);
  }
  if (car.awareness === "evading" && car.evasionType === "swerve") {
    return car.evasionDir * 0.18 * Math.sin(clamp(car.evasionTime / config.swerveDuration, 0, 1) * Math.PI);
  }
  return 0;
}

function drawCarLights(car) {
  ctx.fillStyle = "rgba(255, 255, 255, 0.82)";
  ctx.fillRect(-car.w * 0.36, -car.h * 0.46, car.w * 0.2, car.h * 0.1);
  ctx.fillRect(car.w * 0.16, -car.h * 0.46, car.w * 0.2, car.h * 0.1);

  const brakeWarning = car.awareness === "warning" && car.evasionType === "brake";
  const brakeOn = brakeWarning ? Math.floor(car.warningTime / 0.125) % 2 === 0 : false;
  ctx.fillStyle = brakeOn ? "rgba(255, 30, 70, 1)" : "rgba(255, 30, 70, 0.8)";
  const lampH = brakeOn ? car.h * 0.13 : car.h * 0.08;
  ctx.fillRect(-car.w * 0.34, car.h * 0.38, car.w * 0.18, lampH);
  ctx.fillRect(car.w * 0.16, car.h * 0.38, car.w * 0.18, lampH);

  if (car.awareness === "warning" && car.evasionType === "accel") {
    ctx.fillStyle = "rgba(255, 190, 65, 0.9)";
    ctx.beginPath();
    ctx.moveTo(-car.w * 0.24, car.h * 0.5);
    ctx.lineTo(-car.w * 0.08, car.h * 0.77);
    ctx.lineTo(car.w * 0.08, car.h * 0.5);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(car.w * 0.08, car.h * 0.5);
    ctx.lineTo(car.w * 0.24, car.h * 0.77);
    ctx.lineTo(car.w * 0.38, car.h * 0.5);
    ctx.fill();
  }
}

function drawEvasionTell(car) {
  if (car.awareness !== "warning" && car.awareness !== "evading") return;

  ctx.save();
  ctx.fillStyle = "rgba(255, 234, 77, 0.95)";
  ctx.font = "900 30px Consolas, monospace";
  ctx.textAlign = "center";
  ctx.shadowColor = "#ffea4d";
  ctx.shadowBlur = 10;
  ctx.fillText("!?", 0, -car.h * 0.68);

  if (car.evasionType === "swerve") {
    ctx.beginPath();
    const dir = car.evasionDir;
    ctx.moveTo(dir * car.w * 0.2, -car.h * 0.58);
    ctx.lineTo(dir * car.w * 0.48, -car.h * 0.48);
    ctx.lineTo(dir * car.w * 0.24, -car.h * 0.36);
    ctx.fill();
  } else if (car.evasionType === "brake") {
    ctx.fillText("BRAKE", 0, -car.h * 0.86);
  } else if (car.evasionType === "accel") {
    ctx.fillText("BOOST", 0, -car.h * 0.86);
  }
  ctx.restore();
}

function drawDrops() {
  for (const drop of state.drops) {
    const p = Math.min(1, drop.t / drop.duration);
    const startY = H * 0.18;
    const y = startY + (drop.y - startY) * easeInQuad(p);
    const r = 38 - p * 22;

    ctx.save();
    ctx.globalAlpha = 0.95;
    ctx.fillStyle = "rgba(238, 252, 255, 0.94)";
    ctx.shadowColor = "#ffffff";
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.arc(drop.x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawEffects() {
  for (const splash of state.splashes) {
    const alpha = Math.max(0, splash.life / splash.maxLife);
    ctx.save();
    ctx.translate(splash.x, splash.y);
    ctx.scale(1.4, 0.45);
    ctx.strokeStyle = `rgba(${hexToRgb(splash.color)}, ${alpha})`;
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(0, 0, splash.r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  for (const popup of state.popups) {
    const alpha = Math.max(0, popup.life / popup.maxLife);
    ctx.fillStyle = popup.color ? `rgba(${hexToRgb(popup.color)}, ${alpha})` : `rgba(233, 251, 255, ${alpha})`;
    ctx.font = "800 38px Segoe UI";
    ctx.textAlign = "center";
    ctx.shadowColor = popup.color || "#42eaff";
    ctx.shadowBlur = 14;
    ctx.fillText(popup.text, popup.x, popup.y);
    ctx.shadowBlur = 0;
  }
}

function drawWings() {
  const flap = Math.sin(state.time * 8) * 18;
  const tilt = state.bank * 250;
  ctx.save();
  ctx.globalAlpha = 0.72;
  ctx.fillStyle = "rgba(8, 11, 18, 0.82)";
  ctx.strokeStyle = "rgba(80, 238, 255, 0.4)";
  ctx.lineWidth = 3;

  ctx.beginPath();
  ctx.moveTo(-40, config.aimY - 210 + tilt);
  ctx.quadraticCurveTo(135, config.aimY - 150 + flap + tilt, 220, config.aimY + 40 + tilt);
  ctx.quadraticCurveTo(92, config.aimY + 20 + tilt, -20, config.aimY + 130 + tilt);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(W + 40, config.aimY - 210 - tilt);
  ctx.quadraticCurveTo(W - 135, config.aimY - 150 + flap - tilt, W - 220, config.aimY + 40 - tilt);
  ctx.quadraticCurveTo(W - 92, config.aimY + 20 - tilt, W + 20, config.aimY + 130 - tilt);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawTargetQueue() {
  const cars = getAliveCarsForScheduling()
    .sort((a, b) => timeToRelease(a) - timeToRelease(b))
    .slice(0, 6);
  if (!cars.length) return;

  ctx.save();
  ctx.translate(44, 182);
  ctx.font = "700 18px Consolas, monospace";
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(233, 251, 255, 0.72)";
  ctx.fillText("QUEUE", 0, 0);
  for (let i = 0; i < cars.length; i++) {
    const car = cars[i];
    const x = 96 + i * 126;
    const t = timeToRelease(car);
    ctx.fillStyle = car.type.color;
    roundRect(x, -20, 34, 24, 4);
    ctx.fill();
    ctx.fillStyle = car.type.target ? "#e9fbff" : "rgba(233, 251, 255, 0.58)";
    ctx.fillText(`${Math.max(0, t).toFixed(1)}s`, x + 42, 0);
  }
  ctx.restore();
}

function drawPayloadTokens() {
  ctx.save();
  ctx.translate(state.birdX + 128, config.aimY - 42);
  ctx.font = "800 18px Consolas, monospace";
  ctx.textAlign = "left";
  ctx.fillStyle = "rgba(233, 251, 255, 0.75)";
  ctx.fillText("PAYLOAD", 0, -18);
  for (let i = 0; i < config.maxPayloadTokens; i++) {
    ctx.save();
    ctx.translate(i * 34, 10);
    ctx.globalAlpha = i < state.payloadTokens ? 1 : 0.25;
    ctx.fillStyle = "#9dff70";
    for (let j = 0; j < 3; j++) {
      ctx.beginPath();
      ctx.arc(j * 8, Math.sin(state.time * 8 + j) * 2, 7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  ctx.restore();
}

function drawFocusOverlay() {
  if (!state.focus) return;
  const gradient = ctx.createRadialGradient(CX, config.aimY, H * 0.12, CX, config.aimY, H * 0.76);
  gradient.addColorStop(0, "rgba(0, 0, 0, 0)");
  gradient.addColorStop(1, "rgba(0, 0, 0, 0.56)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.fillStyle = "rgba(233, 251, 255, 0.82)";
  ctx.font = "900 32px Consolas, monospace";
  ctx.textAlign = "center";
  ctx.shadowColor = "#ffffff";
  ctx.shadowBlur = 14;
  ctx.fillText("HUNT FOCUS", CX, H * 0.25);
  ctx.restore();
}

function drawBankButtons() {
  if (state.mode !== "playing") return;
  const zones = getBankButtonZones();
  const cooldown = state.quickBankCooldown > 0;

  for (const zone of zones) {
    const disabledEdge = (zone.direction < 0 && nearestLaneIndex(state.birdX) === 0)
      || (zone.direction > 0 && nearestLaneIndex(state.birdX) === 2);
    const active = !cooldown && !disabledEdge;
    const cx = zone.x + zone.w / 2;
    const cy = zone.y + zone.h / 2;

    ctx.save();
    ctx.globalAlpha = active ? 0.88 : 0.38;
    ctx.fillStyle = active ? "rgba(7, 19, 27, 0.76)" : "rgba(7, 19, 27, 0.48)";
    ctx.strokeStyle = active ? "rgba(80, 238, 255, 0.76)" : "rgba(120, 150, 160, 0.5)";
    ctx.lineWidth = 3;
    roundRect(zone.x, zone.y, zone.w, zone.h, 6);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = active ? "#e9fbff" : "rgba(233, 251, 255, 0.58)";
    ctx.shadowColor = active ? "#4eefff" : "transparent";
    ctx.shadowBlur = 12;
    ctx.beginPath();
    if (zone.direction < 0) {
      ctx.moveTo(cx - 24, cy);
      ctx.lineTo(cx + 20, cy - 40);
      ctx.lineTo(cx + 20, cy + 40);
    } else {
      ctx.moveTo(cx + 24, cy);
      ctx.lineTo(cx - 20, cy - 40);
      ctx.lineTo(cx - 20, cy + 40);
    }
    ctx.closePath();
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.font = "800 19px Consolas, monospace";
    ctx.textAlign = "center";
    ctx.fillText("BANK", cx, cy + 78);
    if (cooldown) {
      ctx.font = "700 18px Consolas, monospace";
      ctx.fillText(state.quickBankCooldown.toFixed(1), cx, cy + 104);
    }
    ctx.restore();
  }
}

function drawFocusButton() {
  if (state.mode !== "playing") return;
  const zone = getFocusButtonZone();
  const ready = state.focusGauge >= config.focusMinToStart;
  const active = Boolean(state.focus);
  const progress = state.focusGauge / config.focusMax;

  ctx.save();
  ctx.translate(zone.x, zone.y);
  ctx.globalAlpha = ready || active ? 0.95 : 0.48;
  ctx.fillStyle = active ? "rgba(255, 79, 216, 0.2)" : "rgba(7, 19, 27, 0.82)";
  ctx.strokeStyle = active ? "rgba(255, 79, 216, 0.95)" : "rgba(80, 238, 255, 0.74)";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(0, 0, zone.r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.strokeStyle = active ? "#ff4fd8" : "#9dff70";
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(0, 0, zone.r - 10, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
  ctx.stroke();

  ctx.fillStyle = "#e9fbff";
  ctx.font = "900 22px Consolas, monospace";
  ctx.textAlign = "center";
  ctx.fillText("FOCUS", 0, -4);
  ctx.font = "700 18px Consolas, monospace";
  ctx.fillText(`${Math.floor(state.focusGauge)}`, 0, 24);
  ctx.restore();
}

function drawDebugOverlay() {
  if (!debugMode) return;
  const cars = getAliveCarsForScheduling().sort((a, b) => targetReleaseAt(a) - targetReleaseAt(b));
  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 0.72)";
  ctx.fillRect(20, 250, 520, 34 + cars.length * 26);
  ctx.font = "700 18px Consolas, monospace";
  ctx.textAlign = "left";
  ctx.fillStyle = "#e9fbff";
  ctx.fillText(`DEBUG phase=${getPhase()} minGap=${getTargetMinGap().toFixed(1)} focus=${state.focusGauge.toFixed(0)}${state.focus ? "*" : ""} tokens=${state.payloadTokens} snacks=${state.snacks.length}`, 34, 274);
  for (let i = 0; i < cars.length; i++) {
    const car = cars[i];
    const next = cars[i + 1];
    const gap = next ? targetReleaseAt(next) - targetReleaseAt(car) : null;
    const minGap = next ? releaseGapBetween(next.type, car) : 0;
    const bad = gap !== null && gap < minGap - 0.01;
    ctx.fillStyle = bad ? "#ff5d6c" : car.type.color;
    const gapText = gap === null ? "--" : `${gap.toFixed(2)}/${minGap.toFixed(1)}`;
    ctx.fillText(`${car.type.key.padEnd(5)} rel=${Math.max(0, timeToRelease(car)).toFixed(2)} gap=${gapText}`, 34, 304 + i * 26);
  }
  ctx.restore();
}

function roundRect(x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function hexToRgb(hex) {
  const value = hex.replace("#", "");
  const bigint = parseInt(value, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `${r}, ${g}, ${b}`;
}

function drawHud() {
  const rank = styleRank();
  ctx.fillStyle = "rgba(4, 10, 18, 0.62)";
  ctx.fillRect(0, 0, W, 170);
  ctx.strokeStyle = "rgba(80, 238, 255, 0.45)";
  ctx.beginPath();
  ctx.moveTo(0, 170);
  ctx.lineTo(W, 170);
  ctx.stroke();

  ctx.fillStyle = "#e9fbff";
  ctx.font = "800 42px Segoe UI";
  ctx.textAlign = "left";
  ctx.fillText(`SCORE ${state.score.toLocaleString()}`, 44, 64);
  ctx.font = "700 30px Segoe UI";
  ctx.fillText(`COMBO ${state.combo}  x${rank.mult.toFixed(1)}`, 44, 112);
  ctx.fillText(`ALT 320m  SPD 96KMH`, 44, 154);

  ctx.textAlign = "right";
  ctx.fillText(`STYLE ${rank.label}`, W - 44, 64);
  ctx.fillText(`LIFE ${"|".repeat(Math.max(0, state.life))}`, W - 44, 112);

  ctx.strokeStyle = "rgba(80, 238, 255, 0.75)";
  ctx.strokeRect(W - 364, 126, 320, 22);
  ctx.fillStyle = state.bomb >= 100 ? "#ff4fd8" : "#51ffa8";
  ctx.fillRect(W - 360, 130, 312 * (state.bomb / 100), 14);

  drawTargetQueue();

  if (state.profileTimer > 0) {
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(255, 234, 77, 0.94)";
    ctx.font = "700 28px Consolas, monospace";
    ctx.fillText(state.profile, 44, 242);
  }

  if (state.quickBankCooldown > 0) {
    ctx.textAlign = "right";
    ctx.fillStyle = "rgba(233, 251, 255, 0.72)";
    ctx.font = "700 22px Consolas, monospace";
    ctx.fillText(`BANK ${state.quickBankCooldown.toFixed(1)}`, W - 44, 184);
  }

  if (state.messageTimer > 0 || state.mode !== "playing") {
    ctx.textAlign = "center";
    ctx.font = "900 56px Consolas, monospace";
    ctx.fillStyle = state.message.includes("MISS") || state.message.includes("WASTED") || state.message.includes("FAILED") || state.message.includes("OVERSHOOT")
      ? "#ff5d6c"
      : "#e9fbff";
    ctx.shadowColor = "#4eefff";
    ctx.shadowBlur = 22;
    ctx.fillText(state.message, CX, H * 0.36);
    ctx.shadowBlur = 0;
  }

  if (state.mode === "ready") {
    ctx.fillStyle = "rgba(233, 251, 255, 0.88)";
    ctx.font = "700 34px Segoe UI";
    ctx.textAlign = "center";
    ctx.fillText("Tap when your bird shadow touches the target.", CX, H * 0.54);
    ctx.fillText("Use BANK or Space focus for precise recoveries.", CX, H * 0.58);
  }

  if (state.mode === "gameover") {
    const accuracy = state.shots ? Math.round((state.hits / state.shots) * 100) : 0;
    ctx.fillStyle = "rgba(233, 251, 255, 0.9)";
    ctx.font = "700 34px Segoe UI";
    ctx.textAlign = "center";
    ctx.fillText(`BEST COMBO ${state.bestCombo} / ACCURACY ${accuracy}%`, CX, H * 0.48);
  }
}

function drawFlash() {
  if (flash <= 0) return;
  ctx.fillStyle = `rgba(85, 245, 255, ${flash * 0.15})`;
  ctx.fillRect(0, 0, W, H);
}

function drawBombCinematic() {
  const cinematic = state.bombCinematic;
  if (!cinematic) return;

  const shakePower = cinematic.phase === "impact"
    ? 16
    : cinematic.phase === "cutin"
      ? 5
      : 0;
  const sx = shakePower ? Math.sin(cinematic.total * 91) * shakePower : 0;
  const sy = shakePower ? Math.cos(cinematic.total * 73) * shakePower : 0;

  ctx.save();
  ctx.translate(sx, sy);
  if (cinematic.phase === "cutin") {
    drawBombCutin(cinematic);
  } else if (cinematic.phase === "dive") {
    drawBombDive(cinematic);
  } else if (cinematic.phase === "impact") {
    drawBombImpact(cinematic);
  } else if (cinematic.phase === "replay") {
    drawBombReplay(cinematic);
  } else if (cinematic.phase === "result") {
    drawBombResult(cinematic);
  }
  ctx.restore();
}

function drawBombCutin(cinematic) {
  if (cinematic.t < 0.2) {
    ctx.save();
    ctx.globalCompositeOperation = "difference";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(-40, -40, W + 80, H + 80);
    ctx.restore();
    return;
  }

  const p = easeOutQuad(clamp((cinematic.t - 0.2) / 1.2, 0, 1));
  ctx.fillStyle = "rgba(0, 0, 0, 0.82)";
  ctx.fillRect(-40, -40, W + 80, H + 80);
  drawSpeedLines(CX, H * 0.48, 580, 44, "rgba(255, 255, 255, 0.22)");

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(-80, 110);
  ctx.lineTo(W * 0.58, 70);
  ctx.lineTo(W * 0.42, H + 80);
  ctx.lineTo(-80, H + 80);
  ctx.closePath();
  ctx.clip();
  ctx.fillStyle = "rgba(255, 79, 216, 0.22)";
  ctx.fillRect(0, 0, W, H);
  ctx.translate(lerp(-320, 0, p), 0);
  drawCinematicBird(W * 0.28, H * 0.53, 1.9, "#05070c", "#ff4fd8");
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(W * 0.58, 70);
  ctx.lineTo(W + 80, 40);
  ctx.lineTo(W + 80, H + 80);
  ctx.lineTo(W * 0.42, H + 80);
  ctx.closePath();
  ctx.clip();
  ctx.fillStyle = "rgba(80, 238, 255, 0.18)";
  ctx.fillRect(0, 0, W, H);
  ctx.translate(lerp(320, 0, p), 0);
  drawTopCarSnapshot(cinematic.main, W * 0.72, H * 0.48, 1.85, true);
  drawDriverFace(W * 0.82, H * 0.34, 1.05, false);
  ctx.fillStyle = "#e9fbff";
  ctx.font = "900 32px Consolas, monospace";
  ctx.textAlign = "center";
  ctx.fillText(cinematic.main.label, W * 0.72, H * 0.68);
  ctx.restore();

  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "#ff4fd8";
  ctx.shadowBlur = 24;
  ctx.font = "900 46px Consolas, monospace";
  ctx.textAlign = "center";
  ctx.fillText(`CYBER PIGEON vs ${cinematic.profile}`, CX, H * 0.84);
  ctx.restore();
}

function drawBombDive(cinematic) {
  const p = clamp(cinematic.t / bombPhaseDurations.dive, 0, 1);
  const zoom = 1 + easeInQuad(p) * 5;

  ctx.fillStyle = `rgba(0, 0, 0, ${0.2 + p * 0.38})`;
  ctx.fillRect(-40, -40, W + 80, H + 80);

  ctx.save();
  ctx.beginPath();
  roundRect(86, 110, W - 172, H - 220, 8);
  ctx.clip();
  ctx.translate(CX, H * 0.5);
  ctx.scale(zoom, zoom);
  ctx.translate(-cinematic.main.x, -cinematic.main.y);
  drawBackground();
  drawCars();
  drawEffects();
  ctx.restore();

  drawSpeedLines(CX, H * 0.5, 650, 54, "rgba(80, 238, 255, 0.24)");
  ctx.save();
  ctx.strokeStyle = "#ff4fd8";
  ctx.lineWidth = 8;
  ctx.shadowColor = "#ff4fd8";
  ctx.shadowBlur = 22;
  ctx.strokeRect(86, 110, W - 172, H - 220);
  ctx.fillStyle = "#e9fbff";
  ctx.font = "900 38px Consolas, monospace";
  ctx.textAlign = "center";
  ctx.fillText(`DIVE ZOOM x${zoom.toFixed(1)}`, CX, 92);
  ctx.restore();

  if (cinematic.t > bombPhaseDurations.dive - 0.4) {
    const faceP = clamp((cinematic.t - (bombPhaseDurations.dive - 0.4)) / 0.4, 0, 1);
    ctx.save();
    ctx.globalAlpha = faceP;
    drawDriverFace(CX, H * 0.48, 2.2, true);
    ctx.fillStyle = "#ffea4d";
    ctx.font = "900 92px Consolas, monospace";
    ctx.textAlign = "center";
    ctx.fillText("!?", CX + 168, H * 0.36);
    ctx.restore();
  }
}

function drawBombImpact(cinematic) {
  ctx.fillStyle = "rgba(0, 0, 0, 0.64)";
  ctx.fillRect(-40, -40, W + 80, H + 80);
  drawTopCarSnapshot(cinematic.main, CX, H * 0.5, 2.1, true);

  if (cinematic.t >= 0.2 && cinematic.t < 0.35) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(-40, -40, W + 80, H + 80);
  } else if (cinematic.t >= 0.35) {
    ctx.save();
    ctx.translate(CX, H * 0.5);
    ctx.scale(1.8, 0.55);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 14;
    ctx.shadowColor = "#ffffff";
    ctx.shadowBlur = 36;
    ctx.beginPath();
    ctx.arc(0, 0, 150, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }
}

function drawBombReplay(cinematic) {
  const p = clamp(cinematic.t / bombPhaseDurations.replay, 0, 1);
  ctx.fillStyle = "#020408";
  ctx.fillRect(-40, -40, W + 80, H + 80);

  ctx.fillStyle = "#000000";
  ctx.fillRect(-40, -40, W + 80, 140);
  ctx.fillRect(-40, H - 140, W + 80, 180);

  ctx.fillStyle = "#e9fbff";
  ctx.font = "900 34px Consolas, monospace";
  ctx.textAlign = "left";
  ctx.fillText("INSTANT REPLAY REC", 44, 76);
  ctx.fillStyle = "#ff5d6c";
  ctx.beginPath();
  ctx.arc(372, 64, 11 + Math.sin(cinematic.total * 14) * 2, 0, Math.PI * 2);
  ctx.fill();

  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(233, 251, 255, 0.82)";
  ctx.font = "700 28px Consolas, monospace";
  ctx.fillText(`00:00:${Math.floor(cinematic.t * 24).toString().padStart(2, "0")}`, W - 44, 76);

  const roadY = H * 0.6;
  ctx.fillStyle = "#141b24";
  ctx.fillRect(0, roadY - 110, W, 220);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.45)";
  ctx.lineWidth = 5;
  ctx.setLineDash([80, 70]);
  ctx.beginPath();
  ctx.moveTo(0, roadY);
  ctx.lineTo(W, roadY);
  ctx.stroke();
  ctx.setLineDash([]);

  const carX = W * 0.54;
  const carY = roadY - 52;
  drawSideCarSnapshot(cinematic.main, carX, carY, 1.75);

  const fallP = clamp((p - 0.08) / 0.34, 0, 1);
  const dropX = carX - 18;
  const dropY = lerp(140, carY - 34, easeInQuad(fallP));
  if (fallP < 1) {
    ctx.save();
    ctx.fillStyle = "#ffffff";
    ctx.shadowColor = "#ffffff";
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.arc(dropX, dropY, 24 - fallP * 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  } else {
    ctx.save();
    ctx.translate(dropX, carY);
    ctx.scale(2.2, 0.62);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 14;
    ctx.shadowColor = "#ffffff";
    ctx.shadowBlur = 28;
    ctx.beginPath();
    ctx.arc(0, 0, 86 + Math.sin(cinematic.total * 24) * 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  if (p > 0.46) drawSpeechBubble(carX + 210, carY - 132, cinematic.profile);

  const popupCount = clamp(Math.floor((cinematic.t - 1.15) / 0.1) + 1, 0, cinematic.hitCount);
  for (let i = 0; i < popupCount; i++) {
    const snapshot = cinematic.hits[i] || cinematic.main;
    ctx.fillStyle = snapshot.color;
    ctx.font = "900 30px Consolas, monospace";
    ctx.textAlign = "right";
    ctx.shadowColor = snapshot.color;
    ctx.shadowBlur = 16;
    ctx.fillText(`+${Math.round(snapshot.score * 1.5).toLocaleString()}`, W - 72, 174 + i * 42);
  }
  ctx.shadowBlur = 0;

  if (cinematic.skippable) {
    ctx.fillStyle = "rgba(233, 251, 255, 0.62)";
    ctx.font = "700 24px Consolas, monospace";
    ctx.textAlign = "center";
    ctx.fillText("TAP TO SKIP", CX, H - 72);
  }
}

function drawBombResult(cinematic) {
  const p = easeOutQuad(clamp(cinematic.t / bombPhaseDurations.result, 0, 1));
  const bonus = Math.round(cinematic.totalGain * p);
  ctx.fillStyle = `rgba(0, 0, 0, ${0.72 + p * 0.18})`;
  ctx.fillRect(-40, -40, W + 80, H + 80);
  drawSpeedLines(CX, H * 0.52, 560, 36, "rgba(255, 234, 77, 0.18)");

  ctx.save();
  ctx.fillStyle = "#ffffff";
  ctx.shadowColor = "#ff4fd8";
  ctx.shadowBlur = 30;
  ctx.font = "900 72px Consolas, monospace";
  ctx.textAlign = "center";
  ctx.fillText("COMPLETE OUTDESTROY!", CX, H * 0.43);
  ctx.font = "900 48px Consolas, monospace";
  ctx.fillStyle = "#ffea4d";
  ctx.shadowColor = "#ffea4d";
  ctx.fillText(`HITS x${cinematic.hitCount} / BONUS +${bonus.toLocaleString()}`, CX, H * 0.52);
  ctx.restore();
}

function drawSpeedLines(cx, cy, radius, count, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  for (let i = 0; i < count; i++) {
    const a = (Math.PI * 2 * i) / count + state.time * 0.2;
    const inner = radius * 0.28;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
    ctx.lineTo(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
    ctx.stroke();
  }
  ctx.restore();
}

function drawCinematicBird(x, y, scale, fill, stroke) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.shadowColor = stroke;
  ctx.shadowBlur = 24;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.ellipse(0, 0, 34, 76, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-18, -12);
  ctx.quadraticCurveTo(-146, -92, -250, 18);
  ctx.quadraticCurveTo(-150, 52, -32, 42);
  ctx.moveTo(18, -12);
  ctx.quadraticCurveTo(146, -92, 250, 18);
  ctx.quadraticCurveTo(150, 52, 32, 42);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, -84);
  ctx.lineTo(-22, -32);
  ctx.lineTo(22, -32);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawTopCarSnapshot(car, x, y, scale, label) {
  const w = Math.max(80, car.w) * scale;
  const h = Math.max(130, car.h) * scale;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = car.color;
  ctx.shadowColor = car.color;
  ctx.shadowBlur = 28;
  roundRect(-w / 2, -h / 2, w, h, 12);
  ctx.fill();
  ctx.fillStyle = "rgba(5, 7, 12, 0.78)";
  roundRect(-w * 0.3, -h * 0.23, w * 0.6, h * 0.42, 8);
  ctx.fill();
  ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
  ctx.fillRect(-w * 0.34, -h * 0.44, w * 0.2, h * 0.08);
  ctx.fillRect(w * 0.14, -h * 0.44, w * 0.2, h * 0.08);
  if (label) {
    ctx.fillStyle = "#e9fbff";
    ctx.font = "900 24px Consolas, monospace";
    ctx.textAlign = "center";
    ctx.fillText(car.label, 0, h / 2 + 34);
  }
  ctx.restore();
}

function drawSideCarSnapshot(car, x, y, scale) {
  const w = 190 * car.size * scale;
  const h = 72 * car.size * scale;
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = car.color;
  ctx.shadowColor = car.color;
  ctx.shadowBlur = 20;
  roundRect(-w / 2, -h / 2, w, h, 10);
  ctx.fill();
  ctx.fillStyle = "rgba(5, 7, 12, 0.82)";
  roundRect(-w * 0.24, -h * 0.56, w * 0.46, h * 0.42, 8);
  ctx.fill();
  ctx.fillStyle = "#0b0f16";
  for (const wx of [-w * 0.32, w * 0.32]) {
    ctx.beginPath();
    ctx.arc(wx, h * 0.46, h * 0.23, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawDriverFace(x, y, scale, despair) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.fillStyle = "#ffe0a6";
  ctx.strokeStyle = despair ? "#ff5d6c" : "#e9fbff";
  ctx.shadowColor = despair ? "#ff5d6c" : "#4eefff";
  ctx.shadowBlur = 18;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(0, 0, 54, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#101923";
  ctx.beginPath();
  ctx.arc(-18, -12, despair ? 9 : 6, 0, Math.PI * 2);
  ctx.arc(18, -12, despair ? 9 : 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#101923";
  ctx.lineWidth = 6;
  ctx.beginPath();
  if (despair) {
    ctx.arc(0, 22, 19, Math.PI, Math.PI * 2);
  } else {
    ctx.moveTo(-18, 22);
    ctx.quadraticCurveTo(0, 32, 18, 22);
  }
  ctx.stroke();
  ctx.restore();
}

function drawSpeechBubble(x, y, text) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = "rgba(233, 251, 255, 0.94)";
  ctx.strokeStyle = "#ff4fd8";
  ctx.lineWidth = 4;
  roundRect(-156, -48, 312, 96, 8);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-80, 42);
  ctx.lineTo(-118, 84);
  ctx.lineTo(-52, 48);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#101923";
  ctx.font = "900 22px Consolas, monospace";
  ctx.textAlign = "center";
  ctx.fillText("NOOO!", 0, -8);
  ctx.font = "700 16px Consolas, monospace";
  ctx.fillText(text.replace("TARGET: ", ""), 0, 22);
  ctx.restore();
}

function render() {
  drawWorld();
  drawWings();
  drawFocusOverlay();
  drawPayloadTokens();
  drawFocusButton();
  drawBankButtons();
  drawHud();
  drawDebugOverlay();
  drawFlash();
  drawBombCinematic();
}

function loop(now) {
  const dt = Math.min(0.033, (now - lastTime) / 1000);
  lastTime = now;
  update(dt);
  render();
  requestAnimationFrame(loop);
}

function pointerDown(event) {
  event.preventDefault();
  if (state.mode === "ready" || state.mode === "gameover") return;
  const point = canvasPointFromEvent(event);
  state.pointer = {
    x: event.clientX,
    y: event.clientY,
    canvasX: point.x,
    canvasY: point.y,
    bankButtonDirection: getBankButtonDirection(point),
    focusButton: isInFocusButton(point),
    time: performance.now(),
  };
}

function pointerUp(event) {
  event.preventDefault();
  if (state.mode !== "playing" || !state.pointer) return;

  const held = (performance.now() - state.pointer.time) / 1000;
  const dx = event.clientX - state.pointer.x;
  const dy = event.clientY - state.pointer.y;
  const moved = Math.hypot(dx, dy);
  const point = canvasPointFromEvent(event);
  const bankButtonDirection = state.pointer.bankButtonDirection && getBankButtonDirection(point) === state.pointer.bankButtonDirection
    ? state.pointer.bankButtonDirection
    : 0;
  const focusButton = state.pointer.focusButton && isInFocusButton(point);
  state.pointer = null;

  if (skipBombCinematic()) return;

  if (focusButton) {
    toggleFocus();
    return;
  }

  if (bankButtonDirection) {
    quickBank(bankButtonDirection);
    return;
  }

  if (Math.abs(dx) >= config.quickBankDistance && held <= config.quickBankTime) {
    quickBank(dx > 0 ? 1 : -1);
    return;
  }

  if (held >= 0.5 && Math.abs(dx) < config.quickBankDistance && state.bomb >= 100) {
    triggerBomb();
    return;
  }

  if (moved < config.quickBankDistance || held < 0.3) {
    fireDrop();
  }
}

function keyDown(event) {
  if (state.mode !== "playing") return;
  if (event.code === "Space") {
    event.preventDefault();
    toggleFocus();
  } else if (event.code === "KeyA" || event.code === "ArrowLeft") {
    event.preventDefault();
    quickBank(-1);
  } else if (event.code === "KeyD" || event.code === "ArrowRight") {
    event.preventDefault();
    quickBank(1);
  }
}

startButton.addEventListener("click", resetGame);
canvas.addEventListener("pointerdown", pointerDown, { passive: false });
canvas.addEventListener("pointerup", pointerUp, { passive: false });
canvas.addEventListener("pointercancel", pointerUp, { passive: false });
window.addEventListener("keydown", keyDown);

if (debugMode) {
  globalThis.__skySniperDebug = {
    setBomb(value = 100) {
      state.bomb = clamp(value, 0, 100);
    },
    spawnTestCars() {
      const samples = [vehicleTypes[4], vehicleTypes[3], vehicleTypes[2]];
      for (let i = 0; i < samples.length; i++) {
        spawnCar(samples[i], 3.2 + i * 1.2);
      }
      updateCars(0);
    },
    triggerBomb,
    getState() {
      return {
        mode: state.mode,
        bomb: state.bomb,
        bombPhase: state.bombCinematic ? state.bombCinematic.phase : "",
        bombTime: state.bombCinematic ? state.bombCinematic.t : 0,
        score: state.score,
        cars: state.cars.length,
      };
    },
  };
}

requestAnimationFrame(loop);
