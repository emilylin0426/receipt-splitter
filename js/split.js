// 分帳計算邏輯：純函式，不碰 DOM，方便之後寫測試或重複使用。

/**
 * 計算每人「應付」「已付」「淨額」
 * 淨額 = 已付 - 應付
 *   > 0 代表這個人多墊了錢，別人欠他
 *   < 0 代表這個人還欠別人錢
 */
function calcBalances(records, people) {
  const paid = {};
  const owed = {};
  people.forEach(p => { paid[p] = 0; owed[p] = 0; });

  records.forEach(record => {
    const items = record.items || [];
    const total = items.reduce((sum, it) => sum + Number(it.price || 0), 0);

    if (record.payer) {
      paid[record.payer] = (paid[record.payer] || 0) + total;
    }

    items.forEach(item => {
      const sharedBy = (item.sharedBy && item.sharedBy.length) ? item.sharedBy : people;
      const share = Number(item.price || 0) / sharedBy.length;
      sharedBy.forEach(person => {
        owed[person] = (owed[person] || 0) + share;
      });
    });
  });

  const balances = {};
  people.forEach(p => {
    balances[p] = round2((paid[p] || 0) - (owed[p] || 0));
  });
  return { balances, paid, owed };
}

/**
 * 債務簡化：把正餘額的人和負餘額的人互相沖銷，
 * 用貪婪演算法（每次抓最大債權人配最大債務人）產生最少轉帳筆數。
 */
function simplifyDebts(balances) {
  const creditors = [];
  const debtors = [];

  Object.entries(balances).forEach(([person, amount]) => {
    if (amount > 0.5) creditors.push({ person, amount });
    else if (amount < -0.5) debtors.push({ person, amount: -amount });
  });

  creditors.sort((a, b) => b.amount - a.amount);
  debtors.sort((a, b) => b.amount - a.amount);

  const transactions = [];
  let i = 0, j = 0;

  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i];
    const creditor = creditors[j];
    const amount = Math.min(debtor.amount, creditor.amount);

    if (amount > 0.5) {
      transactions.push({
        from: debtor.person,
        to: creditor.person,
        amount: round2(amount)
      });
    }

    debtor.amount -= amount;
    creditor.amount -= amount;

    if (debtor.amount < 0.5) i++;
    if (creditor.amount < 0.5) j++;
  }

  return transactions;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function recordTotal(record) {
  return (record.items || []).reduce((sum, it) => sum + Number(it.price || 0), 0);
}
