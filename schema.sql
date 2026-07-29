-- 谷子私库 MVP 数据库表结构
-- MySQL 8.x · utf8mb4
--
-- 约定：
--   - schema / 租户：gushi（CRV X-Schema）
--   - 用户：core_user.id = Session sub = owned_item.create_user
--   - 主表：owned_item.id = BIGINT AUTO_INCREMENT
--   - 附件：owned_item_attach（photos）、core_user_attach（avatar）；表名约定 {modelId}_attach
--   - 标签：owned_item.tags 主表文本（`,tag1,tag2,` 分隔，便于 CRV Op.like 筛选）
--   - 用户角色：core_user.roles（many2many）→ core_role_core_user → core_role
--
-- 参考：integration.md、res.md、public_api.md v1.3

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------------
-- core_user（微信用户，Auth 登录后同步至 CRV）
-- modelId: core_user
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS core_user (
  id            VARCHAR(64)   NOT NULL COMMENT '用户ID = Session sub',
  version       INT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '乐观锁',

  openid        VARCHAR(64)   NOT NULL COMMENT '微信小程序 openid',
  union_id      VARCHAR(64)   NULL     COMMENT '微信 unionid',
  nickname      VARCHAR(64)   NOT NULL DEFAULT '' COMMENT '昵称',
  user_name_zh  VARCHAR(64)   NOT NULL DEFAULT '' COMMENT '中文名称',
  user_name_en  VARCHAR(64)   NOT NULL DEFAULT '' COMMENT '英文名称',
  password      VARCHAR(128)  NOT NULL DEFAULT '' COMMENT '密码（哈希，微信登录可为空）',
  avatar_url    VARCHAR(512)  NOT NULL DEFAULT '' COMMENT '头像 URL/OSS path；展示优先走 avatar 文件附件 download',

  default_view  VARCHAR(16)   NOT NULL DEFAULT 'grid' COMMENT '默认视图：grid|list',
  hide_amount   TINYINT(1)    NOT NULL DEFAULT 0 COMMENT '统计页是否隐藏金额',

  status        TINYINT       NOT NULL DEFAULT 1 COMMENT '1=正常 0=禁用',

  create_user   VARCHAR(64)   NOT NULL DEFAULT '' COMMENT 'CRV 审计：创建人',
  create_time   DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT 'CRV 审计：创建时间',
  update_user   VARCHAR(64)   NOT NULL DEFAULT '' COMMENT 'CRV 审计：更新人',
  update_time   DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT 'CRV 审计：更新时间',

  PRIMARY KEY (id),
  UNIQUE KEY uk_core_user_openid (openid),
  KEY idx_core_user_union_id (union_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='谷子用户';

-- ---------------------------------------------------------------------------
-- core_user_attach（用户头像附件，CRV file 虚拟字段 avatar）
-- 表名约定 {modelId}_attach；row_id 类型与 core_user.id（VARCHAR）一致
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS core_user_attach (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'attach 主键，download 参数 attachId',
  version      INT UNSIGNED    NOT NULL DEFAULT 0 COMMENT '乐观锁',

  model_id     VARCHAR(64)     NOT NULL DEFAULT 'core_user' COMMENT '主表 modelId',
  field_id     VARCHAR(64)     NOT NULL DEFAULT 'avatar' COMMENT 'file 虚拟字段名',
  row_id       VARCHAR(64)     NOT NULL COMMENT '主表 core_user.id',

  path         VARCHAR(512)    NOT NULL COMMENT 'OSS 对象键',
  name         VARCHAR(255)    NOT NULL DEFAULT '' COMMENT '原始文件名',
  ext          VARCHAR(16)     NOT NULL DEFAULT '' COMMENT '扩展名，含.',

  sort_order   INT             NOT NULL DEFAULT 0 COMMENT '同用户多头像排序（通常仅 1 张）',

  create_user  VARCHAR(64)     NOT NULL DEFAULT '',
  create_time  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  update_user  VARCHAR(64)     NOT NULL DEFAULT '',
  update_time  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  KEY idx_core_user_attach_row (model_id, field_id, row_id, sort_order),
  KEY idx_core_user_attach_path (path(191)),

  CONSTRAINT fk_core_user_attach_row
    FOREIGN KEY (row_id) REFERENCES core_user (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='用户头像附件（avatar）';

-- ---------------------------------------------------------------------------
-- core_role（用户角色）
-- modelId: core_role
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS core_role (
  id            VARCHAR(64)   NOT NULL COMMENT '角色ID',
  version       INT UNSIGNED  NOT NULL DEFAULT 0 COMMENT '乐观锁',

  remark        VARCHAR(255)  NOT NULL DEFAULT '' COMMENT '备注',

  create_user   VARCHAR(64)   NOT NULL DEFAULT '' COMMENT 'CRV 审计：创建人',
  create_time   DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT 'CRV 审计：创建时间',
  update_user   VARCHAR(64)   NOT NULL DEFAULT '' COMMENT 'CRV 审计：更新人',
  update_time   DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT 'CRV 审计：更新时间',

  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='用户角色';

-- 初始角色（按需执行）
-- INSERT INTO core_role (id, remark) VALUES ('gushi_user', '谷子私库普通用户');

-- ---------------------------------------------------------------------------
-- core_role_core_user（用户 ↔ 角色，many2many 中间表）
-- associationModelId: core_role_core_user
-- core_user.roles → relatedModelID: core_role
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS core_role_core_user (
  id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '关联主键',
  version        INT UNSIGNED    NOT NULL DEFAULT 0 COMMENT '乐观锁',

  core_user_id   VARCHAR(64)     NOT NULL COMMENT 'core_user.id',
  core_role_id   VARCHAR(64)     NOT NULL COMMENT 'core_role.id',

  create_user    VARCHAR(64)     NOT NULL DEFAULT '' COMMENT 'CRV 审计：创建人',
  create_time    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) COMMENT 'CRV 审计：创建时间',
  update_user    VARCHAR(64)     NOT NULL DEFAULT '' COMMENT 'CRV 审计：更新人',
  update_time    DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3) COMMENT 'CRV 审计：更新时间',

  PRIMARY KEY (id),
  UNIQUE KEY uk_core_role_core_user (core_user_id, core_role_id),
  KEY idx_core_role_core_user_role (core_role_id, core_user_id),

  CONSTRAINT fk_core_role_core_user_user
    FOREIGN KEY (core_user_id) REFERENCES core_user (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_core_role_core_user_role
    FOREIGN KEY (core_role_id) REFERENCES core_role (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='用户角色关联';

-- Auth 同步用户后绑定默认角色（按需执行）
-- INSERT INTO core_role_core_user (core_user_id, core_role_id)
-- VALUES ('u_wx_001', 'gushi_user');

-- ---------------------------------------------------------------------------
-- owned_item（已拥有谷子）
-- modelId: owned_item
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS owned_item (
  id               BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT '主键',
  version          INT UNSIGNED    NOT NULL DEFAULT 0 COMMENT '乐观锁',

  name             VARCHAR(255)    NOT NULL DEFAULT '' COMMENT '名称',
  ip               VARCHAR(128)    NOT NULL DEFAULT '' COMMENT 'IP/作品',
  character_name   VARCHAR(128)    NOT NULL DEFAULT '' COMMENT '角色',
  category         VARCHAR(32)     NOT NULL DEFAULT 'other' COMMENT '品类：badge|stand|figure|shikishi|card|pillow|doujin|other',
  version_type     VARCHAR(32)     NOT NULL DEFAULT 'normal' COMMENT '版本：normal|limited|reprint|event|fan',

  circle           VARCHAR(128)    NOT NULL DEFAULT '' COMMENT '社团（同人）',
  author           VARCHAR(128)    NOT NULL DEFAULT '' COMMENT '作者（同人）',

  status           VARCHAR(32)     NOT NULL DEFAULT 'received' COMMENT '状态：pending|received|sealed|opened|sold|damaged',
  location         VARCHAR(255)    NOT NULL DEFAULT '' COMMENT '存放位置',
  tags             VARCHAR(512)    NOT NULL DEFAULT '' COMMENT '标签，存储格式 ,tag1,tag2,',

  purchase_price   DECIMAL(12,2)   NULL COMMENT '购入价',
  purchase_date    DATE            NULL COMMENT '购入日期',
  purchase_source  VARCHAR(255)    NOT NULL DEFAULT '' COMMENT '购入渠道',
  order_no         VARCHAR(128)    NOT NULL DEFAULT '' COMMENT '订单号',

  note             TEXT            NULL COMMENT '备注',

  create_user      VARCHAR(64)     NOT NULL DEFAULT '' COMMENT '创建人 = core_user.id',
  create_time      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  update_user      VARCHAR(64)     NOT NULL DEFAULT '',
  update_time      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  KEY idx_owned_item_owner_created (create_user, create_time DESC),
  KEY idx_owned_item_owner_ip (create_user, ip),
  KEY idx_owned_item_owner_category (create_user, category),
  KEY idx_owned_item_owner_status (create_user, status),
  KEY idx_owned_item_owner_purchase_date (create_user, purchase_date),
  KEY idx_owned_item_owner_name (create_user, name(64)),

  CONSTRAINT fk_owned_item_create_user
    FOREIGN KEY (create_user) REFERENCES core_user (id)
    ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='已拥有谷子';

-- ---------------------------------------------------------------------------
-- owned_item_attach（图片附件，CRV file 虚拟字段 photos）
-- 表名由 crvframe 按 {modelId}_attach 自动生成
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS owned_item_attach (
  id           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT COMMENT 'attach 主键，download 参数 attachId',
  version      INT UNSIGNED    NOT NULL DEFAULT 0 COMMENT '乐观锁',

  model_id     VARCHAR(64)     NOT NULL DEFAULT 'owned_item' COMMENT '主表 modelId',
  field_id     VARCHAR(64)     NOT NULL DEFAULT 'photos' COMMENT 'file 虚拟字段名',
  row_id       BIGINT UNSIGNED NOT NULL COMMENT '主表 owned_item.id',

  path         VARCHAR(512)    NOT NULL COMMENT 'OSS 对象键',
  name         VARCHAR(255)    NOT NULL DEFAULT '' COMMENT '原始文件名',
  ext          VARCHAR(16)     NOT NULL DEFAULT '' COMMENT '扩展名，含.',

  sort_order   INT             NOT NULL DEFAULT 0 COMMENT '同条谷子内多图排序',

  create_user  VARCHAR(64)     NOT NULL DEFAULT '',
  create_time  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  update_user  VARCHAR(64)     NOT NULL DEFAULT '',
  update_time  DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

  PRIMARY KEY (id),
  KEY idx_owned_item_attach_row (model_id, field_id, row_id, sort_order),
  KEY idx_owned_item_attach_path (path(191)),

  CONSTRAINT fk_owned_item_attach_row
    FOREIGN KEY (row_id) REFERENCES owned_item (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  COMMENT='谷子图片附件（photos）';

SET FOREIGN_KEY_CHECKS = 1;

-- ---------------------------------------------------------------------------
-- v1.1 预留：wishlist_item（第一版 MVP 不执行）
-- ---------------------------------------------------------------------------
-- CREATE TABLE wishlist_item ( ... , tags VARCHAR(512), ... );
-- CREATE TABLE wishlist_item_attach ( ... );
