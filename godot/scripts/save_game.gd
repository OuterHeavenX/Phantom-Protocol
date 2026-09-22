class_name SaveGame
extends RefCounted

## Reading and writing the player's progress.
##
## Deliberately much smaller than the 2D game's save, which carries settings,
## unlocks, nemesis records and thirty-odd statistics. This port runs two
## contracts and needs to remember which one the player is on; everything else
## here is the handful of counters the 2D game's map unlocks are written
## against, so that when more sectors are exported the conditions they already
## carry -- "Complete 2 operations" -- have something to read.
##
## Written as JSON under user://. On desktop that is a file; in a browser it is
## Emscripten's IDBFS, which Godot mounts at the same path and syncs to
## IndexedDB, so the same code persists on both. `OS.is_userfs_persistent()`
## reports whether that sync is actually available, and a build where it is not
## keeps the save in memory for the session rather than pretending.

## Where the save lives. A static var rather than a constant so the tests can
## point it at a scratch file: the first version of the progression test
## exercised `advance_contract()`, which persists, and left a save behind that
## the next run read back as "already on contract two".
static var path := "user://progress.json"

## Bumped when the shape changes in a way an older file cannot be read as. A
## file from a newer version is left alone rather than overwritten, so opening
## an old build does not destroy progress made in a new one.
const VERSION := 1

## Everything the save holds, and its starting values.
##
## Declared in one place so a counter added later cannot crash a save written
## before it existed: `read()` merges a stored file over these, so a missing
## key takes its default rather than coming back null.
static func defaults() -> Dictionary:
    return {
        "version": VERSION,
        # Which contract the player is on, as a campaign index.
        "contract_index": 0,
        "stats": {
            # The names the 2D game's unlock conditions use.
            "missions": 0,
            "wins": 0,
            "losses": 0,
            "kills": 0,
            "best_level": 1,
            "best_survival": 0.0,
        },
    }

## Read the save, or the defaults when there is nothing readable there.
##
## Every failure returns defaults rather than propagating: a corrupt or
## truncated file should cost the player their progress, not the ability to
## start the game at all.
static func read() -> Dictionary:
    var result := defaults()
    if not FileAccess.file_exists(path):
        return result
    var text := FileAccess.get_file_as_string(path)
    if text.is_empty():
        push_warning("Save file is empty; starting fresh.")
        return result
    var parsed = JSON.parse_string(text)
    if typeof(parsed) != TYPE_DICTIONARY:
        push_warning("Save file is not readable; starting fresh.")
        return result
    var stored: Dictionary = parsed
    var stored_version := int(stored.get("version", 0))
    if stored_version > VERSION:
        push_warning("Save file is version %d and this build reads %d; leaving it alone." % [
            stored_version, VERSION])
        return result
    # Merge over the defaults, one level into `stats`, so a key this build does
    # not know about is dropped and one it expects but the file lacks keeps its
    # default.
    for key in result.keys():
        if key == "stats" or not stored.has(key):
            continue
        result[key] = stored[key]
    var stored_stats = stored.get("stats", {})
    if typeof(stored_stats) == TYPE_DICTIONARY:
        for key in (result["stats"] as Dictionary).keys():
            if stored_stats.has(key):
                result["stats"][key] = stored_stats[key]
    result["version"] = VERSION
    return result

## Write the save. Returns whether it reached the disk.
static func write(data: Dictionary) -> bool:
    data["version"] = VERSION
    var f := FileAccess.open(path, FileAccess.WRITE)
    if f == null:
        push_warning("Could not open the save for writing: %s" % error_string(FileAccess.get_open_error()))
        return false
    f.store_string(JSON.stringify(data, "  "))
    # Closing matters here rather than leaving it to the reference going out of
    # scope: the browser build syncs user:// to IndexedDB off the back of the
    # file being closed, so a save that is merely dropped can be lost on a
    # reload that happens before the handle is collected.
    f.close()
    return true

## Whether writes will outlive the session on this platform.
static func is_persistent() -> bool:
    return OS.is_userfs_persistent()

## Remove the save. Used by `-- wipe`, so a run can be started from nothing
## without hunting for the file on each platform.
static func clear() -> bool:
    if not FileAccess.file_exists(path):
        return true
    var err := DirAccess.remove_absolute(ProjectSettings.globalize_path(path))
    if err != OK:
        push_warning("Could not remove the save: %s" % error_string(err))
        return false
    return true
