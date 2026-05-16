import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Library,
  Heart,
  BookOpen,
  Clock,
  FolderTree,
  BarChart3,
  ChevronDown,
  ChevronRight,
  Folder,
  Home,
  Trash,
  CloudUpload,
  MessageCircle,
  User,
  Settings,
  LogOut,
  Shield,
  Users,
  BookCheck,
  Ticket,
  FolderOpen,
  Globe,
} from 'lucide-react';
import type { ApiCategory } from '../../services/api';
import type { AuthUser } from '../Auth/AuthPage';
import type { Collection } from '../../types';
import UploadPanel from '../Upload/UploadPanel';
import './Sidebar.css';

interface SidebarProps {
  activeSection: string;
  onSectionChange: (section: string) => void;
  onUpdateCollections?: () => void;
  stats: {
    total: number;
    favorites: number;
    reading: number;
    categories: number;
  };
  categories?: ApiCategory[];
  collections?: Collection[];
  currentUser?: AuthUser | null;
  isOpen?: boolean;
  onLogout?: () => void;
}

const NAV_ITEMS = [
  { id: 'home', key: 'sidebar.home', icon: Home },
  { id: 'all', key: 'sidebar.allBooks', icon: Library },
  { id: 'favorites', key: 'sidebar.favorites', icon: Heart },
  { id: 'reading', key: 'sidebar.reading', icon: BookOpen },
  { id: 'recent', key: 'sidebar.recent', icon: Clock },
  { id: 'my-books', key: 'sidebar.myBooks', icon: FolderOpen },
  { id: 'community-books', key: 'sidebar.communityBooks', icon: Globe },
  { id: 'community', key: 'sidebar.community', icon: MessageCircle },
];

const ADMIN_ITEMS = [
  { id: 'admin', key: 'sidebar.dashboard', icon: BarChart3 },
  { id: 'admin-users', key: 'sidebar.adminUsers', icon: Users },
  { id: 'admin-pending', key: 'sidebar.adminPending', icon: BookCheck },
  { id: 'admin-coupons', key: 'sidebar.adminCoupons', icon: Ticket },
];

export default function Sidebar({ activeSection, onSectionChange, onUpdateCollections, stats, categories = [], collections = [], currentUser, isOpen, onLogout }: SidebarProps) {
  const { t } = useTranslation();
  const [showCategories, setShowCategories] = useState(false);
  const [showCollections, setShowCollections] = useState(true);
  const [showUploads, setShowUploads] = useState(false);

  // Only show categories with books
  const activeCategories = categories.filter((c) => c.book_count > 0);

  return (
    <aside className={`sidebar ${isOpen ? 'open' : ''}`}>
      <div className="sidebar-header">
        <div className="sidebar-logo">
          <Library />
        </div>
        <div className="sidebar-title">
          <h1>BiblioVault</h1>
          <span>AI Library</span>
        </div>
      </div>

      <nav className="sidebar-nav">
        <div className="sidebar-section">
          <div className="sidebar-section-title">{t('sidebar.librarySection')}</div>
          {NAV_ITEMS.map((item) => (
            <div
              key={item.id}
              className={`sidebar-item ${activeSection === item.id ? 'active' : ''}`}
              onClick={() => onSectionChange(item.id)}
            >
              <item.icon />
              <span>{t(item.key)}</span>
              {item.id === 'all' && (
                <span className="sidebar-item-count">{stats.total.toLocaleString()}</span>
              )}
              {item.id === 'favorites' && stats.favorites > 0 && (
                <span className="sidebar-item-count">{stats.favorites}</span>
              )}
              {item.id === 'reading' && stats.reading > 0 && (
                <span className="sidebar-item-count">{stats.reading}</span>
              )}
            </div>
          ))}
        </div>

        {/* Categories Tree */}
        <div className="sidebar-section">
          <div
            className="sidebar-section-title"
            style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
            onClick={() => setShowCategories(!showCategories)}
          >
            {showCategories ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {t('sidebar.categoriesSection')} ({activeCategories.length})
          </div>
          {showCategories && (
            <div className="sidebar-categories">
              {activeCategories
                .sort((a, b) => b.book_count - a.book_count)
                .map((cat) => (
                  <div
                    key={cat.id}
                    className={`sidebar-item sidebar-item-sm ${activeSection === `cat-${cat.id}` ? 'active' : ''}`}
                    onClick={() => onSectionChange(`cat-${cat.id}`)}
                  >
                    <Folder size={14} />
                    <span>{cat.name}</span>
                    <span className="sidebar-item-count">{cat.book_count}</span>
                  </div>
                ))}
            </div>
          )}
        </div>

        {/* Collections */}
        <div className="sidebar-section">
          <div
            className="sidebar-section-title"
            style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
            onClick={() => setShowCollections(!showCollections)}
          >
            {showCollections ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            {t('sidebar.collectionsSection')} ({collections.length})
          </div>
          {showCollections && (
            <div className="sidebar-categories">
              {collections.map((col) => (
                <div
                  key={col.id}
                  className={`sidebar-item sidebar-item-sm ${activeSection === `col-${col.id}` ? 'active' : ''}`}
                  onClick={() => onSectionChange(`col-${col.id}`)}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, overflow: 'hidden' }}>
                    <FolderTree size={14} style={{ color: col.color || '#667eea', flexShrink: 0 }} />
                    <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{col.name}</span>
                    <span className="sidebar-item-count" style={{ marginLeft: 'auto' }}>{col.book_count || 0}</span>
                  </div>
                  <button 
                    className="btn-icon btn-sm" 
                    style={{ opacity: 0.5, color: 'var(--text-muted)' }}
                    onClick={async (e) => {
                      e.stopPropagation();
                      if (confirm(t('sidebar.deleteCollectionConfirm', { name: col.name }))) {
                        try {
                          const { deleteCollection } = await import('../../services/api');
                          await deleteCollection(col.id);
                          if (onUpdateCollections) onUpdateCollections();
                          if (activeSection === `col-${col.id}`) {
                            onSectionChange('home');
                          }
                        } catch (err) {
                          console.error('Failed to delete collection:', err);
                        }
                      }
                    }}
                    title={t('common.delete')}
                  >
                    <Trash size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Tools */}
        <div className="sidebar-section">
          <div className="sidebar-section-title">{t('sidebar.toolsSection')}</div>
          <div
            className="sidebar-item"
            onClick={() => setShowUploads(true)}
          >
            <CloudUpload />
            <span>{t('sidebar.upload')}</span>
          </div>
          <div
            className={`sidebar-item ${activeSection === 'stats' ? 'active' : ''}`}
            onClick={() => onSectionChange('stats')}
          >
            <BarChart3 />
            <span>{t('sidebar.stats')}</span>
          </div>
        </div>

        {/* Admin Section — only visible to admins */}
        {(currentUser as any)?.is_admin && (
          <div className="sidebar-section">
            <div className="sidebar-section-title" style={{ color: '#a78bfa' }}>
              <Shield size={12} style={{ marginRight: '4px' }} />
              {t('sidebar.adminSection')}
            </div>
            {ADMIN_ITEMS.map((item) => (
              <div
                key={item.id}
                className={`sidebar-item ${activeSection === item.id ? 'active' : ''}`}
                onClick={() => onSectionChange(item.id)}
              >
                <item.icon />
                <span>{t(item.key)}</span>
              </div>
            ))}
          </div>
        )}
      </nav>

      <div className="sidebar-stats">
        <div className="sidebar-stats-grid">
          <div className="sidebar-stat">
            <div className="sidebar-stat-value">{stats.total.toLocaleString()}</div>
            <div className="sidebar-stat-label">{t('sidebar.booksLabel')}</div>
          </div>
          <div className="sidebar-stat">
            <div className="sidebar-stat-value">{stats.categories}</div>
            <div className="sidebar-stat-label">{t('sidebar.categoriesLabel')}</div>
          </div>
        </div>
      </div>

      {/* User Section */}
      {currentUser && (
        <div className="sidebar-user">
          <div className="sidebar-user-info" onClick={() => onSectionChange('settings')}>
            <div className="sidebar-user-avatar">
              {currentUser.avatar_url ? <img src={currentUser.avatar_url} alt="" /> : <User size={16} />}
            </div>
            <div className="sidebar-user-details">
              <div className="sidebar-user-name">{currentUser.display_name || t('sidebar.defaultUser')}</div>
              <div className={`sidebar-user-plan ${currentUser.plan === 'premium' ? 'premium' : 'free'}`}>
                {currentUser.plan === 'premium' ? '✨ Premium' : 'Free'}
              </div>
            </div>
            <Settings size={14} style={{ color: 'var(--text-muted)' }} />
          </div>
          <button
            className="sidebar-logout-btn"
            title={t('sidebar.logoutBtn')}
            onClick={(e) => { e.stopPropagation(); onLogout?.(); }}
          >
            <LogOut size={14} />
          </button>
        </div>
      )}

      {showUploads && <UploadPanel onClose={() => setShowUploads(false)} />}
    </aside>
  );
}
