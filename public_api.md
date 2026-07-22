# CRV Service 公开 API 文档

**文档版本**：1.5  
**API 版本**：v1  
**最后更新**：2026-07-18

本文档描述 CRV Service HTTP API 的接入方式，供外部系统通过 REST 接口进行**身份认证**、**模型元数据读取**、**数据查询**与**数据保存**。文档内容对应当前服务端实现，可单独对外发布。

---

## 目录

1. [概述](#1-概述)
2. [环境与约定](#2-环境与约定)
3. [认证](#3-认证)
4. [通用响应格式](#4-通用响应格式)
5. [API 列表](#5-api-列表)
6. [接口详情](#6-接口详情)
7. [数据查询：过滤与排序](#7-数据查询过滤与排序)
8. [数据权限](#8-数据权限)
9. [动作（Operation）接口](#9-动作operation接口)
10. [接入流程与示例](#10-接入流程与示例)
11. [错误处理](#11-错误处理)
12. [附录：尚未提供的接口](#12-附录尚未提供的接口)

---

## 1. 概述

CRV Service 是基于 JSON 的 REST 服务，面向多租户（schema）数据访问场景。外部系统典型用法：

1. 登录获取不透明 Session 令牌（`usr_...`）
2. 查询可用数据模型
3. 按模型发起结构化查询或事务保存
4. （可选）上传附件并在保存时引用 OSS 路径

### 1.1 已实现能力

| 能力 | 方法 | 路径 |
|------|------|------|
| 健康检查 | GET | `/healthz` |
| 用户登录 | POST | `/v1/auth/login` |
| 模型元数据 | GET | `/v1/meta/models` |
| 数据查询 | POST | `/v1/data/query` |
| 数据保存 | POST | `/v1/data/save` |
| 文件上传 | POST | `/v1/files/upload` |
| 文件下载 | GET | `/v1/files/download` |
| 动作列表 | GET | `/v1/operations` |
| 动作执行 | POST | `/v1/operations/execute` |
| 集成令牌签发/吊销 | POST | `/v1/integration/tokens` |

### 1.2 尚未实现

批量行级写入（`/v1/data/{modelId}/rows` 等拆分接口）及高权限原始查询接口当前**未开放**，请勿依赖。见 [§12](#12-附录尚未提供的接口)。

---

## 2. 环境与约定

### 2.1 Base URL

将下文中的 `{base_url}` 替换为实际部署地址，例如：

```text
https://api.example.com
```

本地开发示例：

```text
http://127.0.0.1:8080
```

### 2.2 请求头

| 头 | 说明 |
|----|------|
| `Content-Type: application/json` | JSON 请求体接口（查询、保存、登录等） |
| `Content-Type: multipart/form-data` | 文件上传 `POST /v1/files/upload` |
| `Authorization: Bearer <access_token>` | 受保护接口（`session` 模式必填） |
| `X-Schema: <schema>` | 仅 `disabled` 模式用于指定租户；`session` 模式可省略（见 [§2.3](#23-租户schema)） |
| `X-Roles: role1,role2` | 仅 `disabled` 模式用于传递角色 |
| `X-User: <userId>` | 仅 `disabled` 模式；保存/上传时的审计用户标识 |

### 2.3 租户（Schema）

每个租户对应独立的数据与配置空间（`apps/{schema}/`）。

**`session` 模式（生产）**：租户在登录时由 `appid` 映射并绑定到 Session（响应字段 `schema`）。受保护接口从 Session 读取租户，**无需**再传 `?schema=` / `X-Schema` / `appDb`；若客户端传入且与 Session 不一致 → HTTP **403**，`code=40301`。

**`disabled` 模式（仅开发）**：须通过以下方式之一指定租户，且同一请求内保持一致：

- 数据查询 / 数据保存 / 文件上传 / 文件下载：Body 字段 `appDb` 或请求头 `X-Schema`（二选一或同时一致）
- 元数据：`?schema=` 查询参数或 `X-Schema` 头
- 动作接口：请求头 `X-Schema`（必填）

示例 schema：`school`、`amis`（以运营方分配的 `appid` 映射为准）。

### 2.4 认证模式

服务端通过环境变量 `CRVSVC_AUTH_MODE` 控制：

| 模式 | 说明 |
|------|------|
| `session`（生产推荐） | 受保护接口必须携带有效 Bearer 不透明 Session 令牌（`usr_...` 或 `int_...`）；需配置 Redis |
| `jwt` | **`session` 的别名**，行为相同 |
| `disabled`（仅开发） | 可不传 Token；租户用 `X-Schema` / `appDb`，角色用 `X-Roles` |

### 2.5 Session 与 Redis（运营方配置）

`session` 模式依赖 Redis 存储 Session。常用环境变量（由部署方设置，接入方通常无需关心）：

| 变量 | 说明 |
|------|------|
| `CRVSVC_REDIS_ADDR` | Redis 地址（`session` 模式必填） |
| `CRVSVC_REDIS_PASSWORD` | Redis 密码（可选） |
| `CRVSVC_REDIS_DB` | Redis DB 编号，默认 `0` |
| `CRVSVC_SESSION_KEY_PREFIX` | Session 键前缀，默认 `crvsvc:session:` |
| `CRVSVC_LOGIN_TOKEN_TTL_SEC` | 用户 Session **空闲**过期秒数，默认 `900`（15 分钟） |
| `CRVSVC_APP_SCHEMA_MAP_JSON` | `appid` → schema 映射，如 `{"demo":"amis","school":"school"}` |
| `CRVSVC_INTEGRATION_TOKEN_ADMIN_ROLES` | 允许签发/吊销 `int_` 令牌的角色，逗号分隔，默认 `admin` |

---

## 3. 认证

### 3.1 登录获取 Session 令牌

适用于由 CRV Service 直接签发访问令牌的场景。登录成功后返回**不透明**令牌（非 JWT），服务端在 Redis 中保存用户主体、租户 schema 与角色。

**请求**

```http
POST {base_url}/v1/auth/login
Content-Type: application/json
```

**Body**

```json
{
  "username": "your_username",
  "password": "your_password",
  "appid": "school"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `username` | string | 是 | 租户库用户账号 |
| `password` | string | 是 | 密码 |
| `appid` | string | 是 | 应用标识，映射到租户 schema（由运营方配置） |

**成功响应**（HTTP 200）

```json
{
  "access_token": "usr_xK9mN2pQ...",
  "token_type": "Bearer",
  "expires_in": 900,
  "schema": "school"
}
```

| 字段 | 说明 |
|------|------|
| `access_token` | 不透明 Session 令牌（前缀 `usr_`），后续请求放在 `Authorization: Bearer` |
| `token_type` | 固定为 `Bearer` |
| `expires_in` | 空闲过期时间（秒），默认 900；每次受保护请求成功会**滑动续期** |
| `schema` | 本次登录绑定的租户 schema，后续 API 自动使用 |

**Session 记录内容（服务端，非响应字段）**

| 字段 | 说明 |
|------|------|
| `sub` | 用户主体标识（来自租户库） |
| `roles` | 角色数组，用于数据权限与动作授权 |
| `schema` | 登录租户 schema |

**登录错误**

| HTTP | code | 说明 |
|------|------|------|
| 400 | 40001 | JSON 格式错误 |
| 400 | 40002 | 缺少 username / password / appid |
| 401 | 40101 | 用户名或密码错误 |
| 500 | 50001 | 服务内部错误 |
| 500 | 50002 | Session 创建失败 |
| 503 | 50301 | 登录功能未配置（需 `CRVSVC_AUTH_MODE=session` 且 `CRVSVC_REDIS_ADDR`） |

> 登录接口响应格式与下文 [§4](#4-通用响应格式) 的 `Envelope` **不同**，请注意解析方式。

### 3.2 Session 生命周期

- **校验**：受保护接口校验 `Authorization: Bearer` 中的 `usr_...` 或 `int_...` 令牌是否在 Redis 中存在。
- **滑动过期**：用户 Session（`usr_`）在每次成功请求后刷新空闲 TTL（`CRVSVC_LOGIN_TOKEN_TTL_SEC`）。客户端本地记录的 `expires_in` 仅供参考，以服务端 Redis 状态为准。
- **失效场景**：超过空闲时间未请求、Redis 数据被清理、服务重启且 Session 未持久化等，均视为失效。
- **集成令牌**（`int_...`）：长期 API 令牌，无滑动过期；通过 `POST /v1/integration/tokens` 签发（需管理员 Session），见 [§6.8](#68-集成令牌签发与吊销)。

**受保护接口认证失败**（HTTP 401，`code=40101`）常见 `message`：

| message | 说明 |
|---------|------|
| `missing or invalid authorization header` | 未提供 Bearer |
| `invalid session token` | 令牌格式不是 `usr_` / `int_` |
| `session expired or revoked` | Redis 中无对应 Session |

客户端应清除本地令牌并重新调用 `/v1/auth/login`。

---

## 4. 通用响应格式

除登录接口外，业务 API 使用统一 **Envelope**：

**成功**（HTTP 200）

```json
{
  "code": 0,
  "message": "ok",
  "data": { }
}
```

**失败**

```json
{
  "code": 40001,
  "message": "错误描述"
}
```

失败时通常无 `data` 字段。HTTP 状态码与 `code` 组合判断错误类型，见 [§11](#11-错误处理)。

---

## 5. API 列表

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| GET | `/healthz` | 否 | 健康检查 |
| POST | `/v1/auth/login` | 否 | 登录获取 Session 令牌 |
| GET | `/v1/meta/models` | 是* | 模型元数据列表 |
| POST | `/v1/data/query` | 是* | 结构化数据查询 |
| POST | `/v1/data/save` | 是* | 事务保存（增删改，含虚拟字段） |
| POST | `/v1/files/upload` | 是* | 附件上传至 OSS（供 file 虚拟字段） |
| GET | `/v1/files/download` | 是* | 按 attach 行下载附件（可选图片缩略） |
| GET | `/v1/operations` | 是* | 可执行动作列表 |
| POST | `/v1/operations/execute` | 是* | 执行动作 |
| POST | `/v1/integration/tokens` | 是† | 签发 / 吊销 `int_` 集成 API 令牌 |

\* `session` 模式下需要 `Authorization: Bearer`（`usr_` / `int_`）；`disabled` 模式下可选。

† 仅 `session` 模式可用；调用方 Session 须含 `CRVSVC_INTEGRATION_TOKEN_ADMIN_ROLES` 中的角色（默认 `admin`）。

---

## 6. 接口详情

### 6.1 健康检查

```http
GET {base_url}/healthz
```

**响应 `data` 示例**

```json
{
  "status": "up",
  "dbAlive": true,
  "dbError": ""
}
```

| 字段 | 说明 |
|------|------|
| `status` | 进程状态，固定 `up` |
| `dbAlive` | 数据库是否可达 |
| `dbError` | 数据库异常时的错误信息，正常为空字符串 |

---

### 6.2 模型元数据

```http
GET {base_url}/v1/meta/models
Authorization: Bearer <token>
```

`session` 模式：租户取自登录 Session，**无需** `?schema=` 或 `X-Schema`。

`disabled` 模式：使用 `?schema=school` 或请求头 `X-Schema: school`。

**响应 `data` 示例**

```json
{
  "schema": "school",
  "count": 2,
  "models": [
    {
      "model": "core_user",
      "file": "core_user/model.json",
      "definition": {
        "model": "core_user",
        "table": "core_user"
      }
    }
  ]
}
```

| 字段 | 说明 |
|------|------|
| `schema` | 请求的租户 schema |
| `count` | 模型数量 |
| `models[].model` | 模型 ID，查询时用作 `modelId` |
| `models[].file` | 配置文件相对路径 |
| `models[].definition` | 完整模型 JSON 定义 |

**错误**

| HTTP | code | 常见原因 |
|------|------|----------|
| 400 | 40001 | 未提供 schema |
| 401 | 40101 | 未认证或 Session 无效/过期 |
| 403 | 40301 | 租户 schema 与 Session 不一致，或数据权限拒绝 |
| 500 | 50001 | schema 目录不存在或读取失败 |

---

### 6.3 数据查询

```http
POST {base_url}/v1/data/query
Content-Type: application/json
Authorization: Bearer <token>
```

`session` 模式：可省略 `X-Schema` / `appDb`（使用登录绑定的 schema）。

`disabled` 模式示例（须指定租户）：

```http
X-Schema: school
```

**请求 Body**

```json
{
  "modelId": "core_user",
  "fields": [
    { "field": "id" },
    { "field": "user_name_zh" }
  ],
  "filter": {
    "id": { "Op.eq": "1001" }
  },
  "sorter": [
    { "field": "id", "order": "asc" }
  ],
  "pagination": {
    "current": 1,
    "pageSize": 20
  },
  "distinct": false,
  "withSummarize": true
}
```

**字段说明**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `appDb` | string | 条件 | 租户 schema；`session` 模式可省略；`disabled` 模式省略时须设置 `X-Schema` |
| `modelId` | string | 是 | 模型标识 |
| `fields` | array | 是 | 查询字段列表，**不能为空**；每项含 `field` |
| `filter` | object | 否 | 过滤条件，语法见 [§7](#7-数据查询过滤与排序) |
| `sorter` | array | 否 | 排序，`order` 为 `asc` 或 `desc` |
| `pagination` | object | 否 | `current` 从 1 开始；`pageSize` 每页条数 |
| `distinct` | boolean | 否 | 是否 DISTINCT，默认 false |
| `withSummarize` | boolean | 否 | 是否返回汇总；也可用 URL 参数 `?summarize=0` 关闭 |
| `roles` | array | 否 | 仅 `disabled` 模式补充角色；**session 模式以 Session 中的 roles 为准** |

**`fields` 项扩展字段（可选）**

| 字段 | 说明 |
|------|------|
| `dataType` | 数据类型提示 |
| `fieldType` | 虚拟字段类型：`file`、`one2many`、`many2many` 等 |
| `relatedModelId` / `relatedField` | 关联模型与外键（one2many） |
| `associationModelId` | 多对多中间表（many2many） |
| `filter` / `fields` / `sorter` / `pagination` | 嵌套关联查询 |

查询侧须在 `fields[]` 中完整声明虚拟字段元数据；保存侧则在行内对象中声明，见 [§6.6](#66-虚拟字段保存)。

**响应 `data` 示例**

```json
{
  "modelId": "core_user",
  "total": 128,
  "list": [
    {
      "id": "1001",
      "user_name_zh": "张三"
    }
  ],
  "summaries": {}
}
```

| 字段 | 说明 |
|------|------|
| `modelId` | 查询的模型 |
| `total` | 符合条件的总记录数 |
| `list` | 当前页数据行 |
| `summaries` | 汇总结果（启用时） |
| `value` | 标量查询时的单值（部分场景） |

**错误**

| HTTP | code | 常见原因 |
|------|------|----------|
| 400 | 40001 | JSON 非法、缺少 `appDb`/`modelId`/`fields` |
| 401 | 40101 | 未认证 |
| 403 | 40301 | 数据权限拒绝（datasets 无匹配角色） |
| 502 | 50002 | SQL 执行失败 |

查询超时：单次请求最长 **60 秒**。

---

### 6.4 数据保存

在同一事务内对单个模型执行新增、修改、删除。`list` 中每条记录通过 `_save_type` 标明操作类型。

```http
POST {base_url}/v1/data/save
Content-Type: application/json
Authorization: Bearer <token>
```

`session` 模式：可省略 `X-Schema` / `appDb`。

`disabled` 模式示例：

```http
X-Schema: school
```

**请求 Body**

```json
{
  "modelId": "t_order_item",
  "list": [
    {
      "_save_type": "create",
      "order_id": 100,
      "sku": "ABC",
      "qty": 2
    },
    {
      "_save_type": "update",
      "id": 1,
      "version": 0,
      "qty": 5
    },
    {
      "_save_type": "delete",
      "id": 9,
      "version": 1
    }
  ]
}
```

**字段说明**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `appDb` | string | 条件 | 租户 schema；`session` 模式可省略；`disabled` 模式省略时须设置 `X-Schema` |
| `modelId` | string | 是 | 模型标识，对应物理表名 |
| `list` | array | 是 | 变更行列表，**不能为空** |
| `roles` | array | 否 | 仅 `disabled` 模式补充角色；**session 模式以 Session 中的 roles 为准** |

**`list` 每项约定**

| `_save_type` | 说明 |
|--------------|------|
| `create` | 新增。除 `_save_type` 外的键值对作为 INSERT 列；**无需**传 `version`，由数据库默认（通常为 0） |
| `update` | 修改。必须包含 `id`、`version` 及要更新的列 |
| `delete` | 删除。必须包含 `id`、`version` |

**固定列约定**

| 列 | 说明 |
|----|------|
| `id` | 主键。`update` / `delete` 必填 |
| `version` | 乐观锁版本号。`create` **无需传入**，由数据库默认（通常为 0）；`update` / `delete` **必填**，须为当前库中值；UPDATE 成功时服务端自动 `version = version + 1` |

`list` 中行内字段名直接作为 SQL 列名（与查询接口 `fields[].field` 命名一致）。服务端自动维护审计列（请求体传入的同名字段会被忽略）：

| 操作 | 自动填充 |
|------|----------|
| `create` | `create_time`、`create_user`、`update_time`、`update_user`（`version` 由库默认） |
| `update` | `update_time`、`update_user`、`version`（`version+1`） |

`create_user` / `update_user` 取自 Session 的 `sub`；`disabled` 模式下可取请求头 `X-User`。

**乐观锁使用建议**

1. `create` 成功后，通过 `POST /v1/data/query` 查询新记录，读取当前 `version`（新建记录一般为 0）
2. `update` / `delete` 时携带查询到的 `id` 与 `version`
3. 若返回 HTTP **409**、`code=40901`，表示记录已被他人修改，应重新查询后再提交

> 主键为自增整型的表，`create` 可从响应 `lastInsertId` / `generatedKeys` 获取 `id`；主键由业务指定的表（如字符串 `id`）须在 `create` 行中自行传入 `id`。

**响应 `data` 示例**

```json
{
  "modelId": "t_order_item",
  "inserted": 1,
  "updated": 1,
  "deleted": 1,
  "lastInsertId": 42,
  "generatedKeys": [
    { "id": 42 }
  ]
}
```

| 字段 | 说明 |
|------|------|
| `modelId` | 保存的模型 |
| `inserted` | 成功新增行数 |
| `updated` | 成功修改行数 |
| `deleted` | 成功删除行数 |
| `lastInsertId` | 最后一次 `create` 的自增主键（如有） |
| `generatedKeys` | 各次 `create` 生成的主键列表 |

**错误**

| HTTP | code | 常见原因 |
|------|------|----------|
| 400 | 40001 | JSON 非法、缺少 `appDb`/`modelId`/`list`、行缺少 `_save_type` 或必填列 |
| 401 | 40101 | 未认证 |
| 403 | 40301 | 写权限拒绝（datasets 无匹配 `mutationRoles`） |
| 409 | 40901 | 乐观锁冲突（`id` + `version` 与库中不一致，或记录已被删除） |
| 502 | 50002 | SQL 执行失败 |

保存超时：单次请求最长 **60 秒**。`list` 中所有操作在同一数据库事务内执行，任一行失败则整体回滚。

**虚拟字段**（附件 `file`、子表 `one2many`、多对多 `many2many`）的保存格式见 [§6.6](#66-虚拟字段保存)。附件需先调用 [§6.5](#65-文件上传) 上传至 OSS。

---

### 6.5 文件上传

将附件上传至对象存储（OSS），返回 `path` 等信息，供保存时 `file` 虚拟字段引用。服务端在 OSS 未配置时返回 **503**。

```http
POST {base_url}/v1/files/upload
Content-Type: multipart/form-data
Authorization: Bearer <token>
```

`session` 模式：可省略 `X-Schema` / `appDb`。

`disabled` 模式示例：

```http
X-Schema: amis
```

**表单字段**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `file` | file | 是 | 上传的二进制文件 |
| `appDb` | string | 条件 | 租户 schema；`session` 模式可省略；`disabled` 模式省略时须设置 `X-Schema` |

**请求头**

| 头 | 说明 |
|----|------|
| `Authorization: Bearer <token>` | 受保护接口（`session` 模式必填） |
| `X-Schema` | 仅 `disabled` 模式指定租户（与 `appDb` 二选一或一致） |
| `X-User` | 仅 `disabled` 模式；上传路径中的用户标识，默认 `anonymous` |

`session` 模式下上传路径中的用户标识取自 Session **`sub`**，忽略 `X-User`。

**OSS 对象键规则**

```text
{appDb}/pending/{userId}/{random32hex}{ext}
```

示例：`amis/pending/alice/a1b2c3....pdf`

**成功响应 `data` 示例**

```json
{
  "path": "amis/pending/alice/a1b2c3d4e5f6789012345678abcdef01.pdf",
  "name": "report.pdf",
  "ext": ".pdf",
  "size": 12345,
  "contentType": "application/pdf",
  "etag": "\"abc123\""
}
```

| 字段 | 说明 |
|------|------|
| `path` | OSS 对象键；保存 `file` 字段时写入 attach 行的 `path` |
| `name` | 原始文件名 |
| `ext` | 扩展名（含 `.`） |
| `size` | 字节数 |
| `contentType` | MIME 类型（可选） |
| `etag` | OSS ETag（可选） |

**限制**

- 单文件默认最大 **32 MiB**；运营方可通过环境变量 `CRVSVC_UPLOAD_MAX_BYTES` 调整
- 上传超时：单次请求最长 **120 秒**

**错误**

| HTTP | code | 常见原因 |
|------|------|----------|
| 400 | 40001 | 缺少 `appDb`/`X-Schema`、未传 `file`、文件为空或超限 |
| 401 | 40101 | 未认证 |
| 502 | 50002 | OSS 写入失败 |
| 503 | 50003 | OSS 未配置（`CRVSVC_OSS_*` 不完整） |

> OSS 由运营方配置；接入方通常只需使用返回的 `path`，无需直接访问 OSS API。

---

### 6.6 虚拟字段保存

除普通列外，`list` 每行可携带 **虚拟字段** 对象，在同一事务内处理附件、子表或多对多关联。

**与查询的区别**

| 场景 | 元数据来源 |
|------|------------|
| 查询 `POST /v1/data/query` | 请求体 `fields[]` 中声明 `fieldType`、`relatedModelId` 等 |
| 保存 `POST /v1/data/save` | **行内**虚拟字段对象自带 `fieldType`、`relatedModelId` 等（不读 `model.json`） |

虚拟字段对象通用结构：

```json
{
  "fieldType": "file | one2many | many2many",
  "relatedModelId": "关联表名（file 为可选 attach 表名）",
  "list": [ /* 子操作列表，每项含 _save_type */ ]
}
```

`list` 也可写成 `{ "list": [...] }` 嵌套形式；每项须含 `_save_type`：`create` / `update` / `delete`。

#### 主行级联删除（重要）

主行 `_save_type: "delete"` **不会**自动扫描库表清理关联数据。须在**同一行**上显式带上要清理的虚拟字段对象，服务端才会在删除主行之前处理关联表 / 附件。

| 虚拟字段类型 | 主行 delete 是否必须带该字段 | `list` 可否为空 | 服务端行为 |
|--------------|------------------------------|-----------------|------------|
| `file` | 是（否则 attach 行与 OSS 对象残留） | 可为 `[]` | 按主行 `id` 删除 attach 表中 `row_id` 匹配的行，并删除对应 OSS 对象 |
| `one2many` | 是（否则子表行残留） | 可为 `[]` | 按 `relatedField = 主行 id` 查出子行并**递归**删除子树，再删主行 |
| `many2many` | 是（否则中间表关联残留） | 可为 `[]` | 删除中间表中本端外键 = 主行 id 的全部关联（**不删**对端表记录） |

主行本身仍须提供 `id`、`version`。执行顺序：先清理虚拟字段关联 → 再删除主行；OSS 删除在数据库事务成功之后执行（失败仅记日志）。

未出现在请求中的虚拟关联**不会**被清理。若主行同时有附件、子表、多对多，须在 delete 行上**同时带上**所有需要清理的虚拟字段（见 [§6.6.5](#665-主行级联删除综合示例)）。

#### 6.6.1 file（附件）

默认写入 `{modelId}_attach` 表；可通过 `relatedModelId` 指定自定义 attach 表名。

attach 表列（由服务端自动填充 `model_id`、`field_id`、`row_id`）：

| 列 | 说明 |
|----|------|
| `path` | OSS 对象键（**create 必填**） |
| `name` | 显示文件名 |
| `ext` | 扩展名 |
| `id` / `version` | update / delete 时必填（乐观锁） |

**create 主行 + 新增附件示例**

```json
{
  "modelId": "student",
  "list": [
    {
      "_save_type": "create",
      "id": "stu001",
      "name": "张三",
      "avatar": {
        "fieldType": "file",
        "list": [
          {
            "_save_type": "create",
            "path": "amis/pending/alice/a1b2....jpg",
            "name": "photo.jpg",
            "ext": ".jpg"
          }
        ]
      }
    }
  ]
}
```

`path` 通常来自 [§6.5](#65-文件上传) 的响应。`create` 主行须已有 `id`（或自增主键由库生成后再 update 附件）。

**单独删除某条附件**（主行一般为 `update`）：在 file 字段的 `list` 中传 `_save_type: "delete"` 及 attach 行 `id`、`version`（或 `path`）。删除成功后，服务端会从 OSS 移除对应对象（失败仅记日志，不影响 save 响应）。

```json
{
  "_save_type": "update",
  "id": "stu001",
  "version": 0,
  "avatar": {
    "fieldType": "file",
    "list": [
      { "_save_type": "delete", "id": 42, "version": 0 }
    ]
  }
}
```

**delete 主行并级联清理附件**：主行 `_save_type: "delete"` 时，须带上该 file 虚拟字段（`list` 可为 `[]`）。服务端按主行 `id` 删除对应 attach 表全部行，并清理 OSS。自定义 attach 表时须声明 `relatedModelId`。

```json
{
  "modelId": "student",
  "list": [
    {
      "_save_type": "delete",
      "id": "stu001",
      "version": 0,
      "avatar": {
        "fieldType": "file",
        "list": []
      }
    }
  ]
}
```

若同一主表有多个 file 字段（或使用了非默认 attach 表），delete 主行时建议为每个需要清理的 file 字段都带上虚拟字段对象；请求中出现的 attach 表名（含默认 `{modelId}_attach`）才会被清理。

#### 6.6.2 one2many（一对多子表）

| 字段 | 必填 | 说明 |
|------|------|------|
| `fieldType` | 是 | 固定 `"one2many"` |
| `relatedModelId` | 是 | 子表名（物理表） |
| `relatedField` | 是 | 子表上的外键列名，指向主表 |
| `list` | 否 | 子行操作列表；支持**嵌套** one2many |

- **create 子行**：服务端自动将 `relatedField` 设为主表 `id`；子行可嵌套更多 one2many
- **update / delete 子行**：子行自带 `id`、`version` 及 `_save_type`
- **delete 主行并级联子行**：主行 `_save_type: "delete"` 时，须同时带上该 one2many 虚拟字段（`list` 可为 `[]`），以触发子树递归删除。`list` 中也可先放若干显式 `_save_type: "delete"` 的子行，之后服务端仍会按外键递归清理剩余子行

**position 自引用示例子树 create**

```json
{
  "modelId": "position",
  "list": [
    {
      "_save_type": "create",
      "id": "pos_root",
      "name": "总部",
      "subpositions": {
        "fieldType": "one2many",
        "relatedModelId": "position",
        "relatedField": "parent_position",
        "list": [
          {
            "_save_type": "create",
            "id": "pos_child",
            "name": "分部",
            "subpositions": {
              "fieldType": "one2many",
              "relatedModelId": "position",
              "relatedField": "parent_position",
              "list": [
                { "_save_type": "create", "id": "pos_grand", "name": "门店" }
              ]
            }
          }
        ]
      }
    }
  ]
}
```

**级联 delete 主行**

```json
{
  "modelId": "position",
  "list": [
    {
      "_save_type": "delete",
      "id": "pos_root",
      "version": 0,
      "subpositions": {
        "fieldType": "one2many",
        "relatedModelId": "position",
        "relatedField": "parent_position",
        "list": []
      }
    }
  ]
}
```

#### 6.6.3 many2many（多对多）

| 字段 | 必填 | 说明 |
|------|------|------|
| `fieldType` | 是 | 固定 `"many2many"` |
| `relatedModelId` | 是 | 关联端表名 |
| `associationModelId` | 否 | 中间表名；省略时按 `{主表}_{关联表}` 规则推导 |
| `list` | 否 | 关联操作列表 |

中间表外键列命名：`{主表}_id`、`{关联表}_id`（如 `core_user_id`、`core_role_id`）。

- **create 关联**：`list` 项 `_save_type: "create"`，`id` 为关联端记录主键（或显式传 `{relatedModelId}_id`）
- **delete 关联**：`_save_type: "delete"` + 关联端 `id`；若带中间表 `id` + `version` 则按中间表主键删除
- **delete 主行并清理关联**：主行 delete 时须带上 many2many 虚拟字段（`list` 可为 `[]`）。服务端删除该主行在中间表上的**全部**关联行，不删除对端表（如 `core_role`）中的记录

**core_user 关联角色 create 示例**

```json
{
  "modelId": "core_user",
  "list": [
    {
      "_save_type": "create",
      "id": "u_test",
      "user_name_zh": "测试用户",
      "user_roles": {
        "fieldType": "many2many",
        "relatedModelId": "core_role",
        "associationModelId": "core_role_core_user",
        "list": [
          { "_save_type": "create", "id": "admin" },
          { "_save_type": "create", "id": "reader" }
        ]
      }
    }
  ]
}
```

**update 时解除一条关联**

```json
{
  "_save_type": "update",
  "id": "u_test",
  "version": 0,
  "user_roles": {
    "fieldType": "many2many",
    "relatedModelId": "core_role",
    "associationModelId": "core_role_core_user",
    "list": [
      { "_save_type": "delete", "id": "reader" }
    ]
  }
}
```

**级联 delete 主行（清理全部中间表关联）**

```json
{
  "modelId": "core_user",
  "list": [
    {
      "_save_type": "delete",
      "id": "u_test",
      "version": 0,
      "user_roles": {
        "fieldType": "many2many",
        "relatedModelId": "core_role",
        "associationModelId": "core_role_core_user",
        "list": []
      }
    }
  ]
}
```

#### 6.6.4 命名约定

- 保存侧关联表字段统一使用 **`relatedModelId`**（不支持 `modelID` / `modelId` 别名）
- `one2many` 须使用 **`relatedField`** 声明外键列名
- `many2many` 可选 **`associationModelId`** 覆盖默认中间表名

#### 6.6.5 主行级联删除综合示例

当主行同时存在附件、一对多、多对多时，delete 请求须一并声明需要清理的虚拟字段，例如：

```json
{
  "modelId": "student",
  "list": [
    {
      "_save_type": "delete",
      "id": "stu001",
      "version": 0,
      "avatar": {
        "fieldType": "file",
        "list": []
      },
      "orders": {
        "fieldType": "one2many",
        "relatedModelId": "t_order",
        "relatedField": "student_id",
        "list": []
      },
      "tags": {
        "fieldType": "many2many",
        "relatedModelId": "tag",
        "associationModelId": "student_tag",
        "list": []
      }
    }
  ]
}
```

**反例（错误用法）**：仅传主行 `id` / `version` 而不带虚拟字段——只会删除主表行，子表、中间表、attach 与 OSS 均不会自动清理。

```json
{
  "_save_type": "delete",
  "id": "stu001",
  "version": 0
}
```

---

### 6.7 文件下载

按主表行权限校验后，定位 attach 行并从 OSS 流式返回文件。需先通过 [§6.3](#63-数据查询) 取得 attach 行的 `id`（及主行 `id`、字段名）。

```http
GET {base_url}/v1/files/download?modelId=student&rowId=stu001&fieldId=avatar&attachId=42&maxWidth=800
Authorization: Bearer <token>
```

`session` 模式：可省略 `X-Schema` / `appDb`。

`disabled` 模式示例：

```http
X-Schema: amis
```

**Query 参数**

| 参数 | 必填 | 说明 |
|------|------|------|
| `modelId` | 是 | 主表名 |
| `rowId` | 是 | 主表行 `id` |
| `fieldId` | 是 | file 虚拟字段名（attach 的 `field_id`） |
| `attachId` | 是 | attach 表主键 |
| `appDb` | 条件 | 租户 schema；`session` 模式可省略；`disabled` 模式省略时须设置 `X-Schema` |
| `relatedModelId` | 否 | 自定义 attach 表；默认 `{modelId}_attach` |
| `maxWidth` | 否 | 图片最大宽度（等比缩放）；非图片忽略 |

**权限**

1. `session` 模式下按主表 `datasets.json` 的 **queryRoles** 与行级 **Filter** 校验 `rowId` 是否可读（与 query 一致）
2. 再查 attach：`id` + `model_id` + `field_id` + `row_id` 四维匹配

**成功响应**：HTTP 200 文件流（非 JSON Envelope），含 `Content-Type`、`Content-Disposition`。

**错误**

| HTTP | code | 常见原因 |
|------|------|----------|
| 400 | 40001 | 缺少参数、`maxWidth` 非法 |
| 403 | 40301 | 主表行无读权限 |
| 404 | 40401 | attach 行不存在或不匹配 |
| 502 | 50002 | OSS 读取失败 |
| 503 | 50003 | OSS 未配置 |

---

### 6.8 集成令牌签发与吊销

为外部系统预签发长期有效的 **`int_...`** 集成 API 令牌（无空闲过期，仅可主动吊销）。仅 **`session` 模式**可用；调用方须已登录且 Session 角色包含管理员角色（默认 `admin`，可通过 `CRVSVC_INTEGRATION_TOKEN_ADMIN_ROLES` 配置）。

只能为**与当前 Session 相同租户 schema** 签发或吊销令牌。

```http
POST {base_url}/v1/integration/tokens
Content-Type: application/json
Authorization: Bearer <usr_ admin session>
```

#### 签发（`action: issue`）

**Body**

```json
{
  "action": "issue",
  "sub": "billing-svc",
  "roles": ["reader"],
  "clientId": "billing"
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `action` | string | 是 | 固定 `issue` |
| `sub` | string | 是 | 集成调用方主体标识（写入审计字段） |
| `schema` | string | 否 | 租户 schema；省略时使用当前 Session 的 schema |
| `roles` | array | 否 | 数据权限与动作授权角色列表 |
| `clientId` | string | 否 | 调用方标识（便于运营追踪） |

**成功响应 `data` 示例**

```json
{
  "action": "issue",
  "access_token": "int_xK9mN2pQ...",
  "token_type": "Bearer",
  "expires_in": 0,
  "sessionId": "uuid",
  "schema": "school",
  "sub": "billing-svc",
  "roles": ["reader"],
  "clientId": "billing"
}
```

> `access_token` 明文**仅返回一次**，请妥善保存；之后服务端 Redis 只存哈希。

#### 吊销（`action: revoke`）

**Body**

```json
{
  "action": "revoke",
  "access_token": "int_xK9mN2pQ..."
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `action` | string | 是 | 固定 `revoke` |
| `access_token` | string | 是 | 要吊销的 `int_` 令牌 |

**成功响应 `data` 示例**

```json
{
  "action": "revoke",
  "sessionId": "uuid",
  "revoked": true
}
```

**错误**

| HTTP | code | 常见原因 |
|------|------|----------|
| 400 | 40001 | JSON 非法、缺少字段、`action` 无效、尝试吊销 `usr_` 令牌 |
| 401 | 40101 | 未认证 |
| 403 | 40301 | 非管理员角色，或 schema 与 Session 不一致 |
| 404 | 40401 | 集成令牌不存在 |
| 503 | 50003 | 非 `session` 模式或 Redis 未配置 |

---

## 7. 数据查询：过滤与排序

### 7.1 过滤（filter）

过滤条件为 JSON 对象。字段名对应模型列名，值为操作符对象。

**常用操作符**

| 操作符 | 含义 | 示例 |
|--------|------|------|
| `Op.eq` | 等于 | `{ "status": { "Op.eq": 1 } }` |
| `Op.ne` | 不等于 | `{ "status": { "Op.ne": 0 } }` |
| `Op.gt` | 大于 | `{ "age": { "Op.gt": 18 } }` |
| `Op.gte` | 大于等于 | `{ "age": { "Op.gte": 18 } }` |
| `Op.lt` | 小于 | `{ "age": { "Op.lt": 60 } }` |
| `Op.lte` | 小于等于 | `{ "age": { "Op.lte": 60 } }` |
| `Op.in` | 在列表中 | `{ "id": { "Op.in": ["1", "2", "3"] } }` |
| `Op.notIn` | 不在列表中 | `{ "id": { "Op.notIn": ["9"] } }` |
| `Op.like` | 模糊匹配 | `{ "name": { "Op.like": "%张%" } }` |
| `Op.is` | IS NULL | `{ "deleted_at": { "Op.is": null } }` |
| `Op.between` | 区间 | `{ "age": { "Op.between": [18, 60] } }` |

**逻辑组合**

```json
{
  "Op.and": [
    { "status": { "Op.eq": 1 } },
    { "name": { "Op.like": "%李%" } }
  ]
}
```

```json
{
  "Op.or": [
    { "role": { "Op.eq": "admin" } },
    { "role": { "Op.eq": "teacher" } }
  ]
}
```

### 7.2 排序（sorter）

```json
"sorter": [
  { "field": "created_at", "order": "desc" },
  { "field": "id", "order": "asc" }
]
```

### 7.3 分页（pagination）

```json
"pagination": {
  "current": 1,
  "pageSize": 20
}
```

- `current`：页码，从 **1** 开始
- `pageSize`：每页记录数

---

## 8. 数据权限

当模型配置了 `apps/{schema}/{modelId}/datasets.json` 时，服务端自动应用数据权限。查询与保存均要求该文件存在。

### 8.1 查询权限（`POST /v1/data/query`）

1. 从 Session（或 `disabled` 模式下的 `X-Roles`）读取调用方 **roles**
2. 模型须存在 `datasets.json`；否则 → HTTP **403**，`code=40301`
3. 在 `datasets.json` 中匹配 `queryRoles`（支持 `"*"` 或逗号分隔多角色）
4. 多条匹配规则做**并集**（行条件 OR，可见列并集）
5. 与客户端 `filter` **逻辑 AND** 后执行 SQL
6. 无匹配角色 → HTTP **403**，`code=40301`

### 8.2 保存权限（`POST /v1/data/save`）

1. 从 Session（或 `disabled` 模式下的 `X-Roles`）读取调用方 **roles**
2. 模型须存在 `datasets.json`；否则 → HTTP **403**，`code=40301`
3. 在 `datasets.json` 中匹配 `mutationRoles`（语法与 `queryRoles` 相同，支持 `"*"` 或逗号分隔多角色）；未配置 `mutationRoles` 的条目不授予写权限
4. 至少一条 dataset 的 `mutationRoles` 匹配方可保存；否则 → HTTP **403**，`code=40301`
5. **update/delete 行级控制**（create 不校验；Filter 合并规则与查询相同）：
   - 仅**非空** `Filter` 的匹配条目参与 **OR** 合并；`Filter` 为空的条目不贡献行条件
   - 若所有匹配条目均无 `Filter` → 不做行级限制
   - 合并后附加到 update/delete 的 WHERE（与 `id`、`version` 逻辑 AND）
   - Filter 语法、变量（如 `%{CURRENT_USER_ID}`）、`FilterData` 与查询权限相同

查询与保存均须在 `session` 模式下提供有效 Session 令牌；无 `datasets.json` 时一律返回 **403**。

---

## 9. 动作（Operation）接口

动作接口用于获取/执行运营方预配置的 UI 或流程动作（如嵌入页面）。纯数据对接可跳过本节。

### 9.1 列出可执行动作

```http
GET {base_url}/v1/operations
Authorization: Bearer <token>
```

`session` 模式：可省略 `X-Schema`。

`disabled` 模式示例：

```http
X-Schema: school
```

**响应 `data` 示例**

```json
{
  "schema": "school",
  "count": 1,
  "operations": [
    {
      "id": "open_url",
      "title": "打开页面",
      "description": "在聊天消息区域内嵌打开指定 URL",
      "tags": ["页面", "嵌入", "URL"],
      "type": "embed"
    }
  ]
}
```

列表**不包含** `params` 与 `executeRoles`，仅返回调用方有权看到的元数据。

### 9.2 执行动作

```http
POST {base_url}/v1/operations/execute
Content-Type: application/json
Authorization: Bearer <token>
```

`session` 模式：可省略 `X-Schema`。

`disabled` 模式示例：

```http
X-Schema: school
```

**Body**

```json
{
  "id": "open_url",
  "params": {
    "url": "https://example.com/page"
  }
}
```

| 字段 | 必填 | 说明 |
|------|------|------|
| `id` | 是 | 动作 ID，须为配置中存在的值 |
| `params` | 否 | 运行时参数，与配置文件 `params` 合并（请求覆盖同名键） |

**响应 `data` 示例**

```json
{
  "schema": "school",
  "id": "open_url",
  "operation": {
    "id": "open_url",
    "type": "embed",
    "params": {
      "url": "https://example.com/page",
      "height": "400px",
      "width": "100%"
    }
  }
}
```

**服务端当前支持的动作类型**

| type | 说明 |
|------|------|
| `embed` | 嵌入页面；`params.url` 必填，须为 `http://` 或 `https://` 完整 URL |

**错误**

| HTTP | code | 说明 |
|------|------|------|
| 400 | 40001 | 缺少 `id` 或参数校验失败（`disabled` 模式另可能因缺少 `X-Schema`） |
| 403 | 40301 | 角色无 `executeRoles` 权限 |
| 404 | 40401 | 动作不存在 |

---

## 10. 接入流程与示例

### 10.1 推荐流程

```text
1. GET  /healthz              → 确认服务与数据库可用
2. POST /v1/auth/login        → 获取 access_token（usr_...）与 schema
3. GET  /v1/meta/models       → 确认 modelId 与字段
4. POST /v1/data/query        → 执行业务查询
5. POST /v1/files/upload      → （可选）上传附件，取得 path
6. POST /v1/data/save         → 事务保存（含虚拟字段与附件引用）
7. Session 空闲过期或服务端 Session 失效后重新登录
```

**带附件的保存流程**

```text
upload(file) → 得到 path/name/ext
save(create/update) → file 虚拟字段 list 中引用 path
save(delete 附件)   → 单条附件 delete，或主行 delete 时带 file 虚拟字段级联清理 attach + OSS
save(delete 主行)   → 须显式带上 file / one2many / many2many 虚拟字段才会级联清理（见 §6.6）
```

### 10.2 cURL 示例

**登录**

```bash
curl -s -X POST "{base_url}/v1/auth/login" \
  -H "Content-Type: application/json" \
  -d '{
    "username": "demo_user",
    "password": "your_password",
    "appid": "school"
  }'
```

**查询（session 模式，租户已绑定）**

```bash
curl -s -X POST "{base_url}/v1/data/query" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -d '{
    "modelId": "core_user",
    "fields": [
      {"field": "id"},
      {"field": "user_name_zh"}
    ],
    "pagination": {"current": 1, "pageSize": 10}
  }'
```

**查询（disabled 模式，使用 X-Schema）**

```bash
curl -s -X POST "{base_url}/v1/data/query" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "X-Schema: school" \
  -d '{
    "modelId": "core_user",
    "fields": [{"field": "id"}, {"field": "user_name_zh"}],
    "filter": {"id": {"Op.eq": "1001"}},
    "pagination": {"current": 1, "pageSize": 10}
  }'
```

**事务保存（session 模式）**

```bash
curl -s -X POST "{base_url}/v1/data/save" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -d '{
    "modelId": "t_order_item",
    "list": [
      {"_save_type": "create", "order_id": 100, "sku": "ABC", "qty": 2},
      {"_save_type": "update", "id": 1, "version": 0, "qty": 5},
      {"_save_type": "delete", "id": 9, "version": 1}
    ]
  }'
```

**文件上传（session 模式）**

```bash
curl -s -X POST "{base_url}/v1/files/upload" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -F "file=@./report.pdf"
```

**保存附件（先 upload 再 save，session 模式）**

```bash
# 1. 上传
UPLOAD=$(curl -s -X POST "{base_url}/v1/files/upload" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -F "file=@./photo.jpg")
PATH=$(echo "$UPLOAD" | jq -r '.data.path')
NAME=$(echo "$UPLOAD" | jq -r '.data.name')
EXT=$(echo "$UPLOAD" | jq -r '.data.ext')

# 2. 保存主行并关联附件
curl -s -X POST "{base_url}/v1/data/save" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -d "{
    \"modelId\": \"student\",
    \"list\": [{
      \"_save_type\": \"create\",
      \"id\": \"stu001\",
      \"name\": \"张三\",
      \"avatar\": {
        \"fieldType\": \"file\",
        \"list\": [{
          \"_save_type\": \"create\",
          \"path\": \"$PATH\",
          \"name\": \"$NAME\",
          \"ext\": \"$EXT\"
        }]
      }
    }]
  }"
```

### 10.3 JavaScript（fetch）示例

```javascript
const baseUrl = 'http://127.0.0.1:8080'

async function login(username, password, appid) {
  const res = await fetch(`${baseUrl}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, appid }),
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

async function query(token, body, schema) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }
  // disabled 模式才需要 X-Schema
  if (schema) headers['X-Schema'] = schema
  const res = await fetch(`${baseUrl}/v1/data/query`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  const json = await res.json()
  if (json.code !== 0) throw new Error(json.message)
  return json.data
}

// 使用（session 模式）
const { access_token, schema } = await login('user', 'pass', 'school')
const result = await query(access_token, {
  modelId: 'core_user',
  fields: [{ field: 'id' }, { field: 'user_name_zh' }],
  pagination: { current: 1, pageSize: 10 },
})
console.log(schema, result.total, result.list)

async function save(token, body, schema) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }
  if (schema) headers['X-Schema'] = schema
  const res = await fetch(`${baseUrl}/v1/data/save`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  const json = await res.json()
  if (json.code !== 0) throw new Error(json.message)
  return json.data
}

// 保存示例（update 前须先 query 拿到当前 version）
const saveResult = await save(access_token, {
  modelId: 't_order_item',
  list: [
    { _save_type: 'update', id: 1, version: 0, qty: 5 },
  ],
})
console.log(saveResult.updated)
```

---

## 11. 错误处理

### 11.1 业务错误码

| code | 含义 |
|------|------|
| `0` | 成功 |
| `40001` | 请求参数非法 |
| `40101` | 未认证或 Session 无效/过期 |
| `40301` | 权限不足（数据或动作策略拒绝） |
| `40401` | 资源不存在 |
| `40901` | 乐观锁冲突（保存时 `version` 不匹配） |
| `50001` | 服务内部错误 |
| `50002` | 数据库执行错误 |
| `50003` | 配置缺失 |

### 11.2 HTTP 状态码对照

| HTTP | 场景 |
|------|------|
| 200 | 业务成功（`code=0`）或登录成功 |
| 400 | 参数校验失败 |
| 401 | 未提供 Bearer、Session 无效、登录凭据错误 |
| 403 | 令牌有效但数据/动作权限不足 |
| 404 | 动作等资源不存在 |
| 409 | 保存时乐观锁冲突 |
| 502 | 查询、保存或 OSS 上传执行失败 |
| 503 | 登录功能未启用，或 OSS 未配置（文件上传） |

### 11.3 Session 过期与失效

`session` 模式下，受保护接口在 Session 无效时返回 HTTP **401**、`code=40101`，`message` 常见为 `session expired or revoked`、`invalid session token` 等。客户端应：

1. 清除本地保存的 `access_token`
2. 重新调用 `/v1/auth/login`

**注意**：Redis 重启、Session 被清理或服务重启后，本地仍“未过期”的令牌也会失效，须重新登录。用户 Session 在持续请求时会滑动续期；长时间无请求则按空闲 TTL 过期。

---

## 12. 附录：尚未提供的接口

以下能力在规划中，**当前版本不可用**：

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/v1/auth/logout` | 注销当前 Session |
| POST | `/v1/data/{modelId}/rows` | 新增记录 |
| POST | `/v1/data/{modelId}/rows:batchDelete` | 批量删除 |
| POST | `/v1/data/{modelId}/rows:batchUpdate` | 批量修改 |
| POST | `/v1/data/query/raw` | 高权限原始查询 |

> 事务保存请使用已实现的 `POST /v1/data/save`，见 [§6.4](#64-数据保存)。

---

## 变更记录

| 版本 | 日期 | 说明 |
|------|------|------|
| 1.5 | 2026-07-18 | 补充虚拟字段主行级联删除传参说明（file / one2many / many2many）及综合示例 |
| 1.4 | 2026-07-11 | 登录改为 Redis Session（`usr_` / `int_`）；新增 `POST /v1/integration/tokens`；补充 schema 绑定与 Session 失效行为 |
| 1.3 | 2026-07-07 | 新增 `POST /v1/files/upload`、`GET /v1/files/download`；补充 save 虚拟字段与 upload→save 流程 |
| 1.2 | 2026-05-19 | 明确 create 无需传 version；补充乐观锁与主键使用说明 |
| 1.1 | 2026-05-19 | 新增 `POST /v1/data/save` 事务保存接口文档 |
| 1.0 | 2026-05-19 | 首版公开发布文档 |

---

## 联系与支持

以下内容请由运营方在对外发布前填写：

| 项目 | 值 |
|------|-----|
| 生产环境 Base URL | _待填写_ |
| 测试环境 Base URL | _待填写_ |
| 可用 appid / schema | _待填写_ |
| 测试账号申请 | _待填写_ |
| 技术支持 | _待填写_ |
