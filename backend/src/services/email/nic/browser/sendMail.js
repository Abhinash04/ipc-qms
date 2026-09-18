import browserConfig from '../../../../config/browserConfig.js';
import { withNicemail } from './session.js';
import { SELECTORS, locate, locateInFrames, requireElement } from './selectors.js';

/**
 * Sending one message through the signed-in NICeMail compose form.
 *
 * Only ever called by transports/nicBrowserTransport.js, after the outbound
 * interlock has approved every recipient. Everything it types is the message
 * it was handed — never a credential; the session was signed in by a human.
 *
 * Fails closed: a compose field that cannot be found throws before Send is
 * pressed, so a message is never sent with a recipient, the Cc line or an
 * attachment silently missing.
 */

async function addRecipients(page, key, addresses) {
  const input = await requireElement(page, key);
  for (const address of addresses) {
    await input.first().click();
    await input.first().pressSequentially(address);
    // Zoho turns a typed address into a recipient chip on Enter.
    await input.first().press('Enter');
  }
}

export async function sendMail({ to = [], cc = [], subject = '', body = '', attachments = [] }, { connect } = {}) {
  return withNicemail(
    async (page) => {
      await (await requireElement(page, 'composeButton')).first().click();

      await addRecipients(page, 'toInput', to);

      if (cc.length) {
        if (!(await locate(page, SELECTORS.ccInput))) {
          const toggle = await locate(page, SELECTORS.ccToggle);
          if (toggle) await toggle.first().click();
        }
        await addRecipients(page, 'ccInput', cc);
      }

      await (await requireElement(page, 'subjectInput')).first().fill(subject);

      const editor = await locateInFrames(page, SELECTORS.bodyEditor);
      if (!editor) {
        throw Object.assign(new Error('NICeMail compose body editor was not found.'), { stage: 'ui' });
      }
      await editor.first().click();
      await editor.first().fill(body);

      if (attachments.length) {
        const fileInput = await requireElement(page, 'fileInput');
        await fileInput.first().setInputFiles(
          attachments.map((att) => ({
            name: att.filename,
            mimeType: att.mimeType || 'application/octet-stream',
            buffer: att.content,
          })),
        );
        // Send before an upload finishes would drop the file; wait for each name.
        for (const att of attachments) {
          await page.getByText(att.filename).first().waitFor({ timeout: browserConfig.timeoutMs });
        }
      }

      // Held on to, not looked up again: see the wait below.
      const sendButton = (await requireElement(page, 'sendButton')).first();
      await sendButton.click();

      /**
       * From here on the message may already be on its way, and nothing this
       * agent can observe proves otherwise.
       *
       * The callers record an acknowledgement or a final response only once a
       * send succeeds, so their idempotency depends on this function never
       * calling a sent message a failure. It used to: waiting for the form to
       * close re-ran `requireElement('sendButton')`, which throws when the
       * button is gone — and a successful send is precisely what removes it.
       * The most ordinary success was reported as "sendButton was not found",
       * nothing was recorded, and the next retry mailed the inquirer again.
       * Waiting on the locator captured before the click resolves as soon as
       * the button is gone, including when it went before the wait began.
       *
       * The compose form closing is the ONLY signal accepted. It used to be
       * enough for any `[role=alert]` or `[role=status]` to be on the page —
       * which a permanent status region satisfies before anything happens, and
       * which an error such as "invalid recipient" satisfies while the form
       * stays open. Either reported a message as sent that never left, and
       * final approval then closed the case on it. A failed send keeps the form
       * open, so it can no longer pass for a successful one.
       *
       * If the form has not closed in time the outcome is genuinely unknown,
       * and the error says so rather than posing as an ordinary failure: a
       * blind retry of a message that did go out is a duplicate to a member of
       * the public, from an official mailbox.
       *
       * `status` and `details` are for the case page's retry buttons, which
       * reach this through HTTP. The error handler hides the message of an
       * error without a status outside development, so the warning arrived as
       * a bare "Internal Server Error" — exactly where the retry is pressed.
       * 504: the mailbox, upstream of this server, did not confirm in time.
       */
      try {
        await sendButton.waitFor({ state: 'detached', timeout: browserConfig.timeoutMs });
      } catch (cause) {
        throw Object.assign(
          new Error(
            'NICeMail may have sent this message but did not confirm it in time. ' +
              'Check the NICeMail Sent folder before retrying — a retry after a send ' +
              'that did go out reaches the recipient twice.',
          ),
          { unconfirmed: true, stage: 'confirm_send', cause, status: 504, details: { unconfirmed: true } },
        );
      }

      // NICeMail's web UI exposes no message id for what it just sent.
      return { ok: true, providerMessageId: null };
    },
    { connect },
  );
}
