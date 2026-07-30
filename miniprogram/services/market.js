const env = require('../config/env');
const auth = require('./auth');
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

function categoryLabel(value) {
  const hit = CATEGORIES.find((c) => c.value === value);
  return hit ? hit.label : value || '—';
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

function firstAttachId(photos) {
  const list = photoList(photos);
  if (!list.length) {
    return null;
  }
  const first = list[0];
  return first.id || first.attachId || null;
}

function formatPrice(value) {
  if (value === '' || value == null) {
    return '';
  }
  const n = Number(value);
  if (Number.isNaN(n)) {
    return String(value);
  }
  return n.toFixed(2).replace(/\.00$/, '');
}

function listingStatusLabel(status) {
  if (status === 'listed') {
    return '在售';
  }
  if (status === 'delisted') {
    return '已下架';
  }
  return status || '—';
}

/**
 * 按私库谷子 ID 查关联出售橱窗（经中间表弱关联，仅本人可见关联）。
 */
function listByOwnedItemId(ownedItemId) {
  if (ownedItemId == null || ownedItemId === '') {
    return Promise.resolve([]);
  }
  return crv
    .query({
      modelId: env.MARKET_LINK_MODEL_ID,
      fields: [
        { field: 'id' },
        { field: 'market_listing_id' },
        { field: 'owned_item_id' },
      ],
      filter: { owned_item_id: { 'Op.eq': ownedItemId } },
      pagination: { current: 1, pageSize: 100 },
    })
    .then((data) => {
      const links = (data && data.list) || [];
      const listingIds = Array.from(
        new Set(
          links
            .map((l) => l.market_listing_id)
            .filter((id) => id != null && id !== '')
        )
      );
      if (!listingIds.length) {
        return [];
      }
      return crv
        .query({
          modelId: env.MARKET_MODEL_ID,
          fields: LIST_FIELDS(),
          filter: { id: { 'Op.in': listingIds } },
          sort: [{ field: 'listed_at', order: 'desc' }],
          pagination: { current: 1, pageSize: listingIds.length },
        })
        .then((res) => (res && res.list) || []);
    });
}

function LIST_FIELDS() {
  return [
    { field: 'id' },
    { field: 'version' },
    { field: 'title' },
    { field: 'category' },
    { field: 'sell_price' },
    { field: 'status' },
    { field: 'listed_at' },
    { field: 'note' },
    { field: 'create_user' },
    { field: 'update_time' },
    {
      field: env.MARKET_PHOTOS_FIELD_ID,
      fieldType: 'file',
      fields: [{ field: 'id' }, { field: 'name' }, { field: 'path' }],
    },
  ];
}

function DETAIL_FIELDS() {
  return LIST_FIELDS();
}

function coverDownloadUrl(rowId, attachId, maxWidth = 400) {
  if (!rowId || !attachId) {
    return '';
  }
  const q = [
    `modelId=${encodeURIComponent(env.MARKET_MODEL_ID)}`,
    `rowId=${encodeURIComponent(rowId)}`,
    `fieldId=${encodeURIComponent(env.MARKET_PHOTOS_FIELD_ID)}`,
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

function utcNowSql() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  );
}

function listMarket(options = {}) {
  const page = options.page || 1;
  const pageSize = options.pageSize || 50;
  const keyword = String(options.keyword || '').trim();
  const payload = {
    modelId: env.MARKET_MODEL_ID,
    fields: LIST_FIELDS(),
    filter: { status: { 'Op.eq': 'listed' } },
    sort: [{ field: 'listed_at', order: 'desc' }],
    pagination: { current: page, pageSize },
  };
  if (keyword) {
    payload.filter = {
      'Op.and': [
        { status: { 'Op.eq': 'listed' } },
        {
          'Op.or': [
            { title: { 'Op.like': `%${keyword}%` } },
            { note: { 'Op.like': `%${keyword}%` } },
          ],
        },
      ],
    };
  }
  return crv.query(payload);
}

function listMyShelf(options = {}) {
  const user = auth.getUser();
  if (!user || !user.id) {
    return Promise.reject(new Error('未登录'));
  }
  const page = options.page || 1;
  const pageSize = options.pageSize || 50;
  const status = options.status; // listed | delisted | undefined=all mine
  const andClauses = [{ create_user: { 'Op.eq': user.id } }];
  if (status) {
    andClauses.push({ status: { 'Op.eq': status } });
  }
  return crv.query({
    modelId: env.MARKET_MODEL_ID,
    fields: LIST_FIELDS(),
    filter: andClauses.length === 1 ? andClauses[0] : { 'Op.and': andClauses },
    sort: [{ field: 'update_time', order: 'desc' }],
    pagination: { current: page, pageSize },
  });
}

function getById(id) {
  return crv
    .query({
      modelId: env.MARKET_MODEL_ID,
      fields: DETAIL_FIELDS(),
      filter: { id: { 'Op.eq': id } },
      pagination: { current: 1, pageSize: 1 },
    })
    .then((data) => {
      const list = (data && data.list) || [];
      if (!list.length) {
        throw new Error('未找到该橱窗');
      }
      return list[0];
    });
}

/**
 * @param {object} form { title, category, sell_price, note }
 * @param {Array<{path,name,ext}>} photoFiles
 * @param {Array<string|number>} [ownedItemIds] 弱关联私库 ID
 */
function create(form, photoFiles = [], ownedItemIds = []) {
  const title = String(form.title || '').trim();
  const price = Number(form.sell_price);
  const ids = (ownedItemIds || []).filter((id) => id != null && id !== '');
  if (!ids.length) {
    return Promise.reject(new Error('发布必须关联私库谷子'));
  }
  if (!title) {
    return Promise.reject(new Error('请填写标题'));
  }
  if (Number.isNaN(price) || price < 0) {
    return Promise.reject(new Error('请填写有效售价'));
  }
  if (!photoFiles.length) {
    return Promise.reject(new Error('请至少上传一张图片'));
  }

  const row = {
    _save_type: 'create',
    title,
    category: form.category || 'other',
    sell_price: price,
    status: 'listed',
    listed_at: utcNowSql(),
    note: String(form.note || '').trim(),
    [env.MARKET_PHOTOS_FIELD_ID]: buildPhotoOps(photoFiles, []),
    [env.MARKET_ITEMS_FIELD_ID]: {
      fieldType: 'many2many',
      relatedModelId: env.ITEM_MODEL_ID,
      associationModelId: 'market_listing_owned_item',
      list: ids.map((id) => ({ _save_type: 'create', id })),
    },
  };

  return crv.save({
    modelId: env.MARKET_MODEL_ID,
    list: [row],
  });
}

function updateListing(id, version, form, photoChanges = {}) {
  const title = String(form.title || '').trim();
  const price = Number(form.sell_price);
  if (!title) {
    return Promise.reject(new Error('请填写标题'));
  }
  if (Number.isNaN(price) || price < 0) {
    return Promise.reject(new Error('请填写有效售价'));
  }

  const row = {
    _save_type: 'update',
    id,
    version,
    title,
    category: form.category || 'other',
    sell_price: price,
    note: String(form.note || '').trim(),
  };
  const photos = buildPhotoOps(
    photoChanges.newPhotoFiles || [],
    photoChanges.deleteAttachIds || []
  );
  if (photos) {
    row[env.MARKET_PHOTOS_FIELD_ID] = photos;
  }
  return crv.save({
    modelId: env.MARKET_MODEL_ID,
    list: [row],
  });
}

function unlist(id, version) {
  return crv.save({
    modelId: env.MARKET_MODEL_ID,
    list: [
      {
        _save_type: 'update',
        id,
        version,
        status: 'delisted',
      },
    ],
  });
}

function relist(id, version) {
  return crv.save({
    modelId: env.MARKET_MODEL_ID,
    list: [
      {
        _save_type: 'update',
        id,
        version,
        status: 'listed',
        listed_at: utcNowSql(),
      },
    ],
  });
}

function remove(id, version) {
  return crv.save({
    modelId: env.MARKET_MODEL_ID,
    list: [
      {
        _save_type: 'delete',
        id,
        version,
        [env.MARKET_PHOTOS_FIELD_ID]: { fieldType: 'file', list: [] },
        [env.MARKET_ITEMS_FIELD_ID]: {
          fieldType: 'many2many',
          relatedModelId: env.ITEM_MODEL_ID,
          associationModelId: 'market_listing_owned_item',
          list: [],
        },
      },
    ],
  });
}

/** 批量查卖家昵称（公开 profile dataset） */
function fetchSellerNicknames(userIds) {
  const ids = Array.from(new Set((userIds || []).filter(Boolean)));
  if (!ids.length) {
    return Promise.resolve({});
  }
  return crv
    .query({
      modelId: env.USER_MODEL_ID,
      fields: [{ field: 'id' }, { field: 'nickname' }],
      filter: { id: { 'Op.in': ids } },
      pagination: { current: 1, pageSize: Math.max(ids.length, 1) },
    })
    .then((data) => {
      const map = {};
      ((data && data.list) || []).forEach((u) => {
        map[u.id] = u.nickname || '';
      });
      return map;
    })
    .catch(() => ({}));
}

module.exports = {
  CATEGORIES,
  categoryLabel,
  formatPrice,
  listingStatusLabel,
  photoList,
  firstAttachId,
  listMarket,
  listMyShelf,
  listByOwnedItemId,
  getById,
  create,
  updateListing,
  unlist,
  relist,
  remove,
  uploadLocalImages,
  loadCover,
  clearCoverCache,
  fetchSellerNicknames,
};
