import { Global, Module } from "@nestjs/common";
import { S3StorageProvider } from "./storage.service";
import { StorageProvider } from "./storage.provider";

@Global()
@Module({ providers: [S3StorageProvider, { provide: StorageProvider, useExisting: S3StorageProvider }], exports: [StorageProvider] })
export class StorageModule {}