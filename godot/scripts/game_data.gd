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

var _by_id: Dictionary = {}

func _ready() -> void:
    weapons = _load("weapons")
    enemies = _load("enemies")
    elites = _load("elites")
    maps = _load("maps")
    hazards = _load("hazards")
    difficulties = _load("difficulties")
    operatives = _load("operatives")
    op1 = _load("op1")
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
