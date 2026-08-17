import { useState } from 'react';
import { Sparkles, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { logAiDraft } from '@/features/applications/application.api';

/**
 * Small "AI Generate" affordance placed above a textarea. Runs the supplied
 * async `generate()` (which analyses the surrounding form/case data), shows a
 * loading state, then hands the result to `onGenerated` to populate the field —
 * the user edits the result normally before saving.
 *
 * Optional `audit={{ applicationId, field }}` records the generated draft in the
 * audit log (best-effort, non-blocking) for case-scoped textareas (Bug 2).
 */
export function AiGenerateButton({ generate, onGenerated, disabled, label = 'AI Generate', className, audit }) {
  const [loading, setLoading] = useState(false);

  const run = async () => {
    setLoading(true);
    try {
      const text = await generate();
      if (text != null) {
        onGenerated(text);
        if (audit?.applicationId) logAiDraft(audit.applicationId, { field: audit.field, content: text });
      }
    } catch {
      toast.error('Could not generate content.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={disabled || loading}
      onClick={run}
      className={cn('h-7 gap-1.5 px-2 text-xs font-medium text-primary', className)}
      title="Generate a draft from the entered data"
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
      {loading ? 'Generating…' : label}
    </Button>
  );
}
