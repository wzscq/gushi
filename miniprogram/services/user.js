const env = require('../config/env');
const auth = require('./auth');
const crv = require('./crv');

function isHttpUrl(value) {
  const s = String(value || '').trim().toLowerCase();
  return s.startsWith('https://') || s.startsWith('http://');
}

/** 微信 chooseAvatar 等返回的本地临时路径，不能长期保存 */
function isLocalFilePath(value) {
  const s = String(value || '').trim().toLowerCase();
  if (!s) {
    return false;
  }
  if (s.startsWith('wxfile://') || s.startsWith('file://')) {
    return true;
  }
  // 开发者工具 / 真机临时目录常见形态
  if (s.includes('://tmp') || s.includes('/tmp/') || s.includes('\\tmp\\')) {
    return true;
  }
  return false;
}

function avatarList(avatar) {
  if (!avatar) {
    return [];
  }
  return Array.isArray(avatar)
    ? avatar
    : Array.isArray(avatar.list)
    ? avatar.list
    : [];
}

function firstAttachId(avatar) {
  const list = avatarList(avatar);
  if (!list.length) {
    return null;
  }
  const first = list[0];
  return first.id || first.attachId || null;
}

function SELF_FIELDS() {
  return [
    { field: 'id' },
    { field: 'version' },
    { field: 'nickname' },
    { field: 'avatar_url' },
    {
      field: env.AVATAR_FIELD_ID,
      fieldType: 'file',
      fields: [
        { field: 'id' },
        { field: 'version' },
        { field: 'name' },
        { field: 'path' },
        { field: 'ext' },
      ],
    },
  ];
}

function getSelf() {
  const user = auth.getUser();
  if (!user || !user.id) {
    return Promise.reject(new Error('未登录'));
  }
  return crv
    .query({
      modelId: env.USER_MODEL_ID,
      fields: SELF_FIELDS(),
      filter: { id: { 'Op.eq': user.id } },
      pagination: { current: 1, pageSize: 1 },
    })
    .then((data) => {
      const list = (data && data.list) || [];
      if (!list.length) {
        throw new Error('未找到用户资料');
      }
      return list[0];
    });
}

function avatarDownloadUrl(rowId, attachId, maxWidth = 240) {
  if (!rowId || !attachId) {
    return '';
  }
  const q = [
    `modelId=${encodeURIComponent(env.USER_MODEL_ID)}`,
    `rowId=${encodeURIComponent(rowId)}`,
    `fieldId=${encodeURIComponent(env.AVATAR_FIELD_ID)}`,
    `attachId=${encodeURIComponent(attachId)}`,
    `maxWidth=${maxWidth}`,
  ].join('&');
  return `${env.CRV_BASE_URL}/v1/files/download?${q}`;
}

const avatarCache = {};
const avatarInflight = {};

/**
 * 下载用户头像到本地 temp 路径（需已有 attach）。
 */
async function loadAvatar(rowId, attachId, maxWidth = 240, options = {}) {
  const key = `${rowId}:${attachId}:${maxWidth}`;
  if (options.force) {
    delete avatarCache[key];
    delete avatarInflight[key];
  }
  if (avatarCache[key]) {
    return avatarCache[key];
  }
  if (avatarInflight[key]) {
    return avatarInflight[key];
  }
  const url = avatarDownloadUrl(rowId, attachId, maxWidth);
  if (!url) {
    return '';
  }
  const job = crv
    .downloadFile({ url })
    .then((path) => {
      avatarCache[key] = path;
      return path;
    })
    .finally(() => {
      delete avatarInflight[key];
    });
  avatarInflight[key] = job;
  return job;
}

/**
 * 上传本地头像到 CRV/OSS，写入 avatar 附件，并把稳定 path 写入 avatar_url。
 */
async function uploadAndSaveAvatar(localFilePath) {
  if (!localFilePath) {
    throw new Error('缺少头像文件');
  }

  const uploaded = await crv.uploadFile({ filePath: localFilePath });
  const row = await getSelf();
  const existing = avatarList(row[env.AVATAR_FIELD_ID]);
  const fileOps = existing
    .filter((a) => a.id || a.attachId)
    .map((a) => ({
      _save_type: 'delete',
      id: a.id || a.attachId,
      version: a.version != null ? a.version : 0,
    }));

  fileOps.push({
    _save_type: 'create',
    path: uploaded.path,
    name: uploaded.name || 'avatar.jpg',
    ext: uploaded.ext || '.jpg',
  });

  await crv.save({
    modelId: env.USER_MODEL_ID,
    list: [
      {
        _save_type: 'update',
        id: row.id,
        version: row.version,
        avatar_url: uploaded.path,
        [env.AVATAR_FIELD_ID]: {
          fieldType: 'file',
          list: fileOps,
        },
      },
    ],
  });

  const refreshed = await getSelf();
  const attachId = firstAttachId(refreshed[env.AVATAR_FIELD_ID]);
  const nextUser = {
    ...(auth.getUser() || {}),
    id: refreshed.id,
    nickname: refreshed.nickname || (auth.getUser() || {}).nickname,
    avatar_url: refreshed.avatar_url || uploaded.path,
    avatar_attach_id: attachId,
  };
  auth.setUser(nextUser);
  return nextUser;
}

/**
 * 解析可展示的头像本地路径 / http URL。
 * @returns {Promise<string>}
 */
async function resolveAvatarSrc(user, options = {}) {
  const u = user || auth.getUser();
  if (!u) {
    return '';
  }
  if (isHttpUrl(u.avatar_url) && !isLocalFilePath(u.avatar_url)) {
    return u.avatar_url;
  }

  let attachId = u.avatar_attach_id || null;
  let rowId = u.id;
  if (!attachId && rowId) {
    try {
      const row = await getSelf();
      attachId = firstAttachId(row[env.AVATAR_FIELD_ID]);
      rowId = row.id;
      if (attachId || row.avatar_url) {
        auth.setUser({
          ...u,
          avatar_url: row.avatar_url || u.avatar_url,
          avatar_attach_id: attachId,
        });
      }
    } catch (e) {
      return '';
    }
  }

  if (!attachId || !rowId) {
    return '';
  }

  try {
    return await loadAvatar(rowId, attachId, 240, options);
  } catch (e) {
    return '';
  }
}

module.exports = {
  isHttpUrl,
  isLocalFilePath,
  getSelf,
  uploadAndSaveAvatar,
  loadAvatar,
  resolveAvatarSrc,
  firstAttachId,
};
