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
        m.normal_scale = 1.6
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
        # Tints are all at or below 0.85 per channel. Several were above 1.0,
        # which multiplies the texture past unity: physically impossible for a
        # dielectric, and a direct cause of the clipped highlights measured in
        # the first round. Sunlit limestone is about 0.45-0.55 albedo and
        # weathered concrete 0.30-0.40, so these sit where real surfaces do.
        "wall": pbr("sandstone", 0.45, Color(0.82, 0.79, 0.74)),
        "perimeter": pbr("sandstone", 0.40, Color(0.74, 0.71, 0.66)),
        "vault": pbr("steel", 0.80, Color(0.80, 0.78, 0.74), 0.20),
        "pillar": pbr("plaster", 0.30, Color(0.80, 0.78, 0.73)),
        "machinery": pbr("steel", 0.85, Color(0.80, 0.79, 0.76), 0.18),
        "container": pbr("crate", 0.50, Color(0.76, 0.72, 0.66), 0.12),
        "floor": pbr("concrete", 0.45, Color(0.74, 0.73, 0.70)),
        "ground": pbr("cobble", 0.36, Color(0.78, 0.75, 0.71)),
        "trim": pbr("plaster", 0.30, Color(0.80, 0.77, 0.71)),
        "cornice": pbr("plaster", 0.34, Color(0.70, 0.67, 0.62)),
        "kerb": pbr("concrete", 0.55, Color(0.62, 0.61, 0.58)),
        "glass": glass(),
    }

## Dirty glazing. Rough enough not to mirror, smooth enough to take a sky
## reflection, and dark enough to read as an interior behind it.
static func glass() -> StandardMaterial3D:
    var m := StandardMaterial3D.new()
    m.albedo_color = Color(0.055, 0.070, 0.078)
    m.roughness = 0.12
    m.metallic = 0.0
    return m
