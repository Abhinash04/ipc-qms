import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import { AppRoutes } from "@/routes/AppRoutes";
import { useAuthStore } from "@/store/useAuthStore";
import { useWorkflowStore } from "@/store/useWorkflowStore";
import { findUserById } from "@/constants/mockUsers";
import { ROLES } from "@/constants/roles";
import { WORKFLOW_STATE } from "@/constants/statusEnums";
import * as mailboxService from "@/services/api/mailboxService";

vi.mock("@/services/api/mailboxService");

const INQUIRER = findUserById("USR-0001");
const OTHER_INQUIRER = {
  id: "USR-OTHER-INQUIRER",
  name: "Another Inquirer",
  role: ROLES.INQUIRER,
  email: "another.inquirer@example.com",
};
const FRONT_OFFICE = findUserById("USR-0002");

const SUBJECT = "Clarification on monograph revision";
const BODY = "Please clarify the applicable monograph for our submission.";

const s = () => useWorkflowStore.getState();

function renderAt(path) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function signIn(user) {
  useAuthStore.setState({ currentUser: user });
}

function tile(label) {
  return screen
    .getByRole("heading", { level: 3, name: label })
    .closest(".bento-card");
}

function tileCount(label) {
  const el = within(tile(label)).getByText(/^\d+ quer(?:y|ies)$/);
  return Number(el.textContent.match(/^\d+/)[0]);
}

async function raiseThroughPortal(subject = SUBJECT) {
  const { unmount } = renderAt("/inquirer/compose");
  fireEvent.change(await screen.findByLabelText("Subject"), {
    target: { value: subject },
  });
  fireEvent.change(screen.getByLabelText("Message"), {
    target: { value: BODY },
  });
  fireEvent.click(screen.getByRole("button", { name: /Send enquiry/ }));
  await screen.findByText("Enquiry raised");
  unmount();
  return s().queries.find((q) => q.subject === subject);
}

const mailboxCopy = (overrides = {}) => ({
  mailboxMessageId: "MSG-INBOX-0001",
  to: "ipc-query-mock@example.com",
  from: `${INQUIRER.name} <${INQUIRER.email}>`,
  subject: SUBJECT,
  body: BODY,
  receivedAt: new Date().toISOString(),
  ...overrides,
});

beforeEach(async () => {
  vi.clearAllMocks();
  vi.mocked(mailboxService.fetchEmailConfig).mockResolvedValue({
    transport: "mock",
    ipcQueryEmail: "ipc-query-mock@example.com",
    ipcReplyFrom: { email: "arnd@test.invalid", name: "AR&D Division" },
    inquirer: { email: INQUIRER.email, name: INQUIRER.name },
  });
  vi.mocked(mailboxService.sendEnquiry).mockResolvedValue({
    providerMessageId: "sent-copy-id",
    providerThreadId: "sent-thread-id",
  });
  vi.mocked(mailboxService.fetchMailboxMessages).mockResolvedValue({
    messages: [],
  });
  vi.mocked(mailboxService.markMessageIngested).mockResolvedValue({
    ingested: true,
  });

  await s().hydrate();
  await s().resetDemo();
  signIn(INQUIRER);
});

describe("raising an enquiry opens a case straight away", () => {
  it("creates a case carrying the signed-in inquirers identity", async () => {
    const raised = await raiseThroughPortal();

    expect(raised).toBeDefined();
    expect(raised.source).toBe("Portal");
    expect(raised.workflowState).toBe(WORKFLOW_STATE.RECEIVED);
    expect(raised.inquirer.id).toBe(INQUIRER.id);
    expect(raised.inquirer.email).toBe(INQUIRER.email);
    expect(raised.sourceMailboxMessageId).toBeNull();
  });

  it("does not carry the inquirers own Gmail thread id", async () => {
    const raised = await raiseThroughPortal();

    // sendEnquiry returns a thread id, but it is private to the inquirer's
    // mailbox. Storing it made Front Office's forward reply into a thread it
    // cannot see, which Gmail rejects — the 404 on /emails/forward.
    const incoming = s().emailMessages.find((m) => m.queryId === raised.queryId);
    expect(incoming.providerThreadId).toBeNull();
  });

  it("shows it on the inquirers own dashboard with no refresh", async () => {
    const raised = await raiseThroughPortal();

    renderAt("/inquirer/dashboard");
    expect(tileCount("Total Queries")).toBe(1);
    expect(tileCount("Open Queries")).toBe(1);
    expect(screen.getByText(raised.queryId)).toBeInTheDocument();
    expect(screen.getByText(SUBJECT)).toBeInTheDocument();
  });

  it("shows it to Front Office as incoming work", async () => {
    const raised = await raiseThroughPortal();

    signIn(FRONT_OFFICE);
    renderAt("/front-officer/dashboard");
    expect(tileCount("New / Incoming")).toBe(1);
    expect(screen.getAllByText(raised.queryId).length).toBeGreaterThan(0);
  });

  it("keeps it away from a different inquirer", async () => {
    await raiseThroughPortal();

    signIn(OTHER_INQUIRER);
    renderAt("/inquirer/dashboard");
    expect(tileCount("Total Queries")).toBe(0);
    expect(screen.queryByText(SUBJECT)).toBeNull();
  });

  it("still sends the enquiry email, so the mail trail survives", async () => {
    await raiseThroughPortal();
    expect(mailboxService.sendEnquiry).toHaveBeenCalledWith({
      subject: SUBJECT,
      body: BODY,
    });
  });
});

describe("the mailbox copy attaches to the portal case instead of duplicating it", () => {
  it("claims the matching mail rather than opening a second case", async () => {
    const raised = await raiseThroughPortal();
    expect(s().queries).toHaveLength(1);

    const result = s().ingestEmail(mailboxCopy(), async () => null);

    expect(s().queries).toHaveLength(1);
    expect(result.created).toBe(false);
    expect(result.queryId).toBe(raised.queryId);

    const claimed = s().queries[0];
    expect(claimed.sourceMailboxMessageId).toBe("MSG-INBOX-0001");
    // The inbound copy joined the existing thread.
    expect(
      s().emailMessages.filter((m) => m.queryId === raised.queryId).length,
    ).toBeGreaterThan(1);
  });

  it("matches through a Re: prefix and differing whitespace", async () => {
    const raised = await raiseThroughPortal();

    s().ingestEmail(
      mailboxCopy({ subject: `Re:  ${SUBJECT}  ` }),
      async () => null,
    );

    expect(s().queries).toHaveLength(1);
    expect(s().queries[0].queryId).toBe(raised.queryId);
  });

  it("claims only once — a later, unrelated mail opens its own case", async () => {
    await raiseThroughPortal();
    s().ingestEmail(mailboxCopy(), async () => null);
    expect(s().queries).toHaveLength(1);

    s().ingestEmail(
      mailboxCopy({
        mailboxMessageId: "MSG-INBOX-0002",
        subject: "A different question",
      }),
      async () => null,
    );
    expect(s().queries).toHaveLength(2);
  });

  it("does not claim a mail from a different sender", async () => {
    await raiseThroughPortal();

    s().ingestEmail(
      mailboxCopy({
        mailboxMessageId: "MSG-INBOX-0003",
        from: "Someone Else <someone.else@example.com>",
      }),
      async () => null,
    );

    expect(s().queries).toHaveLength(2);
  });

  it("does not claim a mail that arrives far outside the matching window", async () => {
    await raiseThroughPortal();
    const muchLater = new Date(
      Date.now() + 3 * 24 * 60 * 60 * 1000,
    ).toISOString();

    s().ingestEmail(
      mailboxCopy({
        mailboxMessageId: "MSG-INBOX-0004",
        receivedAt: muchLater,
      }),
      async () => null,
    );

    expect(s().queries).toHaveLength(2);
  });

  it("leaves ordinary email intake untouched when no portal case exists", async () => {
    const result = s().ingestEmail(mailboxCopy(), async () => null);

    expect(result.created).toBe(true);
    expect(s().queries).toHaveLength(1);
    expect(s().queries[0].source).toBe("Email");
    expect(s().queries[0].sourceMailboxMessageId).toBe("MSG-INBOX-0001");
  });
});

describe("the case stays visible as it moves through the workflow", () => {
  it("reaches the OIC once Front Office verifies and forwards it", async () => {
    const raised = await raiseThroughPortal();

    s().verifyQuery(raised.queryId, FRONT_OFFICE);
    await s().forwardToOic(raised.queryId, FRONT_OFFICE, async () => ({
      providerMessageId: "fwd-1",
      providerThreadId: "fwd-thread",
      sentAt: new Date().toISOString(),
      from: "fo@test.invalid",
      to: ["oic@test.invalid"],
      subject: "Fwd",
      body: "x",
    }));

    signIn(findUserById("USR-0003"));
    renderAt("/officer-in-charge/dashboard");
    await waitFor(() => expect(tileCount("Awaiting Assignment")).toBe(1));
    expect(screen.getAllByText(raised.queryId).length).toBeGreaterThan(0);
  });
});
