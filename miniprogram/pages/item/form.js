const auth = require('../../services/auth');
const itemService = require('../../services/item');

function findIndexByValue(list, value, fallback = 0) {
  const i = list.findIndex((x) => x.value === value);
  return i >= 0 ? i : fallback;
}

function formatDate(value) {
  if (!value) {
    return '';
  }
  const s = String(value);
  return s.length >= 10 ? s.slice(0, 10) : s;
}

function formatPrice(value) {
  if (value === '' || value == null) {
    return '';
  }
  const n = Number(value);
  if (Number.isNaN(n)) {
    return String(value);
  }
  return String(n);
}

Page({
  data: {
    mode: 'create',
    itemId: '',
    itemVersion: 0,
    loading: false,
    saving: false,
    // { key, src, attachId? } attachId 有值=已有图；无=本地新图
    photos: [],
    deletedAttachIds: [],

    name: '',
    ip: '',
    character_name: '',
    categoryIndex: 0,
    versionTypeIndex: 0,
    circle: '',
    author: '',
    statusIndex: 1,
    location: '',
    purchase_price: '',
    purchase_date: '',
    purchase_source: '',
    order_no: '',
    tags: '',
    note: '',

    categories: itemService.CATEGORIES,
    versionTypes: itemService.VERSION_TYPES,
    statuses: itemService.STATUSES,
  },

  onLoad(query) {
    if (!auth.ensureLogin()) {
      return;
    }
    const mode = (query && query.mode) || 'create';
    const id = query && query.id ? String(query.id) : '';
    if (mode === 'edit' && id) {
      this.setData({ mode: 'edit', itemId: id });
      wx.setNavigationBarTitle({ title: '编辑谷子' });
      this.loadForEdit(id);
      return;
    }
    this.setData({ mode: 'create' });
    wx.setNavigationBarTitle({ title: '新增谷子' });
  },

  async loadForEdit(id) {
    this.setData({ loading: true });
    wx.showLoading({ title: '加载中', mask: true });
    try {
      const row = await itemService.getById(id);
      const tags = itemService.decodeTags(row.tags).join(',');
      const attachIdList = itemService.attachIds(row.photos);
      const photos = attachIdList.map((attachId, i) => ({
        key: `r-${attachId}`,
        attachId,
        src: '',
      }));

      this.setData({
        itemId: row.id,
        itemVersion: row.version,
        name: row.name || '',
        ip: row.ip || '',
        character_name: row.character_name || '',
        categoryIndex: findIndexByValue(itemService.CATEGORIES, row.category, 0),
        versionTypeIndex: findIndexByValue(
          itemService.VERSION_TYPES,
          row.version_type,
          0
        ),
        circle: row.circle || '',
        author: row.author || '',
        statusIndex: findIndexByValue(itemService.STATUSES, row.status, 1),
        location: row.location || '',
        purchase_price: formatPrice(row.purchase_price),
        purchase_date: formatDate(row.purchase_date),
        purchase_source: row.purchase_source || '',
        order_no: row.order_no || '',
        tags,
        note: row.note || '',
        photos,
        deletedAttachIds: [],
        loading: false,
      });

      await this.loadRemotePhotos(row.id, attachIdList);
    } catch (err) {
      this.setData({ loading: false });
      wx.showToast({
        title: err.message || '加载失败',
        icon: 'none',
        duration: 2500,
      });
    } finally {
      wx.hideLoading();
    }
  },

  async loadRemotePhotos(rowId, attachIdList) {
    const jobs = attachIdList.map(async (attachId, index) => {
      try {
        const src = await itemService.loadCover(rowId, attachId, 400);
        if (!src) {
          return;
        }
        // 用户可能已删掉该槽位
        const current = this.data.photos[index];
        if (!current || current.attachId !== attachId) {
          const hit = this.data.photos.findIndex((p) => p.attachId === attachId);
          if (hit < 0) {
            return;
          }
          this.setData({ [`photos[${hit}].src`]: src });
          return;
        }
        this.setData({ [`photos[${index}].src`]: src });
      } catch (e) {
        // 单张失败忽略
      }
    });
    await Promise.all(jobs);
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ [field]: e.detail.value });
  },

  onCategoryChange(e) {
    this.setData({ categoryIndex: Number(e.detail.value) });
  },

  onVersionTypeChange(e) {
    this.setData({ versionTypeIndex: Number(e.detail.value) });
  },

  onStatusChange(e) {
    this.setData({ statusIndex: Number(e.detail.value) });
  },

  onDateChange(e) {
    this.setData({ purchase_date: e.detail.value });
  },

  choosePhotos() {
    const remain = 9 - this.data.photos.length;
    if (remain <= 0) {
      wx.showToast({ title: '最多 9 张图', icon: 'none' });
      return;
    }
    wx.chooseMedia({
      count: remain,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const stamp = Date.now();
        const added = (res.tempFiles || []).map((f, i) => ({
          key: `l-${stamp}-${i}`,
          src: f.tempFilePath,
          localPath: f.tempFilePath,
        }));
        this.setData({
          photos: this.data.photos.concat(added),
        });
      },
    });
  },

  removePhoto(e) {
    const index = Number(e.currentTarget.dataset.index);
    const photos = this.data.photos.slice();
    const removed = photos.splice(index, 1)[0];
    if (!removed) {
      return;
    }
    const patch = { photos };
    if (removed.attachId) {
      patch.deletedAttachIds = this.data.deletedAttachIds.concat([
        removed.attachId,
      ]);
    }
    this.setData(patch);
  },

  collectForm() {
    return {
      name: (this.data.name || '').trim() || '未命名',
      ip: this.data.ip,
      character_name: this.data.character_name,
      category: this.data.categories[this.data.categoryIndex].value,
      version_type: this.data.versionTypes[this.data.versionTypeIndex].value,
      circle: this.data.circle,
      author: this.data.author,
      status: this.data.statuses[this.data.statusIndex].value,
      location: this.data.location,
      purchase_price: this.data.purchase_price,
      purchase_date: this.data.purchase_date
        ? `${this.data.purchase_date} 00:00:00`
        : '',
      purchase_source: this.data.purchase_source,
      order_no: this.data.order_no,
      tags: this.data.tags,
      note: this.data.note,
    };
  },

  async handleSave() {
    if (this.data.saving || this.data.loading) {
      return;
    }

    const name = (this.data.name || '').trim();
    const hasPhoto = this.data.photos.length > 0;
    if (!name && !hasPhoto) {
      wx.showToast({ title: '请填写名称或添加图片', icon: 'none' });
      return;
    }

    const form = this.collectForm();
    if (!name) {
      form.name = '未命名';
    }

    this.setData({ saving: true });
    wx.showLoading({ title: '保存中', mask: true });

    try {
      const localPaths = this.data.photos
        .filter((p) => p.localPath)
        .map((p) => p.localPath);
      let newPhotoFiles = [];
      if (localPaths.length) {
        newPhotoFiles = await itemService.uploadLocalImages(localPaths);
      }

      if (this.data.mode === 'edit') {
        await itemService.update(
          this.data.itemId,
          this.data.itemVersion,
          form,
          {
            newPhotoFiles,
            deleteAttachIds: this.data.deletedAttachIds,
          }
        );
        itemService.clearCoverCache();
      } else {
        await itemService.create(form, newPhotoFiles);
      }

      wx.hideLoading();
      wx.showToast({ title: '已保存', icon: 'success' });
      setTimeout(() => {
        wx.navigateBack({
          fail: () => wx.switchTab({ url: '/pages/library/index' }),
        });
      }, 500);
    } catch (err) {
      wx.hideLoading();
      wx.showToast({
        title: err.message || '保存失败',
        icon: 'none',
        duration: 2500,
      });
    } finally {
      this.setData({ saving: false });
    }
  },

  handleCancel() {
    wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/library/index' }) });
  },
});
