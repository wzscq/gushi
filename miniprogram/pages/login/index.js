const auth = require('../../services/auth');

Page({
  data: {
    loading: false,
    error: '',
    nickname: '',
    avatarUrl: '',
  },

  onLoad() {
    if (auth.isLoggedIn()) {
      wx.switchTab({ url: '/pages/library/index' });
    }
  },

  onChooseAvatar(e) {
    this.setData({ avatarUrl: e.detail.avatarUrl || '' });
  },

  onNicknameInput(e) {
    this.setData({ nickname: e.detail.value || '' });
  },

  async handleLogin() {
    if (this.data.loading) {
      return;
    }

    this.setData({ loading: true, error: '' });

    try {
      await auth.login({
        nickname: this.data.nickname,
        avatar_url: this.data.avatarUrl,
      });
      wx.switchTab({ url: '/pages/library/index' });
    } catch (err) {
      this.setData({
        error: err.message || '登录失败，请重试',
      });
    } finally {
      this.setData({ loading: false });
    }
  },
});
