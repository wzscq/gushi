# Auth Service（谷子私库 · 微信登录）



定制 Golang 服务：微信小程序 `wx.login` → 微信 `code2session` → 同步 CRV `core_user` → 代用户换取 **CRV Session**（`usr_...`）。



与 [tech.md](../tech.md) §3、[integration.md](../integration.md) §3、[public_api.md](../public_api.md) **v1.4** 对齐。



## 接口



| 方法 | 路径 | 说明 |

|------|------|------|

| GET | `/healthz` | 健康检查 |

| POST | `/auth/wechat/miniprogram` | 微信登录 / 自动注册 |



### 登录请求



```http

POST /auth/wechat/miniprogram

Content-Type: application/json



{
  "code": "<wx.login>",
  "nickname": "收藏家",
  "avatar_url": "https://..."
}

```



### 登录响应



```json

{

  "access_token": "usr_xK9mN2pQ...",

  "token_type": "Bearer",

  "expires_in": 900,

  "is_new_user": true,

  "user": {

    "id": "u_a1b2c3d4e5f67890",

    "nickname": "收藏家",

    "avatar_url": "https://..."

  }

}

```



| 字段 | 说明 |

|------|------|

| `access_token` | CRV Session（`usr_`），小程序用于所有 CRV API |

| `expires_in` | 空闲 TTL 参考值（默认 900s）；实际以 Redis 滑动续期为准 |



## 环境变量



复制 `.env.example` 为 `.env` 后填写：



| 变量 | 必填 | 说明 |

|------|------|------|

| `WECHAT_APP_ID` | 是 | 小程序 AppID |

| `WECHAT_APP_SECRET` | 是 | 小程序 AppSecret |

| `AUTH_PASSWORD_SECRET` | 是 | HMAC 密钥，从 openid 派生用户内部密码 |

| `CRV_PROVISIONER_TOKEN` | 是 | CRV 管理员签发的长期 `int_` 集成令牌，用于 sync `core_user` |

| `CRV_BASE_URL` | 否 | 默认 `http://127.0.0.1:8080` |

| `CRV_APPID` | 否 | 代用户调 CRV `/v1/auth/login` 的固定 appid，默认 `gushi`（不由前端传入） |

| `CRV_LOGIN_USERNAME_FIELD` | 否 | 默认 `id` |

| `AUTH_ADDR` | 否 | 默认 `:8081` |

| `DEFAULT_USER_ROLE` | 否 | 默认 `gushi_user` |



**Provisioner**：必须配置 `CRV_PROVISIONER_TOKEN=int_...`（长期有效，无空闲 TTL）。不再支持 admin 账密登录 CRV。



## 前置条件



1. MySQL 已执行 [schema.sql](../schema.sql)

2. CRV `apps/gushi` 模型与 `datasets.json` 已部署

3. CRV **`CRVSVC_AUTH_MODE=session`** + **Redis** 已配置

4. `CRVSVC_APP_SCHEMA_MAP_JSON` 含 `"gushi"` 映射

5. 种子角色：`INSERT INTO core_role (id, remark) VALUES ('gushi_user', '谷子私库普通用户');`

6. Provisioner token 须绑定 `gushi` schema，且具备 `core_user` query/save 权限



## 流程



1. Auth 使用 `int_` provisioner token 在 CRV query/save 同步 `core_user`

2. 小程序 `wx.login` → Auth `code2session`

3. 新用户写入 `password` + `gushi_user` 角色；老用户可选 update 昵称/头像

4. Auth 用 `HMAC(openid, AUTH_PASSWORD_SECRET)` 作为内部密码，代用户调 CRV `/v1/auth/login`

5. 将 `usr_...`、`expires_in` 返回小程序



## 运行

复制 `.env.example` 为 `.env` 并填写；启动脚本含密钥，**勿提交 git**，请从模板复制：

```powershell
# Windows（首次）
Copy-Item start.ps1.example start.ps1
# 编辑 start.ps1 或 .env 填写环境变量后：
.\start.ps1
# 使用已编译二进制：.\start.ps1 -UseBinary
```

```bash
# Linux / macOS / WSL（首次）
cp start.sh.example start.sh && chmod +x start.sh
./start.sh
# ./start.sh --binary
```

也可直接运行：

```bash
cd auth-service
go run ./cmd/server
```



## 构建



```bash

go build -o bin/auth-server ./cmd/server

```

