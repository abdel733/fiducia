export abstract class StorageProvider {
  abstract createUploadUrl(key: string, contentType: string, contentLength: number, sha256: string): Promise<string>;
  abstract createDownloadUrl(key: string): Promise<string>;
  abstract verifyUpload(key: string, expected: { contentType: string; contentLength: number; sha256: string }): Promise<void>;
  abstract uploadPrivate(key: string, encryptedBody: Buffer): Promise<void>;
  abstract uploadPublicAsset(key: string, body: Buffer, contentType: string): Promise<void>;
  abstract downloadPrivate(key: string): Promise<Buffer>;
  abstract delete(key: string): Promise<void>;
}