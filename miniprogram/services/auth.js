const env = require('../config/env');

const STORAGE = {
  TOKEN: 'access_token',
  USER: 'user',
  EXPIRES_AT: 'expires_at',
};

function saveSession(result) {
  wx.setStorageSync(STORAGE.TOKEN, result.access_token);
  wx.setStorageSync(STORAGE.USER, result.user || null);
  if (result.expires_in) {
    wx.setStorageSync(STORAGE.EXPIRES_AT, Date.now() + result.expires_in * 1000);
  }
  // 清理旧版缓存的 schema（session 模式无需前端持有）
  wx.removeStorageSync('schema');
}

function clearSession() {
  wx.removeStorageSync(STORAGE.TOKEN);
  wx.removeStorageSync(STORAGE.USER);
  wx.removeStorageSync(STORAGE.EXPIRES_AT);
  wx.removeStorageSync('schema');
}

function getToken() {
  return wx.getStorageSync(STORAGE.TOKEN) || '';
}

function getUser() {
  return wx.getStorageSync(STORAGE.USER) || null;
}

function setUser(user) {
  wx.setStorageSync(STORAGE.USER, user || null);
  const app = getApp();
  if (app) {
    app.globalData.user = user || null;
  }
}

function isLoggedIn() {
  return !!getToken();
}

function goLogin() {
  wx.reLaunch({ url: '/pages/login/index' });
}

function ensureLogin() {
  if (!isLoggedIn()) {
    goLogin();
    return false;
  }
  return true;
}

function login(profile = {}) {
  return new Promise((resolve, reject) => {
    wx.login({
      success(loginRes) {
        if (!loginRes.code) {
          reject(new Error('微信登录失败，未获取到 code'));
          return;
        }

        wx.request({
          url: `${env.AUTH_BASE_URL}/auth/wechat/miniprogram`,
          method: 'POST',
          header: { 'Content-Type': 'application/json' },
          data: {
            code: loginRes.code,
            nickname: profile.nickname || '',
            avatar_url: profile.avatar_url || '',
          },
          success(res) {
            if (res.statusCode === 200 && res.data && res.data.access_token) {
              saveSession(res.data);
              const app = getApp();
              if (app) {
                app.globalData.user = res.data.user;
              }
              resolve(res.data);
              return;
            }
            const msg = (res.data && res.data.message) || '登录失败，请重试';
            reject(new Error(msg));
          },
          fail(err) {
            reject(new Error(err.errMsg || '网络错误，请检查 Auth 服务'));
          },
        });
      },
      fail(err) {
        reject(new Error(err.errMsg || '微信登录失败'));
      },
    });
  });
}

/** 冷启动静默续登：刷新 CRV Session（失败时不强制清 token，由 CRV 401 处理） */
function silentLogin() {
  return login({});
}

function logout() {
  clearSession();
  const app = getApp();
  if (app) {
    app.globalData.user = null;
  }
  goLogin();
}

module.exports = {
  STORAGE,
  getToken,
  getUser,
  setUser,
  isLoggedIn,
  ensureLogin,
  goLogin,
  login,
  silentLogin,
  clearSession,
  logout,
};
