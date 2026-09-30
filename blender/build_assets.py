"""Kitchen Chaos procedural asset kit (Blender 2.91).

Run from the project dir:
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P blender/build_assets.py

Conventions: 1 unit = 1 tile, Z-up, front of every asset faces -Y (three.js +Z),
root origin at bottom center, counter tops at Z = 0.9.
"""
import bpy
import bmesh
import math
import os
import random
import sys
from mathutils import Matrix, Vector, Euler

sys.stdout.reconfigure(line_buffering=True)

PROJECT = "/Users/douglastaquary/Projects/kitchen-chaos"
GLB_PATH = os.path.join(PROJECT, "public", "assets", "kitchen.glb")
PREVIEW_DIR = os.path.join(PROJECT, "artifacts", "blender")

PI = math.pi
TOP = 0.9
FY = -0.41  # cabinet front face


# --------------------------------------------------------------------------- scene reset

def reset_scene():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras, bpy.data.lights, bpy.data.curves):
        for block in list(coll):
            coll.remove(block)


reset_scene()
SCENE = bpy.context.scene
COLL = SCENE.collection


# --------------------------------------------------------------------------- materials

def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


MATS = {}


def make_mat(name, hexcol, rough=0.7, metal=0.0):
    h = hexcol.lstrip("#")
    rgb = [srgb_to_linear(int(h[i:i + 2], 16) / 255.0) for i in (0, 2, 4)]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    bsdf.inputs["Specular"].default_value = 0.35
    m.diffuse_color = (*rgb, 1.0)
    m.roughness = rough
    m.metallic = min(metal, 0.25)
    MATS[name] = m
    return m


PALETTE = [
    ("wood", "#E8B77A", 0.7), ("wood_dark", "#D49A5B", 0.7), ("board", "#F2D3A2", 0.7),
    ("cabinet_teal", "#5CC8B4", 0.65), ("cabinet_teal_panel", "#4BB5A1", 0.65),
    ("cabinet_coral", "#F2796B", 0.65), ("cabinet_coral_panel", "#E3665A", 0.65),
    ("cabinet_cream", "#F4E9D2", 0.65), ("cabinet_cream_panel", "#E9D8B6", 0.65),
    ("stove_black", "#2E3440", 0.6), ("stove_top", "#1F232A", 0.5), ("stove_door", "#3E4656", 0.6),
    ("glass_dark", "#161A20", 0.25), ("burner", "#5A6270", 0.6),
    ("white", "#FAFAF7", 0.6), ("blade", "#DDE3EA", 0.4),
    ("lettuce", "#7CC957", 0.7), ("lettuce_light", "#B2E28A", 0.7),
    ("tomato", "#E8453C", 0.55), ("tomato_inner", "#F59080", 0.6), ("leaf_green", "#4FA83D", 0.7),
    ("bun", "#E9A857", 0.7), ("bun_inner", "#F7DDAA", 0.8), ("sesame", "#FFF4DC", 0.7),
    ("patty_raw", "#D9636B", 0.7), ("patty_cooked", "#7A4A2E", 0.75), ("patty_burnt", "#2B211C", 0.8),
    ("noodles", "#F3D27A", 0.7), ("soup_red", "#D8452F", 0.4), ("broth", "#E8A95B", 0.4),
    ("red", "#E0443C", 0.6), ("chalkboard", "#2F4A3A", 0.9), ("black_iron", "#2A2B30", 0.5),
    ("lid_grey", "#A9B2BC", 0.5), ("blush", "#F7A1B6", 0.8), ("eye_black", "#1E1E24", 0.3),
    ("purple", "#9B7BD8", 0.7), ("frog_green", "#74D26A", 0.7),
    ("jar_mint", "#9FE3CF", 0.5), ("jar_peach", "#FFC49B", 0.5), ("jar_yellow", "#FFE08A", 0.5),
    ("jar_pink", "#F7B2C8", 0.5),
]
for _n, _h, _r in PALETTE:
    make_mat(_n, _h, _r)
make_mat("steel", "#C9D1D9", 0.35, 0.8)


def M(name):
    return MATS[name]


# --------------------------------------------------------------------------- geometry helpers

def I4():
    return Matrix.Identity(4)


def TRS(loc=(0, 0, 0), rot=(0, 0, 0), scl=(1, 1, 1)):
    t = Matrix.Translation(Vector(loc))
    r = Euler(rot, "XYZ").to_matrix().to_4x4()
    s = Matrix.Diagonal(Vector((scl[0], scl[1], scl[2], 1.0)))
    return t @ r @ s


def _base(base):
    return base if base is not None else I4()


class Part:
    """One exported mesh object (child of an asset root), possibly multi-material."""

    def __init__(self, asset, name, bevel=0.0, loc=(0, 0, 0)):
        self.name = name
        self.bm = bmesh.new()
        self.mats = []
        self.bevel = bevel
        self.loc = loc
        self.uv_face = None
        asset.parts.append(self)

    def mi(self, mat):
        if mat not in self.mats:
            self.mats.append(mat)
        return self.mats.index(mat)

    def finish(self, root):
        me = bpy.data.meshes.new(self.name)
        self.bm.normal_update()
        self.bm.to_mesh(me)
        self.bm.free()
        for mt in self.mats:
            me.materials.append(mt)
        for poly in me.polygons:
            poly.use_smooth = True
        me.use_auto_smooth = True
        me.auto_smooth_angle = math.radians(40)
        ob = bpy.data.objects.new(self.name, me)
        COLL.objects.link(ob)
        ob.parent = root
        ob.location = self.loc
        if self.bevel > 0:
            md = ob.modifiers.new("Bevel", "BEVEL")
            md.width = self.bevel
            md.segments = 2
            md.limit_method = "ANGLE"
            md.angle_limit = math.radians(35)
            md.use_clamp_overlap = True
            md.harden_normals = True
        return ob


ASSETS = []
OBJ = {}


class Asset:
    def __init__(self, name):
        self.name = name
        self.parts = []
        ASSETS.append(self)

    def part(self, suffix="mesh", bevel=0.0, loc=(0, 0, 0), name=None):
        return Part(self, name or "%s_%s" % (self.name, suffix), bevel, loc)

    def build(self):
        root = bpy.data.objects.new(self.name, None)
        root.empty_display_size = 0.25
        COLL.objects.link(root)
        for p in self.parts:
            p.finish(root)
        OBJ[self.name] = root
        return root


def box(p, mt, c, size, rot=(0, 0, 0), base=None):
    mat = _base(base) @ TRS(c, rot, size)
    res = bmesh.ops.create_cube(p.bm, size=1.0, matrix=mat)
    idx = p.mi(mt)
    faces = set()
    for v in res["verts"]:
        faces.update(v.link_faces)
    for f in faces:
        f.material_index = idx


def boxmm(p, mt, a, b, rot=(0, 0, 0), base=None):
    c = [(a[i] + b[i]) / 2 for i in range(3)]
    s = [abs(b[i] - a[i]) for i in range(3)]
    box(p, mt, c, s, rot, base)


def _face(p, verts, idx):
    vs = []
    for v in verts:
        if not vs or vs[-1] is not v:
            vs.append(v)
    if len(vs) > 1 and vs[0] is vs[-1]:
        vs.pop()
    if len(vs) < 3:
        return None
    f = p.bm.faces.new(vs)
    f.material_index = idx
    return f


def lathe(p, mt, prof, segs=16, loc=(0, 0, 0), rot=(0, 0, 0), scl=(1, 1, 1), base=None, loop=False):
    """Revolve an (r, z) profile around Z. Walk the profile bottom-center -> outward -> up ->
    top-center (counter-clockwise in the r/z plane) for outward normals."""
    mat = _base(base) @ TRS(loc, rot, scl)
    idx = p.mi(mt)
    rings = []
    for r, z in prof:
        if r < 1e-6:
            v = p.bm.verts.new(mat @ Vector((0, 0, z)))
            rings.append([v] * segs)
        else:
            ring = []
            for j in range(segs):
                a = 2 * PI * j / segs
                ring.append(p.bm.verts.new(mat @ Vector((r * math.cos(a), r * math.sin(a), z))))
            rings.append(ring)
    n = len(rings)
    pairs = [(i, i + 1) for i in range(n - 1)]
    if loop:
        pairs.append((n - 1, 0))
    for a, b in pairs:
        A, B = rings[a], rings[b]
        for j in range(segs):
            k = (j + 1) % segs
            _face(p, [A[j], A[k], B[k], B[j]], idx)


def cyl(p, mt, c, r, h, segs=16, rot=(0, 0, 0), base=None):
    lathe(p, mt, [(0, 0), (r, 0), (r, h), (0, h)], segs, loc=c, rot=rot, base=base)


def sphere(p, mt, c, radii, rot=(0, 0, 0), segs=12, rings=8, base=None):
    prof = [(math.sin(PI * i / rings), -math.cos(PI * i / rings)) for i in range(rings + 1)]
    if isinstance(radii, (int, float)):
        radii = (radii, radii, radii)
    lathe(p, mt, prof, segs, loc=c, rot=rot, scl=radii, base=base)


def torus(p, mt, c, R, rc, segs=24, csegs=8, rot=(0, 0, 0), scl=(1, 1, 1), base=None):
    prof = [(R + rc * math.cos(2 * PI * i / csegs), rc * math.sin(2 * PI * i / csegs)) for i in range(csegs)]
    lathe(p, mt, prof, segs, loc=c, rot=rot, scl=scl, base=base, loop=True)


def tube(p, mt, pts, r, segs=8, caps=True, base=None):
    mat = _base(base)
    idx = p.mi(mt)
    pts = [Vector(q) for q in pts]
    n = len(pts)
    radii = r if isinstance(r, (list, tuple)) else [r] * n
    tans = [(pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized() for i in range(n)]
    up = Vector((0, 0, 1)) if abs(tans[0].z) < 0.9 else Vector((1, 0, 0))
    N = tans[0].cross(up).normalized()
    rings = []
    for i in range(n):
        T = tans[i]
        N = (N - T * N.dot(T)).normalized()
        B = T.cross(N)
        ring = []
        for j in range(segs):
            a = 2 * PI * j / segs
            ring.append(p.bm.verts.new(mat @ (pts[i] + radii[i] * (math.cos(a) * N + math.sin(a) * B))))
        rings.append(ring)
    for i in range(n - 1):
        A, B = rings[i], rings[i + 1]
        for j in range(segs):
            k = (j + 1) % segs
            _face(p, [A[j], A[k], B[k], B[j]], idx)
    if caps:
        _face(p, list(reversed(rings[0])), idx)
        _face(p, rings[-1], idx)


def prism(p, mt, poly, z0, z1, base=None):
    """Extrude a CCW (seen from +Z) 2D polygon between z0 and z1."""
    mat = _base(base)
    idx = p.mi(mt)
    bot = [p.bm.verts.new(mat @ Vector((x, y, z0))) for x, y in poly]
    top = [p.bm.verts.new(mat @ Vector((x, y, z1))) for x, y in poly]
    n = len(poly)
    _face(p, list(reversed(bot)), idx)
    _face(p, top, idx)
    for i in range(n):
        k = (i + 1) % n
        _face(p, [bot[i], bot[k], top[k], top[i]], idx)


def frame_boxes(p, mt, z0, z1, outer, inner):
    """Four boxes forming a rectangular ring. outer/inner = (x0, x1, y0, y1)."""
    ox0, ox1, oy0, oy1 = outer
    ix0, ix1, iy0, iy1 = inner
    boxmm(p, mt, (ox0, oy0, z0), (ox1, iy0, z1))
    boxmm(p, mt, (ox0, iy1, z0), (ox1, oy1, z1))
    boxmm(p, mt, (ox0, iy0, z0), (ix0, iy1, z1))
    boxmm(p, mt, (ix1, iy0, z0), (ox1, iy1, z1))


def knob(p, mt, x, z, y_face=FY, s=0.85):
    prof = [(0, 0), (0.022, 0), (0.022, 0.016), (0.036, 0.024), (0.039, 0.038), (0.031, 0.05), (0, 0.053)]
    prof = [(r * s, h * s) for r, h in prof]
    lathe(p, mt, prof, 14, loc=(x, y_face, z), rot=(PI / 2, 0, 0))


def front_panel(p, mt, x0, x1, z0, z1, depth=0.02):
    boxmm(p, mt, (x0, FY - depth, z0), (x1, FY + 0.01, z1))


# --------------------------------------------------------------------------- food / prop building blocks

def patty(p, mt, base=None, grill=False, segs=20):
    prof = [(0, 0), (0.12, 0), (0.13, 0.012), (0.132, 0.034), (0.122, 0.047), (0.07, 0.052), (0, 0.052)]
    lathe(p, mt, prof, segs, base=base)
    if grill:
        for x in (-0.05, 0.0, 0.05):
            boxmm(p, M("patty_burnt"), (x - 0.008, -0.085, 0.046), (x + 0.008, 0.085, 0.055), base=base)


def bun_seeds(p, base, rx, z0, hz, n=7, seed=3):
    rng = random.Random(seed)
    for i in range(n):
        ang = 2 * PI * i / n + rng.uniform(-0.2, 0.2)
        el = rng.uniform(0.5, 1.15) if i else 1.45
        r = rx * math.cos(el)
        z = z0 + hz * math.sin(el)
        nrm = Vector((math.cos(el) * math.cos(ang), math.cos(el) * math.sin(ang), math.sin(el))).normalized()
        c = Vector((r * math.cos(ang), r * math.sin(ang), z)) + nrm * 0.002
        sphere(p, M("sesame"), c, (0.017, 0.009, 0.006), rot=(0, PI / 2 - el, ang + rng.uniform(-0.5, 0.5)),
               segs=6, rings=4, base=base)


def bun_whole(p, base=None, seeds=True, segs=20):
    prof = [(0, 0), (0.138, 0), (0.15, 0.014), (0.153, 0.038)]
    for i in range(1, 8):
        a = i / 7 * PI / 2
        prof.append((0.153 * math.cos(a) if i < 7 else 0, 0.038 + 0.092 * math.sin(a)))
    lathe(p, M("bun"), prof, segs, base=base)
    lathe(p, M("bun_inner"), [(0, 0.028), (0.1535, 0.028), (0.1535, 0.036), (0, 0.036)], segs, base=base)
    if seeds:
        bun_seeds(p, base, 0.153, 0.038, 0.092, n=seeds if isinstance(seeds, int) and seeds > 1 else 7)


def bun_top(p, base=None):
    prof = [(0, 0), (0.145, 0), (0.153, 0.012), (0.155, 0.028)]
    for i in range(1, 8):
        a = i / 7 * PI / 2
        prof.append((0.155 * math.cos(a) if i < 7 else 0, 0.028 + 0.072 * math.sin(a)))
    lathe(p, M("bun"), prof, 20, base=base)
    bun_seeds(p, base, 0.155, 0.028, 0.072)


def bun_bottom(p, base=None):
    prof = [(0, 0), (0.138, 0), (0.15, 0.016), (0.152, 0.042), (0.14, 0.055), (0, 0.055)]
    lathe(p, M("bun"), prof, 20, base=base)
    lathe(p, M("bun_inner"), [(0, 0.053), (0.136, 0.053), (0.136, 0.06), (0, 0.06)], 20, base=base)


def lettuce_head(p, base=None, R=0.15, lod=1):
    b = _base(base)
    sphere(p, M("lettuce_light"), (0, 0, R * 0.82), (R * 0.78, R * 0.78, R * 0.74),
           segs=14 if lod else 10, rings=9 if lod else 6, base=b)
    n = 6 if lod else 5
    for i in range(n):
        a = 2 * PI * i / n
        c = (R * 0.46 * math.cos(a), R * 0.46 * math.sin(a), R * 0.74)
        sphere(p, M("lettuce"), c, (R * 0.62, R * 0.4, R * 0.72), rot=(-0.28, 0, a - PI / 2),
               segs=10 if lod else 8, rings=7 if lod else 5, base=b)


def lettuce_chopped(p, base=None):
    rng = random.Random(11)
    pieces = [(-0.07, -0.03), (0.06, -0.05), (0.0, 0.07), (-0.05, 0.06), (0.08, 0.05), (0.0, -0.01), (-0.02, -0.08)]
    for i, (x, y) in enumerate(pieces):
        z = 0.017 + (0.018 if i >= 5 else 0.0) + rng.uniform(0, 0.006)
        mt = M("lettuce_light") if i % 2 else M("lettuce")
        sphere(p, mt, (x, y, z), (0.075, 0.05, 0.013), rot=(rng.uniform(-0.25, 0.25), rng.uniform(-0.25, 0.25),
                                                          rng.uniform(0, PI)), segs=10, rings=5, base=base)


def tomato(p, base=None, R=0.13, lod=1):
    b = _base(base)
    h = R * 0.85
    sphere(p, M("tomato"), (0, 0, h), (R, R, h), segs=16 if lod else 12, rings=10 if lod else 7, base=b)
    top = 2 * h
    for i in range(5):
        a = 2 * PI * i / 5
        c = (R * 0.22 * math.cos(a), R * 0.22 * math.sin(a), top - R * 0.02)
        sphere(p, M("leaf_green"), c, (R * 0.3, R * 0.11, R * 0.06), rot=(0, -0.2, a), segs=6, rings=4, base=b)
    cyl(p, M("leaf_green"), (0, 0, top - R * 0.05), R * 0.09, R * 0.2, segs=8, base=b)


def tomato_slice(p, base=None):
    lathe(p, M("tomato"), [(0, 0), (0.074, 0), (0.08, 0.012), (0.074, 0.024), (0, 0.024)], 18, base=base)
    lathe(p, M("tomato_inner"), [(0, 0.022), (0.064, 0.022), (0.064, 0.027), (0, 0.027)], 18, base=base)
    for i in range(4):
        a = 2 * PI * i / 4 + 0.4
        sphere(p, M("sesame"), (0.03 * math.cos(a), 0.03 * math.sin(a), 0.027), (0.011, 0.007, 0.003),
               rot=(0, 0, a), segs=6, rings=3, base=base)


def noodle_bundle(p, base=None, L=0.27):
    offs = [(0, 0)] + [(0.031 * math.cos(2 * PI * i / 6 + 0.3), 0.031 * math.sin(2 * PI * i / 6 + 0.3)) for i in range(6)]
    for i, (x, y) in enumerate(offs):
        l = L * (1.0 - 0.04 * (i % 3))
        tube(p, M("noodles"), [(x, y, 0), (x, y, l)], 0.017, segs=6, base=base)
    torus(p, M("red"), (0, 0, L * 0.5), 0.05, 0.013, segs=16, csegs=6, base=base)


def bowl(p, base=None, segs=24):
    prof = [(0, 0), (0.08, 0), (0.086, 0.014), (0.13, 0.04), (0.158, 0.08), (0.166, 0.12),
            (0.152, 0.123), (0.145, 0.09), (0.12, 0.052), (0.07, 0.032), (0, 0.03)]
    lathe(p, M("white"), prof, segs, base=base)


def pan_geo(p, base=None):
    prof = [(0, 0), (0.22, 0), (0.25, 0.01), (0.28, 0.068), (0.266, 0.074), (0.24, 0.036), (0.22, 0.02), (0, 0.02)]
    lathe(p, M("black_iron"), prof, 28, base=base)
    tube(p, M("black_iron"), [(0.25, 0, 0.05), (0.31, 0, 0.062), (0.36, 0, 0.072)], 0.022, segs=8, base=base)
    tube(p, M("wood_dark"), [(0.355, 0, 0.071), (0.45, 0, 0.083), (0.54, 0, 0.095)], [0.027, 0.029, 0.027],
         segs=10, base=base)


def egg_profile(H, R, k=0.15, pw=0.75, n=20):
    pts = []
    for i in range(n + 1):
        t = PI * i / n
        s = math.sin(t)
        s = 0.0 if s < 1e-6 else s ** pw
        pts.append([s * (1 + k * math.cos(t)), H * (1 - math.cos(t)) / 2])
    mx = max(q[0] for q in pts)
    return [(q[0] / mx * R, q[1]) for q in pts]


def r_at(prof, z):
    for (r0, z0), (r1, z1) in zip(prof, prof[1:]):
        if z0 <= z <= z1:
            t = 0 if z1 == z0 else (z - z0) / (z1 - z0)
            return r0 + (r1 - r0) * t
    return 0.0


def surf(prof, x, z, off=0.0):
    r = r_at(prof, z)
    y = -math.sqrt(max(r * r - x * x, 1e-6))
    n = Vector((x, y, 0)).normalized()
    return Vector((x, y, z)) + n * off, n


def face_features(p, prof, eye_z, eye_dx, blush_z, blush_dx, mouth_z, mouth_w, eyes=True):
    if eyes:
        for sx in (-1, 1):
            c, n = surf(prof, sx * eye_dx, eye_z, 0.006)
            rz = math.atan2(-n.x, n.y)
            sphere(p, M("eye_black"), c, (0.04, 0.022, 0.058), rot=(0.12, 0, rz), segs=12, rings=8)
            hl = c + n * 0.018 + Vector((0, 0, 0.02)) + Vector((-n.y, n.x, 0)) * 0.012 * sx
            sphere(p, M("white"), hl, 0.012, segs=8, rings=5)
    for sx in (-1, 1):
        c, n = surf(prof, sx * blush_dx, blush_z, 0.002)
        sphere(p, M("blush"), c, (0.05, 0.016, 0.03), rot=(0, 0, math.atan2(-n.x, n.y)), segs=10, rings=6)
    pts = []
    for i in range(9):
        a = -1.0 + 2.0 * i / 8
        x = mouth_w * math.sin(a)
        z = mouth_z - 0.018 * math.cos(a * 1.4)
        c, _ = surf(prof, x, z, 0.004)
        pts.append(c)
    tube(p, M("eye_black"), pts, 0.008, segs=6)


# --------------------------------------------------------------------------- stations

def counter(name, body, panel, knob_mat, style):
    a = Asset(name)
    b = a.part("body", bevel=0.02)
    d = a.part("details")
    boxmm(b, M(body), (-0.46, FY, 0), (0.46, 0.46, 0.8))
    countertop(b)
    if style == "doors":
        front_panel(b, M(panel), -0.42, -0.012, 0.07, 0.73)
        front_panel(b, M(panel), 0.012, 0.42, 0.07, 0.73)
        knob(d, M(knob_mat), -0.07, 0.62, FY - 0.02)
        knob(d, M(knob_mat), 0.07, 0.62, FY - 0.02)
    elif style == "drawers":
        for z0, z1 in ((0.06, 0.29), (0.31, 0.53), (0.55, 0.76)):
            front_panel(b, M(panel), -0.42, 0.42, z0, z1)
            knob(d, M(knob_mat), -0.16, (z0 + z1) / 2, FY - 0.02)
            knob(d, M(knob_mat), 0.16, (z0 + z1) / 2, FY - 0.02)
    else:
        front_panel(b, M(panel), -0.42, 0.42, 0.58, 0.76)
        front_panel(b, M(panel), -0.42, 0.42, 0.06, 0.56)
        knob(d, M(knob_mat), 0.0, 0.67, FY - 0.02)
        torus(d, M(knob_mat), (0, FY - 0.035, 0.46), 0.045, 0.011, segs=20, csegs=6, rot=(PI / 2, 0, 0))
        knob(d, M(knob_mat), 0.0, 0.5, FY - 0.02, s=0.6)
    return a


def countertop(p, mt="wood"):
    boxmm(p, M(mt), (-0.49, -0.49, 0.8), (-0.004, 0.49, TOP))
    boxmm(p, M(mt), (0.004, -0.49, 0.8), (0.49, 0.49, TOP))
    boxmm(p, M("wood_dark"), (-0.02, -0.47, 0.8), (0.02, 0.47, 0.885))


def build_stove():
    a = Asset("stove")
    b = a.part("body", bevel=0.02)
    d = a.part("details")
    boxmm(b, M("stove_black"), (-0.46, FY, 0), (0.46, 0.46, 0.84))
    boxmm(b, M("stove_top"), (-0.49, -0.49, 0.84), (0.49, 0.49, TOP))
    front_panel(b, M("stove_door"), -0.4, 0.4, 0.07, 0.64, depth=0.025)
    boxmm(b, M("glass_dark"), (-0.28, FY - 0.036, 0.19), (0.28, FY, 0.5))
    torus(d, M("burner"), (0, 0, TOP), 0.2, 0.016, segs=36, csegs=6, scl=(1, 1, 0.55))
    torus(d, M("burner"), (0, 0, TOP), 0.11, 0.012, segs=28, csegs=6, scl=(1, 1, 0.55))
    cyl(d, M("burner"), (0, 0, TOP - 0.004), 0.045, 0.01, segs=16)
    for x in (-0.25, 0.25):
        knob(d, M("white"), x, 0.75, FY, s=1.1)
    tube(d, M("white"), [(-0.3, FY - 0.062, 0.58), (0.3, FY - 0.062, 0.58)], 0.019, segs=10)
    for x in (-0.26, 0.26):
        tube(d, M("white"), [(x, FY - 0.02, 0.58), (x, FY - 0.062, 0.58)], 0.014, segs=8)
    return a


def build_sink():
    a = Asset("sink")
    b = a.part("body", bevel=0.02)
    s = a.part("basin", bevel=0.008)
    d = a.part("details")
    boxmm(b, M("cabinet_cream"), (-0.46, FY, 0), (0.46, 0.46, 0.6))
    frame_boxes(b, M("cabinet_cream"), 0.6, 0.8, (-0.46, 0.46, FY, 0.46), (-0.32, 0.32, -0.26, 0.22))
    frame_boxes(b, M("wood"), 0.8, TOP, (-0.49, 0.49, -0.49, 0.49), (-0.3, 0.3, -0.24, 0.2))
    front_panel(b, M("cabinet_cream_panel"), -0.42, -0.012, 0.06, 0.56)
    front_panel(b, M("cabinet_cream_panel"), 0.012, 0.42, 0.06, 0.56)
    knob(d, M("wood_dark"), -0.07, 0.48, FY - 0.02)
    knob(d, M("wood_dark"), 0.07, 0.48, FY - 0.02)
    frame_boxes(s, M("steel"), 0.62, TOP, (-0.32, 0.32, -0.26, 0.22), (-0.3, 0.3, -0.24, 0.2))
    boxmm(s, M("steel"), (-0.32, -0.26, 0.6), (0.32, 0.22, 0.625))
    cyl(d, M("burner"), (0, -0.02, 0.624), 0.035, 0.004, segs=16)
    cyl(d, M("steel"), (0, 0.36, TOP), 0.055, 0.03, segs=16)
    tube(d, M("steel"), [(0, 0.36, 0.91), (0, 0.36, 1.1), (0, 0.345, 1.16), (0, 0.3, 1.19), (0, 0.24, 1.185),
                         (0, 0.18, 1.15), (0, 0.16, 1.09)], 0.026, segs=12)
    for x in (-0.13, 0.13):
        cyl(d, M("steel"), (x, 0.36, TOP), 0.028, 0.05, segs=12)
        sphere(d, M("white"), (x, 0.36, 0.965), (0.04, 0.04, 0.03), segs=12, rings=6)
    return a


def build_serve_window():
    a = Asset("serve_window")
    b = a.part("body", bevel=0.02)
    aw = a.part("awning", bevel=0.006)
    d = a.part("details")
    boxmm(b, M("wood_dark"), (-0.46, FY, 0), (0.46, 0.46, 0.8))
    for i, x0 in enumerate((-0.42, -0.14, 0.14)):
        front_panel(b, M("wood"), x0 + 0.006, x0 + 0.274, 0.06, 0.76)
    frame_boxes(b, M("wood"), 0.8, TOP, (-0.49, 0.49, -0.49, 0.49), (-0.4, 0.4, -0.4, 0.3))
    boxmm(b, M("stove_door"), (-0.4, -0.4, 0.8), (0.4, 0.3, TOP - 0.004))
    for ya in (-0.03, 0.2):
        for sx in (-1, 1):
            cx, cy = sx * 0.075, ya - 0.075
            boxmm(d, M("white"), (cx - 0.11, cy - 0.024, TOP - 0.014), (cx + 0.11, cy + 0.024, TOP),
                  base=TRS((cx, cy, 0), (0, 0, -sx * PI / 4)) @ TRS((-cx, -cy, 0)))
    for x in (-0.42, 0.42):
        tube(aw, M("white"), [(x, 0.42, TOP), (x, 0.42, 1.84)], 0.026, segs=10)
    yb, zb, yf, zf = 0.47, 1.86, 0.02, 1.62
    L = math.hypot(yb - yf, zb - zf)
    ang = math.atan2(zb - zf, yb - yf)
    cy, cz = (yb + yf) / 2, (zb + zf) / 2
    n = 6
    w = 0.97 / n
    for i in range(n):
        x = -0.485 + w * (i + 0.5)
        mt = M("red") if i % 2 == 0 else M("white")
        box(aw, mt, (x, cy, cz), (w, L, 0.03), rot=(ang, 0, 0))
        lathe(aw, mt, [(0, 0), (w / 2, 0), (w / 2, 0.026), (0, 0.026)], 16, loc=(x, yf + 0.012, zf - 0.004),
              rot=(PI / 2, 0, 0))
    tube(aw, M("white"), [(-0.485, yb, zb), (0.485, yb, zb)], 0.022, segs=10)
    return a


def build_crate_station():
    a = Asset("crate_station")
    b = a.part("crate", bevel=0.012)
    for x0, x1 in ((-0.49, -0.405), (0.405, 0.49)):
        for y0, y1 in ((-0.49, -0.405), (0.405, 0.49)):
            boxmm(b, M("wood_dark"), (x0, y0, 0), (x1, y1, TOP))
    slats = ((0.03, 0.3), (0.32, 0.59), (0.61, TOP))
    for z0, z1 in slats:
        boxmm(b, M("wood"), (-0.41, -0.48, z0), (0.41, -0.43, z1))
        boxmm(b, M("wood"), (-0.41, 0.43, z0), (0.41, 0.48, z1))
        boxmm(b, M("wood"), (-0.48, -0.41, z0), (-0.43, 0.41, z1))
        boxmm(b, M("wood"), (0.43, -0.41, z0), (0.48, 0.41, z1))
    boxmm(b, M("wood_dark"), (-0.43, -0.43, 0), (0.43, 0.43, 0.74))
    boxmm(b, M("wood"), (-0.44, -0.44, 0.74), (0.44, 0.44, 0.78))
    boxmm(b, M("cabinet_cream"), (-0.17, -0.49, 0.38), (0.17, -0.46, 0.53))
    return a


def build_trash():
    a = Asset("trash")
    p = a.part("mesh")
    lathe(p, M("cabinet_coral"), [(0, 0), (0.32, 0), (0.335, 0.02), (0.37, 0.8), (0, 0.8)], 32)
    lathe(p, M("cabinet_coral_panel"), [(0.33, 0.05), (0.347, 0.05), (0.35, 0.12), (0.334, 0.12)], 32, loop=True)
    lathe(p, M("lid_grey"), [(0, 0.785), (0.385, 0.785), (0.39, 0.83), (0.365, 0.86), (0.26, 0.895), (0, 0.9)], 32)
    tube(p, M("stove_black"), [(-0.09, 0, 0.88), (-0.075, 0, 0.94), (-0.04, 0, 0.955), (0.04, 0, 0.955),
                               (0.075, 0, 0.94), (0.09, 0, 0.88)], 0.018, segs=8)
    boxmm(p, M("lid_grey"), (-0.08, -0.43, 0.015), (0.08, -0.32, 0.06))
    return a


# --------------------------------------------------------------------------- heaps

def mound(p, fn, ring_n, ring_r, center, top_n, top_r, top_z, seed, tilt=0.2):
    rng = random.Random(seed)
    pos = []
    if center:
        pos.append((0.0, 0.0, 0.012, 0.0))
    for i in range(ring_n):
        a = 2 * PI * i / ring_n + rng.uniform(-0.12, 0.12)
        rr = ring_r + rng.uniform(-0.015, 0.015)
        pos.append((rr * math.cos(a), rr * math.sin(a), 0.012, tilt * 0.5))
    for i in range(top_n):
        a = 2 * PI * i / top_n + 0.6
        pos.append((top_r * math.cos(a), top_r * math.sin(a), top_z, tilt))
    for x, y, z, t in pos:
        fn(p, TRS((x, y, z), (rng.uniform(-t, t), rng.uniform(-t, t), rng.uniform(0, 2 * PI))))


def build_heaps():
    a = Asset("heap_lettuce")
    mound(a.part("mesh"), lambda p, b: lettuce_head(p, b, 0.125, lod=0), 6, 0.25, True, 2, 0.1, 0.085, 1)
    a = Asset("heap_tomato")
    mound(a.part("mesh"), lambda p, b: tomato(p, b, 0.1, lod=0), 7, 0.26, True, 3, 0.12, 0.1, 2)
    a = Asset("heap_bun")
    mound(a.part("mesh"), lambda p, b: bun_whole(p, b @ Matrix.Scale(0.85, 4), seeds=4, segs=16),
          6, 0.25, True, 2, 0.09, 0.085, 3)
    a = Asset("heap_meat")
    p = a.part("mesh")
    rng = random.Random(4)
    stacks = [(-0.16, -0.16, 4), (0.16, -0.16, 4), (-0.16, 0.16, 4), (0.16, 0.16, 4), (0.0, 0.0, 5)]
    for x, y, cnt in stacks:
        for k in range(cnt):
            patty(p, M("patty_raw"), TRS((x + rng.uniform(-0.012, 0.012), y + rng.uniform(-0.012, 0.012),
                                          0.006 + k * 0.052), (rng.uniform(-0.04, 0.04), rng.uniform(-0.04, 0.04), 0)),
                  segs=14)
    a = Asset("heap_noodles")
    p = a.part("mesh")
    rng = random.Random(5)
    noodle_bundle(p, TRS((0, 0, 0)), 0.28)
    for i in range(6):
        ang = 2 * PI * i / 6 + 0.2
        x, y = 0.21 * math.cos(ang), 0.21 * math.sin(ang)
        base = TRS((x, y, 0.007), (0, 0, ang)) @ TRS((0, 0, 0), (0, 0.14, rng.uniform(0, 1)))
        noodle_bundle(p, base, 0.27)


# --------------------------------------------------------------------------- tools / containers

def build_tools():
    a = Asset("pot")
    p = a.part("mesh")
    prof = [(0, 0), (0.25, 0), (0.275, 0.02), (0.28, 0.05), (0.28, 0.3), (0.292, 0.314), (0.286, 0.325),
            (0.268, 0.32), (0.262, 0.3), (0.262, 0.06), (0.245, 0.04), (0, 0.04)]
    lathe(p, M("steel"), prof, 28)
    for s in (-1, 1):
        tube(p, M("black_iron"), [(s * 0.27, -0.07, 0.25), (s * 0.335, -0.07, 0.262), (s * 0.345, 0, 0.265),
                                  (s * 0.335, 0.07, 0.262), (s * 0.27, 0.07, 0.25)], 0.018, segs=8)

    a = Asset("pan")
    pan_geo(a.part("mesh"))

    a = Asset("cutting_board")
    b = a.part("board", bevel=0.015)
    d = a.part("knife")
    boxmm(b, M("board"), (-0.35, -0.25, 0), (0.35, 0.25, 0.05))
    boxmm(b, M("wood_dark"), (-0.3, -0.2, 0.049), (0.3, -0.19, 0.0505))
    prism(d, M("blade"), [(-0.08, 0.145), (0.11, 0.145), (0.18, 0.2), (-0.08, 0.2)], 0.05, 0.062)
    boxmm(d, M("black_iron"), (-0.21, 0.158, 0.05), (-0.08, 0.19, 0.076))

    a = Asset("plate")
    plate_geo(a.part("mesh"))
    a = Asset("plate_stack")
    p = a.part("mesh")
    for k in range(4):
        plate_geo(p, TRS((0, 0, k * 0.03)))


def plate_geo(p, base=None, segs=28):
    prof = [(0, 0), (0.15, 0), (0.16, 0.012), (0.235, 0.03), (0.26, 0.047), (0.255, 0.052), (0.24, 0.05),
            (0.19, 0.024), (0, 0.021)]
    lathe(p, M("white"), prof, segs, base=base)


# --------------------------------------------------------------------------- ingredients

def build_ingredients():
    bun_whole(Asset("bun").part("mesh"))
    bun_bottom(Asset("bun_bottom").part("mesh"))
    bun_top(Asset("bun_top").part("mesh"))
    patty(Asset("patty_raw").part("mesh"), M("patty_raw"))
    patty(Asset("patty_cooked").part("mesh"), M("patty_cooked"), grill=True)
    patty(Asset("patty_burnt").part("mesh"), M("patty_burnt"), base=TRS(scl=(0.95, 0.95, 0.9)))
    lettuce_head(Asset("lettuce").part("mesh"), None, 0.15)
    lettuce_chopped(Asset("lettuce_chopped").part("mesh"))
    tomato(Asset("tomato").part("mesh"), None, 0.13)

    p = Asset("tomato_chopped").part("mesh")
    for i, x in enumerate((-0.08, -0.027, 0.027, 0.08)):
        tomato_slice(p, TRS((x, 0.01 * (i % 2), 0.016 + i * 0.006), (0, 0.22, 0.3 * (i - 1.5))))

    p = Asset("noodles").part("mesh")
    noodle_bundle(p, TRS((0, 0, 0.063), (0, PI / 2, 0)) @ TRS((0, 0, -0.14)), 0.28)

    p = Asset("bowl_soup").part("mesh")
    bowl(p)
    lathe(p, M("soup_red"), [(0, 0.092), (0.147, 0.092), (0.147, 0.1), (0, 0.1)], 24)
    for i, (x, y, r) in enumerate(((-0.02, 0.03, 0.4), (0.03, 0.035, 2.0), (0.0, -0.01, 3.6))):
        sphere(p, M("leaf_green"), (x, y, 0.102), (0.026, 0.012, 0.005), rot=(0, 0, r), segs=8, rings=4)
    torus(p, M("white"), (-0.05, -0.05, 0.1), 0.028, 0.008, segs=16, csegs=6, scl=(1, 1, 0.6))

    p = Asset("bowl_noodles").part("mesh")
    bowl(p)
    lathe(p, M("broth"), [(0, 0.092), (0.147, 0.092), (0.147, 0.1), (0, 0.1)], 24)
    for k, y0 in enumerate((-0.08, -0.04, 0.0, 0.04, 0.08)):
        half = math.sqrt(max(0.128 ** 2 - y0 ** 2, 0.001))
        pts = []
        for i in range(15):
            t = i / 14
            x = -half + 2 * half * t
            pts.append((x, y0 + 0.014 * math.sin(t * 9 + k), 0.101 + 0.004 * math.sin(t * 6 + k * 2)))
        tube(p, M("noodles"), pts, 0.009, segs=6)
    sphere(p, M("white"), (0.055, 0.05, 0.106), (0.045, 0.033, 0.018), segs=12, rings=6)
    sphere(p, M("bun"), (0.055, 0.05, 0.118), (0.021, 0.018, 0.009), segs=10, rings=5)
    for x, y in ((-0.06, 0.06), (-0.03, -0.07), (0.08, -0.03)):
        torus(p, M("leaf_green"), (x, y, 0.108), 0.013, 0.005, segs=10, csegs=5)


# --------------------------------------------------------------------------- chefs

def build_chef(name, kind):
    a = Asset(name)
    body = a.part(name=name + "_body")
    if kind == "player":
        H, bmat, hmat = 0.89, M("white"), M("white")
        prof = egg_profile(H, 0.38, k=0.16, pw=0.72)
        lathe(body, bmat, prof, 32)
        face_features(body, prof, 0.6, 0.12, 0.5, 0.21, 0.53, 0.035)
        z0, z1 = 0.06, 0.15
        lathe(body, M("purple"), [(r_at(prof, z0) - 0.01, z0), (r_at(prof, z0) + 0.013, z0),
                                  (r_at(prof, z1) + 0.013, z1), (r_at(prof, z1) - 0.01, z1)], 32, loop=True)
        tube(body, M("leaf_green"), [(0, 0, H - 0.03), (0, 0, H + 0.03), (0, 0.01, H + 0.05)], 0.022, segs=8)
        for sx in (-1, 1):
            th = sx * 0.7
            c = Vector((0, 0, H + 0.02)) + 0.1 * Vector((math.sin(th), 0, math.cos(th)))
            sphere(body, M("leaf_green"), c, (0.05, 0.016, 0.1), rot=(0, th, 0), segs=10, rings=7)
        sphere(body, M("leaf_green"), (0, 0.03, H + 0.1), (0.04, 0.014, 0.085), rot=(-0.3, 0, PI / 2),
               segs=10, rings=7)
    else:
        H, bmat, hmat = 0.84, M("frog_green"), M("frog_green")
        prof = egg_profile(H, 0.38, k=0.1, pw=0.72)
        lathe(body, bmat, prof, 32)
        face_features(body, prof, 0.0, 0.0, 0.5, 0.21, 0.58, 0.1, eyes=False)
        c, n = surf(prof, 0, 0.28, -0.035)
        sphere(body, M("white"), c, (0.24, 0.05, 0.2), segs=16, rings=10)
        tube(body, M("white"), [surf(prof, x, 0.43, 0.004)[0] for x in (-0.3, -0.2, -0.1, 0.0, 0.1, 0.2, 0.3)],
             0.014, segs=6)
        for sx in (-1, 1):
            ec = Vector((sx * 0.15, -0.06, 0.77))
            sphere(body, bmat, ec, 0.115, segs=16, rings=10)
            sphere(body, M("white"), ec + Vector((0, -0.055, 0.02)), 0.08, segs=14, rings=9)
            pc = ec + Vector((sx * -0.008, -0.125, 0.025))
            sphere(body, M("eye_black"), pc, (0.042, 0.022, 0.05), segs=12, rings=8)
            sphere(body, M("white"), pc + Vector((0.012, -0.018, 0.02)), 0.011, segs=8, rings=5)
        cyl(body, M("white"), (0, 0.1, 0.78), 0.1, 0.12, segs=16)
        sphere(body, M("white"), (0, 0.1, 0.94), (0.14, 0.13, 0.1), segs=16, rings=9)
    for side, sx in (("L", -1), ("R", 1)):
        h = a.part(name="%s_hand%s" % (name, side), loc=(sx * 0.43, -0.1, 0.45))
        sphere(h, hmat, (0, 0, 0), (0.075, 0.07, 0.068), segs=14, rings=10)


# --------------------------------------------------------------------------- decor

def build_decor():
    a = Asset("wall_shelf")
    b = a.part("frame", bevel=0.012)
    d = a.part("jars")
    W = M("white")
    boxmm(b, W, (-0.9, -0.15, 0), (-0.86, 0.15, 0.9))
    boxmm(b, W, (0.86, -0.15, 0), (0.9, 0.15, 0.9))
    boxmm(b, W, (-0.86, -0.15, 0), (0.86, 0.15, 0.04))
    boxmm(b, W, (-0.86, -0.15, 0.43), (0.86, 0.15, 0.47))
    boxmm(b, W, (-0.9, -0.15, 0.86), (0.9, 0.15, 0.9))
    for x in (-0.3, 0.3):
        boxmm(b, W, (x - 0.02, -0.15, 0.04), (x + 0.02, 0.15, 0.86))
    boxmm(b, M("cabinet_cream"), (-0.88, 0.12, 0.02), (0.88, 0.15, 0.88))
    jars = [(-0.72, 0.065, 0.2, "jar_mint"), (-0.52, 0.07, 0.25, "jar_peach"), (-0.12, 0.06, 0.18, "jar_yellow"),
            (0.08, 0.07, 0.26, "jar_pink"), (0.5, 0.075, 0.22, "jar_mint"), (0.7, 0.06, 0.17, "jar_yellow")]
    for x, r, h, mt in jars:
        z = 0.47
        lathe(d, M(mt), [(0, 0), (r - 0.01, 0), (r, 0.012), (r, h - 0.02), (r - 0.015, h - 0.005), (0, h - 0.005)],
              16, loc=(x, 0, z))
        lathe(d, M("white") if mt != "jar_yellow" else M("cabinet_coral"),
              [(0, 0), (r * 0.8, 0), (r * 0.82, 0.035), (0, 0.04)], 16, loc=(x, 0, z + h - 0.025))
    for k in range(3):
        plate_geo(d, TRS((0.0, 0.0, 0.04 + k * 0.03), scl=(0.52, 0.52, 1)), segs=18)
    for x in (-0.6, 0.6):
        bowl(d, TRS((x, 0, 0.04), scl=(0.8, 0.8, 1.0)), segs=16)

    a = Asset("chalkboard")
    b = a.part("frame", bevel=0.015)
    fw = 0.08
    boxmm(b, M("wood"), (-1.0, -0.03, 0), (1.0, 0.03, fw))
    boxmm(b, M("wood"), (-1.0, -0.03, 1.1 - fw), (1.0, 0.03, 1.1))
    boxmm(b, M("wood"), (-1.0, -0.03, fw), (-1.0 + fw, 0.03, 1.1 - fw))
    boxmm(b, M("wood"), (1.0 - fw, -0.03, fw), (1.0, 0.03, 1.1 - fw))
    boxmm(b, M("wood_dark"), (-0.93, 0.0, fw - 0.01), (0.93, 0.03, 1.1 - fw + 0.01))
    f = a.part(name="chalkboard_face")
    uv = f.bm.loops.layers.uv.new("UVMap")
    x0, x1, z0, z1, y = -1.0 + fw, 1.0 - fw, fw, 1.1 - fw, -0.004
    corners = [((x0, y, z0), (0, 0)), ((x1, y, z0), (1, 0)), ((x1, y, z1), (1, 1)), ((x0, y, z1), (0, 1))]
    vs = [f.bm.verts.new(c) for c, _ in corners]
    face = _face(f, vs, f.mi(M("chalkboard")))
    for loop, (_, t) in zip(face.loops, corners):
        loop[uv].uv = t

    a = Asset("pan_rack")
    p = a.part("mesh")
    rail_z = 0.64
    tube(p, M("black_iron"), [(-0.9, 0, rail_z), (0.9, 0, rail_z)], 0.02, segs=10)
    for x in (-0.9, 0.9):
        sphere(p, M("black_iron"), (x, 0, rail_z), 0.035, segs=10, rings=6)
    for x in (-0.75, 0.75):
        tube(p, M("black_iron"), [(x, 0, rail_z), (x, 0.09, rail_z)], 0.016, segs=8)
        cyl(p, M("black_iron"), (x, 0.1, rail_z), 0.045, 0.02, segs=12, rot=(-PI / 2, 0, 0))
    pan_base = TRS((-0.35, 0.03, 0.235), (PI / 2, 0, 0)) @ TRS(rot=(0, 0, PI / 2)) @ Matrix.Scale(0.7, 4)
    pan_geo(p, pan_base)
    torus(p, M("black_iron"), (-0.35, 0.0, rail_z - 0.005), 0.03, 0.007, segs=12, csegs=5, rot=(0, PI / 2, 0))
    torus(p, M("steel"), (0.3, 0.0, rail_z - 0.005), 0.03, 0.007, segs=12, csegs=5, rot=(0, PI / 2, 0))
    tube(p, M("steel"), [(0.3, -0.005, rail_z - 0.035), (0.3, -0.01, 0.3), (0.3, -0.03, 0.16)], 0.014, segs=8)
    lathe(p, M("steel"), [(0, 0), (0.05, 0.005), (0.075, 0.03), (0.08, 0.06), (0.07, 0.06), (0.062, 0.035),
                          (0.04, 0.015), (0, 0.012)], 16, loc=(0.3, -0.03, 0.1), rot=(PI / 2 - 0.3, 0, 0),
          scl=(1, 1, 1))

    a = Asset("extinguisher")
    p = a.part("mesh")
    lathe(p, M("red"), [(0, 0), (0.065, 0), (0.072, 0.012), (0.072, 0.22), (0.062, 0.258), (0.032, 0.275), (0, 0.278)], 20)
    lathe(p, M("white"), [(0.071, 0.1), (0.076, 0.1), (0.076, 0.17), (0.071, 0.17)], 20, loop=True)
    cyl(p, M("black_iron"), (0, 0, 0.27), 0.022, 0.04, segs=12)
    boxmm(p, M("black_iron"), (-0.02, -0.014, 0.3), (0.075, 0.014, 0.316), rot=(0, -0.2, 0))
    boxmm(p, M("black_iron"), (-0.02, -0.012, 0.325), (0.07, 0.012, 0.338), rot=(0, -0.35, 0))
    tube(p, M("black_iron"), [(0.02, -0.01, 0.3), (0.07, -0.03, 0.29), (0.09, -0.045, 0.24), (0.088, -0.05, 0.13),
                              (0.08, -0.052, 0.09)], 0.011, segs=8)
    cyl(p, M("white"), (0, -0.07, 0.2), 0.022, 0.01, segs=12, rot=(PI / 2, 0, 0))


# --------------------------------------------------------------------------- build all

counter("counter_teal", "cabinet_teal", "cabinet_teal_panel", "white", "doors")
counter("counter_coral", "cabinet_coral", "cabinet_coral_panel", "white", "drawers")
counter("counter_cream", "cabinet_cream", "cabinet_cream_panel", "wood_dark", "cream")
build_stove()
build_sink()
build_serve_window()
build_crate_station()
build_trash()
build_heaps()
build_tools()
build_ingredients()
build_chef("chef_player", "player")
build_chef("chef_bot", "bot")
build_decor()

for _a in ASSETS:
    _a.build()

bpy.context.view_layer.update()


def triangle_count():
    dg = bpy.context.evaluated_depsgraph_get()
    total = 0
    per = {}
    for a in ASSETS:
        n = 0
        for ch in OBJ[a.name].children:
            ev = ch.evaluated_get(dg)
            me = ev.to_mesh()
            me.calc_loop_triangles()
            n += len(me.loop_triangles)
            ev.to_mesh_clear()
        per[a.name] = n
        total += n
    return total, per


TOTAL_TRIS, PER_TRIS = triangle_count()
print("TRIANGLES total=%d" % TOTAL_TRIS)
for k, v in sorted(PER_TRIS.items(), key=lambda kv: -kv[1]):
    print("  %-18s %6d" % (k, v))


# --------------------------------------------------------------------------- preview renders

STATIONS = ["counter_teal", "counter_coral", "counter_cream", "stove", "sink", "serve_window", "crate_station", "trash"]
HEAPS = ["heap_lettuce", "heap_tomato", "heap_meat", "heap_bun", "heap_noodles"]
TOOLS = ["pot", "pan", "cutting_board", "plate", "plate_stack"]
INGREDIENTS = ["bun", "bun_bottom", "bun_top", "patty_raw", "patty_cooked", "patty_burnt", "lettuce",
               "lettuce_chopped", "tomato", "tomato_chopped", "noodles", "bowl_soup", "bowl_noodles"]
BACK = ["chef_player", "chef_bot", "extinguisher", "wall_shelf", "chalkboard", "pan_rack"]
WIDTH = {"pan": 0.85, "pot": 0.72, "cutting_board": 0.7, "plate": 0.52, "plate_stack": 0.52,
         "chef_player": 0.9, "chef_bot": 0.9, "extinguisher": 0.3, "wall_shelf": 1.8, "chalkboard": 2.0,
         "pan_rack": 1.8}


def layout_row(names, y, gap, default_w):
    ws = [WIDTH.get(n, default_w) for n in names]
    total = sum(ws) + gap * (len(ws) - 1)
    x = -total / 2
    for n, w in zip(names, ws):
        OBJ[n].location = (x + w / 2, y, 0)
        x += w + gap


PREVIEW_HELPERS = []


def setup_render():
    sc = SCENE
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x = 1600
    sc.render.resolution_y = 1000
    sc.render.resolution_percentage = 100
    sc.render.film_transparent = False
    sc.view_settings.view_transform = "Standard"
    sc.view_settings.look = "None"
    ee = sc.eevee
    ee.taa_render_samples = 32
    ee.use_gtao = True
    ee.gtao_distance = 0.35
    ee.gtao_factor = 1.2
    ee.use_soft_shadows = True
    ee.shadow_cascade_size = "2048"
    ee.shadow_cube_size = "1024"
    if sc.world is None:
        sc.world = bpy.data.worlds.new("World")
    w = sc.world
    w.use_nodes = True
    bg = w.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (0.95, 0.86, 0.74, 1.0)
    bg.inputs["Strength"].default_value = 0.55
    sc.view_settings.exposure = -0.15
    ld = bpy.data.lights.new("PreviewSun", "SUN")
    ld.energy = 2.7
    ld.angle = math.radians(12)
    ld.color = (1.0, 0.96, 0.9)
    ld.shadow_cascade_max_distance = 30
    sun = bpy.data.objects.new("PreviewSun", ld)
    sun.rotation_euler = (math.radians(38), 0, math.radians(-28))
    COLL.objects.link(sun)
    PREVIEW_HELPERS.append(sun)


def ensure_camera():
    cd = bpy.data.cameras.new("PreviewCam")
    cam = bpy.data.objects.new("PreviewCam", cd)
    COLL.objects.link(cam)
    SCENE.camera = cam
    cd.type = "ORTHO"
    cd.clip_end = 200
    return cam


def shoot(cam, path, target, ortho, elev=50.0, yaw=0.0):
    rot = Euler((math.radians(90 - elev), 0, math.radians(yaw)), "XYZ")
    cam.rotation_euler = rot
    fwd = rot.to_matrix() @ Vector((0, 0, -1))
    cam.location = Vector(target) - fwd * 40
    cam.data.ortho_scale = ortho
    SCENE.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print("RENDERED", path)


def make_floor():
    me = bpy.data.meshes.new("PreviewFloor")
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0, matrix=TRS((0, 0, -0.05), scl=(40, 40, 0.1)))
    bm.to_mesh(me)
    bm.free()
    fm = make_mat("preview_floor", "#F1E3CC", 0.9)
    me.materials.append(fm)
    ob = bpy.data.objects.new("PreviewFloor", me)
    COLL.objects.link(ob)
    return ob, fm


os.makedirs(PREVIEW_DIR, exist_ok=True)
setup_render()
CAM = ensure_camera()
FLOOR, FLOOR_MAT = make_floor()

layout_row(INGREDIENTS, -2.5, 0.2, 0.34)
layout_row(HEAPS + TOOLS, -1.35, 0.22, 0.9)
layout_row(STATIONS, 0.0, 0.14, 1.0)
layout_row(BACK, 1.5, 0.3, 1.0)
bpy.context.view_layer.update()
shoot(CAM, os.path.join(PREVIEW_DIR, "preview.png"), (0, -0.45, 0.35), 10.4)
shoot(CAM, os.path.join(PREVIEW_DIR, "preview_items.png"), (0, -2.3, 0.1), 7.2)
shoot(CAM, os.path.join(PREVIEW_DIR, "preview_back.png"), (0, 1.3, 0.6), 9.0)

# In-context vignette: heaps in crates, pot on stove, food on plates, chefs at the counter.
for ob in OBJ.values():
    ob.location = (0, 0, -50)
VIGNETTE = {
    "counter_teal": (-2.0, 0, 0), "stove": (-1.0, 0, 0), "counter_cream": (0, 0, 0), "sink": (1, 0, 0),
    "counter_coral": (2, 0, 0), "serve_window": (3, 0, 0), "crate_station": (-3, 0, 0), "trash": (4, 0, 0),
    "pot": (-1.0, 0, TOP), "cutting_board": (0, 0, TOP), "tomato": (0.05, -0.02, TOP + 0.05),
    "plate": (2.0, 0, TOP), "patty_cooked": (2.0, 0, TOP + 0.021), "extinguisher": (-2.25, 0.2, TOP),
    "bowl_soup": (3.0, 0.0, TOP), "heap_tomato": (-3, 0, 0.78), "plate_stack": (-1.9, -0.05, TOP),
    "chef_player": (-0.5, -1.0, 0), "chef_bot": (1.6, -1.1, 0), "wall_shelf": (-1.0, 0.9, 1.3),
    "chalkboard": (1.5, 0.95, 1.2), "pan_rack": (0.2, 0.95, 1.25),
}
for n, loc in VIGNETTE.items():
    OBJ[n].location = loc
OBJ["chef_bot"].rotation_euler = (0, 0, 0.5)
bpy.context.view_layer.update()
shoot(CAM, os.path.join(PREVIEW_DIR, "preview_scene.png"), (0.5, -0.2, 0.8), 8.6)
OBJ["chef_bot"].rotation_euler = (0, 0, 0)


# --------------------------------------------------------------------------- export

for ob in OBJ.values():
    ob.location = (0, 0, 0)
    ob.rotation_euler = (0, 0, 0)
    ob.scale = (1, 1, 1)
for helper in PREVIEW_HELPERS + [CAM, FLOOR]:
    bpy.data.objects.remove(helper, do_unlink=True)
bpy.data.materials.remove(MATS.pop("preview_floor"))
bpy.context.view_layer.update()

os.makedirs(os.path.dirname(GLB_PATH), exist_ok=True)
bpy.ops.export_scene.gltf(
    filepath=GLB_PATH,
    export_format="GLB",
    export_apply=True,
    export_yup=True,
    export_cameras=False,
    export_lights=False,
)
print("EXPORTED", GLB_PATH, os.path.getsize(GLB_PATH), "bytes;", len(ASSETS), "assets;", len(MATS), "materials")
