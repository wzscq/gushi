const auth = require('../../services/auth');
const itemService = require('../../services/item');

const SEARCH_DEBOUNCE_MS = 300;

function emptyApplied() {
  return {
    ip: '',
    categories: [],
    statuses: [],
    tags: [],
  };
}

function emptyDraft() {
  return {
    ip: '',
    categories: [],
    statuses: [],
    tagsText: '',
  };
}

function parseTagsText(text) {
  return String(text || '')
    .split(/[,，\s]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function hasAppliedFilter(applied) {
  if (!applied) {
    return false;
  }
  return !!(
    (applied.ip && String(applied.ip).trim()) ||
    (applied.categories && applied.categories.length) ||
    (applied.statuses && applied.statuses.length) ||
    (applied.tags && applied.tags.length)
  );
}

function buildChipList(options, selectedValues) {
  const selected = new Set(selectedValues || []);
  return (options || []).map((opt) => ({
    value: opt.value,
    label: opt.label,
    selected: selected.has(opt.value),
  }));
}

function toggleValue(list, value) {
  const next = (list || []).slice();
  const idx = next.indexOf(value);
  if (idx >= 0) {
    next.splice(idx, 1);
  } else {
    next.push(value);
  }
  return next;
}

Page({
  data: {
    loading: true,
    error: '',
    items: [],
    keyword: '',
    hasKeyword: false,
    hasFilter: false,
    total: 0,

    filterOpen: false,
    draft: emptyDraft(),
    draftCategories: buildChipList(itemService.CATEGORIES, []),
    draftStatuses: buildChipList(itemService.STATUSES, []),
    applied: emptyApplied(),
  },

  _loadGen: 0,
  _searchTimer: null,

  onShow() {
    if (!auth.ensureLogin()) {
      return;
    }
    this.loadItems();
  },

  onUnload() {
    if (this._searchTimer) {
      clearTimeout(this._searchTimer);
      this._searchTimer = null;
    }
  },

  onPullDownRefresh() {
    this.loadItems({ refresh: true }).finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  onSearchInput(e) {
    const keyword = (e.detail && e.detail.value) || '';
    this.setData({
      keyword,
      hasKeyword: !!String(keyword).trim(),
    });
    if (this._searchTimer) {
      clearTimeout(this._searchTimer);
    }
    this._searchTimer = setTimeout(() => {
      this._searchTimer = null;
      this.loadItems();
    }, SEARCH_DEBOUNCE_MS);
  },

  onSearchConfirm() {
    if (this._searchTimer) {
      clearTimeout(this._searchTimer);
      this._searchTimer = null;
    }
    this.loadItems();
  },

  onClearSearch() {
    if (this._searchTimer) {
      clearTimeout(this._searchTimer);
      this._searchTimer = null;
    }
    this.setData({ keyword: '', hasKeyword: false });
    this.loadItems();
  },

  openFilter() {
    const applied = this.data.applied || emptyApplied();
    const draft = {
      ip: applied.ip || '',
      categories: (applied.categories || []).slice(),
      statuses: (applied.statuses || []).slice(),
      tagsText: (applied.tags || []).join(','),
    };
    this.setData({
      filterOpen: true,
      draft,
      draftCategories: buildChipList(itemService.CATEGORIES, draft.categories),
      draftStatuses: buildChipList(itemService.STATUSES, draft.statuses),
    });
  },

  closeFilter() {
    this.setData({ filterOpen: false });
  },

  onDraftInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({
      [`draft.${field}`]: (e.detail && e.detail.value) || '',
    });
  },

  toggleDraftCategory(e) {
    const value = e.currentTarget.dataset.value;
    const categories = toggleValue(this.data.draft.categories, value);
    this.setData({
      'draft.categories': categories,
      draftCategories: buildChipList(itemService.CATEGORIES, categories),
    });
  },

  toggleDraftStatus(e) {
    const value = e.currentTarget.dataset.value;
    const statuses = toggleValue(this.data.draft.statuses, value);
    this.setData({
      'draft.statuses': statuses,
      draftStatuses: buildChipList(itemService.STATUSES, statuses),
    });
  },

  resetDraft() {
    const draft = emptyDraft();
    this.setData({
      draft,
      draftCategories: buildChipList(itemService.CATEGORIES, []),
      draftStatuses: buildChipList(itemService.STATUSES, []),
    });
  },

  confirmFilter() {
    const draft = this.data.draft || emptyDraft();
    const applied = {
      ip: String(draft.ip || '').trim(),
      categories: (draft.categories || []).slice(),
      statuses: (draft.statuses || []).slice(),
      tags: parseTagsText(draft.tagsText),
    };
    this.setData({
      filterOpen: false,
      applied,
      hasFilter: hasAppliedFilter(applied),
    });
    this.loadItems();
  },

  clearFilter() {
    this.setData({
      applied: emptyApplied(),
      hasFilter: false,
      filterOpen: false,
    });
    this.loadItems();
  },

  async loadItems(options = {}) {
    const refresh = !!options.refresh;
    const gen = ++this._loadGen;
    const keyword = String(this.data.keyword || '').trim();
    const hasKeyword = !!keyword;
    const applied = this.data.applied || emptyApplied();
    const hasFilter = hasAppliedFilter(applied);

    // 已有列表时静默刷新，避免整页「加载中」卸掉 image 导致封面空白
    if (!this.data.items.length) {
      this.setData({ loading: true, error: '', hasKeyword, hasFilter });
    } else {
      this.setData({ error: '', hasKeyword, hasFilter });
    }

    const prevCover = {};
    (this.data.items || []).forEach((it) => {
      if (it.id && it.coverSrc) {
        prevCover[it.id] = it.coverSrc;
      }
    });

    try {
      const data = await itemService.list({
        page: 1,
        pageSize: 50,
        keyword,
        ip: applied.ip,
        categories: applied.categories,
        statuses: applied.statuses,
        tags: applied.tags,
      });
      if (gen !== this._loadGen) {
        return;
      }

      const list = ((data && data.list) || []).map((row) => {
        const name = row.name || '未命名';
        const attachId = itemService.firstAttachId(row.photos);
        return {
          id: row.id,
          name,
          initial: name.charAt(0) || '谷',
          attachId,
          coverSrc: refresh ? '' : prevCover[row.id] || '',
        };
      });
      const total =
        typeof data.total === 'number' ? data.total : list.length;
      this.setData({
        items: list,
        loading: false,
        hasKeyword,
        hasFilter,
        total,
      });
      await this.loadCovers(list, gen, { force: refresh });
    } catch (err) {
      if (gen !== this._loadGen) {
        return;
      }
      this.setData({
        error: err.message || '加载失败',
        items: refresh ? this.data.items : [],
        loading: false,
        hasKeyword,
        hasFilter,
      });
    }
  },

  async loadCovers(list, gen, options = {}) {
    const force = !!options.force;
    const jobs = list.map(async (item, index) => {
      if (!item.attachId) {
        return;
      }
      if (!force && item.coverSrc) {
        return;
      }
      try {
        const coverSrc = await itemService.loadCover(
          item.id,
          item.attachId,
          400,
          { force }
        );
        if (!coverSrc || gen !== this._loadGen) {
          return;
        }
        this.setData({
          [`items[${index}].coverSrc`]: coverSrc,
        });
      } catch (e) {
        // 单张失败不影响列表
      }
    });
    await Promise.all(jobs);
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) {
      return;
    }
    wx.navigateTo({
      url: `/pages/item/detail?id=${encodeURIComponent(id)}`,
    });
  },

  goCreate() {
    wx.navigateTo({ url: '/pages/item/form' });
  },
});
