// Sky dome (gradient, drifting overcast with fire-lit undersides, moon), plus the distant skyline:
// the collapsed State House dome and the Superintelligence Inc. spire looming over the city.
import * as THREE from 'three';
import { Batch, wbox, mergeStatic } from './batch';
import { pbrMat, glowMat, glowSprite, FogLight } from './props';
import { rng } from './noise';
import { latticeNoise2D, VNOISE_2D_GLSL } from './noisetex';

export interface SkySettings {
  zenith: string; horizon: string; glow: string; glowDir: [number, number, number]; glowAmt: number;
  cloud: string; cloudLit: string; cloudAmt: number; moon: number; moonDir: [number, number, number]; stars: number;
}

/** the sky dome's renderOrder: after every opaque mesh (the alpha-tested ones use 1, see main.ts) */
const BEACON = new THREE.Color('#ff2a1a');
export const SKY_ORDER = 1000;

export function skyDome() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      zenith: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, glow: { value: new THREE.Color() },
      glowDir: { value: new THREE.Vector3(1, 0, 0) }, glowAmt: { value: 1 },
      cloud: { value: new THREE.Color() }, cloudLit: { value: new THREE.Color() }, cloudAmt: { value: 1 },
      moon: { value: 1 }, moonDir: { value: new THREE.Vector3(0, 1, 0) }, stars: { value: 0 }, t: { value: 0 },
      noiseTex2: { value: latticeNoise2D() },
    },
    vertexShader: /* glsl */`varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: /* glsl */`
      varying vec3 vDir;
      uniform vec3 zenith, horizon, glow, glowDir, cloud, cloudLit, moonDir;
      uniform float glowAmt, cloudAmt, moon, stars, t;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      ${VNOISE_2D_GLSL}
      float fbm(vec2 p){ float s=0., a=.5; for(int i=0;i<6;i++){ s+=a*vnoise(p); p=p*2.03+vec2(1.7,9.2); a*=.5; } return s; }
      void main(){
        vec3 d = normalize(vDir);
        float y = max(d.y, -0.1);
        vec3 col = mix(horizon, zenith, pow(smoothstep(-0.05, 0.6, y), 0.7));
        // distant fires light the horizon in one direction
        float gd = max(dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(glowDir.x, 0.0, glowDir.z))), 0.0);
        float band = exp(-max(y, 0.0) * 9.0) * pow(gd, 3.0);
        col += glow * band * glowAmt;
        // moon
        float md = max(dot(d, normalize(moonDir)), 0.0);
        col += vec3(0.85, 0.9, 1.0) * (smoothstep(0.9994, 0.9997, md) * 6.0 + pow(md, 400.0) * 0.6 + pow(md, 18.0) * 0.08) * moon;
        // stars through gaps
        vec2 sp = d.xz / max(d.y, 0.05) * 60.0;
        float st = step(0.997, h(floor(sp))) * smoothstep(0.1, 0.5, y);
        // clouds: planar projection, drifting
        vec2 cp = d.xz / max(d.y + 0.08, 0.04) * 0.9 + vec2(t * 0.012, t * 0.004);
        float c = fbm(cp);
        float cov = smoothstep(0.38, 0.75, c) * cloudAmt * smoothstep(-0.02, 0.12, y);
        float lit = smoothstep(0.5, 0.9, fbm(cp * 1.7 + 3.1));
        vec3 cc = mix(cloud, cloudLit, band * 1.6 + lit * 0.25 + pow(md, 8.0) * moon * 0.6);
        col += vec3(st) * stars * (1.0 - cov);
        col = mix(col, cc, cov);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(500, 48, 24), mat);
  // drawn after every opaque thing (it sits at the far plane and writes no depth), so only the pixels
  // nothing else covered pay for its noise; still opaque, so it's done before the additive glows
  m.renderOrder = SKY_ORDER; m.frustumCulled = false;
  return {
    mesh: m,
    apply(s: SkySettings) {
      const u = mat.uniforms;
      // colors are authored in sRGB; the shader works in linear
      u.zenith.value.set(s.zenith); u.horizon.value.set(s.horizon); u.glow.value.set(s.glow);
      u.cloud.value.set(s.cloud); u.cloudLit.value.set(s.cloudLit);
      u.glowDir.value.set(...s.glowDir); u.glowAmt.value = s.glowAmt; u.cloudAmt.value = s.cloudAmt;
      u.moon.value = s.moon; u.moonDir.value.set(...s.moonDir).normalize(); u.stars.value = s.stars;
    },
    update(t: number, camPos: THREE.Vector3) { mat.uniforms.t.value = t; m.position.copy(camPos); },
  };
}

/** Skyline beyond the street: rowhouse silhouettes with scattered lit windows, the State House, the spire. */
export function skyline(parent: THREE.Object3D, b: Batch, lights: FogLight[]) {
  const R = rng(77);
  const brick = pbrMat('brick', '#6a5a54');
  const dark = new THREE.MeshStandardMaterial({ color: '#1a1a1e', roughness: 0.9 });
  const lit = glowMat('#ffb070', 3.5);
  const win = new THREE.MeshStandardMaterial({ color: '#0a0b0e', roughness: 0.3 });
  // two rows of houses climbing the hill beyond the far stairs
  for (const side of [-1, 1]) {
    let z = -36;
    while (z > -78) {
      const w = 5 + R() * 3, h = 9 + R() * 5, y0 = 2.4 + Math.max(0, (-z - 40) * 0.12);
      const x = side < 0 ? -6 - 5 : 3.6 + 5;
      b.add(wbox(10, h, w, 0.6), brick, x, y0 + h / 2, z - w / 2);
      // jagged broken roofline on some
      if (R() < 0.4) for (let k = 0; k < 4; k++) b.add(wbox(1 + R() * 2, 0.6 + R() * 1.5, 1 + R() * 2, 0.6), brick, x + (R() - 0.5) * 6, y0 + h + 0.3, z - R() * w, 0, 0, (R() - 0.5) * 0.5);
      else b.add(wbox(10.6, 0.4, w + 0.2, 0.6), dark, x, y0 + h + 0.2, z - w / 2);
      const fx = side < 0 ? -6 + 0.02 : 3.6 - 0.02;
      for (let fy = 0; fy < 3; fy++) for (let k = 0; k < Math.floor(w / 1.8); k++) {
        const isLit = R() < 0.06;
        const g = new THREE.PlaneGeometry(0.9, 1.6);
        b.add(g, isLit ? lit : win, fx + side * -0.01, y0 + 2.4 + fy * 3, z - 1 - k * 1.8, 0, side < 0 ? Math.PI / 2 : -Math.PI / 2, 0, 1, 1, 1, false);
      }
      z -= w;
    }
  }
  // far ground climbing the hill
  b.add(wbox(12, 1, 46, 0.4), pbrMat('asphalt', '#8a8a8a'), -1.2, 2.4 - 0.5 + 1.5, -58, -0.065, 0, 0);

  // ---- State House: collapsed gilded dome on a columned drum
  const sh = new THREE.Group(); sh.position.set(-4, 11, -112); parent.add(sh);
  const stone = pbrMat('brownstone', '#9a8a80');
  const add = (g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = false; o.receiveShadow = true; sh.add(o); return o; };
  add(wbox(40, 14, 16, 0.3), pbrMat('brick', '#a08070'), 0, -4, 0);
  add(wbox(42, 1, 17, 0.3), stone, 0, 3.5, 0);
  for (let i = 0; i < 10; i++) add(new THREE.CylinderGeometry(0.6, 0.7, 10, 14), stone, -13.5 + i * 3, -2, 8.6);
  add(new THREE.CylinderGeometry(9, 9, 5, 40), stone, 0, 6.5, 0);
  for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; add(new THREE.CylinderGeometry(0.35, 0.35, 4.5, 8), stone, Math.cos(a) * 9.3, 6.5, Math.sin(a) * 9.3); }
  const gold = new THREE.MeshStandardMaterial({ color: '#b08a3a', roughness: 0.38, metalness: 1 });
  // dome with a torn-open wedge, ribs exposed
  const dome = add(new THREE.SphereGeometry(8.6, 48, 24, 0.9, Math.PI * 2 - 1.5, 0, Math.PI / 2), gold, 0, 9, 0);
  dome.material = gold; (dome.material as THREE.Material).side = THREE.DoubleSide;
  const ribMat = new THREE.MeshStandardMaterial({ color: '#2a2420', roughness: 0.8 });
  for (let i = 0; i < 6; i++) {
    const a = -0.6 + i * 0.25 + 0.9 - 0.9;
    const rib = add(new THREE.TorusGeometry(8.6, 0.12, 6, 24, Math.PI / 2 * (0.5 + R() * 0.5)), ribMat, 0, 9, 0);
    rib.rotation.set(0, a + 0.15, Math.PI / 2);
  }
  add(new THREE.CylinderGeometry(1.2, 1.4, 2.6, 16), gold, 2.2, 16.6, -1.5).rotation.z = 0.35;
  mergeStatic(sh);

  const sp = spire(parent, 70, 0, -340);
  void lights;
  return { update: sp.update };
}

/** The Superintelligence Inc. spire: a black monolith that has no business being here (300 m of it,
 *  seams lit, red rings turning near the top, a beacon and a beam into the cloud) */
export function spire(parent: THREE.Object3D, x: number, y: number, z: number) {
  const spire = new THREE.Group(); spire.position.set(x, y, z); parent.add(spire);
  const obsidian = new THREE.MeshStandardMaterial({ color: '#07080a', roughness: 0.18, metalness: 0.8 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(7, 16, 300, 4, 1), obsidian); body.position.y = 150; body.rotation.y = Math.PI / 4; spire.add(body);
  const seam = glowMat('#d8f0ff', 2.2);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.5, 300, 0.5), seam);
    s.position.set(Math.cos(a) * 11.4, 150, Math.sin(a) * 11.4); s.rotation.set(Math.sin(a) * -0.03, 0, Math.cos(a) * 0.03); spire.add(s);
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(16, 0.7, 8, 64), glowMat('#ff3020', 6)); ring.position.y = 245; ring.rotation.x = Math.PI / 2; spire.add(ring);
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(22, 0.35, 8, 64), glowMat('#ff3020', 3)); ring2.position.y = 232; ring2.rotation.x = Math.PI / 2 + 0.1; spire.add(ring2);
  const beacon = glowSprite('#ff2a1a', 40, 6); beacon.position.y = 304; spire.add(beacon);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 3, 400, 16, 1, true), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff4030').multiplyScalar(0.6), transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  beam.position.y = 500; spire.add(beam);
  // a soft red bloom around the crown; drawn as a sprite rather than a fog light so it stays in the sky
  const crown = glowSprite('#ff3020', 140, 0.5); crown.position.y = 240; spire.add(crown);
  return {
    group: spire,
    update(t: number) {
      ring.rotation.z = t * 0.08; ring2.rotation.z = -t * 0.05;
      const blink = Math.sin(t * 1.4) > 0.6 ? 1 : 0.15;
      (beacon.material as THREE.SpriteMaterial).color.copy(BEACON).multiplyScalar(6 * blink);
    },
  };
}
