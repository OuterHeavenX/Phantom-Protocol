extends SceneTree

## Campaign progression, asserted rather than eyeballed.
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
    var gd = load("res://scripts/game_data.gd").new()
    gd._ready()
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
    quit()
