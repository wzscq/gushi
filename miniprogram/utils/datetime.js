/**
 * 将 CRV/MySQL 返回的 UTC 时间转为设备本地时区展示。
 * 无时区标记时按 UTC 解析（避免被当成已是本地时间）。
 */

function pad2(n) {
  return String(n).padStart(2, '0');
}

function parseUtcDate(value) {
  if (value == null || value === '') {
    return null;
  }
  let s = String(value).trim();
  if (!s) {
    return null;
  }
  s = s.replace(' ', 'T');
  // 已有 Z / ±offset 则原样解析
  if (!/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) {
    s += 'Z';
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  return d;
}

/** 本地时区「YYYY-MM-DD HH:mm」 */
function formatLocalDateTime(value) {
  const d = parseUtcDate(value);
  if (!d) {
    if (!value) {
      return '';
    }
    const s = String(value).replace('T', ' ');
    return s.length >= 16 ? s.slice(0, 16) : s;
  }
  return (
    `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ` +
    `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  );
}

module.exports = {
  parseUtcDate,
  formatLocalDateTime,
};
