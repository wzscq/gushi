const auth = require('./services/auth');

App({
  globalData: {
    user: null,
  },

  onLaunch() {
    const user = auth.getUser();
    if (user) {
      this.globalData.user = user;
    }

    if (auth.isLoggedIn()) {
      auth.silentLogin()
        .then(() => {
          wx.switchTab({ url: '/pages/library/index' });
        })
        .catch(() => {
          // 保留本地 token，首次 CRV 请求若 401 再跳转登录
        });
    }
  },
});
