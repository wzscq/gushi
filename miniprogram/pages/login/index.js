const auth = require('../../services/auth');
const userService = require('../../services/user');

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
    const avatarUrl = (e.detail && e.detail.avatarUrl) || '';
    this.setData({ avatarUrl });
  },

  onNicknameInput(e) {
    const value =
      (e.detail && (e.detail.value != null ? e.detail.value : e.detail.nickname)) ||
      '';
    this.setData({ nickname: value });
  },

  async handleLogin() {
    if (this.data.loading) {
      return;
    }

    this.setData({ loading: true, error: '' });

    try {
      const localAvatar = this.data.avatarUrl || '';
      const needUpload = userService.isLocalFilePath(localAvatar);

      // 本地临时路径不传给 Auth；登录成功后再走 CRV upload
      await auth.login({
        nickname: (this.data.nickname || '').trim(),
        avatar_url: needUpload ? '' : localAvatar,
      });

      if (needUpload) {
        wx.showLoading({ title: '上传头像', mask: true });
        try {
          await userService.uploadAndSaveAvatar(localAvatar);
        } catch (uploadErr) {
          // 登录已成功，头像失败不阻断进入私库
          console.warn('avatar upload failed', uploadErr);
          wx.showToast({
            title: '头像上传失败，可稍后重试',
            icon: 'none',
          });
        } finally {
          wx.hideLoading();
        }
      }

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
