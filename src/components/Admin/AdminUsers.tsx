import { useState, useEffect } from 'react';
import './Admin.css';

const API = import.meta.env.DEV ? 'http://localhost:3001' : '';

interface AdminUser {
  id: string;
  email: string;
  display_name: string;
  plan: string;
  subscription_status: string;
  subscription_end: string | null;
  paypal_subscription_id: string | null;
  created_at: string;
  last_login: string | null;
  upload_count: number;
}

export default function AdminUsers() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [planFilter, setPlanFilter] = useState('all');
  const [grantDays, setGrantDays] = useState<Record<string, string>>({});
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [editFields, setEditFields] = useState<{ display_name: string; email: string }>({ display_name: '', email: '' });

  const loadUsers = (q?: string) => {
    setLoading(true);
    const params = q ? `?search=${encodeURIComponent(q)}` : '';
    fetch(`${API}/api/admin/users${params}`, { credentials: 'include' })
      .then(r => r.json())
      .then(setUsers)
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadUsers(); }, []);

  const changePlan = async (userId: string, plan: string) => {
    await fetch(`${API}/api/admin/users/${userId}/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ plan }),
    });
    loadUsers(search);
  };

  const grantAccess = async (userId: string) => {
    const days = parseInt(grantDays[userId] || '0');
    if (!days) return;
    await fetch(`${API}/api/admin/users/${userId}/plan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ days }),
    });
    setGrantDays(prev => ({ ...prev, [userId]: '' }));
    loadUsers(search);
  };

  const deleteUser = async (userId: string, email: string) => {
    if (!confirm(`¿Eliminar al usuario ${email}?\n\nEsto eliminará sus uploads, favoritos y progreso de lectura.`)) return;
    await fetch(`${API}/api/admin/users/${userId}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    loadUsers(search);
  };

  const startEdit = (u: AdminUser) => {
    setEditingUser(u.id);
    setEditFields({ display_name: u.display_name || '', email: u.email });
  };

  const saveEdit = async (userId: string) => {
    await fetch(`${API}/api/admin/users/${userId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(editFields),
    });
    setEditingUser(null);
    loadUsers(search);
  };

  const filtered = users.filter(u => planFilter === 'all' || u.plan === planFilter);

  return (
    <div className="admin-panel">
      <div className="admin-header">
        <h2>Gestión de Usuarios</h2>
        <span className="admin-badge">{filtered.length} usuarios</span>
      </div>

      <div className="admin-toolbar">
        <input
          className="admin-search"
          placeholder="Buscar por email o nombre..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && loadUsers(search)}
        />
        <select className="admin-select" value={planFilter} onChange={e => setPlanFilter(e.target.value)}>
          <option value="all">Todos los planes</option>
          <option value="free">Free</option>
          <option value="premium">Premium</option>
          <option value="enterprise">Enterprise</option>
        </select>
        <button className="admin-btn primary" onClick={() => loadUsers(search)}>Buscar</button>
      </div>

      {loading ? (
        <div className="admin-empty"><div className="empty-icon">⏳</div>Cargando...</div>
      ) : (
        <div className="admin-table-container">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Nombre</th>
                <th>Plan</th>
                <th>Suscripción</th>
                <th>PayPal</th>
                <th>Vence</th>
                <th>Registrado</th>
                <th>Uploads</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(u => (
                <tr key={u.id}>
                  <td>
                    {editingUser === u.id ? (
                      <input value={editFields.email} onChange={e => setEditFields(f => ({...f, email: e.target.value}))}
                        style={{ background: 'rgba(15,15,25,0.8)', border: '1px solid rgba(167,139,250,0.3)', borderRadius: '4px', padding: '2px 6px', color: '#e2e8f0', fontSize: '12px', width: '100%' }} />
                    ) : u.email}
                  </td>
                  <td>
                    {editingUser === u.id ? (
                      <input value={editFields.display_name} onChange={e => setEditFields(f => ({...f, display_name: e.target.value}))}
                        style={{ background: 'rgba(15,15,25,0.8)', border: '1px solid rgba(167,139,250,0.3)', borderRadius: '4px', padding: '2px 6px', color: '#e2e8f0', fontSize: '12px', width: '100%' }} />
                    ) : (u.display_name || '—')}
                  </td>
                  <td>
                    <span className={`badge badge-${u.plan}`}>
                      {u.plan === 'premium' ? '✨ Premium' : u.plan === 'enterprise' ? '🏢 Enterprise' : 'Free'}
                    </span>
                  </td>
                  <td>
                    <span className={`badge badge-${u.subscription_status || 'expired'}`}>
                      {u.subscription_status || 'none'}
                    </span>
                  </td>
                  <td style={{ fontSize: '11px', color: '#64748b', maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {u.paypal_subscription_id ? (
                      <span title={u.paypal_subscription_id} style={{ color: '#60a5fa', cursor: 'help' }}>
                        💳 {u.paypal_subscription_id.substring(0, 8)}...
                      </span>
                    ) : '—'}
                  </td>
                  <td style={{ fontSize: '12px', color: '#64748b' }}>
                    {u.subscription_end ? new Date(u.subscription_end).toLocaleDateString() : '—'}
                  </td>
                  <td style={{ fontSize: '12px', color: '#64748b' }}>
                    {new Date(u.created_at).toLocaleDateString()}
                  </td>
                  <td style={{ textAlign: 'center' }}>{u.upload_count}</td>
                  <td>
                    <div className="admin-actions">
                      {editingUser === u.id ? (
                        <>
                          <button className="admin-btn approve" onClick={() => saveEdit(u.id)} title="Guardar">💾</button>
                          <button className="admin-btn" onClick={() => setEditingUser(null)} title="Cancelar">✖</button>
                        </>
                      ) : (
                        <>
                          <select
                            className="admin-select"
                            value={u.plan}
                            onChange={e => changePlan(u.id, e.target.value)}
                            style={{ padding: '4px 8px', fontSize: '11px' }}
                          >
                            <option value="free">Free</option>
                            <option value="premium">Premium</option>
                            <option value="enterprise">Enterprise</option>
                          </select>
                          <input
                            type="number"
                            placeholder="Días"
                            value={grantDays[u.id] || ''}
                            onChange={e => setGrantDays(prev => ({ ...prev, [u.id]: e.target.value }))}
                            style={{ width: '50px', padding: '4px 6px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(15,15,25,0.8)', color: '#e2e8f0', fontSize: '11px' }}
                          />
                          <button className="admin-btn approve" onClick={() => grantAccess(u.id)} title="Dar días premium">🎟️</button>
                          <button className="admin-btn" onClick={() => startEdit(u)} title="Editar">✏️</button>
                          <button className="admin-btn reject" onClick={() => deleteUser(u.id, u.email)} title="Eliminar usuario">🗑️</button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
