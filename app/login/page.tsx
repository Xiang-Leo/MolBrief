import { redirect } from "next/navigation";
import { getCurrentUser, isAuthConfigured } from "@/lib/auth";
import styles from "./login.module.css";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await getCurrentUser()) redirect("/");
  const configured = isAuthConfigured();
  const error = (await searchParams).error;
  const message = error === "credentials" ? "账号或密码不正确，请重新输入。" : error === "cooldown" ? "尝试次数较多，请在 10 分钟后重试。" : "";
  return <main className={styles.page}>
    <section className={styles.card}>
      <div className={styles.brand}><img src="/favicon.svg" width="46" height="46" alt=""/><div><strong>研览 <span>MolBrief</span></strong><p>你的制药与研究情报站</p></div></div>
      <h1>继续你的阅读空间。</h1>
      <p className={styles.intro}>登录后查看新进展，收藏有价值的材料，也发现下一条线索。</p>
      {!configured ? <div className={styles.notice} role="status"><strong>请先完成站点初始化</strong><p>在部署这份代码的服务器中运行：</p><code>node scripts/setup.mjs</code><p>完成后启动或重新启动网站，再使用设置好的账号登录。</p></div> : <>
        {message && <p role="alert" className={styles.error}>{message}</p>}
        <form method="post" action="/api/session" className={styles.form}>
          <label>账号<input name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={80} placeholder="输入你的账号"/></label>
          <label>密码<input name="password" type="password" autoComplete="current-password" required maxLength={512} placeholder="输入部署时设置的密码"/></label>
          <button type="submit">登录研览 <span aria-hidden="true">→</span></button>
        </form>
        <p className={styles.hint}>此账号属于你部署的研览网站，与 ChatGPT 账号独立。</p>
      </>}
      <footer>读懂进展，发现下一条线索。</footer>
    </section>
  </main>;
}
