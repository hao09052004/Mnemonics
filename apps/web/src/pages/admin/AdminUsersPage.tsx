/**
 * Admin users page (M4).
 *
 * Lists users with their plan, memory count, status. Includes
 * a search box, suspend toggle, and pagination.
 */
import { useEffect, useState } from 'react';
import { ApiClient, type Session, type AdminUsersResponse, type AdminUserRow, loadStoredSession } from '../../lib/api-client';

interface Props { api: ApiClient }

function loadSession(): Session | null {
  return loadStoredSession();
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('vi-VN');
}

export function AdminUsersPage({ api }: Props) {
  const [items, setItems] = useState<AdminUserRow[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = async (search: string) => {
    setLoading(true);
    const session = loadSession();
    if (!session?.accessToken) {
      setError('Phiên đăng nhập đã hết hạn.');
      setLoading(false);
      return;
    }
    try {
      const r = await api.adminListUsers(session.accessToken, { q: search, limit: 100 });
      setItems(r.data.items);
      setError(null);
    } catch (e: any) {
      setError(e?.message || 'Không thể tải danh sách');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load('');
  }, [api]);

  const onSearch = (e: React.FormEvent) => {
    e.preventDefault();
    void load(q);
  };

  const onToggleSuspend = async (user: AdminUserRow) => {
    const session = loadSession();
    if (!session?.accessToken) return;
    const reason = window.prompt(
      `Lý do ${user.is_suspended ? 'mở lại' : 'tạm ngưng'} người dùng này?`,
      user.is_suspended ? 'unsuspend' : 'admin review'
    );
    if (!reason) return;
    setBusyId(user.id);
    try {
      await api.adminSuspendUser(user.id, !user.is_suspended, reason, session.accessToken);
      await load(q);
    } catch (e: any) {
      window.alert(e?.message || 'Không thể cập nhật');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <h1 className="admin-page-title">Người dùng</h1>
      <p className="admin-page-subtitle">Tìm kiếm, xem gói, tạm ngưng tài khoản.</p>
      <form className="admin-toolbar" onSubmit={onSearch}>
        <input
          type="search"
          placeholder="Tìm theo email…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button className="admin-button" type="submit">Tìm</button>
      </form>
      {error && <p className="admin-empty">{error}</p>}
      {loading ? (
        <p className="admin-empty">Đang tải…</p>
      ) : items.length === 0 ? (
        <p className="admin-empty">Không có người dùng nào khớp với bộ lọc.</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Vai trò</th>
              <th>Gói</th>
              <th>Memory</th>
              <th>Đăng ký</th>
              <th>Trạng thái</th>
              <th>Hành động</th>
            </tr>
          </thead>
          <tbody>
            {items.map((u) => (
              <tr key={u.id}>
                <td>{u.email ?? '—'}</td>
                <td>
                  {u.role === 'admin' ? (
                    <span className="admin-pill admin-pill--admin">Admin</span>
                  ) : (
                    'User'
                  )}
                </td>
                <td>
                  {u.family === 'mastery' ? (
                    <span className="admin-pill admin-pill--mastery">Mastery</span>
                  ) : (
                    'Memory'
                  )}
                </td>
                <td>{u.memory_count}</td>
                <td>{formatDate(u.created_at)}</td>
                <td>
                  {u.is_suspended ? (
                    <span className="admin-pill admin-pill--pending">Tạm ngưng</span>
                  ) : (
                    <span className="admin-pill admin-pill--paid">Hoạt động</span>
                  )}
                </td>
                <td>
                  <button
                    type="button"
                    className="admin-button admin-button--secondary"
                    disabled={busyId === u.id}
                    onClick={() => onToggleSuspend(u)}
                  >
                    {u.is_suspended ? 'Mở lại' : 'Tạm ngưng'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
