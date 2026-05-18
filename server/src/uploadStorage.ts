/**
 * BiblioVault AI — Upload Storage Module
 * Phase 15: R2-backed uploads with visibility control
 * 
 * Flow: User uploads → Multer (memory) → R2 → DB (books + user_uploads)
 */

import multer from 'multer';
import { extname } from 'path';
import { tmpdir } from 'os';
import { createReadStream } from 'fs';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

// ── Configuration ──
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB per file

// Allowed file types
const ALLOWED_EXTENSIONS = ['.pdf', '.epub', '.doc', '.docx'];
const ALLOWED_MIMES = [
  'application/pdf',
  'application/epub+zip',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];

// Legacy: keep for backward compat but no longer used for storage
export const UPLOADS_DIR = '/tmp/uploads';

// ── R2 Client ──
function getR2Client(): S3Client | null {
  if (!process.env.R2_ENDPOINT || !process.env.R2_ACCESS_KEY_ID) return null;
  return new S3Client({
    region: 'auto',
    endpoint: process.env.R2_ENDPOINT,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID!,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
    },
  });
}

const R2_BUCKET = process.env.R2_BUCKET || 'bibliovault-books';

// ── Multer Configuration (memory storage for R2) ──

const fileFilter: multer.Options['fileFilter'] = (_req, file, cb) => {
  const ext = extname(file.originalname).toLowerCase();
  if (ALLOWED_EXTENSIONS.includes(ext) || ALLOWED_MIMES.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Formato no soportado. Formatos permitidos: ${ALLOWED_EXTENSIONS.join(', ')}`));
  }
};

export const upload = multer({
  storage: multer.diskStorage({
    destination: tmpdir(),
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, file.fieldname + '-' + uniqueSuffix + extname(file.originalname));
    }
  }),
  fileFilter,
  limits: { fileSize: MAX_FILE_SIZE },
});

// ── R2 Upload/Delete ──

export async function uploadFileToR2(
  filePath: string,
  r2Key: string,
  contentType: string
): Promise<boolean> {
  const s3 = getR2Client();
  if (!s3) {
    console.error('❌ R2 not configured — cannot upload user file');
    return false;
  }
  
  const fileStream = createReadStream(filePath);

  await s3.send(new PutObjectCommand({
    Bucket: R2_BUCKET,
    Key: r2Key,
    Body: fileStream,
    ContentType: contentType,
  }));
  
  console.log(`📤 Uploaded to R2: ${r2Key}`);
  return true;
}

export async function deleteFileFromR2(r2Key: string): Promise<boolean> {
  const s3 = getR2Client();
  if (!s3) return false;
  
  try {
    await s3.send(new DeleteObjectCommand({
      Bucket: R2_BUCKET,
      Key: r2Key,
    }));
    console.log(`🗑️ Deleted from R2: ${r2Key}`);
    return true;
  } catch (err) {
    console.error('R2 delete failed:', err);
    return false;
  }
}

// ── Utilities ──

export function getUploadLimit(plan: string): number {
  const limits: Record<string, number> = {
    free: 5,
    premium: 50,
    enterprise: 200,
  };
  return limits[plan] ?? limits.free;
}

// Legacy — no longer used since files go to R2
export function deleteUploadFile(_storagePath: string): boolean {
  return false;
}

export function getFileSize(_storagePath: string): number {
  return 0;
}

// MIME type mapping
export function getMimeType(ext: string): string {
  const map: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.epub': 'application/epub+zip',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
  return map[ext] || 'application/octet-stream';
}
