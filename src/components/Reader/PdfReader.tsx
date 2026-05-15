import { useState, useCallback } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Configure the PDF.js worker — use local copy instead of CDN for reliability
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
pdfjs.GlobalWorkerOptions.workerSrc = pdfjsWorker;

export type PageLayout = 'single' | 'double';

interface PdfReaderProps {
  fileUrl: string;
  scale: number;
  currentPage: number;
  onPageChange: (page: number) => void;
  onTotalPages: (total: number) => void;
  nightMode: boolean;
  pageLayout: PageLayout;
}

export default function PdfReader({
  fileUrl,
  scale,
  currentPage,
  onPageChange,
  onTotalPages,
  nightMode,
  pageLayout,
}: PdfReaderProps) {
  const [totalPages, setTotalPages] = useState(0);
  const [isLoading, setIsLoading] = useState(true);

  const onDocumentLoadSuccess = useCallback(({ numPages }: { numPages: number }) => {
    setTotalPages(numPages);
    onTotalPages(numPages);
    setIsLoading(false);
  }, [onTotalPages]);

  const onDocumentLoadError = useCallback((error: Error) => {
    console.error('PDF load error:', error);
    setIsLoading(false);
  }, []);

  // Calculate which pages to show in double layout
  const showSecondPage = pageLayout === 'double' && currentPage + 1 <= totalPages;

  // Adjust scale for double page mode
  const effectiveScale = pageLayout === 'double' ? scale * 0.65 : scale;

  return (
    <div className={`pdf-viewer ${nightMode ? 'reader-night' : ''}`}>
      {isLoading && (
        <div className="reader-loading">
          <div className="reader-loading-spinner" />
          <span>Cargando documento...</span>
        </div>
      )}
      <Document
        file={fileUrl}
        onLoadSuccess={onDocumentLoadSuccess}
        onLoadError={onDocumentLoadError}
        loading={null}
      >
        <div className={`pdf-pages-container ${pageLayout === 'double' ? 'pdf-double' : 'pdf-single'}`}>
          <Page
            pageNumber={currentPage}
            scale={effectiveScale}
            renderTextLayer={true}
            renderAnnotationLayer={true}
            loading={
              <div className="reader-loading">
                <div className="reader-loading-spinner" />
              </div>
            }
          />
          {showSecondPage && (
            <Page
              pageNumber={currentPage + 1}
              scale={effectiveScale}
              renderTextLayer={true}
              renderAnnotationLayer={true}
              loading={
                <div className="reader-loading">
                  <div className="reader-loading-spinner" />
                </div>
              }
            />
          )}
        </div>
      </Document>
    </div>
  );
}
