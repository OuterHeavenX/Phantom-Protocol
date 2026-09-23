class_name Bearing
extends RefCounted

## Screen bearings, kept apart from the HUD so they can be asserted.
##
## The HUD cannot be loaded on its own to test: it is typed against Sim, which
## refers to the GameData autoload, and autoloads are not registered when a
## single script is run. This has no dependencies at all.

## Where on the ring around the crosshair a threat from `dir` belongs, as an
## angle draw_arc understands: 0 is screen right, -PI/2 is the top.
##
## Plan space is (world x, world z), and the operative's right in it is
## (-look.y, look.x) -- forward crossed with up. Getting a sign wrong here
## points every arrow at the opposite side of the screen, which is worse than
## not drawing them at all, and still looks plausible in a screenshot.
static func threat(look: Vector2, dir: Vector2) -> float:
    return look.angle_to(dir) - PI * 0.5
