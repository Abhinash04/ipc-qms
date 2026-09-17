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
    counters: { QRY: 0, THREAD: 0, MSG: 0, AUD: 0, NOTIF: 0, STEP: 0, REV: 0, RESP: 0 },
  };
}
