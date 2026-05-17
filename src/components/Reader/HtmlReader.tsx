import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import type { PageLayout } from './PdfReader';
import './Reader.css';

interface HtmlReaderProps {
  bookId: number;
  scale: number;
  nightMode: boolean;
  onPageChange?: (page: number) => void;
  onTotalPages?: (total: number) => void;
  currentPage?: number;
  pageLayout?: PageLayout;
}

const PAGE_WIDTH = 816;
const PAGE_HEIGHT = 1056;
const PAGE_PAD_X = 56;
const PAGE_PAD_Y = 48;

export default function HtmlReader({
  bookId, scale, nightMode, onPageChange, onTotalPages, currentPage = 1, pageLayout = 'single'
}: HtmlReaderProps) {
  const { t } = useTranslation();
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [totalPages, setTotalPages] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Fetch HTML ──
  useEffect(() => {
    let mounted = true;
    setHtml(null);
    setError(null);

    fetch(`${import.meta.env.DEV ? 'http://localhost:3001' : ''}/api/books/${bookId}/html`)
      .then(res => {
        if (!res.ok) throw new Error(t('reader.errorDoc'));
        return res.text();
      })
      .then(data => { if (mounted) setHtml(data); })
      .catch(err => { if (mounted) setError(err.message); });

    return () => { mounted = false; };
  }, [bookId]);

  // ── Measure total pages (off-screen, once) ──
  useEffect(() => {
    if (!html) return;

    const usableH = (PAGE_HEIGHT - PAGE_PAD_Y * 2) * scale;
    const usableW = (PAGE_WIDTH - PAGE_PAD_X * 2) * scale;

    const m = document.createElement('div');
    m.style.cssText = `
      position:absolute; visibility:hidden; pointer-events:none;
      width:${usableW}px; font-size:${15 * scale}px; line-height:1.75;
      font-family:'Georgia','Times New Roman',serif;
      word-spacing:0.05em; letter-spacing:0.01em;
    `;
    m.innerHTML = html;
    document.body.appendChild(m);

    // Wait for layout
    requestAnimationFrame(() => {
      const pages = Math.max(1, Math.ceil(m.scrollHeight / usableH));
      document.body.removeChild(m);
      setTotalPages(pages);
      if (onTotalPages) onTotalPages(pages);
    });
  }, [html, scale, onTotalPages]);

  // ── Scroll to page ──
  useEffect(() => {
    if (!containerRef.current || !totalPages) return;
    const pageH = PAGE_HEIGHT * scale;
    const gap = 24 * scale;
    containerRef.current.scrollTo({
      top: (currentPage - 1) * (pageH + gap),
      behavior: 'smooth',
    });
  }, [currentPage, scale, totalPages]);

  // ── Track scroll → update page ──
  const handleScroll = useCallback(() => {
    if (!containerRef.current || totalPages <= 1) return;
    const pageH = PAGE_HEIGHT * scale;
    const gap = 24 * scale;
    const page = Math.min(totalPages, Math.max(1,
      Math.floor(containerRef.current.scrollTop / (pageH + gap)) + 1
    ));
    if (onPageChange) onPageChange(page);
  }, [scale, totalPages, onPageChange]);

  // ── Error / Loading states ──
  if (error) {
    return (
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%', color:'#ef4444' }}>
        <p>{t('reader.errorPrefix', { error })}</p>
      </div>
    );
  }
  if (html === null) {
    return (
      <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%', color:'var(--text-secondary)' }}>
        <Loader2 className="spinner" size={24} style={{ marginRight:8 }} />
        <span>{t('reader.processing')}</span>
      </div>
    );
  }

  const pageH = PAGE_HEIGHT * scale;
  const usableH = (PAGE_HEIGHT - PAGE_PAD_Y * 2) * scale;
  const gap = 24 * scale;
  const isDouble = pageLayout === 'double';

  // ── Virtualize: only render pages near current view ──
  const BUFFER = 2; // render current ± 2
  const startPage = Math.max(0, currentPage - 1 - BUFFER);
  const endPage = Math.min(totalPages - 1, currentPage - 1 + BUFFER);

  const totalScrollH = totalPages * (pageH + gap) - gap + 48 * scale;

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      style={{
        height: '100%', overflowY: 'auto', width: '100%',
        background: nightMode ? '#0a0a0a' : '#e8e8e8',
        scrollBehavior: 'smooth',
        position: 'relative',
      }}
    >
      {/* Spacer to maintain scroll height */}
      <div style={{ height: totalScrollH, position: 'relative' }}>
        {/* Only render visible pages */}
        {Array.from({ length: endPage - startPage + 1 }, (_, i) => {
          const pageIdx = startPage + i;
          const top = 24 * scale + pageIdx * (pageH + gap);

          if (isDouble && pageIdx % 2 === 1) return null; // skip odd pages in double mode

          if (isDouble) {
            const leftIdx = pageIdx;
            const rightIdx = pageIdx + 1;
            return (
              <div key={pageIdx} style={{
                position: 'absolute', top, left: '50%',
                transform: 'translateX(-50%)',
                display: 'flex', gap: `${4 * scale}px`,
              }}>
                <Page html={html} pageIdx={leftIdx} pageH={pageH} usableH={usableH}
                  scale={scale} nightMode={nightMode} totalPages={totalPages} />
                {rightIdx < totalPages && (
                  <Page html={html} pageIdx={rightIdx} pageH={pageH} usableH={usableH}
                    scale={scale} nightMode={nightMode} totalPages={totalPages} />
                )}
              </div>
            );
          }

          return (
            <div key={pageIdx} style={{
              position: 'absolute', top, left: '50%',
              transform: 'translateX(-50%)',
            }}>
              <Page html={html} pageIdx={pageIdx} pageH={pageH} usableH={usableH}
                scale={scale} nightMode={nightMode} totalPages={totalPages} />
            </div>
          );
        })}
      </div>

      <style>{docStyles(nightMode)}</style>
    </div>
  );
}

// ── Single Page Component ──
function Page({ html, pageIdx, pageH, usableH, scale, nightMode, totalPages }: {
  html: string; pageIdx: number; pageH: number; usableH: number;
  scale: number; nightMode: boolean; totalPages: number;
}) {
  return (
    <div
      className="html-reader-page"
      style={{
        width: `${PAGE_WIDTH * scale}px`,
        maxWidth: '95vw',
        height: `${pageH}px`,
        overflow: 'hidden',
        padding: `${PAGE_PAD_Y * scale}px ${PAGE_PAD_X * scale}px`,
        fontSize: `${15 * scale}px`,
        backgroundColor: nightMode ? '#1a1a2e' : '#fff',
        color: nightMode ? '#e2e8f0' : '#1a202c',
        boxShadow: nightMode
          ? '0 4px 24px rgba(0,0,0,0.5)'
          : '0 4px 12px rgba(0,0,0,0.15), 0 1px 3px rgba(0,0,0,0.1)',
        borderRadius: '4px',
        fontFamily: "'Georgia','Times New Roman',serif",
        lineHeight: 1.75,
        wordSpacing: '0.05em',
        letterSpacing: '0.01em',
        position: 'relative',
        flexShrink: 0,
      }}
    >
      <div style={{
        position:'absolute', bottom:`${12*scale}px`, right:`${20*scale}px`,
        fontSize:`${11*scale}px`,
        color: nightMode ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.15)',
        fontFamily:'var(--font-ui, sans-serif)',
      }}>
        {pageIdx + 1} / {totalPages}
      </div>
      <div
        className="html-reader-container"
        style={{ marginTop: `-${pageIdx * usableH}px` }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

function docStyles(night: boolean): string {
  const h = night ? '#a5b4fc' : '#1e293b';
  const border = night ? '#334155' : '#e2e8f0';
  const accent = night ? '#667eea' : '#6366f1';
  const link = night ? '#818cf8' : '#4f46e5';
  return `
    .html-reader-container h1,.html-reader-container h2,.html-reader-container h3{margin-top:1.5em;margin-bottom:.5em;line-height:1.3;color:${h};page-break-after:avoid}
    .html-reader-container h1{font-size:1.8em;border-bottom:1px solid ${border};padding-bottom:.3em}
    .html-reader-container h2{font-size:1.4em}
    .html-reader-container h3{font-size:1.15em}
    .html-reader-container p{margin:0 0 1em 0;text-align:justify;text-indent:1.5em;orphans:3;widows:3}
    .html-reader-container p:first-child,.html-reader-container h1+p,.html-reader-container h2+p,.html-reader-container h3+p{text-indent:0}
    .html-reader-container ul,.html-reader-container ol{margin:.5em 0 1em 1.5em;padding-left:1em}
    .html-reader-container li{margin-bottom:.3em}
    .html-reader-container blockquote{margin:1em 0;padding:.8em 1.2em;border-left:3px solid ${accent};background:${night?'rgba(99,102,241,.08)':'rgba(99,102,241,.04)'};border-radius:0 4px 4px 0;font-style:italic}
    .html-reader-container img{max-width:100%;height:auto;border-radius:4px;margin:1em auto;display:block}
    .html-reader-container table{width:100%;border-collapse:collapse;margin:1em 0;font-size:.9em}
    .html-reader-container th,.html-reader-container td{border:1px solid ${border};padding:8px 12px;text-align:left}
    .html-reader-container th{background:${night?'rgba(99,102,241,.1)':'#f8fafc'};font-weight:600}
    .html-reader-container a{color:${link};text-decoration:underline}
    .html-reader-container hr{border:none;height:1px;background:${border};margin:2em 0}
    .html-reader-container>p:first-of-type::first-letter{font-size:3em;font-weight:700;float:left;line-height:.8;margin-right:.08em;margin-top:.05em;color:${link}}
    .html-reader-page{break-inside:avoid}
  `;
}
