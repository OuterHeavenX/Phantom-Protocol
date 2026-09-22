extends Node

## Autoload holding the exported registries.
##
## Nothing here is authored: every file under res://data was written by
## tools/godot/export-data.mjs from the 2D game's own data modules. When a
## weapon is rebalanced there, re-running the exporter is the whole of the
## change on this side.

var weapons: Array = []
var enemies: Array = []
var elites: Array = []
var maps: Array = []
var hazards: Dictionary = {}
var difficulties: Array = []
var operatives: Array = []
var op1: Dictionary = {}
## The campaign as far as this build can play it, in order.
##
## The campaign has twelve entries and this build ships two sectors, so the
## list stops at the first operation whose map has no exported level. Without
## that, finishing CROSSFALL advanced to an operation on HOLLOW VALLEY, found
## no level_hollow.json, and left the player on the bridge with the previous
## sector's geometry under a HUD naming a different one.
##
## Deciding it here, from what is on disk, rather than against a list kept by
## hand means the campaign extends itself the moment another sector is
## exported.
var campaign: Array = []

## Which sector ids have an exported level, for the query-string whitelist.
var sector_ids: Array = []

## Which contract the player is on, as an index into `campaign`.
##
## Lives on the autoload rather than in the scene because advancing a contract
## reloads the scene: game.gd builds the whole sector in code, so there is no
## cheaper way to swap the map, the objective and the difficulty than to build
## it again. An autoload survives that; a member of the scene does not.
##
## It is session state, not a save. Nothing here writes to disk yet, so
## closing the tab starts again at the first contract.
var contract_index: int = 0

## The operation the player is on.
func current_op() -> Dictionary:
    if campaign.is_empty():
        return op1
    return campaign[clampi(contract_index, 0, campaign.size() - 1)]

## The next operation, or an empty dictionary at the end of the campaign.
func next_op() -> Dictionary:
    if contract_index + 1 >= campaign.size():
        return {}
    return campaign[contract_index + 1]

## Advance, and report whether there was anywhere to advance to.
func advance_contract() -> bool:
    if contract_index + 1 >= campaign.size():
        return false
    contract_index += 1
    return true

## Select a contract by its campaign index (op1 is 1), for the command line
## and the page's query string. Returns false for an index that does not
## exist, leaving the current contract alone.
func select_op_index(one_based: int) -> bool:
    for i in range(campaign.size()):
        if int(campaign[i].get("index", i + 1)) == one_based:
            contract_index = i
            return true
    return false

var _by_id: Dictionary = {}

## True when the running build has a RenderingDevice, which means Forward+ or
## Mobile rather than Compatibility.
##
## The web export cannot use Forward+ at all: browsers have no Vulkan, so a
## browser build runs the Compatibility backend over WebGL2. Several things the
## desktop look is built on simply do not exist there -- Decal nodes, screen
## space ambient occlusion, screen space indirect lighting -- and asking for
## them prints a warning per node and then ignores it. Code that would use one
## checks here and takes another route instead of rendering a different game on
## each platform by accident.
static func has_rendering_device() -> bool:
    return RenderingServer.get_rendering_device() != null

func _ready() -> void:
    weapons = _load("weapons")
    enemies = _load("enemies")
    elites = _load("elites")
    maps = _load("maps")
    hazards = _load("hazards")
    difficulties = _load("difficulties")
    operatives = _load("operatives")
    op1 = _load("op1")
    var all_ops: Array = _load("campaign")
    campaign = []
    sector_ids = []
    for op in all_ops:
        var map_id := String(op.get("map", ""))
        # Truncate at the first missing sector rather than skipping over it.
        #
        # Filtering instead of stopping looks equivalent and is not: the
        # campaign's tenth operation returns to BLACKSITE ZERO, so a filtered
        # list runs op1, op2, op10 and finishing CROSSFALL jumps seven
        # contracts into the story. This build ships the first two sectors, so
        # it offers the first two contracts, and extends by one each time
        # another sector is exported.
        if not FileAccess.file_exists("res://data/level_%s.json" % map_id):
            break
        campaign.append(op)
        if not sector_ids.has(map_id):
            sector_ids.append(map_id)
    if campaign.is_empty():
        push_error("No campaign operation has an exported level.")
    for list in [weapons, enemies, elites, maps, operatives]:
        for entry in list:
            _by_id[entry.get("id", "")] = entry

func _load(name: String):
    var path := "res://data/%s.json" % name
    var text := FileAccess.get_file_as_string(path)
    if text.is_empty():
        push_error("Missing data file: " + path)
        return [] 
    var parsed = JSON.parse_string(text)
    if parsed == null:
        push_error("Unparseable data file: " + path)
        return []
    return parsed

func by_id(id: String):
    return _by_id.get(id, null)

func map_named(id: String) -> Dictionary:
    for m in maps:
        if m.get("id", "") == id:
            return m
    return {}

func difficulty(index: int) -> Dictionary:
    for d in difficulties:
        if int(d.get("id", -1)) == index:
            return d
    return difficulties[1] if difficulties.size() > 1 else {}
