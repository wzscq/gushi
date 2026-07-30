const auth = require('../../services/auth');
const marketService = require('../../services/market');
const itemService = require('../../services/item');

function findCategoryIndex(value) {
  const i = marketService.CATEGORIES.findIndex((c) => c.value === value);
  return i >= 0 ? i : marketService.CATEGORIES.length - 1;
}

Page({
  data: {
    loading: false,
    saving: false,
    listingId: '',
    listingVersion: 0,
    title: '',
    sell_price: '',
    note: '',
    categoryIndex: 0,
    categories: marketService.CATEGORIES,
    photos: [],
    importItemId: '',
  },

  onLoad(query) {
    if (!auth.ensureLogin()) {
      return;
    }
    const listingId = query && query.id ? String(query.id) : '';
    const itemId = query && query.itemId ? String(query.itemId) : '';
    if (listingId) {
      this.setData({ listingId });
      wx.setNavigationBarTitle({ title: '编辑橱窗' });
      this.loadForEdit(listingId);
      return;
    }
    if (itemId) {
      this.prefillFromOwnedItem(itemId);
    }
  },

  goLibraryPick() {
    wx.switchTab({ url: '/pages/library/index' });
  },

  async loadForEdit(id) {
    this.setData({ loading: true });
    try {
      const row = await marketService.getById(id);
      const attachList = marketService.photoList(row.photos);
      const photos = [];
      for (let i = 0; i < attachList.length; i += 1) {
        const a = attachList[i];
        const attachId = a.id || a.attachId;
        let src = '';
        if (attachId) {
          try {
            src = await marketService.loadCover(row.id, attachId, 400, {
              force: true,
            });
          } catch (e) {
            src = '';
          }
        }
        photos.push({
          key: `a-${attachId || i}`,
          attachId,
          src,
        });
      }
      this.setData({
        loading: false,
        listingVersion: row.version,
        title: row.title || '',
        sell_price:
          row.sell_price != null && row.sell_price !== ''
            ? String(row.sell_price)
            : '',
        note: row.note || '',
        categoryIndex: findCategoryIndex(row.category),
        photos,
      });
    } catch (err) {
      this.setData({ loading: false });
      wx.showToast({ title: err.message || '加载失败', icon: 'none' });
    }
  },

  async prefillFromOwnedItem(itemId) {
    this.setData({ loading: true });
    try {
      const row = await itemService.getById(itemId);
      const attachId = itemService.firstAttachId(row.photos);
      if (!attachId) {
        this.setData({
          loading: false,
          importItemId: '',
          photos: [],
        });
        wx.showToast({ title: '该谷子没有图片，请先在私库补充', icon: 'none' });
        return;
      }

      wx.showLoading({ title: '拷贝封面', mask: true });
      let local = '';
      try {
        local = await itemService.loadCover(itemId, attachId, 750, {
          force: true,
        });
      } finally {
        wx.hideLoading();
      }
      if (!local) {
        throw new Error('封面拷贝失败');
      }

      this.setData({
        loading: false,
        importItemId: row.id,
        title: row.name || '未命名',
        categoryIndex: findCategoryIndex(row.category),
        note: '',
        sell_price: '',
        photos: [
          {
            key: `import-${Date.now()}`,
            src: local,
            localPath: local,
          },
        ],
      });
    } catch (err) {
      this.setData({ loading: false, importItemId: '', photos: [] });
      wx.showToast({
        title: err.message || '加载私库条目失败',
        icon: 'none',
      });
    }
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [field]: e.detail.value });
  },

  onCategoryChange(e) {
    this.setData({ categoryIndex: Number(e.detail.value) || 0 });
  },

  async handleSave() {
    if (this.data.saving || this.data.loading) {
      return;
    }

    const isCreate = !this.data.listingId;
    if (isCreate && !this.data.importItemId) {
      wx.showToast({ title: '请从私库详情点击出售', icon: 'none' });
      return;
    }

    const title = (this.data.title || '').trim();
    const sell_price = this.data.sell_price;
    if (!title) {
      wx.showToast({ title: '请填写标题', icon: 'none' });
      return;
    }
    if (sell_price === '' || sell_price == null) {
      wx.showToast({ title: '请填写售价', icon: 'none' });
      return;
    }
    if (isCreate && !this.data.photos.length) {
      wx.showToast({ title: '所选谷子需有封面图', icon: 'none' });
      return;
    }

    this.setData({ saving: true });
    wx.showLoading({ title: '保存中', mask: true });
    try {
      const form = {
        title,
        sell_price,
        note: this.data.note,
        category: this.data.categories[this.data.categoryIndex].value,
      };

      if (isCreate) {
        const localPaths = this.data.photos
          .filter((p) => p.localPath)
          .map((p) => p.localPath);
        if (!localPaths.length) {
          throw new Error('封面无效，请返回私库重新出售');
        }
        const newPhotoFiles = await marketService.uploadLocalImages(localPaths);
        await marketService.create(form, newPhotoFiles, [this.data.importItemId]);
      } else {
        await marketService.updateListing(
          this.data.listingId,
          this.data.listingVersion,
          form,
          {}
        );
      }

      marketService.clearCoverCache();
      wx.showToast({ title: '已保存', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 500);
    } catch (err) {
      wx.showToast({ title: err.message || '保存失败', icon: 'none' });
    } finally {
      wx.hideLoading();
      this.setData({ saving: false });
    }
  },
});
