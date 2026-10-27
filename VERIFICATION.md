# VERIFICATION — 交付验证记录

验证日期：2026-10-27。版本：MolBrief 0.2.0 自部署版。本记录区分本轮实际部署与原始交付验证。服务器 P0、源站 TLS 与从 ECS 经公网域名的 HTTPS 检查已通过；Mac 当前访问异常、实际手机体验及第三方 API 尚待验证。

## 本轮本机与 ECS 验证

| 检查 | 实际结果 |
| --- | --- |
| 原始包完整性 | `FILES.sha256` 的所有条目校验通过；后续交接文档更新不属于原始校验快照 |
| 本机运行环境 | macOS，使用 `npm exec` 调用 Node.js 24.22.1 |
| 本机重新验证 | 依赖安装、TypeScript、13 项单元测试、生产构建、21 项实际生产服务检查全部通过 |
| 本机生产依赖审计 | 默认 npm 镜像不支持 audit；切换官方 registry 后，`npm audit --omit=dev` 返回 0 条已知漏洞 |
| ECS 环境 | Ubuntu 24.04 x86_64，Docker 29.4、Compose 2.40.3；已通过 SSH 连接 |
| 实际 Docker 部署 | `/home/xiangxiang/molbrief` 中已构建 `molbrief:0.2.0`；`molbrief-app-1` 为 healthy，容器 Node.js 24.22.1 |
| 持久目录与端口 | 使用具名卷 `molbrief_molbrief_data`，应用仅绑定服务器 `127.0.0.1:3000` |
| 反向代理 | 沿用宿主 Nginx，新增 `todayai.xxlab.xyz` 站点、HTTP ACME 路径及 HTTPS 反代；配置检查与 reload 成功 |
| 真实容器业务验收 | 准备阶段 15 项、重启后 7 项全部通过；同一 Cookie、收藏、已读、语速及主题经重启保留，随后恢复原状态并退出 |
| 导入与授权 | 内容连续导入两次仍为 8 篇；服务令牌不能读取 `/state` 或修改 `/reading`，可访问后台更新说明；镜像内无 `.env` |
| 备份演练 | 备份复制到空临时目录，通过 SQLite `integrity_check`，核对 8 篇文章、1 条测试收藏 / 已读、语速、5 个主题及迁移记录 |
| 干净状态与备份 | 测试数据已恢复：8 篇文章、4 个默认主题，无收藏 / 已读；干净备份已复制到宿主及 Mac，Mac 的 Node.js 24 SQLite 再次读回通过 |
| DNS / TLS | Cloudflare 已代理 A 记录，权威 DNS 与公网响应通过；Let's Encrypt webroot 证书已签发，到期 2027-01-25；续期 timer enabled / active，并配置 Nginx 检查及 reload 的 deploy hook |
| 公网 HTTPS | 从 ECS 通过真实域名执行 10 项检查全部通过，详见下文 |
| Mac 与手机 | Mac curl / 内嵌浏览器访问域名出现 `ERR_CONNECTION_CLOSED`，原因未确定；不能记作 Mac 浏览器通过，实际手机尚未测试 |
| Git 交接 | 用户提供公共仓库 `https://github.com/Xiang-Leo/MolBrief.git`；以 `self-hosted/` 为仓库根建立 `main`，首次推送及服务器 Git 同步进行中 |
| 外部服务调用 | 本轮 0 次付费 API 调用；Parallel、摘要模型、MiniMax 仍未接通验收 |

服务器连接、配置位置与私有凭据文件位置见 `DEPLOYMENT.md`。本轮未修改其他 Nginx 站点。实际手机声音与主屏幕入口仍需验证。

### 从 ECS 经公网 HTTPS 的 10 项检查

实际请求 `https://todayai.xxlab.xyz`，全部通过：健康状态；未登录首页跳转登录；未登录 feed 返回 401；密码登录及 Secure / HttpOnly / SameSite Cookie；8 篇文章且响应为 `private, no-store`、Cloudflare 非 HIT；干净的 owner 状态；同源写入；跨源写入返回 403；首页 CSS / PWA 静态资源；退出登录。这些是从服务器发起的公网请求，不等于本机或手机浏览器体验已经通过。

### 干净备份位置

备份目录名为 `molbrief-2026-10-27T06-18-24-620Z-2369d05b`，分别位于容器 `/app/var/backups/`、宿主 `/home/xiangxiang/molbrief/backups/` 和 Mac `/Users/xiangli/.config/molbrief/backups/` 下。Mac 的 Node.js 24 读回确认 8 篇文章、4 个主题，无测试收藏或已读。`.env` 的私有本机备份独立保存，不包含在数据备份中。

## 原始交付环境与版本

- 构建和运行环境：Linux，Node.js 24.22.1，npm 11.9.0。
- 最终生产依赖：Next.js 16.4.3、React / React DOM 19.2.6、Zod 4.6.7；精确依赖树见 `package-lock.json`。
- 原托管源码提交：`adb34029dd461809e7410f5b575dfdcadc972b45`。导出前后工作区保持干净，原站点未因本次导出而重新发布。
- 测试使用临时目录和随机账号、会话密钥、服务令牌，没有配置真实第三方 API 密钥。

## 原始交付已通过

| 检查 | 结果与范围 |
| --- | --- |
| TypeScript | `npm run typecheck` 通过；最终 Next.js 生产构建中的类型检查也通过 |
| 单元测试 | `npm test`：13 项通过，覆盖签名会话、密码校验、同源检查、服务授权、SQLite、迁移、事务、音频路径与备份 |
| 生产构建 | `npm run build` 通过，生成 `.next/standalone/server.js` 与所需页面 / API 产物 |
| 真实生产服务检查 | `npm run smoke`：21 项通过，实际启动 standalone 服务并发出 HTTP 请求，包含停止后重新启动 |
| 账号初始化 | 以临时目录交互运行初始化脚本；密码隐藏输入、重复校验、生成私有配置、已有配置拒绝覆盖 |
| 生产依赖审计 | 升级后 `npm audit --omit=dev --json` 返回 0 条已知漏洞；这是当时的生产依赖审计结果，不涵盖未来公告或整个部署环境 |
| 数据导出 | 原站点 6 张业务表完整读回，无截断：articles 8 条，其余 5 表为 0 条 |

### 21 项生产服务检查

1. 独立生产服务启动并完成 SQLite 迁移。
2. 未登录首页跳转到独立登录页。
3. 登录表单正常返回。
4. 伪造原托管身份头不能读取内容。
5. 错误密码被拒绝，正确密码生成 HttpOnly 会话 Cookie。
6. 所有者初始偏好与主题仅初始化一次，未配置的模型服务明确返回配置状态。
7. 8 篇起始材料可通过内容接口读回。
8. 收藏经 API 写入和读回。
9. 语速等偏好写入和读回。
10. 临时关注主题可以创建和删除。
11. 非法偏好参数被拒绝。
12. 跨源写入被拒绝。
13. 被篡改的会话 Cookie 被拒绝。
14. 未配置的付费搜索服务明确返回 501，不伪造成功结果。
15. 仅有浏览器会话不能调用后台导入；服务令牌可导入快照，按 URL 合并后仍为 8 篇。
16. 服务令牌不能冒充所有者读取个人状态或修改收藏。
17. 后台更新说明可使用服务授权读取。
18. 登录后的首页 HTML、CSS、PWA 清单与图标由 standalone 产物正常提供。
19. 停止并重启服务后，会话仍有效，收藏、偏好和主题状态保留。
20. 退出清除当前浏览器会话 Cookie。
21. 备份命令生成 SQLite 快照与清单，清单标明不包含秘密配置。

测试脚本在 `tests/production-smoke.mjs`；会创建并清理自己的临时数据，不调用付费 API。单元测试的备份检查也会读取备份库验证数据。

## 原始交付时尚未验证（历史记录）

以下保留首次交付的限制，后续本机和 ECS 结果以上方本轮记录为准。

- 当前环境没有 Docker 引擎，因此没有执行 `docker build` / `docker compose up`。Dockerfile、Compose 和运行时文件路径已检查；目标机器仍需实际构建启动。
- 未连接用户远程服务器，未核对其 CPU 架构、DNS、TLS、端口、镜像下载速度、备份介质或进程管理。
- 未配置或调用真实 Parallel、摘要模型与 MiniMax 服务；API 适配存在不等于已与具体账号接通。
- 本轮没有新增一次实时 PubMed 联网搜索验收；保留其既有适配代码。
- 本轮检查了页面与静态资源的 HTTP 输出，没有在用户实际手机上验证声音、后台播放、主屏幕安装或完整视觉交互。
- 原托管源码快照保持原版本，不包含自部署版的依赖升级与验证结论。

## 下一步验收

保留现有账号、`.env` 和持久卷。先核实 Mac / 实际手机访问路径及浏览器声音、主屏幕体验；服务器 P0 检查不需重新初始化。随后按 `ROADMAP.md` 的 P1，在获得用户 API 配置后，以少量真实材料验证搜索、中文解读、来源与收藏流程。第三方服务和后续定时更新仍不能记作已接通。
