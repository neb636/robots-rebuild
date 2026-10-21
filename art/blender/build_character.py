"""Build art/<id>.blend and public/models/<id>.glb for a Tripo + Mixamo character.

Run with Blender: `blender -b -P art/blender/build_character.py -- maya marcus` (no ids: all of
CHARACTERS). Each step is a function so it can also be run piecemeal over the Blender MCP.

Sources per character (art/source, see CHARACTERS):
  tripo        Tripo smart mesh with its original 4k base-color JPEG
  rigged       the same mesh auto-rigged by Mixamo (bind pose = Tripo pose)
  animations   Mixamo clips, "without skin" (rest pose = T-pose)

Maya and Marcus went through art/blender/prep_mixamo.py before upload; Theo predates it.

Why the retarget below exists: the clip files rest in a T-pose, the rigged file rests in the
mesh's bind pose (arms ~56 deg lower). Blender stores pose channels relative to each bone's
rest, so assigning a clip's action to the rig directly layers the clip on top of the wrong rest
(elbows pulled back, hands out). Instead every bone gets the constant correction
    C = rest_rig_rel^-1 @ rest_clip_rel
and basis_rig(t) = C @ basis_clip(t), which makes every bone's armature-space transform equal to
the clip as authored.

A character re-rigged after its clips were downloaded (Marcus) has slightly different bone lengths
from them. Rotations carry over as is; the hips' armature-space translation is scaled by the
rig/clip leg-length ratio, so the feet stay on the floor and the stride matches the legs.

Mixamo returns some characters in centimetres (an armature scaled 0.01: Maya and Marcus) and some
in metres (Theo). The rig's scale is applied on import so every GLB is in metres, and the clips'
hips translation is converted from whatever units the clip armature uses.
"""
import os
import sys

import bpy
from mathutils import Matrix, Quaternion, Vector

# THEO_REPO lets the script be exec'd over the Blender MCP, where __file__ is not set.
REPO = os.environ.get("THEO_REPO") or os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC = os.path.join(REPO, "art", "source")
CHARACTERS = {
    "theo": dict(name="Theo", tripo="cartoon man 3d model.glb", rigged="mixamo/theo-rigged.fbx",
                 animations="mixamo/animations", active="Idle"),
    "maya": dict(name="Maya", tripo="Maya.glb", rigged="mixamo/rigged/maya.fbx",
                 animations="mixamo/maya-animations", active="Idle"),
    "marcus": dict(name="Marcus", tripo="Marcus.glb", rigged="mixamo/rigged/marcus.fbx",
                   animations="mixamo/marcus-animations", active="Neutral Idle"),
}
LEGS = [f"mixamorig:{side}{part}" for side in ("Left", "Right") for part in ("UpLeg", "Leg", "Foot")]


def rel_rest(bone):
    """Bone rest matrix relative to its parent's rest (armature space for the root)."""
    if bone.parent:
        return bone.parent.matrix_local.inverted() @ bone.matrix_local
    return bone.matrix_local.copy()


def action_fcurves(action):
    out = []
    for layer in action.layers:
        for strip in layer.strips:
            for cb in strip.channelbags:
                out += list(cb.fcurves)
    return out


def retarget_clip(rig, fbx_path, clip):
    """Import one "without skin" Mixamo FBX and bake it onto `rig` as action `clip`."""
    before_o, before_a = set(bpy.data.objects), set(bpy.data.actions)
    bpy.ops.import_scene.fbx(filepath=fbx_path, automatic_bone_orientation=False, ignore_leaf_bones=True)
    new_objs = [o for o in bpy.data.objects if o not in before_o]
    src_act = next(a for a in bpy.data.actions if a not in before_a)
    src = next(o for o in new_objs if o.type == 'ARMATURE')
    assert {b.name for b in src.data.bones} == {b.name for b in rig.data.bones}, fbx_path

    chans = {}
    for fc in action_fcurves(src_act):
        bone = fc.data_path.split('"')[1]
        prop = fc.data_path.rsplit('.', 1)[1]
        chans.setdefault(bone, {}).setdefault(prop, {})[fc.array_index] = fc
    f0, f1 = (int(round(x)) for x in src_act.frame_range)
    frames = range(f0, f1 + 1)

    old = bpy.data.actions.get(clip)
    if old:
        bpy.data.actions.remove(old)
    act = bpy.data.actions.new(clip)
    act.use_fake_user = True
    rig.animation_data.action = act

    rig_unit, src_unit = rig.matrix_world.to_scale()[0], src.matrix_world.to_scale()[0]
    leg_ratio = (rig_unit * sum(rig.data.bones[n].length for n in LEGS)) / \
                (src_unit * sum(src.data.bones[n].length for n in LEGS))
    unit = src_unit / rig_unit   # clip armature units -> rig armature units
    stats = dict(frames=[f0, f1], child_loc_max=0.0, scale_dev=0.0, leg_ratio=round(leg_ratio, 4))
    for b in rig.data.bones:
        R, S_ = rel_rest(b), rel_rest(src.data.bones[b.name])
        S_.translation *= unit
        C = R.inverted() @ S_
        ch = chans[b.name]
        locs, quats = [], []
        prev = None
        for f in frames:
            l = unit * Vector([ch['location'][i].evaluate(f) for i in range(3)]) if 'location' in ch else Vector()
            q = Quaternion([ch['rotation_quaternion'][i].evaluate(f) for i in range(4)]) if 'rotation_quaternion' in ch else Quaternion()
            s = Vector([ch['scale'][i].evaluate(f) for i in range(3)]) if 'scale' in ch else Vector((1, 1, 1))
            if b.parent is None:
                M = S_ @ Matrix.LocRotScale(l, q.normalized(), s)   # armature space, as authored
                M.translation *= leg_ratio
                L, Q, S = (R.inverted() @ M).decompose()
            else:
                L, Q, S = (C @ Matrix.LocRotScale(l, q.normalized(), s)).decompose()
            if prev is not None:
                Q.make_compatible(prev)
            prev = Q
            locs.append(L)
            quats.append(Q)
            stats['scale_dev'] = max(stats['scale_dev'], max(abs(x - 1) for x in S))
        channels = [('rotation_quaternion', 4, quats)]
        if b.parent is None:
            channels.append(('location', 3, locs))
        else:
            # Mixamo keys child translations too; after C they must be ~0 (same bone lengths).
            stats['child_loc_max'] = max(stats['child_loc_max'], max(v.length for v in locs))
        rig.pose.bones[b.name].rotation_mode = 'QUATERNION'
        for prop, n, vals in channels:
            path = f'pose.bones["{b.name}"].{prop}'
            for i in range(n):
                fc = act.fcurve_ensure_for_datablock(rig, path, index=i, group_name=b.name)
                fc.keyframe_points.add(len(vals))
                co = []
                for f, v in zip(frames, vals):
                    co += [f, v[i]]
                fc.keyframe_points.foreach_set('co', co)
                for kp in fc.keyframe_points:
                    kp.interpolation = 'LINEAR'
                fc.update()

    hips = chans['mixamorig:Hips']['location']
    stats['hips_start_to_end'] = [round(hips[i].evaluate(f1) - hips[i].evaluate(f0), 4) for i in range(3)]
    for o in new_objs:
        bpy.data.objects.remove(o, do_unlink=True)
    bpy.data.actions.remove(src_act)
    return stats


def retarget_all(rig, ch):
    if rig.animation_data is None:
        rig.animation_data_create()
    anim_dir = os.path.join(SRC, ch["animations"])
    report = {}
    for fn in sorted(os.listdir(anim_dir)):
        if fn.endswith(".fbx"):
            report[fn[:-4]] = retarget_clip(rig, os.path.join(anim_dir, fn), fn[:-4])
    return report


def collection(name, parent=None):
    parent = parent or bpy.context.scene.collection
    c = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    if c.name not in parent.children:
        parent.children.link(c)
    return c


def move_to(obj, coll):
    for uc in list(obj.users_collection):
        uc.objects.unlink(obj)
    coll.objects.link(obj)


def import_rig(ch):
    """The rigged FBX -> armature "Theo" + mesh "Theo_Body" in collection "Theo" (per name)."""
    name = ch["name"]
    before = set(bpy.data.objects)
    bpy.ops.import_scene.fbx(filepath=os.path.join(SRC, ch["rigged"]), automatic_bone_orientation=False,
                             ignore_leaf_bones=True)
    new = [o for o in bpy.data.objects if o not in before]
    rig = next(o for o in new if o.type == 'ARMATURE')
    body = next(o for o in new if o.type == 'MESH')
    body.name = body.data.name = f"{name}_Body"
    rig.name = name
    rig.data.name = f"{name}_Rig"
    c = collection(name)
    for o in new:
        move_to(o, c)
    if abs(rig.scale[0] - 1) > 1e-6:
        for o in bpy.context.selected_objects:
            o.select_set(False)
        rig.select_set(True)
        body.select_set(True)
        bpy.context.view_layer.objects.active = rig
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    # Mixamo's own T-pose action ("Armature|mixamo.com|Layer0") is not a clip.
    if rig.animation_data and rig.animation_data.action:
        bpy.data.actions.remove(rig.animation_data.action)
    return rig, body


def import_reference_and_texture(ch):
    """The static Tripo mesh (hidden, for comparison) and its original, untouched 4k JPEG.

    Mixamo re-encodes the texture it embeds in the rigged FBX (1.4 MB vs the original 3.9 MB at
    the same 4096^2 for Theo), so the base color comes from the Tripo GLB instead.
    """
    before_o, before_i = set(bpy.data.objects), set(bpy.data.images)
    bpy.ops.import_scene.gltf(filepath=os.path.join(SRC, ch["tripo"]))
    c = collection("Reference")
    c.hide_render = True
    for o in [o for o in bpy.data.objects if o not in before_o]:
        move_to(o, c)
        if o.type == 'MESH':
            o.name = o.data.name = "Tripo_Reference"
    bpy.context.view_layer.layer_collection.children["Reference"].hide_viewport = True
    img = next(i for i in bpy.data.images if i not in before_i and i.size[0] == 4096)
    img.name = f"{ch['name']}_BaseColor_4k"
    img.colorspace_settings.name = "sRGB"
    img.alpha_mode = 'NONE'
    if img.packed_file is None:
        img.pack()
    return img


def build_material(body, img, name):
    """Matte PBR: texture straight into base color (Tripo's 0.8 baseColorFactor and 0.5
    roughness darken it and add a plastic sheen), roughness 0.85, default F0 0.04 so the glTF
    export stays a plain MeshStandardMaterial (no KHR_materials_specular)."""
    mat = bpy.data.materials.get(f"{name}_Matte") or bpy.data.materials.new(f"{name}_Matte")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (400, 0)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (100, 0)
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.location = (-300, 0)
    tex.image = img
    tex.interpolation = 'Linear'
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = 0.85
    bsdf.inputs["Specular IOR Level"].default_value = 0.5
    bsdf.inputs["IOR"].default_value = 1.5
    # Single-sided like the Tripo source (exports doubleSided: false); renders change by <=5 px.
    mat.use_backface_culling = True
    body.data.materials.clear()
    body.data.materials.append(mat)
    return mat


def clean_weights(body):
    """Limit to 4 influences (what glTF / three.js skin with) and normalise, in Blender, so the
    renders here are exactly what ships. Measured cost over Idle/Walking/Running: worst vertex
    3.7 mm on a 1 m character, 28 verts > 1 mm. Mixamo's weights are otherwise kept as is:
    smoothing the shoulder zone was tried and rejected (the arm is fused to the torso side in
    the arms-down bind pose, so smoothing bled Hips weight into the armpit, up to 6 cm off)."""
    vl = bpy.context.view_layer
    for o in bpy.context.selected_objects:
        o.select_set(False)
    body.select_set(True)
    vl.objects.active = body
    bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=4)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)
    bpy.ops.object.vertex_group_clean(group_select_mode='ALL', limit=1e-4)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)


def stash_clips(rig, active="Idle"):
    """One muted NLA track per clip (the glTF exporter's NLA_TRACKS mode exports each track as an
    animation named after it); `active` stays assigned for viewport playback."""
    ad = rig.animation_data
    for t in list(ad.nla_tracks):
        ad.nla_tracks.remove(t)
    clips = sorted(a.name for a in bpy.data.actions if a.use_fake_user)
    for name in clips:
        act = bpy.data.actions[name]
        track = ad.nla_tracks.new()
        track.name = name
        strip = track.strips.new(name, int(act.frame_range[0]), act)
        strip.action_slot = act.slots[0]
        track.mute = True
    ad.action = bpy.data.actions[active]
    scene = bpy.context.scene
    scene.frame_start, scene.frame_end = (int(x) for x in bpy.data.actions[active].frame_range)
    return clips


def build_stage():
    """Neutral review stage: grey world, soft key + fill sun, Standard view transform (AgX, the
    Blender default, cuts mean luma ~22% and reads muddy next to the painted texture)."""
    import math
    scene = bpy.context.scene
    stage = collection("Stage")
    for o in list(stage.objects):
        bpy.data.objects.remove(o, do_unlink=True)
    w = scene.world or bpy.data.worlds.new("World")
    scene.world = w
    w.use_nodes = True
    bg = next(n for n in w.node_tree.nodes if n.type == 'BACKGROUND')
    bg.inputs["Color"].default_value = (0.22, 0.22, 0.22, 1)
    bg.inputs["Strength"].default_value = 1.0
    for name, energy, rot, angle in [("Key", 2.2, (50, 0, -35), 10), ("Fill", 0.6, (70, 0, 140), 30)]:
        d = bpy.data.lights.get(name) or bpy.data.lights.new(name, 'SUN')
        d.energy = energy
        d.angle = math.radians(angle)
        o = bpy.data.objects.new(name, d)
        stage.objects.link(o)
        o.rotation_euler = [math.radians(a) for a in rot]
    cd = bpy.data.cameras.get("Cam") or bpy.data.cameras.new("Cam")
    cd.lens = 70
    cam = bpy.data.objects.new("Cam", cd)
    stage.objects.link(cam)
    cam.location = (1.0, -2.6, 0.62)
    cam.rotation_euler = (Vector((0, 0, 0.5)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam
    vs = scene.view_settings
    vs.view_transform, vs.look, vs.exposure, vs.gamma = 'Standard', 'None', 0.0, 1.0
    r = scene.render
    r.engine = 'BLENDER_EEVEE'
    r.resolution_x, r.resolution_y, r.resolution_percentage = 480, 640, 100
    r.fps = 30
    scene.eevee.taa_render_samples = 32


def reset_file():
    """Empty the current file in place (read_homefile from a running script leaves the operator
    context without a window/view layer, which the FBX importer needs)."""
    if bpy.context.object and bpy.context.object.mode != 'OBJECT':
        bpy.ops.object.mode_set(mode='OBJECT')
    for coll in (bpy.data.objects, bpy.data.collections, bpy.data.actions, bpy.data.armatures,
                 bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.lights,
                 bpy.data.cameras):
        for block in list(coll):
            if not (coll is bpy.data.images and block.type in {'RENDER_RESULT', 'COMPOSITING'}):
                coll.remove(block)


def build(ch, save_path=None):
    reset_file()
    rig, body = import_rig(ch)
    img = import_reference_and_texture(ch)
    report = retarget_all(rig, ch)
    build_material(body, img, ch["name"])
    clean_weights(body)
    clips = stash_clips(rig, ch["active"])
    build_stage()
    bpy.ops.outliner.orphans_purge(do_recursive=True)
    if save_path:
        bpy.ops.wm.save_as_mainfile(filepath=save_path, compress=True)
    return dict(clips=clips, retarget=report)


def export_glb(ch, path, tex_size=4096, jpeg_quality=92):
    """Export the character's collection (armature + mesh + all clips) as a binary glTF.

    At 4096 the packed original JPEG is written through as is; smaller sizes export a resized
    copy, re-encoded as JPEG. Clips are exported one per NLA track, slid to start at t=0, so
    Blender frame f is three.js time (f - 1) / 30.
    """
    scene = bpy.context.scene
    vl = bpy.context.view_layer
    name = ch["name"]
    vl.active_layer_collection = vl.layer_collection.children[name]
    mat = bpy.data.materials[f"{name}_Matte"]
    tex = next(n for n in mat.node_tree.nodes if n.type == 'TEX_IMAGE')
    orig = tex.image
    tmp = None
    if tex_size != orig.size[0]:
        tmp = orig.copy()
        tmp.name = f"{name}_BaseColor_{tex_size // 1024}k"
        tmp.scale(tex_size, tex_size)
        tex.image = tmp
    rig = bpy.data.objects[name]
    active = rig.animation_data.action
    rig.animation_data.action = None   # export the rest pose as the bind pose, clips from NLA
    try:
        bpy.ops.export_scene.gltf(
            filepath=path, export_format='GLB', use_active_collection=True,
            export_yup=True, export_apply=False, export_normals=True,
            export_image_format='AUTO' if tmp is None else 'JPEG', export_jpeg_quality=jpeg_quality,
            export_skins=True, export_influence_nb=4, export_all_influences=False,
            export_animations=True, export_animation_mode='NLA_TRACKS', export_anim_slide_to_zero=True,
            export_force_sampling=True, export_optimize_animation_size=True,
            export_anim_single_armature=True, export_rest_position_armature=True,
        )
    finally:
        rig.animation_data.action = active
        tex.image = orig
        if tmp is not None:
            bpy.data.images.remove(tmp)
    return path


if __name__ == "__main__":
    ids = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else list(CHARACTERS)
    for cid in ids:
        ch = CHARACTERS[cid]
        report = build(ch, os.path.join(REPO, "art", f"{cid}.blend"))
        export_glb(ch, os.path.join(REPO, "public", "models", f"{cid}.glb"))
        print(cid, report)
