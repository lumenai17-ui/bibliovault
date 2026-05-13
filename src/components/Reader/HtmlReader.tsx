import { useState, useEffect, useRef, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import './Reader.css';

interface HtmlReaderProps {
  bookId: number;
  scale: number;
  nightMode: boolean;
  onPageChange?: (page: number) => void;
  onTotalPages?: (total: number) => void;
  currentPage?: number;
}

const PAGE_HEIGHT = 1056; // A4 page height in pixels (at 96dpi)
const PAGE_WIDTH = 816;   // A4 page width in pixels (at 96dpi)

export default function HtmlReader({ bookId, scale, nightMode, onPageChange, onTotalPages, currentPage = 1 }: HtmlReaderProps) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [totalPages, setTotalPages] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let mounted = true;
    
    fetch(`${import.meta.env.DEV ? 'http://localhost:3001' : ''}/api/books/${bookId}/html`)
      .then(res => {
        if (!res.ok) throw new Error('No se pudo cargar el documento');
        return res.text();
      })
      .then(data => {
        if (mounted) setHtml(data);
      })
      .catch(err => {
        if (mounted) setError(err.message);
      });

    return () => { mounted = false; };
  }, [bookId]);

  // Calculate total pages based on content height
  const calculatePages = useCallback(() => {
    if (contentRef.current) {
      const contentHeight = contentRef.current.scrollHeight;
      const pageH = PAGE_HEIGHT * scale;
      const pages = Math.max(1, Math.ceil(contentHeight / pageH));
      setTotalPages(pages);
      if (onTotalPages) onTotalPages(pages);
    }
  }, [scale, onTotalPages]);

  useEffect(() => {
    if (html !== null) {
      // Wait for render
      const timer = setTimeout(calculatePages, 200);
      return () => clearTimeout(timer);
    }
  }, [html, scale, calculatePages]);

  // Scroll to current page
  useEffect(() => {
    if (containerRef.current && currentPage > 0) {
      const pageH = PAGE_HEIGHT * scale;
      const gap = 24 * scale;
      const scrollTo = (currentPage - 1) * (pageH + gap);
      containerRef.current.scrollTo({ top: scrollTo, behavior: 'smooth' });
    }
  }, [currentPage, scale]);

  // Track scroll position to update page number
  const handleScroll = useCallback(() => {
    if (containerRef.current && totalPages > 1) {
      const scrollTop = containerRef.current.scrollTop;
      const pageH = PAGE_HEIGHT * scale;
      const gap = 24 * scale;
      const page = Math.min(totalPages, Math.max(1, Math.floor(scrollTop / (pageH + gap)) + 1));
      if (onPageChange) onPageChange(page);
    }
  }, [scale, totalPages, onPageChange]);

  if (error) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#ef4444' }}>
        <p>Error: {error}</p>
      </div>
    );
  }

  if (html === null) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-secondary)' }}>
        <Loader2 className="spinner" size={24} style={{ marginRight: '8px' }} />
        <span>Procesando documento...</span>
      </div>
    );
  }

  // Split content into visual pages using CSS overflow
  const pageH = PAGE_HEIGHT * scale;

  return (
    <div 
      ref={containerRef}
      onScroll={handleScroll}
      style={{ 
        height: '100%', 
        overflowY: 'auto', 
        width: '100%',
        padding: '24px 0',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: `${24 * scale}px`,
        background: nightMode ? '#0a0a0a' : '#e8e8e8',
        scrollBehavior: 'smooth',
      }}
    >
      {/* Full document rendered with page-break simulation */}
      <div
        ref={contentRef}
        style={{
          width: `${PAGE_WIDTH * scale}px`,
          maxWidth: '95%',
          display: 'flex',
          flexDirection: 'column',
          gap: `${24 * scale}px`,
        }}
      >
        {/* Render as paginated pages */}
        {Array.from({ length: totalPages }, (_, i) => (
          <div
            key={i}
            className="html-reader-page"
            style={{
              width: '100%',
              height: `${pageH}px`,
              overflow: 'hidden',
              padding: `${48 * scale}px ${56 * scale}px`,
              fontSize: `${15 * scale}px`,
              backgroundColor: nightMode ? '#1a1a2e' : '#fff',
              color: nightMode ? '#e2e8f0' : '#1a202c',
              boxShadow: nightMode 
                ? '0 4px 24px rgba(0, 0, 0, 0.5)' 
                : '0 4px 12px rgba(0, 0, 0, 0.15), 0 1px 3px rgba(0, 0, 0, 0.1)',
              borderRadius: '4px',
              fontFamily: "'Georgia', 'Times New Roman', serif",
              lineHeight: 1.75,
              wordSpacing: '0.05em',
              letterSpacing: '0.01em',
              position: 'relative',
            }}
          >
            {/* Page number watermark */}
            <div style={{
              position: 'absolute',
              bottom: `${12 * scale}px`,
              right: `${20 * scale}px`,
              fontSize: `${11 * scale}px`,
              color: nightMode ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)',
              fontFamily: 'var(--font-ui, sans-serif)',
            }}>
              {i + 1} / {totalPages}
            </div>
            {/* Render HTML offset by page */}
            <div
              className="html-reader-container"
              style={{
                marginTop: `-${i * (pageH - 96 * scale)}px`,
              }}
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </div>
        ))}
      </div>

      {/* Page styling overrides for the HTML content */}
      <style>{`
        .html-reader-container h1,
        .html-reader-container h2,
        .html-reader-container h3 {
          margin-top: 1.5em;
          margin-bottom: 0.5em;
          line-height: 1.3;
          color: ${nightMode ? '#a5b4fc' : '#1e293b'};
          page-break-after: avoid;
        }

        .html-reader-container h1 {
          font-size: 1.8em;
          border-bottom: 1px solid ${nightMode ? '#334155' : '#e2e8f0'};
          padding-bottom: 0.3em;
        }

        .html-reader-container h2 {
          font-size: 1.4em;
        }

        .html-reader-container h3 {
          font-size: 1.15em;
        }

        .html-reader-container p {
          margin: 0 0 1em 0;
          text-align: justify;
          text-indent: 1.5em;
          orphans: 3;
          widows: 3;
        }

        .html-reader-container p:first-child,
        .html-reader-container h1 + p,
        .html-reader-container h2 + p,
        .html-reader-container h3 + p {
          text-indent: 0;
        }

        .html-reader-container ul,
        .html-reader-container ol {
          margin: 0.5em 0 1em 1.5em;
          padding-left: 1em;
        }

        .html-reader-container li {
          margin-bottom: 0.3em;
        }

        .html-reader-container blockquote {
          margin: 1em 0;
          padding: 0.8em 1.2em;
          border-left: 3px solid ${nightMode ? '#667eea' : '#6366f1'};
          background: ${nightMode ? 'rgba(99, 102, 241, 0.08)' : 'rgba(99, 102, 241, 0.04)'};
          border-radius: 0 4px 4px 0;
          font-style: italic;
        }

        .html-reader-container img {
          max-width: 100%;
          height: auto;
          border-radius: 4px;
          margin: 1em auto;
          display: block;
        }

        .html-reader-container table {
          width: 100%;
          border-collapse: collapse;
          margin: 1em 0;
          font-size: 0.9em;
        }

        .html-reader-container th,
        .html-reader-container td {
          border: 1px solid ${nightMode ? '#334155' : '#e2e8f0'};
          padding: 8px 12px;
          text-align: left;
        }

        .html-reader-container th {
          background: ${nightMode ? 'rgba(99, 102, 241, 0.1)' : '#f8fafc'};
          font-weight: 600;
        }

        .html-reader-container a {
          color: ${nightMode ? '#818cf8' : '#4f46e5'};
          text-decoration: underline;
        }

        .html-reader-container hr {
          border: none;
          height: 1px;
          background: ${nightMode ? '#334155' : '#e2e8f0'};
          margin: 2em 0;
        }

        .html-reader-container > p:first-of-type::first-letter {
          font-size: 3em;
          font-weight: 700;
          float: left;
          line-height: 0.8;
          margin-right: 0.08em;
          margin-top: 0.05em;
          color: ${nightMode ? '#818cf8' : '#4f46e5'};
        }

        .html-reader-page {
          break-inside: avoid;
        }
      `}</style>
    </div>
  );
}
