import { describe, it, expect, afterEach } from "vitest";
import net from "node:net";
import { createHmac } from "node:crypto";
import { smtpSendMail } from "@/infrastructure/email/smtp";
import {
  aliyunPercentEncode,
  signAliyunRpc,
  buildAliyunSendSmsUrl,
  aliyunConfigFromEnv,
  type AliyunSmsConfig,
} from "@/infrastructure/sms/aliyun";
import { buildTencentSendSmsRequest, type TencentSmsConfig } from "@/infrastructure/sms/tencent";
import { createSmsGateway, MockSmsGateway } from "@/infrastructure/sms/gateway";
import { createEmailGateway, MockEmailGateway } from "@/infrastructure/email/gateway";

/** 本地假 SMTP 服务器：走完真实 socket 会话，捕获投递内容。 */
function fakeSmtpServer(opts: { failAuth?: boolean } = {}) {
  const messages: Array<{ rcpt: string; data: string }> = [];
  const auth: { user: string; pass: string } = { user: "", pass: "" };
  const server = net.createServer((sock) => {
    let buf = "";
    let inData = false;
    let current = "";
    let rcpt = "";
    let authStep = 0;
    sock.write("220 fake ESMTP ready\r\n");
    sock.on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      let idx: number;
      while ((idx = buf.indexOf("\r\n")) >= 0) {
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        if (inData) {
          if (line === ".") {
            inData = false;
            messages.push({ rcpt, data: current });
            current = "";
            sock.write("250 OK queued\r\n");
          } else {
            current += line + "\n";
          }
          continue;
        }
        const upper = line.toUpperCase();
        if (upper.startsWith("EHLO")) {
          sock.write("250-fake greets you\r\n250 AUTH LOGIN PLAIN\r\n");
        } else if (upper === "AUTH LOGIN") {
          authStep = 1;
          sock.write("334 VXNlcm5hbWU6\r\n");
        } else if (authStep === 1) {
          auth.user = Buffer.from(line, "base64").toString("utf8");
          authStep = 2;
          sock.write("334 UGFzc3dvcmQ6\r\n");
        } else if (authStep === 2) {
          auth.pass = Buffer.from(line, "base64").toString("utf8");
          authStep = 0;
          sock.write(opts.failAuth ? "535 auth failed\r\n" : "235 auth ok\r\n");
        } else if (upper.startsWith("MAIL FROM")) {
          sock.write("250 ok\r\n");
        } else if (upper.startsWith("RCPT TO")) {
          rcpt = line;
          sock.write("250 ok\r\n");
        } else if (upper === "DATA") {
          inData = true;
          sock.write("354 end with .\r\n");
        } else if (upper === "QUIT") {
          sock.write("221 bye\r\n");
          sock.end();
        } else {
          sock.write("250 ok\r\n");
        }
      }
    });
    sock.on("error", () => undefined);
  });
  return new Promise<{
    port: number;
    messages: typeof messages;
    auth: typeof auth;
    close: () => Promise<void>;
  }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address() as net.AddressInfo;
      resolve({
        port: address.port,
        messages,
        auth,
        close: () =>
          new Promise<void>((r) => {
            server.close(() => r());
          }),
      });
    });
  });
}

describe("SMTP 客户端（真实 socket 会话）", () => {
  let cleanup: (() => Promise<void>) | null = null;
  afterEach(async () => {
    if (cleanup) await cleanup();
    cleanup = null;
  });

  it("完整会话：AUTH LOGIN + 投递，正文含验证码、主题可解码", async () => {
    const srv = await fakeSmtpServer();
    cleanup = srv.close;
    await smtpSendMail(
      { host: "127.0.0.1", port: srv.port, secure: false, user: "bot@qq.com", pass: "authcode", timeoutMs: 5000 },
      { from: "bot@qq.com", to: "user@example.com", subject: "【需求平台】登录验证码", text: "验证码为 123456，5 分钟内有效。" },
    );
    expect(srv.auth.user).toBe("bot@qq.com");
    expect(srv.auth.pass).toBe("authcode");
    expect(srv.messages).toHaveLength(1);
    expect(srv.messages[0]!.rcpt).toBe("RCPT TO:<user@example.com>");

    const raw = srv.messages[0]!.data;
    const subjectMatch = raw.match(/Subject: =\?UTF-8\?B\?(.+)\?=/);
    expect(subjectMatch).not.toBeNull();
    expect(Buffer.from(subjectMatch![1]!, "base64").toString("utf8")).toBe("【需求平台】登录验证码");

    const bodyB64 = raw.split("\n\n")[1]!.replace(/\n/g, "");
    expect(Buffer.from(bodyB64, "base64").toString("utf8")).toContain("123456");
  });

  it("认证失败抛出明确错误", async () => {
    const srv = await fakeSmtpServer({ failAuth: true });
    cleanup = srv.close;
    await expect(
      smtpSendMail(
        { host: "127.0.0.1", port: srv.port, secure: false, user: "u", pass: "wrong", timeoutMs: 5000 },
        { from: "a@b.c", to: "d@e.f", subject: "s", text: "t" },
      ),
    ).rejects.toThrow(/535/);
  });

  it("拒绝头注入（收件人/主题含换行）", async () => {
    await expect(
      smtpSendMail(
        { host: "127.0.0.1", port: 1, secure: false },
        { from: "a@b.c", to: "d@e.f\r\nBCC: evil@x.y", subject: "s", text: "t" },
      ),
    ).rejects.toThrow(/非法换行/);
    await expect(
      smtpSendMail(
        { host: "127.0.0.1", port: 1, secure: false },
        { from: "a@b.c", to: "d@e.f", subject: "s\nBCC: evil@x.y", text: "t" },
      ),
    ).rejects.toThrow(/非法换行/);
  });

  it("连接不上时抛出连接错误", async () => {
    await expect(
      smtpSendMail(
        { host: "127.0.0.1", port: 1, secure: false, timeoutMs: 2000 },
        { from: "a@b.c", to: "d@e.f", subject: "s", text: "t" },
      ),
    ).rejects.toThrow(/SMTP/);
  });
});

describe("阿里云短信签名（RPC V1）", () => {
  // 官方文档签名示例的规范化查询串（锚定向量，防止 percentEncode/排序实现漂移）
  const DOC_PARAMS: Record<string, string> = {
    AccessKeyId: "testid",
    Action: "DescribeRegions",
    Format: "XML",
    SignatureMethod: "HMAC-SHA1",
    SignatureNonce: "3ee8c1b8-83d3-44af-a94f-4e0ad82fd6cf",
    SignatureVersion: "1.0",
    Timestamp: "2016-02-23T12:46:24Z",
    Version: "2014-05-26",
  };
  // 官方文档签名示例的规范化查询串（值已做一次 percentEncode，键值对用原始 = 与 & 连接）
  const DOC_CANONICAL =
    "AccessKeyId=testid&Action=DescribeRegions&Format=XML&SignatureMethod=HMAC-SHA1&SignatureNonce=3ee8c1b8-83d3-44af-a94f-4e0ad82fd6cf&SignatureVersion=1.0&Timestamp=2016-02-23T12%3A46%3A24Z&Version=2014-05-26";

  it("percentEncode 遵循 RFC3986（空格/+/*/~/冒号）", () => {
    expect(aliyunPercentEncode("a b")).toBe("a%20b");
    expect(aliyunPercentEncode("a+b")).toBe("a%2Bb");
    expect(aliyunPercentEncode("*")).toBe("%2A");
    expect(aliyunPercentEncode("~")).toBe("~");
    expect(aliyunPercentEncode("12:46:24")).toBe("12%3A46%3A24");
  });

  it("规范化查询串与官方文档示例一致", () => {
    const canonical = Object.keys(DOC_PARAMS)
      .sort()
      .map((k) => `${aliyunPercentEncode(k)}=${aliyunPercentEncode(DOC_PARAMS[k]!)}`)
      .join("&");
    expect(canonical).toBe(DOC_CANONICAL);
  });

  it("签名 = base64(HMAC-SHA1(secret&, GET&%2F&encode(canonical)))", () => {
    const stringToSign = `GET&%2F&${aliyunPercentEncode(DOC_CANONICAL)}`;
    const expected = createHmac("sha1", "testsecret&").update(stringToSign).digest("base64");
    expect(signAliyunRpc(DOC_PARAMS, "testsecret")).toBe(expected);
  });

  it("SendSms URL 含全部必要参数且时间戳无毫秒", () => {
    const cfg: AliyunSmsConfig = {
      accessKeyId: "ak",
      accessKeySecret: "sk",
      signName: "需求平台",
      templateCode: "SMS_123456",
      templateParam: "code",
    };
    const url = buildAliyunSendSmsUrl(cfg, "13800138000", "654321", new Date("2026-11-23T10:00:00.123Z"), "fixed-nonce");
    expect(url.startsWith("https://dysmsapi.aliyuncs.com/?Signature=")).toBe(true);
    expect(url).toContain("PhoneNumbers=13800138000");
    expect(url).toContain("TemplateCode=SMS_123456");
    expect(url).toContain("SignatureNonce=fixed-nonce");
    expect(url).toContain("Timestamp=2026-11-23T10%3A00%3A00Z");
    expect(url).toContain(aliyunPercentEncode('{"code":"654321"}'));
    expect(url).toContain(aliyunPercentEncode("需求平台"));
  });
});

describe("腾讯云短信签名（TC3-HMAC-SHA256）", () => {
  const cfg: TencentSmsConfig = {
    secretId: "AKIDexample",
    secretKey: "secretexample",
    sdkAppId: "1400000000",
    signName: "需求平台",
    templateId: "1234567",
    region: "ap-guangzhou",
  };

  it("请求体与头部结构正确", () => {
    const req = buildTencentSendSmsRequest(cfg, "13800138000", "654321", 1551113065);
    expect(req.url).toBe("https://sms.tencentcloudapi.com");
    expect(req.headers["x-tc-action"]).toBe("SendSms");
    expect(req.headers["x-tc-version"]).toBe("2021-01-11");
    expect(req.headers["x-tc-timestamp"]).toBe("1551113065");
    const body = JSON.parse(req.body);
    expect(body.PhoneNumberSet).toEqual(["+8613800138000"]);
    expect(body.TemplateParamSet).toEqual(["654321"]);
    expect(body.SmsSdkAppId).toBe("1400000000");
  });

  it("Authorization 含正确 credential scope 与 64 位 hex 签名", () => {
    const req = buildTencentSendSmsRequest(cfg, "13800138000", "654321", 1551113065);
    const auth = req.headers.authorization!;
    expect(auth).toContain("TC3-HMAC-SHA256 Credential=AKIDexample/2019-02-25/sms/tc3_request");
    expect(auth).toContain("SignedHeaders=content-type;host");
    expect(auth).toMatch(/Signature=[0-9a-f]{64}$/);
  });

  it("签名确定性：同输入同签名，改密钥/时间戳签名变化", () => {
    const a = buildTencentSendSmsRequest(cfg, "13800138000", "654321", 1551113065).headers.authorization;
    const b = buildTencentSendSmsRequest(cfg, "13800138000", "654321", 1551113065).headers.authorization;
    const c = buildTencentSendSmsRequest({ ...cfg, secretKey: "other" }, "13800138000", "654321", 1551113065).headers.authorization;
    const d = buildTencentSendSmsRequest(cfg, "13800138000", "654321", 1551113066).headers.authorization;
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).not.toBe(d);
  });
});

describe("适配器工厂与配置校验", () => {
  it("默认仍为 Mock（不改变现有演示行为）", () => {
    expect(createSmsGateway("mock")).toBeInstanceOf(MockSmsGateway);
    expect(createEmailGateway("mock")).toBeInstanceOf(MockEmailGateway);
  });

  it("缺少配置时给出明确的缺失清单", () => {
    expect(() => aliyunConfigFromEnv()).toThrow(/ALIYUN_SMS_ACCESS_KEY_ID/);
    expect(() => createSmsGateway("aliyun")).toThrow(/缺少配置/);
    expect(() => createSmsGateway("tencent")).toThrow(/TENCENT_SMS_SECRET_ID/);
    expect(() => createEmailGateway("smtp")).toThrow(/SMTP_HOST/);
  });

  it("未知适配器直接报错", () => {
    expect(() => createSmsGateway("unknown")).toThrow(/未实现/);
    expect(() => createEmailGateway("unknown")).toThrow(/未实现/);
  });
});
