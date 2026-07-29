const auth = require('../../services/auth');
const userService = require('../../services/user');

Page({
  data: {
    user: null,
    avatarSrc: '',
  },

  onShow() {
    if (!auth.ensureLogin()) {
      return;
    }
    const user = auth.getUser() || getApp().globalData.user;
    this.setData({ user, avatarSrc: '' });
    this.loadAvatar(user);
  },

  async loadAvatar(user) {
    if (!user) {
      return;
    }
    try {
      const avatarSrc = await userService.resolveAvatarSrc(user, { force: true });
      // 页面可能已切走
      if (!this.data.user) {
        return;
      }
      this.setData({
        avatarSrc,
        user: auth.getUser() || this.data.user,
      });
    } catch (e) {
      this.setData({ avatarSrc: '' });
    }
  },

  onAvatarError() {
    this.setData({ avatarSrc: '' });
  },

  goProfile() {
    wx.navigateTo({ url: '/pages/me/profile' });
  },

  goSettings() {
    wx.navigateTo({ url: '/pages/me/settings' });
  },
});
