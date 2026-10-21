/**
 * Admin users page (M4).
 *
 * Lists users with their plan, memory count, status. Includes
 * a search box, filter tabs, suspend toggle, plan upgrade/approval,
 * and account deletion.
 */
import { useEffect, useState, useMemo } from 'react';
import { ApiClient, type Session, type AdminUserRow, loadStoredSession } from '../../lib/api-client';

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
  const [filterTab, setFilterTab] = useState<'all' | 'mastery' | 'memory' | 'suspended'>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Plan upgrade / approval modal
  const [planModalUser, setPlanModalUser] = useState<AdminUserRow | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<'mastery-monthly' | 'mastery-yearly' | 'memory'>('mastery-monthly');
  const [planReason, setPlanReason] = useState('Duyệt nâng cấp gói Mastery');
  const [isUpdatingPlan, setIsUpdatingPlan] = useState(false);

  // Account deletion modal
  const [deleteModalUser, setDeleteModalUser] = useState<AdminUserRow | null>(null);
  const [deleteReason, setDeleteReason] = useState('Yêu cầu hủy tài khoản theo chính sách bảo mật');
  const [isDeletingUser, setIsDeletingUser] = useState(false);

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
      setError(e?.message || 'Không thể tải danh sách người dùng');
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
      window.alert(e?.message || 'Không thể cập nhật trạng thái');
    } finally {
      setBusyId(null);
    }
  };

  const openPlanModal = (user: AdminUserRow) => {
    setPlanModalUser(user);
    setSelectedPlan(user.family === 'mastery' ? 'mastery-monthly' : 'mastery-monthly');
    setPlanReason(`Duyệt nâng cấp cho ${user.email ?? 'người dùng'}`);
  };

  const handleUpdatePlan = async () => {
    if (!planModalUser) return;
    const session = loadSession();
    if (!session?.accessToken) {
      window.alert('Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại.');
      return;
    }
    setIsUpdatingPlan(true);
    try {
      await api.adminUpdateUserPlan(planModalUser.id, selectedPlan, session.accessToken, planReason);
      setPlanModalUser(null);
      await load(q);
      window.alert(`Đã cập nhật gói ${selectedPlan} cho ${planModalUser.email ?? 'người dùng'} thành công!`);
    } catch (e: any) {
      window.alert(e?.message || 'Không thể cập nhật gói người dùng');
    } finally {
      setIsUpdatingPlan(false);
    }
  };

  const openDeleteModal = (user: AdminUserRow) => {
    setDeleteModalUser(user);
    setDeleteReason('Hủy tài khoản khỏi hệ thống theo yêu cầu quản trị viên');
  };

  const handleDeleteUser = async () => {
    if (!deleteModalUser) return;
    const session = loadSession();
    if (!session?.accessToken) {
      window.alert('Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại.');
      return;
    }
    setIsDeletingUser(true);
    try {
      await api.adminDeleteUser(deleteModalUser.id, session.accessToken, deleteReason);
      setDeleteModalUser(null);
      await load(q);
      window.alert(`Đã hủy và xóa hoàn toàn tài khoản ${deleteModalUser.email ?? ''} khỏi website!`);
    } catch (e: any) {
      window.alert(e?.message || 'Không thể xóa tài khoản người dùng');
    } finally {
      setIsDeletingUser(false);
    }
  };

  // Metrics summary
  const totalCount = items.length;
  const masteryCount = useMemo(() => items.filter((u) => u.family === 'mastery').length, [items]);
  const memoryCount = useMemo(() => items.filter((u) => u.family !== 'mastery').length, [items]);
  const suspendedCount = useMemo(() => items.filter((u) => u.is_suspended).length, [items]);

  // Filtered items
  const filteredItems = useMemo(() => {
    return items.filter((u) => {
      if (filterTab === 'mastery') return u.family === 'mastery';
      if (filterTab === 'memory') return u.family !== 'mastery';
      if (filterTab === 'suspended') return u.is_suspended;
      return true;
    });
  }, [items, filterTab]);

  return (
    <>
      <h1 className="admin-page-title">Quản lý người dùng & Phê duyệt tài khoản</h1>
      <p className="admin-page-subtitle">
        Xem danh sách, kiểm soát quyền nâng cấp, duyệt gói Pro (Mastery) và xóa tài khoản khỏi website.
      </p>

      {/* KPI quick summary */}
      <section className="admin-grid" style={{ marginBottom: '1.5rem' }}>
        <div className="admin-kpi" onClick={() => setFilterTab('all')} style={{ cursor: 'pointer' }}>
          <p className="admin-kpi-label">Tổng tài khoản</p>
          <p className="admin-kpi-value">{totalCount}</p>
          <p className="admin-kpi-foot">Bấm để xem tất cả</p>
        </div>
        <div className="admin-kpi" onClick={() => setFilterTab('mastery')} style={{ cursor: 'pointer' }}>
          <p className="admin-kpi-label">Gói Mastery (Trả phí)</p>
          <p className="admin-kpi-value" style={{ color: '#6c47ff' }}>{masteryCount}</p>
          <p className="admin-kpi-foot">Tài khoản Pro/Mastery</p>
        </div>
        <div className="admin-kpi" onClick={() => setFilterTab('memory')} style={{ cursor: 'pointer' }}>
          <p className="admin-kpi-label">Gói Memory (Free)</p>
          <p className="admin-kpi-value">{memoryCount}</p>
          <p className="admin-kpi-foot">Hạn mức 50 memories</p>
        </div>
        <div className="admin-kpi" onClick={() => setFilterTab('suspended')} style={{ cursor: 'pointer' }}>
          <p className="admin-kpi-label">Đang tạm ngưng</p>
          <p className="admin-kpi-value" style={{ color: suspendedCount > 0 ? '#dc2626' : undefined }}>{suspendedCount}</p>
          <p className="admin-kpi-foot">Bị khóa quyền truy cập</p>
        </div>
      </section>

      {/* Toolbar & Filters */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            className={filterTab === 'all' ? 'admin-button' : 'admin-button admin-button--secondary'}
            onClick={() => setFilterTab('all')}
          >
            Tất cả ({totalCount})
          </button>
          <button
            type="button"
            className={filterTab === 'mastery' ? 'admin-button' : 'admin-button admin-button--secondary'}
            onClick={() => setFilterTab('mastery')}
          >
            Mastery ({masteryCount})
          </button>
          <button
            type="button"
            className={filterTab === 'memory' ? 'admin-button' : 'admin-button admin-button--secondary'}
            onClick={() => setFilterTab('memory')}
          >
            Memory ({memoryCount})
          </button>
          <button
            type="button"
            className={filterTab === 'suspended' ? 'admin-button' : 'admin-button admin-button--secondary'}
            onClick={() => setFilterTab('suspended')}
          >
            Tạm ngưng ({suspendedCount})
          </button>
        </div>

        <form className="admin-toolbar" onSubmit={onSearch} style={{ margin: 0 }}>
          <input
            type="search"
            placeholder="Tìm theo email…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <button className="admin-button" type="submit">Tìm kiếm</button>
        </form>
      </div>

      {error && <p className="admin-empty">{error}</p>}
      {loading ? (
        <p className="admin-empty">Đang tải danh sách người dùng…</p>
      ) : filteredItems.length === 0 ? (
        <p className="admin-empty">Không có người dùng nào khớp với bộ lọc.</p>
      ) : (
        <table className="admin-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Vai trò</th>
              <th>Gói tài khoản</th>
              <th>Memory</th>
              <th>Ngày đăng ký</th>
              <th>Trạng thái</th>
              <th style={{ minWidth: '260px' }}>Hành động quản trị</th>
            </tr>
          </thead>
          <tbody>
            {filteredItems.map((u) => (
              <tr key={u.id}>
                <td>
                  <strong>{u.email ?? '—'}</strong>
                  <div style={{ fontSize: '0.75rem', color: '#888', marginTop: '2px' }}>ID: {u.id}</div>
                </td>
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
                    <span className="admin-pill">Memory (Free)</span>
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
                  <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="admin-button admin-button--success"
                      style={{ fontSize: '0.8rem', padding: '0.4rem 0.65rem' }}
                      disabled={busyId === u.id}
                      onClick={() => openPlanModal(u)}
                      title="Nâng cấp hoặc chuyển đổi gói cho tài khoản"
                    >
                      Duyệt / Đổi gói
                    </button>
                    <button
                      type="button"
                      className="admin-button admin-button--secondary"
                      style={{ fontSize: '0.8rem', padding: '0.4rem 0.65rem' }}
                      disabled={busyId === u.id}
                      onClick={() => onToggleSuspend(u)}
                    >
                      {u.is_suspended ? 'Mở lại' : 'Tạm ngưng'}
                    </button>
                    <button
                      type="button"
                      className="admin-button admin-button--danger"
                      style={{ fontSize: '0.8rem', padding: '0.4rem 0.65rem' }}
                      disabled={busyId === u.id}
                      onClick={() => openDeleteModal(u)}
                      title="Xóa vĩnh viễn tài khoản khỏi hệ thống"
                    >
                      Hủy acc
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Plan upgrade modal */}
      {planModalUser && (
        <div className="admin-modal-backdrop" onClick={() => !isUpdatingPlan && setPlanModalUser(null)}>
          <div className="admin-modal-card" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: '0 0 0.5rem' }}>
              Duyệt & Nâng cấp gói tài khoản
            </h2>
            <p style={{ color: '#666', fontSize: '0.9rem', marginBottom: '1.25rem' }}>
              Điều chỉnh quyền lợi gói cho <strong>{planModalUser.email}</strong>. Hệ thống sẽ cập nhật ngay lập tức và ghi nhận vào nhật ký kiểm toán.
            </p>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.4rem' }}>
                Chọn gói quyền lợi:
              </label>
              <select
                value={selectedPlan}
                onChange={(e) => setSelectedPlan(e.target.value as any)}
                style={{ width: '100%', padding: '0.6rem 0.75rem', borderRadius: '8px', border: '1px solid #ccc', fontSize: '0.9rem' }}
              >
                <option value="mastery-monthly">Mastery theo tháng (49.000đ/tháng — 30 ngày Pro)</option>
                <option value="mastery-yearly">Mastery theo năm (490.000đ/năm — 365 ngày Pro)</option>
                <option value="memory">Gói Memory (Miễn phí — 50 memories/tháng)</option>
              </select>
            </div>

            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.4rem' }}>
                Lý do / Ghi chú (lưu vào nhật ký kiểm toán):
              </label>
              <input
                type="text"
                value={planReason}
                onChange={(e) => setPlanReason(e.target.value)}
                placeholder="VD: Duyệt chuyển khoản VietQR, khuyến mãi,..."
                style={{ width: '100%', padding: '0.6rem 0.75rem', borderRadius: '8px', border: '1px solid #ccc', fontSize: '0.9rem' }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem' }}>
              <button
                type="button"
                className="admin-button admin-button--secondary"
                disabled={isUpdatingPlan}
                onClick={() => setPlanModalUser(null)}
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                className="admin-button admin-button--success"
                disabled={isUpdatingPlan}
                onClick={handleUpdatePlan}
              >
                {isUpdatingPlan ? 'Đang cập nhật…' : 'Xác nhận duyệt gói'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete account confirmation modal */}
      {deleteModalUser && (
        <div className="admin-modal-backdrop" onClick={() => !isDeletingUser && setDeleteModalUser(null)}>
          <div className="admin-modal-card" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 700, margin: '0 0 0.5rem', color: '#dc2626' }}>
              ⚠️ Xác nhận hủy tài khoản vĩnh viễn
            </h2>
            <p style={{ color: '#555', fontSize: '0.9rem', marginBottom: '1rem', lineHeight: '1.5' }}>
              Bạn đang thực hiện xóa tài khoản: <strong>{deleteModalUser.email}</strong>.
              <br />
              Hành động này sẽ:
            </p>
            <ul style={{ fontSize: '0.85rem', color: '#666', paddingLeft: '1.25rem', marginBottom: '1.25rem', lineHeight: '1.6' }}>
              <li>Xóa toàn bộ ký ức, tệp tin và hình ảnh đã lưu</li>
              <li>Xóa các không gian làm việc (Spaces) và liên kết liên quan</li>
              <li>Hủy tất cả đăng ký gói (Subscriptions) và quyền lợi (Entitlements)</li>
              <li>Xóa tài khoản đăng nhập khỏi cơ sở dữ liệu Supabase Auth</li>
            </ul>

            <div style={{ marginBottom: '1.25rem' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.4rem' }}>
                Lý do hủy tài khoản (bắt buộc):
              </label>
              <input
                type="text"
                value={deleteReason}
                onChange={(e) => setDeleteReason(e.target.value)}
                placeholder="Lý do hủy tài khoản..."
                style={{ width: '100%', padding: '0.6rem 0.75rem', borderRadius: '8px', border: '1px solid #ccc', fontSize: '0.9rem' }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.6rem' }}>
              <button
                type="button"
                className="admin-button admin-button--secondary"
                disabled={isDeletingUser}
                onClick={() => setDeleteModalUser(null)}
              >
                Không, giữ lại
              </button>
              <button
                type="button"
                className="admin-button admin-button--danger"
                disabled={isDeletingUser || !deleteReason.trim()}
                onClick={handleDeleteUser}
              >
                {isDeletingUser ? 'Đang xóa tài khoản…' : 'Đồng ý xóa vĩnh viễn'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

