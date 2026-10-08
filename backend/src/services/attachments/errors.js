class AttachmentUnavailableError extends Error {
  constructor(unavailable) {
    const names = unavailable.map((u) => u.filename || u.attachmentId || 'unknown').join(', ');
    super(`Attachment(s) unavailable: ${names}`);
    this.name = 'AttachmentUnavailableError';
    this.status = 409;
    this.unavailableAttachments = unavailable;
    this.details = { unavailableAttachments: unavailable };
  }
}

export { AttachmentUnavailableError };
