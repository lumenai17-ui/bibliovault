import { useState, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ZoomIn, ZoomOut, Maximize2, RotateCw, AlertCircle } from 'lucide-react';

interface ImageViewerProps {
  fileUrl: string;
  nightMode: boolean;
}

export default function ImageViewer({ fileUrl, nightMode }: ImageViewerProps) {
  const { t } = useTranslation();
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [naturalSize, setNaturalSize] = useState({ w: 0, h: 0 });
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleZoomIn = () => setZoom(z => Math.min(5, z + 0.25));
  const handleZoomOut = () => setZoom(z => Math.max(0.25, z - 0.25));
  const handleFit = () => setZoom(1);
  const handleRotate = () => setRotation(r => (r + 90) % 360);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setZoom(z => Math.min(5, Math.max(0.25, z + delta)));
  }, []);

  const handleLoad = () => {
    setLoaded(true);
    if (imgRef.current) {
      setNaturalSize({ w: imgRef.current.naturalWidth, h: imgRef.current.naturalHeight });
    }
  };

  if (error) {
    return (
      <div className={`image-viewer ${nightMode ? 'reader-night' : ''}`}>
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          height: '100%', gap: '16px', color: 'var(--text-muted)'
        }}>
          <AlertCircle size={48} style={{ opacity: 0.4 }} />
          <p style={{ fontSize: '16px' }}>{t('reader.errorImgTitle')}</p>
          <p style={{ fontSize: '13px', opacity: 0.6 }}>{t('reader.errorImgDesc')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`image-viewer ${nightMode ? 'reader-night' : ''}`} ref={containerRef} onWheel={handleWheel}>
      {/* Image controls */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 0',
        justifyContent: 'center', flexShrink: 0
      }}>
        <button className="btn btn-ghost btn-icon btn-sm" onClick={handleZoomOut} title={t('reader.zoomOut')}>
          <ZoomOut size={16} />
        </button>
        <span style={{ fontSize: '13px', color: 'var(--text-secondary)', minWidth: '50px', textAlign: 'center' }}>
          {Math.round(zoom * 100)}%
        </span>
        <button className="btn btn-ghost btn-icon btn-sm" onClick={handleZoomIn} title={t('reader.zoomIn')}>
          <ZoomIn size={16} />
        </button>
        <div style={{ width: '1px', height: '20px', background: 'var(--glass-border)', margin: '0 4px' }} />
        <button className="btn btn-ghost btn-icon btn-sm" onClick={handleFit} title={t('reader.fit')}>
          <Maximize2 size={16} />
        </button>
        <button className="btn btn-ghost btn-icon btn-sm" onClick={handleRotate} title={t('reader.rotate')}>
          <RotateCw size={16} />
        </button>
        {loaded && naturalSize.w > 0 && (
          <>
            <div style={{ width: '1px', height: '20px', background: 'var(--glass-border)', margin: '0 4px' }} />
            <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
              {naturalSize.w} × {naturalSize.h}px
            </span>
          </>
        )}
      </div>

      {/* Image display */}
      <div style={{
        flex: 1, overflow: 'auto', display: 'flex', alignItems: 'center',
        justifyContent: 'center', padding: '16px'
      }}>
        <img
          ref={imgRef}
          src={fileUrl}
          alt={t('reader.imgAlt')}
          loading="lazy"
          onLoad={handleLoad}
          onError={() => setError(true)}
          style={{
            maxWidth: loaded ? `${zoom * 100}%` : '90%',
            maxHeight: loaded ? `${zoom * 85}vh` : '80vh',
            objectFit: 'contain',
            transform: `rotate(${rotation}deg)`,
            transition: 'transform 0.3s ease',
            boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
            borderRadius: '4px',
          }}
        />
      </div>
    </div>
  );
}
