import { createReadStream } from "node:fs";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type { Readable } from "node:stream";
import { Inject, Injectable } from "@nestjs/common";
import { uuidv7 } from "uuidv7";
import { ENV, type Env } from "../config/env.js";

/** File types accepted for KYC and other documents (checked by magic bytes, not just the name). */
export const ALLOWED_TYPES = {
  "application/pdf": [0x25, 0x50, 0x44, 0x46], // %PDF
  "image/png": [0x89, 0x50, 0x4e, 0x47],
  "image/jpeg": [0xff, 0xd8, 0xff],
} as const;
export type AllowedContentType = keyof typeof ALLOWED_TYPES;

export function sniffContentType(bytes: Buffer): AllowedContentType | undefined {
  return (Object.keys(ALLOWED_TYPES) as AllowedContentType[]).find((type) =>
    ALLOWED_TYPES[type].every((b, i) => bytes[i] === b),
  );
}

/**
 * Object storage behind one interface (ADR-0023). Development uses the local filesystem under
 * STORAGE_DIR (gitignored); Stage 7 adds an S3 adapter with the same methods. Keys are
 * generated here — never derived from user-supplied file names.
 */
@Injectable()
export class StorageService {
  private readonly root: string;

  constructor(@Inject(ENV) env: Env) {
    this.root = resolve(env.STORAGE_DIR);
  }

  async put(prefix: string, bytes: Buffer, extension: string): Promise<string> {
    const key = `${prefix}/${uuidv7()}.${extension}`;
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes, { flag: "wx" });
    return key;
  }

  async open(key: string): Promise<{ stream: Readable; size: number }> {
    const path = this.pathFor(key);
    const info = await stat(path);
    return { stream: createReadStream(path), size: info.size };
  }

  async remove(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  /** Resolves a key inside the storage root; rejects anything that would escape it. */
  private pathFor(key: string): string {
    if (!/^[a-z0-9/_-]+\.[a-z0-9]+$/i.test(key)) throw new Error(`Invalid storage key ${key}`);
    const path = resolve(this.root, key);
    if (!path.startsWith(this.root + sep)) throw new Error(`Invalid storage key ${key}`);
    return path;
  }
}
