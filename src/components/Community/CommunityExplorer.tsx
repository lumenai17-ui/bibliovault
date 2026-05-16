import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Users, Plus, MessageCircle, Clock, TrendingUp, ChevronUp, ChevronDown,
  Pin, AlertTriangle, Send, ArrowLeft, UserPlus, UserMinus, Crown, Shield,
  BookOpen, Landmark, Activity,
} from 'lucide-react';
import {
  fetchCommunities, fetchMyCommunities, fetchCommunity,
  fetchBookCommunities, fetchOfficialCommunities, fetchRecentThreads,
  fetchThreads, fetchThread, createThreadApi, createReplyApi, voteApi,
  joinCommunityApi, leaveCommunityApi, createCommunityApi,
  getBookCoverUrl,
  type Community, type Thread, type Reply, type GlobalThread,
} from '../../services/api';
import './Community.css';

// ── Forum Hub (main page with 4 tabs) ──

type ForumTab = 'activity' | 'books' | 'communities' | 'official';

export default function CommunityExplorer({ onNavigateBack }: { onNavigateBack?: () => void }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<ForumTab>('activity');
  const [communities, setCommunities] = useState<Community[]>([]);
  const [bookForums, setBookForums] = useState<Community[]>([]);
  const [officialForums, setOfficialForums] = useState<Community[]>([]);
  const [recentThreads, setRecentThreads] = useState<GlobalThread[]>([]);
  const [myCommunities, setMyCommunities] = useState<Community[]>([]);
  const [activeCommunity, setActiveCommunity] = useState<Community | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [all, mine, books, official, recent] = await Promise.all([
        fetchCommunities(50),
        fetchMyCommunities().catch(() => []),
        fetchBookCommunities(50).catch(() => []),
        fetchOfficialCommunities().catch(() => []),
        fetchRecentThreads(30).catch(() => []),
      ]);
      setCommunities((all || []).filter((c: Community) => c.type !== 'official' && !c.book_id));
      setMyCommunities(mine || []);
      setBookForums(books || []);
      setOfficialForums(official || []);
      setRecentThreads(recent || []);
    } catch (err) {
      console.error('Failed to load forum data:', err);
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
        <h2><MessageCircle size={22} /> {t('community.title')}</h2>
        <button className="btn-new-community" onClick={() => setShowCreate(true)}>
          <Plus size={14} /> {t('community.createCommunity')}
        </button>
      </div>

      {/* 4-tab navigation */}
      <div className="forum-tabs">
        <button className={tab === 'activity' ? 'active' : ''} onClick={() => setTab('activity')}>
          <Activity size={14} /> {t('community.tabActivity')}
        </button>
        <button className={tab === 'books' ? 'active' : ''} onClick={() => setTab('books')}>
          <BookOpen size={14} /> {t('community.tabBooks', { count: bookForums.length })}
        </button>
        <button className={tab === 'communities' ? 'active' : ''} onClick={() => setTab('communities')}>
          <Users size={14} /> {t('community.tabCommunities', { count: communities.length })}
        </button>
        <button className={tab === 'official' ? 'active' : ''} onClick={() => setTab('official')}>
          <Landmark size={14} /> {t('community.tabOfficial')}
        </button>
      </div>

      {showCreate && (
        <CreateCommunityModal
          onCreated={() => { setShowCreate(false); loadAll(); }}
          onCancel={() => setShowCreate(false)}
        />
      )}

      {loading ? (
        <div className="community-loading">{t('community.loading')}</div>
      ) : (
        <>
          {/* Tab: Activity — Global Feed */}
          {tab === 'activity' && (
            <div className="activity-feed">
              {recentThreads.length === 0 ? (
                <div className="no-threads">
                  <Activity size={40} />
                  <p>{t('community.noActivity')}</p>
                </div>
              ) : (
                recentThreads.map(t => (
                  <div key={t.id} className="activity-card" onClick={() => openCommunity(t.community_slug)}>
                    <div className="activity-source">
                      <span className="activity-source-icon">
                        {t.book_id ? '📚' : t.community_type === 'official' ? '🏛️' : '👥'}
                      </span>
                      <span className="activity-source-name">{t.community_name}</span>
                    </div>
                    <div className="thread-card" style={{ border: 'none', background: 'transparent', padding: '8px 0' }}>
                      <div className="thread-votes" style={{ minWidth: 28 }}>
                        <span style={{ fontSize: 12 }}>{t.upvotes > 0 ? `+${t.upvotes}` : t.upvotes}</span>
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
                          <span>{timeAgo(t.created_at, t)}</span>
                          <span>·</span>
                          <span><MessageCircle size={11} /> {t.reply_count}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Tab: Books — Book Forums */}
          {tab === 'books' && (
            <div className="community-grid">
              {bookForums.length === 0 ? (
                <div className="no-communities">
                  <BookOpen size={40} />
                  <p>{t('community.noBookForums')}</p>
                </div>
              ) : bookForums.map(c => (
                <BookForumCard key={c.id} community={c} onClick={() => openCommunity(c.slug)} />
              ))}
            </div>
          )}

          {/* Tab: Communities — User-created */}
          {tab === 'communities' && (
            <div className="community-grid">
              {/* My communities first */}
              {myCommunities.length > 0 && (
                <>
                  <div className="grid-section-title">{t('community.myCommunities')}</div>
                  {myCommunities.filter(c => c.type !== 'official' && !c.book_id).map(c => (
                    <CommunityCard key={c.id} community={c} onClick={() => openCommunity(c.slug)} />
                  ))}
                  <div className="grid-section-title">{t('community.explore')}</div>
                </>
              )}
              {communities.length === 0 ? (
                <div className="no-communities">
                  <Users size={40} />
                  <p>{t('community.noCommunities')}</p>
                  <button onClick={() => setShowCreate(true)}>
                    <Plus size={14} /> {t('community.createFirst')}
                  </button>
                </div>
              ) : communities.map(c => (
                <CommunityCard key={c.id} community={c} onClick={() => openCommunity(c.slug)} />
              ))}
            </div>
          )}

          {/* Tab: Official */}
          {tab === 'official' && (
            <div className="community-grid official-grid">
              {officialForums.map(c => (
                <OfficialForumCard key={c.id} community={c} onClick={() => openCommunity(c.slug)} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Book Forum Card (with cover thumbnail) ──

function BookForumCard({ community, onClick }: { community: Community; onClick: () => void }) {
  const { t } = useTranslation();
  const coverUrl = community.book_id ? getBookCoverUrl(community.book_id) : null;

  return (
    <div className="book-forum-card" onClick={onClick}>
      <div className="book-forum-cover">
        {coverUrl ? (
          <img src={coverUrl} alt={community.name} onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        ) : (
          <BookOpen size={24} />
        )}
      </div>
      <div className="book-forum-info">
        <div className="community-card-name">{community.name}</div>
        <div className="community-card-desc">
          {(community as any).book_author && <span style={{ color: 'var(--accent-primary)', fontSize: 11 }}>{(community as any).book_author}</span>}
        </div>
        <div className="community-card-stats">
          <span><MessageCircle size={11} /> {t('community.threadsCount', { count: community.thread_count || 0 })}</span>
          <span><Users size={11} /> {community.member_count}</span>
        </div>
      </div>
    </div>
  );
}

// ── Official Forum Card ──

function OfficialForumCard({ community, onClick }: { community: Community; onClick: () => void }) {
  const { t } = useTranslation();
  const iconMap: Record<string, string> = {
    'novedades': '📢',
    'recomendaciones': '💡',
    'lecturas-del-mes': '📖',
    'feedback': '🐛',
    'general': '💬',
  };

  return (
    <div className="official-forum-card" onClick={onClick}>
      <div className="official-forum-icon">{iconMap[community.slug] || '🏛️'}</div>
      <div className="official-forum-info">
        <div className="community-card-name">{community.name}</div>
        <div className="community-card-desc">{community.description}</div>
        <div className="community-card-stats">
          <span><MessageCircle size={11} /> {t('community.threadsCount', { count: community.thread_count || 0 })}</span>
        </div>
      </div>
    </div>
  );
}

// ── Community Card ──

function CommunityCard({ community, onClick }: { community: Community; onClick: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="community-card" onClick={onClick}>
      <div className="community-card-icon">👥</div>
      <div className="community-card-info">
        <div className="community-card-name">
          {community.name}
          {community.user_role && (
            <span className="role-badge">
              {community.user_role === 'creator' ? <Crown size={10} /> : <Shield size={10} />}
              {community.user_role}
            </span>
          )}
        </div>
        <div className="community-card-desc">{community.description}</div>
        <div className="community-card-stats">
          <span><Users size={11} /> {t('community.membersCount', { count: community.member_count })}</span>
          <span><MessageCircle size={11} /> {t('community.threadsCount', { count: community.thread_count || 0 })}</span>
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
  const { t } = useTranslation();
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
          <ArrowLeft size={16} /> {t('community.title')}
        </button>
        <div className="community-banner-content">
          <div className="community-banner-icon">
            {community.book_id ? '📚' : community.type === 'official' ? '🏛️' : '👥'}
          </div>
          <div className="community-banner-info">
            <h2>{community.name}</h2>
            <p>{community.description}</p>
            <div className="community-banner-stats">
              <span><Users size={13} /> {t('community.membersCount', { count: community.member_count })}</span>
              <span><MessageCircle size={13} /> {t('community.threadsCount', { count: threads.length })}</span>
              {community.creator_name && (
                <span>{t('community.created_by', { name: community.creator_name })}</span>
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
                <><UserMinus size={14} /> {t('community.btnLeave')}</>
              ) : (
                <><UserPlus size={14} /> {t('community.btnJoin')}</>
              )}
            </button>
          )}
        </div>
      </div>

      {community.rules && (
        <div className="community-rules">
          <strong>📋 {t('community.rules')}</strong> {community.rules}
        </div>
      )}

      <div className="community-toolbar">
        <div className="sort-tabs">
          <button className={sort === 'recent' ? 'active' : ''} onClick={() => setSort('recent')}>
            <Clock size={12} /> {t('community.sortRecent')}
          </button>
          <button className={sort === 'popular' ? 'active' : ''} onClick={() => setSort('popular')}>
            <TrendingUp size={12} /> {t('community.sortPopular')}
          </button>
        </div>
        <button className="btn-new-thread" onClick={() => setShowCompose(true)}>
          <Plus size={14} /> {t('community.newThread')}
        </button>
      </div>

      {showCompose && (
        <ThreadComposerInline
          communityId={community.id}
          onCreated={() => { setShowCompose(false); loadThreads(); }}
          onCancel={() => setShowCompose(false)}
        />
      )}

      <div className="thread-list">
        {threads.length === 0 ? (
          <div className="no-threads">
            <MessageCircle size={40} />
            <p>{t('community.noThreads')}</p>
            <button onClick={() => setShowCompose(true)}>{t('community.startConversation')}</button>
          </div>
        ) : threads.map(tData => (
          <div key={tData.id} className={`thread-card ${tData.pinned ? 'pinned' : ''}`} onClick={() => openThread(tData)}>
            <div className="thread-votes">
              <button onClick={(e) => { e.stopPropagation(); handleVote('thread', tData.id, 1); }}
                className={userVotes[tData.id] === 1 ? 'voted' : ''}>
                <ChevronUp size={16} />
              </button>
              <span>{tData.upvotes}</span>
              <button onClick={(e) => { e.stopPropagation(); handleVote('thread', tData.id, -1); }}
                className={userVotes[tData.id] === -1 ? 'voted-down' : ''}>
                <ChevronDown size={16} />
              </button>
            </div>
            <div className="thread-content">
              <div className="thread-title">
                {tData.pinned && <Pin size={12} className="pin-icon" />}
                {tData.has_spoilers && <AlertTriangle size={12} className="spoiler-icon" />}
                {tData.title}
              </div>
              <div className="thread-meta">
                <span>{tData.author_name}</span>
                <span>·</span>
                <span>{timeAgo(tData.created_at, t)}</span>
                <span>·</span>
                <span><MessageCircle size={11} /> {tData.reply_count}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Thread View ──

function CommunityThreadView({
  thread, replies, userVotes, onBack, onVote,
}: {
  thread: Thread;
  replies: Reply[];
  userVotes: Record<number, number>;
  onBack: () => void;
  onVote: (type: 'thread' | 'reply', id: number, value: 1 | -1) => void;
}) {
  const { t } = useTranslation();
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
      <button className="btn-back" onClick={onBack}>{t('community.btnBack')}</button>

      <div className="thread-full">
        <h3>{thread.title}</h3>
        <div className="thread-author">
          <strong>{thread.author_name}</strong> · {timeAgo(thread.created_at, t)}
          {thread.has_spoilers && <span className="spoiler-tag">{t('community.spoilerTag')}</span>}
        </div>
        <div className="thread-body">{thread.content}</div>
      </div>

      <div className="replies-section">
        <h4><MessageCircle size={14} /> {t('community.repliesCount', { count: replies.length })}</h4>

        {topReplies.map(r => (
          <div key={r.id} className="reply">
            <div className="reply-header">
              <strong>{r.author_name}</strong>
              <span>{timeAgo(r.created_at, t)}</span>
            </div>
            <div className="reply-body">{r.content}</div>
            <div className="reply-actions">
              <button onClick={() => onVote('reply', r.id, 1)}
                className={userVotes[r.id] === 1 ? 'voted' : ''}>
                <ChevronUp size={13} /> {r.upvotes}
              </button>
              <button onClick={() => setReplyTo(r.id)}>{t('community.btnReply')}</button>
            </div>

            {childReplies(r.id).map(child => (
              <div key={child.id} className="reply nested">
                <div className="reply-header">
                  <strong>{child.author_name}</strong>
                  <span>{timeAgo(child.created_at, t)}</span>
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
              {t('community.replyingTo', { name: replies.find(r => r.id === replyTo)?.author_name })}
              <button onClick={() => setReplyTo(undefined)}>×</button>
            </div>
          )}
          <textarea
            placeholder={t('community.replyPlaceholder')}
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            rows={3}
          />
          <button onClick={handleReply} disabled={sending || !replyText.trim()}>
            <Send size={14} /> {sending ? t('community.sending') : t('community.btnSend')}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Thread Composer ──

function ThreadComposerInline({
  communityId, onCreated, onCancel,
}: {
  communityId: number;
  onCreated: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
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
      <h4>{t('community.newThreadTitle')}</h4>
      {error && <div className="composer-error">{error}</div>}
      <input type="text" placeholder={t('community.threadTitlePlaceholder')} value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea placeholder={t('community.threadContentPlaceholder')} value={content} onChange={(e) => setContent(e.target.value)} rows={5} />
      <div className="composer-footer">
        <label className="spoiler-check">
          <input type="checkbox" checked={spoilers} onChange={(e) => setSpoilers(e.target.checked)} />
          <AlertTriangle size={12} /> {t('community.hasSpoilers')}
        </label>
        <div className="composer-buttons">
          <button className="btn-cancel" onClick={onCancel}>{t('community.btnCancel')}</button>
          <button className="btn-submit" onClick={handleSubmit} disabled={sending}>
            {sending ? t('community.publishing') : t('community.btnPublish')}
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
  const { t } = useTranslation();
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
        <h3><Users size={18} /> {t('community.createModalTitle')}</h3>
        {error && <div className="composer-error">{error}</div>}

        <div className="form-group">
          <label>{t('community.nameLabel')}</label>
          <input type="text" placeholder={t('community.namePlaceholder')} value={name} onChange={e => setName(e.target.value)} />
        </div>

        <div className="form-group">
          <label>{t('community.descLabel')}</label>
          <textarea placeholder={t('community.descPlaceholder')} value={description} onChange={e => setDescription(e.target.value)} rows={3} />
        </div>

        <div className="form-group">
          <label>{t('community.rulesLabel')}</label>
          <textarea placeholder={t('community.rulesPlaceholder')} value={rules} onChange={e => setRules(e.target.value)} rows={2} />
        </div>

        <div className="form-group">
          <label>{t('community.typeLabel')}</label>
          <div className="type-selector">
            <button className={type === 'public' ? 'active' : ''} onClick={() => setType('public')}>
              {t('community.typePublic')}
            </button>
            <button className={type === 'private' ? 'active' : ''} onClick={() => setType('private')}>
              {t('community.typePrivate')}
            </button>
          </div>
        </div>

        <div className="modal-actions">
          <button className="btn-cancel" onClick={onCancel}>{t('community.btnCancel')}</button>
          <button className="btn-submit" onClick={handleCreate} disabled={creating}>
            {creating ? t('community.creating') : t('community.btnCreate')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Utility ──

function timeAgo(dateStr: string, t: any): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = Math.floor((now - then) / 1000);
  if (diff < 60) return t('community.timeMoment', { defaultValue: 'hace un momento' });
  if (diff < 3600) return t('community.timeM', { count: Math.floor(diff / 60) });
  if (diff < 86400) return t('community.timeH', { count: Math.floor(diff / 3600) });
  if (diff < 604800) return t('community.timeD', { count: Math.floor(diff / 86400) });
  return new Date(dateStr).toLocaleDateString();
}
