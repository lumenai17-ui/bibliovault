/**
 * BiblioVault AI — Upload Storage Module
 * Phase 11.5: Local file storage with Supabase-ready architecture
 */

import multer from 'multer';
import { join, extname } from 'path';
import { existsSync, mkdirSync, unlinkSync, statSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Configuration ──
const UPLOADS_DIR = join(__dirname, '..', 'uploads');
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB per file

// Generous limits for now — adjust per plan when monetizing
const UPLOAD_LIMITS: Record<string, number> = {
  free: 50,
  premium: 200,
  enterprise: Infinity,
};

// Allowed file types
const ALLOWED_EXTENSIONS = ['.pdf', '.epub', '.doc', '.docx'];
const ALLOWED_MIMES = [
  'application/pdf',
  'application/epub+zip',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

// Ensure uploads directory exists
if (!existsSync(UPLOADS_DIR)) {
  mkdirSync(UPLOADS_DIR, { recursive: true });
}

export { UPLOADS_DIR, UPLOAD_LIMITS };

// ── Multer Configuration ──

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (_req, file, cb) => {
    const uniqueName = `${uuidv4()}${extname(file.originalname).toLowerCase()}`;
    cb(null, uniqueName);
  },
});

const fileFilter: multer.Options['fileFilter'] = (_req, file, cb) => {
  const ext = extname(file.originalname).toLowerCase();
  if (ALLOWED_EXTENSIONS.includes(ext) || ALLOWED_MIMES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Formato no soportado. Formatos permitidos: ${ALLOWED_EXTENSIONS.join(', ')}`));
  }
};

export const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE },
});

// ── Storage Utilities ──

export function getUploadLimit(plan: string): number {
  return UPLOAD_LIMITS[plan] ?? UPLOAD_LIMITS.free;
}

export function deleteUploadFile(storagePath: string): boolean {
  try {
    const fullPath = join(UPLOADS_DIR, storagePath);
    if (existsSync(fullPath)) {
      unlinkSync(fullPath);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function getFileSize(storagePath: string): number {
  try {
    const fullPath = join(UPLOADS_DIR, storagePath);
    if (existsSync(fullPath)) {
      return statSync(fullPath).size;
    }
    return 0;
  } catch {
    return 0;
  }
}
