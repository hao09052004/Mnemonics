import { useState } from 'react';
import { ApiClient, type Session } from '../lib/api-client';

interface QuickCaptureProps {
  api: ApiClient;
  session: Session;
  onCaptured: (itemId: string) => Promise<void> | void;
}

export function QuickCapture({ api, session, onCaptured }: QuickCaptureProps) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [sourceUrl, setSourceUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const reset = () => {
    setTitle('');
    setNote('');
    setSourceUrl('');
    setMessage(null);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!title.trim() || saving) return;

    setSaving(true);
    setMessage(null);

    try {
      const result = await api.captureText({
        type: sourceUrl.trim() ? 'link' : 'text',
        title: title.trim(),
        sourceUrl: sourceUrl.trim() || undefined,
        selectedText: note.trim() || undefined,
        capturedAt: new Date().toISOString(),
        clientRequestId: crypto.randomUUID()
      }, session.accessToken);

      const itemId = result.id;

      setMessage('Đã lưu. Mnemonics đang tạo tag + embedding...');
      await onCaptured(itemId);
      setTimeout(() => {
        setOpen(false);
        reset();
      }, 450);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Không thể lưu kiến thức.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ marginBottom: 20 }}>
      <button
        type="button"
        data-testid="quick-capture-open"
        onClick={() => {
          setOpen(true);
          setMessage(null);
        }}
        style={{
          padding: '10px 16px',
          border: 'none',
          borderRadius: 10,
          background: '#4f46e5',
          color: 'white',
          fontSize: 14,
          fontWeight: 700,
          cursor: 'pointer',
          boxShadow: '0 4px 12px rgba(79,70,229,0.18)'
        }}
      >
        + Lưu nhanh
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(15,23,42,0.35)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
            zIndex: 50
          }}
        >
          <form
            onSubmit={handleSubmit}
            style={{
              width: 'min(560px, 100%)',
              background: 'white',
              borderRadius: 16,
              padding: 24,
              boxShadow: '0 20px 50px rgba(15,23,42,0.2)'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <div>
                <div style={{ fontSize: 12, color: '#6366f1', fontWeight: 800, letterSpacing: 1 }}>QUICK CAPTURE</div>
                <h2 style={{ marginTop: 4, fontSize: 22, color: '#111827' }}>Lưu một memory</h2>
              </div>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  reset();
                }}
                aria-label="Đóng"
                style={{ border: 0, background: 'transparent', fontSize: 22, cursor: 'pointer', color: '#64748b' }}
              >
                ×
              </button>
            </div>

            <div style={{ display: 'grid', gap: 12 }}>
              <input
                data-testid="quick-capture-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ví dụ: Cách học bằng spaced repetition"
                required
                autoFocus
                style={{ width: '100%', padding: '12px 14px', border: '1px solid #cbd5e1', borderRadius: 10, fontSize: 14 }}
              />
              <textarea
                data-testid="quick-capture-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Nội dung hoặc ý chính muốn lưu..."
                rows={5}
                style={{ width: '100%', padding: '12px 14px', border: '1px solid #cbd5e1', borderRadius: 10, fontSize: 14, resize: 'vertical' }}
              />
              <input
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                placeholder="URL nguồn (không bắt buộc)"
                type="url"
                style={{ width: '100%', padding: '12px 14px', border: '1px solid #cbd5e1', borderRadius: 10, fontSize: 14 }}
              />
            </div>

            {message && (
              <div
                role="status"
                style={{
                  marginTop: 14,
                  padding: 10,
                  borderRadius: 10,
                  background: saving ? '#eef2ff' : '#ecfdf5',
                  color: saving ? '#4338ca' : '#047857',
                  fontSize: 13
                }}
              >
                {message}
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  reset();
                }}
                style={{ padding: '10px 16px', border: '1px solid #cbd5e1', borderRadius: 10, background: 'white', cursor: 'pointer' }}
              >
                Hủy
              </button>
              <button
                type="submit"
                data-testid="quick-capture-submit"
                disabled={saving || !title.trim()}
                style={{
                  padding: '10px 18px',
                  border: 0,
                  borderRadius: 10,
                  background: saving || !title.trim() ? '#cbd5e1' : '#4f46e5',
                  color: 'white',
                  fontWeight: 700,
                  cursor: saving || !title.trim() ? 'not-allowed' : 'pointer'
                }}
              >
                {saving ? 'Đang lưu...' : 'Lưu memory'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
