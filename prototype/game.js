"use strict";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const startButton = document.getElementById("startButton");

const W = canvas.width;
const H = canvas.height;
const CX = W / 2;
const vanishing = { x: CX, y: H * 0.31 };
const impactPoint = { x: CX, y: H * 0.72 };
const lanes = [-0.55, 0, 0.55];

const config = {
  fallTime: 0.9,
  cooldown: 0.55,
  life: 5,
  spawnMin: 1.0,
  spawnMax: 1.45,
  maxCars: 3,
  missZ: 1.16,
  roadBottomHalf: W * 0.45,
  roadTopHalf: W * 0.035,
};

const vehicleTypes = [
  { key: "open", label: "OPEN CAR", score: 1000, speed: 0.35, size: 1, color: "#ff4fd8", weight: 55, target: true },
  { key: "limo", label: "LIMO", score: 600, speed: 0.28, size: 1.45, color: "#60f6ff", weight: 18, target: false },
  { key: "bike", label: "BIKE", score: 2500, speed: 0.52, size: 0.62, color: "#ffea4d", weight: 17, target: true },
  { key: "gold", label: "GOLD", score: 10000, speed: 0.44, size: 1.05, color: "#ffc247", weight: 4, target: false },
  { key: "roof", label: "SUNROOF", score: 2000, speed: 0.34, size: 1, color: "#9dff70", weight: 6, target: true },
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
    shots: 0,
    hits: 0,
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

function roadHalfWidth(z) {
  const e = z * z;
  return config.roadTopHalf + (config.roadBottomHalf - config.roadTopHalf) * e;
}

function yFromZ(z) {
  const e = z * z * (3 - 2 * z);
  return vanishing.y + (H * 0.92 - vanishing.y) * e;
}

function screenFromLane(laneIndex, z, laneDrift = 0) {
  const half = roadHalfWidth(z);
  return {
    x: CX + half * (lanes[laneIndex] + laneDrift),
    y: yFromZ(z),
  };
}

function getSpeedBoost() {
  return 1 + Math.min(0.55, state.score / 150000);
}

function getLockedCar() {
  const candidates = state.cars
    .filter((car) => !car.hit && car.z < 1.02)
    .sort((a, b) => {
      const aDistance = Math.abs(impactPoint.y - yFromZ(Math.min(1, a.z)));
      const bDistance = Math.abs(impactPoint.y - yFromZ(Math.min(1, b.z)));
      return aDistance - bDistance;
    });
  return candidates[0] || null;
}

function getAimPoint() {
  const locked = getLockedCar();
  if (!locked) return { ...impactPoint, locked: null };
  const predictedZ = Math.min(1, locked.z + locked.type.speed * getSpeedBoost() * config.fallTime);
  const drift = locked.type.key === "bike"
    ? Math.sin((locked.age + config.fallTime) * 5.2 + locked.wiggle) * 0.1
    : 0;
  return { ...screenFromLane(locked.lane, predictedZ, drift), locked };
}

function spawnCar() {
  if (state.cars.length >= config.maxCars) return;
  const type = chooseVehicle();
  const lane = Math.floor(Math.random() * lanes.length);
  const idSource = globalThis.crypto && globalThis.crypto.randomUUID
    ? globalThis.crypto.randomUUID()
    : String(Math.random());
  const car = {
    id: idSource,
    type,
    lane,
    z: 0.03,
    hit: false,
    age: 0,
    wiggle: Math.random() * Math.PI * 2,
  };
  state.cars.push(car);
  if (type.key === "gold" || type.key === "bike") {
    state.profile = `${profiles[Math.floor(Math.random() * profiles.length)]} / SPEED ${Math.round(type.speed * 400)}KMH`;
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
  if (state.mode !== "playing" || state.cooldown > 0 || state.bombActive > 0) return;
  const aim = getAimPoint();
  state.cooldown = config.cooldown;
  state.shots += 1;
  state.drops.push({
    x: aim.x,
    y: aim.y,
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
  state.bomb = car.type.key === "gold" ? 100 : Math.min(100, state.bomb + (just ? 15 : 8));
  state.splashes.push({ x: car.screen.x, y: car.screen.y, r: 0, life: 0.55, color: car.type.color });
  state.popups.push({ x: car.screen.x, y: car.screen.y - 46, text: `${just ? "JUST " : "HIT "}+${gain}`, life: 0.75 });
  state.message = just ? "JUST SNIPE" : "TARGET HIT";
  state.messageTimer = 0.8;
  flash = just ? 1 : 0.45;
  if (navigator.vibrate) navigator.vibrate(just ? [30, 30, 45] : 25);
}

function resolveDrop(drop) {
  let best = null;
  let bestDistance = Infinity;
  for (const car of state.cars) {
    if (car.hit) continue;
    const dx = drop.x - car.screen.x;
    const dy = drop.y - car.screen.y;
    const rx = car.hitW * 0.9;
    const ry = car.hitH * 0.75;
    const normalized = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
    if (normalized <= 1 && normalized < bestDistance) {
      best = car;
      bestDistance = normalized;
    }
  }

  if (best) {
    awardHit(best, bestDistance <= 0.25);
  } else {
    state.combo = 0;
    state.splashes.push({ x: drop.x, y: drop.y, r: 0, life: 0.38, color: "#dcecff" });
    state.popups.push({ x: drop.x, y: drop.y - 36, text: "MISS", life: 0.5 });
    state.message = "MISS";
    state.messageTimer = 0.55;
  }
}

function update(dt) {
  if (state.mode !== "playing") return;

  state.time += dt;
  state.cooldown = Math.max(0, state.cooldown - dt);
  state.spawnTimer -= dt;
  state.messageTimer = Math.max(0, state.messageTimer - dt);
  state.profileTimer = Math.max(0, state.profileTimer - dt);
  state.bombActive = Math.max(0, state.bombActive - dt);
  flash = Math.max(0, flash - dt * 2.6);
  roadOffset = (roadOffset + dt * (0.38 + Math.min(0.5, state.score / 180000))) % 1;

  if (state.spawnTimer <= 0) {
    spawnCar();
    const pressure = Math.min(0.45, state.score / 220000);
    state.spawnTimer = rand(config.spawnMin - pressure, config.spawnMax - pressure);
  }

  for (const car of state.cars) {
    car.age += dt;
    const speedBoost = getSpeedBoost();
    car.z += car.type.speed * speedBoost * dt;
    const drift = car.type.key === "bike" ? Math.sin(car.age * 5.2 + car.wiggle) * 0.1 : 0;
    car.screen = screenFromLane(car.lane, Math.min(car.z, 1), drift);
    const scale = 0.28 + car.z * car.z * 1.35;
    car.w = 84 * scale * car.type.size;
    car.h = 136 * scale * car.type.size;
    car.hitW = car.w * 1.05;
    car.hitH = car.h * 0.72;
  }

  for (const car of state.cars) {
    if (car.z > config.missZ && !car.hit && car.type.target) {
      car.hit = true;
      state.life -= 1;
      state.combo = 0;
      state.message = "TARGET LOST";
      state.messageTimer = 0.8;
      flash = 0.7;
    }
  }

  state.cars = state.cars.filter((car) => car.z < 1.18 && !(car.hit && car.z > 0.98));

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
  }
  state.splashes = state.splashes.filter((splash) => splash.life > 0);

  for (const popup of state.popups) {
    popup.life -= dt;
    popup.y -= dt * 64;
  }
  state.popups = state.popups.filter((popup) => popup.life > 0);

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
  sky.addColorStop(0.42, "#121328");
  sky.addColorStop(1, "#05070c");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = "rgba(83, 235, 255, 0.18)";
  ctx.lineWidth = 2;
  for (let i = 0; i < 18; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const base = Math.floor(i / 2);
    const x = CX + side * (150 + base * 82);
    ctx.beginPath();
    ctx.moveTo(vanishing.x + side * (18 + base * 7), vanishing.y + 18);
    ctx.lineTo(x, H);
    ctx.stroke();
  }

  const road = ctx.createLinearGradient(0, vanishing.y, 0, H);
  road.addColorStop(0, "#10222d");
  road.addColorStop(1, "#171923");
  ctx.fillStyle = road;
  ctx.beginPath();
  ctx.moveTo(CX - config.roadTopHalf, vanishing.y);
  ctx.lineTo(CX + config.roadTopHalf, vanishing.y);
  ctx.lineTo(CX + config.roadBottomHalf, H);
  ctx.lineTo(CX - config.roadBottomHalf, H);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(92, 247, 255, 0.72)";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(CX - config.roadTopHalf, vanishing.y);
  ctx.lineTo(CX - config.roadBottomHalf, H);
  ctx.moveTo(CX + config.roadTopHalf, vanishing.y);
  ctx.lineTo(CX + config.roadBottomHalf, H);
  ctx.stroke();

  drawLaneMarks();
}

function drawLaneMarks() {
  for (let i = 0; i < 24; i++) {
    const z = ((i / 24 + roadOffset) % 1) * 0.98 + 0.02;
    const y = yFromZ(z);
    const half = roadHalfWidth(z);
    const markH = 10 + z * z * 54;
    const alpha = 0.1 + z * 0.8;
    ctx.strokeStyle = `rgba(230, 255, 255, ${alpha})`;
    ctx.lineWidth = 3 + z * 5;
    for (const laneSplit of [-0.275, 0.275]) {
      const x = CX + half * laneSplit;
      ctx.beginPath();
      ctx.moveTo(x, y - markH);
      ctx.lineTo(x, y + markH);
      ctx.stroke();
    }
  }
}

function drawImpactCircle() {
  const aim = getAimPoint();
  const pulse = Math.sin(state.time * 7) * 0.08 + 1;
  ctx.save();
  ctx.translate(aim.x, aim.y);
  ctx.scale(1.25, 0.42);
  ctx.strokeStyle = aim.locked ? "rgba(81, 255, 168, 0.95)" : "rgba(120, 150, 160, 0.6)";
  ctx.lineWidth = 7;
  ctx.shadowColor = "#51ffa8";
  ctx.shadowBlur = 22;
  ctx.beginPath();
  ctx.arc(0, 0, 74 * pulse, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  if (aim.locked) {
    ctx.save();
    ctx.strokeStyle = "rgba(255, 79, 216, 0.82)";
    ctx.lineWidth = 4;
    ctx.setLineDash([16, 12]);
    ctx.beginPath();
    ctx.moveTo(aim.locked.screen.x, aim.locked.screen.y);
    ctx.lineTo(aim.x, aim.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = "rgba(233, 251, 255, 0.9)";
    ctx.font = "700 24px Consolas, monospace";
    ctx.textAlign = "center";
    ctx.fillText("PREDICT", aim.x, aim.y - 54);
    ctx.restore();
  }
}

function drawReticle() {
  const reload = 1 - state.cooldown / config.cooldown;
  ctx.save();
  ctx.translate(CX, H * 0.5);
  ctx.strokeStyle = "rgba(90, 239, 255, 0.88)";
  ctx.lineWidth = 5;
  ctx.shadowColor = "#4eefff";
  ctx.shadowBlur = 20;
  ctx.beginPath();
  ctx.arc(0, 0, 82, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * reload);
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(0, 0, 58, 0, Math.PI * 2);
  ctx.moveTo(-112, 0);
  ctx.lineTo(-44, 0);
  ctx.moveTo(44, 0);
  ctx.lineTo(112, 0);
  ctx.moveTo(0, -112);
  ctx.lineTo(0, -44);
  ctx.moveTo(0, 44);
  ctx.lineTo(0, 112);
  ctx.stroke();
  ctx.restore();
}

function drawCars() {
  const cars = [...state.cars].sort((a, b) => a.z - b.z);
  for (const car of cars) {
    const { x, y } = car.screen;
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = car.hit ? 0.35 : 1;
    ctx.shadowColor = car.type.color;
    ctx.shadowBlur = 18 * car.z;
    ctx.fillStyle = car.type.color;
    roundRect(-car.w / 2, -car.h / 2, car.w, car.h, 12 * car.z + 4);
    ctx.fill();
    ctx.fillStyle = "rgba(5, 7, 12, 0.78)";
    roundRect(-car.w * 0.28, -car.h * 0.2, car.w * 0.56, car.h * 0.38, 8);
    ctx.fill();
    ctx.strokeStyle = car.type.key === "gold" ? "#fff0a6" : "#e9fbff";
    ctx.lineWidth = Math.max(2, car.z * 6);
    ctx.strokeRect(-car.hitW / 2, -car.hitH / 2, car.hitW, car.hitH);
    ctx.fillStyle = "#e9fbff";
    ctx.font = `${Math.max(16, 20 + car.z * 18)}px Segoe UI`;
    ctx.textAlign = "center";
    ctx.fillText(car.type.label, 0, -car.h * 0.66);
    ctx.restore();
  }
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

function drawDrops() {
  for (const drop of state.drops) {
    const p = Math.min(1, drop.t / drop.duration);
    const y = H * 0.22 + (impactPoint.y - H * 0.22) * (p * p);
    const r = 18 + p * 24;
    ctx.fillStyle = "rgba(238, 252, 255, 0.92)";
    ctx.shadowColor = "#ffffff";
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.arc(drop.x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}

function drawEffects() {
  for (const splash of state.splashes) {
    const alpha = Math.max(0, splash.life / 0.55);
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
  ctx.fillStyle = "rgba(4, 10, 18, 0.58)";
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
    ctx.fillText(state.profile, 44, 212);
  }

  if (state.messageTimer > 0 || state.mode !== "playing") {
    ctx.textAlign = "center";
    ctx.font = "900 56px Consolas, monospace";
    ctx.fillStyle = state.message.includes("MISS") || state.message.includes("FAILED") ? "#ff5d6c" : "#e9fbff";
    ctx.shadowColor = "#4eefff";
    ctx.shadowBlur = 22;
    ctx.fillText(state.message, CX, H * 0.39);
    ctx.shadowBlur = 0;
  }

  if (state.mode === "ready") {
    ctx.fillStyle = "rgba(233, 251, 255, 0.88)";
    ctx.font = "700 34px Segoe UI";
    ctx.textAlign = "center";
    ctx.fillText("One tap drops after 0.9 sec. Hold when bomb is full.", CX, H * 0.58);
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
  drawBackground();
  drawImpactCircle();
  drawCars();
  drawDrops();
  drawEffects();
  drawReticle();
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
