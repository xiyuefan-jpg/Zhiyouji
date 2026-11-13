# apps/server

API + 后台任务（Fastify + PostgreSQL）。按 PRD 第 2、4、8 部分实现。进度见根目录 `PROGRESS.md`。

```bash
npm run dev -w @zhiyouji/server            # 本地启动（不设 DATABASE_URL 时用内存里的 PGlite）
npm run invite-admin -w @zhiyouji/server -- boss@example.com 名字 admin   # 建第一个管理员，打印邀请码
```

环境变量：`DATABASE_URL`（正式环境的 PostgreSQL）、`SERVER_SECRET`（正式环境必填）、`POLICY_VERSION`（三份协议的版本，改了家长要重新确认）、`PORT`、`TICK_MS`（worker 间隔）、`TRUST_PROXY=1`（在负载均衡后面时）。

外部服务（短信、图形验证）现在是假的（`src/providers.ts`），阿里云账号开好后换成真的，调用的地方不用改。

## 接口一览

所有接口在 `/v1` 下。出错时返回 `{ error, message }`，`message` 是给用户看的中文（`packages/shared/src/errors.ts`）。登录凭证：学生端网站用 Cookie（`zyj_s`），管理端用 `Authorization: Bearer <token>`（也认 Cookie `zyj_a`）。

### 学生端（家长手机号登录）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/v1/policy` | 三份协议的版本和链接 |
| POST | `/v1/auth/sms-code` | `{ phone, captcha? }` 发验证码。同一手机号 60 秒一次、每天 10 次；24 小时内输错累计 3 次后要图形验证；验证码 5 分钟有效、错 5 次作废 |
| POST | `/v1/auth/login` | `{ phone, code }` 登录；第一次自动建家庭账号。返回 `{ token, me }` 并设 Cookie |
| POST | `/v1/auth/logout` | 退出 |
| GET | `/v1/me` | 家庭、是否需要家长确认、孩子列表、当前选的孩子 |
| POST | `/v1/family/consent` | `{ choice: "agree" \| "disagree", version }` 家长确认。没同意之前，下面的接口都返回 `consent_required` / `refused` |
| GET / POST | `/v1/children` | 孩子档案列表 / 新建（昵称、头像、年级 1–10、讲解偏好），一个手机号最多 6 个 |
| PATCH | `/v1/children/:id` | 改孩子档案；改年级会留历史 |
| POST | `/v1/session/child` | `{ childId }` 选"我是谁" |
| GET | `/v1/messages` | 消息中心（当前孩子的 + 全家的），`?before=&limit=` 翻页 |
| GET | `/v1/messages/unread-count` | 未读数 |
| POST | `/v1/messages/:id/read`、`/v1/messages/read-all` | 标为已读 |

### 管理端（邮箱 + 密码 + 两步验证）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/v1/admin/auth/login` | `{ email, password, totp }`；连续错 5 次锁 15 分钟；30 分钟不操作或满 12 小时自动退出 |
| POST | `/v1/admin/auth/logout` | 退出 |
| GET | `/v1/admin/me` | 当前账号 |
| POST | `/v1/admin/auth/invite/start` | `{ token, password }` 接受邀请第 1 步：设密码，拿两步验证的二维码链接 |
| POST | `/v1/admin/auth/invite/finish` | `{ token, code }` 第 2 步：输一次验证码，账号生效 |
| GET / POST | `/v1/admin/users` | 管理员：账号列表 / 邀请新账号（返回邀请码） |
| POST | `/v1/admin/users/:id/disable` | 管理员：停用账号（立即下线） |
| GET | `/v1/admin/view-log` | 管理员：查看记录（谁看了、下载了哪个孩子的什么） |
| GET | `/v1/admin/messages` 等 | 管理端通知中心（同学生端消息接口） |

## 后台任务（worker）

`src/worker.ts`，每 `TICK_MS` 跑一次：
1. 每个进行中的服，按顺序跑到点的计划事件（幂等）；失败的不自动重跑，通知管理员，在管理端手动重跑；
2. 发到点的短信提醒：夜间 21:30–07:00 不发，顺延到 07:00；同一手机号、同一种提醒还没发出去时合并；每个手机号每天最多 5 条。
