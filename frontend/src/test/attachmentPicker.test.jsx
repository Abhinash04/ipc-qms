import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { AttachmentPicker } from '@/components/attachments/AttachmentPicker';

function file(name, type, size = 10) {
  const f = new File(['x'.repeat(size)], name, { type });
  Object.defineProperty(f, 'size', { value: size });
  return f;
}

function Harness() {
  const [files, setFiles] = useState([]);
  return <AttachmentPicker files={files} onChange={setFiles} />;
}

function input() {
  return document.getElementById('attachment-file-input');
}

describe('AttachmentPicker', () => {
  it('adds a single selected file to the pending list', () => {
    render(<Harness />);
    fireEvent.change(input(), { target: { files: [file('spec.pdf', 'application/pdf')] } });

    expect(screen.getByText('spec.pdf')).toBeInTheDocument();
  });

  it('adds multiple files from one selection', () => {
    render(<Harness />);
    fireEvent.change(input(), {
      target: { files: [file('a.pdf', 'application/pdf'), file('b.png', 'image/png')] },
    });

    expect(screen.getByText('a.pdf')).toBeInTheDocument();
    expect(screen.getByText('b.png')).toBeInTheDocument();
  });

  it('flags an unsupported file type inline rather than silently accepting it', () => {
    render(<Harness />);
    fireEvent.change(input(), { target: { files: [file('virus.exe', 'application/x-msdownload')] } });

    expect(screen.getByText('virus.exe')).toBeInTheDocument();
    expect(screen.getByText('unsupported file type')).toBeInTheDocument();
  });

  it('flags an oversize file inline', () => {
    render(<Harness />);
    const huge = file('huge.pdf', 'application/pdf', 11 * 1024 * 1024);
    fireEvent.change(input(), { target: { files: [huge] } });

    expect(screen.getByText(/exceeds 10MB/)).toBeInTheDocument();
  });

  it('removes a pending file', () => {
    render(<Harness />);
    fireEvent.change(input(), { target: { files: [file('spec.pdf', 'application/pdf')] } });
    expect(screen.getByText('spec.pdf')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Remove spec.pdf'));
    expect(screen.queryByText('spec.pdf')).not.toBeInTheDocument();
  });
});
