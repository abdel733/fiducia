import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Inject, Injectable } from "@nestjs/common";
import { APP_CONFIG, AppConfig } from "../config/config";
import { StorageProvider } from "./storage.provider";

@Injectable()
export class S3StorageProvider extends StorageProvider {
  private readonly client: S3Client;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    super();
    this.client = new S3Client({
      endpoint: config.S3_ENDPOINT,
      region: config.S3_REGION,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
      credentials: { accessKeyId: config.S3_ACCESS_KEY, secretAccessKey: config.S3_SECRET_KEY },
    });
  }

  async createUploadUrl(key: string, contentType: string, contentLength: number, sha256: string): Promise<string> {
    return getSignedUrl(this.client, new PutObjectCommand({
      Bucket: this.config.S3_BUCKET,
      Key: key,
      ContentType: contentType,
      ContentLength: contentLength,
      ChecksumSHA256: Buffer.from(sha256, "hex").toString("base64"),
    }), { expiresIn: 300 });
  }

  async uploadPrivate(key: string, encryptedBody: Buffer): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.config.S3_BUCKET, Key: key, Body: encryptedBody, ContentType: "application/octet-stream" }));
  }

  async uploadPublicAsset(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.config.S3_BUCKET, Key: key, Body: body, ContentType: contentType }));
  }

  async downloadPrivate(key: string): Promise<Buffer> {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.config.S3_BUCKET, Key: key }));
    if (!result.Body) throw new Error("Stored document is empty");
    return Buffer.from(await result.Body.transformToByteArray());
  }

  async verifyUpload(key: string, expected: { contentType: string; contentLength: number; sha256: string }): Promise<void> {
    const result = await this.client.send(new HeadObjectCommand({ Bucket: this.config.S3_BUCKET, Key: key, ChecksumMode: "ENABLED" }));
    const expectedChecksum = Buffer.from(expected.sha256, "hex").toString("base64");
    if (result.ContentType !== expected.contentType || result.ContentLength !== expected.contentLength || result.ChecksumSHA256 !== expectedChecksum) {
      throw new Error("Uploaded document does not match its signed metadata");
    }
  }

  async createDownloadUrl(key: string): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.config.S3_BUCKET, Key: key }), { expiresIn: 300 });
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.config.S3_BUCKET, Key: key }));
  }
}