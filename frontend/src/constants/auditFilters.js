export const AUDIT_ACTION_OPTIONS = [
  { value: "LOGIN_SUCCEEDED", label: "Login succeeded", group: "Access" },
  { value: "LOGIN_FAILED", label: "Login failed", group: "Access" },
  {
    value: "AUTHORIZATION_DENIED",
    label: "Authorization denied",
    group: "Access",
  },
  { value: "EMAIL_RECEIVED", label: "Email received", group: "Email" },
  { value: "EMAIL_READ", label: "Mailbox read", group: "Email" },
  { value: "EMAIL_SENT", label: "Email sent", group: "Email" },
  { value: "EMAIL_FORWARDED", label: "Email forwarded", group: "Email" },
  { value: "EMAIL_REPLIED", label: "Response dispatched", group: "Email" },
  { value: "EMAIL_SEND_FAILED", label: "Email send failed", group: "Email" },
  { value: "EMAIL_DELETED", label: "Email deleted", group: "Email" },
  { value: "AI_SUMMARY_GENERATED", label: "AI summary generated", group: "AI" },
  { value: "AI_DRAFT_GENERATED", label: "AI draft generated", group: "AI" },
  {
    value: "AI_RECOMMENDATION_GENERATED",
    label: "AI recommendation generated",
    group: "AI",
  },
  {
    value: "ATTACHMENT_UPLOADED",
    label: "Attachment uploaded",
    group: "Attachments",
  },
  {
    value: "ATTACHMENT_DOWNLOADED",
    label: "Attachment downloaded",
    group: "Attachments",
  },
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
