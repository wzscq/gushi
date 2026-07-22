const auth = require('../../services/auth');

Page({
  data: {
    total: 0,
  },

  onShow() {
    if (!auth.ensureLogin()) {
      return;
    }
  },
});
