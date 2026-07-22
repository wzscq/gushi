const auth = require('../../services/auth');

Page({
  handleLogout() {
    wx.showModal({
      title: '退出登录',
      content: '将清除本地会话，需要重新登录',
      success(res) {
        if (res.confirm) {
          auth.logout();
        }
      },
    });
  },
});
