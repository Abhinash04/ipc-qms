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
  { value: "USER_REGISTRATION_REQUESTED", label: "Asked for an account", group: "Accounts" },
  { value: "USER_ROLE_ASSIGNED", label: "Role given to an account", group: "Accounts" },
  { value: "USER_APPROVED", label: "Account approved", group: "Accounts" },
  { value: "USER_REJECTED", label: "Account request rejected", group: "Accounts" },
  { value: "USER_DEACTIVATED", label: "Account deactivated", group: "Accounts" },
  { value: "USER_ACTIVATED", label: "Account reactivated", group: "Accounts" },
  { value: "USER_CREATED", label: "Account created", group: "Accounts" },
  { value: "USER_UPDATED", label: "Account details changed", group: "Accounts" },
  { value: "USER_PASSWORD_RESET", label: "Account password reset", group: "Accounts" },
  { value: "QUERY_RECEIVED", label: "New query received", group: "Query handling" },
  { value: "QUERY_REGISTERED", label: "Query accepted and registered", group: "Query handling" },
  { value: "ACKNOWLEDGEMENT_SENT", label: "\"We have received your query\" email sent", group: "Query handling" },
  { value: "QUERY_FORWARDED", label: "Sent to the Officer-in-Charge", group: "Query handling" },
  { value: "QUERY_ASSIGNED", label: "Given to an officer to answer", group: "Query handling" },
  { value: "ASSIGNMENT_OVERRIDDEN", label: "Different officer chosen than suggested", group: "Query handling" },
  { value: "QUERY_TRANSFERRED", label: "Handed over to another officer", group: "Query handling" },
  { value: "QUERY_AUTO_TRANSFERRED", label: "Handed over to another officer automatically", group: "Query handling" },
  { value: "QUERY_AUTO_TRANSFER_FAILED", label: "Automatic handover found no officer", group: "Query handling" },
  { value: "DRAFT_GENERATED", label: "Suggested reply prepared", group: "Query handling" },
  { value: "DRAFT_UPDATED", label: "Reply updated", group: "Query handling" },
  { value: "REVIEW_ADDED", label: "Reply sent for checking", group: "Query handling" },
  { value: "REVIEW_REMOVED", label: "Checking step removed", group: "Query handling" },
  { value: "REVIEW_COMPLETED", label: "Reply checked and approved", group: "Query handling" },
  { value: "REVISION_REQUESTED", label: "Changes asked for in the reply", group: "Query handling" },
  { value: "FINAL_APPROVAL_GRANTED", label: "Reply given final approval", group: "Query handling" },
  { value: "FINAL_APPROVAL_REJECTED", label: "Final approval refused", group: "Query handling" },
  { value: "RESPONSE_DISPATCHED", label: "Reply emailed to the person who asked", group: "Query handling" },
  { value: "QUERY_CLOSED", label: "Query closed", group: "Query handling" },
  { value: "QUERY_PULLED_BACK", label: "Moved back to an earlier step", group: "Query handling" },
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
  { value: "AI_ASSIGNMENT_RECOMMENDED", label: "Suitable officer suggested automatically", group: "AI" },
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
  { value: "AUTO_REPLY_SUGGESTED", label: "Automatic reply suggested", group: "Auto reply" },
  { value: "AUTO_REPLY_PREPARED", label: "Automatic reply prepared", group: "Auto reply" },
  { value: "AUTO_REPLY_APPROVED", label: "Automatic reply approved", group: "Auto reply" },
  { value: "AUTO_REPLY_DECLINED", label: "Automatic reply turned down", group: "Auto reply" },
  { value: "AUDIT_EXPORTED", label: "Activity report downloaded", group: "Audit" },
  { value: "AUDIT_VERIFIED", label: "Records checked for tampering", group: "Audit" },
  { value: "AUDIT_VIEWED", label: "Activity records viewed", group: "Audit" },
  { value: "AUDIT_CHAIN_RESET", label: "Activity records restarted (test system only)", group: "Audit" },
  { value: "QUERY_STATE_RESET", label: "All query data cleared (test system only)", group: "Audit" },
];

/** The options in their groups, in order, for a grouped select. */
export const AUDIT_ACTION_GROUPS = AUDIT_ACTION_OPTIONS.reduce((groups, option) => {
  const last = groups.at(-1);
  if (last?.group === option.group) last.options.push(option);
  else groups.push({ group: option.group, options: [option] });
  return groups;
}, []);

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
