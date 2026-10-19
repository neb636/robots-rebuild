// The planar reflection (High quality): the scene drawn once more each frame from a camera mirrored in
// the water's still level, into a half-resolution target with depth (so the water shader can fog the
// reflected light along its path). Called from the area's beforeRender hook, outside the post stack:
// three's Reflector renders from onBeforeRender, which would also fire inside the SSAO normal pass.
// Only objects on REFLECT_LAYER are drawn; the scene's lights must be on it too, or the reflection
// pass would see a different light set and every material would compile a second program.
import * as THREE from 'three';
import { drs } from '../../drs';

export const REFLECT_LAYER = 1;

export class PlanarReflection {
  rt: THREE.WebGLRenderTarget;
  /** world -> reflection texture coordinates (projective) */
  texMatrix = new THREE.Matrix4();
  /** reflection clip space -> world (for the shader's depth reconstruction) */
  inverse = new THREE.Matrix4();
  private cam = new THREE.PerspectiveCamera();
  private size = new THREE.Vector2();
  private v = new THREE.Vector3(); private target = new THREE.Vector3(); private look = new THREE.Vector3();
  private rot = new THREE.Matrix4(); private plane = new THREE.Plane(); private clip = new THREE.Vector4(); private q = new THREE.Vector4();
  private camPos = new THREE.Vector3();
  private frames = 0;

  constructor(private level: number, private scale = 0.5) {
    this.rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false });
    this.rt.depthTexture = new THREE.DepthTexture(1, 1);
    this.cam.layers.set(REFLECT_LAYER);
  }

  /** Draw the mirrored scene. `hide` is the water itself (and anything else that mustn't reflect). */
  render(gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, hide: THREE.Object3D[]) {
    gl.getDrawingBufferSize(this.size);
    // (sized from the full-resolution buffer: dynamic resolution doesn't blur the mirror)
    const w = Math.max(1, Math.floor(this.size.x * this.scale / drs.scale)), h = Math.max(1, Math.floor(this.size.y * this.scale / drs.scale));
    if (this.rt.width !== w || this.rt.height !== h) this.rt.setSize(w, h);
    const n = new THREE.Vector3(0, 1, 0), p0 = new THREE.Vector3(0, this.level, 0);
    this.camPos.setFromMatrixPosition(camera.matrixWorld);
    // under the surface (a future swim): nothing to mirror
    if (this.camPos.y < this.level + 0.05) return false;
    // the camera, its aim and its up mirrored in the (horizontal) water plane
    this.v.set(this.camPos.x, 2 * this.level - this.camPos.y, this.camPos.z);
    this.rot.extractRotation(camera.matrixWorld);
    this.look.set(0, 0, -1).applyMatrix4(this.rot).add(this.camPos);
    this.target.set(this.look.x, 2 * this.level - this.look.y, this.look.z);
    const c = this.cam;
    c.position.copy(this.v);
    c.up.set(0, 1, 0).applyMatrix4(this.rot).reflect(n);
    c.lookAt(this.target);
    c.near = camera.near; c.far = camera.far; c.fov = camera.fov; c.aspect = camera.aspect;
    c.updateMatrixWorld();
    c.projectionMatrix.copy(camera.projectionMatrix);
    this.texMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(c.projectionMatrix).multiply(c.matrixWorldInverse);
    // oblique near plane at the water, so nothing below it reflects (Lengyel)
    this.plane.setFromNormalAndCoplanarPoint(n, p0).applyMatrix4(c.matrixWorldInverse);
    this.clip.set(this.plane.normal.x, this.plane.normal.y, this.plane.normal.z, this.plane.constant);
    const e = c.projectionMatrix.elements;
    this.q.set((Math.sign(this.clip.x) + e[8]) / e[0], (Math.sign(this.clip.y) + e[9]) / e[5], -1, (1 + e[10]) / e[14]);
    this.clip.multiplyScalar(2 / this.clip.dot(this.q));
    e[2] = this.clip.x; e[6] = this.clip.y; e[10] = this.clip.z + 1 - 0.003; e[14] = this.clip.w;
    c.projectionMatrixInverse.copy(c.projectionMatrix).invert();
    this.inverse.multiplyMatrices(c.matrixWorld, c.projectionMatrixInverse);
    // draw, reusing this frame's shadow maps
    const vis = hide.map((o) => o.visible);
    hide.forEach((o) => (o.visible = false));
    const autoShadow = gl.shadowMap.autoUpdate, prevRT = gl.getRenderTarget();
    gl.shadowMap.autoUpdate = this.frames++ < 2; // the first frames must build them
    gl.setRenderTarget(this.rt);
    gl.clear();
    gl.render(scene, c);
    gl.setRenderTarget(prevRT);
    gl.shadowMap.autoUpdate = autoShadow;
    hide.forEach((o, i) => (o.visible = vis[i]));
    return true;
  }

  dispose() { this.rt.depthTexture?.dispose(); this.rt.dispose(); }
}
