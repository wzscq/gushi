const auth = require('../../services/auth');

Page({
  data: {
    user: null,
  },

  onShow() {
    if (!auth.ensureLogin()) {
      return;
    }
    this.setData({
      user: auth.getUser() || getApp().globalData.user,
    });
  },

  goSettings() {
    wx.navigateTo({ url: '/pages/me/settings' });
  },
});
