"use strict";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const startButton = document.getElementById("startButton");

const W = canvas.width;
const H = canvas.height;
const CX = W / 2;
const lanes = [-1, 0, 1];

const config = {
  fallTime: 0.9,
  reload: 1.6,
  life: 3,
  spawnMin: 2.0,
  spawnMax: 3.0,
  baseMaxCars: 2,
  birdSpeedU: 9.0,
  unit: H / 14,
  aimY: H * 0.62,
  spawnYUnits: 10.2,
  removeYUnits: -4.2,
  fireWindowU: 0.12,
  laneGap: W * 0.205,
  roadW: W * 0.74,
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
    spawnTimer: 0.6,
    cars: [],
    drops: [],
    splashes: [],
    popups: [],
    message: "TAP TO DROP",
    messageTimer: 0,
    profile: "",
    profileTimer: 0,
    holdTime: 0,
    bombActive: 0,
    hitstop: 0,
    reloadNagTimer: 0,
    shots: 0,
    hits: 0,
    birdX: laneX(1),
    birdTargetX: laneX(1),
    bank: 0,
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

function getSpeedBoost() {
  return 1 + Math.min(0.25, state.score / 250000);
}

function getMaxCars() {
  return config.baseMaxCars + (state.score >= 60000 ? 1 : 0);
}

function getAim() {
  return { x: state.birdX, y: config.aimY, locked: getLockedCar() };
}

function futureYUnits(car) {
  return car.yUnits - car.type.relSpeed * getSpeedBoost() * config.fallTime;
}

function timeToRelease(car) {
  const speed = car.type.relSpeed * getSpeedBoost();
  return (car.yUnits - speed * config.fallTime) / speed;
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

function spawnCar() {
  if (state.cars.length >= getMaxCars()) return;
  const type = chooseVehicle();
  const lane = Math.floor(Math.random() * lanes.length);
  const idSource = globalThis.crypto && globalThis.crypto.randomUUID
    ? globalThis.crypto.randomUUID()
    : String(Math.random());
  const car = {
    id: idSource,
    type,
    lane,
    yUnits: config.spawnYUnits + rand(0, 1.5),
    hit: false,
    overshot: false,
    age: 0,
    wiggle: Math.random() * Math.PI * 2,
    screen: { x: laneX(lane), y: -100 },
    w: 0,
    h: 0,
    hitW: 0,
    hitH: 0,
  };
  state.cars.push(car);

  if (type.key === "gold" || type.key === "bike") {
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
  if (state.mode !== "playing" || state.bombActive > 0) return;
  if (state.cooldown > 0) {
    if (state.reloadNagTimer <= 0) {
      state.popups.push({ x: state.birdX, y: config.aimY - 130, text: "RELOADING", life: 0.4, groundLocked: false });
      state.reloadNagTimer = 0.45;
    }
    return;
  }

  state.cooldown = config.reload;
  state.shots += 1;
  state.drops.push({
    x: state.birdX,
    y: config.aimY,
    t: 0,
    duration: config.fallTime,
  });
}

function triggerBomb() {
  if (state.mode !== "playing" || state.bomb < 100 || state.bombActive > 0) return;
  state.bomb = 0;
  state.bombActive = 2.5;
  state.message = "DIVE MODE INITIATED";
  state.messageTimer = 2.5;
  for (const car of state.cars) {
    if (!car.hit) awardHit(car, false, 1.5);
  }
}

function awardHit(car, just, bombBonus = 1) {
  car.hit = true;
  state.hits += 1;
  state.combo += 1;
  state.bestCombo = Math.max(state.bestCombo, state.combo);
  const rank = styleRank();
  const gain = Math.round(car.type.score * rank.mult * (just ? 3 : 1) * bombBonus);
  state.score += gain;
  state.bomb = car.type.key === "gold" ? 100 : Math.min(100, state.bomb + (just ? 20 : 12));
  state.splashes.push({ x: car.screen.x, y: car.screen.y, r: 0, life: 0.55, maxLife: 0.55, color: car.type.color });
  state.popups.push({ x: car.screen.x, y: car.screen.y - 46, text: `${just ? "JUST " : "HIT "}+${gain}`, life: 0.75, groundLocked: true });
  state.message = just ? "JUST SNIPE" : "TARGET HIT";
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
    awardHit(best, centerDistance <= justRadius);
  } else {
    state.combo = 0;
    state.splashes.push({ x: drop.x, y: drop.y, r: 0, life: 0.38, maxLife: 0.38, color: "#dcecff" });
    state.popups.push({ x: drop.x, y: drop.y - 36, text: "MISS", life: 0.5, groundLocked: true });
    state.message = "SHOT WASTED";
    state.messageTimer = 0.55;
  }
}

function update(dt) {
  if (state.mode !== "playing") return;

  if (state.hitstop > 0) {
    state.hitstop -= dt;
    return;
  }

  state.time += dt;
  state.cooldown = Math.max(0, state.cooldown - dt);
  state.spawnTimer -= dt;
  state.messageTimer = Math.max(0, state.messageTimer - dt);
  state.profileTimer = Math.max(0, state.profileTimer - dt);
  state.bombActive = Math.max(0, state.bombActive - dt);
  state.reloadNagTimer = Math.max(0, state.reloadNagTimer - dt);
  flash = Math.max(0, flash - dt * 2.6);

  const groundScrollPx = config.birdSpeedU * config.unit * dt;
  roadOffset = (roadOffset + groundScrollPx) % 210;
  buildingOffset = (buildingOffset + groundScrollPx * 1.35) % 360;

  if (state.spawnTimer <= 0) {
    spawnCar();
    const pressure = Math.min(0.7, state.score / 150000);
    state.spawnTimer = Math.max(1.2, rand(config.spawnMin - pressure, config.spawnMax - pressure));
  }

  const locked = getLockedCar();
  state.birdTargetX = locked ? laneX(locked.lane) : laneX(1);
  const beforeX = state.birdX;
  const maxMove = (config.laneGap / 0.6) * dt;
  const delta = clamp(state.birdTargetX - state.birdX, -maxMove, maxMove);
  state.birdX += delta;
  const desiredBank = clamp((state.birdX - beforeX) / Math.max(1, maxMove), -1, 1) * 0.075;
  state.bank = lerp(state.bank, desiredBank, 0.22);

  for (const car of state.cars) {
    car.age += dt;
    const speedBoost = getSpeedBoost();
    car.yUnits -= car.type.relSpeed * speedBoost * dt;
    const drift = car.type.key === "bike" ? Math.sin(car.age * 5.2 + car.wiggle) * 0.13 : 0;
    const y = screenYFromUnits(car.yUnits);
    const scale = scaleFromY(y);
    car.screen = { x: laneX(car.lane, drift), y };
    car.w = 92 * scale * car.type.size;
    car.h = 150 * scale * car.type.size;
    car.hitW = car.w * (car.type.key === "bike" ? 0.95 : 1.08);
    car.hitH = car.h * 0.82;
  }

  for (const car of state.cars) {
    if (car.yUnits < config.removeYUnits && !car.hit) {
      if (car.type.target && !car.overshot) {
        car.overshot = true;
        state.life -= 1;
        state.combo = 0;
        state.message = "OVERSHOOT";
        state.messageTimer = 0.8;
        flash = 0.7;
      } else {
        car.hit = true;
      }
    }
  }

  state.cars = state.cars.filter((car) => car.yUnits > config.removeYUnits - 1.0 && !(car.hit && car.yUnits < -1.0));

  for (const drop of state.drops) {
    drop.t += dt;
    if (drop.t >= drop.duration && !drop.done) {
      drop.done = true;
      resolveDrop(drop);
    }
  }
  state.drops = state.drops.filter((drop) => drop.t < drop.duration + 0.1);

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

  if (state.life <= 0) {
    state.mode = "gameover";
    state.message = "MISSION FAILED";
    state.messageTimer = 99;
    startButton.textContent = "RETRY SORTIE";
    startButton.classList.remove("hidden");
  }
}

function drawBackground() {
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, "#071122");
  sky.addColorStop(0.38, "#10182a");
  sky.addColorStop(1, "#05070c");
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
  const zoom = state.bombActive > 0 ? 1 + Math.sin((2.5 - state.bombActive) * Math.PI / 2.5) * 0.16 : 1;
  ctx.scale(zoom, zoom);
  ctx.rotate(state.bank);
  ctx.translate(-CX, -config.aimY);

  drawBackground();
  drawImpactZone();
  drawCars();
  drawDrops();
  drawEffects();

  ctx.restore();
}

function drawImpactZone() {
  const aim = getAim();
  const ready = state.cooldown <= 0;
  const hot = ready && inFireWindow(aim.locked);
  const activeDrop = state.drops.reduce((best, drop) => Math.max(best, clamp(drop.t / drop.duration, 0, 1)), 0);
  const pulse = Math.sin(state.time * 7) * 0.06 + 1;

  drawGhost(aim.locked);

  ctx.save();
  ctx.translate(aim.x, aim.y);
  ctx.scale(1.25, 0.42);
  const shadowAlpha = 0.22 + activeDrop * 0.42;
  ctx.fillStyle = `rgba(0, 0, 0, ${shadowAlpha})`;
  ctx.beginPath();
  ctx.arc(0, 12, 62 + activeDrop * 36, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

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

  if (hot) {
    ctx.save();
    ctx.fillStyle = "rgba(255, 79, 216, 0.95)";
    ctx.font = "900 36px Consolas, monospace";
    ctx.textAlign = "center";
    ctx.shadowColor = "#ff4fd8";
    ctx.shadowBlur = 18;
    ctx.fillText("FIRE!", aim.x, aim.y - 132);
    ctx.restore();
  }

  if (!ready) {
    ctx.save();
    ctx.fillStyle = "rgba(233, 251, 255, 0.8)";
    ctx.font = "700 26px Consolas, monospace";
    ctx.textAlign = "center";
    ctx.fillText("RELOADING", aim.x, aim.y + 154);
    ctx.restore();
  }
}

function drawGhost(locked) {
  if (!locked) return;
  const ghostY = screenYFromUnits(futureYUnits(locked));
  const scale = scaleFromY(ghostY);
  const w = 92 * scale * locked.type.size * 1.08;
  const h = 150 * scale * locked.type.size * 0.82;
  const x = locked.screen.x;

  ctx.save();
  ctx.strokeStyle = "rgba(233, 251, 255, 0.72)";
  ctx.lineWidth = 3;
  ctx.setLineDash([14, 10]);
  ctx.strokeRect(x - w / 2, ghostY - h / 2, w, h);
  ctx.setLineDash([]);
  ctx.fillStyle = "rgba(233, 251, 255, 0.75)";
  ctx.font = "700 22px Consolas, monospace";
  ctx.textAlign = "center";
  ctx.fillText("+0.9s", x, ghostY - h / 2 - 12);
  ctx.restore();
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

    const bodyRadius = 8;
    ctx.fillStyle = car.type.color;
    roundRect(-car.w / 2, -car.h / 2, car.w, car.h, bodyRadius);
    ctx.fill();

    ctx.fillStyle = "rgba(5, 7, 12, 0.78)";
    roundRect(-car.w * 0.3, -car.h * 0.22, car.w * 0.6, car.h * 0.38, 6);
    ctx.fill();

    ctx.fillStyle = "rgba(255, 255, 255, 0.82)";
    ctx.fillRect(-car.w * 0.36, -car.h * 0.46, car.w * 0.2, car.h * 0.1);
    ctx.fillRect(car.w * 0.16, -car.h * 0.46, car.w * 0.2, car.h * 0.1);
    ctx.fillStyle = "rgba(255, 30, 70, 0.8)";
    ctx.fillRect(-car.w * 0.34, car.h * 0.38, car.w * 0.18, car.h * 0.08);
    ctx.fillRect(car.w * 0.16, car.h * 0.38, car.w * 0.18, car.h * 0.08);

    if (car === locked || state.bombActive > 0) {
      ctx.strokeStyle = state.bombActive > 0 ? "#ff5d6c" : "#51ffa8";
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

function easeInQuad(t) {
  return t * t;
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
    ctx.fillStyle = `rgba(233, 251, 255, ${Math.max(0, popup.life / 0.75)})`;
    ctx.font = "800 38px Segoe UI";
    ctx.textAlign = "center";
    ctx.shadowColor = "#42eaff";
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

  if (state.profileTimer > 0) {
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(255, 234, 77, 0.94)";
    ctx.font = "700 28px Consolas, monospace";
    ctx.fillText(state.profile, 44, 210);
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
    ctx.fillText("Tap when the +0.9s ghost frame overlaps the bombsight.", CX, H * 0.54);
    ctx.fillText("The impact point is always the center shadow.", CX, H * 0.58);
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

function render() {
  drawWorld();
  drawWings();
  drawHud();
  drawFlash();
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
  state.holdTime = performance.now();
}

function pointerUp(event) {
  event.preventDefault();
  if (state.mode !== "playing") return;
  const held = (performance.now() - state.holdTime) / 1000;
  if (held >= 0.5 && state.bomb >= 100) {
    triggerBomb();
  } else {
    fireDrop();
  }
}

startButton.addEventListener("click", resetGame);
canvas.addEventListener("pointerdown", pointerDown, { passive: false });
canvas.addEventListener("pointerup", pointerUp, { passive: false });
canvas.addEventListener("pointercancel", pointerUp, { passive: false });

requestAnimationFrame(loop);
