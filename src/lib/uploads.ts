import path from "node:path";

/**
 * 附件存储（F04 / F25 前置）—— MVP 落本地磁盘，通过受控路由读取。
 * 生产可换成对象存储：只需替换本文件的读写实现，业务层无感。
 */

export const UPLOAD_MAX_BYTES = 5 * 1024 * 1024;

export const MIME_EXT: Readonly<Record<string, string>> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "application/pdf": ".pdf",
};

export const EXT_MIME: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
};

/** 只接受服务端生成的 UUID 文件名，避免路径穿越。 */
export const FILE_NAME_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp|pdf)$/;

export function uploadDir(): string {
  const configured = process.env.UPLOAD_DIR?.trim();
  return configured || path.join(process.cwd(), "storage", "uploads");
}

export function isImagePath(url: string): boolean {
  return /\.(png|jpg|jpeg|webp)$/i.test(url);
}
