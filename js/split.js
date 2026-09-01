// 分帳計算：純函式，不碰 DOM，方便獨立測試或重複使用。

const PUBLIC_PAYER = '公用支出';

/**
 * 一個品項，算出每個「分攤對象」各要負擔多少錢。
 * 回傳 { 對象名稱: 金額 }，對象可能是某個人，也可能是 PUBLIC_PAYER。
 *
 * 分攤資料放在 item.split = [{ who, units }, ...]
 *   - units 是「分幾個」；單一數量的品項就是每個對象 units = 1，等於均分那一份
 *   - 沒有 split（或空陣列）→ 整筆算公用支出（不均分給任何人）
 *   - 舊格式 item.sharedBy = ["A", "B"] 會被視為 [{ who:"A", units:1 }, { who:"B", units:1 }]
 */
function itemShares(item) {
  const price = Number((item && item.price) || 0);
  let split = Array.isArray(item && item.split)
    ? item.split.filter(s => s && s.who && Number(s.units) > 0)
    : null;

  if ((!split || split.length === 0) &&
      Array.isArray(item && item.sharedBy) && item.sharedBy.length) {
    split = item.sharedBy.map(w => ({ who: w, units: 1 }));
  }

  const out = {};

  if (!split || split.length === 0) {
    out[PUBLIC_PAYER] = price;
    return out;
  }

  const totalUnits = split.reduce((s, x) => s + Number(x.units || 0), 0) || 1;
  split.forEach(x => {
    out[x.who] = (out[x.who] || 0) + price * Number(x.units || 0) / totalUnits;
  });
  return out;
}

/** 這個品項有沒有真的被分帳過（有 split，或舊的 sharedBy）。 */
function itemHasSplit(item) {
  return (Array.isArray(item && item.split) && item.split.some(s => s && s.who && Number(s.units) > 0)) ||
         (Array.isArray(item && item.sharedBy) && item.sharedBy.length > 0);
}

/** 一個品項目前分攤掉的總 units（用來回填「總數量」欄位）。 */
function splitUnitTotal(item) {
  if (!item || !Array.isArray(item.split)) return 0;
  return item.split.reduce((s, x) => s + (Number(x && x.units) || 0), 0);
}

function recordTotal(record) {
  return (record.items || []).reduce((sum, it) => sum + Number(it.price || 0), 0);
}
