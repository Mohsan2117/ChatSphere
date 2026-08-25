"use client";

import { useEffect, useRef } from "react";

function createNoise2D(seed = 0.5) {
  const F2 = 0.5 * (Math.sqrt(3) - 1);
  const G2 = (3 - Math.sqrt(3)) / 6;
  const G22 = (3 - Math.sqrt(3)) / 3;
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;

  const seededRandom = (index: number) => {
    const x = Math.sin(index * 12.9898 + seed * 78.233) * 43758.5453;
    return x - Math.floor(x);
  };
  for (let i = 255; i > 0; i--) {
    const n = Math.floor((i + 1) * seededRandom(i));
    const q = p[i];
    p[i] = p[n];
    p[n] = q;
  }

  const perm = new Uint8Array(512);
  const permMod12 = new Uint8Array(512);
  for (let i = 0; i < 512; i++) {
    perm[i] = p[i & 255];
    permMod12[i] = perm[i] % 12;
  }
  const grad2 = new Float64Array([
    1, 1, -1, 1, 1, -1, -1, -1, 1, 0, -1, 0, 1, 0, -1, 0, 0, 1, 0, -1, 0, 1,
    0, -1,
  ]);
  const fastFloor = (x: number) => Math.floor(x) | 0;

  return function noise2D(x: number, y: number) {
    const s = (x + y) * F2;
    const i = fastFloor(x + s);
    const j = fastFloor(y + s);
    const t = (i + j) * G2;
    const x0 = x - (i - t);
    const y0 = y - (j - t);
    let i1: number, j1: number;
    if (x0 > y0) {
      i1 = 1;
      j1 = 0;
    } else {
      i1 = 0;
      j1 = 1;
    }
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + G22;
    const y2 = y0 - 1 + G22;
    const ii = i & 255;
    const jj = j & 255;
    const gi0 = permMod12[ii + perm[jj]];
    const gi1 = permMod12[ii + i1 + perm[jj + j1]];
    const gi2 = permMod12[ii + 1 + perm[jj + 1]];
    let n0 = 0,
      n1 = 0,
      n2 = 0;
    let t0 = 0.5 - x0 * x0 - y0 * y0;
    if (t0 >= 0) {
      t0 *= t0;
      n0 = t0 * t0 * (grad2[gi0 * 2] * x0 + grad2[gi0 * 2 + 1] * y0);
    }
    let t1 = 0.5 - x1 * x1 - y1 * y1;
    if (t1 >= 0) {
      t1 *= t1;
      n1 = t1 * t1 * (grad2[gi1 * 2] * x1 + grad2[gi1 * 2 + 1] * y1);
    }
    let t2 = 0.5 - x2 * x2 - y2 * y2;
    if (t2 >= 0) {
      t2 *= t2;
      n2 = t2 * t2 * (grad2[gi2 * 2] * x2 + grad2[gi2 * 2 + 1] * y2);
    }
    return 70 * (n0 + n1 + n2);
  };
}

// Color Palette Specification:
const COLOR_CYAN = "#18E0FF";
const COLOR_BLUE = "#4F7CFF";
const COLOR_PINK = "#FF5FA2";
const COLOR_PURPLE = "#9B7BFF";

type ParticleShape = "bubble" | "check" | "heart" | "at" | "dot";

interface Particle {
  x: number;
  y: number;
  baseX: number;
  baseY: number;
  angle: number;
  cursor: { x: number; y: number; vx: number; vy: number };
  shape: ParticleShape;
  size: number;
  baseAlpha: number;
  rotationOffset: number;
  layer: 1 | 2 | 3; // 1: far, 2: mid, 3: foreground
  color: string;
  hasLines?: boolean;
}

interface OrbitRing {
  radius: number;
  speed: number;
  dotAngle: number;
  hasDot: boolean;
  dotSize: number;
  dotColor: string;
}

interface OrbitCluster {
  xRatio: number;
  yRatio: number;
  centerShape: "bubble" | "heart" | "check";
  centerSize: number;
  centerColor: string;
  rings: OrbitRing[];
  pulseOffset: number;
}

interface StarDust {
  xRatio: number;
  yRatio: number;
  size: number;
  color: string;
  alpha: number;
  speed: number;
  phase: number;
}

interface InteractiveBackgroundProps {
  strokeColor?: string;
  accentColor?: string;
  pinkColor?: string;
  backgroundColor?: string;
  count?: number;
  movement?: number;
  hover?: boolean;
  force?: number;
  resolution?: number;
  className?: string;
}

const BASE_ANGLE = 0;
const CURL = 3;
const SEED = 0.5;

export default function InteractiveBackground({
  strokeColor,
  accentColor,
  pinkColor,
  backgroundColor = "transparent",
  count,
  movement = 14,
  hover = true,
  force = 3.5,
  resolution,
  className = "",
}: InteractiveBackgroundProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mouseRef = useRef({
    x: -500,
    y: -500,
    lx: -500,
    ly: -500,
    sx: -500,
    sy: -500,
    v: 0,
    vs: 0,
    a: 0,
    set: false,
  });
  const particlesRef = useRef<Particle[]>([]);
  const clustersRef = useRef<OrbitCluster[]>([]);
  const stardustRef = useRef<StarDust[]>([]);
  const noiseRef = useRef<((x: number, y: number) => number) | null>(null);
  const rafRef = useRef<number | null>(null);
  const boundingRef = useRef<{ width: number; height: number; dpr: number } | null>(null);
  const isVisibleRef = useRef(true);

  const setSize = () => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const width = container.clientWidth || container.offsetWidth || window.innerWidth || 1;
    const height = container.clientHeight || container.offsetHeight || window.innerHeight || 1;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    boundingRef.current = { width, height, dpr };
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  };

  // Generate only 4 to 6 large, atmospheric orbit clusters across the screen
  const initOrbitClusters = (width: number, isMobile: boolean) => {
    if (isMobile) {
      clustersRef.current = [
        {
          xRatio: 0.5,
          yRatio: 0.38,
          centerShape: "bubble",
          centerSize: 28,
          centerColor: COLOR_CYAN,
          pulseOffset: 0,
          rings: [
            { radius: 65, speed: 0.0006, dotAngle: 0.8, hasDot: true, dotSize: 2.2, dotColor: COLOR_CYAN },
            { radius: 125, speed: -0.0004, dotAngle: 2.5, hasDot: true, dotSize: 2.5, dotColor: COLOR_PINK },
            { radius: 190, speed: 0.0003, dotAngle: 4.2, hasDot: true, dotSize: 2.2, dotColor: COLOR_BLUE },
          ],
        },
        {
          xRatio: 0.85,
          yRatio: 0.78,
          centerShape: "heart",
          centerSize: 24,
          centerColor: COLOR_PINK,
          pulseOffset: 1.8,
          rings: [
            { radius: 55, speed: -0.0007, dotAngle: 1.4, hasDot: true, dotSize: 2, dotColor: COLOR_PINK },
            { radius: 110, speed: 0.0004, dotAngle: 3.8, hasDot: true, dotSize: 2.2, dotColor: COLOR_CYAN },
          ],
        },
      ];
      return;
    }

    // Desktop: 5 atmospheric clusters (1-2 large, 2 medium, 1-2 small)
    clustersRef.current = [
      // 1. Major central atmospheric cluster (Large: ~420px diameter)
      {
        xRatio: 0.48,
        yRatio: 0.46,
        centerShape: "bubble",
        centerSize: 34,
        centerColor: COLOR_CYAN,
        pulseOffset: 0,
        rings: [
          { radius: 58, speed: 0.0006, dotAngle: 0.6, hasDot: true, dotSize: 2.4, dotColor: COLOR_CYAN },
          { radius: 115, speed: -0.0004, dotAngle: 2.2, hasDot: true, dotSize: 2.8, dotColor: COLOR_PINK },
          { radius: 175, speed: 0.0003, dotAngle: 3.9, hasDot: true, dotSize: 2.4, dotColor: COLOR_BLUE },
          { radius: 235, speed: -0.0002, dotAngle: 5.4, hasDot: false, dotSize: 2, dotColor: COLOR_CYAN },
        ],
      },
      // 2. Upper Right Cluster (Medium/Large: ~320px diameter)
      {
        xRatio: 0.84,
        yRatio: 0.26,
        centerShape: "bubble",
        centerSize: 28,
        centerColor: COLOR_CYAN,
        pulseOffset: 1.2,
        rings: [
          { radius: 50, speed: -0.0007, dotAngle: 1.1, hasDot: true, dotSize: 2.2, dotColor: COLOR_BLUE },
          { radius: 105, speed: 0.0005, dotAngle: 3.1, hasDot: true, dotSize: 2.5, dotColor: COLOR_CYAN },
          { radius: 160, speed: -0.0003, dotAngle: 4.8, hasDot: true, dotSize: 2, dotColor: COLOR_PINK },
        ],
      },
      // 3. Left Mid Cluster (Medium: ~260px diameter)
      {
        xRatio: 0.16,
        yRatio: 0.36,
        centerShape: "heart",
        centerSize: 26,
        centerColor: COLOR_PINK,
        pulseOffset: 2.4,
        rings: [
          { radius: 45, speed: 0.0008, dotAngle: 0.9, hasDot: true, dotSize: 2.2, dotColor: COLOR_PINK },
          { radius: 92, speed: -0.0005, dotAngle: 2.8, hasDot: true, dotSize: 2.4, dotColor: COLOR_CYAN },
          { radius: 135, speed: 0.0003, dotAngle: 4.5, hasDot: false, dotSize: 2, dotColor: COLOR_BLUE },
        ],
      },
      // 4. Lower Right Cluster (Medium: ~240px diameter)
      {
        xRatio: 0.78,
        yRatio: 0.78,
        centerShape: "check",
        centerSize: 26,
        centerColor: COLOR_CYAN,
        pulseOffset: 3.6,
        rings: [
          { radius: 42, speed: -0.0007, dotAngle: 1.5, hasDot: true, dotSize: 2.2, dotColor: COLOR_CYAN },
          { radius: 88, speed: 0.0005, dotAngle: 3.6, hasDot: true, dotSize: 2.2, dotColor: COLOR_PURPLE },
          { radius: 125, speed: -0.0003, dotAngle: 5.1, hasDot: true, dotSize: 2, dotColor: COLOR_PINK },
        ],
      },
      // 5. Lower Left Cluster (Small: ~160px diameter)
      {
        xRatio: 0.28,
        yRatio: 0.82,
        centerShape: "bubble",
        centerSize: 22,
        centerColor: COLOR_BLUE,
        pulseOffset: 4.8,
        rings: [
          { radius: 38, speed: 0.0008, dotAngle: 0.4, hasDot: true, dotSize: 2, dotColor: COLOR_CYAN },
          { radius: 78, speed: -0.0005, dotAngle: 2.9, hasDot: true, dotSize: 2.2, dotColor: COLOR_CYAN },
        ],
      },
    ];
  };

  const initStardust = () => {
    const stars: StarDust[] = [];
    for (let i = 0; i < 40; i++) {
      const isPink = i % 4 === 0;
      const isBlue = i % 3 === 0;
      stars.push({
        xRatio: Math.sin(i * 91.31 + 4.17) * 0.5 + 0.5,
        yRatio: Math.cos(i * 67.89 + 1.23) * 0.5 + 0.5,
        size: 1 + (i % 3) * 0.4,
        color: isPink ? COLOR_PINK : isBlue ? COLOR_BLUE : COLOR_CYAN,
        alpha: 0.08 + (i % 4) * 0.03,
        speed: 0.001 + (i % 3) * 0.0007,
        phase: i * 0.7,
      });
    }
    stardustRef.current = stars;
  };

  // Generate naturally scattered floating particles (92-95% of total elements)
  const setParticles = () => {
    if (!boundingRef.current) return;
    const { width, height } = boundingRef.current;

    const isMobile = width < 768;
    const targetCount = isMobile ? 48 : 85; // Natural count with airy breathing room

    initOrbitClusters(width, isMobile);
    initStardust();

    const particles: Particle[] = [];

    for (let i = 0; i < targetCount; i++) {
      // Stratified spatial distribution with organic clustering & voids
      const u = Math.sin(i * 37.17 + 4.19) * 0.5 + 0.5;
      const v = Math.cos(i * 83.23 + 1.87) * 0.5 + 0.5;
      const jx = Math.sin(i * 19.33 + 7.51) * 0.08;
      const jy = Math.cos(i * 53.11 + 3.19) * 0.08;

      const xPos = Math.max(20, Math.min(width - 20, (u + jx) * width));
      const yPos = Math.max(20, Math.min(height - 20, (v + jy) * height));

      const rType = Math.sin(i * 47.31 + 2.11) * 0.5 + 0.5;
      const rSize = Math.sin(i * 61.19 + 5.43) * 0.5 + 0.5;
      const rRot = (Math.sin(i * 43.11 + 1.51) * Math.PI) / 5;

      // 3. Shape Distribution:
      // 55% Chat bubbles (Cyan)
      // 20% Double-check read icons (Cyan / Blue)
      // 15% Reaction hearts (Pink)
      // 5% @ (Blue / Purple)
      // 5% Dots / micro-circles (Cyan / Pink / Blue)
      let shape: ParticleShape = "bubble";
      let color = COLOR_CYAN;

      if (rType >= 0.55 && rType < 0.75) {
        shape = "check";
        color = i % 2 === 0 ? COLOR_CYAN : COLOR_BLUE;
      } else if (rType >= 0.75 && rType < 0.90) {
        shape = "heart";
        color = COLOR_PINK;
      } else if (rType >= 0.90 && rType < 0.95) {
        shape = "at";
        color = i % 2 === 0 ? COLOR_BLUE : COLOR_PURPLE;
      } else if (rType >= 0.95) {
        shape = "dot";
        color = i % 3 === 0 ? COLOR_PINK : i % 2 === 0 ? COLOR_BLUE : COLOR_CYAN;
      }

      // 7. 3 Size Levels & Layering:
      // Small: 8-12px (majority ~65%)
      // Medium: 14-20px (some ~25%)
      // Large: 22-30px (few ~10%)
      let size = 10;
      let layer: 1 | 2 | 3 = 1;
      let baseAlpha = 0.14 + (i % 4) * 0.03; // 0.12 - 0.23

      if (rSize >= 0.90) {
        // Large
        size = 23 + Math.floor(rSize * 6);
        layer = 3;
        baseAlpha = 0.28 + (i % 3) * 0.04; // 0.28 - 0.36
      } else if (rSize >= 0.65) {
        // Medium
        size = 15 + Math.floor(rSize * 4.5);
        layer = 2;
        baseAlpha = 0.20 + (i % 3) * 0.04; // 0.20 - 0.28
      } else {
        // Small
        size = 9 + Math.floor(rSize * 3);
        layer = 1;
      }

      particles.push({
        x: xPos,
        y: yPos,
        baseX: xPos,
        baseY: yPos,
        angle: 0,
        cursor: { x: 0, y: 0, vx: 0, vy: 0 },
        shape,
        size,
        baseAlpha,
        rotationOffset: rRot,
        layer,
        color,
        hasLines: shape === "bubble" && size >= 17,
      });
    }

    particlesRef.current = particles;
  };

  const updateMousePosition = (clientX: number, clientY: number) => {
    const container = containerRef.current;
    if (!boundingRef.current || !container) return;
    const mouse = mouseRef.current;
    const rect = container.getBoundingClientRect();
    mouse.x = clientX - rect.left;
    mouse.y = clientY - rect.top;
    if (!mouse.set) {
      mouse.sx = mouse.x;
      mouse.sy = mouse.y;
      mouse.lx = mouse.x;
      mouse.ly = mouse.y;
      mouse.set = true;
    }
  };

  const movePoints = (time: number) => {
    const particles = particlesRef.current;
    const mouse = mouseRef.current;
    const noiseFn = noiseRef.current;
    if (!noiseFn) return;

    const curl = CURL;
    const base = BASE_ANGLE;
    const drift = time * 14 * 6e-6;
    const dirX = Math.cos(base) * drift;
    const dirY = Math.sin(base) * drift;

    particles.forEach((p) => {
      const n = noiseFn(p.x * 0.003 - dirX, p.y * 0.003 - dirY);
      const target = base + n * Math.PI * curl;

      const dx = p.x - mouse.sx;
      const dy = p.y - mouse.sy;
      const d = Math.hypot(dx, dy);
      const l = Math.max(170, mouse.vs * 1.5);
      let bend = 0;

      // 8. Cursor Interaction (Gently push away, scale up, rotate, spring return)
      if (hover && d < l && mouse.set) {
        const s = 1 - d / l;
        const layerMult = p.layer === 3 ? 1.3 : p.layer === 2 ? 1.0 : 0.7;
        const influence = (force / 10) * 0.018 * layerMult;
        const tangent = Math.atan2(dy, dx) + Math.PI / 2;
        bend = (tangent - target) * s * (0.32 + mouse.vs * influence);

        const f = Math.cos(d * 0.001) * s;
        const push = (force / 10) * 5e-4 * layerMult;
        p.cursor.vx += Math.cos(Math.atan2(dy, dx)) * f * l * mouse.vs * push;
        p.cursor.vy += Math.sin(Math.atan2(dy, dx)) * f * l * mouse.vs * push;
      }

      let diff = target + bend - p.angle;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      p.angle += diff * 0.09;

      // Smooth spring return to original position
      p.cursor.vx += (0 - p.cursor.x) * 0.011;
      p.cursor.vy += (0 - p.cursor.y) * 0.011;
      p.cursor.vx *= 0.93;
      p.cursor.vy *= 0.93;
      p.cursor.x += p.cursor.vx;
      p.cursor.y += p.cursor.vy;
      p.cursor.x = Math.min(38, Math.max(-38, p.cursor.x));
      p.cursor.y = Math.min(38, Math.max(-38, p.cursor.y));
    });
  };

  const drawAll = (time: number) => {
    const canvas = canvasRef.current;
    if (!canvas || !boundingRef.current) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { width, height, dpr } = boundingRef.current;
    const particles = particlesRef.current;
    const clusters = clustersRef.current;
    const stardust = stardustRef.current;
    const mouse = mouseRef.current;

    ctx.clearRect(0, 0, width * dpr, height * dpr);
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // 1. Draw StarDust (Subtle twinkling micro-particles)
    stardust.forEach((star) => {
      const sx = star.xRatio * width;
      const sy = star.yRatio * height;
      const twinkle = Math.sin(time * star.speed + star.phase) * 0.5 + 0.5;
      const curAlpha = star.alpha * (0.6 + twinkle * 0.4);

      ctx.save();
      ctx.fillStyle = star.color;
      ctx.globalAlpha = curAlpha;
      ctx.beginPath();
      ctx.arc(sx, sy, star.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    // 2. Draw Sparse Atmospheric Orbit Clusters (Only 4-5 on desktop, 2 on mobile)
    clusters.forEach((cluster) => {
      const cx = cluster.xRatio * width;
      const cy = cluster.yRatio * height;

      // Subtle breathing pulse on the orbital rings
      const breathe = Math.sin(time * 0.0012 + cluster.pulseOffset) * 2.5;

      cluster.rings.forEach((ring) => {
        const curRadius = ring.radius + breathe;

        ctx.save();
        // Very low ring opacity (0.05 - 0.12) as requested
        ctx.strokeStyle = ring.dotColor === COLOR_PINK ? "rgba(255, 95, 162, 0.08)" : "rgba(24, 224, 255, 0.09)";
        ctx.lineWidth = 0.9;
        ctx.setLineDash([3, 8]);
        ctx.beginPath();
        ctx.arc(cx, cy, curRadius, 0, Math.PI * 2);
        ctx.stroke();

        // Orbiting satellite dot on the track
        if (ring.hasDot) {
          const curAngle = ring.dotAngle + time * ring.speed;
          const dotX = cx + Math.cos(curAngle) * curRadius;
          const dotY = cy + Math.sin(curAngle) * curRadius;

          ctx.setLineDash([]);
          ctx.fillStyle = ring.dotColor;
          ctx.globalAlpha = 0.4;
          ctx.beginPath();
          ctx.arc(dotX, dotY, ring.dotSize, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      });

      // Main communication icon in the center of the orbit cluster
      ctx.save();
      ctx.translate(cx, cy);
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = cluster.centerColor;
      ctx.lineWidth = 1.6;

      if (cluster.centerShape === "bubble") {
        drawChatBubble(ctx, cluster.centerSize, true);
      } else if (cluster.centerShape === "heart") {
        drawHeart(ctx, cluster.centerSize);
      } else if (cluster.centerShape === "check") {
        drawCheck(ctx, cluster.centerSize);
      }
      ctx.restore();
    });

    // 3. Draw Normal Scattered Floating Particles (92-95% of elements)
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const cx = p.x + p.cursor.x;
      const cy = p.y + p.cursor.y;

      const dx = cx - mouse.sx;
      const dy = cy - mouse.sy;
      const dist = Math.hypot(dx, dy);
      const rippleRadius = 175;
      const proximity = mouse.set && dist < rippleRadius ? Math.max(0, 1 - dist / rippleRadius) : 0;

      // Subtle opacity on rest (0.12-0.35), brightens up to (0.65-0.85) on cursor proximity
      const currentAlpha = Math.min(0.85, p.baseAlpha + proximity * 0.6);
      const currentScale = 1 + proximity * 0.2;
      const curSize = p.size * currentScale;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(p.angle + p.rotationOffset);
      ctx.globalAlpha = currentAlpha;
      ctx.strokeStyle = proximity > 0.1 ? (p.shape === "heart" ? COLOR_PINK : COLOR_CYAN) : p.color;
      ctx.lineWidth = curSize >= 22 ? 1.5 : curSize >= 15 ? 1.3 : 1.1;

      switch (p.shape) {
        case "bubble":
          drawChatBubble(ctx, curSize, p.hasLines);
          break;
        case "check":
          drawCheck(ctx, curSize);
          break;
        case "heart":
          drawHeart(ctx, curSize);
          break;
        case "at":
          drawAtSymbol(ctx, curSize);
          break;
        case "dot":
          ctx.beginPath();
          ctx.arc(0, 0, curSize * 0.35, 0, Math.PI * 2);
          ctx.stroke();
          break;
      }

      ctx.restore();
    }

    ctx.restore();
  };

  // Helper drawing functions for clean vector outlines
  const drawChatBubble = (ctx: CanvasRenderingContext2D, size: number, hasLines?: boolean) => {
    const bw = size;
    const bh = size * 0.72;
    const br = size * 0.24;

    ctx.beginPath();
    ctx.moveTo(-bw / 2 + br, -bh / 2);
    ctx.lineTo(bw / 2 - br, -bh / 2);
    ctx.arcTo(bw / 2, -bh / 2, bw / 2, bh / 2, br);
    ctx.arcTo(bw / 2, bh / 2, -bw / 2, bh / 2, br);
    // Tail notch on bottom-left
    ctx.lineTo(-bw / 2 + br * 1.35, bh / 2);
    ctx.lineTo(-bw / 2 - size * 0.14, bh / 2 + size * 0.2);
    ctx.lineTo(-bw / 2 + size * 0.04, bh / 2 - size * 0.06);
    ctx.arcTo(-bw / 2, -bh / 2, bw / 2, -bh / 2, br);
    ctx.closePath();
    ctx.stroke();

    if (hasLines && size >= 17) {
      ctx.beginPath();
      ctx.moveTo(-bw * 0.24, -bh * 0.08);
      ctx.lineTo(bw * 0.24, -bh * 0.08);
      ctx.moveTo(-bw * 0.24, bh * 0.2);
      ctx.lineTo(bw * 0.06, bh * 0.2);
      ctx.stroke();
    }
  };

  const drawCheck = (ctx: CanvasRenderingContext2D, size: number) => {
    const cs = size * 0.52;
    // First check
    ctx.beginPath();
    ctx.moveTo(-cs * 0.95, -cs * 0.05);
    ctx.lineTo(-cs * 0.35, cs * 0.55);
    ctx.lineTo(cs * 0.55, -cs * 0.6);
    ctx.stroke();
    // Second check
    ctx.beginPath();
    ctx.moveTo(-cs * 0.45, -cs * 0.05);
    ctx.lineTo(cs * 0.15, cs * 0.55);
    ctx.lineTo(cs * 1.05, -cs * 0.6);
    ctx.stroke();
  };

  const drawHeart = (ctx: CanvasRenderingContext2D, size: number) => {
    const hs = size * 0.46;
    ctx.beginPath();
    ctx.moveTo(0, hs * 0.7);
    ctx.bezierCurveTo(-hs * 1.15, -hs * 0.12, -hs * 1.15, -hs * 1.05, 0, -hs * 0.42);
    ctx.bezierCurveTo(hs * 1.15, -hs * 1.05, hs * 1.15, -hs * 0.12, 0, hs * 0.7);
    ctx.stroke();
  };

  const drawAtSymbol = (ctx: CanvasRenderingContext2D, size: number) => {
    const rad = size * 0.38;
    ctx.beginPath();
    ctx.arc(0, 0, rad * 0.42, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, rad, Math.PI * 0.18, Math.PI * 1.85);
    ctx.stroke();
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !canvasRef.current) return;
    noiseRef.current = createNoise2D(SEED);
    setSize();
    setParticles();

    const onResize = () => {
      setSize();
      setParticles();
    };

    const onMouseMove = (e: MouseEvent) => {
      updateMousePosition(e.clientX, e.clientY);
    };

    const onTouchMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (touch) updateMousePosition(touch.clientX, touch.clientY);
    };

    window.addEventListener("resize", onResize);
    window.addEventListener("mousemove", onMouseMove, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          isVisibleRef.current = entry.isIntersecting;
        });
      },
      { threshold: 0.05 }
    );
    observer.observe(container);

    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("touchmove", onTouchMove);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    let lastTime = 0;
    const tick = (time: number) => {
      if (!isVisibleRef.current) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      // Smooth mouse momentum
      const mouse = mouseRef.current;
      mouse.sx += (mouse.x - mouse.sx) * 0.12;
      mouse.sy += (mouse.y - mouse.sy) * 0.12;
      const dx = mouse.x - mouse.lx;
      const dy = mouse.y - mouse.ly;
      const d = Math.hypot(dx, dy);
      mouse.v = d;
      mouse.vs += (d - mouse.vs) * 0.12;
      mouse.vs = Math.min(100, mouse.vs);
      mouse.lx = mouse.x;
      mouse.ly = mouse.y;
      mouse.a = Math.atan2(dy, dx);

      // Render frame
      if (time - lastTime >= 12) {
        movePoints(time);
        drawAll(time);
        lastTime = time;
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
      style={{
        backgroundColor: backgroundColor || "transparent",
      }}
      aria-hidden="true"
    >
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute inset-0 block h-full w-full"
      />
    </div>
  );
}
