/**
 * Cloudflare R2 Storage Client — Serves book files and covers from R2.
 * Used in production to replace the Cloudflare Tunnel approach.
 * R2 is S3-compatible, so we use the AWS S3 SDK.
 */

import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const R2_ENDPOINT = process.env.R2_ENDPOINT || '';
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || '';
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || '';
const R2_BUCKET = process.env.R2_BUCKET || 'bibliovault-books';

const isR2Configured = !!(R2_ENDPOINT && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY);

let s3: S3Client | null = null;

if (isR2Configured) {
  s3 = new S3Client({
    region: 'auto',
    endpoint: R2_ENDPOINT,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });
  console.log(`📦 R2 Storage: configured (bucket: ${R2_BUCKET})`);
} else {
  console.log('📦 R2 Storage: not configured (will use local/tunnel)');
}

/**
 * Get a readable stream for a file in R2.
 * Returns null if R2 is not configured or the file doesn't exist.
 */
export async function getR2Stream(key: string): Promise<{
  stream: ReadableStream | NodeJS.ReadableStream;
  contentType: string;
  contentLength: number;
} | null> {
  if (!s3 || !key) return null;

  try {
    const response = await s3.send(new GetObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
    }));

    if (!response.Body) return null;

    return {
      stream: response.Body as NodeJS.ReadableStream,
      contentType: response.ContentType || 'application/octet-stream',
      contentLength: response.ContentLength || 0,
    };
  } catch (err: any) {
    if (err.name === 'NoSuchKey' || err.$metadata?.httpStatusCode === 404) {
      return null;
    }
    console.error(`📦 R2 error for key ${key}:`, err.message);
    return null;
  }
}

/**
 * Get a presigned URL for direct browser access (expires in 1 hour).
 * Useful for covers and large files to avoid proxying through the server.
 */
export async function getR2Url(key: string, expiresIn = 3600): Promise<string | null> {
  if (!s3 || !key) return null;

  try {
    const url = await getSignedUrl(s3, new GetObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
    }), { expiresIn });

    return url;
  } catch (err: any) {
    console.error(`📦 R2 presign error for ${key}:`, err.message);
    return null;
  }
}

export { isR2Configured, R2_BUCKET };
