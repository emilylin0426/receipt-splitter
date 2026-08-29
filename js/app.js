const LOCAL_KEY = 'receiptSplitter.localRecords';

let baseData = { people: [], records: [] };
let localRecords = [];
let chartInstance = null;

init();

async function init() {
  bindTabs();
  bindAddView();
  loadLocalRecords();
  await loadBaseData();
  populateFilters();
  renderAll();
}

async function loadBaseData() {
  try {
    const res = await fetch('data/expenses.json', { cache: 'no-store' });
    baseData = await res.json();
  } catch (e) {
    console.error('讀取 data/expenses.json 失敗', e);
    baseData = { people: [], records: [] };
  }
}

function getAllRecords() {
  return [...baseData.records, ...localRecords];
}

function getAllPeople() {
  const set = new Set(baseData.people || []);
  getAllRecords().forEach(r => {
    if (r.payer) set.add(r.payer);
    (r.items || []).forEach(it => (it.sharedBy || []).forEach(p => set.add(p)));
  });
  return [...set];
}

/* ---------------- tabs ---------------- */

function bindTabs() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('view-' + btn.dataset.view).classList.add('active');
      if (btn.dataset.view === 'settle') renderSettlement();
    });
  });
}

/* ---------------- render: list + chart ---------------- */

function renderAll() {
  const count = getAllRecords().length;
  document.getElementById('recordCount').textContent = `${count} 筆紀錄`;
  renderList();
  renderChart();
  renderSettlement();
  renderLocalList();
}

function populateFilters() {
  const people = getAllPeople();
  const stores = [...new Set(getAllRecords().map(r => r.store).filter(Boolean))];

  const personSel = document.getElementById('filterPerson');
  people.forEach(p => personSel.insertAdjacentHTML('beforeend', `<option value="${escapeAttr(p)}">${escapeHtml(p)}</option>`));

  const storeSel = document.getElementById('filterStore');
  stores.forEach(s => storeSel.insertAdjacentHTML('beforeend', `<option value="${escapeAttr(s)}">${escapeHtml(s)}</option>`));

  [personSel, storeSel, document.getElementById('filterDate')].forEach(el =>
    el.addEventListener('change', renderList)
  );
  document.getElementById('clearFilters').addEventListener('click', () => {
    personSel.value = ''; storeSel.value = ''; document.getElementById('filterDate').value = '';
    renderList();
  });
}

function getFilteredRecords() {
  const person = document.getElementById('filterPerson').value;
  const store = document.getElementById('filterStore').value;
  const date = document.getElementById('filterDate').value;

  return getAllRecords()
    .filter(r => !date || r.date === date)
    .filter(r => !store || r.store === store)
    .filter(r => !person || r.payer === person || (r.items || []).some(it => (it.sharedBy || []).includes(person)))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

function renderList() {
  const container = document.getElementById('recordList');
  const records = getFilteredRecords();

  if (records.length === 0) {
    container.innerHTML = '<div class="empty-state">沒有符合條件的紀錄</div>';
    return;
  }

  container.innerHTML = records.map(r => {
    const total = recordTotal(r);
    const isLocal = localRecords.some(lr => lr.id === r.id);
    return `
      <div class="receipt-card" data-id="${escapeAttr(r.id)}">
        <div class="row-top">
          <span class="store">${escapeHtml(r.store)}${isLocal ? '<span class="local-badge">本機</span>' : ''}</span>
          <span class="date">${escapeHtml(r.date)}</span>
        </div>
        <div class="payer-line">由 <b>${escapeHtml(r.payer)}</b> 付款 · 共 ${(r.items || []).length} 項</div>
        <div class="toggle-hint">點擊展開細項 ▾</div>
        <div class="items">
          ${(r.items || []).map(it => `
            <div class="item-row">
              <div>
                <div class="item-name">${escapeHtml(it.name)}</div>
                <div class="item-shared">${(it.sharedBy || []).map(escapeHtml).join('、') || '全員均分'}</div>
              </div>
              <div class="item-price">¥${formatNum(it.price)}</div>
            </div>
          `).join('')}
          <div class="total-row"><span>合計</span><span>¥${formatNum(total)}</span></div>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.receipt-card').forEach(card => {
    card.addEventListener('click', () => card.classList.toggle('expanded'));
  });
}

function renderChart() {
  const people = getAllPeople();
  const records = getAllRecords();
  const { paid, owed } = calcBalances(records, people);

  const ctx = document.getElementById('spendChart');
  if (chartInstance) chartInstance.destroy();
  chartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: people,
      datasets: [{
        label: '實際分攤金額（owed）',
        data: people.map(p => Math.round(owed[p] || 0)),
        backgroundColor: '#b4392b'
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: { y: { beginAtZero: true } }
    }
  });
}

/* ---------------- settlement ---------------- */

function renderSettlement() {
  const people = getAllPeople();
  const records = getAllRecords();
  const { balances } = calcBalances(records, people);

  const balanceList = document.getElementById('balanceList');
  if (people.length === 0) {
    balanceList.innerHTML = '<li>尚無資料</li>';
  } else {
    balanceList.innerHTML = people.map(p => {
      const v = balances[p];
      const cls = v > 0 ? 'pos' : v < 0 ? 'neg' : '';
      const sign = v > 0 ? '+' : '';
      return `<li><span>${escapeHtml(p)}</span><span class="amt ${cls}">${sign}¥${formatNum(v)}</span></li>`;
    }).join('');
  }

  const settlementDiv = document.getElementById('settlementList');
  const transactions = simplifyDebts(balances);
  if (transactions.length === 0) {
    settlementDiv.innerHTML = '<div class="empty-state">目前帳務已平衡，不需要轉帳</div>';
  } else {
    settlementDiv.innerHTML = transactions.map(t => `
      <div class="settlement-item">
        <span>${escapeHtml(t.from)}</span>
        <span class="arrow">→</span>
        <span>${escapeHtml(t.to)}</span>
        <span class="amt">¥${formatNum(t.amount)}</span>
      </div>
    `).join('');
  }
}

/* ---------------- add record view ---------------- */

let pendingRecord = null;

function bindAddView() {
  document.getElementById('previewBtn').addEventListener('click', handlePreview);
  document.getElementById('addBtn').addEventListener('click', handleAddLocal);
  document.getElementById('exportBtn').addEventListener('click', handleExport);
  document.getElementById('clearLocalBtn').addEventListener('click', handleClearLocal);
}

function handlePreview() {
  const raw = document.getElementById('jsonInput').value.trim();
  const errorBox = document.getElementById('addError');
  const previewArea = document.getElementById('previewArea');
  const addBtn = document.getElementById('addBtn');

  errorBox.style.display = 'none';
  previewArea.innerHTML = '';
  addBtn.disabled = true;
  pendingRecord = null;

  if (!raw) {
    showAddError('請先貼上 JSON');
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    showAddError('JSON 格式錯誤：' + e.message);
    return;
  }

  const validation = validateRecord(parsed);
  if (validation) {
    showAddError(validation);
    return;
  }

  if (!parsed.id) {
    parsed.id = `${parsed.date}-${Math.random().toString(36).slice(2, 6)}`;
  }

  pendingRecord = parsed;
  const total = recordTotal(parsed);
  previewArea.innerHTML = `
    <div class="receipt-card expanded">
      <div class="row-top">
        <span class="store">${escapeHtml(parsed.store)}</span>
        <span class="date">${escapeHtml(parsed.date)}</span>
      </div>
      <div class="payer-line">由 <b>${escapeHtml(parsed.payer)}</b> 付款</div>
      <div class="items" style="display:block">
        ${parsed.items.map(it => `
          <div class="item-row">
            <div>
              <div class="item-name">${escapeHtml(it.name)}</div>
              <div class="item-shared">${(it.sharedBy || []).map(escapeHtml).join('、') || '全員均分'}</div>
            </div>
            <div class="item-price">¥${formatNum(it.price)}</div>
          </div>
        `).join('')}
        <div class="total-row"><span>合計</span><span>¥${formatNum(total)}</span></div>
      </div>
    </div>
  `;
  addBtn.disabled = false;
}

function validateRecord(r) {
  if (typeof r !== 'object' || r === null) return '最外層必須是一個物件';
  if (!r.date) return '缺少 date 欄位';
  if (!r.store) return '缺少 store 欄位';
  if (!r.payer) return '缺少 payer 欄位';
  if (!Array.isArray(r.items) || r.items.length === 0) return 'items 必須是至少一項的陣列';
  for (const it of r.items) {
    if (!it.name) return '每個 item 都需要 name';
    if (typeof it.price !== 'number') return `品項「${it.name || ''}」的 price 必須是數字`;
  }
  return null;
}

function showAddError(msg) {
  const errorBox = document.getElementById('addError');
  errorBox.textContent = msg;
  errorBox.style.display = 'block';
}

function handleAddLocal() {
  if (!pendingRecord) return;
  localRecords.push(pendingRecord);
  saveLocalRecords();
  pendingRecord = null;
  document.getElementById('jsonInput').value = '';
  document.getElementById('previewArea').innerHTML = '';
  document.getElementById('addBtn').disabled = true;
  renderAll();
  populateFilters();
}

function renderLocalList() {
  const container = document.getElementById('localList');
  if (localRecords.length === 0) {
    container.innerHTML = '<div class="empty-state">目前沒有暫存在本機的新紀錄</div>';
    return;
  }
  container.innerHTML = localRecords.map(r => `
    <div class="receipt-card" data-id="${escapeAttr(r.id)}">
      <div class="row-top">
        <span class="store">${escapeHtml(r.store)}<span class="local-badge">本機</span></span>
        <span class="date">${escapeHtml(r.date)}</span>
      </div>
      <div class="payer-line">由 <b>${escapeHtml(r.payer)}</b> 付款 · 合計 ¥${formatNum(recordTotal(r))}</div>
    </div>
  `).join('');
}

function handleExport() {
  const merged = {
    people: getAllPeople(),
    records: [...baseData.records, ...localRecords].sort((a, b) => (a.date < b.date ? -1 : 1))
  };
  const blob = new Blob([JSON.stringify(merged, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'expenses.json';
  a.click();
  URL.revokeObjectURL(url);
}

function handleClearLocal() {
  if (!confirm('確定要清空本機暫存的紀錄嗎？（尚未匯出的資料會遺失）')) return;
  localRecords = [];
  saveLocalRecords();
  renderAll();
}

function loadLocalRecords() {
  try {
    localRecords = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]');
  } catch (e) {
    localRecords = [];
  }
}

function saveLocalRecords() {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(localRecords));
}

/* ---------------- utils ---------------- */

function formatNum(n) {
  return Number(n || 0).toLocaleString('ja-JP');
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function escapeAttr(str) {
  return escapeHtml(str);
}
