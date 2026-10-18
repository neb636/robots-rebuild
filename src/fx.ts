// Particle systems: drifting ash, rising embers, rain streaks, and low fog banks.
// All are GPU-animated from a time uniform and wrap around the camera so they read as endless.
import * as THREE from 'three';
import { fogTex } from './textures';
import { rng } from './noise';

// default vertical bands (world y), sized for a street at y = 0
const ASH_Y0 = -1, ASH_SPAN = 16;
const RAIN_Y0 = -0.5, RAIN_SPAN = 14;

/** Ash / snow-like flakes drifting down and swirling, wrapped in a box around the focus point. */
export function ash(count: number) {
  const R = rng(4);
  const pos = new Float32Array(count * 3), rnd = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    pos[i * 3] = R() * 40 - 20; pos[i * 3 + 1] = R() * 16; pos[i * 3 + 2] = R() * 40 - 20;
    rnd[i * 4] = R(); rnd[i * 4 + 1] = R(); rnd[i * 4 + 2] = R(); rnd[i * 4 + 3] = R();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('rnd', new THREE.BufferAttribute(rnd, 4));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { t: { value: 0 }, focus: { value: new THREE.Vector3() }, color: { value: new THREE.Color('#b8b0a8') }, opacity: { value: 0.8 }, fall: { value: 0.45 }, size: { value: 1 }, y0: { value: ASH_Y0 }, span: { value: ASH_SPAN } },
    vertexShader: /* glsl */`
      attribute vec4 rnd; uniform float t; uniform vec3 focus; uniform float fall; uniform float size; uniform float y0; uniform float span;
      varying float vA; varying float vSpin;
      void main(){
        vec3 p = position;
        p.y -= t * fall * (0.6 + rnd.x * 0.8);
        p.x += sin(t * (0.3 + rnd.y * 0.5) + rnd.z * 6.28) * 0.9 + t * 0.25;
        p.z += cos(t * (0.25 + rnd.w * 0.4) + rnd.x * 6.28) * 0.7;
        // wrap into a 40 x span x 40 box centred on the focus, from y0 up (flakes keep their place in
        // the world as the band moves, they only wrap at its edges)
        p.x = mod(p.x - focus.x + 20.0, 40.0) - 20.0 + focus.x;
        p.z = mod(p.z - focus.z + 20.0, 40.0) - 20.0 + focus.z;
        p.y = mod(p.y - y0 + ${ASH_Y0.toFixed(1)}, span) + y0;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = size * (3.0 + rnd.y * 5.0) * (10.0 / -mv.z);
        vA = smoothstep(40.0, 6.0, -mv.z) * smoothstep(1.2, 3.5, -mv.z);
        vSpin = rnd.z * 6.28 + t * (rnd.w - 0.5) * 3.0;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 color; uniform float opacity; varying float vA; varying float vSpin;
      void main(){
        vec2 q = gl_PointCoord - 0.5;
        float c = cos(vSpin), s = sin(vSpin);
        q = mat2(c, -s, s, c) * q;
        q.y *= 1.8; // flat flakes
        float d = length(q);
        float a = smoothstep(0.5, 0.15, d) * vA * opacity;
        if (a < 0.01) discard;
        gl_FragColor = vec4(color, a);
      }`,
  });
  const pts = new THREE.Points(g, mat); pts.frustumCulled = false;
  return {
    obj: pts, mat,
    update(t: number, focus: THREE.Vector3) { mat.uniforms.t.value = t; mat.uniforms.focus.value.copy(focus); },
    /** vertical band [y0, y0 + span] (default: a fixed band from y = -1) */
    band(y0 = ASH_Y0, span = ASH_SPAN) { mat.uniforms.y0.value = y0; mat.uniforms.span.value = span; },
  };
}

/** Embers rising from a fire, flickering and cooling as they climb. */
export function embers(origin: THREE.Vector3, count: number) {
  const R = rng(8);
  const rnd = new Float32Array(count * 4), pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) { rnd[i * 4] = R(); rnd[i * 4 + 1] = R(); rnd[i * 4 + 2] = R(); rnd[i * 4 + 3] = R(); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('rnd', new THREE.BufferAttribute(rnd, 4));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { t: { value: 0 }, origin: { value: origin.clone() } },
    vertexShader: /* glsl */`
      attribute vec4 rnd; uniform float t; uniform vec3 origin; varying float vLife;
      void main(){
        float life = fract(t * (0.18 + rnd.x * 0.2) + rnd.y);
        vLife = life;
        vec3 p = origin + vec3((rnd.z - 0.5) * 0.4, 0.0, (rnd.w - 0.5) * 0.4);
        p.y += life * (3.5 + rnd.x * 3.0);
        p.x += sin(life * 9.0 + rnd.z * 20.0) * 0.35 * life + life * 0.8;
        p.z += cos(life * 7.0 + rnd.w * 20.0) * 0.3 * life;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = (3.0 + rnd.z * 4.0) * (10.0 / -mv.z) * (1.0 - life * 0.6);
      }`,
    fragmentShader: /* glsl */`
      varying float vLife;
      void main(){
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d) * (1.0 - vLife) * (0.6 + 0.4 * sin(vLife * 60.0));
        vec3 c = mix(vec3(1.0, 0.75, 0.3), vec3(1.0, 0.2, 0.02), vLife) * 6.0;
        gl_FragColor = vec4(c * a, a);
      }`,
  });
  const pts = new THREE.Points(g, mat); pts.frustumCulled = false;
  return { obj: pts, update(t: number) { mat.uniforms.t.value = t; } };
}

/** Rain: stretched streaks falling fast, wrapped around the focus. */
export function rain(count: number) {
  const R = rng(12);
  const pos = new Float32Array(count * 6), rnd = new Float32Array(count * 2), end = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    const x = R() * 36 - 18, y = R() * 14, z = R() * 36 - 18, r = R();
    pos.set([x, y, z, x, y, z], i * 6);
    rnd[i * 2] = r; rnd[i * 2 + 1] = r;
    end[i * 2] = 0; end[i * 2 + 1] = 1;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('rnd', new THREE.BufferAttribute(rnd, 1));
  g.setAttribute('tip', new THREE.BufferAttribute(end, 1));
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { t: { value: 0 }, focus: { value: new THREE.Vector3() }, color: { value: new THREE.Color('#8a96a8') }, opacity: { value: 0.35 }, y0: { value: RAIN_Y0 }, span: { value: RAIN_SPAN } },
    vertexShader: /* glsl */`
      attribute float rnd; attribute float tip; uniform float t; uniform vec3 focus; uniform float y0; uniform float span; varying float vA;
      void main(){
        vec3 p = position;
        float sp = 11.0 + rnd * 5.0;
        p.y -= t * sp;
        p.x -= t * 1.6;
        p.x = mod(p.x - focus.x + 18.0, 36.0) - 18.0 + focus.x;
        p.z = mod(p.z - focus.z + 18.0, 36.0) - 18.0 + focus.z;
        p.y = mod(p.y - y0 + ${RAIN_Y0.toFixed(1)}, span) + y0;
        p += vec3(0.05, 0.38, 0.0) * tip;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        vA = smoothstep(30.0, 3.0, -mv.z) * (0.4 + tip * 0.6);
      }`,
    fragmentShader: /* glsl */`uniform vec3 color; uniform float opacity; varying float vA; void main(){ gl_FragColor = vec4(color, vA * opacity); }`,
  });
  const lines = new THREE.LineSegments(g, mat); lines.frustumCulled = false;
  return {
    obj: lines, mat,
    update(t: number, focus: THREE.Vector3) { mat.uniforms.t.value = t; mat.uniforms.focus.value.copy(focus); },
    /** vertical band [y0, y0 + span] (default: a fixed band from y = -0.5) */
    band(y0 = RAIN_Y0, span = RAIN_SPAN) { mat.uniforms.y0.value = y0; mat.uniforms.span.value = span; },
  };
}

/** Low, slow fog banks: big soft cards hugging the ground for layered depth in the far street. */
export function fogBanks(spots: { x: number; y: number; z: number; s: number }[]) {
  const grp = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ map: fogTex(), color: '#6a7080', transparent: true, opacity: 0.22, depthWrite: false, fog: false });
  const cards: { m: THREE.Mesh; base: THREE.Vector3; ph: number }[] = [];
  const R = rng(21);
  for (const s of spots) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(s.s * 2.2, s.s), mat);
    m.position.set(s.x, s.y, s.z); m.renderOrder = 5;
    grp.add(m); cards.push({ m, base: m.position.clone(), ph: R() * 10 });
  }
  return {
    obj: grp, mat,
    update(t: number, cam: THREE.Camera) {
      for (const c of cards) {
        c.m.position.x = c.base.x + Math.sin(t * 0.05 + c.ph) * 1.5;
        c.m.quaternion.copy(cam.quaternion);
      }
    },
  };
}
