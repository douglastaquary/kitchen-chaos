import * as THREE from 'three';
import { GRID_H, GRID_W, floorZone } from '../game/Layout';
import { RECIPES, RECIPE_ORDER } from '../game/Items';

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return [canvas, ctx];
}

function finish(canvas: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const ZONE_COLORS = {
  player: ['#bfe9d2', '#a8dfc1', '#96d3b2'],
  mid: ['#fbe3a4', '#f6d487', '#eec46f'],
  bot: ['#f9c1b3', '#f4aa9a', '#ec9887'],
};

/** Checkerboard floor with a soft diamond motif, tinted per zone (mint / butter / coral). */
export function createFloorTexture(): THREE.CanvasTexture {
  const px = 96;
  const [canvas, ctx] = makeCanvas(GRID_W * px, GRID_H * px);
  for (let z = 0; z < GRID_H; z += 1) {
    for (let x = 0; x < GRID_W; x += 1) {
      const zone = floorZone(x);
      const [light, dark, line] = ZONE_COLORS[zone];
      const checker = (x + z) % 2 === 0;
      ctx.fillStyle = checker ? light : dark;
      ctx.fillRect(x * px, z * px, px, px);
      // Soft inner diamond
      const cx = x * px + px / 2;
      const cy = z * px + px / 2;
      ctx.strokeStyle = checker ? dark : light;
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx, cy - px * 0.22);
      ctx.lineTo(cx + px * 0.22, cy);
      ctx.lineTo(cx, cy + px * 0.22);
      ctx.lineTo(cx - px * 0.22, cy);
      ctx.closePath();
      ctx.stroke();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = checker ? dark : light;
      ctx.beginPath();
      ctx.moveTo(cx, cy - px * 0.09);
      ctx.lineTo(cx + px * 0.09, cy);
      ctx.lineTo(cx, cy + px * 0.09);
      ctx.lineTo(cx - px * 0.09, cy);
      ctx.fill();
      // Grout
      ctx.globalAlpha = 0.28;
      ctx.strokeStyle = line;
      ctx.lineWidth = 2;
      ctx.strokeRect(x * px + 1, z * px + 1, px - 2, px - 2);
      ctx.globalAlpha = 1;
    }
  }
  // Subtle speckle for material variation
  for (let i = 0; i < 2600; i += 1) {
    const sx = (i * 7919) % canvas.width;
    const sy = (i * 104729) % canvas.height;
    ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.18)' : 'rgba(90,60,40,0.05)';
    ctx.fillRect(sx, sy, 2, 2);
  }
  const tex = finish(canvas);
  tex.anisotropy = 8;
  return tex;
}

/** Warm wooden planks around the kitchen. */
export function createPlankTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(512, 512);
  const tones = ['#e7b67f', '#e0ab72', '#eabd88', '#dca46a'];
  const plankH = 64;
  for (let row = 0; row < 512 / plankH; row += 1) {
    let x = -((row * 137) % 200);
    while (x < 512) {
      const w = 180 + ((row * 31 + x) % 90);
      ctx.fillStyle = tones[(row + Math.abs(x)) % tones.length];
      ctx.fillRect(x, row * plankH, w, plankH);
      ctx.strokeStyle = 'rgba(120,70,30,0.35)';
      ctx.lineWidth = 3;
      ctx.strokeRect(x + 1.5, row * plankH + 1.5, w - 3, plankH - 3);
      ctx.strokeStyle = 'rgba(150,95,50,0.12)';
      ctx.lineWidth = 2;
      for (let g = 0; g < 3; g += 1) {
        const gy = row * plankH + 14 + g * 16;
        ctx.beginPath();
        ctx.moveTo(x + 8, gy);
        ctx.bezierCurveTo(x + w * 0.3, gy + 4, x + w * 0.6, gy - 4, x + w - 8, gy + 2);
        ctx.stroke();
      }
      x += w;
    }
  }
  const tex = finish(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Back wall: warm cream plaster, teal tile backsplash band and a wood skirting. */
export function createWallTexture(widthUnits: number, heightUnits: number): THREE.CanvasTexture {
  const ppu = 96;
  const [canvas, ctx] = makeCanvas(Math.round(widthUnits * ppu), Math.round(heightUnits * ppu));
  const H = canvas.height;
  const yOf = (units: number) => H - units * ppu;
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#fbe7c8');
  grad.addColorStop(1, '#f7dcb6');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, H);

  // Tile band from counter height up to ~1.55
  const bandTop = yOf(1.55);
  const bandBottom = yOf(0.85);
  ctx.fillStyle = '#56bfae';
  ctx.fillRect(0, bandTop, canvas.width, bandBottom - bandTop);
  const tileW = ppu * 0.25;
  const tileH = ppu * 0.14;
  for (let y = bandTop, r = 0; y < bandBottom; y += tileH, r += 1) {
    for (let x = r % 2 ? -tileW / 2 : 0; x < canvas.width; x += tileW) {
      ctx.fillStyle = (Math.floor(x / tileW) + r) % 3 === 0 ? '#63c9b8' : '#52b9a8';
      roundRect(ctx, x + 1.5, y + 1.5, tileW - 3, tileH - 3, 3);
      ctx.fill();
    }
  }
  ctx.fillStyle = '#f3f0e6';
  ctx.fillRect(0, bandTop - 8, canvas.width, 8);
  ctx.fillStyle = 'rgba(0,0,0,0.06)';
  ctx.fillRect(0, bandTop, canvas.width, 4);
  // Wood skirting under the counters
  ctx.fillStyle = '#d79d62';
  ctx.fillRect(0, yOf(0.85), canvas.width, H);
  return finish(canvas);
}

/** Chalkboard with the day's specials (matches the recipe table). */
export function createChalkboardTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(1024, 560);
  ctx.fillStyle = '#23443a';
  ctx.fillRect(0, 0, 1024, 560);
  // chalk dust
  for (let i = 0; i < 900; i += 1) {
    ctx.fillStyle = `rgba(255,255,255,${0.015 + ((i * 37) % 10) / 400})`;
    ctx.beginPath();
    ctx.arc((i * 7919) % 1024, (i * 3571) % 560, 2 + (i % 5), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#fdfbf2';
  ctx.textAlign = 'center';
  ctx.font = '800 78px Fredoka, "Baloo 2", "Arial Rounded MT Bold", sans-serif';
  ctx.fillText("TODAY'S SPECIALS", 512, 104);
  ctx.strokeStyle = '#f4c95d';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(900, 78, 26, 0, Math.PI * 2);
  ctx.stroke();
  ctx.font = '700 40px Fredoka, "Baloo 2", "Arial Rounded MT Bold", sans-serif';
  RECIPE_ORDER.forEach((id, i) => {
    const r = RECIPES[id];
    const y = 190 + i * 74;
    ctx.fillStyle = i % 2 ? '#f6d06b' : '#fdfbf2';
    ctx.textAlign = 'left';
    ctx.fillText(r.name, 110, y);
    ctx.textAlign = 'right';
    ctx.fillText(String(r.value), 914, y);
  });
  return finish(canvas);
}

/** Rounded glowing frame drawn on the top of the station the chef is facing. */
export function createHighlightTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(256, 256);
  ctx.shadowColor = 'rgba(255, 236, 140, 1)';
  ctx.shadowBlur = 28;
  ctx.strokeStyle = 'rgba(255, 244, 190, 1)';
  ctx.lineWidth = 14;
  roundRect(ctx, 26, 26, 204, 204, 30);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255, 232, 150, 0.28)';
  roundRect(ctx, 30, 30, 196, 196, 28);
  ctx.fill();
  return finish(canvas);
}

export function createSoftDotTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(64, 64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.7)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return finish(canvas);
}

export function createStarTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(64, 64);
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? 30 : 12;
    ctx.lineTo(32 + Math.cos(a) * r, 32 + Math.sin(a) * r);
  }
  ctx.closePath();
  ctx.fill();
  return finish(canvas);
}

/** White disc with a drop shadow holding an item icon (the floating crate markers). */
export function createIconDiscTexture(icon: HTMLCanvasElement | undefined, ring = '#ffffff'): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(160, 160);
  ctx.fillStyle = 'rgba(60,40,30,0.18)';
  ctx.beginPath();
  ctx.ellipse(80, 86, 66, 66, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(80, 78, 66, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = ring;
  ctx.stroke();
  if (icon) ctx.drawImage(icon, 22, 20, 116, 116);
  return finish(canvas);
}

export function createBadgeTexture(kind: 'warn' | 'done' | 'burnt'): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(128, 128);
  const fill = kind === 'done' ? '#46c37b' : kind === 'warn' ? '#ff5a4e' : '#4a3a34';
  ctx.fillStyle = 'rgba(40,20,10,0.25)';
  ctx.beginPath();
  ctx.arc(64, 70, 54, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(64, 62, 54, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 8;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle = '#ffffff';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (kind === 'done') {
    ctx.lineWidth = 14;
    ctx.beginPath();
    ctx.moveTo(38, 64);
    ctx.lineTo(56, 82);
    ctx.lineTo(90, 44);
    ctx.stroke();
  } else if (kind === 'warn') {
    ctx.font = '900 84px Fredoka, "Arial Rounded MT Bold", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('!', 64, 66);
  } else {
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.moveTo(42, 40);
    ctx.lineTo(86, 84);
    ctx.moveTo(86, 40);
    ctx.lineTo(42, 84);
    ctx.stroke();
  }
  return finish(canvas);
}

export function createBarTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(128, 32);
  ctx.fillStyle = '#ffffff';
  roundRect(ctx, 2, 2, 124, 28, 14);
  ctx.fill();
  return finish(canvas);
}

/** Shadow blob under chefs and loose items. */
export function createContactShadowTexture(): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(128, 128);
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(60,35,20,0.45)');
  g.addColorStop(0.6, 'rgba(60,35,20,0.2)');
  g.addColorStop(1, 'rgba(60,35,20,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return finish(canvas);
}

/** Soft coloured ring drawn on the floor under each chef (teal = you, red = rival). */
export function createChefRingTexture(color: string): THREE.CanvasTexture {
  const [canvas, ctx] = makeCanvas(256, 256);
  ctx.fillStyle = 'rgba(40,30,20,0.18)';
  ctx.beginPath();
  ctx.arc(128, 128, 100, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 26;
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.arc(128, 128, 104, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(255,255,255,0.65)';
  ctx.beginPath();
  ctx.arc(128, 128, 90, Math.PI * 1.1, Math.PI * 1.6);
  ctx.stroke();
  return finish(canvas);
}
