const env = require('../config/env');
const crv = require('./crv');

const CATEGORIES = [
  { value: 'badge', label: '吧唧' },
  { value: 'stand', label: '立牌' },
  { value: 'figure', label: '手办' },
  { value: 'shikishi', label: '色纸' },
  { value: 'card', label: '卡牌' },
  { value: 'pillow', label: '抱枕' },
  { value: 'doujin', label: '同人' },
  { value: 'other', label: '其他' },
];

const VERSION_TYPES = [
  { value: 'official', label: '官方' },
  { value: 'doujin', label: '同人' },
  { value: 'other', label: '其他' },
];

const STATUSES = [
  { value: 'pending', label: '未发货' },
  { value: 'received', label: '已到货' },
  { value: 'sealed', label: '未拆封' },
  { value: 'opened', label: '已拆封' },
  { value: 'sold', label: '已出' },
  { value: 'damaged', label: '瑕疵' },
];

function categoryLabel(value) {
  const hit = CATEGORIES.find((c) => c.value === value);
  return hit ? hit.label : value || '—';
}

function statusLabel(value) {
  const hit = STATUSES.find((s) => s.value === value);
  return hit ? hit.label : value || '—';
}

function versionTypeLabel(value) {
  const hit = VERSION_TYPES.find((v) => v.value === value);
  return hit ? hit.label : value || '—';
}

/** `,tag1,tag2,` → ['tag1','tag2'] */
function decodeTags(input) {
  if (!input || typeof input !== 'string') {
    return [];
  }
  return input.split(/[,，]+/).map((t) => t.trim()).filter(Boolean);
}

function photoList(photos) {
  if (!photos) {
    return [];
  }
  return Array.isArray(photos)
    ? photos
    : Array.isArray(photos.list)
      ? photos.list
      : [];
}

function DETAIL_FIELDS() {
  return [
    { field: 'id' },
    { field: 'version' },
    { field: 'name' },
    { field: 'ip' },
    { field: 'character_name' },
    { field: 'category' },
    { field: 'version_type' },
    { field: 'circle' },
    { field: 'author' },
    { field: 'status' },
    { field: 'location' },
    { field: 'tags' },
    { field: 'purchase_price' },
    { field: 'purchase_date' },
    { field: 'purchase_source' },
    { field: 'order_no' },
    { field: 'note' },
    { field: 'create_time' },
    { field: 'update_time' },
    {
      field: 'photos',
      fieldType: 'file',
      fields: [
        { field: 'id' },
        { field: 'name' },
        { field: 'path' },
      ],
    },
  ];
}

function getById(id) {
  return crv
    .query({
      modelId: env.ITEM_MODEL_ID,
      fields: DETAIL_FIELDS(),
      filter: { id: { 'Op.eq': id } },
      pagination: { current: 1, pageSize: 1 },
    })
    .then((data) => {
      const list = (data && data.list) || [];
      if (!list.length) {
        throw new Error('未找到该谷子');
      }
      return list[0];
    });
}

function remove(id, version) {
  return crv.save({
    modelId: env.ITEM_MODEL_ID,
    list: [
      {
        _save_type: 'delete',
        id,
        version,
        // 主行 delete 须显式带 file 虚拟字段，才会级联清理 attach + OSS
        [env.PHOTOS_FIELD_ID]: {
          fieldType: 'file',
          list: [],
        },
      },
    ],
  });
}

/** 输入 "限定,官谷" 或数组 → ",限定,官谷," */
function encodeTags(input) {
  let parts = [];
  if (Array.isArray(input)) {
    parts = input;
  } else if (typeof input === 'string') {
    parts = input.split(/[,，\s]+/);
  }
  parts = parts.map((t) => String(t).trim()).filter(Boolean);
  if (!parts.length) {
    return '';
  }
  return `,${parts.join(',')},`;
}

function list(options = {}) {
  const page = options.page || 1;
  const pageSize = options.pageSize || 50;
  const keyword = String(options.keyword || '').trim();
  const ip = String(options.ip || '').trim();
  const categories = Array.isArray(options.categories)
    ? options.categories.filter(Boolean)
    : [];
  const statuses = Array.isArray(options.statuses)
    ? options.statuses.filter(Boolean)
    : [];
  const tags = Array.isArray(options.tags)
    ? options.tags.map((t) => String(t).trim()).filter(Boolean)
    : [];

  const payload = {
    modelId: env.ITEM_MODEL_ID,
    fields: [
      { field: 'id' },
      { field: 'version' },
      { field: 'name' },
      { field: 'ip' },
      { field: 'character_name' },
      { field: 'category' },
      { field: 'status' },
      { field: 'note' },
      { field: 'tags' },
      { field: 'update_time' },
      {
        field: 'photos',
        fieldType: 'file',
        fields: [
          { field: 'id' },
          { field: 'name' },
          { field: 'path' },
        ],
      },
    ],
    pagination: { current: page, pageSize },
    sort: [{ field: 'update_time', order: 'desc' }],
  };

  const andClauses = [];

  if (keyword) {
    const like = `%${keyword}%`;
    andClauses.push({
      'Op.or': [
        { name: { 'Op.like': like } },
        { ip: { 'Op.like': like } },
        { character_name: { 'Op.like': like } },
        { note: { 'Op.like': like } },
      ],
    });
  }

  if (ip) {
    andClauses.push({ ip: { 'Op.like': `%${ip}%` } });
  }

  if (categories.length) {
    andClauses.push({ category: { 'Op.in': categories } });
  }

  if (statuses.length) {
    andClauses.push({ status: { 'Op.in': statuses } });
  }

  tags.forEach((tag) => {
    andClauses.push({ tags: { 'Op.like': `%,${tag},%` } });
  });

  if (andClauses.length === 1) {
    payload.filter = andClauses[0];
  } else if (andClauses.length > 1) {
    payload.filter = { 'Op.and': andClauses };
  }

  return crv.query(payload);
}

/** 从 query 返回的 photos 嵌套结构取首张 attachId */
function firstAttachId(photos) {
  const list = photoList(photos);
  if (!list.length) {
    return null;
  }
  const first = list[0];
  return first.id || first.attachId || null;
}

function attachIds(photos) {
  return photoList(photos)
    .map((p) => p.id || p.attachId)
    .filter(Boolean);
}

function coverDownloadUrl(rowId, attachId, maxWidth = 400) {
  if (!rowId || !attachId) {
    return '';
  }
  const q = [
    `modelId=${encodeURIComponent(env.ITEM_MODEL_ID)}`,
    `rowId=${encodeURIComponent(rowId)}`,
    `fieldId=${encodeURIComponent(env.PHOTOS_FIELD_ID)}`,
    `attachId=${encodeURIComponent(attachId)}`,
    `maxWidth=${maxWidth}`,
  ].join('&');
  return `${env.CRV_BASE_URL}/v1/files/download?${q}`;
}

const coverCache = {};
const coverInflight = {};

function clearCoverCache() {
  Object.keys(coverCache).forEach((k) => {
    delete coverCache[k];
  });
  Object.keys(coverInflight).forEach((k) => {
    delete coverInflight[k];
  });
}

/**
 * 下载封面缩略图到本地 temp 路径。
 * @param {{ force?: boolean }} [options] force 时忽略缓存并重新下载（刷新后 temp 路径可能失效）
 */
async function loadCover(rowId, attachId, maxWidth = 400, options = {}) {
  const key = `${rowId}:${attachId}:${maxWidth}`;
  if (options.force) {
    delete coverCache[key];
    delete coverInflight[key];
  }
  if (coverCache[key]) {
    return coverCache[key];
  }
  if (coverInflight[key]) {
    return coverInflight[key];
  }
  const url = coverDownloadUrl(rowId, attachId, maxWidth);
  if (!url) {
    return '';
  }
  const job = crv
    .downloadFile({ url })
    .then((path) => {
      coverCache[key] = path;
      return path;
    })
    .finally(() => {
      delete coverInflight[key];
    });
  coverInflight[key] = job;
  return job;
}

function buildFormRow(form) {
  const row = {
    name: (form.name || '').trim(),
    ip: (form.ip || '').trim(),
    character_name: (form.character_name || '').trim(),
    category: form.category || 'other',
    version_type: form.version_type || 'official',
    circle: (form.circle || '').trim(),
    author: (form.author || '').trim(),
    status: form.status || 'received',
    location: (form.location || '').trim(),
    tags: encodeTags(form.tags),
    purchase_source: (form.purchase_source || '').trim(),
    order_no: (form.order_no || '').trim(),
    note: (form.note || '').trim(),
  };

  if (form.purchase_price !== '' && form.purchase_price != null) {
    const price = Number(form.purchase_price);
    if (!Number.isNaN(price)) {
      row.purchase_price = price;
    }
  }
  if (form.purchase_date) {
    row.purchase_date = form.purchase_date;
  }

  return row;
}

function buildPhotoOps(newPhotoFiles = [], deleteAttachIds = []) {
  const list = [];
  (deleteAttachIds || []).forEach((id) => {
    if (id != null && id !== '') {
      list.push({ _save_type: 'delete', id });
    }
  });
  (newPhotoFiles || []).forEach((f) => {
    list.push({
      _save_type: 'create',
      path: f.path,
      name: f.name,
      ext: f.ext,
    });
  });
  if (!list.length) {
    return null;
  }
  return { fieldType: 'file', list };
}

/**
 * @param {object} form 业务表单字段
 * @param {Array<{path,name,ext}>} [photoFiles] 已 upload 的文件元数据
 */
function create(form, photoFiles = []) {
  const row = {
    _save_type: 'create',
    ...buildFormRow(form),
  };
  const photos = buildPhotoOps(photoFiles, []);
  if (photos) {
    row.photos = photos;
  }
  return crv.save({
    modelId: env.ITEM_MODEL_ID,
    list: [row],
  });
}

/**
 * @param {string|number} id
 * @param {number} version
 * @param {object} form
 * @param {{ newPhotoFiles?: Array, deleteAttachIds?: Array }} [photoChanges]
 */
function update(id, version, form, photoChanges = {}) {
  const row = {
    _save_type: 'update',
    id,
    version,
    ...buildFormRow(form),
  };
  const photos = buildPhotoOps(
    photoChanges.newPhotoFiles || [],
    photoChanges.deleteAttachIds || []
  );
  if (photos) {
    row.photos = photos;
  }
  return crv.save({
    modelId: env.ITEM_MODEL_ID,
    list: [row],
  });
}

async function uploadLocalImages(localPaths) {
  const files = [];
  for (const filePath of localPaths) {
    const data = await crv.uploadFile({ filePath, name: 'file' });
    if (!data || !data.path) {
      throw new Error('上传失败：未返回 path');
    }
    files.push({
      path: data.path,
      name: data.name || 'photo',
      ext: data.ext || '',
    });
  }
  return files;
}

module.exports = {
  CATEGORIES,
  VERSION_TYPES,
  STATUSES,
  categoryLabel,
  statusLabel,
  versionTypeLabel,
  encodeTags,
  decodeTags,
  list,
  getById,
  create,
  update,
  remove,
  uploadLocalImages,
  photoList,
  firstAttachId,
  attachIds,
  coverDownloadUrl,
  loadCover,
  clearCoverCache,
};
