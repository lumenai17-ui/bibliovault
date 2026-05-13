import { useState } from 'react';
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
} from 'lucide-react';
import type { ApiCategory } from '../../services/api';
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
}

const NAV_ITEMS = [
  { id: 'home', label: 'Inicio', icon: Home },
  { id: 'all', label: 'Toda la Biblioteca', icon: Library },
  { id: 'favorites', label: 'Favoritos', icon: Heart },
  { id: 'reading', label: 'Leyendo', icon: BookOpen },
  { id: 'recent', label: 'Recientes', icon: Clock },
];

export default function Sidebar({ activeSection, onSectionChange, onUpdateCollections, stats, categories = [], collections = [] }: SidebarProps) {
  const [showCategories, setShowCategories] = useState(false);
  const [showCollections, setShowCollections] = useState(true);
  const [showUploads, setShowUploads] = useState(false);

  // Only show categories with books
  const activeCategories = categories.filter((c) => c.book_count > 0);

  return (
    <aside className="sidebar">
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
          <div className="sidebar-section-title">Biblioteca</div>
          {NAV_ITEMS.map((item) => (
            <div
              key={item.id}
              className={`sidebar-item ${activeSection === item.id ? 'active' : ''}`}
              onClick={() => onSectionChange(item.id)}
            >
              <item.icon />
              <span>{item.label}</span>
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
            Categorías ({activeCategories.length})
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
            Mis Colecciones ({collections.length})
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
                      if (confirm(`¿Estás seguro de que deseas eliminar la colección "${col.name}"? Los libros no se borrarán.`)) {
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
                    title="Eliminar colección"
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
          <div className="sidebar-section-title">Herramientas</div>
          <div
            className="sidebar-item"
            onClick={() => setShowUploads(true)}
          >
            <CloudUpload />
            <span>Subir Archivos</span>
          </div>
          <div
            className={`sidebar-item ${activeSection === 'stats' ? 'active' : ''}`}
            onClick={() => onSectionChange('stats')}
          >
            <BarChart3 />
            <span>Estadísticas</span>
          </div>
        </div>
      </nav>

      <div className="sidebar-stats">
        <div className="sidebar-stats-grid">
          <div className="sidebar-stat">
            <div className="sidebar-stat-value">{stats.total.toLocaleString()}</div>
            <div className="sidebar-stat-label">Libros</div>
          </div>
          <div className="sidebar-stat">
            <div className="sidebar-stat-value">{stats.categories}</div>
            <div className="sidebar-stat-label">Categorías</div>
          </div>
        </div>
      </div>

      {showUploads && <UploadPanel onClose={() => setShowUploads(false)} />}
    </aside>
  );
}
