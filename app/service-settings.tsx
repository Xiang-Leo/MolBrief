"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, Network, RefreshCw, ShieldCheck } from "lucide-react";
import type { ServiceFieldName, ServiceName, ServiceSettings } from "@/lib/service-config";

const services: { id: ServiceName; name: string; description: string; fields: { key: ServiceFieldName; label: string; secret?: boolean; placeholder?: string }[] }[] = [
  { id: "llm", name: "中文解读模型", description: "将已有材料整理为更完整的中文解读。", fields: [
    { key: "LLM_BASE_URL", label: "API 根地址", placeholder: "https://你的服务地址/v1" },
    { key: "LLM_MODEL", label: "模型名称", placeholder: "填写服务商提供的模型名称" },
    { key: "LLM_API_KEY", label: "模型 API 密钥", secret: true },
  ] },
  { id: "parallel", name: "Parallel 全网搜索", description: "检索公司公告、药物进展与公开资料。", fields: [
    { key: "PARALLEL_API_KEY", label: "Parallel API 密钥", secret: true },
  ] },
  { id: "tts", name: "MiniMax 云端配音", description: "指定音色；也可以继续使用设备朗读。", fields: [
    { key: "MINIMAX_API_KEY", label: "MiniMax API 密钥", secret: true },
    { key: "MINIMAX_VOICE_ID", label: "音色 ID" },
    { key: "MINIMAX_MODEL", label: "语音模型" },
  ] },
];
const statusText = { unconfigured: "待配置", configured: "已配置 · 待实测", verified: "调用已验证" };

export default function ServiceSettingsPanel({ onChanged, initialService }: { onChanged: () => void; initialService?: string | null }) {
  const [settings, setSettings] = useState<ServiceSettings | null>(null);
  const [values, setValues] = useState<Partial<Record<ServiceFieldName, string>>>({});
  const [clear, setClear] = useState<ServiceFieldName[]>([]);
  const [busy, setBusy] = useState<string | null>("load");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [active, setActive] = useState(initialService || "llm");
  useEffect(() => { if (initialService) setActive(initialService); }, [initialService]);
  async function load() {
    setBusy("load"); setError("");
    try {
      const r = await fetch("/api/settings", { cache: "no-store" });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "服务配置暂时无法读取。");
      setSettings(data);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  }
  useEffect(() => { void load(); }, []);
  async function submit(action: "save" | "verify", service?: ServiceName) {
    setBusy(service || action); setError(""); setMessage("");
    try {
      const r = await fetch("/api/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action === "save" ? { action, values, clear } : { action, service }) });
      const data = await r.json();
      if (data.fields) setSettings(data);
      if (!r.ok) throw new Error(data.error || "这次配置操作未完成。");
      if (action === "save") { setValues({}); setClear([]); setMessage("服务配置已保存并生效。接下来可以验证调用。"); }
      else setMessage(data.verification?.message || "服务调用已验证。");
      onChanged();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  }
  const dirty = Object.keys(values).length > 0 || clear.length > 0;
  return <section className="settings-panel service-settings" id="service-settings">
    <div className="panel-title"><Network size={19}/><h2>服务连接</h2></div>
    <p className="settings-intro">直接在这里填写并保存，手机和电脑都能管理。PubMed 论文搜索无需密钥。</p>
    {busy === "load" && <p role="status"><Loader2 size={16} className="spin"/>正在读取配置…</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {message && <p className="form-success" role="status"><Check size={15}/>{message}</p>}
    {!settings && !busy && <button className="secondary-btn" onClick={load}><RefreshCw size={15}/>重新读取</button>}
    {settings && <form onSubmit={e => { e.preventDefault(); void submit("save"); }} autoComplete="off">
      {services.map(s => <details className="service-editor" key={s.id} open={active === s.id} onToggle={e => { if (e.currentTarget.open) setActive(s.id); }}>
        <summary><strong>{s.name}</strong><span className={"service-badge " + settings.services[s.id].status}>{statusText[settings.services[s.id].status]}</span></summary>
        <p>{s.description}</p>
        {s.fields.map(f => <div className="service-field" key={f.key}>
          <label htmlFor={f.key}>{f.label}</label>
          <input id={f.key} name={f.key} type={f.secret ? "password" : "text"} autoComplete={f.secret ? "new-password" : "off"} spellCheck={false} maxLength={1024}
            value={values[f.key] ?? (f.secret ? "" : settings.fields[f.key].value || "")} disabled={!!busy || clear.includes(f.key)}
            placeholder={f.secret ? settings.fields[f.key].present ? "已保存，留空保留原密钥" : "填写你的 API 密钥" : f.placeholder}
            onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}/>
          {f.secret && settings.fields[f.key].present && <label className="clear-secret"><input type="checkbox" checked={clear.includes(f.key)} disabled={!!busy} onChange={e => { setClear(v => e.target.checked ? [...v, f.key] : v.filter(x => x !== f.key)); setValues(v => { const next = { ...v }; delete next[f.key]; return next; }); }}/>清除此密钥并停用服务</label>}
        </div>)}
        {settings.services[s.id].verificationSupported ? <><button type="button" className="secondary-btn" disabled={!!busy || dirty || settings.services[s.id].status === "unconfigured"} onClick={() => submit("verify", s.id)}>{busy === s.id ? <Loader2 size={15} className="spin"/> : <ShieldCheck size={15}/>}验证连接</button><p className="field-note">先保存更改再验证；验证会向该服务发起一次测试请求。</p></> : <p className="field-note">配音配置将在实际生成音频时验收，保存配置不代表声音已经验证。</p>}
        {settings.services[s.id].verifiedAt && <p className="field-note">上次验证：{new Date(settings.services[s.id].verifiedAt!).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</p>}
      </details>)}
      <button type="submit" className="primary-btn full" disabled={!!busy || !dirty}>{busy === "save" ? <Loader2 size={16} className="spin"/> : <Check size={16}/>}保存服务配置</button>
    </form>}
    <p className="settings-footnote"><ShieldCheck size={14}/>密钥加密保存在服务器，保存后不会回显。</p>
  </section>;
}
