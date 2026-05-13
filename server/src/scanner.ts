import { readdirSync, statSync } from 'fs';
import { join, extname, basename, relative } from 'path';
import { insertBook, getCategoryByName, bookExistsByPath, type BookRow } from './database.js';
import { extractPdfMeta } from './metadata.js';

// Supported formats
const BOOK_EXTENSIONS = new Set([
  '.pdf', '.epub', '.doc', '.docx',
]);
const IMAGE_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.tif', '.tiff', '.bmp',
]);
const AUDIO_EXTENSIONS = new Set([
  '.mp3', '.wma', '.m4a', '.ogg', '.flac',
]);
const SKIP_EXTENSIONS = new Set([
  '.zip', '.rar', '.xlsx', '.xls', '.ppt', '.pptx', '.mp4', '.avi', '.txt', '.rtf',
]);

export interface ScanProgress {
  status: 'scanning' | 'extracting' | 'done' | 'error';
  total: number;
  processed: number;
  currentFile: string;
  newBooks: number;
  skipped: number;
  errors: string[];
}

type ProgressCallback = (progress: ScanProgress) => void;

/** Parse title from filename: "Author - Title.pdf" or just "Title.pdf" */
function parseFilename(filename: string): { title: string; author: string } {
  const name = filename.replace(/\.[^/.]+$/, ''); // remove extension
  // Clean common patterns
  const cleaned = name
    .replace(/\(z-lib\.org\)/gi, '')
    .replace(/\( ?PDFDrive\.com ?\)/gi, '')
    .replace(/\( ?PDFDrive ?\)/gi, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Try "Author - Title" pattern
  const dashSplit = cleaned.split(' - ');
  if (dashSplit.length >= 2) {
    return { title: dashSplit.slice(1).join(' - ').trim(), author: dashSplit[0].trim() };
  }

  // Try "Title by Author" pattern
  const byMatch = cleaned.match(/^(.+?)\s+by\s+(.+)$/i);
  if (byMatch) {
    return { title: byMatch[1].trim(), author: byMatch[2].trim() };
  }

  return { title: cleaned, author: '' };
}

/** Determine the format based on extension */
function getFormat(ext: string): BookRow['format'] {
  if (ext === '.epub') return 'epub';
  if (ext === '.pdf') return 'pdf';
  if (ext === '.doc' || ext === '.docx') return 'doc';
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  return 'pdf';
}

/** Find the category folder name relative to the library root */
function findFolderCategory(filePath: string, libraryRoot: string): string {
  const rel = relative(libraryRoot, filePath);
  const parts = rel.split(/[\\/]/);

  // If inside "2.000 Libros/CATEGORY/...", use the category folder
  if (parts[0] === '2.000 Libros' && parts.length >= 3) {
    return parts[1]; // e.g., "CIENCIA", "FILOSOFÍA"
  }
  // If inside "India/...", use "INDIA"
  if (parts[0] === 'India') return 'INDIA';

  // Root-level files
  return 'Sin categoría';
}

/** Recursively collect all scannable files */
function collectFiles(dir: string): string[] {
  const files: string[] = [];

  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      try {
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
          files.push(...collectFiles(fullPath));
        } else if (stat.isFile()) {
          const ext = extname(entry).toLowerCase();
          if (BOOK_EXTENSIONS.has(ext) || IMAGE_EXTENSIONS.has(ext)) {
            files.push(fullPath);
          }
          // Skip audio/video/zip for now — can add support later
        }
      } catch {
        // Permission or access error — skip
      }
    }
  } catch {
    // Directory read error — skip
  }

  return files;
}

/** Group image files by folder — 3+ images in same folder = one scanned book */
function groupImageBooks(files: string[]): {
  bookFiles: string[];     // Non-image or single-image files → treated individually
  imageGroups: Map<string, string[]>;  // folder → array of image files (groups of 3+)
} {
  const imagesByFolder = new Map<string, string[]>();
  const bookFiles: string[] = [];

  for (const filePath of files) {
    const ext = extname(filePath).toLowerCase();
    if (IMAGE_EXTENSIONS.has(ext)) {
      const folder = join(filePath, '..');
      if (!imagesByFolder.has(folder)) imagesByFolder.set(folder, []);
      imagesByFolder.get(folder)!.push(filePath);
    } else {
      bookFiles.push(filePath);
    }
  }

  const imageGroups = new Map<string, string[]>();
  for (const [folder, images] of imagesByFolder) {
    if (images.length >= 3) {
      // 3+ images in same folder = scanned book
      // Sort by name for page order
      images.sort((a, b) => basename(a).localeCompare(basename(b), undefined, { numeric: true }));
      imageGroups.set(folder, images);
    } else {
      // 1-2 images = individual files
      bookFiles.push(...images);
    }
  }

  return { bookFiles, imageGroups };
}

/** Run the full library scan */
export async function scanLibrary(
  libraryPath: string,
  onProgress?: ProgressCallback,
): Promise<ScanProgress> {
  const progress: ScanProgress = {
    status: 'scanning',
    total: 0,
    processed: 0,
    currentFile: '',
    newBooks: 0,
    skipped: 0,
    errors: [],
  };

  onProgress?.(progress);

  // Phase 1: Collect all files
  const allFiles = collectFiles(libraryPath);
  const { bookFiles, imageGroups } = groupImageBooks(allFiles);
  progress.total = bookFiles.length + imageGroups.size;
  onProgress?.(progress);

  // Phase 2: Process regular book files (PDF, EPUB, single images)
  progress.status = 'extracting';
  for (const filePath of bookFiles) {
    const fileName = basename(filePath);
    progress.currentFile = fileName;
    progress.processed++;

    try {
      // Skip if already indexed
      if (bookExistsByPath(filePath)) {
        progress.skipped++;
        if (progress.processed % 50 === 0) onProgress?.(progress);
        continue;
      }

      const ext = extname(fileName).toLowerCase();
      const format = getFormat(ext);
      const { title, author } = parseFilename(fileName);
      const folderCategory = findFolderCategory(filePath, libraryPath);
      const categoryRow = getCategoryByName(folderCategory);

      let stat;
      try { stat = statSync(filePath); } catch { continue; }

      // Determine content type
      let contentType = 'text';
      if (IMAGE_EXTENSIONS.has(ext)) {
        contentType = 'image';
      }

      const bookData: Omit<BookRow, 'id' | 'date_added'> = {
        title,
        author,
        description: '',
        isbn: '',
        language: '',
        pages: 0,
        format,
        content_type: contentType,
        file_path: filePath,
        file_name: fileName,
        file_size: stat.size,
        cover_path: '',
        category_id: categoryRow?.id || null,
        subcategory: '',
        tags: '[]',
        last_read: null,
        reading_progress: 0,
        favorite: 0,
        ocr_status: contentType === 'image' ? 'pending' : 'none',
        ai_summary: null,
        folder_category: folderCategory,
      };

      insertBook(bookData);
      progress.newBooks++;

      if (progress.processed % 20 === 0) {
        onProgress?.(progress);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      progress.errors.push(`${fileName}: ${msg}`);
    }
  }

  // Phase 3: Process image groups (scanned books — multiple images = one book)
  for (const [folder, images] of imageGroups) {
    const folderName = basename(folder);
    progress.currentFile = `📖 ${folderName} (${images.length} imágenes)`;
    progress.processed++;

    try {
      // Use the first image's path as the book's file_path
      const firstImage = images[0];
      if (bookExistsByPath(firstImage)) {
        progress.skipped++;
        continue;
      }

      const { title, author } = parseFilename(folderName);
      const folderCategory = findFolderCategory(firstImage, libraryPath);
      const categoryRow = getCategoryByName(folderCategory);

      // Total size of all images
      let totalSize = 0;
      for (const img of images) {
        try { totalSize += statSync(img).size; } catch { /* skip */ }
      }

      const bookData: Omit<BookRow, 'id' | 'date_added'> = {
        title: title || folderName,
        author,
        description: `Libro escaneado: ${images.length} páginas en imágenes`,
        isbn: '',
        language: '',
        pages: images.length,
        format: 'image',
        content_type: 'image',
        file_path: firstImage,        // First image = entry point
        file_name: folderName,         // Folder name as book name
        file_size: totalSize,
        cover_path: firstImage,        // First image = cover
        category_id: categoryRow?.id || null,
        subcategory: '',
        tags: JSON.stringify(images.map(i => basename(i))),  // Store all image filenames
        last_read: null,
        reading_progress: 0,
        favorite: 0,
        ocr_status: 'pending',
        ai_summary: null,
        folder_category: folderCategory,
      };

      insertBook(bookData);
      progress.newBooks++;
      console.log(`📖 Grouped ${images.length} images → "${title || folderName}"`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      progress.errors.push(`${folderName}: ${msg}`);
    }

    if (progress.processed % 10 === 0) {
      onProgress?.(progress);
    }
  }

  progress.status = 'done';
  progress.currentFile = '';
  onProgress?.(progress);

  return progress;
}
