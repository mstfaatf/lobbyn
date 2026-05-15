import {
  DeleteObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';

import { BUCKET_NAME, r2Client } from './r2.js';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

function contentTypeForExtension(fileExtension: string): string {
  const ext = fileExtension.replace(/^\./, '').toLowerCase();
  switch (ext) {
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    default:
      throw new Error(`Unsupported file extension: ${fileExtension}`);
  }
}

export async function generatePresignedUploadUrl(options: {
  orgId: string;
  buildingId: string;
  resourceType: 'post' | 'listing' | 'ticket' | 'avatar';
  fileExtension: string;
}): Promise<{
  uploadUrl: string;
  objectKey: string;
  publicUrl: string;
}> {
  const { orgId, buildingId, resourceType, fileExtension } = options;
  const ext = fileExtension.replace(/^\./, '').toLowerCase();
  const objectKey = `${orgId}/${buildingId}/${resourceType}/${randomUUID()}.${ext}`;
  const contentType = contentTypeForExtension(fileExtension);

  const command = new PutObjectCommand({
    Bucket: BUCKET_NAME,
    Key: objectKey,
    ContentType: contentType,
  });

  const uploadUrl = await getSignedUrl(r2Client, command, { expiresIn: 300 });

  const endpoint = process.env.CLOUDFLARE_R2_ENDPOINT;
  if (!endpoint) {
    throw new Error(
      'CLOUDFLARE_R2_ENDPOINT is not set. Define it in apps/api/.env (see .env.example).',
    );
  }

  const base = endpoint.replace(/\/+$/, '');
  const publicUrl = `${base}/${BUCKET_NAME}/${objectKey}`;

  return { uploadUrl, objectKey, publicUrl };
}

export async function deleteObject(objectKey: string): Promise<void> {
  try {
    await r2Client.send(
      new DeleteObjectCommand({
        Bucket: BUCKET_NAME,
        Key: objectKey,
      }),
    );
  } catch (err) {
    console.error('[media] deleteObject failed', { objectKey, err });
  }
}

export function validateImageFile(options: {
  mimeType: string;
  fileSizeBytes: number;
}): { valid: boolean; error?: string } {
  const { mimeType, fileSizeBytes } = options;

  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return { valid: false, error: 'File type not supported' };
  }

  if (fileSizeBytes > MAX_IMAGE_BYTES) {
    return { valid: false, error: 'File size exceeds 10MB limit' };
  }

  return { valid: true };
}

export function getObjectKey(publicUrl: string): string {
  const { pathname } = new URL(publicUrl);
  const prefix = `/${BUCKET_NAME}/`;
  if (!pathname.startsWith(prefix)) {
    return '';
  }
  return pathname.slice(prefix.length);
}
