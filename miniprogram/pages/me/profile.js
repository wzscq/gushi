const auth = require('../../services/auth');
const userService = require('../../services/user');

Page({
  data: {
    nickname: '',
    avatarPreview: '',
    localAvatarPath: '',
    saving: false,
    error: '',
  },

  onLoad() {
    if (!auth.ensureLogin()) {
      return;
    }
    this.bootstrap();
  },

  async bootstrap() {
    const user = auth.getUser() || getApp().globalData.user || {};
    this.setData({
      nickname: user.nickname || '',
      avatarPreview: '',
      localAvatarPath: '',
      error: '',
    });
    try {
      const avatarPreview = await userService.resolveAvatarSrc(user, { force: true });
      this.setData({
        avatarPreview,
        nickname: (auth.getUser() || user).nickname || this.data.nickname,
      });
    } catch (e) {
      // 无头像时用字母占位
    }
  },

  onChooseAvatar(e) {
    const avatarUrl = (e.detail && e.detail.avatarUrl) || '';
    if (!avatarUrl) {
      return;
    }
    this.setData({
      localAvatarPath: avatarUrl,
      avatarPreview: avatarUrl,
      error: '',
    });
  },

  onNicknameInput(e) {
    const value =
      (e.detail && (e.detail.value != null ? e.detail.value : e.detail.nickname)) ||
      '';
    this.setData({ nickname: value });
  },

  async handleSave() {
    if (this.data.saving) {
      return;
    }
    if (!auth.ensureLogin()) {
      return;
    }

    this.setData({ saving: true, error: '' });
    wx.showLoading({ title: '保存中', mask: true });

    try {
      await userService.saveProfile({
        nickname: (this.data.nickname || '').trim(),
        localAvatarPath: this.data.localAvatarPath || '',
      });
      wx.showToast({ title: '已保存', icon: 'success' });
      setTimeout(() => {
        wx.navigateBack();
      }, 500);
    } catch (err) {
      this.setData({
        error: err.message || '保存失败，请重试',
      });
    } finally {
      wx.hideLoading();
      this.setData({ saving: false });
    }
  },
});
