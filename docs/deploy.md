# 部署说明（第三十二轮起草，阿里云开好后照着做）

> 依据：PRD 第 2 部分第 2、5、6、8 节，第 8 部分第 3、4 节。这里是"怎么把仓库里的东西跑到阿里云上"的步骤清单；标【待填】的要等账号和域名。Dockerfile 还没有在真机上构建过，第一次部署时要验证。

## 1. 要准备的阿里云资源

| 资源 | 规格建议（第一季约 120 名赛季玩家 + 几百名免费用户） | 用途 |
|---|---|---|
| ECS 云服务器（内地，包年包月） | 2 核 4 GB 起，系统盘 40 GB + 数据盘 100 GB | 跑服务器（API + worker 同一个进程）、nginx 和网站静态文件；也是 ICP 备案的前提 |
| RDS PostgreSQL | 16 版，2 核 4 GB，开启**存储加密**、**自动备份（每天）**和**按时间点恢复** | 赛季、账本、作品记录等全部数据 |
| OSS 对象存储（私有读写，开启服务端加密） | 按量 | 作品、录音、证据图片；网站和管理端的静态文件（管理端放 OSS + CDN，美国打开也快） |
| CDN | 按量 | 管理端静态文件；以后作品播放 |
| 短信服务 | 签名 + 5 个模板（`packages/shared/src/messages.ts`） | 登录验证码、4 种紧急提醒、两年未登录通知 |
| 智能语音交互（录音文件识别）、媒体处理 | 按量 | 转写、视频抽帧（PRD 第 6 部分 T1、T2） |
| 百炼（大模型） | 按量 | 每日任务审核、作品初评、军需打分、周月报告 |
| 内容安全 | 按量 | 作品公开前检查 |
| 日志服务 SLS、云监控 | 按量 | 日志、出错报警发到管理员邮箱（PRD 第 2 部分 4.12） |

## 2. 环境变量

见仓库根目录的 `.env.example`。生产环境必须设置 `SERVER_SECRET`（不设置服务器拒绝启动）和 `DATABASE_URL`。`.env` 不进仓库。

## 3. 第一次部署（预发布环境，staging）

1. ECS 上装 Docker 和 Docker Compose；把仓库拉下来。
2. 复制 `.env.example` 为 `.env`，填好 `SERVER_SECRET`（`openssl rand -hex 32`）；设置 `DB_PASSWORD` 环境变量。
3. 打包网站：`npm ci && npm run build -w @zhiyouji/web`（产物在 `apps/web/dist`）。
4. 证书放进 `deploy/certs/`（阿里云免费证书即可），把 `deploy/nginx.conf` 里的域名改成备案后的域名。
5. `docker compose -f deploy/docker-compose.yml up -d --build`。数据库结构在服务器启动时自动迁移（`packages/db/migrations`）。
6. 检查：`curl https://域名/v1/health` 返回 `{"ok":true}`。
7. 建第一个管理员：`docker compose -f deploy/docker-compose.yml exec server npx tsx apps/server/src/cli/inviteAdmin.ts 邮箱 名字 admin`，打开打印出来的邀请链接。
8. 管理端：`VITE_API_BASE=https://域名 npm run build -w @zhiyouji/admin`，把 `apps/admin/dist` 传到 OSS（静态网站托管）并接 CDN。

生产环境（production）步骤一样，只是不用 compose 里的 `db`，`DATABASE_URL` 指向 RDS。

## 4. 发布新版本

1. 所有测试通过（`npm test`、`npm run typecheck`）。
2. **改了数据库结构的版本，先在 RDS 控制台手动做一次备份**（PRD 第 2 部分第 6 节）。
3. 服务器：`git pull && docker compose … up -d --build server`。容器收到 SIGTERM 后先停 worker、处理完手上的请求再退出（`apps/server/src/main.ts`），最长等 30 秒。
4. 网站：重新打包 `apps/web/dist`，nginx 直接读新文件；`index.html` 不缓存，`/assets/` 带哈希、缓存 30 天。
5. 赛季进行中发布，尽量避开每天的公布时刻（早、午、晚）和 21:00 截止前后。

## 5. 备份和恢复演练（PRD 第 8 部分 3.2：每季度至少一次）

1. RDS：自动备份每天一次，保留 7 天以上；开启按时间点恢复。
2. OSS：开启版本控制，或每天同步到另一个地域的存储桶。
3. 演练：在 RDS 控制台"恢复到新实例"（选一个时间点）→ 预发布环境的 `DATABASE_URL` 指向新实例 → 启动服务器 → 管理端"赛季监控"看各服的账本和排名，和生产对一下 → 记录用时，删除临时实例。
4. 账本是只追加的，赛季状态由快照和事件重放得到（`apps/server/src/seasonStore.ts`），服务器读取时自动重建，恢复后不需要额外操作。

## 6. 换成真服务的接口位置

| 假的服务 | 文件 | 换成 |
|---|---|---|
| `FakeSms` | `apps/server/src/providers.ts` | 阿里云短信 |
| `FakeCaptcha` | 同上 | 阿里云验证码 2.0 |
| `LocalStorage` | `apps/server/src/storage.ts` | OSS（上传用带签名的直传地址，下载用有时效的签名链接；大文件用分片上传：InitiateMultipartUpload、带签名的 UploadPart、ListParts、CompleteMultipartUpload，对应 `startMultipart` / `partTicket` / `listParts` / `completeMultipart`。存储桶的跨域设置要允许网站域名的 PUT；没完成的分片设生命周期规则 7 天后清掉） |
| `FakeContentSafety` | `apps/server/src/providers.ts` | 内容安全 |
| `FakeMediaProcessor` | `apps/server/src/media.ts` | 录音文件识别 + 媒体处理（抽帧）+ 文档解析 |
| `FakeAiScorer`、`FakeAiDaily`、`FakeAiSupply`、`FakeAiSummarizer` | `apps/server/src/ai.ts` | 百炼（经过 AI 网关，管理端可以换模型） |

`apps/server/src/main.ts` 里构造这些服务；每个都是一个小接口，换的时候页面和规则代码不用动。

接真的大模型时：孩子写的、说的内容一律用 `apps/server/src/aiGuard.ts` 的 `childContent()` 包起来，提示词里放 `CHILD_CONTENT_RULE` 这句话（PRD 第 8 部分 3.3、第 6 部分第 3 节"防打分指令"）。AI 网关已经会找出"给我通过""打满分""忽略以上指令"这类话，在结果上标"疑似打分指令"，不管模型怎么回答。

## 7. 上线前检查（PRD 第 9 部分第 3 节的开营条件之外）

- 同意隐私政策之前不发任何第三方请求（网站已做到；接真服务后再用浏览器开发者工具检查一遍）。
- 三份文件的【待填】补齐、律师审定；改了文件内容就把 `POLICY_VERSION` 改成新版本，家长下次登录会重新确认。
- 管理员和复核员账号都开了两步验证；查看记录能查到。
- 出错报警能收到（故意让一个计划事件失败试一次）。
- 数据泄露处置手册（`docs/security/数据泄露处置手册.md`）补齐【待填】并演练一次（PRD 第 8 部分 3.5）。
- 管理端"开营前检查"（`GET /v1/admin/seasons/:id/preflight`）没有 `fail`。
