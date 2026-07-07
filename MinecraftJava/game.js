import * as THREE from "https://unpkg.com/three@0.165.0/build/three.module.js";

const canvas = document.querySelector("#world");
const startPanel = document.querySelector("#start-panel");
const startButton = document.querySelector("#start-button");
const statusEl = document.querySelector("#status");
const statsEl = document.querySelector("#stats");
const hotbarEl = document.querySelector("#hotbar");
const minimap = document.querySelector("#minimap");
const mapCtx = minimap.getContext("2d");
const healthEl = document.querySelector("#health");
const hungerEl = document.querySelector("#hunger");
const armorEl = document.querySelector("#armor");
const offhandEl = document.querySelector("#offhand");
const inventoryPanel = document.querySelector("#inventory-panel");
const inventoryGrid = document.querySelector("#inventory-grid");
const recipeList = document.querySelector("#recipe-list");
const closeInventory = document.querySelector("#close-inventory");

const WORLD_RADIUS = 31;
const WATER_LEVEL = 5;
const MAX_DEPTH = -3;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x80c7ff);
scene.fog = new THREE.Fog(0x80c7ff, 42, 115);

const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.1, 180);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const sun = new THREE.DirectionalLight(0xfff1c9, 2.65);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -52;
sun.shadow.camera.right = 52;
sun.shadow.camera.top = 52;
sun.shadow.camera.bottom = -52;
scene.add(sun);

const moon = new THREE.DirectionalLight(0x9ab7ff, 0.25);
scene.add(moon);

const hemi = new THREE.HemisphereLight(0xcceeff, 0x435f3d, 1.45);
scene.add(hemi);

const blockTypes = [
  { id: "grass", label: "Grass", color: 0x59b63f, count: Infinity },
  { id: "stone", label: "Stone", color: 0x8f9694, count: Infinity },
  { id: "wood", label: "Wood", color: 0x9a6233, count: Infinity },
  { id: "workbench", label: "Bench", color: 0xb5793e, count: Infinity },
  { id: "furnace", label: "Furnace", color: 0x4f5757, count: Infinity },
  { id: "anvil", label: "Anvil", color: 0x33383c, count: Infinity },
  { id: "glow", label: "Glow", color: 0xffde59, count: Infinity, emissive: 0xffad33 },
  { id: "portal", label: "Portal", color: 0x8c4dff, count: Infinity, alpha: 0.72, emissive: 0x4913a8 },
  { id: "blast", label: "Blast", color: 0xe8492f, count: Infinity, emissive: 0x7a1208 },
];

const materialDefs = {
  sand: { color: 0xd9c77d },
  snow: { color: 0xf4fbff },
  dirt: { color: 0x8a5734 },
  leaf: { color: 0x398d36 },
  water: { color: 0x2f86db, alpha: 0.55 },
  coalOre: { color: 0x4e5455, emissive: 0x070707 },
  ironOre: { color: 0xb98562, emissive: 0x24130a },
  goldOre: { color: 0xf1c84b, emissive: 0x6a3b00 },
  gemOre: { color: 0x56b4ff, emissive: 0x0b3155 },
  flower: { color: 0xff5f9f, emissive: 0x4c001c },
};

const materials = {};
for (const block of blockTypes) {
  materials[block.id] = new THREE.MeshLambertMaterial({
    color: block.color,
    emissive: block.emissive ?? 0x000000,
    transparent: Boolean(block.alpha),
    opacity: block.alpha ?? 1,
  });
}
for (const [id, def] of Object.entries(materialDefs)) {
  materials[id] = new THREE.MeshLambertMaterial({
    color: def.color,
    emissive: def.emissive ?? 0x000000,
    transparent: Boolean(def.alpha),
    opacity: def.alpha ?? 1,
  });
}

const world = new Map();
const blockMeshes = new Map();
const topMap = new Map();
const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
const raycaster = new THREE.Raycaster();
raycaster.far = 8;

const keys = new Set();
const particles = [];
const mobs = [];
const clouds = new THREE.Group();
scene.add(clouds);

const player = {
  position: new THREE.Vector3(21, 12, -25),
  velocity: new THREE.Vector3(),
  yaw: Math.PI * 0.25,
  pitch: -0.18,
  onGround: false,
  health: 20,
  hunger: 20,
  armor: 0,
  shielding: false,
  weapon: "hands",
  dimension: "overworld",
  hurtCooldown: 0,
};

let selectedIndex = 0;
let lastTime = performance.now();
let running = false;
let worldBlocksPlaced = 0;
let worldBlocksMined = 0;
let clock = 0.18;
let inventoryOpen = false;
let offhandMode = "empty";
let hungerTimer = 0;
let portalCooldown = 0;

const inventory = {
  wood: 10,
  stone: 12,
  coal: 2,
  ironOre: 0,
  iron: 0,
  gold: 0,
  gem: 0,
  food: 5,
  bone: 0,
  workbench: 1,
  furnace: 0,
  anvil: 0,
  portal: 0,
  sword: 0,
  pickaxe: 0,
  shield: 1,
};

const recipes = [
  { id: "sword", name: "Iron Sword", gives: { sword: 1 }, needs: { wood: 1, iron: 2 }, text: "Left click attacks with it. Much better than bonking things by hand." },
  { id: "pickaxe", name: "Iron Pickaxe", gives: { pickaxe: 1 }, needs: { wood: 2, iron: 3 }, text: "Mines ore faster and makes more sparks. Highly scientific." },
  { id: "shield", name: "Shield", gives: { shield: 1 }, needs: { wood: 3, iron: 1 }, text: "Cycle shield into offhand with F/Q, then hold right click to block." },
  { id: "food", name: "Campfire Snacks", gives: { food: 3 }, needs: { coal: 1, wood: 1 }, text: "Cycle food into offhand with F/Q, then right click to eat." },
  { id: "furnace", name: "Furnace Block", gives: { furnace: 1 }, needs: { stone: 8 }, text: "Place it, then use R nearby to smelt ore into ingots." },
  { id: "anvil", name: "Anvil Block", gives: { anvil: 1 }, needs: { iron: 5 }, text: "Heavy block for flexing. Adds armor when crafted." },
  { id: "workbench", name: "Workbench", gives: { workbench: 1 }, needs: { wood: 4 }, text: "The classic chunky table. Craft anywhere, but it looks right placed." },
  { id: "portal", name: "Portal Core", gives: { portal: 1 }, needs: { gem: 2, gold: 2, coal: 1 }, text: "Place it and walk close to enter the violet dimension." },
];

function keyFor(x, y, z) {
  return `${x},${y},${z}`;
}

function columnKey(x, z) {
  return `${x},${z}`;
}

function getBlock(x, y, z) {
  return world.get(keyFor(x, y, z));
}

function noise(x, z) {
  return (
    Math.sin(x * 0.19 + z * 0.07) * 3.2 +
    Math.cos(z * 0.16 - x * 0.05) * 2.7 +
    Math.sin((x + z) * 0.08) * 4.2 +
    Math.cos(Math.hypot(x, z) * 0.14) * 3.2
  );
}

function heightAt(x, z) {
  return Math.round(7 + noise(x, z));
}

function topType(x, z, height) {
  const wet = Math.sin(x * 0.11) + Math.cos(z * 0.1);
  if (height <= WATER_LEVEL + 1) return "sand";
  if (height > 13) return "snow";
  if (wet > 1.15) return "grass";
  if (wet < -1.18) return "stone";
  return "grass";
}

function addBlock(x, y, z, type, countChange = false) {
  const key = keyFor(x, y, z);
  if (world.has(key)) return false;

  world.set(key, type);
  const mesh = new THREE.Mesh(boxGeometry, materials[type]);
  mesh.position.set(x, y, z);
  mesh.castShadow = type !== "water" && type !== "glass";
  mesh.receiveShadow = true;
  mesh.userData.block = { x, y, z, type };
  blockMeshes.set(key, mesh);
  scene.add(mesh);
  updateTopMap(x, z);

  if (type === "glow") {
    const light = new THREE.PointLight(0xffcf70, 1.5, 10);
    light.position.set(x, y + 0.2, z);
    mesh.add(light);
  }

  if (countChange) worldBlocksPlaced += 1;
  return true;
}

function removeBlock(x, y, z, countChange = false) {
  const key = keyFor(x, y, z);
  const mesh = blockMeshes.get(key);
  if (!mesh) return false;

  scene.remove(mesh);
  blockMeshes.delete(key);
  world.delete(key);
  updateTopMap(x, z);
  if (countChange) worldBlocksMined += 1;
  return true;
}

function updateTopMap(x, z) {
  let top = MAX_DEPTH - 1;
  let type = "void";
  for (let y = 25; y >= MAX_DEPTH; y -= 1) {
    const found = getBlock(x, y, z);
    if (found && found !== "water") {
      top = y;
      type = found;
      break;
    }
  }
  topMap.set(columnKey(x, z), { y: top, type });
}

function plantTree(x, y, z, tall = false) {
  const trunk = tall ? 6 : 4;
  for (let i = 1; i <= trunk; i += 1) addBlock(x, y + i, z, "wood");
  for (let dx = -2; dx <= 2; dx += 1) {
    for (let dz = -2; dz <= 2; dz += 1) {
      for (let dy = trunk - 2; dy <= trunk + 2; dy += 1) {
        const soft = Math.abs(dx) + Math.abs(dz) + Math.max(0, dy - trunk);
        if (soft < 4 && !(dx === 0 && dz === 0 && dy <= trunk)) {
          addBlock(x + dx, y + dy, z + dz, "leaf");
        }
      }
    }
  }
}

function makeCloud(x, y, z, scale) {
  const cloud = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.86 });
  for (let i = 0; i < 9; i += 1) {
    const puff = new THREE.Mesh(boxGeometry, mat);
    puff.scale.setScalar(scale * (1 + (i % 3) * 0.25));
    puff.position.set((i % 3) * scale * 1.1, Math.floor(i / 3) * scale * 0.35, Math.sin(i) * scale);
    cloud.add(puff);
  }
  cloud.position.set(x, y, z);
  clouds.add(cloud);
}

function spawnMob(x, y, z, color, name = "moo cube", hostile = false) {
  const body = new THREE.Mesh(boxGeometry, new THREE.MeshLambertMaterial({ color }));
  body.scale.set(hostile ? 0.95 : 0.85, hostile ? 1.15 : 0.85, hostile ? 0.95 : 0.85);
  body.position.set(x, y + 1.2, z);
  body.castShadow = true;
  body.receiveShadow = true;
  body.userData.mob = true;
  scene.add(body);
  mobs.push({
    mesh: body,
    home: new THREE.Vector3(x, y + 1.2, z),
    phase: Math.random() * Math.PI * 2,
    name,
    hostile,
    health: hostile ? 10 : 6,
    attackCooldown: 0,
  });
}

function generateWorld() {
  for (let x = -WORLD_RADIUS; x <= WORLD_RADIUS; x += 1) {
    for (let z = -WORLD_RADIUS; z <= WORLD_RADIUS; z += 1) {
      const h = heightAt(x, z);
      const top = topType(x, z, h);
      for (let y = MAX_DEPTH; y <= h; y += 1) {
        let type = "stone";
        if (y === h) type = top;
        else if (y > h - 3) type = top === "sand" ? "sand" : "dirt";
        const oreNoise = Math.sin(x * 1.73 + y * 2.6 + z * 0.91);
        if (y < 7 && oreNoise > 0.88) type = "coalOre";
        if (y < 4 && oreNoise > 0.94) type = "ironOre";
        if (y < 1 && Math.cos(x * 2.1 + y * 1.7 - z * 1.2) > 0.965) type = "goldOre";
        if (y < 0 && Math.sin(x * 4.4 + z * 3.1 + y) > 0.982) type = "gemOre";
        addBlock(x, y, z, type);
      }

      for (let y = h + 1; y <= WATER_LEVEL; y += 1) addBlock(x, y, z, "water");

      const treeChance = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453;
      if (top === "grass" && h > WATER_LEVEL + 1 && Math.abs(treeChance % 1) > 0.82) {
        plantTree(x, h, z, Math.abs(treeChance % 7) > 5.8);
      } else if (top === "grass" && Math.abs(treeChance % 1) < 0.035) {
        addBlock(x, h + 1, z, "flower");
      }
    }
  }

  for (let i = 0; i < 14; i += 1) {
    makeCloud(-42 + i * 7, 24 + (i % 4), -25 + (i % 5) * 11, 1.4 + (i % 3) * 0.25);
  }

  [
    [-12, -8, 0xfff0cc, "moo cube", false],
    [13, 7, 0xd2b48c, "mud cube", false],
    [4, -19, 0xeeeeee, "wool cube", false],
    [-22, 14, 0xffd1df, "snack cube", false],
    [18, -16, 0xc6f6c9, "leaf cube", false],
    [-6, 19, 0x223344, "night lurcher", true],
    [20, -2, 0x4b1d5f, "portal imp", true],
    [-24, -20, 0x5a0f17, "cinder block", true],
  ].forEach(([x, z, color, name, hostile]) => spawnMob(x, heightAt(x, z), z, color, name, hostile));
}

function createHotbar() {
  hotbarEl.innerHTML = "";
  blockTypes.forEach((block, index) => {
    const slot = document.createElement("div");
    slot.className = "slot";
    slot.style.background = `#${block.color.toString(16).padStart(6, "0")}`;
    slot.title = block.label;
    slot.innerHTML = `<small>${block.label}</small><span>${index + 1}</span>`;
    hotbarEl.append(slot);
  });
  updateHotbar();
}

function updateHotbar() {
  [...hotbarEl.children].forEach((slot, index) => {
    slot.classList.toggle("active", index === selectedIndex);
  });
  statusEl.textContent = `${blockTypes[selectedIndex].label} selected`;
}

function canAfford(needs) {
  return Object.entries(needs).every(([item, amount]) => (inventory[item] ?? 0) >= amount);
}

function spend(needs) {
  for (const [item, amount] of Object.entries(needs)) inventory[item] -= amount;
}

function grant(gives) {
  for (const [item, amount] of Object.entries(gives)) inventory[item] = (inventory[item] ?? 0) + amount;
  if (gives.sword) player.weapon = "sword";
  if (gives.anvil) player.armor = Math.min(10, player.armor + 4);
}

function craft(recipe) {
  if (!canAfford(recipe.needs)) {
    statusEl.textContent = `Need more stuff for ${recipe.name}`;
    return;
  }
  spend(recipe.needs);
  grant(recipe.gives);
  statusEl.textContent = `Crafted ${recipe.name}`;
  renderInventory();
}

function renderInventory() {
  inventoryGrid.innerHTML = "";
  const labels = {
    wood: "Wood",
    stone: "Stone",
    coal: "Coal",
    ironOre: "Iron Ore",
    iron: "Iron",
    gold: "Gold",
    gem: "Gems",
    food: "Food",
    bone: "Bones",
    workbench: "Benches",
    furnace: "Furnaces",
    anvil: "Anvils",
    portal: "Portals",
    sword: "Swords",
    pickaxe: "Pickaxes",
    shield: "Shields",
  };
  for (const [id, label] of Object.entries(labels)) {
    const tile = document.createElement("div");
    tile.className = "inventory-item";
    tile.innerHTML = `<strong>${label}</strong><span>${inventory[id] ?? 0}</span>`;
    inventoryGrid.append(tile);
  }

  recipeList.innerHTML = "";
  for (const recipe of recipes) {
    const card = document.createElement("div");
    card.className = "recipe";
    const cost = Object.entries(recipe.needs).map(([item, amount]) => `${amount} ${item}`).join(", ");
    card.innerHTML = `<strong>${recipe.name}</strong><p>${recipe.text}<br>Cost: ${cost}</p>`;
    const button = document.createElement("button");
    button.textContent = "Craft";
    button.disabled = !canAfford(recipe.needs);
    button.addEventListener("click", () => craft(recipe));
    card.append(button);
    recipeList.append(card);
  }
}

function toggleInventory(force) {
  inventoryOpen = force ?? !inventoryOpen;
  inventoryPanel.classList.toggle("hidden", !inventoryOpen);
  inventoryPanel.setAttribute("aria-hidden", String(!inventoryOpen));
  if (inventoryOpen) {
    renderInventory();
    document.exitPointerLock?.();
  }
}

function renderVitals() {
  const hearts = "#".repeat(Math.ceil(player.health / 2)).padEnd(10, "-");
  const hunger = "#".repeat(Math.ceil(player.hunger / 2)).padEnd(10, "-");
  const armor = "#".repeat(Math.ceil(player.armor / 2)).padEnd(5, "-");
  healthEl.textContent = `health ${hearts}`;
  hungerEl.textContent = `hunger ${hunger}`;
  armorEl.textContent = `armor  ${armor}`;
  const label = offhandMode === "empty" ? "Empty" : offhandMode === "shield" ? "Shield" : "Food";
  offhandEl.textContent = `offhand\n${label}\nF/Q swap`;
}

function cycleOffhand() {
  const modes = ["empty", "shield", "food"];
  offhandMode = modes[(modes.indexOf(offhandMode) + 1) % modes.length];
  player.shielding = false;
  statusEl.textContent = `Offhand: ${offhandMode}`;
}

function eatFood() {
  if (inventory.food <= 0) {
    statusEl.textContent = "No food left";
    return;
  }
  inventory.food -= 1;
  player.hunger = Math.min(20, player.hunger + 6);
  player.health = Math.min(20, player.health + 2);
  burst(player.position.clone().add(new THREE.Vector3(0, -0.6, 0)), 0xffe08a, 16);
  statusEl.textContent = "Snack consumed";
  renderInventory();
}

function useNearbyStation() {
  const px = Math.round(player.position.x);
  const py = Math.round(player.position.y - 1);
  const pz = Math.round(player.position.z);
  for (let x = px - 2; x <= px + 2; x += 1) {
    for (let y = py - 2; y <= py + 2; y += 1) {
      for (let z = pz - 2; z <= pz + 2; z += 1) {
        const type = getBlock(x, y, z);
        if (type === "furnace" && inventory.ironOre > 0 && inventory.coal > 0) {
          inventory.ironOre -= 1;
          inventory.coal -= 1;
          inventory.iron += 1;
          statusEl.textContent = "Furnace smelted iron";
          renderInventory();
          return;
        }
        if (type === "anvil") {
          player.armor = Math.min(10, player.armor + 1);
          statusEl.textContent = "Anvil tightened your armor";
          return;
        }
        if (type === "workbench") {
          toggleInventory(true);
          statusEl.textContent = "Workbench opened";
          return;
        }
      }
    }
  }
  if (offhandMode === "food") eatFood();
  else statusEl.textContent = "No station nearby";
}

function updateCamera() {
  camera.rotation.order = "YXZ";
  camera.rotation.y = player.yaw;
  camera.rotation.x = player.pitch;
  camera.position.copy(player.position);
}

function solidAt(x, y, z) {
  const type = getBlock(x, y, z);
  return Boolean(type && type !== "water" && type !== "flower");
}

function waterAt(x, y, z) {
  return getBlock(x, y, z) === "water";
}

function intersectsPlayer(x, y, z) {
  return (
    Math.abs(player.position.x - x) < 0.85 &&
    Math.abs(player.position.y - 0.9 - y) < 1.4 &&
    Math.abs(player.position.z - z) < 0.85
  );
}

function blockAtPlayerFeet(position) {
  return [
    [0, 0],
    [0.34, 0.34],
    [-0.34, 0.34],
    [0.34, -0.34],
    [-0.34, -0.34],
  ].some(([sx, sz]) => solidAt(Math.round(position.x + sx), Math.floor(position.y - 1.65), Math.round(position.z + sz)));
}

function solidAtBody(position) {
  return [
    [0.38, 0.15, 0.38],
    [-0.38, 0.15, 0.38],
    [0.38, 0.15, -0.38],
    [-0.38, 0.15, -0.38],
    [0.38, -0.85, 0.38],
    [-0.38, -0.85, 0.38],
    [0.38, -0.85, -0.38],
    [-0.38, -0.85, -0.38],
  ].some(([sx, sy, sz]) => solidAt(Math.round(position.x + sx), Math.round(position.y + sy), Math.round(position.z + sz)));
}

function bodyInWater(position) {
  return [
    [0, -0.4, 0],
    [0.32, -0.9, 0.32],
    [-0.32, -0.9, 0.32],
    [0.32, -0.9, -0.32],
    [-0.32, -0.9, -0.32],
  ].some(([sx, sy, sz]) => waterAt(Math.round(position.x + sx), Math.round(position.y + sy), Math.round(position.z + sz)));
}

function movePlayer(delta) {
  const forward = new THREE.Vector3(-Math.sin(player.yaw), 0, -Math.cos(player.yaw));
  const right = new THREE.Vector3(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
  const wish = new THREE.Vector3();
  const inWater = bodyInWater(player.position);

  if (keys.has("KeyW")) wish.add(forward);
  if (keys.has("KeyS")) wish.sub(forward);
  if (keys.has("KeyD")) wish.add(right);
  if (keys.has("KeyA")) wish.sub(right);
  if (wish.lengthSq() > 0) wish.normalize();

  const sprint = keys.has("ShiftLeft") ? 1.65 : 1;
  const speed = (inWater ? 3.4 : 6) * sprint;
  player.velocity.x = wish.x * speed;
  player.velocity.z = wish.z * speed;

  if (inWater) {
    player.velocity.y -= 4.5 * delta;
    player.velocity.y = Math.max(player.velocity.y, -3.2);
    player.velocity.x *= 0.85;
    player.velocity.z *= 0.85;
    if (keys.has("Space")) player.velocity.y = 4.2;
    if (keys.has("KeyC") || keys.has("ShiftLeft")) player.velocity.y = -3.4;
  } else {
    player.velocity.y -= 24 * delta;
    player.velocity.y = Math.max(player.velocity.y, -32);
  }

  const next = player.position.clone();
  next.x += player.velocity.x * delta;
  if (!solidAtBody(next)) player.position.x = next.x;

  next.copy(player.position);
  next.z += player.velocity.z * delta;
  if (!solidAtBody(next)) player.position.z = next.z;

  next.copy(player.position);
  next.y += player.velocity.y * delta;
  if (solidAtBody(next)) {
    if (player.velocity.y < 0) {
      player.position.y = Math.ceil(next.y - 1.5) + 1.55;
      player.onGround = true;
    }
    player.velocity.y = 0;
  } else {
    player.position.y = next.y;
    player.onGround = inWater || blockAtPlayerFeet(player.position);
  }

  if (player.position.y < -18) {
    player.position.set(21, 14, -25);
    player.velocity.set(0, 0, 0);
  }
}

function targetBlock() {
  raycaster.setFromCamera({ x: 0, y: 0 }, camera);
  const hits = raycaster.intersectObjects([...blockMeshes.values()], false);
  return hits[0] ?? null;
}

function burst(position, color, amount = 18) {
  const mat = new THREE.MeshBasicMaterial({ color });
  for (let i = 0; i < amount; i += 1) {
    const particle = new THREE.Mesh(boxGeometry, mat);
    particle.scale.setScalar(0.11 + Math.random() * 0.09);
    particle.position.copy(position);
    const velocity = new THREE.Vector3(
      (Math.random() - 0.5) * 7,
      Math.random() * 6,
      (Math.random() - 0.5) * 7,
    );
    scene.add(particle);
    particles.push({ mesh: particle, velocity, life: 0.7 + Math.random() * 0.45 });
  }
}

function explode(cx, cy, cz) {
  const center = new THREE.Vector3(cx, cy, cz);
  for (let x = cx - 3; x <= cx + 3; x += 1) {
    for (let y = cy - 3; y <= cy + 3; y += 1) {
      for (let z = cz - 3; z <= cz + 3; z += 1) {
        if (center.distanceTo(new THREE.Vector3(x, y, z)) <= 3.2 && getBlock(x, y, z) && y > MAX_DEPTH) {
          removeBlock(x, y, z, true);
        }
      }
    }
  }
  burst(center, 0xff6b35, 80);
  statusEl.textContent = "Blast crater made";
}

function dropFromBlock(type) {
  const drops = {
    wood: { wood: 2 },
    leaf: { food: Math.random() > 0.55 ? 1 : 0 },
    stone: { stone: 1 },
    coalOre: { coal: 2 },
    ironOre: { ironOre: 1 },
    goldOre: { gold: 1 },
    gemOre: { gem: 1 },
    workbench: { workbench: 1 },
    furnace: { furnace: 1 },
    anvil: { anvil: 1 },
    portal: { portal: 1 },
  }[type];
  if (!drops) return;
  for (const [item, amount] of Object.entries(drops)) {
    if (amount > 0) inventory[item] = (inventory[item] ?? 0) + amount;
  }
  renderInventory();
}

function targetMob() {
  raycaster.setFromCamera({ x: 0, y: 0 }, camera);
  const hits = raycaster.intersectObjects(mobs.map((mob) => mob.mesh), false);
  return hits[0] ?? null;
}

function hitMob(power = 2) {
  const hit = targetMob();
  if (!hit || hit.distance > 7) return false;
  const mob = mobs.find((candidate) => candidate.mesh === hit.object);
  if (!mob) return false;
  mob.health -= power;
  burst(mob.mesh.position, mob.hostile ? 0x7c2cff : 0xffffff, 20);
  statusEl.textContent = `${mob.name} hit`;
  if (mob.health <= 0) {
    scene.remove(mob.mesh);
    mobs.splice(mobs.indexOf(mob), 1);
    inventory.food += mob.hostile ? 0 : 1;
    inventory.bone += mob.hostile ? 2 : 0;
    inventory.gem += mob.name === "portal imp" ? 1 : 0;
    statusEl.textContent = `${mob.name} dropped loot`;
    renderInventory();
  }
  return true;
}

function takeDamage(amount) {
  if (player.hurtCooldown > 0) return;
  const blocked = player.shielding && offhandMode === "shield" && inventory.shield > 0;
  const reduction = blocked ? 0.75 : player.armor * 0.045;
  player.health = Math.max(0, player.health - amount * (1 - reduction));
  player.hurtCooldown = blocked ? 0.55 : 0.9;
  statusEl.textContent = blocked ? "Shield blocked most damage" : "Ouch";
  if (player.health <= 0) {
    player.position.set(21, 12, -25);
    player.velocity.set(0, 0, 0);
    player.health = 20;
    player.hunger = 16;
    statusEl.textContent = "Respawned on dry land";
  }
}

function mineBlock() {
  if (hitMob(player.weapon === "sword" ? 5 : 2)) return;
  const hit = targetBlock();
  if (!hit) return;
  const { x, y, z, type } = hit.object.userData.block;
  if (y <= MAX_DEPTH) return;
  burst(hit.object.position, materials[type].color.getHex(), 18);
  dropFromBlock(type);
  removeBlock(x, y, z, true);
}

function placeBlock() {
  const hit = targetBlock();
  if (!hit) return;
  const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
  const base = hit.object.userData.block;
  const x = Math.round(base.x + normal.x);
  const y = Math.round(base.y + normal.y);
  const z = Math.round(base.z + normal.z);
  const type = blockTypes[selectedIndex].id;
  if (intersectsPlayer(x, y, z)) return;
  if (type === "blast") {
    explode(x, y, z);
    return;
  }
  if (["workbench", "furnace", "anvil", "portal"].includes(type)) {
    if ((inventory[type] ?? 0) <= 0) {
      statusEl.textContent = `Craft a ${type} first`;
      return;
    }
    inventory[type] -= 1;
    renderInventory();
  }
  if (addBlock(x, y, z, type, true)) burst(new THREE.Vector3(x, y, z), blockTypes[selectedIndex].color, 10);
}

function updateParticles(delta) {
  for (let i = particles.length - 1; i >= 0; i -= 1) {
    const particle = particles[i];
    particle.life -= delta;
    particle.velocity.y -= 10 * delta;
    particle.mesh.position.addScaledVector(particle.velocity, delta);
    particle.mesh.rotation.x += delta * 8;
    particle.mesh.rotation.y += delta * 6;
    if (particle.life <= 0) {
      scene.remove(particle.mesh);
      particles.splice(i, 1);
    }
  }
}

function updateMobs(delta) {
  for (const mob of mobs) {
    mob.phase += delta;
    mob.attackCooldown = Math.max(0, mob.attackCooldown - delta);
    const toPlayer = player.position.clone().sub(mob.mesh.position);
    const distance = toPlayer.length();
    if (running && mob.hostile && distance < 18) {
      toPlayer.y = 0;
      if (toPlayer.lengthSq() > 0) toPlayer.normalize();
      mob.mesh.position.x += toPlayer.x * delta * 2.5;
      mob.mesh.position.z += toPlayer.z * delta * 2.5;
      mob.mesh.rotation.y = Math.atan2(toPlayer.x, toPlayer.z);
      if (distance < 1.8 && mob.attackCooldown <= 0) {
        takeDamage(3.5);
        mob.attackCooldown = 1.2;
      }
    } else {
      mob.mesh.position.x = mob.home.x + Math.sin(mob.phase * 0.9) * 1.8;
      mob.mesh.position.z = mob.home.z + Math.cos(mob.phase * 0.7) * 1.8;
      mob.mesh.rotation.y += delta * 1.2;
    }
    mob.mesh.position.y = mob.home.y + Math.abs(Math.sin(mob.phase * 2.2)) * 0.55;
  }
}

function updateSky(delta) {
  clock = (clock + delta * 0.012) % 1;
  const angle = clock * Math.PI * 2;
  const daylight = Math.max(0.08, Math.sin(angle) * 0.92 + 0.08);
  const skyDay = new THREE.Color(0x80c7ff);
  const skyNight = new THREE.Color(player.dimension === "rift" ? 0x190021 : 0x101729);
  const sky = skyNight.clone().lerp(skyDay, daylight);
  if (player.dimension === "rift") sky.lerp(new THREE.Color(0x5f2d82), 0.45);

  scene.background = sky;
  scene.fog.color = sky;
  sun.position.set(Math.cos(angle) * 42, Math.sin(angle) * 54, 24);
  sun.intensity = 0.35 + daylight * 2.45;
  moon.position.set(-sun.position.x, -sun.position.y + 10, -sun.position.z);
  moon.intensity = 0.1 + (1 - daylight) * 0.7;
  hemi.intensity = 0.55 + daylight * 1.1;
  clouds.position.x = Math.sin(clock * Math.PI * 2) * 8;
}

function updateSurvival(delta) {
  player.hurtCooldown = Math.max(0, player.hurtCooldown - delta);
  hungerTimer += delta;
  if (hungerTimer > 4) {
    hungerTimer = 0;
    if (running) player.hunger = Math.max(0, player.hunger - 0.35);
    if (player.hunger > 14 && player.health < 20) player.health = Math.min(20, player.health + 0.5);
    if (player.hunger <= 0) takeDamage(1);
  }
}

function nearbyBlock(type, radius = 2) {
  const px = Math.round(player.position.x);
  const py = Math.round(player.position.y - 1);
  const pz = Math.round(player.position.z);
  for (let x = px - radius; x <= px + radius; x += 1) {
    for (let y = py - radius; y <= py + radius; y += 1) {
      for (let z = pz - radius; z <= pz + radius; z += 1) {
        if (getBlock(x, y, z) === type) return true;
      }
    }
  }
  return false;
}

function updatePortal() {
  if (portalCooldown > 0) return;
  if (!running || !nearbyBlock("portal", 1)) return;
  if (player.dimension === "overworld") {
    player.dimension = "rift";
    player.position.set(16, 17, -16);
    player.yaw += Math.PI;
    inventory.gem += 1;
    statusEl.textContent = "Entered the rift, got a gem";
  } else {
    player.dimension = "overworld";
    player.position.set(21, 12, -25);
    statusEl.textContent = "Returned to overworld";
  }
  portalCooldown = 3;
  burst(player.position, 0x9d5cff, 90);
}

function updateStats() {
  const x = player.position.x.toFixed(1);
  const y = player.position.y.toFixed(1);
  const z = player.position.z.toFixed(1);
  statsEl.textContent = `mode: survival / ${player.dimension}\nweapon: ${player.weapon}\nxyz: ${x}, ${y}, ${z}\nmined: ${worldBlocksMined}  placed: ${worldBlocksPlaced}`;
}

function drawMinimap() {
  mapCtx.clearRect(0, 0, minimap.width, minimap.height);
  mapCtx.fillStyle = "rgba(12, 24, 20, 0.8)";
  mapCtx.fillRect(0, 0, minimap.width, minimap.height);

  const scale = 2;
  const center = minimap.width / 2;
  const px = Math.round(player.position.x);
  const pz = Math.round(player.position.z);
  for (let x = px - 32; x <= px + 32; x += 1) {
    for (let z = pz - 32; z <= pz + 32; z += 1) {
      const top = topMap.get(columnKey(x, z));
      if (!top) continue;
      const color = {
        grass: "#5baa3b",
        sand: "#d9c77d",
        snow: "#eaf7ff",
        stone: "#7f8585",
        dirt: "#7f5132",
        water: "#2f86db",
        coalOre: "#33383a",
        ironOre: "#b98562",
        goldOre: "#f1c84b",
        gemOre: "#56b4ff",
        portal: "#8c4dff",
        workbench: "#b5793e",
        furnace: "#4f5757",
        anvil: "#33383c",
      }[top.type] ?? "#35672f";
      mapCtx.fillStyle = color;
      mapCtx.fillRect(center + (x - px) * scale, center + (z - pz) * scale, scale, scale);
    }
  }
  mapCtx.save();
  mapCtx.translate(center, center);
  mapCtx.rotate(-player.yaw);
  mapCtx.fillStyle = "#ff4f4f";
  mapCtx.beginPath();
  mapCtx.moveTo(0, -7);
  mapCtx.lineTo(5, 6);
  mapCtx.lineTo(-5, 6);
  mapCtx.closePath();
  mapCtx.fill();
  mapCtx.restore();
}

function animate(now) {
  const delta = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;
  updateSky(delta);
  portalCooldown = Math.max(0, portalCooldown - delta);

  if (running) {
    movePlayer(delta);
    updateCamera();
  }

  updateSurvival(delta);
  updateParticles(delta);
  updateMobs(delta);
  updatePortal();
  updateStats();
  renderVitals();
  drawMinimap();
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

function begin() {
  running = true;
  startPanel.classList.add("hidden");
  statusEl.textContent = `${blockTypes[selectedIndex].label} selected`;
  canvas.requestPointerLock?.();
}

generateWorld();
createHotbar();
renderInventory();
renderVitals();
updateCamera();
requestAnimationFrame(animate);

startButton.addEventListener("click", begin);
closeInventory.addEventListener("click", () => toggleInventory(false));

document.addEventListener("pointerlockchange", () => {
  if (document.pointerLockElement === canvas) {
    running = true;
    startPanel.classList.add("hidden");
  }
});

document.addEventListener("mousemove", (event) => {
  if (!running || inventoryOpen) return;
  player.yaw -= event.movementX * 0.0023;
  player.pitch -= event.movementY * 0.0023;
  player.pitch = THREE.MathUtils.clamp(player.pitch, -1.45, 1.45);
});

document.addEventListener("keydown", (event) => {
  if (event.code === "KeyE" && !event.repeat) {
    toggleInventory();
    return;
  }
  if (inventoryOpen) return;
  keys.add(event.code);
  if (event.code === "Space" && player.onGround) {
    player.velocity.y = 8.7;
    player.onGround = false;
  }
  if (event.code === "KeyF" && !event.repeat) {
    cycleOffhand();
  }
  if (event.code === "KeyQ" && !event.repeat) {
    cycleOffhand();
  }
  if (event.code === "KeyR" && !event.repeat) {
    useNearbyStation();
  }
  if (event.code === "KeyX" && !event.repeat) {
    hitMob(player.weapon === "sword" ? 6 : 2);
  }

  const number = Number(event.key);
  if (number >= 1 && number <= blockTypes.length) {
    selectedIndex = number - 1;
    updateHotbar();
  }
});

document.addEventListener("keyup", (event) => keys.delete(event.code));

document.addEventListener("mousedown", (event) => {
  if (!running || inventoryOpen) return;
  if (event.button === 0) mineBlock();
  if (event.button === 2) {
    if (offhandMode === "shield" && inventory.shield > 0) {
      player.shielding = true;
      statusEl.textContent = "Shield raised";
    } else if (offhandMode === "food") {
      eatFood();
    } else {
      placeBlock();
    }
  }
});

document.addEventListener("mouseup", (event) => {
  if (event.button === 2) player.shielding = false;
});

document.addEventListener("contextmenu", (event) => event.preventDefault());

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});
