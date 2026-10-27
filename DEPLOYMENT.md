# 研览 · MolBrief 部署与迁移

日期：2026-10-27。面向个人使用、单个服务实例和有持久磁盘的服务器。入口是本文件所在的 `self-hosted/` 目录。

## 当前 ECS 部署（2026-10-27）

已通过本机 `/Users/xiangli/ecs-connection.sh` 中的连接方式访问服务器：

```bash
ssh -p 1111 xiangxiang@43.156.73.7
cd /home/xiangxiang/molbrief
docker compose ps
```

服务器为 Ubuntu 24.04 x86_64，Docker 29.4、Compose 2.40.3。镜像 `molbrief:0.2.0` 已实际构建；容器 `molbrief-app-1` 为 healthy，运行 Node.js 24.22.1，数据卷为 `molbrief_molbrief_data`，应用只绑定 `127.0.0.1:3000`。

当前 `APP_ORIGIN=https://todayai.xxlab.xyz`，账号为 `admin`。密码保存在本机私有文件 `/Users/xiangli/.config/molbrief/todayai.xxlab.xyz-login.txt`；`.env` 的私有备份为同目录下的 `todayai.xxlab.xyz.env`。文档不保存密码、哈希、会话密钥或令牌。

服务器已有宿主 Nginx 占用 80 / 443，本次沿用该代理，**不启动附带的 Caddy Compose**。已新增 `/etc/nginx/sites-available/todayai.xxlab.xyz` 与对应 enabled 软链接，HTTPS 反向代理至 `127.0.0.1:3000`，HTTP ACME 验证目录为 `/var/www/molbrief-acme`；`nginx -t` 与 reload 成功。该账号的 sudo 需要密码，本次通过其既有 Docker 管理权限的一次性维护容器配置宿主 Nginx，未修改其他站点。

Cloudflare 已添加并代理 A 记录 `todayai` → `43.156.73.7`，权威 DNS 与 Cloudflare 公网响应已验证。Certbot 已通过 webroot 签发 Let's Encrypt 证书 `/etc/letsencrypt/live/todayai.xxlab.xyz/fullchain.pem`，到期日为 2027-01-25；`certbot.timer` 已启用且 active，续期配置包含 Nginx 检查及 reload 的 deploy hook。

服务器 P0 验收已通过：真实容器完成认证、重启持久化、重复导入、服务令牌隔离和备份读回；从 ECS 经公网 HTTPS 域名执行的 10 项检查全部通过。当前为 8 篇文章、4 个默认主题，无测试收藏或已读记录。当前 Mac 的 curl 与内嵌浏览器访问域名仍出现 `ERR_CONNECTION_CLOSED`，原因未确定；服务器侧的源站证书与 Cloudflare 公网访问均已通过，不能据此宣称 Mac 或实际手机验收通过。检查范围见 `VERIFICATION.md`。

已生成干净备份 `molbrief-2026-10-27T06-18-24-620Z-2369d05b`，容器内位于 `/app/var/backups/`，并已复制到宿主 `/home/xiangxiang/molbrief/backups/` 与 Mac `/Users/xiangli/.config/molbrief/backups/` 下的同名目录。Mac 使用 Node.js 24 读回确认 8 篇文章、4 个主题且无测试收藏 / 已读。`.env` 另有前述私有备份，不在数据备份或源码中。

以下为通用安装与维护步骤；继续本机现有部署时，使用上方实际目录和既有配置，无需重新初始化账号或覆盖 `.env`。

## 1. 先区分两个版本

完整交付包同时保留原托管源码与自部署版。普通Linux服务器请使用 **self-hosted**；`reference/` 中的原始ZIP用于追溯，包含当时的托管依赖，不是本次服务器启动入口。

| 项目 | 原托管版 | 本自部署版 |
|---|---|---|
| Web运行环境 | Vinext / Workers | 标准Next.js / Node24 |
| 登录 | ChatGPT及托管身份头 | 自己设置的独立账号和密码 |
| 数据库 | 托管D1 | 本地SQLite |
| 音频文件 | 托管R2 | 持久目录audio/ |
| 后台写入授权 | 托管私有边界 | INGEST_API_TOKEN |
| 运行方式 | 托管发布 | Docker Compose或Node生产服务 |

## 2. 准备环境与文件

推荐服务器具备 Docker Engine 与 Compose v2、可写持久磁盘，以及访问npm镜像/容器镜像和所选API服务的网络能力。原始交付时尚未连接服务器；本轮 ECS 的实际部署状态见本文开头，验证范围见 `VERIFICATION.md`。

本地下载并解压完整交付包。在解压后的 `MolBrief` 目录中，将其中的 `self-hosted` 上传到自己的Linux账号目录，例如：

```bash
scp -r self-hosted your-user@your-server:~/molbrief
ssh your-user@your-server
cd ~/molbrief
```

将示例中的用户和服务器替换成你的真实SSH信息。建议首次在服务器生成 `.env`，不要把它提交Git。

## 3. 初始化站点账号

若有Node.js24：

```bash
node --version
node scripts/setup.mjs
```

若服务器只有Docker：

```bash
docker run --rm -it \
  --user "$(id -u):$(id -g)" \
  -v "$PWD:/work" -w /work \
  node:24-bookworm-slim node scripts/setup.mjs
```

脚本依次询问网站地址、账号、密码并要求重复密码；密码不回显，至少12位。它生成：

- `ADMIN_PASSWORD_HASH`：scrypt密码哈希。
- `SESSION_SECRET`：随机会话签名密钥。
- `INGEST_API_TOKEN`：随机后台写入令牌。
- `APP_ORIGIN`：访问网站的准确源地址，包含协议与端口。

没有默认密码；已有`.env`时脚本拒绝覆盖。文件权限是0600。不要把会话密钥或写入令牌填到普通聊天或提交到Git。

### 网站地址怎么填

- 本机或SSH隧道先试用：`http://localhost:3000`。
- 已准备好自己的域名：`https://molbrief.your-domain.com`。
- 局域网短期使用：可填`http://服务器内网IP:端口`，但手机PWA、浏览器声音和登录传输的长期体验应通过HTTPS验收。

浏览器实际使用的地址必须与APP_ORIGIN相同。`localhost`与`127.0.0.1`不是同一个Origin；不同端口也不是。地址不一致时写入会返回403。

## 4. Docker启动：先通过SSH隧道验收

```bash
docker compose up -d --build
docker compose ps
docker compose logs --tail=80 app
```

应用首次启动自动迁移数据库。默认Compose仅绑定服务器回环地址`127.0.0.1:3000`，数据保存在`molbrief_data`具名卷，普通重建镜像不删除它。

在你的Mac另开一个终端：

```bash
ssh -N -L 3000:127.0.0.1:3000 your-user@your-server
```

保持隧道窗口打开，在Mac访问`http://localhost:3000`，使用刚设置的站点账号登录。若本机3000已被占用，可将隧道本地端口换成3001，同时把服务器`.env`中的APP_ORIGIN改为`http://localhost:3001`并重建容器配置：

```bash
docker compose up -d --force-recreate app
```

手机不能直接使用Mac的localhost隧道地址。要随时在手机打开，继续下一节配置HTTPS域名。

## 5. 使用自己的HTTPS域名

附带的Caddy方案适用于可从互联网访问的服务器：域名DNS指向服务器，80和443端口可达。已经有Nginx/Caddy反向代理时，可以沿用既有代理，将请求转发到127.0.0.1:3000，无需再启动一套Caddy。

修改`.env`：

```dotenv
APP_ORIGIN=https://molbrief.your-domain.com
MOLBRIEF_DOMAIN=molbrief.your-domain.com
```

启动附带的HTTPS方案：

```bash
docker compose -f compose.yaml -f compose.https.yaml up -d --build
```

访问你的HTTPS域名并登录。配置HTTPS后Cookie会带Secure属性。Caddy维护证书和反向代理；应用仍使用同一数据卷。内网专用域名的证书、DNS和可信CA需要按你的网络条件配置，本示例不假设你的内网已具备这些条件。

手机浏览器打开后，可以使用系统菜单添加到主屏幕。设备朗读和后台播放能力仍应在实际手机上验收。

## 6. 接入你的API

编辑服务器`.env`，加入已有服务的值，然后重建容器环境：

```bash
docker compose up -d --force-recreate app
```

| 服务 | 配置项 | 用途 |
|---|---|---|
| Parallel | PARALLEL_API_KEY | 全网检索和摘录 |
| 摘要模型 | LLM_BASE_URL、LLM_API_KEY、LLM_MODEL | 兼容Chat Completions接口的中文解读 |
| MiniMax | MINIMAX_API_KEY、MINIMAX_VOICE_ID、MINIMAX_MODEL | 指定音色的MP3生成与缓存 |

`LLM_BASE_URL`应为HTTPS API根路径，例如`https://你的服务地址/v1`，代码会追加`/chat/completions`；不要填成完整chat/completions地址。提供商需支持当前请求中的JSON响应格式与模型参数，兼容性要用真实账号验证。

MiniMax默认模型名称为`speech-2.8-turbo`，音色ID需先在该服务创建或选择。本版本未实现声音克隆上传界面。没有配置API时，阅读、收藏和设备朗读可使用；全网检索、模型摘要和云端配音显示待连接。

Codex执行网关和定时更新尚未实现/启用；不要把Docker启动等同于自动采集已经开始。

## 7. 导入当前文章快照

应用正常运行后：

```bash
docker compose exec app node scripts/import-content.mjs data/content-export.json
```

脚本从容器内回环地址调用受保护的写入接口，使用服务器环境中的写入令牌，写入后按URL读回核对。令牌不会输出到终端。重复导入按URL合并。

2026-10-27导出快照：articles=8，其余5张表均为空，没有个人收藏、关注或音频对象需要搬迁。原始6表JSON另在`data/hosted-database-export.json`。

以后若迁移包含个人状态的原托管数据，应将原用户ID明确映射为`owner`，并保持article ID对应关系。不能直接复制D1库后让初始建表SQL重新跑；本版有独立的迁移记录表。不要未经检查覆盖目标SQLite库。

## 8. 备份、恢复与更新

### 备份

```bash
docker compose exec app node scripts/backup.mjs
```

默认在数据卷的`/app/var/backups/`下创建新的时间戳目录。备份包含SQLite一致性快照、audio目录和backup.json；**不包含.env**。

将备份复制到服务器宿主机，例如：

```bash
mkdir -p backups
docker compose cp app:/app/var/backups/. ./backups/
```

同时将`.env`以私有方式单独备份。备份留在同一磁盘不能抵御磁盘损坏，应再复制一份到其他受控位置。备份文件夹含私人阅读数据，不要加入Git。

### 恢复

先保留当前数据的备份。恢复时停止应用，让SQLite主文件与WAL保持一致；不在运行中覆盖数据库。

```bash
docker compose stop app
```

使用临时维护容器挂载相同具名卷，把选定备份的`molbrief.sqlite`和`audio/`恢复到`/app/var/`，清理目标库的旧`molbrief.sqlite-wal`与`molbrief.sqlite-shm`，恢复文件所有者UID/GID为1001。这个动作会替换目标运行状态，执行前核对目标卷和备份目录。备份目录中的数据库已包含迁移记录，不需要修改旧迁移SQL。

恢复后启动并核对收藏与关注：

```bash
docker compose up -d app
```

首次实际服务器部署时，应做一次“备份到空测试目录再读回”的演练。不要用未经确认的恢复命令直接覆盖唯一的数据卷。

### 更新代码

```bash
git pull --ff-only
docker compose up -d --build
```

仅当你已经按下一节建立自己的Git仓库时使用git pull。更新前备份；不要执行会删除数据卷的`docker compose down -v`。数据库新版本采用新增迁移，不能修改已经应用过的SQL文件。

## 9. Git 仓库与更新

用户已提供公共仓库 [Xiang-Leo/MolBrief](https://github.com/Xiang-Leo/MolBrief)。以本机 `self-hosted/` 为 Git 根目录，分支为 `main`，服务器 `/home/xiangxiang/molbrief` 将跟踪同一代码。首次提交、推送与服务器 Git 同步正在进行中，尚未记作完成。

首次建立仓库的命令如下；已有 `.git` 时不要重复初始化或添加 remote：

```bash
git init
git add .
git commit -m "Initial MolBrief self-hosted version"
git branch -M main
git remote add origin https://github.com/Xiang-Leo/MolBrief.git
git push -u origin main
```

`.gitignore` 排除了 `.env`、运行数据、备份、`node_modules` 和构建产物，镜像中也已核对不含 `.env`。公共仓库中仅提交源码与非秘密配置示例。

后续在本地改代码并推送，服务器在现有目录执行 `git pull --ff-only` 和 `docker compose up -d --build`。更新前按第 8 节备份，保留现有 `.env` 与数据卷，不要重新运行账号初始化。全新服务器才需要 clone 和首次配置。

## 10. 不用Docker的Node路径

需要Node.js24与npm：

```bash
npm ci
node scripts/setup.mjs
npm run db:migrate
npm run typecheck
npm test
npm run build
npm run start
```

Next.js会加载项目根目录.env；npm run start提供生产服务，开发时才用npm run dev。正式长期运行应配置systemd或你已有的进程管理器，设置正确WorkingDirectory、启动用户和重启策略；前面保留反向代理。不要把开发服务器作为公开部署入口。

## 11. 最少验收清单

1. 未登录打开首页跳转登录；伪造旧平台身份头仍无法读取API。
2. 设置的账号可以登录，刷新后仍保持登录。
3. 收藏文章、修改语速、添加主题后，重启服务再读仍然存在。
4. 原文链接能打开；未接API的功能明确显示待连接。
5. 用写入令牌导入快照后数量与来源URL对应，重复导入不重复。
6. 手机读文章、切换导航、暂停朗读和主屏幕入口可用。
7. HTTPS域名的APP_ORIGIN匹配实际浏览器地址，退出能清除当前Cookie。
8. 备份可读回，.env与数据有独立保留方式。

## 参考依据

- [Next.js自部署](https://nextjs.org/docs/app/guides/self-hosting)
- [Next.js standalone产物](https://nextjs.org/docs/app/api-reference/config/next-config-js/output)
- [Node.js SQLite API](https://nodejs.org/api/sqlite.html)（本项目固定Node24，避免跨大版本运行）
- [Docker Compose规范](https://docs.docker.com/reference/compose-file/)
- [Caddy请求体大小限制](https://caddyserver.com/docs/caddyfile/directives/request_body)
