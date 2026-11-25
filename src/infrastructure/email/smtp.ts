/**
 * 最小 SMTP 客户端（零第三方依赖，Node 内置 net/tls）。
 *
 * 支持：隐式 TLS（465）、STARTTLS（587）、AUTH LOGIN / PLAIN、UTF-8 中文主题与正文。
 * 定位：发送验证码类纯文本邮件。群发、附件、HTML 模板等场景请换专业邮件服务。
 * 安全：TLS 校验证书（默认 rejectUnauthorized）；拒绝头注入；日志不含凭据。
 */
import net from "node:net";
import tls from "node:tls";
import { randomUUID } from "node:crypto";

export interface SmtpOptions {
  host: string;
  port: number;
  /** true=连接即 TLS（465）；false=明文连接，服务器支持时自动 STARTTLS 升级 */
  secure: boolean;
  user?: string;
  pass?: string;
  timeoutMs?: number;
}

export interface MailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
}

const DEFAULT_TIMEOUT_MS = 20_000;

/** 提取纯邮箱地址（兼容 "Name <a@b.c>" 写法）。 */
function plainAddress(addr: string): string {
  const m = addr.match(/<([^>]+)>/);
  return (m?.[1] ?? addr).trim();
}

function assertNoHeaderInjection(value: string, field: string): void {
  if (/[\r\n]/.test(value)) {
    throw new Error(`${field} 含非法换行符，拒绝发送`);
  }
}

interface Reply {
  code: number;
  lines: string[];
}

/** 基于命令-应答的 SMTP 会话。 */
class SmtpSession {
  private socket: net.Socket | tls.TLSSocket;
  private buffer = "";
  private replyWaiters: Array<{ resolve: (r: Reply) => void; reject: (e: Error) => void }> = [];
  private pendingLines: string[] = [];
  private readyReplies: Reply[] = [];
  private closed = false;
  private failure: Error | null = null;

  constructor(socket: net.Socket | tls.TLSSocket) {
    this.socket = socket;
    this.bind(socket);
  }

  private bind(socket: net.Socket | tls.TLSSocket): void {
    this.socket = socket;
    socket.on("data", (chunk: Buffer) => this.onData(chunk));
    socket.on("error", (e: Error) => this.fail(e));
    socket.on("close", () => {
      this.closed = true;
      this.fail(new Error("SMTP 连接已关闭"));
    });
  }

  private fail(e: Error): void {
    if (!this.failure) this.failure = e;
    while (this.replyWaiters.length) {
      this.replyWaiters.shift()!.reject(this.failure);
    }
  }

  private onData(chunk: Buffer): void {
    this.buffer += chunk.toString("utf8");
    let idx: number;
    while ((idx = this.buffer.indexOf("\r\n")) >= 0) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 2);
      this.pendingLines.push(line);
      // 多行应答：250-xxx 继续，250 xxx 结束
      if (/^\d{3} /.test(line) || !/^\d{3}-/.test(line)) {
        const reply: Reply = { code: parseInt(line.slice(0, 3), 10) || 0, lines: [...this.pendingLines] };
        this.pendingLines = [];
        const waiter = this.replyWaiters.shift();
        if (waiter) waiter.resolve(reply);
        else this.readyReplies.push(reply);
      }
    }
  }

  readReply(timeoutMs: number): Promise<Reply> {
    const ready = this.readyReplies.shift();
    if (ready) return Promise.resolve(ready);
    if (this.failure) return Promise.reject(this.failure);
    if (this.closed) return Promise.reject(new Error("SMTP 连接已关闭"));
    return new Promise<Reply>((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = this.replyWaiters.findIndex((w) => w.resolve === wrappedResolve);
        if (i >= 0) this.replyWaiters.splice(i, 1);
        reject(new Error("SMTP 应答超时"));
      }, timeoutMs);
      const wrappedResolve = (r: Reply) => {
        clearTimeout(timer);
        resolve(r);
      };
      this.replyWaiters.push({
        resolve: wrappedResolve,
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
    });
  }

  send(line: string): void {
    this.socket.write(line + "\r\n");
  }

  sendRaw(data: string): void {
    this.socket.write(data);
  }

  /** 升级为 TLS（STARTTLS）。 */
  upgradeTls(host: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const plain = this.socket;
      plain.removeAllListeners("data");
      plain.removeAllListeners("error");
      plain.removeAllListeners("close");
      const secure = tls.connect({ socket: plain, servername: host }, () => {
        this.buffer = "";
        this.pendingLines = [];
        this.bind(secure);
        resolve();
      });
      secure.once("error", reject);
    });
  }

  close(): void {
    this.socket.destroy();
  }
}

function connect(opts: SmtpOptions, timeoutMs: number): Promise<SmtpSession> {
  return new Promise((resolve, reject) => {
    const onError = (e: Error) => reject(new Error(`SMTP 连接失败：${e.message}`));
    const socket = opts.secure
      ? tls.connect({ host: opts.host, port: opts.port, servername: opts.host }, () => {
          socket.removeListener("error", onError);
          resolve(new SmtpSession(socket));
        })
      : net.connect({ host: opts.host, port: opts.port }, () => {
          socket.removeListener("error", onError);
          resolve(new SmtpSession(socket));
        });
    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      reject(new Error("SMTP 连接超时"));
    });
    socket.once("error", onError);
  });
}

async function expect(session: SmtpSession, timeoutMs: number, okCodes: number[], step: string): Promise<Reply> {
  const reply = await session.readReply(timeoutMs);
  if (!okCodes.includes(reply.code)) {
    // 只带服务器应答文本，不含任何凭据
    throw new Error(`SMTP ${step} 失败：${reply.lines.join(" | ")}`);
  }
  return reply;
}

function parseEhloCaps(reply: Reply): Set<string> {
  const caps = new Set<string>();
  for (const line of reply.lines.slice(1)) {
    caps.add(line.slice(4).trim().toUpperCase());
  }
  return caps;
}

function buildMessage(mail: MailMessage): string {
  const subjectB64 = Buffer.from(mail.subject, "utf8").toString("base64");
  const bodyB64 = Buffer.from(mail.text, "utf8").toString("base64");
  const bodyLines = bodyB64.match(/.{1,76}/g) ?? [];
  const headers = [
    `From: ${mail.from}`,
    `To: ${mail.to}`,
    `Subject: =?UTF-8?B?${subjectB64}?=`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomUUID()}@crowd-demand>`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
  ];
  return headers.join("\r\n") + "\r\n\r\n" + bodyLines.join("\r\n");
}

/** 发送一封纯文本邮件。失败抛错（错误信息不含密码）。 */
export async function smtpSendMail(opts: SmtpOptions, mail: MailMessage): Promise<void> {
  assertNoHeaderInjection(mail.from, "发件人");
  assertNoHeaderInjection(mail.to, "收件人");
  assertNoHeaderInjection(mail.subject, "主题");
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const session = await connect(opts, timeoutMs);
  try {
    await expect(session, timeoutMs, [220], "连接问候");
    session.send(`EHLO crowd-demand`);
    let caps = parseEhloCaps(await expect(session, timeoutMs, [250], "EHLO"));

    if (!opts.secure && caps.has("STARTTLS")) {
      session.send("STARTTLS");
      await expect(session, timeoutMs, [220], "STARTTLS");
      await session.upgradeTls(opts.host);
      session.send("EHLO crowd-demand");
      caps = parseEhloCaps(await expect(session, timeoutMs, [250], "EHLO(TLS)"));
    }

    if (opts.user && opts.pass) {
      const authLine = [...caps].find((c) => c.startsWith("AUTH "));
      if (!authLine) throw new Error("SMTP 服务器不支持 AUTH，无法登录");
      if (authLine.includes("LOGIN")) {
        session.send("AUTH LOGIN");
        await expect(session, timeoutMs, [334], "AUTH");
        session.send(Buffer.from(opts.user, "utf8").toString("base64"));
        await expect(session, timeoutMs, [334], "AUTH 用户名");
        session.send(Buffer.from(opts.pass, "utf8").toString("base64"));
        await expect(session, timeoutMs, [235], "AUTH 密码");
      } else if (authLine.includes("PLAIN")) {
        const token = Buffer.from(`\u0000${opts.user}\u0000${opts.pass}`, "utf8").toString("base64");
        session.send(`AUTH PLAIN ${token}`);
        await expect(session, timeoutMs, [235], "AUTH PLAIN");
      } else {
        throw new Error("SMTP 服务器不支持 LOGIN/PLAIN 认证方式");
      }
    }

    session.send(`MAIL FROM:<${plainAddress(mail.from)}>`);
    await expect(session, timeoutMs, [250], "MAIL FROM");
    session.send(`RCPT TO:<${plainAddress(mail.to)}>`);
    await expect(session, timeoutMs, [250, 251], "RCPT TO");
    session.send("DATA");
    await expect(session, timeoutMs, [354], "DATA");
    session.sendRaw(buildMessage(mail) + "\r\n.\r\n");
    await expect(session, timeoutMs, [250], "投递");
    session.send("QUIT");
    // QUIT 应答尽力读取，服务器直接断开也视为成功
    await session.readReply(timeoutMs).catch(() => undefined);
  } finally {
    session.close();
  }
}
