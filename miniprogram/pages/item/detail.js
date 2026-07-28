const auth = require('../../services/auth');
const itemService = require('../../services/item');

function formatDate(value) {
  if (!value) {
    return '';
  }
  const s = String(value);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

/** 展示用：取 update_time 为「YYYY-MM-DD HH:mm」 */
function formatUpdateTime(value) {
  if (!value) {
    return '';
  }
  const s = String(value).replace('T', ' ');
  if (s.length >= 16) {
    return s.slice(0, 16);
  }
  if (s.length >= 10) {
    return s.slice(0, 10);
  }
  return s;
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

Page({
  data: {
    loading: true,
    error: '',
    id: '',
    item: null,
    initial: '谷',
    photos: [],
    current: 0,
  },

  onLoad(query) {
    if (!auth.ensureLogin()) {
      return;
    }
    const id = query && query.id ? String(query.id) : '';
    if (!id) {
      this.setData({ loading: false, error: '缺少条目 ID' });
      return;
    }
    this.setData({ id });
    this.loadDetail();
  },

  onShow() {
    // 从编辑页返回时刷新
    if (this.data.id && !this.data.loading && this._needRefresh) {
      this._needRefresh = false;
      this.loadDetail();
    }
  },

  reload() {
    this.loadDetail();
  },

  async loadDetail() {
    const id = this.data.id;
    this.setData({ loading: true, error: '', current: 0 });
    try {
      const row = await itemService.getById(id);
      const name = row.name || '未命名';
      const item = {
        id: row.id,
        version: row.version,
        name,
        ip: row.ip || '',
        character_name: row.character_name || '',
        categoryLabel: itemService.categoryLabel(row.category),
        versionTypeLabel: itemService.versionTypeLabel(row.version_type),
        statusLabel: itemService.statusLabel(row.status),
        circle: row.circle || '',
        author: row.author || '',
        location: row.location || '',
        tags: itemService.decodeTags(row.tags),
        purchase_price: formatPrice(row.purchase_price),
        purchase_date: formatDate(row.purchase_date),
        purchase_source: row.purchase_source || '',
        order_no: row.order_no || '',
        note: row.note || '',
        updateTime: formatUpdateTime(row.update_time),
      };

      const ids = itemService.attachIds(row.photos);
      const photos = ids.map((attachId) => ({
        attachId,
        src: '',
      }));

      this.setData({
        item,
        initial: name.charAt(0) || '谷',
        photos,
        loading: false,
      });
      wx.setNavigationBarTitle({ title: name });
      this.loadPhotos(id, ids);
    } catch (err) {
      this.setData({
        loading: false,
        error: err.message || '加载失败',
        item: null,
        photos: [],
      });
    }
  },

  async loadPhotos(rowId, ids) {
    const jobs = ids.map(async (attachId, index) => {
      try {
        const src = await itemService.loadCover(rowId, attachId, 750);
        if (!src) {
          return;
        }
        this.setData({
          [`photos[${index}].src`]: src,
        });
      } catch (e) {
        // 单张失败忽略
      }
    });
    await Promise.all(jobs);
  },

  onSwiperChange(e) {
    this.setData({ current: e.detail.current || 0 });
  },

  previewPhoto(e) {
    const index = Number(e.currentTarget.dataset.index) || 0;
    const urls = this.data.photos.map((p) => p.src).filter(Boolean);
    if (!urls.length) {
      return;
    }
    const current = this.data.photos[index] && this.data.photos[index].src;
    wx.previewImage({
      current: current || urls[0],
      urls,
    });
  },

  goEdit() {
    const id = this.data.id;
    this._needRefresh = true;
    wx.navigateTo({
      url: `/pages/item/form?mode=edit&id=${encodeURIComponent(id)}`,
    });
  },

  handleDelete() {
    const item = this.data.item;
    if (!item) {
      return;
    }
    wx.showModal({
      title: '删除确认',
      content: `确定删除「${item.name}」吗？删除后不可恢复。`,
      confirmText: '删除',
      confirmColor: '#fa5151',
      success: async (res) => {
        if (!res.confirm) {
          return;
        }
        wx.showLoading({ title: '删除中', mask: true });
        try {
          await itemService.remove(item.id, item.version);
          itemService.clearCoverCache();
          wx.hideLoading();
          wx.showToast({ title: '已删除', icon: 'success' });
          setTimeout(() => {
            wx.navigateBack({
              fail: () => wx.switchTab({ url: '/pages/library/index' }),
            });
          }, 400);
        } catch (err) {
          wx.hideLoading();
          wx.showToast({
            title: err.message || '删除失败',
            icon: 'none',
            duration: 2500,
          });
        }
      },
    });
  },
});
