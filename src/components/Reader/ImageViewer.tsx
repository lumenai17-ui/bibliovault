interface ImageViewerProps {
  fileUrl: string;
  nightMode: boolean;
}

export default function ImageViewer({ fileUrl, nightMode }: ImageViewerProps) {
  return (
    <div className={`image-viewer ${nightMode ? 'reader-night' : ''}`}>
      <img src={fileUrl} alt="Book page" loading="lazy" />
    </div>
  );
}
