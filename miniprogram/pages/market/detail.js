const auth = require('../../services/auth');
const marketService = require('../../services/market');
const { formatLocalDateTime } = require('../../utils/datetime');

Page({
  data: {
    loading: true,
    error: '',
    id: '',
    item: null,
    photos: [],
    current: 0,
    isOwner: false,
  },

  onLoad(query) {
    const id = query && query.id ? String(query.id) : '';
    this.setData({ id });
  },

  onShow() {
    if (!auth.ensureLogin()) {
      return;
    }
    if (this.data.id) {
      this.loadDetail();
    }
  },

  async loadDetail() {
    this.setData({ loading: true, error: '' });
    try {
      const row = await marketService.getById(this.data.id);
      const user = auth.getUser() || {};
      const nickMap = await marketService.fetchSellerNicknames([row.create_user]);
      const attachIds = marketService
        .photoList(row.photos)
        .map((p) => p.id || p.attachId)
        .filter(Boolean);

      const photos = attachIds.length
        ? attachIds.map((aid, i) => ({
            key: `a-${aid}`,
            attachId: aid,
            src: '',
            initial: (row.title || '市').slice(0, 1),
          }))
        : [
            {
              key: 'empty',
              src: '',
              initial: (row.title || '市').slice(0, 1),
            },
          ];

      this.setData({
        loading: false,
        item: {
          id: row.id,
          version: row.version,
          title: row.title || '未命名',
          priceText: marketService.formatPrice(row.sell_price),
          categoryLabel: marketService.categoryLabel(row.category),
          note: row.note || '',
          status: row.status,
          sellerName: nickMap[row.create_user] || '',
          listedAtText: formatLocalDateTime(row.listed_at || row.create_time),
        },
        photos,
        isOwner: !!(user.id && user.id === row.create_user),
      });

      for (let i = 0; i < photos.length; i += 1) {
        const p = photos[i];
        if (!p.attachId) {
          continue;
        }
        try {
          const src = await marketService.loadCover(row.id, p.attachId, 750, {
            force: true,
          });
          if (src) {
            this.setData({ [`photos[${i}].src`]: src });
          }
        } catch (e) {
          // ignore
        }
      }
    } catch (err) {
      this.setData({
        loading: false,
        error: err.message || '加载失败',
        item: null,
      });
    }
  },

  onSwiperChange(e) {
    this.setData({ current: e.detail.current || 0 });
  },

  goEdit() {
    wx.navigateTo({
      url: `/pages/market/form?id=${this.data.id}`,
    });
  },

  handleUnlist() {
    const item = this.data.item;
    if (!item) {
      return;
    }
    wx.showModal({
      title: '下架橱窗',
      content: '下架后将不在「逛市场」中展示',
      success: async (res) => {
        if (!res.confirm) {
          return;
        }
        try {
          wx.showLoading({ title: '处理中', mask: true });
          await marketService.unlist(item.id, item.version);
          wx.showToast({ title: '已下架', icon: 'success' });
          this.loadDetail();
        } catch (err) {
          wx.showToast({ title: err.message || '操作失败', icon: 'none' });
        } finally {
          wx.hideLoading();
        }
      },
    });
  },

  handleRelist() {
    const item = this.data.item;
    if (!item) {
      return;
    }
    wx.showModal({
      title: '重新上架',
      content: '将再次出现在「逛市场」',
      success: async (res) => {
        if (!res.confirm) {
          return;
        }
        try {
          wx.showLoading({ title: '处理中', mask: true });
          await marketService.relist(item.id, item.version);
          wx.showToast({ title: '已上架', icon: 'success' });
          this.loadDetail();
        } catch (err) {
          wx.showToast({ title: err.message || '操作失败', icon: 'none' });
        } finally {
          wx.hideLoading();
        }
      },
    });
  },
});
