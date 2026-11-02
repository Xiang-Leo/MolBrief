# HANDOFF — 新开发会话入口

更新日期：2026-11-03。研览 · MolBrief 的本轮关键词、深度阅读、知识库与网页配置已部署到 ECS；保留现有账号、`.env` 和持久卷，继续工作前先读 `VERIFICATION.md`。

## 本轮交付与验收

- 关键词：`/topics` 可添加、编辑英文检索式、仅保存或添加并检索；中文输入法回车防误提交，表单与阅读弹窗显示结果及“已关注”。
- 检索：已定位 NCBI 对 ECS 出口的限制重定向；当前使用明确标注的官方 Europe PMC MED 题录备用，保留真实 PubMed 链接，尊重 Retry-After。部署后的实际 `nanobody` 查询和 VHH Title/Abstract 查询均返回 8 条记录。
- 深读：首批 8 篇摘要逐一核对原始来源并扩至约 300–380 字，配六类深读、37 条来源事实。模型请求支持 4000 tokens 的结构化扩展，但实际付费模型仍未配置 / 调用，不能据测试宣称已经接通。
- 知识库：`/knowledge` 首批覆盖 2 药物、2 靶点、3 合作、6 公司，共 13 专题，支持别名、来源、日期口径、时间线及手工补资料。它反映已收录材料，不是全网完整资产库，也未启用无人值守采集。
- 积累保护：完整资料集合不会被 200 条截断；收藏旧搜索结果不覆盖已编辑资料；同 URL 导入、补充与摘要回写保留数据库既有证据。同批重复 URL 累计合并，已知发表日不因补充留空而清除；名称 / 别名变化后旧专题链接仍可打开。
- 网页配置：`/settings` 可保存并立即生效，密钥由 `SESSION_SECRET` 派生的 AES-GCM 加密存入 SQLite且不回显。页面区分未配置、已配置和实际调用已验证，显式付费测试仅由用户点击。

本机 Node.js 24 下 55 项单测、生产构建和 34 项 standalone HTTP 检查通过，包括 205 篇历史资料、旧收藏与同批导入保留证据、旧别名深链、重启及两种备份清单。360 / 390 px 隔离浏览器完成关键词保存 / 编辑、扩展阅读、关注反馈、模型跳转关闭遮挡弹窗与手工补录；截图位于 `outputs/`，不是实际手机声音验收。

ECS 已构建运行并应用 `0001_service_settings.sql`。公网 HTTPS 的 8 项准备检查通过，包含既有个人状态与升级前备份逐条比对、中文关键词增改去重、8 篇深读、13 专题、中文 BD 深链、配置权限及真实文献查询。重启后会话和检索式保留，临时验收词及 Cookie 文件已清理。最终源版本用本机 / GitHub / ECS 的 `git rev-parse HEAD` 核对，不重跑账号初始化。

数据库备份 v2 可能包含加密 API 凭据，恢复必须同时保留原 `.env` / `SESSION_SECRET`；更换会话密钥不能解密旧配置。升级与恢复分开进行，详见 `DEPLOYMENT.md`。

## 当前交付是什么

本目录是自部署版本：沿用原来的阅读界面与业务逻辑，使用标准 Next.js App Router、Node.js 24、SQLite、本地音频目录和独立单用户登录。原托管版使用 Vinext / Cloudflare Workers、D1 / R2 与 ChatGPT 登录，已另存源码快照。

原上线源码提交：`adb34029dd461809e7410f5b575dfdcadc972b45`。该提交只用于追溯原版，不是自部署改动的完成证明。自部署版实际通过和未通过的检查统一见 `VERIFICATION.md`；2026-10-27 的基础 P0、证书和公网域名检查已通过，用户确认手机可见登录页；当时记录的 Mac 访问异常与手机登录后体验不构成本轮新增功能的验收结果。

起始内容位于 `data/seed.json`。截至 2026-10-27，另已通过原站点的只读接口完整导出 6 张业务表：`articles` 为 8 条，其余 `reading_state`、`preferences`、`topics`、`audio_assets`、`runs` 均为空，没有截断。

`data/content-export.json` 保存完整文章数组与快照元数据；`data/hosted-database-export.json` 保存 6 表导出。此次没有私人收藏、关注或音频需要迁移；以后导入原账号状态时，需要把原 ChatGPT 用户 ID 明确映射为自部署账号 `owner`。导入命令见 `DEPLOYMENT.md`。此次没有配置真实第三方 API 密钥，也没有启用自动定时更新。

## 2026-10-27 基础部署记录（历史）

2026-10-27 已验证原始包全部校验项；本机 macOS 使用 Node.js 24.22.1 重新通过类型检查、13 项单测、生产构建和 21 项生产服务检查。官方 npm registry 的生产依赖审计为 0 条已知漏洞，该次没有付费 API 调用。

ECS 连接方式位于本机 `/Users/xiangli/ecs-connection.sh`：`ssh -p 1111 xiangxiang@43.156.73.7`。服务目录为 `/home/xiangxiang/molbrief`；Ubuntu 24.04 x86_64，Docker 29.4、Compose 2.40.3。镜像 `molbrief:0.2.0` 已构建，`molbrief-app-1` healthy，使用 `molbrief_molbrief_data` 持久卷和 `127.0.0.1:3000`。真实容器的准备阶段 15 项、重启后 7 项检查通过，同一 Cookie、收藏、已读、语速与主题可保留；重复导入、令牌权限隔离和备份读回也通过，镜像中无 `.env`。测试结束已恢复为 8 篇文章、4 个默认主题、无收藏 / 已读并退出登录。

最终访问源已配置为 `https://todayai.xxlab.xyz`，账号 `admin`。密码在本机私有文件 `/Users/xiangli/.config/molbrief/todayai.xxlab.xyz-login.txt`，`.env` 的私有备份为同目录下的 `todayai.xxlab.xyz.env`，不要输出其内容。

宿主已有 Nginx，该次只新增该域名站点与 HTTP ACME 路径，HTTPS 反代已生效；不要同时启动附带 Caddy，模板见 `deploy/nginx.conf.example`。用户已添加 Cloudflare 代理 A 记录 `todayai` → `43.156.73.7`，权威 DNS 和公网响应已验证。Let's Encrypt 证书已签发，到期 2027-01-25，续期 timer 已启用 / active，并有 Nginx 检查与 reload 的 deploy hook；续期 dry-run（跳过本次随机等待）及 deploy hook 均已通过。ECS 经真实公网域名的 10 项 HTTPS 检查全通过，用户确认手机可见登录页；手机登录后的收藏、声音与主屏幕入口仍待验收。Mac curl / 内嵌浏览器访问仍出现 `ERR_CONNECTION_CLOSED`，原因未确定。

干净备份 `molbrief-2026-10-27T06-18-24-620Z-2369d05b` 已从容器复制到宿主 `/home/xiangxiang/molbrief/backups/` 和 Mac `/Users/xiangli/.config/molbrief/backups/` 下的同名目录；Mac 使用 Node.js 24 读回确认 8 篇文章、4 个主题，无测试收藏 / 已读。连接、证书及备份位置详见 `DEPLOYMENT.md`。

公共仓库 [Xiang-Leo/MolBrief](https://github.com/Xiang-Leo/MolBrief) 首次推送与服务器 `/home/xiangxiang/molbrief` 的 Git 同步已完成。仓库根目录为原包 `self-hosted/`，不包含外层 reference 归档；`main` 跟踪 `origin/main`，首次同步后本机、GitHub、服务器 HEAD 一致且服务器 diff 为空。后续文档仍会继续提交，用 `git rev-parse HEAD` 核对最新版本；更新保留现有 `.env` 与数据卷。该次未改业务逻辑，新增 Nginx 模板和忽略规则；首推前已检查 58 个暂存文件，不含真实环境值、密码、私钥或运行数据。

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
| 深读与来源字段校验 | `lib/editorial-schema.ts`、`data/editorial-enrichment.json` |
| 药物 / 靶点 / BD 领域汇总 | `lib/knowledge-types.ts`、`lib/knowledge-core.ts`、`app/knowledge-panel.tsx` |
| 网页服务配置与加密存储 | `app/service-settings.tsx`、`app/api/settings/route.ts`、`lib/service-config.ts`、`lib/service-config-core.mjs` |
| 自部署身份与会话 | `lib/auth.ts`、`app/api/session/route.ts` |
| SQLite 与音频存储 | `lib/local-storage.ts`、`drizzle/` |
| API 请求分派 | `app/api/[...path]/route.ts` |

## 已知缺口与容易误解的地方

当前可阅读、分类、收藏、管理主题，并使用设备朗读；论文检索返回原始题录与摘要；ECS 的 NCBI 主接口受限时，明确标注的 Europe PMC MED 备用已经通过真实查询及部署验收。Parallel、兼容模型接口和 MiniMax 配音有适配代码，仍需配置并验证真实调用。“已配置”只说明配置项存在；已验证状态仅对应实际检查与对应配置，不能随空白配置或旧状态继承。

实体事实必须保留人工来源证据。ISM6331 卡片仍是会议预告，不能补写尚未核对的实际 ESMO 结果；duvakitug 当前Ⅲ期开发与该卡Ⅱb应答者延伸结果分开。英矽智能–施维雅的 3,200 万美元为首付与近期研发款合计，未拆分；本次里程碑金额未披露，潜在 8.88 亿美元不等于已到账。部分原始正文未显示精确发表日，相关事实日期保留未知，不用核对日替代。

推荐从预设相邻主题中，按关注与收藏匹配排序；主动探索得到结果后，才按偏好加入 14 天探索主题。它没有持续分析全部阅读历史，也没有自行无限扩展关键词。`explorationRatio` 暂为保留字段。

刷新按钮重新读取已保存内容，不会启动后台搜集。全文提取、定时任务、完整事件去重、Codex 执行网关、音色克隆管理、完整离线阅读与跨设备播放进度尚未实现。过期探索主题通过查询过滤，不代表后台清理任务已部署。

内容列表需继续保留较早的收藏；不要把数据库查询重新改成只返回最新 200 篇。新增来源时保持 URL 稳定 ID，未知日期不要补造。默认 VHH / 抗体主题可以由用户更改，不限制产品只服务这类研究。

## 建议交给下一次 Codex 的任务

> 阅读 AGENTS.md、HANDOFF.md 和 VERIFICATION.md，核对当前 Git HEAD 与线上状态。保留账号、`.env` 和用户数据。关键词、深读及现有材料的专题积累已经完成本轮验收；继续从用户选择的服务配置和来源出发，以少量真实调用验证模型中文解读，再逐步增加药物、靶点和 BD 材料。未获密钥、调用预算及更新频率前，不宣称已接通付费服务或启用自动采集。新增资料必须保留来源、原始日期、证据范围及已有实体事实。
