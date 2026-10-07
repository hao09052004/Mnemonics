/**
 * DocumentCaptureDialog — unit tests for the web dashboard document
 * upload flow. The dialog never sends bytes to itself; it always goes
 * through `ApiClient.uploadDocumentCapture`. The tests below stub the
 * client and assert the wiring (button, dialog, error mapping).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach } from 'vitest';
import { DocumentCaptureDialog } from '../DocumentCaptureDialog';
import type { ApiClient } from '../../lib/api-client';

function makeApi(over: Partial<ApiClient> = {}): ApiClient {
  const base: Partial<ApiClient> = {
    getValidAccessToken: vi.fn(async () => 'AT'),
    uploadDocumentCapture: vi.fn(async () => ({ id: 'i1', status: 'pending' })),
    loadStoredSession: vi.fn(() => null),
    saveSession: vi.fn(),
    clearSession: vi.fn(),
    isAccessTokenExpired: vi.fn(() => false)
  };
  return { ...base, ...over } as unknown as ApiClient;
}

function pickFile(file: File) {
  fireEvent.change(screen.getByTestId('document-file-input'), {
    target: { files: [file] }
  });
}

describe('DocumentCaptureDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('starts hidden when `open` is false', () => {
    render(<DocumentCaptureDialog api={makeApi()} open={false} onClose={vi.fn()} />);
    expect(screen.queryByTestId('document-capture-dialog')).toBeNull();
  });

  it('picks a file and shows filename, size, and a default title', async () => {
    render(<DocumentCaptureDialog api={makeApi()} open onClose={vi.fn()} />);
    const f = new File(['hello'], 'paper.pdf', { type: 'application/pdf' });
    pickFile(f);
    expect(await screen.findByText('paper.pdf')).toBeTruthy();
    expect(screen.getByTestId('document-title-input').value).toBe('paper');
  });

  it('rejects files larger than 20 MB', async () => {
    // We don't allocate a real 21 MB buffer here — the dialog only
    // looks at `file.size`. A tiny File with a forged size mimics a
    // multi-megabyte upload for the path under examination.
    const big = new File(['x'], 'big.pdf', { type: 'application/pdf' });
    Object.defineProperty(big, 'size', { value: 21 * 1024 * 1024 });
    render(<DocumentCaptureDialog api={makeApi()} open onClose={vi.fn()} />);
    pickFile(big);
    expect(await screen.findByTestId('document-error')).toBeTruthy();
    expect(screen.getByText(/too large/i)).toBeTruthy();
  });

  it('calls uploadDocumentCapture with a clientRequestId', async () => {
    const upload = vi.fn(async () => ({ id: 'new-id', status: 'pending' as const }));
    const onUploaded = vi.fn();
    const api = makeApi({ uploadDocumentCapture: upload });
    render(<DocumentCaptureDialog api={api} open onClose={vi.fn()} onUploaded={onUploaded} />);
    pickFile(new File(['hi'], 'doc.pdf', { type: 'application/pdf' }));
    await userEvent.click(await screen.findByTestId('document-save'));
    await waitFor(() => expect(upload).toHaveBeenCalledOnce());
    const [payload] = upload.mock.calls[0];
    expect(payload.file).toBeInstanceOf(File);
    expect(payload.title).toBe('doc');
    expect(payload.clientRequestId).toMatch(/^[0-9a-f-]+/i);
    expect(onUploaded).toHaveBeenCalledWith('new-id');
  });

  it('maps UNSUPPORTED_DOCUMENT_MIME to a user-facing message', async () => {
    const upload = vi.fn(async () => {
      const err = new Error('boom') as Error & { code: string };
      err.code = 'UNSUPPORTED_DOCUMENT_MIME';
      throw err;
    });
    render(
      <DocumentCaptureDialog
        api={makeApi({ uploadDocumentCapture: upload })}
        open
        onClose={vi.fn()}
      />
    );
    pickFile(new File(['x'], 'doc.bin', { type: 'application/pdf' }));
    await userEvent.click(await screen.findByTestId('document-save'));
    expect(await screen.findByText(/Unsupported file type/i)).toBeTruthy();
  });
});