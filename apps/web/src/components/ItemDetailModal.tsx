/**
 * ItemDetailModal
 *
 * Opens when the user clicks a card on the dashboard. Shows the full item
 * (raw text, OCR text, notes, tags) and lets the user edit title + notes
 * via PATCH /api/v1/items/:id.
 */

import { useEffect, useState } from 'react';
import { ApiClient, ApiError, type ItemDetail } from '../lib/api-client';

interface ItemDetailModalProps {
  api: ApiClient;
  itemId: string;
  accessToken: string;
  initial?: ItemDetail | null;
  onClose: () => void;
  onSaved: (updated: ItemDetail) => void;
}

type Tab = 'preview' | 'edit';

export function ItemDetailModal({ api, itemId, accessToken, initial, onClose, onSaved }: ItemDetailModalProps) {
  const [detail, setDetail] = useState<ItemDetail | null>(initial ?? null);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('preview');
  const [titleDraft, setTitleDraft] = useState(initial?.title ?? '');
  const [notesDraft, setNotesDraft] = useState(initial?.notes ?? '');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    if (initial) {
      setDetail(initial);
      setTitleDraft(initial.title ?? '');
      setNotesDraft(initial.notes ?? '');
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.getItem(itemId, accessToken)
      .then((item) => {
        if (cancelled) return;
        setDetail(item);
        setTitleDraft(item.title ?? '');
        setNotesDraft(item.notes ?? '');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Không thể tải chi tiết memory.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [itemId, accessToken, api, initial]);

  const handleSave = async () => {
    if (!detail) return;
    setSaving(true);
    setError(null);
    try {
      const updates: { title?: string; notes?: string } = {};
      if (titleDraft.trim() && titleDraft.trim() !== detail.title) updates.title = titleDraft.trim();
      if ((notesDraft ?? '') !== (detail.notes ?? '')) updates.notes = notesDraft;
      if (Object.keys(updates).length === 0) {
        setTab('preview');
        return;
      }
      await api.updateItem(itemId, updates, accessToken);
      const merged: ItemDetail = {
        ...detail,
        ...(updates.title !== undefined ? { title: updates.title } : {}),
        ...(updates.notes !== undefined ? { notes: updates.notes } : {})
      };
      setDetail(merged);
      onSaved(merged);
      setSavedAt(new Date().toLocaleTimeString('vi-VN'));
      setTab('preview');
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setError('Không có gì thay đổi để cập nhật.');
      } else {
        setError(err instanceof Error ? err.message : 'Không thể lưu thay đổi.');
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Chi tiết memory"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(15,23,42,0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        zIndex: 60
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        data-testid="item-detail-modal"
        style={{
          width: 'min(720px, 100%)',
          maxHeight: '90vh',
          overflowY: 'auto',
          background: 'white',
          borderRadius: 16,
          padding: 24,
          boxShadow: '0 20px 50px rgba(15,23,42,0.25)'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 12, color: '#6366f1', fontWeight: 800, letterSpacing: 1 }}>MEMORY DETAIL</div>
            <h2 style={{ marginTop: 4, fontSize: 20, color: '#111827', wordBreak: 'break-word' }}>
              {detail?.title ?? 'Đang tải...'}
            </h2>
            {detail && (
              <div style={{ marginTop: 4, fontSize: 12, color: '#64748b' }}>
                {detail.kind} · {detail.captured_at ? new Date(detail.captured_at).toLocaleString('vi-VN') : ''}
                {detail.status && <> · <strong>{detail.status}</strong></>}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            data-testid="item-detail-close"
            style={{ border: 0, background: 'transparent', fontSize: 22, cursor: 'pointer', color: '#64748b' }}
          >
            ×
          </button>
        </div>

        <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid #e5e7eb' }}>
          {(['preview', 'edit'] as Tab[]).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              data-testid={`item-detail-tab-${value}`}
              style={{
                border: 0,
                background: 'transparent',
                padding: '8px 12px',
                fontSize: 13,
                fontWeight: 700,
                color: tab === value ? '#4f46e5' : '#64748b',
                borderBottom: tab === value ? '2px solid #4f46e5' : '2px solid transparent',
                cursor: 'pointer'
              }}
            >
              {value === 'preview' ? 'Xem' : 'Chỉnh sửa'}
            </button>
          ))}
        </div>

        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: '#64748b' }}>Đang tải chi tiết...</div>
        ) : error ? (
          <div role="alert" style={{ padding: 12, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#b91c1c', fontSize: 13 }}>
            {error}
          </div>
        ) : tab === 'preview' && detail ? (
          <PreviewBody detail={detail} />
        ) : tab === 'edit' && detail ? (
          <EditBody
            title={titleDraft}
            notes={notesDraft}
            onTitleChange={setTitleDraft}
            onNotesChange={setNotesDraft}
            saving={saving}
          />
        ) : null}

        {savedAt && (
          <div role="status" data-testid="item-detail-saved" style={{ marginTop: 10, fontSize: 11, color: '#047857' }}>
            Đã lưu lúc {savedAt}
          </div>
        )}

        {tab === 'edit' && (
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
            <button
              type="button"
              onClick={() => {
                if (!detail) return;
                setTitleDraft(detail.title ?? '');
                setNotesDraft(detail.notes ?? '');
                setTab('preview');
              }}
              style={{ padding: '10px 16px', border: '1px solid #cbd5e1', borderRadius: 10, background: 'white', cursor: 'pointer' }}
            >
              Hủy
            </button>
            <button
              type="button"
              data-testid="item-detail-save"
              onClick={handleSave}
              disabled={saving}
              style={{
                padding: '10px 18px',
                border: 0,
                borderRadius: 10,
                background: saving ? '#cbd5e1' : '#4f46e5',
                color: 'white',
                fontWeight: 700,
                cursor: saving ? 'not-allowed' : 'pointer'
              }}
            >
              {saving ? 'Đang lưu...' : 'Lưu thay đổi'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function PreviewBody({ detail }: { detail: ItemDetail }) {
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      {detail.image_url && (
        <img
          src={detail.image_url}
          alt={detail.title}
          style={{ maxWidth: '100%', maxHeight: 320, borderRadius: 12, objectFit: 'contain', background: '#f8fafc' }}
        />
      )}

      {detail.tags && detail.tags.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#94a3b8', letterSpacing: 1, marginBottom: 6 }}>TAGS</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {detail.tags.map((tag) => (
              <span key={tag} style={{ fontSize: 12, padding: '3px 10px', background: '#eef2ff', color: '#4338ca', borderRadius: 12 }}>
                #{tag}
              </span>
            ))}
          </div>
        </div>
      )}

      {detail.notes && (
        <Section title="GHI CHÚ" body={detail.notes} />
      )}

      {detail.raw_text && (
        <Section title="VĂN BẢN GỐC" body={detail.raw_text} />
      )}

      {detail.ocr_text && (
        <Section title="OCR" body={detail.ocr_text} />
      )}

      {detail.source_url && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 800, color: '#94a3b8', letterSpacing: 1, marginBottom: 6 }}>NGUỒN</div>
          <a href={detail.source_url} target="_blank" rel="noreferrer" style={{ color: '#4f46e5', fontSize: 13, wordBreak: 'break-all' }}>
            {detail.source_url}
          </a>
        </div>
      )}

      {!detail.raw_text && !detail.ocr_text && !detail.notes && (
        <div style={{ padding: 20, background: '#f8fafc', borderRadius: 10, color: '#64748b', fontSize: 13, textAlign: 'center' }}>
          Memory này không có nội dung văn bản. Bấm <b>Chỉnh sửa</b> để thêm ghi chú.
        </div>
      )}
    </div>
  );
}

function EditBody({
  title,
  notes,
  onTitleChange,
  onNotesChange,
  saving
}: {
  title: string;
  notes: string | null | undefined;
  onTitleChange: (next: string) => void;
  onNotesChange: (next: string) => void;
  saving: boolean;
}) {
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <label style={{ display: 'grid', gap: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: '#94a3b8', letterSpacing: 1 }}>TIÊU ĐỀ</span>
        <input
          type="text"
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          data-testid="item-detail-title-input"
          disabled={saving}
          style={{ width: '100%', padding: '10px 12px', border: '1px solid #cbd5e1', borderRadius: 10, fontSize: 14 }}
        />
      </label>
      <label style={{ display: 'grid', gap: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 800, color: '#94a3b8', letterSpacing: 1 }}>GHI CHÚ</span>
        <textarea
          value={notes ?? ''}
          onChange={(e) => onNotesChange(e.target.value)}
          data-testid="item-detail-notes-input"
          disabled={saving}
          rows={6}
          placeholder="Viết ghi chú của bạn tại đây..."
          style={{ width: '100%', padding: '10px 12px', border: '1px solid #cbd5e1', borderRadius: 10, fontSize: 14, resize: 'vertical' }}
        />
      </label>
    </div>
  );
}

function Section({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 800, color: '#94a3b8', letterSpacing: 1, marginBottom: 6 }}>{title}</div>
      <div style={{ padding: 12, background: '#f8fafc', borderRadius: 10, fontSize: 13, color: '#0f172a', whiteSpace: 'pre-wrap', lineHeight: 1.5, wordBreak: 'break-word' }}>
        {body}
      </div>
    </div>
  );
}
