"use client";

import type { GameState, Team } from "@/lib/game/types";

const EMOJI_BULLETS = ["💥", "⚡", "❤️", "🔥", "✨", "🌟", "💫", "🎯"];
const TOWER_IMPACT_THRESHOLD = 100;

interface Bullet { team: Team; sx: number; sy: number; tx: number; ty: number; t: number; spd: number; emoji: string; power: number; crit: boolean }
interface FloatText { x: number; y: number; vy: number; life: number; text: string; crit: boolean; color: string }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; r: number; hue: number }
interface Soldier { team: Team; label: string; x: number; y: number; vx: number; life: number; img: HTMLImageElement | null; bot?: boolean }
interface Smoke { x: number; y: number; vx: number; vy: number; r: number; a: number }
interface Confetti { x: number; y: number; vx: number; vy: number; rot: number; vr: number; w: number; h: number; hue: number }
interface LikePop { x: number; y: number; vy: number; life: number; text: string; size: number }
interface JoinBadge { name: string; img: HTMLImageElement | null; team: Team; t: number; vip: boolean; slot: number }
interface Burst { side: Team; t: number }

export class ArenaScene {
  W = 360;
  H = 640;
  hudTop = 0;
  hudBottom = 0;
  gameState: GameState | null = null;
  suddenDeath = false;
  powerUntil = 0;

  private bullets: Bullet[] = [];
  private floats: FloatText[] = [];
  private particles: Particle[] = [];
  private soldiers: Soldier[] = [];
  private smokes: Smoke[] = [];
  private confetti: Confetti[] = [];
  private likePops: LikePop[] = [];
  private joins: JoinBadge[] = [];
  private bursts: Burst[] = [];
  private impact: Record<Team, number> = { red: 0, blue: 0 };
  private camZoom = 1;
  private camPanX = 0;
  private camPanY = 0;
  private imgCache = new Map<string, Promise<HTMLImageElement | null>>();
  private raf = 0;
  private ctx: CanvasRenderingContext2D | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d", { alpha: true });
  }

  start() {
    const loop = () => {
      this.tick();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop() {
    cancelAnimationFrame(this.raf);
  }

  resize(w: number, h: number) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.W = w;
    this.H = h;
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.canvas.style.width = w + "px";
    this.canvas.style.height = h + "px";
    this.ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  loadImage(url: string | null | undefined): Promise<HTMLImageElement | null> {
    if (!url) return Promise.resolve(null);
    const cached = this.imgCache.get(url);
    if (cached) return cached;
    const p = new Promise<HTMLImageElement | null>((resolve) => {
      const im = new Image();
      im.crossOrigin = "anonymous";
      im.onload = () => resolve(im);
      im.onerror = () => resolve(null);
      im.src = url;
    });
    this.imgCache.set(url, p);
    return p;
  }

  // ---------- Geometry ----------
  towerGeom() {
    const W = this.W;
    const top = this.hudTop;
    const bottom = this.H - this.hudBottom;
    const areaH = Math.max(160, bottom - top);
    const h = Math.min(areaH * 0.42, W * 0.6);
    const w = Math.min(W * 0.26, h * 0.62);
    const y = top + areaH * 0.5 - h * 0.35;
    const red = { x: W * 0.08, y, w, h, cx: W * 0.08 + w / 2, cy: y + h * 0.5 };
    const blue = { x: W * 0.92 - w, y, w, h, cx: W * 0.92 - w / 2, cy: y + h * 0.5 };
    return { red, blue };
  }

  private hpRatio(side: Team) {
    const t = this.gameState?.[side];
    if (!t) return 1;
    return Math.max(0, Math.min(1, t.hp / t.maxHp));
  }

  // ---------- Public effect triggers ----------
  strike(opts: { team: Team; target: Team; damage: number; crit: boolean; mult: number; img: HTMLImageElement | null }) {
    const g = this.towerGeom();
    const from = opts.team === "red" ? g.red : g.blue;
    const to = opts.target === "red" ? g.red : g.blue;
    const n = Math.min(14, 2 + Math.floor(Math.log2(1 + opts.damage / 40)));
    for (let i = 0; i < n; i++) {
      this.bullets.push({
        team: opts.team,
        sx: from.cx + (Math.random() - 0.5) * from.w * 0.6,
        sy: from.y + from.h * (0.15 + Math.random() * 0.4),
        tx: to.cx + (Math.random() - 0.5) * to.w * 0.6,
        ty: to.y + to.h * (0.2 + Math.random() * 0.6),
        t: -i * 0.07,
        spd: 0.03 + Math.random() * 0.012,
        emoji: EMOJI_BULLETS[Math.floor(Math.random() * EMOJI_BULLETS.length)],
        power: Math.min(3, 1 + opts.damage / 800),
        crit: opts.crit,
      });
    }
    // Soldier charging from attacker team.
    this.soldiers.push({
      team: opts.team,
      label: "",
      x: opts.team === "red" ? from.x + from.w : from.x,
      y: from.y + from.h - 8 + (Math.random() - 0.5) * 10,
      vx: opts.team === "red" ? 2.4 : -2.4,
      life: 1,
      img: opts.img,
    });
    this.impact[opts.target] = Math.min(TOWER_IMPACT_THRESHOLD, this.impact[opts.target] + opts.damage / 40);
    if (this.impact[opts.target] >= TOWER_IMPACT_THRESHOLD) {
      this.impact[opts.target] = 0;
      this.bursts.push({ side: opts.target, t: 0 });
    }
    const label = (opts.mult > 1 ? `x${opts.mult} ` : "") + "-" + formatDamage(opts.damage);
    this.floats.push({
      x: to.cx,
      y: to.y - 10,
      vy: -0.9,
      life: 1,
      text: opts.crit ? "CRIT " + label : label,
      crit: opts.crit,
      color: opts.target === "red" ? "#ff8fb8" : "#8ff5ff",
    });
    this.bump(opts.target, Math.min(1, opts.damage / 1500) + (opts.crit ? 0.5 : 0));
  }

  spawnSoldier(team: Team, name: string, img: HTMLImageElement | null, bot?: boolean) {
    const g = this.towerGeom();
    const t = team === "red" ? g.red : g.blue;
    this.soldiers.push({
      team,
      label: name,
      x: team === "red" ? t.x - 10 : t.x + t.w + 10,
      y: t.y + t.h - 6 + (Math.random() - 0.5) * 16,
      vx: team === "red" ? 1.8 + Math.random() : -1.8 - Math.random(),
      life: 1,
      img,
      bot,
    });
  }

  likeBurst(count: number) {
    const n = Math.min(12, Math.max(1, Math.round(count / 6)));
    for (let i = 0; i < n; i++) {
      this.likePops.push({
        x: this.W * (0.2 + Math.random() * 0.6),
        y: this.H - this.hudBottom - 20 - Math.random() * 60,
        vy: -1 - Math.random() * 1.4,
        life: 1,
        text: ["❤️", "💖", "👍", "💗"][Math.floor(Math.random() * 4)],
        size: 14 + Math.random() * 14,
      });
    }
  }

  join(name: string, img: HTMLImageElement | null, team: Team, vip: boolean) {
    const used = new Set(this.joins.map((j) => j.slot));
    let slot = 0;
    while (used.has(slot) && slot < 3) slot++;
    if (slot >= 3) this.joins.shift();
    this.joins.push({ name, img, team, t: 0, vip, slot: slot % 3 });
    const g = this.towerGeom();
    const tw = team === "red" ? g.red : g.blue;
    for (let i = 0; i < 10; i++) {
      this.particles.push({
        x: tw.cx,
        y: tw.cy,
        vx: (Math.random() - 0.5) * 3,
        vy: -1 - Math.random() * 2,
        life: 1,
        r: 2 + Math.random() * 2,
        hue: team === "red" ? 335 : 185,
      });
    }
  }

  celebrate(count: number, hueBase?: number) {
    for (let j = 0; j < count; j++) {
      this.confetti.push({
        x: Math.random() * this.W,
        y: -10 - Math.random() * 120,
        vy: 3 + Math.random() * 5,
        vx: (Math.random() - 0.5) * 3,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.18,
        w: 6 + Math.random() * 9,
        h: 4 + Math.random() * 5,
        hue: hueBase == null ? Math.random() * 360 : hueBase + Math.random() * 40,
      });
    }
  }

  resetMatchVisuals() {
    this.impact = { red: 0, blue: 0 };
    this.smokes.length = 0;
    this.bursts.length = 0;
  }

  private bump(target: Team, strength: number) {
    const g = this.towerGeom();
    const t = target === "red" ? g.red : g.blue;
    this.camZoom = 1 + 0.03 * strength;
    this.camPanX = (this.W * 0.5 - t.cx) * 0.06 * strength;
    this.camPanY = (Math.random() - 0.5) * 6 * strength;
  }

  private explode(x: number, y: number, power: number, crit: boolean) {
    const n = Math.floor(10 + power * 12);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 1 + Math.random() * 3 * power;
      this.particles.push({
        x, y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 1,
        life: 1,
        r: 1.5 + Math.random() * 2.5,
        hue: crit ? 50 + Math.random() * 20 : 300 + Math.random() * 80,
      });
    }
  }

  // ---------- Drawing ----------
  private drawBackground(ctx: CanvasRenderingContext2D) {
    const { W, H } = this;
    const t = performance.now() * 0.001;
    const grd = ctx.createLinearGradient(0, 0, W, H);
    if (this.suddenDeath) {
      grd.addColorStop(0, "rgba(120,20,40,0.55)");
      grd.addColorStop(0.45, "rgba(80,10,25,0.45)");
      grd.addColorStop(1, "rgba(40,5,15,0.5)");
    } else {
      grd.addColorStop(0, "rgba(255,120,190,0.22)");
      grd.addColorStop(0.45, "rgba(140,90,255,0.16)");
      grd.addColorStop(1, "rgba(60,220,210,0.22)");
    }
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, W, H);

    if (Date.now() < this.powerUntil && !this.suddenDeath) {
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      const pulse = 0.3 + Math.sin(t * 4) * 0.12;
      const rg = ctx.createRadialGradient(W * 0.5, H * 0.3, 0, W * 0.5, H * 0.4, H * 0.6);
      rg.addColorStop(0, `rgba(255, 240, 120, ${pulse})`);
      rg.addColorStop(1, "rgba(255, 200, 80, 0)");
      ctx.fillStyle = rg;
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = "rgba(255,255,220,0.35)";
      ctx.lineWidth = 2;
      for (let i = 0; i < 5; i++) {
        const x0 = ((t * 80 + i * 97) % (W + 80)) - 40;
        ctx.beginPath();
        ctx.moveTo(x0, 0);
        ctx.lineTo(x0 + (i % 2 === 0 ? 30 : -25), H * (0.35 + (i % 3) * 0.08));
        ctx.stroke();
      }
      ctx.restore();
    }

    // Stars
    ctx.save();
    ctx.globalAlpha = this.suddenDeath ? 0.12 : 0.18;
    ctx.fillStyle = this.suddenDeath ? "#ffaaaa" : "#fff";
    for (let i = 0; i < 50; i++) {
      ctx.beginPath();
      ctx.arc((i * 73) % W, (i * 41 + performance.now() * 0.02) % H, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // Ground
    const g = this.towerGeom();
    const groundY = g.red.y + g.red.h;
    const gg = ctx.createLinearGradient(0, groundY, 0, H);
    gg.addColorStop(0, "rgba(20,10,40,0.0)");
    gg.addColorStop(0.03, "rgba(20,10,40,0.55)");
    gg.addColorStop(1, "rgba(8,4,20,0.9)");
    ctx.fillStyle = gg;
    ctx.fillRect(0, groundY, W, H - groundY);
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 8]);
    ctx.beginPath();
    ctx.moveTo(g.red.cx, groundY + 3);
    ctx.lineTo(g.blue.cx, groundY + 3);
    ctx.stroke();
    ctx.restore();
    // Center VS badge
    ctx.save();
    ctx.font = "900 22px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.fillText("VS", W / 2, g.red.cy);
    ctx.restore();
  }

  private drawTower(ctx: CanvasRenderingContext2D, side: Team) {
    const g = this.towerGeom();
    const t = side === "red" ? g.red : g.blue;
    const ratio = this.hpRatio(side);
    const dmg = 1 - ratio;
    const col1 = side === "red" ? "#c9184a" : "#008b8b";
    const col2 = side === "red" ? "#ff5c9a" : "#2ee6dc";
    const colDark = side === "red" ? "#7a0d30" : "#005a5a";
    const colLight = side === "red" ? "#ffb3d1" : "#b8fffa";

    ctx.save();
    if (side === "blue") {
      ctx.translate(t.cx, 0);
      ctx.scale(-1, 1);
      ctx.translate(-t.cx, 0);
    }
    const { x, y, w, h } = t;
    const skew = w * 0.08;
    const shakeX = ratio < 0.2 ? Math.sin(performance.now() * 0.05) * 1.2 : 0;
    ctx.translate(shakeX, 0);

    const bodyGrad = ctx.createLinearGradient(x, y, x + w, y + h);
    bodyGrad.addColorStop(0, col1);
    bodyGrad.addColorStop(0.55, col2);
    bodyGrad.addColorStop(1, colDark);
    ctx.shadowColor = side === "red" ? "rgba(255,60,130,0.55)" : "rgba(0,220,200,0.55)";
    ctx.shadowBlur = 16;
    ctx.beginPath();
    ctx.moveTo(x + skew, y + h * 0.22);
    ctx.lineTo(x + w - skew, y + h * 0.18);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
    ctx.closePath();
    ctx.fillStyle = bodyGrad;
    ctx.fill();

    const upperH = h * 0.42;
    ctx.beginPath();
    ctx.moveTo(x + skew * 0.5, y + h * 0.22);
    ctx.lineTo(x + w - skew * 0.5, y + h * 0.18);
    ctx.lineTo(x + w - skew * 0.3, y + h * 0.22 - upperH);
    ctx.lineTo(x + skew * 0.3, y + h * 0.22 - upperH);
    ctx.closePath();
    const upGrad = ctx.createLinearGradient(x, y, x + w, y + upperH);
    upGrad.addColorStop(0, colLight);
    upGrad.addColorStop(1, col2);
    ctx.fillStyle = upGrad;
    ctx.fill();

    const merlonW = w / 7;
    const merlonsLeft = Math.max(2, Math.round(6 * (0.4 + ratio * 0.6)));
    for (let m = 0; m < merlonsLeft; m++) {
      const mx = x + skew * 0.5 + m * merlonW * 1.02;
      const myTop = y + h * 0.22 - upperH;
      ctx.fillStyle = colLight;
      ctx.fillRect(mx, myTop - h * 0.08, merlonW * 0.65, h * 0.08);
    }
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "rgba(255,255,255,0.75)";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Windows
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.fillRect(x + w * 0.35, y + h * 0.45, w * 0.12, h * 0.18);
    ctx.fillRect(x + w * 0.52, y + h * 0.45, w * 0.12, h * 0.18);
    // Flag
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    ctx.fillRect(x + w * 0.5 - 1, y - upperH * 0.55 + h * 0.22 - h * 0.08 - 18, 2, 18);
    ctx.fillStyle = col2;
    ctx.beginPath();
    const fx = x + w * 0.5 + 1;
    const fy = y - upperH * 0.55 + h * 0.22 - h * 0.08 - 18;
    const wave = Math.sin(performance.now() * 0.006) * 2;
    ctx.moveTo(fx, fy);
    ctx.lineTo(fx + 14 + wave, fy + 4);
    ctx.lineTo(fx, fy + 9);
    ctx.closePath();
    ctx.fill();

    // Cracks grow with damage
    const crackN = Math.min(12, Math.floor(dmg * 14));
    ctx.strokeStyle = "rgba(0,0,0,0.45)";
    ctx.lineWidth = 1.4;
    for (let c = 0; c < crackN; c++) {
      const seed = (side === "red" ? 2.1 : 1.7) + c * 1.3;
      const px = x + w * (0.2 + (Math.sin(seed) * 0.5 + 0.5) * 0.65);
      const py = y + h * (0.25 + ((c * 17) % 70) * 0.008);
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(px + (c % 2 === 0 ? 8 : -10), py + h * (0.12 + (c % 5) * 0.04));
      ctx.lineTo(px + (c % 3 === 0 ? -6 : 12), py + h * (0.28 + (c % 4) * 0.05));
      ctx.stroke();
    }
    if (ratio < 0.35) {
      ctx.strokeStyle = "rgba(60,10,20,0.5)";
      ctx.lineWidth = 2;
      for (let c = 0; c < 4; c++) {
        ctx.beginPath();
        ctx.moveTo(x + 10 + c * 12, y + h * 0.5);
        ctx.lineTo(x + 18 + c * 12, y + h * 0.92);
        ctx.stroke();
      }
    }
    if (ratio <= 0) {
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(x - 4, y - upperH, w + 8, h + upperH);
    }

    // Impact meter above the tower
    const m = Math.max(0, Math.min(1, this.impact[side] / TOWER_IMPACT_THRESHOLD));
    const bx = x + w * 0.12;
    const by = y - upperH - h * 0.08 - 32;
    const bw = w * 0.76;
    const bh = 5;
    ctx.fillStyle = "rgba(8,8,16,0.55)";
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = side === "red" ? "rgba(255,120,180,0.95)" : "rgba(120,245,255,0.95)";
    ctx.fillRect(bx + 1, by + 1, Math.max(0, (bw - 2) * m), bh - 2);
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 1;
    ctx.strokeRect(bx, by, bw, bh);
    ctx.restore();

    // HP label under tower
    ctx.save();
    ctx.font = "800 11px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.shadowColor = "rgba(0,0,0,0.8)";
    ctx.shadowBlur = 4;
    ctx.fillText(`${Math.ceil((this.gameState?.[side].hp ?? 0))} HP`, t.cx, t.y + t.h + 16);
    ctx.restore();
  }

  private drawBursts(ctx: CanvasRenderingContext2D) {
    const g = this.towerGeom();
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.t += 0.03;
      if (b.t >= 1) {
        this.bursts.splice(i, 1);
        continue;
      }
      const t = b.side === "red" ? g.red : g.blue;
      ctx.save();
      ctx.globalAlpha = 1 - b.t;
      ctx.strokeStyle = b.side === "red" ? "#ff7fb0" : "#7ff0ff";
      ctx.lineWidth = 4 * (1 - b.t) + 1;
      ctx.beginPath();
      ctx.arc(t.cx, t.cy, 20 + b.t * t.w * 1.4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawBullets(ctx: CanvasRenderingContext2D) {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.t += b.spd;
      if (b.t < 0) continue;
      if (b.t >= 1) {
        this.explode(b.tx, b.ty, b.power, b.crit);
        this.bullets.splice(i, 1);
        continue;
      }
      const arc = Math.sin(b.t * Math.PI) * 60 * b.power;
      const x = b.sx + (b.tx - b.sx) * b.t;
      const y = b.sy + (b.ty - b.sy) * b.t - arc;
      ctx.save();
      ctx.font = `${14 + b.power * 6}px system-ui, sans-serif`;
      ctx.shadowColor = b.team === "red" ? "rgba(255,80,150,0.9)" : "rgba(60,230,255,0.9)";
      ctx.shadowBlur = 10;
      ctx.fillText(b.emoji, x, y);
      ctx.restore();
    }
  }

  private drawParticles(ctx: CanvasRenderingContext2D) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.08;
      p.life -= 0.025;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      ctx.globalAlpha = p.life;
      ctx.fillStyle = `hsl(${p.hue} 100% 70%)`;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * p.life, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private drawFloats(ctx: CanvasRenderingContext2D) {
    for (let i = this.floats.length - 1; i >= 0; i--) {
      const f = this.floats[i];
      f.y += f.vy;
      f.life -= 0.012;
      if (f.life <= 0) {
        this.floats.splice(i, 1);
        continue;
      }
      ctx.save();
      ctx.globalAlpha = Math.min(1, f.life * 1.5);
      ctx.font = `900 ${f.crit ? 22 : 16}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillStyle = f.crit ? "#ffe066" : f.color;
      ctx.shadowColor = "rgba(0,0,0,0.9)";
      ctx.shadowBlur = 6;
      ctx.fillText(f.text, f.x, f.y);
      ctx.restore();
    }
  }

  private drawLikePops(ctx: CanvasRenderingContext2D) {
    for (let i = this.likePops.length - 1; i >= 0; i--) {
      const p = this.likePops[i];
      p.y += p.vy;
      p.x += Math.sin(p.y * 0.05) * 0.6;
      p.life -= 0.012;
      if (p.life <= 0) {
        this.likePops.splice(i, 1);
        continue;
      }
      ctx.save();
      ctx.globalAlpha = p.life;
      ctx.font = `${p.size}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(p.text, p.x, p.y);
      ctx.restore();
    }
  }

  private drawSmokes(ctx: CanvasRenderingContext2D) {
    const g = this.towerGeom();
    for (const side of ["red", "blue"] as Team[]) {
      if (this.hpRatio(side) < 0.35 && Math.random() < 0.06) {
        const t = side === "red" ? g.red : g.blue;
        this.smokes.push({
          x: t.cx + (Math.random() - 0.5) * t.w,
          y: t.y + t.h * 0.3,
          vx: (Math.random() - 0.5) * 0.6,
          vy: -0.8 - Math.random(),
          r: 8 + Math.random() * 16,
          a: 0.35,
        });
      }
    }
    for (let i = this.smokes.length - 1; i >= 0; i--) {
      const s = this.smokes[i];
      s.x += s.vx;
      s.y += s.vy;
      s.r += 0.25;
      s.a -= 0.004;
      if (s.a <= 0) {
        this.smokes.splice(i, 1);
        continue;
      }
      ctx.fillStyle = `rgba(40,30,50,${s.a})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawSoldiers(ctx: CanvasRenderingContext2D) {
    const W = this.W;
    for (let i = this.soldiers.length - 1; i >= 0; i--) {
      const s = this.soldiers[i];
      s.x += s.vx;
      s.life -= 0.0025;
      if (s.x < -40 || s.x > W + 40 || s.life <= 0) {
        this.soldiers.splice(i, 1);
        continue;
      }
      const r = 15;
      const bob = Math.sin(performance.now() * 0.02 + i) * 2;
      const y = s.y + bob;
      ctx.save();
      ctx.globalAlpha = Math.min(1, s.life);
      ctx.beginPath();
      ctx.arc(s.x, y, r, 0, Math.PI * 2);
      ctx.clip();
      if (s.img) ctx.drawImage(s.img, s.x - r, y - r, r * 2, r * 2);
      else {
        ctx.fillStyle = s.team === "red" ? "rgba(255,100,150,0.95)" : "rgba(100,220,255,0.95)";
        ctx.fill();
        ctx.font = "16px system-ui";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(s.bot ? "🤖" : "🧑‍🚀", s.x, y + 1);
      }
      ctx.restore();
      ctx.save();
      ctx.globalAlpha = Math.min(1, s.life);
      ctx.strokeStyle = s.team === "red" ? "#ff5c9a" : "#2ee6dc";
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(s.x, y, r, 0, Math.PI * 2);
      ctx.stroke();
      if (s.label) {
        ctx.font = "bold 10px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillStyle = "#fff";
        ctx.shadowColor = "rgba(0,0,0,0.85)";
        ctx.shadowBlur = 5;
        ctx.fillText(truncate(s.label, 14), s.x, y - r - 4);
      }
      ctx.restore();
    }
  }

  private drawConfetti(ctx: CanvasRenderingContext2D) {
    for (let i = this.confetti.length - 1; i >= 0; i--) {
      const c = this.confetti[i];
      c.x += c.vx;
      c.y += c.vy;
      c.rot += c.vr;
      if (c.y > this.H + 20) {
        this.confetti.splice(i, 1);
        continue;
      }
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.rot);
      ctx.fillStyle = `hsl(${c.hue} 95% 65%)`;
      ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
      ctx.restore();
    }
  }

  private drawJoins(ctx: CanvasRenderingContext2D) {
    const g = this.towerGeom();
    const baseY = g.red.y + g.red.h + 34;
    for (let i = this.joins.length - 1; i >= 0; i--) {
      const j = this.joins[i];
      j.t += 0.012;
      if (j.t >= 1) {
        this.joins.splice(i, 1);
        continue;
      }
      const ease = j.t < 0.15 ? j.t / 0.15 : j.t > 0.85 ? (1 - j.t) / 0.15 : 1;
      const label = (j.vip ? "⭐ " : "") + truncate(j.name, 16) + " joined";
      ctx.save();
      ctx.font = "bold 11px system-ui, sans-serif";
      const tw = ctx.measureText(label).width;
      const bw = tw + 44;
      const bh = 26;
      const x = this.W / 2 - bw / 2 + (1 - ease) * (j.team === "red" ? -40 : 40);
      const y = baseY + j.slot * 30;
      ctx.globalAlpha = ease;
      ctx.fillStyle = j.team === "red" ? "rgba(201,24,74,0.85)" : "rgba(0,139,139,0.85)";
      roundRect(ctx, x, y, bw, bh, 13);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.save();
      ctx.beginPath();
      ctx.arc(x + 13, y + 13, 10, 0, Math.PI * 2);
      ctx.clip();
      if (j.img) ctx.drawImage(j.img, x + 3, y + 3, 20, 20);
      else {
        ctx.fillStyle = "rgba(255,255,255,0.3)";
        ctx.fill();
      }
      ctx.restore();
      ctx.fillStyle = "#fff";
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      ctx.fillText(label, x + 30, y + 13);
      ctx.restore();
    }
  }

  private tick() {
    const ctx = this.ctx;
    if (!ctx) return;
    const { W, H } = this;
    this.camZoom += (1 - this.camZoom) * 0.06;
    this.camPanX *= 0.9;
    this.camPanY *= 0.9;

    ctx.clearRect(0, 0, W, H);
    ctx.save();
    ctx.translate(W / 2 + this.camPanX, H / 2 + this.camPanY);
    ctx.scale(this.camZoom, this.camZoom);
    ctx.translate(-W / 2, -H / 2);

    this.drawBackground(ctx);
    this.drawTower(ctx, "red");
    this.drawTower(ctx, "blue");
    this.drawBursts(ctx);
    this.drawSmokes(ctx);
    this.drawSoldiers(ctx);
    this.drawBullets(ctx);
    this.drawParticles(ctx);
    this.drawFloats(ctx);
    this.drawLikePops(ctx);
    this.drawJoins(ctx);
    this.drawConfetti(ctx);
    ctx.restore();
  }
}

export function formatDamage(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 10_000) return (n / 1000).toFixed(1) + "K";
  return String(Math.floor(n));
}

export function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
