// A flat screen in 3D that is drawn with a 2D canvas. It has buttons that you can
// poke with a fingertip, point at with a controller, or click in the preview.
import * as THREE from 'three';

export class Panel {
  constructor(wM, hM, pxW) {
    this.wM = wM;
    this.hM = hM;
    this.pxW = pxW;
    this.pxH = Math.round((pxW * hM) / wM);
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.pxW;
    this.canvas.height = this.pxH;
    this.g = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(wM, hM),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, depthWrite: false }),
    );
    this.mesh.renderOrder = 5;
    this.buttons = [];
    this.sig = null;
    this.lastDraw = -1;
    this.flashId = null;
    this.flashUntil = 0;
  }

  /** Redraws only when sig changes, and not more often than minGap seconds (unless forced). */
  draw(sig, fn, now = 0, minGap = 0, force = false) {
    const flash = this.flashUntil > now ? this.flashId : null;
    const full = sig + '|' + flash;
    if (full === this.sig) return;
    if (!force && minGap > 0 && now - this.lastDraw < minGap && this.flashOld === flash) return;
    this.sig = full;
    this.flashOld = flash;
    this.lastDraw = now;
    const g = this.g;
    g.clearRect(0, 0, this.pxW, this.pxH);
    this.buttons = [];
    this.flashNow = flash;
    fn(g, this);
    this.tex.needsUpdate = true;
  }

  // ------------------------------------------------------------ drawing helpers

  card(color = 'rgba(20,17,46,0.88)', r = 36) {
    const g = this.g;
    g.fillStyle = color;
    roundRect(g, 0, 0, this.pxW, this.pxH, r);
    g.fill();
  }

  text(s, x, y, size, color = '#fff', align = 'center', bold = true, maxW = 0) {
    const g = this.g;
    g.font = (bold ? 'bold ' : '') + size + 'px system-ui, -apple-system, Roboto, sans-serif';
    g.textAlign = align;
    g.textBaseline = 'middle';
    g.fillStyle = color;
    if (maxW > 0) {
      let t = s;
      while (t.length > 4 && g.measureText(t).width > maxW) t = t.slice(0, -2);
      if (t !== s) s = t.trim() + '...';
    }
    g.fillText(s, x, y);
  }

  button(id, x, y, w, h, label, color, textColor = '#fff', size = 0) {
    const g = this.g;
    const on = this.flashNow === id;
    g.fillStyle = on ? '#FFFFFF' : color;
    roundRect(g, x, y, w, h, Math.min(h / 2, 28));
    g.fill();
    this.text(label, x + w / 2, y + h / 2 + 1, size || Math.round(h * 0.38), on ? '#15122E' : textColor);
    this.buttons.push({ id, x, y, w, h });
  }

  // ------------------------------------------------------------ hit tests

  hitPx(px, py) {
    for (const b of this.buttons) {
      if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) return b.id;
    }
    return null;
  }

  /** A fingertip at a world point. Returns a button id when the tip is at the panel. */
  poke(world) {
    if (!this.mesh.visible) return null;
    const p = this.mesh.worldToLocal(world.clone());
    if (p.z > 0.012 || p.z < -0.02) return null;
    const px = (p.x / this.wM + 0.5) * this.pxW;
    const py = (0.5 - p.y / this.hM) * this.pxH;
    return this.hitPx(px, py);
  }

  /** A ray (THREE.Raycaster). Returns {id, distance} or null. */
  ray(raycaster) {
    if (!this.mesh.visible) return null;
    const hit = raycaster.intersectObject(this.mesh, false)[0];
    if (!hit || !hit.uv) return null;
    const id = this.hitPx(hit.uv.x * this.pxW, (1 - hit.uv.y) * this.pxH);
    return { id, distance: hit.distance };
  }

  flash(id, now) {
    this.flashId = id;
    this.flashUntil = now + 0.18;
  }
}

export function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export function drawStar(g, cx, cy, r, color) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.45;
    const x = cx + Math.cos(a) * rr;
    const y = cy + Math.sin(a) * rr;
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.closePath();
  g.fillStyle = color;
  g.fill();
}
