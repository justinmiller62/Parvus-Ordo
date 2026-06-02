#!/usr/bin/env bash
# Persistent review-queue watcher for reviewer-6.
# Polls phase=review; on first appearance, claims EXACTLY ONE bead atomically,
# verifies ownership (against BEADS_ACTOR per the claim-verify lesson), and exits.
# Exiting re-invokes the agent to perform the review. Loops on lost races / empty queue.
RIG=parva-ordo
while true; do
  B=$(gc bd ready --rig "$RIG" --unassigned --label phase=review --json 2>/dev/null | jq -r '.[0].id // empty')
  if [ -n "$B" ]; then
    gc bd update "$B" --claim >/dev/null 2>&1
    owner=$(gc bd show "$B" --json 2>/dev/null | jq -r '.[0].assignee // ""')
    case "$owner" in
      *"$BEADS_ACTOR"*) echo "CLAIMED=$B"; exit 0 ;;
      *) : ;;   # another reviewer won the race — keep watching
    esac
  fi
  sleep 30
done
