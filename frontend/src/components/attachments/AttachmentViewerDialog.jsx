import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { attachmentUrl, fetchAttachmentMeta } from '@/services/api/attachmentService';

function previewKind(mimeType) {
  if (!mimeType) return 'none';
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType === 'application/pdf') return 'pdf';
  if (mimeType === 'text/plain' || mimeType === 'text/csv') return 'text';
  return 'none';
}

function AttachmentPreview({ kind, url, attachment, textContent, onUnavailable }) {
  if (kind === 'image') {
    return (
      <img
        src={url}
        alt={attachment.filename}
        className="max-h-[70vh] w-full rounded-lg object-contain"
        onError={onUnavailable}
      />
    );
  }
  if (kind === 'video') {
    return <video src={url} controls className="max-h-[70vh] w-full rounded-lg" />;
  }
  if (kind === 'audio') {
    return <audio src={url} controls className="w-full" />;
  }
  if (kind === 'pdf') {
    return (
      <iframe
        src={url}
        title={attachment.filename}
        sandbox="allow-scripts"
        className="h-[70vh] w-full rounded-lg border border-slate-200"
      />
    );
  }
  if (kind === 'text') {
    return (
      <pre className="max-h-[70vh] overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs whitespace-pre-wrap">
        {textContent ?? 'Loading…'}
      </pre>
    );
  }
  return (
    <p className="text-sm text-slate-600">
      Preview not available for this file type.{' '}
      <a
        href={attachmentUrl(attachment.attachmentId, { download: true })}
        className="font-bold text-blue-700 underline"
      >
        Download instead
      </a>
    </p>
  );
}

export function AttachmentViewerDialog({ attachment, onClose }) {
  const [unavailable, setUnavailable] = useState(false);
  const [textContent, setTextContent] = useState(null);
  const kind = previewKind(attachment.mimeType);
  const url = attachmentUrl(attachment.attachmentId);

  useEffect(() => {
    let cancelled = false;
    fetchAttachmentMeta(attachment.attachmentId).catch(() => {
      if (!cancelled) setUnavailable(true);
    });
    return () => {
      cancelled = true;
    };
  }, [attachment.attachmentId]);

  useEffect(() => {
    if (kind !== 'text') return undefined;
    let cancelled = false;
    fetch(url)
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error('fetch failed'))))
      .then((text) => {
        if (!cancelled) setTextContent(text);
      })
      .catch(() => {
        if (!cancelled) setUnavailable(true);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachment.attachmentId, kind]);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{attachment.filename}</DialogTitle>
          <DialogDescription>{attachment.mimeType || 'Unknown type'}</DialogDescription>
        </DialogHeader>

        {unavailable ? (
          <p role="status" className="text-sm text-rose-600">
            This attachment is no longer available.
          </p>
        ) : (
          <AttachmentPreview
            kind={kind}
            url={url}
            attachment={attachment}
            textContent={textContent}
            onUnavailable={() => setUnavailable(true)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
