// The hero eclipse: one full-screen WebGL triangle (OGL) drawing a lit disc, a black moon, the corona, a "diamond
// ring" flare and a faint star field. All sizes are in units of the disc radius R so it scales with the layout.
import { Renderer, Program, Mesh, Triangle } from "ogl";

const vertex = /* glsl */ `
attribute vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;

const fragment = /* glsl */ `
precision highp float;
uniform vec2 uCenter;   // disc center, device px (GL y-up)
uniform float uR;       // disc radius, device px
uniform vec2 uMoon;     // moon offset from the disc center, device px
uniform float uTime;
uniform float uLight;   // 0..1 fade-in of everything lit
uniform float uFlare;   // 0..1 diamond-ring flare
uniform float uBoost;   // extra corona while scrolling into totality
uniform float uDpr;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.02 + vec2(1.7, 9.2); a *= 0.5; } return v; }

void main() {
  vec2 p = gl_FragCoord.xy - uCenter;
  float R = uR, r = length(p), aa = 1.4 * uDpr;
  float rm = length(p - uMoon);
  float sun = smoothstep(R + aa, R - aa, r);
  float moon = smoothstep(R * 1.02 + aa, R * 1.02 - aa, rm);

  // Coverage: 1 at totality. The corona only really shows when most of the disc is hidden.
  float cover = 1.0 - clamp(length(uMoon) / (2.0 * R), 0.0, 1.0);
  float total = smoothstep(0.55, 1.0, cover);

  float d = max(r - R, 0.0) / R;
  float ang = atan(p.y, p.x);
  // Polar fbm: wrap the angle through sin/cos so there's no seam at -pi/pi.
  vec2 polar = vec2(cos(ang), sin(ang)) * 2.2;
  float rays = fbm(polar + vec2(uTime * 0.03, d * 1.6 - uTime * 0.05));
  rays = pow(rays, 1.7) * 2.3;
  float corona = (exp(-d * 5.5) * 0.85 + exp(-d * 1.5) * 0.4 * rays) * (0.18 + 1.25 * total + 0.9 * uBoost);
  // A tight halo where light leaks past the moon's edge (the crescent side).
  float leak = smoothstep(-0.05 * R, 0.4 * R, rm - R);
  float halo = exp(-d * 10.0) * leak * 0.9;

  vec3 tint = vec3(0.545, 0.576, 1.0);
  vec3 glow = tint * (corona + halo) * uLight;

  // Diamond ring: a flare on the rim opposite the moon, where light comes back first.
  vec2 dir = length(uMoon) > 0.5 ? -normalize(uMoon) : vec2(0.7071);
  vec2 fp = (p - dir * R) / R;
  float fl = length(fp);
  float flare = exp(-fl * 13.0) * 2.6 + exp(-fl * 3.2) * 0.4;
  flare += exp(-abs(fp.y) * 70.0) * exp(-abs(fp.x) * 1.6) * 0.7;   // horizontal streak
  glow += vec3(0.86, 0.88, 1.0) * flare * uFlare;

  vec3 col = 1.0 - exp(-glow);   // soft tone map so the glow never clips

  // Star field: sparse 7px cells, twinkling, hidden behind the corona.
  vec2 sp = gl_FragCoord.xy / (7.0 * uDpr);
  float h = hash(floor(sp));
  if (h > 0.991) {
    float tw = 0.55 + 0.45 * sin(uTime * (0.8 + h * 3.0) + h * 50.0);
    float s = smoothstep(0.28, 0.0, length(fract(sp) - 0.5)) * tw * (h - 0.991) * 50.0;
    col += vec3(0.8, 0.82, 1.0) * s * (1.0 - clamp(corona * 1.5, 0.0, 1.0)) * uLight;
  }

  // The lit disc: periwinkle inside, lavender-white at the rim (the logo's crescent).
  vec3 disc = mix(vec3(0.49, 0.52, 0.98), vec3(0.92, 0.93, 1.0), smoothstep(0.3 * R, R, r));
  disc = mix(disc, vec3(1.0), uFlare * 0.35);
  col = mix(col, disc * uLight, sun);
  col = mix(col, vec3(0.0), moon);   // the moon is true black
  gl_FragColor = vec4(col, 1.0);
}
`;

export interface EclipseState { mx: number; my: number; light: number; flare: number; boost: number }

/** Mounts the shader on `canvas`, sized to its parent. `layout()` returns the disc center (CSS px, relative to the parent) and radius. */
export function mountEclipse(canvas: HTMLCanvasElement, layout: () => { x: number; y: number; r: number }, state: EclipseState) {
  const dpr = Math.min(devicePixelRatio || 1, 1.5);
  const renderer = new Renderer({ canvas, dpr, alpha: false, antialias: false, powerPreference: "high-performance" });
  const gl = renderer.gl;
  gl.clearColor(0, 0, 0, 1);
  const program = new Program(gl, {
    vertex, fragment,
    uniforms: {
      uCenter: { value: [0, 0] }, uR: { value: 100 }, uMoon: { value: [0, 0] }, uTime: { value: 0 },
      uLight: { value: 0 }, uFlare: { value: 0 }, uBoost: { value: 0 }, uDpr: { value: dpr },
    },
  });
  const mesh = new Mesh(gl, { geometry: new Triangle(gl), program });

  let w = 0, h = 0, cx = 0, cy = 0, R = 100;
  // Measure the parent: OGL's constructor gives the canvas an inline 300x150 size, so its own size is meaningless here.
  const box = canvas.parentElement!;
  const resize = () => {
    w = box.clientWidth; h = box.clientHeight;
    renderer.setSize(w, h);
    ({ x: cx, y: cy, r: R } = layout());
  };
  resize();

  // The moon leans a little toward the cursor.
  let px = 0, py = 0, tx = 0, ty = 0;
  const onMove = (e: PointerEvent) => { tx = e.clientX / innerWidth - 0.5; ty = e.clientY / innerHeight - 0.5; };
  addEventListener("pointermove", onMove, { passive: true });

  const start = performance.now();
  const render = () => {
    px += (tx - px) * 0.05; py += (ty - py) * 0.05;
    const u = program.uniforms;
    u.uCenter.value = [cx * dpr, (h - cy) * dpr];
    u.uR.value = R * dpr;
    u.uMoon.value = [(state.mx + px * 0.06) * R * dpr, (state.my - py * 0.06) * R * dpr];
    u.uTime.value = (performance.now() - start) / 1000;
    u.uLight.value = state.light;
    u.uFlare.value = state.flare;
    u.uBoost.value = state.boost;
    renderer.render({ scene: mesh });
  };
  return { render, resize, destroy: () => removeEventListener("pointermove", onMove) };
}
