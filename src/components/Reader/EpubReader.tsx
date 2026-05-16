import { useState, useRef, useEffect } from 'react';
import { ReactReader, ReactReaderStyle } from 'react-reader';

interface EpubReaderProps {
  fileUrl: string;
  scale: number;
  nightMode: boolean;
  onLocationChanged?: (location: string) => void;
  initialLocation?: string;
  initialLocation?: string;
  currentPage?: number;
  onPageChange?: (page: number) => void;
  onTotalPages?: (total: number) => void;
  onTextExtracted?: (text: string) => void;
}

export default function EpubReader({ 
  fileUrl, 
  scale, 
  nightMode, 
  onLocationChanged, 
  initialLocation,
  currentPage,
  onPageChange,
  onTotalPages,
  onTextExtracted
}: EpubReaderProps) {
  const [location, setLocation] = useState<string | number>(initialLocation || 0);
  const [bookData, setBookData] = useState<ArrayBuffer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const renditionRef = useRef<any>(null);
  const locationsRef = useRef<any>(null);
  const tocRef = useRef<any[]>([]);

  // Prevent recursive loop if EpubReader triggers onPageChange which changes currentPage prop
  const internalPageRef = useRef<number>(1);

  useEffect(() => {
    let mounted = true;
    fetch(fileUrl, { credentials: 'include' })
      .then(res => {
        if (!res.ok) throw new Error('No se pudo cargar el archivo EPUB');
        return res.arrayBuffer();
      })
      .then(data => {
        if (mounted) setBookData(data);
      })
      .catch(err => {
        console.error('Error fetching EPUB:', err);
        if (mounted) setError(err.message);
      });
    return () => { mounted = false; };
  }, [fileUrl]);

  const locationChanged = (epubcifi: string) => {
    setLocation(epubcifi);
    if (onLocationChanged) onLocationChanged(epubcifi);
    
    // Extract text for TTS
    if (renditionRef.current && onTextExtracted) {
      try {
        const contents = renditionRef.current.getContents();
        if (contents && contents.length > 0) {
          const text = contents[0].document.body.innerText;
          onTextExtracted(text);
        }
      } catch (e) {
        console.error('Error extracting text for TTS:', e);
      }
    }

    if (renditionRef.current && locationsRef.current) {
      // Use locations mapping if available
      try {
        const page = locationsRef.current.locationFromCfi(epubcifi);
        if (page > 0) {
          internalPageRef.current = page;
          if (onPageChange) onPageChange(page);
        }
      } catch (e) {}
    } else if (renditionRef.current && renditionRef.current.location) {
      const loc = renditionRef.current.location;
      if (loc.start && loc.start.displayed && loc.start.displayed.page) {
        const page = loc.start.displayed.page;
        const total = loc.start.displayed.total;
        if (onPageChange) onPageChange(page);
        if (onTotalPages && total > 0) onTotalPages(total);
      } else if (loc.start && loc.start.percentage !== undefined) {
        // Fallback for percentage
        const perc = loc.start.percentage;
        const estimatedTotal = 500; // Fake total for percentage
        const estPage = Math.max(1, Math.round(perc * estimatedTotal));
        if (onPageChange) onPageChange(estPage);
        if (onTotalPages) onTotalPages(estimatedTotal);
      }
    }
  };

  useEffect(() => {
    if (currentPage && currentPage !== internalPageRef.current && locationsRef.current) {
      try {
        const cfi = locationsRef.current.cfiFromLocation(currentPage);
        if (cfi) {
          setLocation(cfi);
          internalPageRef.current = currentPage;
        }
      } catch (e) {
        console.error('Could not navigate to page', currentPage, e);
      }
    }
  }, [currentPage]);

  useEffect(() => {
    if (renditionRef.current) {
      try {
        renditionRef.current.themes.fontSize(`${Math.max(80, scale * 100)}%`);
        if (nightMode) {
          renditionRef.current.themes.select('night');
        } else {
          renditionRef.current.themes.select('light');
        }
      } catch (err) {
        console.error('Error applying EPUB theme/scale', err);
      }
    }
  }, [scale, nightMode]);

  const customStyle = {
    ...ReactReaderStyle,
    readerArea: {
      ...ReactReaderStyle.readerArea,
      backgroundColor: 'transparent',
    },
    tocArea: {
      ...ReactReaderStyle.tocArea,
      background: nightMode ? '#1e293b' : '#ffffff',
      color: nightMode ? '#f8fafc' : '#0f172a',
    },
    tocButtonExpanded: {
      ...ReactReaderStyle.tocButtonExpanded,
      background: nightMode ? '#334155' : '#f1f5f9',
    }
  };

  if (error) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#ef4444' }}>
        <p>Error: {error}</p>
      </div>
    );
  }

  if (!bookData) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-secondary)' }}>
        <div className="spinner" style={{ width: 24, height: 24, border: '2px solid currentColor', borderRightColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite', marginRight: 8 }} />
        <span>Cargando libro electrónico...</span>
      </div>
    );
  }

  return (
    <div style={{ height: '100%', width: '100%', position: 'relative' }}>
      <ReactReader
        url={bookData}
        location={location}
        locationChanged={locationChanged}
        readerStyles={customStyle}
        tocChanged={(toc) => { tocRef.current = toc; }}
        getRendition={(rendition) => {
          renditionRef.current = rendition;
          
          rendition.themes.register('night', {
            body: { background: 'transparent !important', color: '#f8fafc !important' },
            a: { color: '#a855f7 !important' },
            'h1, h2, h3, h4, h5, h6': { color: '#f8fafc !important' }
          });
          
          rendition.themes.register('light', {
            body: { background: 'transparent !important', color: '#0f172a !important' },
            a: { color: '#7c3aed !important' },
            'h1, h2, h3, h4, h5, h6': { color: '#0f172a !important' }
          });
          
          rendition.themes.fontSize(`${Math.max(80, scale * 100)}%`);
          rendition.themes.select(nightMode ? 'night' : 'light');

          // Generate locations for pagination
          rendition.book.ready.then(() => {
            return rendition.book.locations.generate(1600);
          }).then((locations: any) => {
            locationsRef.current = rendition.book.locations;
            if (onTotalPages) {
              onTotalPages(locationsRef.current.length());
            }
            // If there's an initial currentPage, jump to it
            if (currentPage && currentPage > 1) {
              try {
                const cfi = locationsRef.current.cfiFromLocation(currentPage);
                if (cfi) setLocation(cfi);
              } catch (e) {}
            }
          }).catch((err: any) => console.error("Error generating locations", err));

          // Add epubjs pagination if requested
          rendition.on('relocated', (loc: any) => {
             // You can capture additional info here
          });
        }}
      />
    </div>
  );
}
