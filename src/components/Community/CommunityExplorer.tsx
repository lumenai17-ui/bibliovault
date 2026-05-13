import { useState, useEffect } from 'react';
import {
  Users, Plus, MessageCircle, Clock, TrendingUp, ChevronUp, ChevronDown,
  Pin, AlertTriangle, Send, ArrowLeft, Settings, UserPlus, UserMinus, Crown, Shield,
} from 'lucide-react';
import {
  fetchCommunities, fetchMyCommunities, fetchCommunity,
  fetchThreads, fetchThread, createThreadApi, createReplyApi, voteApi,
  joinCommunityApi, leaveCommunityApi, createCommunityApi,
  type Community, type Thread, type Reply,
} from '../../services/api';
import './Community.css';

// ── Community Explorer (main page) ──

export default function CommunityExplorer({ onNavigateBack }: { onNavigateBack?: () => void }) {
  const [tab, setTab] = useState<'explore' | 'mine'>('explore');
  const [communities, setCommunities] = useState<Community[]>([]);
  const [myCommunities, setMyCommunities] = useState<Community[]>([]);
  const [activeCommunity, setActiveCommunity] = useState<Community | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [all, mine] = await Promise.all([
        fetchCommunities(50),
        fetchMyCommunities(),
      ]);
      setCommunities(all || []);
      setMyCommunities(mine || []);
    } catch (err) {
      console.error('Failed to load communities:', err);
    } finally {
      setLoading(false);
    }
  };

  const openCommunity = async (slug: string) => {
    try {
      const c = await fetchCommunity(slug);
      setActiveCommunity(c);
    } catch (err) {
      console.error('Failed to load community:', err);
    }
  };

  if (activeCommunity) {
    return (
      <CommunityPage
        community={activeCommunity}
        onBack={() => { setActiveCommunity(null); loadAll(); }}
        onRefresh={() => openCommunity(activeCommunity.slug)}
      />
    );
  }

  return (
    <div className="community-explorer">
      <div className="community-explorer-header">
        <h2><Users size={22} /> Comunidades</h2>
        <button className="btn-new-community" onClick={() => setShowCreate(true)}>
          <Plus size={14} /> Crear Comunidad
        </button>
      </div>

      <div className="community-tabs">
        <button className={tab === 'explore' ? 'active' : ''} onClick={() => setTab('explore')}>
          Explorar
        </button>
        <button className={tab === 'mine' ? 'active' : ''} onClick={() => setTab('mine')}>
          Mis Comunidades ({myCommunities.length})
        </button>
      </div>

      {showCreate && (
        <CreateCommunityModal
          onCreated={() => { setShowCreate(false); loadAll(); }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {loading ? (
        <div className="community-loading">Cargando comunidades...</div>
      ) : (
        <div className="community-grid">
          {(tab === 'explore' ? communities : myCommunities).map(c => (
            <CommunityCard key={c.id} community={c} onClick={() => openCommunity(c.slug)} />
          ))}
          {(tab === 'explore' ? communities : myCommunities).length === 0 && (
            <div className="no-communities">
              <Users size={40} />
              <p>{tab === 'explore' ? 'No hay comunidades aún.' : 'No perteneces a ninguna comunidad.'}</p>
              <button onClick={() => setShowCreate(true)}>
                <Plus size={14} /> Crear la primera
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Community Card ──

function CommunityCard({ community, onClick }: { community: Community; onClick: () => void }) {
  const isBook = !!community.book_id;
  const isOfficial = community.type === 'official';

  return (
    <div className="community-card" onClick={onClick}>
      <div className="community-card-icon">
        {isBook ? '📚' : isOfficial ? '🏛️' : '👥'}
      </div>
      <div className="community-card-info">
        <div className="community-card-name">
          {community.name}
          {isOfficial && <Crown size={12} className="official-badge" />}
        </div>
        <div className="community-card-desc">{community.description}</div>
        <div className="community-card-stats">
          <span><Users size={11} /> {community.member_count}</span>
          <span><MessageCircle size={11} /> {community.thread_count || 0}</span>
          {community.user_role && (
            <span className="role-badge">
              {community.user_role === 'creator' ? <Crown size={10} /> : <Shield size={10} />}
              {community.user_role}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Community Page (full view) ──

function CommunityPage({
  community, onBack, onRefresh,
}: {
  community: Community;
  onBack: () => void;
  onRefresh: () => void;
}) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [userVotes, setUserVotes] = useState<Record<number, number>>({});
  const [activeThread, setActiveThread] = useState<{thread: Thread; replies: Reply[]; replyVotes: Record<number, number>} | null>(null);
  const [showCompose, setShowCompose] = useState(false);
  const [sort, setSort] = useState('recent');
  const [joining, setJoining] = useState(false);

  useEffect(() => { loadThreads(); }, [community.id, sort]);

  const loadThreads = async () => {
    try {
      const data = await fetchThreads(community.id, sort);
      setThreads(data.threads || []);
      setUserVotes(data.userVotes || {});
    } catch (err) {
      console.error('Failed to load threads:', err);
    }
  };

  const openThread = async (thread: Thread) => {
    try {
      const data = await fetchThread(thread.id);
      setActiveThread({ thread: data.thread, replies: data.replies || [], replyVotes: data.userVotes || {} });
    } catch (err) {
      console.error('Failed to load thread:', err);
    }
  };

  const handleJoin = async () => {
    setJoining(true);
    try {
      if (community.user_role) {
        await leaveCommunityApi(community.id);
      } else {
        await joinCommunityApi(community.id);
      }
      onRefresh();
    } catch (err) {
      console.error('Join/leave error:', err);
    } finally {
      setJoining(false);
    }
  };

  const handleVote = async (type: 'thread' | 'reply', id: number, value: 1 | -1) => {
    try {
      await voteApi(type, id, value);
      if (activeThread) {
        const data = await fetchThread(activeThread.thread.id);
        setActiveThread({ thread: data.thread, replies: data.replies || [], replyVotes: data.userVotes || {} });
      } else {
        loadThreads();
      }
    } catch {}
  };

  if (activeThread) {
    return (
      <div className="community-page">
        <CommunityThreadView
          thread={activeThread.thread}
          replies={activeThread.replies}
          userVotes={activeThread.replyVotes}
          onBack={() => { setActiveThread(null); loadThreads(); }}
          onVote={handleVote}
        />
      </div>
    );
  }

  return (
    <div className="community-page">
      {/* Banner */}
      <div className="community-banner">
        <button className="btn-back-community" onClick={onBack}>
          <ArrowLeft size={16} /> Comunidades
        </button>
        <div className="community-banner-content">
          <div className="community-banner-icon">
            {community.book_id ? '📚' : community.type === 'official' ? '🏛️' : '👥'}
          </div>
          <div className="community-banner-info">
            <h2>{community.name}</h2>
            <p>{community.description}</p>
            <div className="community-banner-stats">
              <span><Users size={13} /> {community.member_count} miembros</span>
              <span><MessageCircle size={13} /> {threads.length} temas</span>
              {community.creator_name && (
                <span>Creada por {community.creator_name}</span>
              )}
            </div>
          </div>
          {community.user_role !== 'creator' && (
            <button
              className={`btn-join ${community.user_role ? 'joined' : ''}`}
              onClick={handleJoin}
              disabled={joining}
            >
              {community.user_role ? (
                <><UserMinus size={14} /> Salir</>
              ) : (
                <><UserPlus size={14} /> Unirse</>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Rules */}
      {community.rules && (
        <div className="community-rules">
          <strong>📋 Reglas:</strong> {community.rules}
        </div>
      )}

      {/* Thread toolbar */}
      <div className="community-toolbar">
        <div className="sort-tabs">
          <button className={sort === 'recent' ? 'active' : ''} onClick={() => setSort('recent')}>
            <Clock size={12} /> Recientes
          </button>
          <button className={sort === 'popular' ? 'active' : ''} onClick={() => setSort('popular')}>
            <TrendingUp size={12} /> Populares
          </button>
        </div>
        <button className="btn-new-thread" onClick={() => setShowCompose(true)}>
          <Plus size={14} /> Nuevo Tema
        </button>
      </div>

      {showCompose && (
        <ThreadComposerInline
          communityId={community.id}
          onCreated={() => { setShowCompose(false); loadThreads(); }}
          onCancel={() => setShowCompose(false)}
        />
      )}

      {/* Thread list */}
      <div className="thread-list">
        {threads.length === 0 ? (
          <div className="no-threads">
            <MessageCircle size={40} />
            <p>No hay temas de discusión aún.</p>
            <button onClick={() => setShowCompose(true)}>Inicia la conversación</button>
          </div>
        ) : threads.map(t => (
          <div key={t.id} className={`thread-card ${t.pinned ? 'pinned' : ''}`} onClick={() => openThread(t)}>
            <div className="thread-votes">
              <button onClick={(e) => { e.stopPropagation(); handleVote('thread', t.id, 1); }}
                className={userVotes[t.id] === 1 ? 'voted' : ''}>
                <ChevronUp size={16} />
              </button>
              <span>{t.upvotes}</span>
              <button onClick={(e) => { e.stopPropagation(); handleVote('thread', t.id, -1); }}
                className={userVotes[t.id] === -1 ? 'voted-down' : ''}>
                <ChevronDown size={16} />
              </button>
            </div>
            <div className="thread-content">
              <div className="thread-title">
                {t.pinned && <Pin size={12} className="pin-icon" />}
                {t.has_spoilers && <AlertTriangle size={12} className="spoiler-icon" />}
                {t.title}
              </div>
              <div className="thread-meta">
                <span>{t.author_name}</span>
                <span>·</span>
                <span>{timeAgo(t.created_at)}</span>
                <span>·</span>
                <span><MessageCircle size={11} /> {t.reply_count}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Full Thread View (for CommunityPage) ──

function CommunityThreadView({
  thread, replies, userVotes, onBack, onVote,
}: {
  thread: Thread;
  replies: Reply[];
  userVotes: Record<number, number>;
  onBack: () => void;
  onVote: (type: 'thread' | 'reply', id: number, value: 1 | -1) => void;
}) {
  const [replyText, setReplyText] = useState('');
  const [replyTo, setReplyTo] = useState<number | undefined>(undefined);
  const [sending, setSending] = useState(false);

  const handleReply = async () => {
    if (!replyText.trim()) return;
    setSending(true);
    try {
      await createReplyApi(thread.id, replyText, replyTo);
      setReplyText('');
      setReplyTo(undefined);
      onBack();
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSending(false);
    }
  };

  const topReplies = replies.filter(r => !r.parent_reply_id);
  const childReplies = (parentId: number) => replies.filter(r => r.parent_reply_id === parentId);

  return (
    <div className="thread-detail">
      <button className="btn-back" onClick={onBack}>← Volver a la comunidad</button>

      <div className="thread-full">
        <h3>{thread.title}</h3>
        <div className="thread-author">
          <strong>{thread.author_name}</strong> · {timeAgo(thread.created_at)}
          {thread.has_spoilers && <span className="spoiler-tag">⚠️ Spoilers</span>}
        </div>
        <div className="thread-body">{thread.content}</div>
      </div>

      <div className="replies-section">
        <h4><MessageCircle size={14} /> {replies.length} respuestas</h4>

        {topReplies.map(r => (
          <div key={r.id} className="reply">
            <div className="reply-header">
              <strong>{r.author_name}</strong>
              <span>{timeAgo(r.created_at)}</span>
            </div>
            <div className="reply-body">{r.content}</div>
            <div className="reply-actions">
              <button onClick={() => onVote('reply', r.id, 1)}
                className={userVotes[r.id] === 1 ? 'voted' : ''}>
                <ChevronUp size={13} /> {r.upvotes}
              </button>
              <button onClick={() => setReplyTo(r.id)}>Responder</button>
            </div>

            {childReplies(r.id).map(child => (
              <div key={child.id} className="reply nested">
                <div className="reply-header">
                  <strong>{child.author_name}</strong>
                  <span>{timeAgo(child.created_at)}</span>
                </div>
                <div className="reply-body">{child.content}</div>
                <div className="reply-actions">
                  <button onClick={() => onVote('reply', child.id, 1)}
                    className={userVotes[child.id] === 1 ? 'voted' : ''}>
                    <ChevronUp size={13} /> {child.upvotes}
                  </button>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      {!thread.locked && (
        <div className="reply-composer">
          {replyTo && (
            <div className="replying-to">
              Respondiendo a {replies.find(r => r.id === replyTo)?.author_name}
              <button onClick={() => setReplyTo(undefined)}>×</button>
            </div>
          )}
          <textarea
            placeholder="Escribe tu respuesta..."
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            rows={3}
          />
          <button onClick={handleReply} disabled={sending || !replyText.trim()}>
            <Send size={14} /> {sending ? 'Enviando...' : 'Responder'}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Thread Composer (inline for CommunityPage) ──

function ThreadComposerInline({
  communityId, onCreated, onCancel,
}: {
  communityId: number;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [spoilers, setSpoilers] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!title.trim() || !content.trim()) return;
    setSending(true);
    setError('');
    try {
      await createThreadApi(communityId, title, content, spoilers);
      onCreated();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="thread-composer">
      <h4>Nuevo Tema de Discusión</h4>
      {error && <div className="composer-error">{error}</div>}
      <input type="text" placeholder="Título del tema..." value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea placeholder="¿Qué quieres discutir?" value={content} onChange={(e) => setContent(e.target.value)} rows={5} />
      <div className="composer-footer">
        <label className="spoiler-check">
          <input type="checkbox" checked={spoilers} onChange={(e) => setSpoilers(e.target.checked)} />
          <AlertTriangle size={12} /> Contiene spoilers
        </label>
        <div className="composer-buttons">
          <button className="btn-cancel" onClick={onCancel}>Cancelar</button>
          <button className="btn-submit" onClick={handleSubmit} disabled={sending}>
            {sending ? 'Publicando...' : 'Publicar'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Create Community Modal ──

function CreateCommunityModal({
  onCreated, onCancel,
}: {
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [rules, setRules] = useState('');
  const [type, setType] = useState('public');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const handleCreate = async () => {
    if (!name.trim() || name.length < 3) {
      setError('El nombre debe tener al menos 3 caracteres');
      return;
    }
    setCreating(true);
    setError('');
    try {
      await createCommunityApi(name, description, rules, type);
      onCreated();
    } catch (err: any) {
      setError(err.message || 'Error al crear comunidad');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="create-community-modal" onClick={e => e.stopPropagation()}>
        <h3><Users size={18} /> Crear Comunidad</h3>
        {error && <div className="composer-error">{error}</div>}

        <div className="form-group">
          <label>Nombre</label>
          <input type="text" placeholder="Ej: Ocultismo Avanzado" value={name} onChange={e => setName(e.target.value)} />
        </div>

        <div className="form-group">
          <label>Descripción</label>
          <textarea placeholder="¿De qué trata esta comunidad?" value={description} onChange={e => setDescription(e.target.value)} rows={3} />
        </div>

        <div className="form-group">
          <label>Reglas (opcional)</label>
          <textarea placeholder="Reglas de la comunidad..." value={rules} onChange={e => setRules(e.target.value)} rows={2} />
        </div>

        <div className="form-group">
          <label>Tipo</label>
          <div className="type-selector">
            <button className={type === 'public' ? 'active' : ''} onClick={() => setType('public')}>
              🌐 Pública
            </button>
            <button className={type === 'private' ? 'active' : ''} onClick={() => setType('private')}>
              🔒 Privada
            </button>
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn-cancel" onClick={onCancel}>Cancelar</button>
          <button className="btn-submit" onClick={handleCreate} disabled={creating}>
            {creating ? 'Creando...' : 'Crear Comunidad'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Utility ──

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return 'hace un momento';
  if (diff < 3600) return `hace ${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `hace ${Math.floor(diff / 3600)}h`;
  if (diff < 604800) return `hace ${Math.floor(diff / 86400)}d`;
  return new Date(dateStr).toLocaleDateString('es');
}
