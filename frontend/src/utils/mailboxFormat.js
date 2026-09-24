
const SNIPPET_LENGTH = 140;

export function parseSender(from) {
  if (!from) return { name: "Unknown Sender", email: "", initials: "M" };

  const name = from.split("<")[0].trim() || "Unknown Sender";
  const email = from.includes("<")
    ? from.split("<")[1].replace(">", "").trim()
    : "";
  const initials =
    name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .slice(0, 2)
      .toUpperCase() || "M";

  return { name, email, initials };
}

function toDate(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

export function formatReceived(receivedAt) {
  const date = toDate(receivedAt);
  if (!date) return { date: "—", time: "" };

  return {
    date: date.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }),
    time: date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true,
    }),
  };
}

export function formatFullDate(value) {
  const date = toDate(value);
  return date
    ? date.toLocaleString("en-IN", { dateStyle: "full", timeStyle: "long" })
    : "—";
}

export function toSnippet(body) {
  const text = String(body ?? "").replace(/\s+/g, " ").trim();
  return text.length > SNIPPET_LENGTH
    ? `${text.slice(0, SNIPPET_LENGTH - 1).trimEnd()}…`
    : text;
}
