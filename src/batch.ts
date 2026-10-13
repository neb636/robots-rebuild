// Static-geometry batching: everything added with the same material is merged (per ground chunk),
// so a richly detailed street still costs only a modest number of draw calls.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();

export class Batch {
  private groups = new Map<THREE.Material, { geos: THREE.BufferGeometry[]; cast: boolean }>();
  /** Transform applied after each geometry's own transform (place whole buildings in local space). */
  base = new THREE.Matrix4();
  setBase(x: number, y: number, z: number, ry = 0) { this.base.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(0, ry, 0)), _s.set(1, 1, 1)); }
  resetBase() { this.base.identity(); }

  /** Add a geometry transformed by position / euler rotation / scale. The geometry is consumed. */
  add(g: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, cast = true) {
    _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
    return this.addMatrix(g, mat, _m, cast);
  }

  addMatrix(g: THREE.BufferGeometry, mat: THREE.Material, m: THREE.Matrix4, cast = true) {
    let geo = g.index ? g.toNonIndexed() : g;
    if (geo !== g) g.dispose();
    geo.applyMatrix4(m);
    geo.applyMatrix4(this.base);
    for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv' && k !== 'color') geo.deleteAttribute(k);
    if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
    let e = this.groups.get(mat);
    if (!e) { e = { geos: [], cast }; this.groups.set(mat, e); }
    e.geos.push(geo);
    return geo;
  }

  /**
   * Merge everything added so far. Each material is merged per `cell`-sized square of the ground
   * plane rather than into one street-wide mesh, so frustum culling still works: the camera skips
   * chunks behind it, and each shadow view (a lamp's six cube faces, the drone's cone) only draws
   * the chunks it can see.
   */
  flush(parent: THREE.Object3D, cell = 10) {
    const box = new THREE.Box3(), c = new THREE.Vector3();
    for (const [mat, e] of this.groups) {
      // geometries with and without vertex colors can't merge; split them
      const lists = new Map<string, THREE.BufferGeometry[]>();
      for (const g of e.geos) {
        box.setFromBufferAttribute(g.attributes.position as THREE.BufferAttribute).getCenter(c);
        const key = `${!!g.attributes.color}:${Math.floor(c.x / cell)}:${Math.floor(c.z / cell)}`;
        let list = lists.get(key);
        if (!list) lists.set(key, (list = []));
        list.push(g);
      }
      for (const list of lists.values()) {
        const merged = mergeGeometries(list, false);
        list.forEach((g) => g.dispose());
        if (!merged) continue;
        const mesh = new THREE.Mesh(merged, mat);
        mesh.castShadow = e.cast; mesh.receiveShadow = true;
        parent.add(mesh);
      }
    }
    this.groups.clear();
  }
}

/**
 * Merge the plain meshes directly under each node of a rigid hierarchy: siblings that share a
 * material and shadow/render flags become one mesh in the parent's space. Joints keep animating
 * (only meshes, never groups, are merged), but a character or prop drops from a hundred draw calls
 * to a few dozen, in every pass that draws it (main, normals, each shadow map). `keep` lists meshes
 * that must stay separate because code moves or swaps them individually.
 */
export function mergeStatic(root: THREE.Object3D, keep: Iterable<THREE.Object3D> = []) {
  const skip = new Set(keep);
  const nodes: THREE.Object3D[] = [];
  root.traverse((o) => nodes.push(o));
  for (const node of nodes) {
    const groups = new Map<string, THREE.Mesh[]>();
    for (const c of node.children) {
      const m = c as THREE.Mesh;
      if (!m.isMesh || (m as THREE.InstancedMesh).isInstancedMesh || (m as THREE.SkinnedMesh).isSkinnedMesh || skip.has(m)) continue;
      if (m.children.length || Array.isArray(m.material) || !m.visible || m.onBeforeRender !== THREE.Object3D.prototype.onBeforeRender) continue;
      m.updateMatrix();
      if (m.matrix.determinant() <= 0) continue; // mirrored: would flip winding
      const key = `${m.material.uuid}|${m.castShadow}|${m.receiveShadow}|${m.renderOrder}|${m.frustumCulled}|${Object.keys(m.geometry.attributes).sort()}|${!!m.geometry.index}`;
      let list = groups.get(key);
      if (!list) groups.set(key, (list = []));
      list.push(m);
    }
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      const geos = list.map((m) => m.geometry.clone().applyMatrix4(m.matrix));
      const merged = mergeGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      if (!merged) continue;
      const first = list[0];
      const mesh = new THREE.Mesh(merged, first.material);
      mesh.castShadow = first.castShadow; mesh.receiveShadow = first.receiveShadow;
      mesh.renderOrder = first.renderOrder; mesh.frustumCulled = first.frustumCulled;
      mesh.name = first.name;
      node.add(mesh);
      for (const m of list) node.remove(m);
    }
  }
}

/** Box with UVs in world units × `uv` (so tiling textures keep a constant texel density). */
export function wbox(w: number, h: number, d: number, uv = 0.5, ou = 0, ov = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  const a = g.attributes.uv as THREE.BufferAttribute, n = g.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < a.count; i++) {
    const nx = Math.abs(n.getX(i)), ny = Math.abs(n.getY(i));
    let u = a.getX(i), v = a.getY(i);
    if (nx > 0.5) { u *= d; v *= h; } else if (ny > 0.5) { u *= w; v *= d; } else { u *= w; v *= h; }
    a.setXY(i, u * uv + ou, v * uv + ov);
  }
  return g;
}

/** Plane with world-scaled UVs. */
export function wplane(w: number, h: number, uv = 0.5, ou = 0, ov = 0) {
  const g = new THREE.PlaneGeometry(w, h);
  const a = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < a.count; i++) a.setXY(i, a.getX(i) * w * uv + ou, a.getY(i) * h * uv + ov);
  return g;
}
