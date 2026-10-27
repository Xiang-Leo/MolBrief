#!/usr/bin/env node
import { randomBytes, scryptSync } from "node:crypto";
import { access, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";

const target = resolve(process.cwd(), ".env");
try {
  await access(target);
  console.error(".env 已存在。为保留现有配置，本脚本不会覆盖。需要修改时请先备份并编辑现有文件。");
  process.exit(1);
} catch (error) { if (error?.code !== "ENOENT") throw error; }

if (!process.stdin.isTTY || !process.stdout.isTTY) {
  console.error("请在交互终端运行 node scripts/setup.mjs，脚本会隐藏密码输入。");
  process.exit(1);
}

async function ask(prompt) {
  const input = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await input.question(prompt)).trim(); } finally { input.close(); }
}

function secret(prompt) {
  return new Promise((resolveSecret, reject) => {
    const wasRaw = process.stdin.isRaw;
    let value = "";
    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.setEncoding("utf8");
    process.stdin.resume();
    const finish = (error) => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(wasRaw);
      process.stdin.pause();
      process.stdout.write("\n");
      if (error) reject(error); else resolveSecret(value);
    };
    const onData = (data) => {
      for (const character of data) {
        if (character === "\u0003" || character === "\u0004") { finish(new Error("初始化已取消。")); return; }
        if (character === "\r" || character === "\n") { finish(); return; }
        if (character === "\u007f" || character === "\b") { value = [...value].slice(0, -1).join(""); continue; }
        if (character >= " " && value.length < 512) value += character;
      }
    };
    process.stdin.on("data", onData);
  });
}

try {
  console.log("研览 · MolBrief 自部署初始化\n配置只写入当前目录的 .env；不会上传密码或服务密钥。");
  let appOrigin;
  while (!appOrigin) {
    const input = await ask("网站地址 [http://localhost:3000]：") || "http://localhost:3000";
    try {
      const url = new URL(input);
      if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error();
      appOrigin = url.origin;
    } catch { console.log("请输入完整的 http:// 或 https:// 地址，不附带路径或账号信息。"); }
  }
  let username;
  while (!username) {
    const value = await ask("登录账号（3–80 位字母、数字或 . _ @ -）：");
    if (/^[A-Za-z0-9._@-]{3,80}$/.test(value)) username = value;
    else console.log("账号格式不符合要求，请重新输入。");
  }
  let password;
  while (!password) {
    const value = await secret("登录密码（至少 12 位，输入不回显）：");
    if (value.length < 12 || value.length > 512) { console.log("请设置 12–512 位密码。"); continue; }
    const confirm = await secret("再次输入密码：");
    if (confirm !== value) { console.log("两次输入不同，请重新设置。"); continue; }
    password = value;
  }
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const lines = [
    "# MolBrief private server configuration. Do not commit this file.",
    `APP_ORIGIN=${appOrigin}`, `ADMIN_USERNAME=${username}`,
    `ADMIN_PASSWORD_HASH=scrypt:${salt.toString("hex")}:${key.toString("hex")}`,
    `SESSION_SECRET=${randomBytes(32).toString("hex")}`,
    `INGEST_API_TOKEN=${randomBytes(32).toString("hex")}`,
    "DATA_DIR=./var", "PORT=3000", "",
    "# Optional services; keep their API keys on the server.",
    "PARALLEL_API_KEY=", "LLM_BASE_URL=", "LLM_API_KEY=", "LLM_MODEL=",
    "MINIMAX_API_KEY=", "MINIMAX_VOICE_ID=", "MINIMAX_MODEL=speech-2.8-turbo", "",
  ];
  await writeFile(target, lines.join("\n"), { encoding: "utf8", mode: 0o600, flag: "wx" });
  console.log("初始化完成。.env 已创建，权限为仅当前用户读写。密码仅保存为 scrypt 哈希。请按 DEPLOYMENT.md 启动网站。");
} catch (error) {
  console.error(error?.code === "EEXIST" ? ".env 已存在，未覆盖任何配置。" : error instanceof Error ? error.message : "初始化未完成。");
  process.exitCode = 1;
}
