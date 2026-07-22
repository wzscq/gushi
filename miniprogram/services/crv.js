const env = require('../config/env');
const auth = require('./auth');

function isAuthFailure(statusCode, body) {
  if (statusCode === 401) {
    return true;
  }
  if (body && (body.code === 40101 || body.code === 401)) {
    return true;
  }
  const msg = (body && body.message) || '';
  return /session expired|revoked|unauthorized/i.test(msg);
}

function request(options) {
  const token = auth.getToken();
  if (!token) {
    auth.goLogin();
    return Promise.reject(new Error('未登录'));
  }

  return new Promise((resolve, reject) => {
    wx.request({
      url: `${env.CRV_BASE_URL}${options.path}`,
      method: options.method || 'POST',
      header: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        ...(options.header || {}),
      },
      data: options.data,
      success(res) {
        const body = res.data;
        if (isAuthFailure(res.statusCode, body)) {
          auth.clearSession();
          auth.goLogin();
          reject(new Error('会话已失效，请重新登录'));
          return;
        }

        if (!body || typeof body.code !== 'number') {
          reject(new Error('CRV 响应格式异常'));
          return;
        }

        if (body.code !== 0) {
          const err = new Error(body.message || `请求失败 (${body.code})`);
          err.code = body.code;
          err.httpStatus = res.statusCode;
          reject(err);
          return;
        }

        resolve(body.data);
      },
      fail(err) {
        reject(new Error(err.errMsg || '网络错误'));
      },
    });
  });
}

function query(payload) {
  return request({ path: '/v1/data/query', data: payload });
}

function save(payload) {
  return request({ path: '/v1/data/save', data: payload });
}

function uploadFile({ filePath, name, formData }) {
  const token = auth.getToken();
  if (!token) {
    auth.goLogin();
    return Promise.reject(new Error('未登录'));
  }

  return new Promise((resolve, reject) => {
    wx.uploadFile({
      url: `${env.CRV_BASE_URL}/v1/files/upload`,
      filePath,
      name: name || 'file',
      formData: formData || {},
      header: {
        Authorization: `Bearer ${token}`,
      },
      success(res) {
        let body;
        try {
          body = JSON.parse(res.data);
        } catch (e) {
          reject(new Error('上传响应解析失败'));
          return;
        }

        if (isAuthFailure(res.statusCode, body)) {
          auth.clearSession();
          auth.goLogin();
          reject(new Error('会话已失效，请重新登录'));
          return;
        }

        if (!body || body.code !== 0) {
          reject(new Error((body && body.message) || '上传失败'));
          return;
        }

        resolve(body.data);
      },
      fail(err) {
        reject(new Error(err.errMsg || '上传失败'));
      },
    });
  });
}

function downloadFile({ url, header }) {
  const token = auth.getToken();
  if (!token) {
    auth.goLogin();
    return Promise.reject(new Error('未登录'));
  }

  return new Promise((resolve, reject) => {
    wx.downloadFile({
      url,
      header: {
        Authorization: `Bearer ${token}`,
        ...(header || {}),
      },
      success(res) {
        if (res.statusCode === 401) {
          auth.clearSession();
          auth.goLogin();
          reject(new Error('会话已失效，请重新登录'));
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`下载失败 (${res.statusCode})`));
          return;
        }
        resolve(res.tempFilePath);
      },
      fail(err) {
        reject(new Error(err.errMsg || '下载失败'));
      },
    });
  });
}

module.exports = {
  request,
  query,
  save,
  uploadFile,
  downloadFile,
};
