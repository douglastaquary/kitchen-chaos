import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const file = resolve(process.argv[2] ?? resolve(here, "../public/assets/kitchen.glb"));

const REQUIRED = [
  "counter_teal", "counter_coral", "counter_cream", "stove", "sink", "serve_window", "crate_station", "trash",
  "heap_lettuce", "heap_tomato", "heap_meat", "heap_bun", "heap_noodles",
  "pot", "pan", "cutting_board", "plate", "plate_stack",
  "bun", "bun_bottom", "bun_top", "patty_raw", "patty_cooked", "patty_burnt", "lettuce", "lettuce_chopped",
  "tomato", "tomato_chopped", "noodles", "bowl_soup", "bowl_noodles",
  "chef_player", "chef_bot", "wall_shelf", "chalkboard", "pan_rack", "extinguisher",
];
const REQUIRED_CHILDREN = [
  "chef_player_body", "chef_player_handL", "chef_player_handR",
  "chef_bot_body", "chef_bot_handL", "chef_bot_handR", "chalkboard_face",
];

const buf = readFileSync(file);
if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error("not a GLB file");
const jsonLen = buf.readUInt32LE(12);
if (buf.readUInt32LE(16) !== 0x4e4f534a) throw new Error("first chunk is not JSON");
const gltf = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));

const nodes = gltf.nodes ?? [];
const scene = gltf.scenes[gltf.scene ?? 0];
const top = scene.nodes.map((i) => nodes[i]);

let tris = 0;
for (const mesh of gltf.meshes ?? []) {
  for (const prim of mesh.primitives) {
    if ((prim.mode ?? 4) !== 4) continue;
    const acc = gltf.accessors[prim.indices ?? prim.attributes.POSITION];
    tris += acc.count / 3;
  }
}

// Bounds in glTF space (Y-up, +Z = asset front). Children only carry translations.
function bounds(n) {
  const mn = [Infinity, Infinity, Infinity];
  const mx = [-Infinity, -Infinity, -Infinity];
  const visit = (node, off) => {
    const t = node.translation ?? [0, 0, 0];
    const o = off.map((v, k) => v + t[k]);
    if (node.mesh !== undefined) {
      for (const prim of gltf.meshes[node.mesh].primitives) {
        const acc = gltf.accessors[prim.attributes.POSITION];
        for (let k = 0; k < 3; k++) {
          mn[k] = Math.min(mn[k], acc.min[k] + o[k]);
          mx[k] = Math.max(mx[k], acc.max[k] + o[k]);
        }
      }
    }
    for (const c of node.children ?? []) visit(nodes[c], o);
  };
  visit({ ...n, translation: [0, 0, 0] }, [0, 0, 0]);
  return { mn, mx };
}

const f = (v) => v.toFixed(3).padStart(6);
console.log(`Top-level nodes (${top.length}):  [x range | height range | z range (+z = front)]`);
for (const n of top) {
  const kids = (n.children ?? []).map((i) => nodes[i].name).join(", ");
  const moved = n.translation && n.translation.some((v) => Math.abs(v) > 1e-6) ? "  !! NOT AT ORIGIN" : "";
  const { mn, mx } = bounds(n);
  console.log(
    `  ${n.name.padEnd(16)} x[${f(mn[0])},${f(mx[0])}] h[${f(mn[1])},${f(mx[1])}] z[${f(mn[2])},${f(mx[2])}]` +
      `  -> ${kids}${moved}`,
  );
}

const names = new Set(top.map((n) => n.name));
const all = new Set(nodes.map((n) => n.name));
const missing = REQUIRED.filter((n) => !names.has(n));
const missingKids = REQUIRED_CHILDREN.filter((n) => !all.has(n));
const extra = [...names].filter((n) => !REQUIRED.includes(n));
const size = statSync(file).size;

console.log(`meshes=${gltf.meshes?.length ?? 0} materials=${gltf.materials?.length ?? 0} triangles=${tris}`);
console.log(`materials: ${(gltf.materials ?? []).map((m) => m.name).join(", ")}`);
console.log(`file size: ${(size / 1024).toFixed(1)} KB (${size} bytes)`);
console.log(`missing top-level: ${missing.length ? missing.join(", ") : "none"}`);
console.log(`missing children: ${missingKids.length ? missingKids.join(", ") : "none"}`);
console.log(`unexpected top-level: ${extra.length ? extra.join(", ") : "none"}`);
if (missing.length || missingKids.length || size >= 3 * 1024 * 1024) process.exit(1);
