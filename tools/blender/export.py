# Run by tools/blender.mjs after assets-src/<name>.py: saves what that script built as one GLB.
# Exports the COL_Export collection if the script made one, else every mesh in the scene.
# Prints one line for the tool: QV_GLB {"triangles": …, "size_m": {"x", "y", "z"}} (y is up, as in three.js).
import json
import sys

import bpy
from mathutils import Vector

out = sys.argv[sys.argv.index("--") + 1]

if bpy.context.view_layer.objects.active and bpy.context.view_layer.objects.active.mode != "OBJECT":
    bpy.ops.object.mode_set(mode="OBJECT")

col = bpy.data.collections.get("COL_Export")
pool = col.all_objects if col else bpy.context.scene.objects
meshes = [o for o in pool if o.type == "MESH" and o.visible_get()]
if not meshes:
    print("QV_ERROR 내보낼 메시가 없어요. 스크립트가 메시를 만들었는지(또는 COL_Export에 넣었는지) 확인해 주세요.")
    sys.exit(1)

bpy.ops.object.select_all(action="DESELECT")
for o in meshes:
    o.select_set(True)
# Parents (an empty holding the parts) go along, so the hierarchy survives.
for o in list(meshes):
    p = o.parent
    while p:
        p.select_set(True)
        p = p.parent
bpy.context.view_layer.objects.active = meshes[0]

depsgraph = bpy.context.evaluated_depsgraph_get()
triangles = 0
lo = Vector((float("inf"),) * 3)
hi = Vector((float("-inf"),) * 3)
for o in meshes:
    ev = o.evaluated_get(depsgraph)
    mesh = ev.to_mesh()
    triangles += sum(len(p.vertices) - 2 for p in mesh.polygons)
    for v in mesh.vertices:
        w = o.matrix_world @ v.co
        lo = Vector(map(min, lo, w))
        hi = Vector(map(max, hi, w))
    ev.to_mesh_clear()

bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", use_selection=True, export_apply=True)

size = hi - lo
# Blender is Z-up; the GLB (and three.js) is Y-up.
print("QV_GLB " + json.dumps({"triangles": triangles, "objects": len(meshes), "size_m": {"x": round(size.x, 2), "y": round(size.z, 2), "z": round(size.y, 2)}}))
