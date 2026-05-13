import { useState, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import './Reader.css';

interface HtmlReaderProps {
  bookId: number;
  scale: number;
  nightMode: boolean;
}

export default function HtmlReader({ bookId, scale, nightMode }: HtmlReaderProps) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div style={{ height: '100%', overflowY: 'auto', width: '100%' }}>
      <div 
        className="html-reader-container" 
        style={{ 
          padding: '40px', 
          fontSize: `${16 * scale}px`,
          maxWidth: '800px',
          margin: '0 auto',
          backgroundColor: nightMode ? 'transparent' : '#fff',
          color: nightMode ? '#e2e8f0' : '#1a202c',
          boxShadow: nightMode ? 'none' : '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)',
          borderRadius: '8px',
          minHeight: '100%',
          fontFamily: 'Georgia, serif',
          lineHeight: 1.6
        }}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
