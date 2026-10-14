"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const gameJsPath = path.join(__dirname, "game.js");
const code = fs.readFileSync(gameJsPath, "utf8");

function createTestHarness() {
  const drawnTexts = [];
  const mockCtx = new Proxy(
    {
      fillText(text, x, y) {
        drawnTexts.push({ text: String(text), x, y });
      },
      createLinearGradient() {
        return { addColorStop() {} };
      },
      createRadialGradient() {
        return { addColorStop() {} };
      },
    },
    {
      get(target, prop) {
        if (prop in target) return target[prop];
        return () => {};
      },
      set(target, prop, value) {
        target[prop] = value;
        return true;
      },
    }
  );

  const startBtn = {
    textContent: "START SORTIE",
    classList: {
      hidden: false,
      add(c) {
        if (c === "hidden") this.hidden = true;
      },
      remove(c) {
        if (c === "hidden") this.hidden = false;
      },
    },
    addEventListener() {},
  };

  const canvasEl = {
    width: 1080,
    height: 1920,
    getContext() {
      return mockCtx;
    },
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 1080, height: 1920 };
    },
    addEventListener() {},
  };

  const sandbox = {
    document: {
      getElementById(id) {
        if (id === "game") return canvasEl;
        if (id === "startButton") return startBtn;
        return null;
      },
    },
    window: {
      location: { search: "?debug=1" },
      addEventListener() {},
    },
    navigator: { vibrate() {} },
    performance: { now: () => 1000 },
    requestAnimationFrame() {},
    URLSearchParams,
    Math,
    String,
    Boolean,
    Number,
    Array,
    Object,
    parseInt,
    Infinity,
  };
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(code, sandbox);

  return {
    sandbox,
    drawnTexts,
    run(expr) {
      return vm.runInContext(expr, sandbox);
    },
  };
}

// Suite 1: Driver profiles & non-repeating reaction line history (Spec §4-2)
{
  const h = createTestHarness();
  h.run("resetGame();");
  assert.equal(h.run("driverProfiles.length"), 5);
  for (let i = 0; i < 5; i++) {
    assert.ok(h.run(`driverProfiles[${i}].lines.length >= 5`));
  }

  h.run("state.cars = []; spawnCar(vehicleTypes[0], 4.0);");
  const picked = h.run(`
    const c = state.cars[0];
    const out = [];
    for (let i = 0; i < 25; i++) {
      out.push(pickDriverReactionLine(c, "", false));
    }
    out;
  `);
  for (let i = 0; i < picked.length; i++) {
    if (i >= 1) assert.notEqual(picked[i], picked[i - 1], "Consecutive duplicate line detected");
    if (i >= 2) assert.notEqual(picked[i], picked[i - 2], "Second-previous duplicate line detected");
  }
}

// Suite 2: 1.2s HUD reaction cut-in, PIERCED! glass shards, and BUSTED! special line (Spec §4-2, §5-1)
{
  const h = createTestHarness();
  h.run(`
    resetGame();
    state.cars = [];
    spawnCar(vehicleTypes[3], 2.0);
    updateCars(0);
    awardHit(state.cars[0], true, 2, "PIERCED!");
  `);
  const piercedCutin = h.run("state.reactionCutin");
  assert.ok(piercedCutin);
  assert.equal(piercedCutin.duration, 1.2);
  assert.equal(piercedCutin.badge, "PIERCED!");
  assert.equal(piercedCutin.line, "防弾ガラスじゃないのか!?");
  assert.equal(h.run("state.shards.length"), 10);

  h.run(`
    spawnCar(vehicleTypes[0], 2.0);
    const bustedCar = state.cars[state.cars.length - 1];
    bustedCar.bustedEligible = true;
    updateCars(0);
    awardHit(bustedCar, false, 1, "");
  `);
  const bustedCutin = h.run("state.reactionCutin");
  assert.equal(bustedCutin.badge, "BUSTED!");
  assert.equal(bustedCutin.line, "み、見られていたのか…！");

  h.drawnTexts.length = 0;
  h.run("render();");
  assert.ok(h.drawnTexts.some((entry) => entry.text.includes("み、見られていたのか…！")));

  h.run("for (let i = 0; i < 85; i++) update(0.016);");
  assert.equal(h.run("state.reactionCutin"), null);
}

// Suite 3: inFireWindow checks horizontal lane/drift alignment as well as vertical timing
{
  const h = createTestHarness();
  h.run(`
    resetGame();
    state.cars = [];
    spawnCar(vehicleTypes[0], 2.5 * 0.85 * 0.9);
    state.cars[0].lane = 0;
    state.cars[0].laneFloat = 0;
    updateCars(0);
    state.birdX = laneX(2);
  `);
  assert.equal(h.run("inFireWindow(state.cars[0])"), false);
  h.run("state.birdX = laneX(0);");
  assert.equal(h.run("inFireWindow(state.cars[0])"), true);
}

// Suite 4: Payload tokens allow immediate firing during reload cooldown (Spec §5-5)
{
  const h = createTestHarness();
  h.run(`
    resetGame();
    state.cooldown = 1.2;
    state.payloadTokens = 0;
    fireDrop();
  `);
  assert.equal(h.run("state.drops.length"), 0);

  h.run(`
    state.payloadTokens = 1;
    fireDrop();
  `);
  assert.equal(h.run("state.drops.length"), 1);
  assert.equal(h.run("state.payloadTokens"), 0);
}

// Suite 5: Phase transition banner and Bomb Cinematic per-car profile linkage
{
  const h = createTestHarness();
  h.run(`
    resetGame();
    state.score = 16000;
    update(0.016);
  `);
  assert.equal(h.run("state.message"), "LUNCH BREAK");
  assert.equal(h.run("state.phaseBanner"), "PHASE 02 — DUSK");

  h.run(`
    resetGame();
    state.cars = [];
    spawnCar(vehicleTypes[1], 3.5);
    state.cars[0].profileObj = driverProfiles[0];
    state.cars[0].profile = driverProfiles[0].tag;
    spawnCar(vehicleTypes[4], 3.0);
    state.cars[1].profileObj = driverProfiles[2];
    state.cars[1].profile = driverProfiles[2].tag;
    state.profile = "TARGET: IT CEO / REL 2.5U/S";
    updateCars(0);
    state.bomb = 100;
    triggerBomb();
  `);
  assert.equal(h.run("state.bombCinematic.profile"), "TARGET: CRYPTO PRINCE");
  const replayQuote = h.run("state.bombCinematic.replayQuote");
  assert.ok(h.run("driverProfiles[2].lines").includes(replayQuote));
}

console.log("PASS: prototype/test_game.js (all 5 suites passed)");
