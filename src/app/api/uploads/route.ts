import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { toResponse } from "@/lib/api-response";
import { err, ok, DomainError } from "@/domain/shared/result";
import { MIME_EXT, UPLOAD_MAX_BYTES, uploadDir } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/uploads —— 需求附件上传（F04）。
 * 限制：登录用户；单文件 ≤ 5MB；仅 png/jpeg/webp/pdf；文件名由服务端生成。
 */
export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return toResponse(err("请先登录", DomainError.UNAUTHORIZED));

  let file: File | null = null;
  try {
    const form = await req.formData();
    const entry = form.get("file");
    if (entry instanceof File) file = entry;
  } catch {
    return toResponse(err("请求体格式不正确，需为 multipart/form-data", DomainError.VALIDATION));
  }

  if (!file) return toResponse(err("请选择要上传的文件", DomainError.VALIDATION));
  if (file.size <= 0) return toResponse(err("文件内容为空", DomainError.VALIDATION));
  if (file.size > UPLOAD_MAX_BYTES) {
    return toResponse(err("单个文件不得超过 5MB", DomainError.VALIDATION));
  }

  const ext = MIME_EXT[file.type];
  if (!ext) {
    return toResponse(err("仅支持 PNG / JPEG / WebP / PDF", DomainError.VALIDATION));
  }

  const name = `${randomUUID()}${ext}`;
  const dir = uploadDir();

  try {
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, name), Buffer.from(await file.arrayBuffer()));
  } catch {
    return toResponse(err("附件保存失败，请稍后重试", DomainError.SERVICE_UNAVAILABLE));
  }

  return toResponse(
    ok({
      url: `/api/files/${name}`,
      name: file.name.slice(0, 120),
      size: file.size,
      type: file.type,
    }),
  );
}
