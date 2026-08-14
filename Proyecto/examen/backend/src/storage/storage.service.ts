import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../config/configuration';

/**
 * Thin wrapper around the S3 API. Deliberately a single implementation, not
 * "MinIO provider" vs "S3 provider" — MinIO speaks the S3 API, so the same
 * client works against both. Only STORAGE_* env vars change between local
 * dev (MinIO, docker/dev.sh) and prod (real AWS S3 on EC2).
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(private readonly config: ConfigService<AppConfig, true>) {
    const storage = this.config.get('storage', { infer: true });
    this.bucket = storage.bucket;

    this.client = new S3Client({
      region: storage.region,
      endpoint: storage.endpoint, // set for MinIO, undefined -> real AWS S3
      forcePathStyle: storage.forcePathStyle, // required by MinIO, ignored by AWS
      credentials: {
        accessKeyId: storage.accessKeyId,
        secretAccessKey: storage.secretAccessKey,
      },
    });
  }

  /** Builds a bucket key, e.g. "cards/<cardId>/<uuid>.jpg". Callers persist the key, not a URL. */
  buildKey(prefix: string, originalFilename: string): string {
    const ext = originalFilename.includes('.')
      ? originalFilename.split('.').pop()
      : 'bin';
    return `${prefix}/${randomUUID()}.${ext}`;
  }

  async upload(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
    this.logger.debug(
      `Uploaded ${key} (${contentType}, ${body.byteLength} bytes)`,
    );
  }

  /** Presigned PUT — lets the client (Ionic app) upload the photo directly, no binary through the API. */
  async getUploadUrl(
    key: string,
    contentType: string,
    expiresInSeconds = 300,
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
    });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }

  /** Presigned GET — works even if the bucket isn't publicly readable. */
  async getDownloadUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.client, command, { expiresIn: expiresInSeconds });
  }

  async delete(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }
}
