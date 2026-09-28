export const TONES = {
  total: "primary",
  open: "amber",
  incoming: "blue",
  assigned: "blue",
  inProgress: "sky",
  pendingAssignment: "amber",
  awaitingAssignment: "amber",
  awaitingFinalApproval: "purple",
  awaitingReview: "amber",
  drafting: "amber",
  awaitingDispatch: "purple",
  submitted: "purple",
  returned: "rose",
  returnedByMe: "rose",
  closed: "emerald",
  dispatched: "emerald",
  approved: "emerald",
  approvedByMe: "emerald",
  completed: "emerald",
};

export const styleFor = (key) => ({ tone: TONES[key] || "slate" });
