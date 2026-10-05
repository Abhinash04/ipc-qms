import { describe, it, expect } from "vitest";
import {
  authenticationByDay,
  checklist,
  controls,
  findings,
  lifecycle,
  periodSummary,
  privilegedActivity,
  reportPeriod,
  securityExceptions,
} from "../services/audit/auditReportData.js";

let seq = 0;
const at = (day, time) =>
  new Date(`2026-09-${day}T${time}+05:30`).toISOString();
const ev = (timestamp, action, extra = {}) => ({
  seq: ++seq,
  timestamp,
  action,
  result: "success",
  actorType: "human",
  ...extra,
});
const ADMIN = {
  actorId: "USR-0007",
  actorRole: "ADMIN",
  actorName: "Suresh Gupta",
};
const failedSignIn = (time, email = "r.kumar@ipc.gov.in") =>
  ev(at("02", time), "LOGIN_FAILED", {
    result: "denied",
    details: { email },
    source: { ip: "10.21.22.17" },
  });

const ROWS = [
  ev(at("01", "09:32:10"), "QUERY_RECEIVED", {
    queryId: "Q1",
    changes: { status: { from: null, to: "RECEIVED" } },
  }),
  ev(at("01", "09:32:11"), "QUERY_REGISTERED", {
    queryId: "Q1",
    changes: { status: { from: "RECEIVED", to: "FRONT_OFFICE_VERIFICATION" } },
  }),
  ev(at("01", "09:50:00"), "QUERY_ASSIGNED", {
    queryId: "Q1",
    changes: { status: { from: "PENDING_ASSIGNMENT", to: "ASSIGNED" } },
  }),
  ev(at("01", "23:59:00"), "LOGIN_SUCCEEDED"),
  ev(at("02", "00:01:00"), "LOGIN_SUCCEEDED"),
  failedSignIn("13:41:12"),
  failedSignIn("13:42:12"),
  failedSignIn("13:43:12"),
  failedSignIn("13:44:12", "other@ipc.gov.in"),
  ev(at("02", "18:00:00"), "LOGOUT"),
  ev(at("03", "16:42:17"), "AUTHORIZATION_DENIED", {
    result: "denied",
    actorRole: "REVIEWER",
    details: { path: "/api/v1/audit" },
  }),
  ev(at("04", "11:22:06"), "AUDIT_EXPORTED", {
    ...ADMIN,
    details: {
      format: "pdf",
      rows: 12,
      reference: "BRIDGETECH/ATR/2026-09/001",
    },
  }),
  ev(at("04", "11:30:00"), "AUDIT_VIEWED", ADMIN),
  ev(at("04", "12:00:00"), "QUERY_CLOSED", {
    queryId: "Q1",
    changes: { status: { from: "DISPATCHED", to: "CLOSED" } },
  }),
];

const value = (summary, label) => summary.find(([name]) => name === label)?.[1];

describe("the period summary", () => {
  it("counts the period’s activity", () => {
    const summary = periodSummary(ROWS, { ok: true });
    expect(value(summary, "Queries registered")).toBe(1);
    expect(value(summary, "Queries assigned")).toBe(1);
    expect(value(summary, "Queries closed")).toBe(1);
    expect(value(summary, "User sign-ins")).toBe(2);
    expect(value(summary, "Failed sign-in attempts")).toBe(4);
    expect(value(summary, "Sign-outs")).toBe(1);
    expect(value(summary, "Administrative changes")).toBe(0);
    expect(value(summary, "Audit report exports")).toBe(1);
    expect(value(summary, "Audit trail views")).toBe(1);
    expect(value(summary, "Unauthorised access attempts")).toBe(1);
    expect(value(summary, "Critical audit exceptions")).toBe(0);
  });

  it("counts automatic transfers as reassignments", () => {
    const rows = [
      { timestamp: "2026-09-01T05:00:00.000Z", action: "QUERY_TRANSFERRED", queryId: "Q1", actorType: "human" },
      { timestamp: "2026-09-01T06:00:00.000Z", action: "QUERY_AUTO_TRANSFERRED", queryId: "Q2", actorType: "system" },
    ];
    expect(value(periodSummary(rows), "Queries reassigned (transferred)")).toBe(2);
  });

  it("counts integrity breaks as critical exceptions", () => {
    expect(
      value(
        periodSummary(ROWS, { ok: false, breaks: [{ seq: 3 }, { seq: 5 }] }),
        "Critical audit exceptions",
      ),
    ).toBe(2);
  });

  it("takes the period from the filters, else the first and last record", () => {
    expect(reportPeriod({}, ROWS).label).toBe("01 Sep 2026 to 04 Sep 2026");
  });
});

describe("the authentication audit", () => {
  it("groups by day in Indian Standard Time, with totals", () => {
    const { days, total } = authenticationByDay(ROWS);
    expect(
      days.map((day) => [day.date, day.success, day.failed, day.logouts]),
    ).toEqual([
      ["01 Sep 2026", 1, 0, 0],
      ["02 Sep 2026", 1, 4, 1],
    ]);
    expect(total).toEqual({ success: 2, failed: 4, logouts: 1, rejected: 0 });
  });
});

describe("privileged activity", () => {
  it("lists administrative changes and exports with their values and reference", () => {
    const rows = privilegedActivity(ROWS);
    expect(rows.map((row) => row.activity)).toEqual([
      "Activity report downloaded",
    ]);
    expect(rows[0]).toMatchObject({
      administrator: "Suresh Gupta (Administrator)",
      object: "Audit report (PDF)",
      previous: "Not downloaded",
      next: "Downloaded: 12 records",
      reference: "BRIDGETECH/ATR/2026-09/001",
    });
  });

  it("gives every administrative activity an old and a new value", () => {
    const rows = privilegedActivity([
      ev(at("05", "10:10:00"), "QUERY_PULLED_BACK", {
        ...ADMIN,
        queryId: "Q1",
        changes: { status: { from: "CLOSED", to: "DRAFTING" } },
      }),
    ]);
    expect(rows.map((row) => [row.object, row.previous, row.next])).toEqual([
      ["Q1", "Closed", "Reply being written"],
    ]);
  });
});

describe("security events", () => {
  it("groups three or more failed sign-ins by address, and lists refused access", () => {
    const events = securityExceptions(ROWS);
    expect(events.map((event) => [event.event, event.severity])).toEqual([
      ["Repeated failed sign-in (3 attempts)", "Low"],
      ["Tried to open Activity records without permission", "Medium"],
    ]);
    expect(events.every((event) => event.status === "Open - for review")).toBe(
      true,
    );
  });

  it("raises ten or more failed attempts to Medium and integrity breaks to Critical", () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      failedSignIn(`14:${String(i).padStart(2, "0")}:00`, "x@ipc.gov.in"),
    );
    const events = securityExceptions(many, {
      ok: false,
      breaks: [{ seq: 7, reason: "hash" }],
    });
    expect(
      events.find((event) => event.event.startsWith("Repeated")).severity,
    ).toBe("Medium");
    expect(events.find((event) => event.severity === "Critical").event).toBe(
      "Audit record altered at AUD-000007",
    );
  });
});

describe("the query lifecycle", () => {
  it("shows the case status after each step", () => {
    expect(
      lifecycle(ROWS, "Q1").map((step) => [step.activity, step.status]),
    ).toEqual([
      ["New query received", "Received"],
      ["Query accepted and registered", "Being checked by Front Office"],
      ["Given to an officer to answer", "With an officer"],
      ["Query closed", "Closed"],
    ]);
  });

  it("marks a status worked out from the history rather than recorded", () => {
    const rows = [
      { timestamp: "2026-10-01T05:00:00.000Z", action: "QUERY_FORWARDED", queryId: "Q2", actorType: "human", changes: { status: { from: "FRONT_OFFICE_VERIFICATION", to: "PENDING_ASSIGNMENT" } }, changesInferred: true },
    ];
    expect(lifecycle(rows, "Q2")[0].status).toBe("Waiting to be given to an officer (inferred)");
  });
});

describe("findings", () => {
  it("ranks integrity breaks critical and everything else by volume", () => {
    expect(findings(ROWS, { ok: true })).toEqual({
      critical: [],
      major: [],
      minor: [
        "1 unauthorised access attempt(s) were recorded and blocked.",
        "1 account(s) or address(es) had repeated failed sign-ins.",
      ],
    });
    expect(
      findings(ROWS, {
        ok: false,
        breaks: [{ seq: 3 }],
        firstBreak: { seq: 3 },
      }).critical[0],
    ).toMatch(/AUD-000003/);
  });
});

describe("the checklist and controls", () => {
  it("marks what the application does not do as not applicable rather than claiming it", () => {
    const items = Object.fromEntries(
      checklist(ROWS).map(([requirement, status]) => [requirement, status]),
    );
    expect(items["User / role changes recorded"]).toBe("Not applicable");
    expect(items["Database audit logs enabled"]).toBe("Recommended");
    expect(items["Log monitoring performed"]).toBe("Reviewer to confirm");
    expect(checklist(ROWS)).toHaveLength(20);
  });

  it("states the integrity check in words, without hashes", () => {
    expect(controls({ ok: true, checked: 15 }).verdict).toBe(
      "Integrity check: no alteration detected in 15 records.",
    );
    expect(controls({ ok: false, firstBreak: { seq: 9 } }).verdict).toBe(
      "Integrity check: alteration detected at AUD-000009.",
    );
    expect(controls().items).toHaveLength(11);
  });
});

describe("previous and new values for records that did not store them", () => {
  it("works out each step’s status change from the query’s own history", async () => {
    const { inferCaseChanges, changeKeyOf } =
      await import("../services/audit/caseChanges.js");
    const old = [
      {
        seq: 1,
        timestamp: at("01", "09:00:00"),
        action: "QUERY_RECEIVED",
        queryId: "Q9",
      },
      {
        seq: 3,
        timestamp: at("01", "09:02:00"),
        action: "QUERY_REGISTERED",
        queryId: "Q9",
      },
      {
        seq: 4,
        timestamp: at("01", "09:03:00"),
        action: "QUERY_FORWARDED",
        queryId: "Q9",
      },
      {
        seq: 5,
        timestamp: at("01", "09:04:00"),
        action: "QUERY_ASSIGNED",
        queryId: "Q9",
      },
      {
        seq: 6,
        timestamp: at("01", "09:05:00"),
        action: "DRAFT_UPDATED",
        queryId: "Q9",
        details: "Draft submitted for review.",
      },
      {
        seq: 7,
        timestamp: at("01", "09:06:00"),
        action: "REVIEW_COMPLETED",
        queryId: "Q9",
      },
      {
        seq: 8,
        timestamp: at("01", "09:07:00"),
        action: "REVIEW_COMPLETED",
        queryId: "Q9",
      },
      {
        seq: 9,
        timestamp: at("01", "09:08:00"),
        action: "FINAL_APPROVAL_GRANTED",
        queryId: "Q9",
      },
      {
        seq: 10,
        timestamp: at("01", "09:09:00"),
        action: "QUERY_PULLED_BACK",
        queryId: "Q9",
        details: { targetStage: "DRAFTING" },
      },
    ];
    const inferred = inferCaseChanges(old);
    const status = (seq) => inferred.get(changeKeyOf({ seq }))?.status;

    expect(status(1)).toEqual({ from: null, to: "RECEIVED" });
    expect(status(3)).toEqual({
      from: "RECEIVED",
      to: "FRONT_OFFICE_VERIFICATION",
    });
    expect(status(5)).toEqual({ from: "PENDING_ASSIGNMENT", to: "ASSIGNED" });
    expect(status(6)).toEqual({ from: "ASSIGNED", to: "UNDER_REVIEW" });
    expect(status(7)).toBeUndefined(); // a further review level follows: still under review
    expect(status(8)).toEqual({
      from: "UNDER_REVIEW",
      to: "PENDING_FINAL_APPROVAL",
    });
    expect(status(9)).toEqual({
      from: "PENDING_FINAL_APPROVAL",
      to: "READY_FOR_DISPATCH",
    });
    expect(status(10)).toEqual({ from: "READY_FOR_DISPATCH", to: "DRAFTING" });
  });

  it("carries on from values that were stored", async () => {
    const { inferCaseChanges, changeKeyOf } =
      await import("../services/audit/caseChanges.js");
    const inferred = inferCaseChanges([
      {
        seq: 1,
        timestamp: at("01", "09:00:00"),
        action: "QUERY_ASSIGNED",
        queryId: "Q8",
        changes: { status: { from: "PENDING_ASSIGNMENT", to: "ASSIGNED" } },
      },
      {
        seq: 2,
        timestamp: at("01", "09:01:00"),
        action: "DRAFT_GENERATED",
        queryId: "Q8",
      },
    ]);
    expect(inferred.has(changeKeyOf({ seq: 1 }))).toBe(false);
    expect(inferred.get(changeKeyOf({ seq: 2 })).status).toEqual({
      from: "ASSIGNED",
      to: "DRAFTING",
    });
  });

  it("shows the state before and after for activities that are not query changes", async () => {
    const { present } = await import("../services/audit/auditPresentation.js");
    expect(
      present({ action: "LOGIN_SUCCEEDED", actorType: "human" }),
    ).toMatchObject({ previousValue: "Logged out", newValue: "Logged in" });
    expect(
      present({
        action: "EMAIL_MARKED_READ",
        details: { from: "ravi@pharma.example", subject: "Dissolution" },
      }),
    ).toMatchObject({
      previousValue: "Unread",
      newValue: 'Read. From ravi@pharma.example: "Dissolution"',
    });
    expect(
      present({
        action: "SYNC_RECOVERED",
        details: { address: "box@gov.in", seconds: 120 },
      }),
    ).toMatchObject({
      previousValue: "Not reachable",
    });
  });
});

describe("who did what", () => {
  it("names the person, their role and the other person involved, in everyday words", async () => {
    const { present } = await import("../services/audit/auditPresentation.js");
    const say = (event) => present({ actorType: "human", ...event }).narrative;
    expect(
      say({
        action: "QUERY_FORWARDED",
        actorId: "USR-0014",
        actorName: "Priya Sharma",
        actorRole: "FRONT_OFFICE",
        queryId: "Q1",
      }),
    ).toBe(
      "By: Priya Sharma (Front Office) -> Forwarded query Q1 for assignment -> To: EduTR Zairza (Officer-in-Charge)",
    );
    expect(
      say({
        action: "QUERY_ASSIGNED",
        actorId: "USR-0003",
        actorRole: "OFFICER_IN_CHARGE",
        queryId: "Q1",
        details: "Assigned to Neha Singh.",
      }),
    ).toBe(
      "By: EduTR Zairza (Officer-in-Charge) -> Gave query Q1 to an officer to answer -> To: Neha Singh (Assigned Official)",
    );
    expect(
      say({
        action: "REVIEW_ADDED",
        actorId: "USR-0004",
        actorRole: "ASSIGNED_OFFICIAL",
        queryId: "Q1",
        details: "Review level added for Amit Mehta.",
      }),
    ).toBe(
      "By: Neha Singh (Assigned Official) -> Asked for the reply to query Q1 to be checked -> To: Amit Mehta (Reviewer)",
    );
    expect(
      say({
        action: "QUERY_TRANSFERRED",
        actorId: "USR-0004",
        actorRole: "ASSIGNED_OFFICIAL",
        queryId: "Q1",
        details:
          "Case ID: Q1 | Transferred From: Neha Singh | Transferred To: Meera Iyer | Transferred By: Neha Singh | Reason: Monograph expertise",
      }),
    ).toBe(
      "By: Neha Singh (Assigned Official) -> Handed query Q1 over from Neha Singh (Assigned Official) (reason: Monograph expertise) -> To: Meera Iyer (Assigned Official)",
    );
    expect(
      say({
        action: "LOGIN_FAILED",
        details: { email: "x@ipc.gov.in", reason: "invalid email or password" },
      }),
    ).toBe(
      "By: x@ipc.gov.in (not logged in) -> Tried to log in as x@ipc.gov.in, but the email or password was wrong",
    );
    expect(
      say({
        action: "SYNC_COMPLETED",
        actorType: "system",
        details: { stored: 3, providerMessageIds: ["1"] },
      }),
    ).toBe(
      "By: System (automatic) -> Checked the mailbox and brought in 3 new email(s)",
    );
  });
});

describe("user column", () => {
  it("gives the name, role and user ID of whoever did it", async () => {
    const { present } = await import("../services/audit/auditPresentation.js");
    const card = (event) => present({ actorType: "human", ...event }).userCard;
    expect(
      card({
        action: "QUERY_FORWARDED",
        actorId: "USR-0014",
        actorName: "Priya Sharma",
        actorRole: "FRONT_OFFICE",
      }),
    ).toEqual({
      name: "Priya Sharma",
      role: "Front Office",
      id: "USR-0014",
    });
    expect(card({ action: "SYNC_COMPLETED", actorType: "system" })).toEqual({
      name: "System",
      role: "Automatic process",
      id: "",
    });
    expect(
      card({ action: "LOGIN_FAILED", details: { email: "x@ipc.gov.in" } }),
    ).toEqual({ name: "x@ipc.gov.in", role: "Not logged in", id: "" });
  });
});
