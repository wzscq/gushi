const auth = require('../../services/auth');
const marketService = require('../../services/market');
const { formatLocalDateTime } = require('../../utils/datetime');

const COVER_MAX_WIDTH = 240;
const SEARCH_DEBOUNCE_MS = 300;

Page({
  data: {
    tab: 'browse',
    loading: true,
    error: '',
    items: [],
    keyword: '',
    hasKeyword: false,
  },

  _loadGen: 0,
  _searchTimer: null,

  onShow() {
    if (!auth.ensureLogin()) {
      return;
    }
    this.reload(this.data.tab);
  },

  onPullDownRefresh() {
    this.reload(this.data.tab).finally(() => wx.stopPullDownRefresh());
  },

  onSwitchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    if (!tab || tab === this.data.tab) {
      return;
    }
    // 先切 tab 并清空列表，reload 使用显式 tab，避免 setData 竞态读到旧 tab
    this.setData({
      tab,
      keyword: '',
      hasKeyword: false,
      items: [],
      error: '',
      loading: true,
    });
    this.reload(tab);
  },

  onSearchInput(e) {
    const keyword = (e.detail && e.detail.value) || '';
    this.setData({ keyword, hasKeyword: !!String(keyword).trim() });
    if (this._searchTimer) {
      clearTimeout(this._searchTimer);
    }
    this._searchTimer = setTimeout(() => this.reload(this.data.tab), SEARCH_DEBOUNCE_MS);
  },

  onSearchConfirm() {
    if (this._searchTimer) {
      clearTimeout(this._searchTimer);
    }
    this.reload(this.data.tab);
  },

  onClearSearch() {
    this.setData({ keyword: '', hasKeyword: false });
    this.reload(this.data.tab);
  },

  /**
   * @param {string} [tabOverride] 显式指定 browse|mine，切换 Tab 时必传
   */
  async reload(tabOverride) {
    if (!auth.isLoggedIn()) {
      this.setData({ loading: false });
      return;
    }

    const tab = tabOverride || this.data.tab;
    const keyword = this.data.keyword;
    const gen = ++this._loadGen;
    this.setData({ loading: true, error: '' });

    try {
      const data =
        tab === 'mine'
          ? await marketService.listMyShelf({ pageSize: 100 })
          : await marketService.listMarket({
              pageSize: 100,
              keyword,
            });

      if (gen !== this._loadGen) {
        return;
      }

      const raw = (data && data.list) || [];
      let sellerMap = {};
      if (tab === 'browse' && raw.length) {
        sellerMap = await marketService.fetchSellerNicknames(
          raw.map((r) => r.create_user)
        );
        if (gen !== this._loadGen) {
          return;
        }
      } else if (tab === 'mine') {
        const me = auth.getUser() || {};
        if (me.id) {
          sellerMap[me.id] = me.nickname || '';
        }
      }

      const items = raw.map((row) => ({
        id: row.id,
        title: row.title || '未命名',
        initial: (row.title || '市').slice(0, 1),
        priceText: marketService.formatPrice(row.sell_price),
        status: row.status,
        sellerName: sellerMap[row.create_user] || '',
        listedAtText: formatLocalDateTime(row.listed_at || row.update_time),
        coverSrc: '',
        _attachId: marketService.firstAttachId(row.photos),
      }));

      this.setData({ items, loading: false, error: '' });
      this.loadCovers(items, gen);
    } catch (err) {
      if (gen !== this._loadGen) {
        return;
      }
      this.setData({
        loading: false,
        error: err.message || '加载失败',
        items: [],
      });
    }
  },

  async loadCovers(items, gen) {
    for (let i = 0; i < items.length; i += 1) {
      if (gen !== this._loadGen) {
        return;
      }
      const it = items[i];
      if (!it._attachId) {
        continue;
      }
      try {
        const coverSrc = await marketService.loadCover(
          it.id,
          it._attachId,
          COVER_MAX_WIDTH,
          { force: true }
        );
        if (gen !== this._loadGen || !coverSrc) {
          continue;
        }
        this.setData({ [`items[${i}].coverSrc`]: coverSrc });
      } catch (e) {
        // ignore cover errors
      }
    }
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) {
      return;
    }
    wx.navigateTo({ url: `/pages/market/detail?id=${id}` });
  },
});
