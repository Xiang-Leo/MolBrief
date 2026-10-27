# HANDOFF — 新开发会话入口

更新日期：2026-10-27。目标是让用户下载后，在自己的 Mac 或远程 Linux 服务器继续开发与部署。产品名为 **研览 · MolBrief**，副标题“你的制药与研究情报站”。

## 当前交付是什么

本目录是自部署版本：沿用原来的阅读界面与业务逻辑，使用标准 Next.js App Router、Node.js 24、SQLite、本地音频目录和独立单用户登录。原托管版使用 Vinext / Cloudflare Workers、D1 / R2 与 ChatGPT 登录，已另存源码快照。

原上线源码提交：`adb34029dd461809e7410f5b575dfdcadc972b45`。该提交只用于追溯原版，不是自部署改动的完成证明。自部署版实际通过和未通过的检查统一见 `VERIFICATION.md`；本轮服务器 P0 验收、源站证书和从 ECS 经公网域名的 HTTPS 检查已通过，用户确认手机可见登录页，Mac 当前访问异常及手机登录后体验仍待确认。

起始内容位于 `data/seed.json`。截至 2026-10-27，另已通过原站点的只读接口完整导出 6 张业务表：`articles` 为 8 条，其余 `reading_state`、`preferences`、`topics`、`audio_assets`、`runs` 均为空，没有截断。

`data/content-export.json` 保存完整文章数组与快照元数据；`data/hosted-database-export.json` 保存 6 表导出。此次没有私人收藏、关注或音频需要迁移；以后导入原账号状态时，需要把原 ChatGPT 用户 ID 明确映射为自部署账号 `owner`。导入命令见 `DEPLOYMENT.md`。此次没有配置真实第三方 API 密钥，也没有启用自动定时更新。

## 本轮部署进度

2026-10-27 已验证原始包全部校验项；本机 macOS 使用 Node.js 24.22.1 重新通过类型检查、13 项单测、生产构建和 21 项生产服务检查。官方 npm registry 的生产依赖审计为 0 条已知漏洞，本轮没有付费 API 调用。

ECS 连接方式位于本机 `/Users/xiangli/ecs-connection.sh`：`ssh -p 1111 xiangxiang@43.156.73.7`。服务目录为 `/home/xiangxiang/molbrief`；Ubuntu 24.04 x86_64，Docker 29.4、Compose 2.40.3。镜像 `molbrief:0.2.0` 已构建，`molbrief-app-1` healthy，使用 `molbrief_molbrief_data` 持久卷和 `127.0.0.1:3000`。真实容器的准备阶段 15 项、重启后 7 项检查通过，同一 Cookie、收藏、已读、语速与主题可保留；重复导入、令牌权限隔离和备份读回也通过，镜像中无 `.env`。测试结束已恢复为 8 篇文章、4 个默认主题、无收藏 / 已读并退出登录。

最终访问源已配置为 `https://todayai.xxlab.xyz`，账号 `admin`。密码在本机私有文件 `/Users/xiangli/.config/molbrief/todayai.xxlab.xyz-login.txt`，`.env` 的私有备份为同目录下的 `todayai.xxlab.xyz.env`，不要输出其内容。

宿主已有 Nginx，本轮只新增该域名站点与 HTTP ACME 路径，HTTPS 反代已生效；不要同时启动附带 Caddy，模板见 `deploy/nginx.conf.example`。用户已添加 Cloudflare 代理 A 记录 `todayai` → `43.156.73.7`，权威 DNS 和公网响应已验证。Let's Encrypt 证书已签发，到期 2027-01-25，续期 timer 已启用 / active，并有 Nginx 检查与 reload 的 deploy hook；续期 dry-run（跳过本次随机等待）及 deploy hook 均已通过。ECS 经真实公网域名的 10 项 HTTPS 检查全通过，用户确认手机可见登录页；手机登录后的收藏、声音与主屏幕入口仍待验收。Mac curl / 内嵌浏览器访问仍出现 `ERR_CONNECTION_CLOSED`，原因未确定。

干净备份 `molbrief-2026-10-27T06-18-24-620Z-2369d05b` 已从容器复制到宿主 `/home/xiangxiang/molbrief/backups/` 和 Mac `/Users/xiangli/.config/molbrief/backups/` 下的同名目录；Mac 使用 Node.js 24 读回确认 8 篇文章、4 个主题，无测试收藏 / 已读。连接、证书及备份位置详见 `DEPLOYMENT.md`。

公共仓库 [Xiang-Leo/MolBrief](https://github.com/Xiang-Leo/MolBrief) 首次推送与服务器 `/home/xiangxiang/molbrief` 的 Git 同步已完成。仓库根目录为原包 `self-hosted/`，不包含外层 reference 归档；`main` 跟踪 `origin/main`，首次同步后本机、GitHub、服务器 HEAD 一致且服务器 diff 为空。后续文档仍会继续提交，用 `git rev-parse HEAD` 核对最新版本；更新保留现有 `.env` 与数据卷。本轮未改业务逻辑，新增 Nginx 模板和忽略规则；首推前已检查 58 个暂存文件，不含真实环境值、密码、私钥或运行数据。

## 从哪里继续

| 需要处理的事 | 入口 |
| --- | --- |
| 初始化、部署、域名、备份 | `DEPLOYMENT.md` |
| 功能范围与当前状态 | `PRD.md` |
| 下一阶段与验收 | `ROADMAP.md` |
| 身份、数据流、表与 API | `ARCHITECTURE.md` |
| 已执行的验证与限制 | `VERIFICATION.md` |
| 页面与交互 | `app/molbrief.tsx`、`app/globals.css` |
| 内容处理与外部服务 | `lib/molbrief-server.ts` |
| 自部署身份与会话 | `lib/auth.ts`、`app/api/session/route.ts` |
| SQLite 与音频存储 | `lib/local-storage.ts`、`drizzle/` |
| API 请求分派 | `app/api/[...path]/route.ts` |

## 已知缺口与容易误解的地方

当前可阅读、分类、收藏、管理主题，并使用设备朗读；PubMed 搜索接口返回原始题录与摘要。Parallel、兼容模型接口和 MiniMax 配音有适配代码，仍需配置并验证真实调用。“已配置”只说明配置项存在。

推荐从预设相邻主题中，按关注与收藏匹配排序；主动探索得到结果后，才按偏好加入 14 天探索主题。它没有持续分析全部阅读历史，也没有自行无限扩展关键词。`explorationRatio` 暂为保留字段。

刷新按钮重新读取已保存内容，不会启动后台搜集。全文提取、定时任务、完整事件去重、Codex 执行网关、音色克隆管理、完整离线阅读与跨设备播放进度尚未实现。过期探索主题通过查询过滤，不代表后台清理任务已部署。

内容列表需继续保留较早的收藏；不要把数据库查询重新改成只返回最新 200 篇。新增来源时保持 URL 稳定 ID，未知日期不要补造。默认 VHH / 抗体主题可以由用户更改，不限制产品只服务这类研究。

## 建议交给下一次 Codex 的任务

> 阅读 AGENTS.md、HANDOFF.md、DEPLOYMENT.md 和 VERIFICATION.md，继续现有项目，保留服务器 .env、账号和持久卷。P0 已完成服务器验收及公网域名 HTTPS 检查，用户确认手机可见登录页，GitHub 与服务器 main 已完成首次同步。先核对最新 Git HEAD，跟进当前 Mac ERR_CONNECTION_CLOSED 并继续手机登录后的收藏、声音与主屏幕体验，不重复初始化或覆盖数据。随后按 ROADMAP.md 的 P1，接入用户提供的搜索服务与摘要模型，完成一条有来源、可收藏的中文信息整理流程，如实记录真实调用与尚未验证的能力。

如果没有服务器地址或必要访问，可先完成本地检查和部署包，不猜测 SSH 主机、账号或域名。尚未获得的 API 配置留空，不能使用示例值假装接通。
