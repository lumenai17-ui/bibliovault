import { useState, useEffect } from 'react';
import { MessageCircle, ChevronUp, ChevronDown, Pin, Send, AlertTriangle, Plus, Clock, TrendingUp, Users } from 'lucide-react';
import {
  fetchBookCommunity, fetchThreads, fetchThread,
  createThreadApi, createReplyApi, voteApi,
  type Community, type Thread, type Reply,
} from '../../services/api';
import './Community.css';

// ── Book Discussion Tab (goes inside BookDetail) ──

export function BookDiscussion({ bookId }: { bookId: number }) {
  const [community, setCommunity] = useState<Community | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [userVotes, setUserVotes] = useState<Record<number, number>>({});
  const [activeThread, setActiveThread] = useState<Thread | null>(null);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [replyVotes, setReplyVotes] = useState<Record<number, number>>({});
  const [showCompose, setShowCompose] = useState(false);
  const [sort, setSort] = useState('recent');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadCommunity();
  }, [bookId]);

  const loadCommunity = async () => {
    setLoading(true);
    try {
      const c = await fetchBookCommunity(bookId);
      setCommunity(c);
      if (c?.id) {
        const data = await fetchThreads(c.id, sort);
        setThreads(data.threads || []);
        setUserVotes(data.userVotes || {});
      }
    } catch (err) {
      console.error('Failed to load community:', err);
    } finally {
      setLoading(false);
    }
  };

  const openThread = async (thread: Thread) => {
    try {
      const data = await fetchThread(thread.id);
      setActiveThread(data.thread);
      setReplies(data.replies || []);
      setReplyVotes(data.userVotes || {});
    } catch (err) {
      console.error('Failed to load thread:', err);
    }
  };

  const handleVote = async (type: 'thread' | 'reply', id: number, value: 1 | -1) => {
    try {
      await voteApi(type, id, value);
      if (activeThread) await openThread(activeThread);
      else loadCommunity();
    } catch {}
  };

  if (loading) {
    return <div className="community-loading">Cargando discusión...</div>;
  }

  if (activeThread) {
    return (
      <ThreadDetail
        thread={activeThread}
        replies={replies}
        userVotes={replyVotes}
        onBack={() => { setActiveThread(null); loadCommunity(); }}
        onVote={handleVote}
      />
    );
  }

  return (
    <div className="book-discussion">
      <div className="discussion-header">
        <h3><MessageCircle size={18} /> Discusión</h3>
        <div className="discussion-actions">
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
      </div>

      {showCompose && community && (
        <ThreadComposer
          communityId={community.id}
          onCreated={() => { setShowCompose(false); loadCommunity(); }}
          onCancel={() => setShowCompose(false)}
        />
      )}

      {threads.length === 0 ? (
        <div className="no-threads">
          <MessageCircle size={40} />
          <p>Aún no hay discusiones sobre este libro.</p>
          <button onClick={() => setShowCompose(true)}>Inicia la conversación</button>
        </div>
      ) : (
        <div className="thread-list">
          {threads.map(t => (
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
      )}
    </div>
  );
}

// ── Thread Detail with Replies ──

function ThreadDetail({
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
      onBack(); // reload
    } catch (err: any) {
      alert(err.message);
    } finally {
      setSending(false);
    }
  };

  // Build nested replies
  const topReplies = replies.filter(r => !r.parent_reply_id);
  const childReplies = (parentId: number) => replies.filter(r => r.parent_reply_id === parentId);

  return (
    <div className="thread-detail">
      <button className="btn-back" onClick={onBack}>← Volver a discusiones</button>

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
              <button onClick={() => { setReplyTo(r.id); }}>Responder</button>
            </div>

            {/* Nested replies */}
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

// ── Thread Composer ──

function ThreadComposer({
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
      <input
        type="text"
        placeholder="Título del tema..."
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <textarea
        placeholder="¿Qué quieres discutir?"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={5}
      />
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
