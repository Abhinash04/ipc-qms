import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { DecisionCommentDialog } from '@/components/workflow/DecisionCommentDialog';

function Harness({ required = false, onSubmit, error = null }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <DecisionCommentDialog
        open={open}
        onOpenChange={setOpen}
        title="Decide"
        label="Comment"
        placeholder="Write here"
        required={required}
        confirmLabel="Confirm"
        error={error}
        onSubmit={onSubmit}
      />
    </>
  );
}

const open = () => fireEvent.click(screen.getByRole('button', { name: 'Open' }));
const box = () => screen.getByRole('textbox', { name: 'Comment' });
const confirm = () => screen.getByRole('button', { name: 'Confirm' });

describe('the decision comment dialog', () => {
  it('submits an optional comment even when it is left empty', async () => {
    const onSubmit = vi.fn(async () => true);
    render(<Harness onSubmit={onSubmit} />);
    open();

    expect(confirm()).toBeEnabled();
    fireEvent.click(confirm());

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(''));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('holds a required comment until something is written, and sends it trimmed', async () => {
    const onSubmit = vi.fn(async () => true);
    render(<Harness required onSubmit={onSubmit} />);
    open();

    expect(confirm()).toBeDisabled();
    fireEvent.change(box(), { target: { value: '   ' } });
    expect(confirm()).toBeDisabled();

    fireEvent.change(box(), { target: { value: '  Cite the monograph.  ' } });
    fireEvent.click(confirm());

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('Cite the monograph.'));
  });

  it('sends nothing when cancelled, and starts empty when opened again', () => {
    const onSubmit = vi.fn(async () => true);
    render(<Harness onSubmit={onSubmit} />);
    open();
    fireEvent.change(box(), { target: { value: 'Half written' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();

    open();
    expect(box()).toHaveValue('');
  });

  it('stays open with the reason when the decision could not be made', async () => {
    const onSubmit = vi.fn(async () => false);
    render(<Harness onSubmit={onSubmit} error="The case was changed by someone else" />);
    open();
    fireEvent.change(box(), { target: { value: 'Looks right.' } });
    fireEvent.click(confirm());

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('The case was changed by someone else');
    expect(box()).toHaveValue('Looks right.');
  });
});
