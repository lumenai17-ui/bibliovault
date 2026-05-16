import { useState, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Search,
  LayoutGrid,
  List,
  ScanLine,
  Filter,
  Sparkles,
  X,
  Loader2,
  CheckCircle2,
  ImageIcon,
  FileSearch,
} from 'lucide-react';
import type { ViewMode, BookFormat } from '../../types';
import {
  startBatchEnrich,
  fetchEnrichStatus,
  cancelBatchEnrich,
  type EnrichStatus,
  startBatchCoverExtraction,
  fetchCoverBatchStatus,
  cancelBatchCoverExtraction,
  type CoverBatchStatus,
  startBatchIndexing,
  fetchIndexStatus,
  cancelBatchIndexing,
  type IndexBatchStatus,
} from '../../services/api';
import './Header.css';

interface HeaderProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  activeFormat: BookFormat | 'all';
  onFormatChange: (format: BookFormat | 'all') => void;
  onScan: () => void;
  isScanning: boolean;
  onRefresh?: () => void;
  isAdmin?: boolean;
}

const FORMAT_FILTERS: { id: BookFormat | 'all'; key: string }[] = [
  { id: 'all', key: 'header.formatAll' },
  { id: 'epub', key: 'EPUB' },
  { id: 'pdf', key: 'PDF' },
  { id: 'doc', key: 'DOC' },
  { id: 'image', key: 'header.formatImages' },
];

export default function Header({
  searchQuery,
  onSearchChange,
  viewMode,
  onViewModeChange,
  activeFormat,
  onFormatChange,
  onScan,
  isScanning,
  onRefresh,
  isAdmin = false,
}: HeaderProps) {
  const { t } = useTranslation();
  const searchRef = useRef<HTMLInputElement>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [enrichStatus, setEnrichStatus] = useState<EnrichStatus | null>(null);
  const [extractingCovers, setExtractingCovers] = useState(false);
  const [coverStatus, setCoverStatus] = useState<CoverBatchStatus | null>(null);
  const [indexing, setIndexing] = useState(false);
  const [indexStatus, setIndexStatus] = useState<IndexBatchStatus | null>(null);

  // Keyboard shortcut: Ctrl+K to focus search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Poll enrichment status
  useEffect(() => {
    if (!enriching) return;
    const interval = setInterval(async () => {
      const status = await fetchEnrichStatus();
      setEnrichStatus(status);
      if (status.status === 'done' || status.status === 'error' || status.status === 'idle') {
        setEnriching(false);
        if (onRefresh) onRefresh();
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [enriching, onRefresh]);

  // Poll cover extraction status
  useEffect(() => {
    if (!extractingCovers) return;
    const interval = setInterval(async () => {
      const status = await fetchCoverBatchStatus();
      setCoverStatus(status);
      if (status.status === 'done' || status.status === 'cancelled' || status.status === 'idle') {
        setExtractingCovers(false);
        if (onRefresh) onRefresh();
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [extractingCovers, onRefresh]);

  const handleEnrich = async () => {
    setEnriching(true);
    await startBatchEnrich();
  };

  const handleCancelEnrich = async () => {
    await cancelBatchEnrich();
    setEnriching(false);
    setEnrichStatus(null);
  };

  const handleExtractCovers = async () => {
    setExtractingCovers(true);
    await startBatchCoverExtraction();
  };

  const handleCancelCovers = async () => {
    await cancelBatchCoverExtraction();
    setExtractingCovers(false);
    setCoverStatus(null);
  };

  const handleIndex = async () => {
    setIndexing(true);
    await startBatchIndexing();
  };

  const handleCancelIndex = async () => {
    await cancelBatchIndexing();
    setIndexing(false);
    setIndexStatus(null);
  };

  // Poll indexing status
  useEffect(() => {
    if (!indexing) return;
    const interval = setInterval(async () => {
      const status = await fetchIndexStatus();
      setIndexStatus(status);
      if (status.status === 'done' || status.status === 'cancelled' || status.status === 'idle') {
        setIndexing(false);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [indexing]);

  return (
    <header className="header">
      <div className="header-search">
        <Search className="search-icon" />
        <input
          ref={searchRef}
          type="text"
          placeholder={t('header.searchPlaceholder')}
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          id="search-input"
        />
        <span className="search-shortcut">Ctrl+K</span>
      </div>

      <div className="header-filters">
        <button
          className={`btn btn-ghost btn-icon tooltip ${showFilters ? 'active' : ''}`}
          onClick={() => setShowFilters(!showFilters)}
          data-tooltip={t('header.filters')}
        >
          <Filter size={16} />
        </button>

        {showFilters && FORMAT_FILTERS.map((f) => (
          <button
            key={f.id}
            className={`header-filter-chip ${activeFormat === f.id ? 'active' : ''}`}
            onClick={() => onFormatChange(f.id)}
          >
            {f.key.includes('.') ? t(f.key) : f.key}
          </button>
        ))}
      </div>

      <div className="header-actions">
        {/* Enrichment progress banner */}
        {enriching && enrichStatus && (
          <div className="header-enrich-status">
            <Loader2 size={12} className="spin" />
            <span>
              {enrichStatus.processed}/{enrichStatus.total} — {enrichStatus.enriched} ✓
            </span>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={handleCancelEnrich} title={t('header.cancel')}>
              <X size={12} />
            </button>
          </div>
        )}

        {/* Done banner */}
        {!enriching && enrichStatus?.status === 'done' && enrichStatus.enriched > 0 && (
          <div className="header-enrich-done">
            <CheckCircle2 size={12} />
            <span>{t('header.enrichedCount', { count: enrichStatus.enriched })}</span>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setEnrichStatus(null)}>
              <X size={12} />
            </button>
          </div>
        )}

        {/* Cover extraction progress banner */}
        {extractingCovers && coverStatus && (
          <div className="header-enrich-status" style={{ background: 'rgba(168, 85, 247, 0.15)' }}>
            <Loader2 size={12} className="spin" />
            <span>
              🖼️ {coverStatus.processed}/{coverStatus.total} — {coverStatus.extracted} ✓
            </span>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={handleCancelCovers} title={t('header.cancel')}>
              <X size={12} />
            </button>
          </div>
        )}

        {/* Cover extraction done banner */}
        {!extractingCovers && coverStatus?.status === 'done' && coverStatus.extracted > 0 && (
          <div className="header-enrich-done" style={{ background: 'rgba(168, 85, 247, 0.15)' }}>
            <CheckCircle2 size={12} />
            <span>{t('header.extractedCount', { count: coverStatus.extracted })}</span>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setCoverStatus(null)}>
              <X size={12} />
            </button>
          </div>
        )}

        <div className="header-view-toggle">
          <button
            className={`header-view-btn ${viewMode === 'grid' ? 'active' : ''}`}
            onClick={() => onViewModeChange('grid')}
            title={t('header.viewGrid')}
          >
            <LayoutGrid size={14} />
          </button>
          <button
            className={`header-view-btn ${viewMode === 'list' ? 'active' : ''}`}
            onClick={() => onViewModeChange('list')}
            title={t('header.viewList')}
          >
            <List size={14} />
          </button>
        </div>

        {isAdmin && (<>
        <button
          className={`btn btn-sm header-cover-btn ${extractingCovers ? 'extracting' : ''}`}
          onClick={handleExtractCovers}
          disabled={extractingCovers || isScanning}
          style={{
            background: extractingCovers ? 'var(--bg-surface)' : 'linear-gradient(135deg, #a855f7, #7c3aed)',
            color: 'white',
            border: 'none',
          }}
        >
          <ImageIcon size={14} />
          {extractingCovers ? t('header.extracting') : t('header.covers')}
        </button>

        {/* Indexing progress banner */}
        {indexing && indexStatus && (
          <div className="header-enrich-status" style={{ background: 'rgba(20, 184, 166, 0.15)' }}>
            <Loader2 size={12} className="spin" />
            <span>
              🔍 {indexStatus.processed}/{indexStatus.total} — {indexStatus.indexed} ✓
            </span>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={handleCancelIndex} title={t('header.cancel')}>
              <X size={12} />
            </button>
          </div>
        )}

        {!indexing && indexStatus?.status === 'done' && indexStatus.indexed > 0 && (
          <div className="header-enrich-done" style={{ background: 'rgba(20, 184, 166, 0.15)' }}>
            <CheckCircle2 size={12} />
            <span>{t('header.indexedCount', { count: indexStatus.indexed })}</span>
            <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setIndexStatus(null)}>
              <X size={12} />
            </button>
          </div>
        )}

        <button
          className={`btn btn-sm ${indexing ? 'extracting' : ''}`}
          onClick={handleIndex}
          disabled={indexing || isScanning}
          style={{
            background: indexing ? 'var(--bg-surface)' : 'linear-gradient(135deg, #14b8a6, #0d9488)',
            color: 'white',
            border: 'none',
          }}
        >
          <FileSearch size={14} />
          {indexing ? t('header.indexing') : t('header.index')}
        </button>

        <button
          className={`btn btn-sm header-enrich-btn ${enriching ? 'enriching' : ''}`}
          onClick={handleEnrich}
          disabled={enriching || isScanning}
          style={{
            background: enriching ? 'var(--bg-surface)' : 'var(--gradient-accent)',
            color: 'white',
            border: 'none',
          }}
        >
          <Sparkles size={14} />
          {enriching ? t('header.enriching') : t('header.enrich')}
        </button>

        <button
          className={`btn btn-secondary btn-sm header-scan-btn ${isScanning ? 'scanning' : ''}`}
          onClick={onScan}
          disabled={isScanning}
        >
          <ScanLine size={14} />
          {isScanning ? t('header.scanning') : t('header.scan')}
        </button>
        </>)}
      </div>
    </header>
  );
}
