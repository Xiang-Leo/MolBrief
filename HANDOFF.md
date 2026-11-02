# HANDOFF — 新开发会话入口

更新日期：2026-11-02。产品名为 **研览 · MolBrief**，副标题“你的制药与研究情报站”。2026-10-27 基础部署已完成；本轮正在改进关键词、深度阅读与知识汇总，尚未完成本轮服务器部署验收。

## 本轮目标与当前状态（2026-11-02）

用户已澄清无法使用的是添加关键词，不是上次的本机配置文件链接。线上保存 API 检查正常，已有 5 个关注，包含英矽智能；本轮临时测试关键词写入返回 200 后已清理，不能把历史的 4 个默认主题当作当前用户数据。

本轮已实现、正在本机测试与构建的内容：

- 关键词：`/topics` 真实入口；“添加并检索”与“仅保存”；可选英文 PubMed 检索式及已保存查询编辑；表单附近的结果反馈与中文输入法回车处理。
- 阅读：`data/editorial-enrichment.json` 保存 8 篇逐一核对原始来源的首批扩展，摘要约 300–380 字，另有六块 `deepDive`、37 条可追溯事实。模型摘要改为 4000 tokens 的结构化深读请求，保留人工实体；没有真实模型密钥，未进行真实 AI 调用。
- 知识库：现有材料覆盖 13 个专题（2 药物、2 靶点、3 合作、6 公司）；支持目录、类型及别名搜索、逐条事实来源 / 日期、时间线与手工补充资料。同 URL 追加保留原实体证据。未披露和未收录分别记录，不从标题或模型常识推断事实。
- 服务配置：`/settings` 可在网页编辑，密钥使用 `SESSION_SECRET` 派生密钥加密存入 SQLite，空输入保留、清除明确操作；界面区分未配置 / 已配置 / 已验证，付费服务验证仅用户点击时发起。保存后生效不代表真实调用通过。

当前范围是把已有材料整理为可持续积累的知识入口，不是穷尽全网药物、靶点和 BD 信息，也没有启用无人值守采集。新增功能仍以最终 `VERIFICATION.md` 的实际测试和 ECS 部署结果为准，不能把本机实现写成已经上线。

升级前保留当前有效备份与源站 `.env`，使用新增迁移，保留账号、用户主题、收藏及持久卷。数据库备份现在可能包含加密 API 凭据，恢复必须保留原 `SESSION_SECRET`；仅复制数据库、另生成新会话密钥会导致配置无法解密。

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

当前可阅读、分类、收藏、管理主题，并使用设备朗读；PubMed 搜索接口返回原始题录与摘要。Parallel、兼容模型接口和 MiniMax 配音有适配代码，仍需配置并验证真实调用。“已配置”只说明配置项存在；已验证状态仅对应实际检查与对应配置，不能随空白配置或旧状态继承。

实体事实必须保留人工来源证据。ISM6331 卡片仍是会议预告，不能补写尚未核对的实际 ESMO 结果；duvakitug 当前Ⅲ期开发与该卡Ⅱb应答者延伸结果分开。英矽智能–施维雅的 3,200 万美元为首付与近期研发款合计，未拆分；本次里程碑金额未披露，潜在 8.88 亿美元不等于已到账。部分原始正文未显示精确发表日，相关事实日期保留未知，不用核对日替代。

推荐从预设相邻主题中，按关注与收藏匹配排序；主动探索得到结果后，才按偏好加入 14 天探索主题。它没有持续分析全部阅读历史，也没有自行无限扩展关键词。`explorationRatio` 暂为保留字段。

刷新按钮重新读取已保存内容，不会启动后台搜集。全文提取、定时任务、完整事件去重、Codex 执行网关、音色克隆管理、完整离线阅读与跨设备播放进度尚未实现。过期探索主题通过查询过滤，不代表后台清理任务已部署。

内容列表需继续保留较早的收藏；不要把数据库查询重新改成只返回最新 200 篇。新增来源时保持 URL 稳定 ID，未知日期不要补造。默认 VHH / 抗体主题可以由用户更改，不限制产品只服务这类研究。

## 建议交给下一次 Codex 的任务

> 阅读 AGENTS.md、HANDOFF.md、DEPLOYMENT.md 和 VERIFICATION.md，先核对本机、GitHub、ECS 的实际 HEAD 和本轮验收状态。当前目标是修复关键词交互、扩大中文深读并提供可积累的药物 / 靶点 / BD 专题。保留服务器 .env、SESSION_SECRET、账号、用户主题与持久卷；升级前备份，不能用种子数据覆盖用户状态。按最新记录完成尚缺的本机、生产服务、手机与 ECS 部署检查，未部署不写已上线。模型 / 搜索仍需用户配置及真实调用验证；付费验证由用户明确触发。完成后继续 P1 和渐进资料积累，自动采集仍按 P2 另行安排。

如果没有服务器地址或必要访问，可先完成本地检查和部署包，不猜测 SSH 主机、账号或域名。尚未获得的 API 配置留空，不能使用示例值假装接通。
