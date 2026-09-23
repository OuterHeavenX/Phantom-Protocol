extends SceneTree

## Campaign progression and save persistence, asserted rather than eyeballed.
##
## Run by tools/godot/check.sh. Three things here were wrong at some point and
## each of them is the kind of fault that looks like it works:
##
##  * The campaign was exported as op1 alone, so there was no second contract
##    to advance to.
##  * Operations whose sector this build has not exported were FILTERED out
##    rather than truncated at, and the campaign's tenth operation returns to
##    BLACKSITE ZERO -- so finishing CROSSFALL jumped seven contracts into the
##    story instead of ending the playable run.
##  * Selecting a contract by an index that does not exist has to leave the
##    current one alone rather than clamping to something arbitrary.
func _init() -> void:
    # Against a scratch save, and with writing off for the part that only
    # exercises the campaign. The first version of this ran `advance_contract`
    # against the real file and left a save behind saying contract two, which
    # the next run then read back and failed on.
    SaveGame.path = "user://test_progress.json"
    SaveGame.clear()
    var gd = load("res://scripts/game_data.gd").new()
    gd._ready()
    gd.persist = false
    # Truncated at the first sector this build has not exported, so it is the
    # campaign's first two operations rather than all twelve.
    assert(gd.campaign.size() == 2, "campaign should offer the 2 playable operations")
    assert(gd.sector_ids.has("blacksite") and gd.sector_ids.has("crossfall"),
        "both shipped sectors should be listed")
    assert(gd.contract_index == 0, "should start on the first contract")
    assert(String(gd.current_op().get("id")) == "op1", "first contract is op1")
    assert(String(gd.next_op().get("id")) == "op2", "second contract is op2")
    assert(String(gd.next_op().get("map")) == "crossfall", "op2 is CROSSFALL")
    assert(gd.advance_contract(), "should advance from op1")
    assert(String(gd.current_op().get("id")) == "op2", "now on op2")
    assert(String(gd.current_op().get("objective").get("type")) == "recover", "op2 recovers caches")
    assert(gd.select_op_index(1), "index 1 selects op1")
    assert(String(gd.current_op().get("id")) == "op1", "back on op1")
    assert(not gd.select_op_index(99), "index 99 does not exist")
    assert(String(gd.current_op().get("id")) == "op1", "a bad index leaves the contract alone")
    gd.contract_index = gd.campaign.size() - 1
    assert(not gd.advance_contract(), "cannot advance past the last PLAYABLE contract")
    assert(gd.next_op().is_empty(), "no next contract at the end")
    print("PROGRESSION OK: all assertions passed")
    _test_persistence()
    SaveGame.clear()
    print("PERSISTENCE OK: all assertions passed")
    _test_threat_bearing()
    print("BEARING OK: all assertions passed")
    quit()

## Which way the threat arcs point.
##
## Pure trigonometry over two coordinate conventions -- plan space is (world
## x, world z), and draw_arc measures from screen right -- so a sign error
## puts every arrow on the wrong side of the screen and still looks plausible
## in a screenshot.
func _test_threat_bearing() -> void:
    const TOP := -PI * 0.5
    const RIGHT := 0.0
    const BOTTOM := PI * 0.5
    var near := func(a: float, b: float) -> bool:
        return absf(wrapf(a - b, -PI, PI)) < 0.01
    for look in [Vector2(1, 0), Vector2(0, 1), Vector2(-1, 0),
            Vector2(0.6, -0.8).normalized()]:
        # Straight ahead reads at the top of the ring.
        assert(near.call(Bearing.threat(look, look), TOP),
            "a threat dead ahead belongs at the top")
        # Behind reads at the bottom.
        assert(near.call(Bearing.threat(look, -look), BOTTOM),
            "a threat behind belongs at the bottom")
        # The operative's right in plan space, from forward x up in 3D.
        var right := Vector2(-look.y, look.x)
        assert(near.call(Bearing.threat(look, right), RIGHT),
            "a threat to the right belongs at the right")
        assert(near.call(Bearing.threat(look, -right), PI),
            "a threat to the left belongs at the left")

## The save round-trip, which is what makes progress survive a reload.
##
## Exercised through GameData rather than through SaveGame alone, because the
## thing that matters is that a second GameData built from nothing comes back
## on the contract the first one left off at -- which is exactly what a reload
## does.
func _test_persistence() -> void:
    SaveGame.clear()
    var first = load("res://scripts/game_data.gd").new()
    first._ready()
    assert(first.contract_index == 0, "a fresh save starts on the first contract")
    assert(int(first.stats.get("missions", -1)) == 0, "a fresh save has no missions")

    first.record_contract(true, 42, 9, 301.5)
    assert(first.advance_contract(), "a win advances")
    assert(first.contract_index == 1, "and lands on the second contract")

    # A second instance reads what the first wrote, which is the reload.
    var second = load("res://scripts/game_data.gd").new()
    second._ready()
    assert(second.contract_index == 1, "progress survives being read back")
    assert(int(second.stats.get("missions", 0)) == 1, "the contract was counted")
    assert(int(second.stats.get("wins", 0)) == 1, "the win was counted")
    assert(int(second.stats.get("kills", 0)) == 42, "kills accumulate")
    assert(int(second.stats.get("best_level", 0)) == 9, "the best level is kept")

    # A loss counts as a mission but does not advance.
    second.record_contract(false, 3, 2, 40.0)
    var third = load("res://scripts/game_data.gd").new()
    third._ready()
    assert(int(third.stats.get("missions", 0)) == 2, "a loss is still a mission")
    assert(int(third.stats.get("losses", 0)) == 1, "the loss was counted")
    assert(int(third.stats.get("kills", 0)) == 45, "kills accumulate across contracts")
    assert(third.contract_index == 1, "a loss does not advance the campaign")

    # Nonsense on disk must not stop the game starting.
    var f := FileAccess.open(SaveGame.path, FileAccess.WRITE)
    f.store_string("{ this is not json")
    f.close()
    var broken = load("res://scripts/game_data.gd").new()
    broken._ready()
    assert(broken.contract_index == 0, "an unreadable save starts a fresh campaign")

    # A save from a build that ran further than this one must not index off
    # the end of the campaign.
    SaveGame.write({"contract_index": 99, "stats": {}})
    var ahead = load("res://scripts/game_data.gd").new()
    ahead._ready()
    assert(ahead.contract_index == ahead.campaign.size() - 1,
        "a save past the end resumes at the last contract this build has")

    # And wiping really does start over.
    ahead.wipe_progress()
    var wiped = load("res://scripts/game_data.gd").new()
    wiped._ready()
    assert(wiped.contract_index == 0, "a wipe starts the campaign again")
    assert(int(wiped.stats.get("kills", -1)) == 0, "a wipe clears the counters")
