export function buildSeedState() {
  return {
    queries: [],
    workflowSteps: [],
    reviews: [],
    responseVersions: [],
    auditEvents: [],
    notifications: [],
    emailMessages: [],
    emailThreads: [],
    // One row per email a case owes someone, and whether it has been sent. The
    // server owns these; the page reads them to know what a retry may do.
    outboundEmails: [],
    counters: { QRY: 0, THREAD: 0, MSG: 0, AUD: 0, NOTIF: 0, STEP: 0, REV: 0, RESP: 0 },
  };
}
