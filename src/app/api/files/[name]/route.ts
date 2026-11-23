import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { EXT_MIME, FILE_NAME_RE, uploadDir } from "@/lib/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/files/[name] —— 读取已上传的附件（仅允许服务端生成的 UUID 文件名）。 */
export async function GET(_req: Request, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params;

  if (!FILE_NAME_RE.test(name)) {
    return NextResponse.json({ error: "文件不存在" }, { status: 404 });
  }

  const ext = path.extname(name).toLowerCase();
  const type = EXT_MIME[ext];
  if (!type) return NextResponse.json({ error: "文件不存在" }, { status: 404 });

  try {
    const buf = await readFile(path.join(uploadDir(), name));
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "content-type": type,
        "cache-control": "public, max-age=31536000, immutable",
        "content-disposition": `inline; filename="${name}"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "文件不存在" }, { status: 404 });
  }
}
