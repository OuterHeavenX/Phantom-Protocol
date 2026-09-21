class_name Materials
extends RefCounted

## Builds the surface set from res://art/textures.
##
## Every material is the same three-map PBR setup (albedo, tangent normal, ORM)
## so the whole sector lights consistently: one surface reading as plastic next
## to five that read as stone is the single most noticeable failure at this
## art direction, and it happens when one material is left as a flat colour.

const TEX := "res://art/textures/%s_%s.png"

static func _load(name: String, slot: String) -> Texture2D:
    var path := TEX % [name, slot]
    if not ResourceLoader.exists(path):
        return null
    return load(path)

## `uv_scale` is in TILES PER METRE, applied triplanar.
##
## Box meshes carry per-face 0..1 UVs, so a plain uv1_scale magnifies one tile
## across a whole face and every surface came out looking like flat paint. World
## space triplanar mapping makes the number mean what it says: 0.3 puts one
## tile every 3.3 m, which puts a block course at about 40 cm on every wall
## regardless of how large that wall is.
static func pbr(name: String, uv_scale: float, tint: Color = Color.WHITE, metal_max: float = 0.0) -> StandardMaterial3D:
    var m := StandardMaterial3D.new()
    m.albedo_color = tint
    var alb := _load(name, "albedo")
    if alb:
        m.albedo_texture = alb
    var nrm := _load(name, "normal")
    if nrm:
        m.normal_enabled = true
        m.normal_texture = nrm
        m.normal_scale = 1.0
    var orm := _load(name, "orm")
    if orm:
        # Godot's ORM material reads roughness from G and metallic from B.
        m.roughness_texture = orm
        m.roughness_texture_channel = BaseMaterial3D.TEXTURE_CHANNEL_GREEN
        m.metallic_texture = orm
        m.metallic_texture_channel = BaseMaterial3D.TEXTURE_CHANNEL_BLUE
        m.roughness = 1.0
        # Painted steel and coated containers are mostly dielectric. Driving
        # metallic to 1 with no reflection probes in the scene made them read
        # as black holes, which is what a metal with nothing to reflect is.
        m.metallic = metal_max
    m.uv1_triplanar = true
    m.uv1_world_triplanar = true
    m.uv1_scale = Vector3(uv_scale, uv_scale, uv_scale)
    m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC
    return m

## Feature sizes land where the eye expects them: block courses about 40 cm,
## paving setts about 18 cm, container corrugations about 6 cm.
static func build() -> Dictionary:
    return {
        "wall": pbr("sandstone", 0.30, Color(1.03, 0.99, 0.93)),
        "perimeter": pbr("sandstone", 0.26, Color(0.92, 0.88, 0.82)),
        "vault": pbr("steel", 0.50, Color(1.30, 1.36, 1.42), 0.20),
        "pillar": pbr("plaster", 0.30, Color(1.0, 0.98, 0.93)),
        "machinery": pbr("steel", 0.55, Color(1.55, 1.60, 1.62), 0.18),
        "container": pbr("crate", 0.50, Color(1.0, 0.94, 0.86), 0.12),
        "floor": pbr("concrete", 0.20, Color(1.0, 0.98, 0.94)),
        "ground": pbr("cobble", 0.36, Color(1.0, 0.96, 0.90)),
        "trim": pbr("plaster", 0.30, Color(0.86, 0.83, 0.78)),
        "cornice": pbr("plaster", 0.34, Color(0.78, 0.74, 0.68)),
    }
