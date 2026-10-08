import { useId, useState } from "react";
import { Loader2 } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/utils/cn";

// The server keeps a decision comment up to this length.
const MAX_COMMENT = 2000;

const CONFIRM_TONE = {
  approve: "",
  change: "bg-status-orange-fg text-white hover:bg-status-orange-fg/90 focus-visible:ring-status-orange-fg/30",
  reject: "",
};

/**
 * One decision with its comment: approving (the comment is optional) or sending back and
 * rejecting (it is required). `onSubmit(comment)` resolves to true when the decision was made;
 * the dialog then closes. Otherwise it stays open with `error`.
 */
export function DecisionCommentDialog({
  open,
  onOpenChange,
  title,
  description,
  label,
  placeholder,
  required = false,
  confirmLabel,
  tone = "approve",
  error = null,
  maxLength = MAX_COMMENT,
  hint = null,
  onSubmit,
}) {
  const fieldId = useId();
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const trimmed = comment.trim();

  // Closing clears the comment, so the next opening starts empty.
  const change = (next) => {
    if (submitting) return;
    if (!next) setComment("");
    onOpenChange(next);
  };

  const submit = async (event) => {
    event.preventDefault();
    if (required && !trimmed) return;
    setSubmitting(true);
    try {
      if (await onSubmit(trimmed)) {
        setComment("");
        onOpenChange(false);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description && <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor={fieldId}>{label}</Label>
            <Textarea
              id={fieldId}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder={placeholder}
              maxLength={maxLength}
              rows={5}
              required={required}
              disabled={submitting}
              aria-describedby={`${fieldId}-hint`}
            />
            <p id={`${fieldId}-hint`} className="m-0 text-xs text-muted-foreground">
              {hint ?? (required ? "Required. The officer works from what you write here." : "Optional. Recorded with your approval.")}
            </p>
          </div>

          {error && (
            <p role="alert" className="m-0 rounded-md border border-status-red-line bg-status-red-bg px-3 py-2 text-sm text-status-red-fg">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" disabled={submitting} onClick={() => change(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant={tone === "reject" ? "destructive" : "primary"}
              className={cn(CONFIRM_TONE[tone])}
              disabled={submitting || (required && !trimmed)}
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
