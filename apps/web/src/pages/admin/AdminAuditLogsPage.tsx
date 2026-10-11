/**
 * Admin audit log page (M4).
 *
 * Read-only view of role_audit_log. Shows every privileged
 * action: role changes, manual reconciliations, suspensions.
 */
import { useEffect, useState } from 'react';
import { ApiClient, type Session, type AuditLogEntry } from '../../lib/api-client';

interface Props { api: ApiClient }

function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem('mnemonics:session');
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('vi-VN');
}

export function AdminAuditLogsPage({ api }: Props) {
  const [items, setItems] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const session = loadSession();
      if (!session?.accessToken) {
        setError('Phiên đăng nhập đã hết hạn.');
        setLoading(false);
        return;
      }
      try {
        const r = await api.adminListAuditLogs(session.accessToken, 100, 0);
        setItems(r.data.items);
      } catch (e: any) {
        setError(e?.message || 'Không thể tải nhật ký');
      } finally {
        setLoading(false);
      }
    })();
  }, [api]);

  return (
    <>
      <h1 className="admin-page-title">Nhật ký hoạt động</h1>
      <p className="admin-page-subtitle">
        Mọi thay đổi vai trò, đối soát thủ công và tạm ngưng đều được ghi lại tại đây.
      </p>
      {error && <p className="admin-empty">{error}</p>}
      {loading ? (
        <p className="admin-empty">Đang tải…</p>
      ) : items.length === 0 ? (
        <p className="admin-empty">Chưa có hoạt động nào được ghi nhận.</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Thời gian</th>
              <th>Người thực hiện</th>
              <th>Đối tượng</th>
              <th>Vai trò mới</th>
              <th>Lý do</th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id}>
                <td>{formatDate(it.created_at)}</td>
                <td>{it.actor_user_id ?? '—'}</td>
                <td>{it.target_user_id}</td>
                <td>
                  {it.old_role ? `${it.old_role} → ` : ''}
                  <strong>{it.new_role}</strong>
                </td>
                <td>{it.reason ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
