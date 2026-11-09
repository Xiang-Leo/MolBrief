# 研览 · MolBrief — 自部署版

一个手机优先的个人制药与研究情报站。阅读药企、药物、AI制药和论文信息，保留来源与证据范围，也支持收藏、探索主题和听读。

**这是可迁移到普通服务器的独立版本。** 使用 Next.js + Node.js 24、SQLite 和本地音频文件。账号由你在服务器初始化，不依赖 ChatGPT 登录或 Cloudflare D1/R2。当前定位为一个人使用、一个服务实例，便于维护。

当前部署入口：[todayai.xxlab.xyz](https://todayai.xxlab.xyz)。源码仓库：[Xiang-Leo/MolBrief](https://github.com/Xiang-Leo/MolBrief)，本仓库根目录对应完整交付包中的 `self-hosted/`。部署验收与仍待配置的服务见 `VERIFICATION.md`；登录密码和运行数据不包含在仓库中。

## 从哪里开始

| 你的目的 | 先读 |
|---|---|
| 在 Mac 或远程 Linux 服务器启动 | [DEPLOYMENT.md](DEPLOYMENT.md) |
| 交给 Codex 继续开发 | [AGENTS.md](AGENTS.md) → [HANDOFF.md](HANDOFF.md) |
| 理解整体想法与范围 | [PRD.md](PRD.md) |
| 决定下一阶段做什么 | [ROADMAP.md](ROADMAP.md) |
| 查架构、数据与接口 | [ARCHITECTURE.md](ARCHITECTURE.md) |
| 查看实际通过的检查及限制 | [VERIFICATION.md](VERIFICATION.md) |

## 最短启动路径

需要 Node.js 24 和 Docker Engine/Compose。若只有 Docker，初始化替代命令见部署文档。

```bash
node scripts/setup.mjs
docker compose up -d --build
```

初始化会要求你设置网站地址、账号和密码；真实密码不回显，只保存 scrypt 哈希。会话密钥与后台写入令牌随机生成，写入本地 `.env`。没有预设通用密码。

默认仅监听服务器的 `127.0.0.1:3000`。本机可打开 `http://localhost:3000`；远程服务器先用 SSH 隧道访问，或按部署文档配置自己的 HTTPS 域名。手机长期使用建议配置 HTTPS 域名。

## 现在有什么

- [靶点研究](https://todayai.xxlab.xyz/targets)：免费查询人类靶点、功能与通路、疾病关联及临床候选；支持关注定期检索和基于官方快照的中文解读。关联评分与药物阶段均保留数据范围说明。
- 日期区分在线发表与期刊卷期，未来日期不冒充已发表；中文解读可展开所依据的原始材料。

- [关键词与检索式](https://todayai.xxlab.xyz/topics)：添加并检索、仅保存、修改查询；NCBI 受限时使用明确标注的 Europe PMC MED 题录备用。
- [药物、靶点与 BD 知识库](https://todayai.xxlab.xyz/knowledge)：首批 13 专题，来源事实、时间线及手工补充资料；已收录证据持续保留。
- [网页服务设置](https://todayai.xxlab.xyz/settings)：加密保存 API 配置，保存后立即生效，实际调用状态单独验证。
- 8 篇首批材料已有更完整的中文概要及六类深读，未配置模型也可阅读这些人工核对内容。
- 自动采集：服务器按已保存的北京时间计划读取关注，检索、按 URL 去重并收录到首页；新安装默认每天 08:00，当前 ECS 用户已改为 06:00。可在设置暂停、调整时间或立即执行。免费论文源默认开启，Parallel 和模型需配置并勾选，调用次数有每日上限。
- 中文解读：单篇生成进入后台，页面显示排队、生成及失败；采集设置中的“补全已收录中文解读”可按 1 / 3 / 6 / 12 篇处理旧文章，受每日自动调用上限约束。手动单篇调用与自动额度单独计算，按按钮前会显示说明。

- 8 篇真实来源起始材料，显示摘要、要点、证据局限和原文入口。
- PubMed 题录与原始摘要搜索；已收录内容搜索与分类。
- 独立账号登录，收藏、已读、关注和偏好持久保存。
- 根据关注和收藏提供规则型探索建议；主动探索找到内容后可加入14天试用主题。
- 设备朗读和手机主屏幕入口。
- Parallel、兼容模型API、MiniMax固定音色的服务端适配器。它们需要配置自己的服务后验证。
- 受服务令牌保护的内容写入、数据迁移、备份和内容导入脚本。

完整网页抓取、事件级合并、Codex执行网关、音色克隆界面、完整离线阅读和跨设备播放进度属于后续工作。刷新列表只读取已收录内容；独立采集进程负责定时新增，首次部署和执行结果见 `VERIFICATION.md`。

## 内容与数据

`data/seed.json` 是初始阅读内容；`data/content-export.json` 以 2026-10-27 核对后的文章快照为基础，已合入本轮扩写，并单独记录编辑更新日期。原始 `data/hosted-database-export.json` 完整记录当时 6 张表：8 篇文章，其余表为空。它不是正在运行的数据库。当前运行数据位于 `DATA_DIR`；Docker 使用具名持久卷。

导入快照（服务已经启动后）：

```bash
docker compose exec app node scripts/import-content.mjs data/content-export.json
```

导入按来源URL合并，不会重复生成8份卡片。此脚本不会导入账号或密码；原线上版本当时也没有个人收藏和关注记录。

## 开发检查

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run smoke
```

`smoke` 使用随机测试账号和临时数据库启动真实生产产物，检查登录、权限、收藏、重启后的持久化和备份。不会调用付费API，也不会修改你实际运行的数据。

## 版本来源

原托管版本源码提交：`adb34029dd461809e7410f5b575dfdcadc972b45`。原始快照单独保存在完整交付包的 `reference/` 中。自部署版升级了生产依赖并替换运行环境，后续请以本目录和自己的Git仓库为开发主线。
