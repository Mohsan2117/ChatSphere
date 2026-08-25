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

type ParticleShape = "bubble" | "check" | "heart" | "at";

interface ParticleOrbitRing {
  radius: number;
  speed: number;
  dotAngle: number;
  dotSize: number;
  dotColor: string;
}

interface Point {
  x: number;
  y: number;
  angle: number;
  cursor: { x: number; y: number; vx: number; vy: number };
  shape: ParticleShape;
  size: number;
  baseAlpha: number;
  rotationOffset: number;
  hasLines?: boolean;
  hasOrbitRings?: boolean;
  orbitRings?: ParticleOrbitRing[];
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

// Exact color palette matching the Reactions (03) + Orbit (05) design:
const COLOR_TEAL = "#00d6b4";
const COLOR_PINK = "#ff4db8";
const COLOR_ICE = "#7fe8db";

export default function InteractiveBackground({
  strokeColor = COLOR_TEAL,
  accentColor = COLOR_TEAL,
  pinkColor = COLOR_PINK,
  backgroundColor = "transparent",
  count = 34,
  movement = 14,
  hover = true,
  force = 3.5,
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
  const pointsRef = useRef<Point[]>([]);
  const stardustRef = useRef<StarDust[]>([]);
  const noiseRef = useRef<((x: number, y: number) => number) | null>(null);
  const rafRef = useRef<number | null>(null);
  const boundingRef = useRef<{ width: number; height: number; dpr: number } | null>(null);
  const isVisibleRef = useRef(true);

  const cfgRef = useRef({
    strokeColor,
    accentColor,
    pinkColor,
    count,
    movement,
    hover,
    force,
  });
  cfgRef.current = {
    strokeColor,
    accentColor,
    pinkColor,
    count,
    movement,
    hover,
    force,
  };

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

  const initStardust = () => {
    // Sparkling stardust
    const stars: StarDust[] = [];
    for (let i = 0; i < 42; i++) {
      const isPink = i % 4 === 0;
      stars.push({
        xRatio: Math.sin(i * 91.31 + 4.17) * 0.5 + 0.5,
        yRatio: Math.cos(i * 67.89 + 1.23) * 0.5 + 0.5,
        size: 1 + (i % 3) * 0.45,
        color: isPink ? COLOR_PINK : COLOR_TEAL,
        alpha: 0.1 + (i % 4) * 0.04,
        speed: 0.001 + (i % 3) * 0.0007,
        phase: i * 0.7,
      });
    }
    stardustRef.current = stars;
  };

  const setParticles = () => {
    if (!boundingRef.current) return;
    const { width, height } = boundingRef.current;
    const { count } = cfgRef.current;

    const isMobile = width < 768;
    const adjustedCount = isMobile ? Math.min(count, 22) : count;

    const c = Math.max(1, Math.min(100, adjustedCount));
    const gap = 145 - ((c - 1) / 99) * 75;
    const cols = Math.ceil((width + gap) / gap);
    const rows = Math.ceil((height + gap) / gap);
    const xStart = (width - gap * (cols - 1)) / 2;
    const yStart = (height - gap * (rows - 1)) / 2;

    const points: Point[] = [];
    let idx = 0;

    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        idx++;
        const rType = Math.sin(idx * 37.17 + i * 13.23 + j * 97.41) * 0.5 + 0.5;
        const rSizeTier = Math.sin(idx * 59.81 + i * 29.11) * 0.5 + 0.5;
        const rJitterX = Math.sin(idx * 19.33 + j * 43.17);
        const rJitterY = Math.cos(idx * 83.19 + i * 31.73);
        const rRot = (Math.sin(idx * 43.11 + j * 17.51) * Math.PI) / 6;
        const rAlpha = Math.sin(idx * 73.29 + 1.61) * 0.5 + 0.5;

        // 1. PARTICLE SHAPES (MUST USE from specification):
        // 60% Chat Bubble Outlines (Teal)
        // 20% Message Ticks (Teal)
        // 10% Reaction Hearts (Pink/Magenta)
        // 10% Dots & @ Symbols (Ice/Teal)
        let shape: ParticleShape = "bubble";
        if (rType >= 0.60 && rType < 0.80) {
          shape = "check";
        } else if (rType >= 0.80 && rType < 0.90) {
          shape = "heart";
        } else if (rType >= 0.90) {
          shape = "at";
        }

        // 3. SIZES (from specification):
        // Small: 10-14px (majority)
        // Medium: 16-20px
        // Large: 22-28px (few)
        let size = 12;
        let hasLines = false;
        if (rSizeTier >= 0.88) {
          // Large (few)
          size = 23 + Math.floor(rSizeTier * 4.5);
          hasLines = shape === "bubble";
        } else if (rSizeTier >= 0.62) {
          // Medium
          size = 16 + Math.floor(rSizeTier * 3.5);
          hasLines = shape === "bubble" && rType < 0.35;
        } else {
          // Small (majority)
          size = 11 + Math.floor(rSizeTier * 2.5);
        }

        // 7. ORBIT + REACTIONS MIX:
        // Some particles (mainly chat bubbles and @) have orbit rings (like Orbit Ripple 05)
        // Hearts and ticks float freely like Reactions Ripple 03
        const hasOrbitRings =
          (shape === "bubble" && size >= 17 && idx % 3 === 0) ||
          (shape === "at" && idx % 2 === 0);

        let orbitRings: ParticleOrbitRing[] | undefined;
        if (hasOrbitRings) {
          orbitRings = [
            {
              radius: size * 1.5,
              speed: 0.0007 * (idx % 2 === 0 ? 1 : -1),
              dotAngle: idx * 1.2,
              dotSize: 1.8,
              dotColor: COLOR_TEAL,
            },
            {
              radius: size * 2.5,
              speed: -0.0005 * (idx % 2 === 0 ? 1 : -1),
              dotAngle: idx * 2.4,
              dotSize: 2.2,
              dotColor: idx % 4 === 0 ? COLOR_PINK : COLOR_TEAL,
            },
            {
              radius: size * 3.6,
              speed: 0.0003 * (idx % 2 === 0 ? 1 : -1),
              dotAngle: idx * 3.8,
              dotSize: 1.8,
              dotColor: COLOR_ICE,
            },
          ];
        }

        // 2. DISTRIBUTION: Natural scattering across entire screen (no strict rows or grid)
        const jitterAmount = gap * 0.32;
        const xPos = xStart + gap * i + rJitterX * jitterAmount;
        const yPos = yStart + gap * j + rJitterY * jitterAmount;

        // 4. Default state: low opacity (10%-25%)
        const baseAlpha = 0.11 + rAlpha * 0.13;

        points.push({
          x: xPos,
          y: yPos,
          angle: 0,
          cursor: { x: 0, y: 0, vx: 0, vy: 0 },
          shape,
          size,
          baseAlpha,
          rotationOffset: rRot,
          hasLines,
          hasOrbitRings,
          orbitRings,
        });
      }
    }
    pointsRef.current = points;
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
    const points = pointsRef.current;
    const mouse = mouseRef.current;
    const noiseFn = noiseRef.current;
    if (!noiseFn) return;
    const { movement, hover, force } = cfgRef.current;

    const curl = CURL;
    const base = BASE_ANGLE;
    const drift = time * movement * 6e-6;
    const dirX = Math.cos(base) * drift;
    const dirY = Math.sin(base) * drift;

    points.forEach((p) => {
      const n = noiseFn(p.x * 0.003 - dirX, p.y * 0.003 - dirY);
      const target = base + n * Math.PI * curl;

      const dx = p.x - mouse.sx;
      const dy = p.y - mouse.sy;
      const d = Math.hypot(dx, dy);
      const l = Math.max(170, mouse.vs * 1.6);
      let bend = 0;

      // 6. RIPPLE INTERACTION (Gently push away from cursor, rotate, scale up)
      if (hover && d < l && mouse.set) {
        const s = 1 - d / l;
        const influence = (force / 10) * 0.018;
        const tangent = Math.atan2(dy, dx) + Math.PI / 2;
        bend = (tangent - target) * s * (0.32 + mouse.vs * influence);

        const f = Math.cos(d * 0.001) * s;
        const push = (force / 10) * 5.2e-4;
        p.cursor.vx += Math.cos(Math.atan2(dy, dx)) * f * l * mouse.vs * push;
        p.cursor.vy += Math.sin(Math.atan2(dy, dx)) * f * l * mouse.vs * push;
      }

      let diff = target + bend - p.angle;
      while (diff > Math.PI) diff -= 2 * Math.PI;
      while (diff < -Math.PI) diff += 2 * Math.PI;
      p.angle += diff * 0.09;

      // Smooth return to original position
      p.cursor.vx += (0 - p.cursor.x) * 0.011;
      p.cursor.vy += (0 - p.cursor.y) * 0.011;
      p.cursor.vx *= 0.93;
      p.cursor.vy *= 0.93;
      p.cursor.x += p.cursor.vx;
      p.cursor.y += p.cursor.vy;
      p.cursor.x = Math.min(40, Math.max(-40, p.cursor.x));
      p.cursor.y = Math.min(40, Math.max(-40, p.cursor.y));
    });
  };

  const drawAll = (time: number) => {
    const canvas = canvasRef.current;
    if (!canvas || !boundingRef.current) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const { width, height, dpr } = boundingRef.current;
    const { strokeColor, accentColor, pinkColor } = cfgRef.current;
    const points = pointsRef.current;
    const mouse = mouseRef.current;

    ctx.clearRect(0, 0, width * dpr, height * dpr);
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    // 1. Draw Dynamic Cursor Orbit Ripple Waves (expanding from mouse position)
    if (mouse.set && mouse.sx > 0 && mouse.sy > 0) {
      const cx = mouse.sx;
      const cy = mouse.sy;
      const cursorRipples = [38, 80, 130, 185];

      cursorRipples.forEach((radius, idx) => {
        const pulse = Math.sin(time * 0.0022 + idx * 1.4) * 3.5;
        const curR = radius + pulse;
        ctx.save();
        ctx.strokeStyle = idx % 2 === 0 ? "rgba(0, 214, 180, 0.16)" : "rgba(255, 77, 184, 0.13)";
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 6]);
        ctx.beginPath();
        ctx.arc(cx, cy, curR, 0, Math.PI * 2);
        ctx.stroke();

        // Orbiting micro-node on cursor ring
        const nodeAngle = time * (0.0006 * (idx % 2 === 0 ? 1 : -1)) + idx * 2.1;
        const nx = cx + Math.cos(nodeAngle) * curR;
        const ny = cy + Math.sin(nodeAngle) * curR;
        ctx.setLineDash([]);
        ctx.fillStyle = idx % 2 === 0 ? COLOR_TEAL : COLOR_PINK;
        ctx.globalAlpha = 0.55;
        ctx.beginPath();
        ctx.arc(nx, ny, 1.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });
    }

    // 2. Draw Sparkling Stardust
    stardustRef.current.forEach((star) => {
      const sx = star.xRatio * width;
      const sy = star.yRatio * height;
      const twinkle = Math.sin(time * star.speed + star.phase) * 0.5 + 0.5;
      const curAlpha = star.alpha * (0.5 + twinkle * 0.5);

      ctx.save();
      ctx.fillStyle = star.color;
      ctx.globalAlpha = curAlpha;
      ctx.beginPath();
      ctx.arc(sx, sy, star.size, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });

    // 3. Draw Orbit + Reactions Hybrid Particles
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const cx = p.x + p.cursor.x;
      const cy = p.y + p.cursor.y;

      const dx = cx - mouse.sx;
      const dy = cy - mouse.sy;
      const dist = Math.hypot(dx, dy);
      const rippleRadius = 180;
      const proximity = mouse.set && dist < rippleRadius ? Math.max(0, 1 - dist / rippleRadius) : 0;

      // 4. On interaction: brighter & more visible (40%-80%), scale up (+20%)
      const currentAlpha = Math.min(0.82, p.baseAlpha + proximity * 0.62);
      const currentScale = 1 + proximity * 0.22;
      const curSize = p.size * currentScale;

      // Color scheme based on shape (Teal for bubbles/checks, Pink for hearts, Ice for @)
      let primaryColor = strokeColor;
      if (p.shape === "heart") {
        primaryColor = pinkColor;
      } else if (p.shape === "at") {
        primaryColor = COLOR_ICE;
      } else {
        primaryColor = proximity > 0.12 ? accentColor : strokeColor;
      }

      // Draw attached orbit rings for Orbit-style particles (Orbit Ripple 05)
      if (p.hasOrbitRings && p.orbitRings) {
        p.orbitRings.forEach((ring) => {
          ctx.save();
          ctx.strokeStyle = ring.dotColor === COLOR_PINK ? "rgba(255, 77, 184, 0.15)" : "rgba(0, 214, 180, 0.15)";
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 6]);
          ctx.beginPath();
          ctx.arc(cx, cy, ring.radius * currentScale, 0, Math.PI * 2);
          ctx.stroke();

          // Satellite node travelling on orbit
          const curAngle = ring.dotAngle + time * ring.speed;
          const sx = cx + Math.cos(curAngle) * (ring.radius * currentScale);
          const sy = cy + Math.sin(curAngle) * (ring.radius * currentScale);
          ctx.setLineDash([]);
          ctx.fillStyle = ring.dotColor;
          ctx.globalAlpha = Math.min(0.85, 0.35 + proximity * 0.5);
          ctx.beginPath();
          ctx.arc(sx, sy, ring.dotSize, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        });
      }

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(p.angle + p.rotationOffset);
      ctx.globalAlpha = currentAlpha;
      ctx.strokeStyle = primaryColor;
      ctx.lineWidth = curSize >= 22 ? 1.55 : curSize >= 16 ? 1.35 : 1.15;

      // Draw clean vector messaging symbols
      switch (p.shape) {
        case "bubble": {
          // Smooth rounded Chat Bubble Outline
          const bw = curSize;
          const bh = curSize * 0.72;
          const br = curSize * 0.25;

          ctx.beginPath();
          ctx.moveTo(-bw / 2 + br, -bh / 2);
          ctx.lineTo(bw / 2 - br, -bh / 2);
          ctx.arcTo(bw / 2, -bh / 2, bw / 2, bh / 2, br);
          ctx.arcTo(bw / 2, bh / 2, -bw / 2, bh / 2, br);
          // Sleek corner tail notch
          ctx.lineTo(-bw / 2 + br * 1.35, bh / 2);
          ctx.lineTo(-bw / 2 - curSize * 0.14, bh / 2 + curSize * 0.22);
          ctx.lineTo(-bw / 2 + curSize * 0.04, bh / 2 - curSize * 0.06);
          ctx.arcTo(-bw / 2, -bh / 2, bw / 2, -bh / 2, br);
          ctx.closePath();
          ctx.stroke();

          // Subtle internal line for large bubbles
          if (p.hasLines && curSize >= 18) {
            ctx.beginPath();
            ctx.moveTo(-bw * 0.24, -bh * 0.08);
            ctx.lineTo(bw * 0.24, -bh * 0.08);
            ctx.moveTo(-bw * 0.24, bh * 0.2);
            ctx.lineTo(bw * 0.06, bh * 0.2);
            ctx.stroke();
          }
          break;
        }

        case "check": {
          // Double-check read receipt symbol
          const cs = curSize * 0.52;
          ctx.beginPath();
          ctx.moveTo(-cs * 0.95, -cs * 0.05);
          ctx.lineTo(-cs * 0.35, cs * 0.55);
          ctx.lineTo(cs * 0.55, -cs * 0.6);
          ctx.stroke();

          ctx.beginPath();
          ctx.moveTo(-cs * 0.45, -cs * 0.05);
          ctx.lineTo(cs * 0.15, cs * 0.55);
          ctx.lineTo(cs * 1.05, -cs * 0.6);
          ctx.stroke();
          break;
        }

        case "heart": {
          // Free-floating reaction heart outline in soft pink/magenta
          const hs = curSize * 0.48;
          ctx.beginPath();
          ctx.moveTo(0, hs * 0.7);
          ctx.bezierCurveTo(-hs * 1.15, -hs * 0.12, -hs * 1.15, -hs * 1.05, 0, -hs * 0.42);
          ctx.bezierCurveTo(hs * 1.15, -hs * 1.05, hs * 1.15, -hs * 0.12, 0, hs * 0.7);
          ctx.stroke();
          break;
        }

        case "at": {
          // Communication @ / node outline
          const rad = curSize * 0.38;
          ctx.beginPath();
          ctx.arc(0, 0, rad * 0.42, 0, Math.PI * 2);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(0, 0, rad, Math.PI * 0.18, Math.PI * 1.85);
          ctx.stroke();
          break;
        }
      }

      ctx.restore();
    }

    ctx.restore();
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !canvasRef.current) return;
    noiseRef.current = createNoise2D(SEED);
    setSize();
    initStardust();
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

      // Animation frame render
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
