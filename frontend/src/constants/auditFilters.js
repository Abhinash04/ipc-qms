export const AUDIT_ACTION_OPTIONS = [
  { value: "LOGIN_SUCCEEDED", label: "Logged in", group: "Access" },
  { value: "LOGIN_FAILED", label: "Login attempt failed", group: "Access" },
  { value: "LOGOUT", label: "Logged out", group: "Access" },
  { value: "AUTHENTICATION_FAILED", label: "Login session expired or not valid", group: "Access" },
  {
    value: "AUTHORIZATION_DENIED",
    label: "Tried to open something without permission",
    group: "Access",
  },
  { value: "EMAIL_RECEIVED", label: "Email taken in from the mailbox", group: "Email" },
  { value: "EMAIL_READ", label: "Mailbox opened", group: "Email" },
  { value: "EMAIL_SENT", label: "Email sent", group: "Email" },
  { value: "EMAIL_FORWARDED", label: "Email forwarded", group: "Email" },
  { value: "EMAIL_REPLIED", label: "Reply emailed", group: "Email" },
  { value: "EMAIL_SEND_FAILED", label: "Email could not be sent", group: "Email" },
  { value: "EMAIL_DELETED", label: "Email deleted", group: "Email" },
  { value: "AI_SUMMARY_GENERATED", label: "Short summary of the query prepared automatically", group: "AI" },
  { value: "AI_DRAFT_GENERATED", label: "Suggested reply prepared automatically", group: "AI" },
  {
    value: "AI_RECOMMENDATION_GENERATED",
    label: "Suitable officers suggested automatically",
    group: "AI",
  },
  {
    value: "ATTACHMENT_UPLOADED",
    label: "File attached",
    group: "Attachments",
  },
  {
    value: "ATTACHMENT_DOWNLOADED",
    label: "File opened or downloaded",
    group: "Attachments",
  },
  { value: "AUDIT_EXPORTED", label: "Activity report downloaded", group: "Audit" },
  { value: "AUDIT_VERIFIED", label: "Records checked for tampering", group: "Audit" },
  { value: "AUDIT_VIEWED", label: "Activity records viewed", group: "Audit" },
];

export const EMAIL_ACTIONS = AUDIT_ACTION_OPTIONS.filter(
  (o) => o.group === "Email",
).map((o) => o.value);
export const AI_ACTIONS = AUDIT_ACTION_OPTIONS.filter(
  (o) => o.group === "AI",
).map((o) => o.value);

export const RESULT_OPTIONS = [
  { value: "success", label: "Success" },
  { value: "failure", label: "Failure" },
  { value: "denied", label: "Denied" },
];

export const ACTOR_OPTIONS = [
  { value: "human", label: "User" },
  { value: "agent", label: "AI agent" },
  { value: "system", label: "System" },
];
