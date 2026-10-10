import { DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { ObjectStore } from './types';

export function s3Store(bucket: string, client = new S3Client({ forcePathStyle: true })): ObjectStore {
  return {
    async put(key, body, contentType) {
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
    },
    async get(key) {
      try {
        const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        if (!out.Body) return null;
        return {
          body: out.Body.transformToWebStream() as ReadableStream<Uint8Array>,
          contentType: out.ContentType,
          size: out.ContentLength,
        };
      } catch (err) {
        const name = (err as { name?: string }).name;
        if (name === 'NoSuchKey' || name === 'NotFound') return null;
        throw err;
      }
    },
    async exists(key) {
      try {
        await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return true;
      } catch (err) {
        const name = (err as { name?: string }).name;
        if (name === 'NotFound' || name === 'NoSuchKey') return false;
        throw err;
      }
    },
    presign(method, key, { contentType, expiresIn }) {
      const command =
        method === 'PUT'
          ? new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType })
          : new GetObjectCommand({ Bucket: bucket, Key: key });
      return getSignedUrl(client, command, { expiresIn });
    },
    async remove(keys) {
      for (let i = 0; i < keys.length; i += 1000) {
        const chunk = keys.slice(i, i + 1000);
        if (!chunk.length) continue;
        await client.send(
          new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true } }),
        );
      }
    },
  };
}

export function memoryStore(): ObjectStore & { keys(): string[] } {
  const files = new Map<string, { bytes: Uint8Array; contentType: string }>();
  return {
    async put(key, body, contentType) {
      files.set(key, { bytes: new Uint8Array(body), contentType });
    },
    async get(key) {
      const file = files.get(key);
      if (!file) return null;
      return {
        body: file.bytes,
        contentType: file.contentType,
        size: file.bytes.byteLength,
      };
    },
    async remove(keys) {
      for (const key of keys) files.delete(key);
    },
    async exists(key) {
      return files.has(key);
    },
    keys: () => [...files.keys()],
  };
}
