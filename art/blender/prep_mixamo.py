"""Turn a Tripo GLB in art/source into the FBX uploaded to Mixamo's auto-rigger.

Run with Blender: `blender -b -P art/blender/prep_mixamo.py -- Maya Marcus`
(names are the GLBs in art/source; writes art/source/mixamo/<name>/<name>.fbx).

The glTF importer splits vertices along every UV seam (~1000 loose pieces per Tripo model). Mixamo
weights each piece on its own, so seams can crack open when a joint bends; welding them first gives
one skin. Everything else Mixamo wants the Tripo export already has: one mesh, A-pose, facing front,
feet on the ground at the origin. The height stays at Tripo's 1 m (AUTHORED_HEIGHT, like Theo).
"""
import os
import sys

import bmesh
import bpy

REPO = os.environ.get("THEO_REPO") or os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC = os.path.join(REPO, "art", "source")


def prep(name):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=os.path.join(SRC, name + ".glb"))
    new = [o for o in bpy.data.objects if o not in before]
    body = next(o for o in new if o.type == 'MESH')
    body.parent = None
    body.matrix_world.identity()
    for o in new:
        if o is not body:
            bpy.data.objects.remove(o, do_unlink=True)
    body.name = name
    body.data.name = name + "_Mesh"

    bm = bmesh.new()
    bm.from_mesh(body.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.to_mesh(body.data)
    bm.free()

    # Tripo's base color runs through a Mix node (its baseColorFactor); the FBX exporter only
    # embeds a texture wired straight into Base Color.
    mat = body.data.materials[0]
    mat.name = name + "_Mat"
    nt = mat.node_tree
    tex = next(n for n in nt.nodes if n.bl_idname == 'ShaderNodeTexImage')
    bsdf = next(n for n in nt.nodes if n.bl_idname == 'ShaderNodeBsdfPrincipled')
    for n in [n for n in nt.nodes if n.bl_idname == 'ShaderNodeMix']:
        nt.nodes.remove(n)
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])

    out_dir = os.path.join(SRC, "mixamo", name.lower())
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, name.lower() + ".fbx")
    bpy.ops.object.select_all(action='DESELECT')
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.export_scene.fbx(filepath=path, use_selection=True, object_types={'MESH'},
                             path_mode='COPY', embed_textures=True, mesh_smooth_type='FACE')
    return dict(name=name, verts=len(body.data.vertices), faces=len(body.data.polygons), fbx=path)


if __name__ == "__main__":
    names = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for n in names:
        print(prep(n))
