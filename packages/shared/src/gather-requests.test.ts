import { describe, expect, it } from "vitest";
import {
  nextRequestStatus,
  REQUEST_ACTIONS,
  REQUEST_PRIORITIES,
  REQUEST_STATUSES,
  type RequestActor,
  type RequestStatus,
} from "./index";

// Actor fixtures — each relationship isolated so we can assert exactly who may do what.
const base: RequestActor = {
  isRequester: false,
  isAssignee: false,
  isPoolEligible: false,
  canManageBoard: false,
  isStaff: false,
};
const requester: RequestActor = { ...base, isRequester: true };
const assignee: RequestActor = { ...base, isAssignee: true };
const poolMember: RequestActor = { ...base, isPoolEligible: true };
const boardManager: RequestActor = { ...base, canManageBoard: true };
const staff: RequestActor = { ...base, isStaff: true };
const bystander: RequestActor = { ...base };

describe("request status / priority / action unions (RFC-005 §4.1/§4.2)", () => {
  it("are the locked sets, in lifecycle order", () => {
    expect(REQUEST_STATUSES).toEqual(["open", "assigned", "in_progress", "done", "declined", "cancelled"]);
    expect(REQUEST_PRIORITIES).toEqual(["low", "normal", "soon"]);
    expect(REQUEST_ACTIONS).toEqual(["assign", "claim", "start", "done", "decline", "hand_back", "cancel"]);
  });
});

describe("nextRequestStatus — legal transitions (RFC-005 §4.2)", () => {
  it("assign: open → assigned for the requester, a board manager, or staff", () => {
    expect(nextRequestStatus("open", "assign", requester)).toBe("assigned");
    expect(nextRequestStatus("open", "assign", boardManager)).toBe("assigned");
    expect(nextRequestStatus("open", "assign", staff)).toBe("assigned");
  });

  it("claim: open → assigned for a pool-eligible member or staff", () => {
    expect(nextRequestStatus("open", "claim", poolMember)).toBe("assigned");
    expect(nextRequestStatus("open", "claim", staff)).toBe("assigned");
  });

  it("start: assigned → in_progress for the assignee or staff", () => {
    expect(nextRequestStatus("assigned", "start", assignee)).toBe("in_progress");
    expect(nextRequestStatus("assigned", "start", staff)).toBe("in_progress");
  });

  it("done: assigned OR in_progress → done for the assignee or staff", () => {
    expect(nextRequestStatus("assigned", "done", assignee)).toBe("done");
    expect(nextRequestStatus("in_progress", "done", assignee)).toBe("done");
    expect(nextRequestStatus("in_progress", "done", staff)).toBe("done");
  });

  it("hand_back: assigned OR in_progress → open (re-offered) for the assignee or staff", () => {
    expect(nextRequestStatus("assigned", "hand_back", assignee)).toBe("open");
    expect(nextRequestStatus("in_progress", "hand_back", assignee)).toBe("open");
  });

  it("decline: assigned OR in_progress → declined for the assignee or staff", () => {
    expect(nextRequestStatus("assigned", "decline", assignee)).toBe("declined");
    expect(nextRequestStatus("in_progress", "decline", assignee)).toBe("declined");
  });

  it("cancel: open / assigned / in_progress → cancelled for the requester or staff", () => {
    expect(nextRequestStatus("open", "cancel", requester)).toBe("cancelled");
    expect(nextRequestStatus("assigned", "cancel", requester)).toBe("cancelled");
    expect(nextRequestStatus("in_progress", "cancel", staff)).toBe("cancelled");
  });

  it("staff may perform any STATE-legal action on a parishioner's behalf (§3.2)", () => {
    expect(nextRequestStatus("open", "assign", staff)).toBe("assigned");
    expect(nextRequestStatus("open", "claim", staff)).toBe("assigned");
    expect(nextRequestStatus("assigned", "start", staff)).toBe("in_progress");
    expect(nextRequestStatus("assigned", "done", staff)).toBe("done");
    expect(nextRequestStatus("assigned", "hand_back", staff)).toBe("open");
    expect(nextRequestStatus("assigned", "decline", staff)).toBe("declined");
    expect(nextRequestStatus("open", "cancel", staff)).toBe("cancelled");
  });
});

describe("nextRequestStatus — rejects illegal transitions (RFC-005 §4.2)", () => {
  it("rejects EVERY action from a terminal state — even for staff", () => {
    const terminal: RequestStatus[] = ["done", "declined", "cancelled"];
    for (const s of terminal) {
      for (const a of REQUEST_ACTIONS) {
        expect(nextRequestStatus(s, a, staff)).toBeNull();
      }
    }
  });

  it("rejects assign / claim unless the source state is open", () => {
    expect(nextRequestStatus("assigned", "assign", requester)).toBeNull();
    expect(nextRequestStatus("in_progress", "assign", boardManager)).toBeNull();
    expect(nextRequestStatus("assigned", "claim", poolMember)).toBeNull();
    expect(nextRequestStatus("in_progress", "claim", poolMember)).toBeNull();
  });

  it("rejects start unless the source state is assigned", () => {
    expect(nextRequestStatus("open", "start", assignee)).toBeNull();
    expect(nextRequestStatus("in_progress", "start", assignee)).toBeNull();
  });

  it("rejects an unauthorized actor on every action (a bystander can do nothing)", () => {
    expect(nextRequestStatus("open", "assign", bystander)).toBeNull();
    expect(nextRequestStatus("open", "claim", bystander)).toBeNull();
    expect(nextRequestStatus("assigned", "start", bystander)).toBeNull();
    expect(nextRequestStatus("in_progress", "done", bystander)).toBeNull();
    expect(nextRequestStatus("assigned", "decline", bystander)).toBeNull();
    expect(nextRequestStatus("assigned", "hand_back", bystander)).toBeNull();
    expect(nextRequestStatus("open", "cancel", bystander)).toBeNull();
  });

  it("cancel is requester-only: not the assignee, a pool member, or a board manager", () => {
    expect(nextRequestStatus("assigned", "cancel", assignee)).toBeNull();
    expect(nextRequestStatus("open", "cancel", poolMember)).toBeNull();
    expect(nextRequestStatus("assigned", "cancel", boardManager)).toBeNull();
  });

  it("a pool member cannot start / finish until they have claimed (become the assignee)", () => {
    expect(nextRequestStatus("assigned", "start", poolMember)).toBeNull();
    expect(nextRequestStatus("in_progress", "done", poolMember)).toBeNull();
  });

  it("the requester cannot start / finish someone else's work", () => {
    expect(nextRequestStatus("assigned", "start", requester)).toBeNull();
    expect(nextRequestStatus("in_progress", "done", requester)).toBeNull();
  });
});
