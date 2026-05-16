import { useState, useRef, useEffect } from 'react';
import { ReactReader, ReactReaderStyle } from 'react-reader';

interface EpubReaderProps {
  fileUrl: string;
  scale: number;
  nightMode: boolean;
  onLocationChanged?: (location: string) => void;
  initialLocation?: string;
  onPageChange?: (page: number) => void;
  onTotalPages?: (total: number) => void;
}

export default function EpubReader({ 
  fileUrl, 
  scale, 
  nightMode, 
  onLocationChanged, 
  initialLocation,
  onPageChange,
  onTotalPages
}: EpubReaderProps) {
  const [location, setLocation] = useState<string | number>(initialLocation || 0);
  const renditionRef = useRef<any>(null);
  const tocRef = useRef<any[]>([]);

  const locationChanged = (epubcifi: string) => {
    setLocation(epubcifi);
    if (onLocationChanged) onLocationChanged(epubcifi);
    
    // Attempt to calculate a rough page number based on percentage if possible
    if (renditionRef.current && renditionRef.current.location) {
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

  return (
    <div style={{ height: '100%', width: '100%', position: 'relative' }}>
      <ReactReader
        url={fileUrl}
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

          // Add epubjs pagination if requested
          rendition.on('relocated', (loc: any) => {
             // You can capture additional info here
          });
        }}
      />
    </div>
  );
}
