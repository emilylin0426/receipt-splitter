const LOCAL_KEY = 'receiptSplitter.localRecords';
const NOTE_KEY = 'receiptSplitter.itemNotes';

let baseData = { people: [], records: [] };
let localRecords = [];
let chartInstance = null;

init();

async function init() {
  bindTabs();
  bindAddView();
  bindFilters();
  bindNoteEditing();
  loadLocalRecords();
  await loadBaseData();
  backfillIds();
  applyNoteOverlay();
  populateFilters();
  renderAll();
}

// 保底：每筆紀錄都要有 id，備註才有穩定的 key 可以掛。
function backfillIds() {
  (baseData.records || []).forEach((r, i) => {
    if (!r.id) r.id = `${r.date || 'rec'}-${i}`;
  });
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

function bindFilters() {
  const personSel = document.getElementById('filterPerson');
  const storeSel = document.getElementById('filterStore');
  const dateInput = document.getElementById('filterDate');

  [personSel, storeSel, dateInput].forEach(el => el.addEventListener('change', renderList));
  document.getElementById('clearFilters').addEventListener('click', () => {
    personSel.value = ''; storeSel.value = ''; dateInput.value = '';
    renderList();
  });
}

// 每次資料變動都會重建選項，所以要保留使用者當下的選擇。
function populateFilters() {
  const people = getAllPeople();
  const stores = [...new Set(getAllRecords().map(r => r.store).filter(Boolean))];

  fillSelect(document.getElementById('filterPerson'), people, '全部人員');
  fillSelect(document.getElementById('filterStore'), stores, '全部店家');
}

function fillSelect(sel, values, allLabel) {
  const previous = sel.value;
  sel.innerHTML = `<option value="">${allLabel}</option>` +
    values.map(v => `<option value="${escapeAttr(v)}">${escapeHtml(v)}</option>`).join('');
  if (values.includes(previous)) sel.value = previous;
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
          ${(r.items || []).map((it, idx) => `
            <div class="item-row">
              <div class="item-main">
                <div class="item-name" data-note-trigger data-record="${escapeAttr(r.id)}" data-index="${idx}" title="點一下加中文註解">${escapeHtml(it.name)}</div>
                <div class="item-shared">${(it.sharedBy || []).map(escapeHtml).join('、') || '全員均分'}</div>
              </div>
              <div class="item-note" data-note-cell data-record="${escapeAttr(r.id)}" data-index="${idx}">${it.note ? escapeHtml(it.note) : ''}</div>
              <div class="item-price">¥${formatNum(it.price)}</div>
            </div>
          `).join('')}
          <div class="total-row"><span>合計</span><span>¥${formatNum(total)}</span></div>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.receipt-card').forEach(card => {
    card.addEventListener('click', e => {
      // 點品名或備註欄是要編輯註解，不要順便把卡片收合／展開
      if (e.target.closest('.item-name') || e.target.closest('.item-note')) return;
      card.classList.toggle('expanded');
    });
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

/* ---------------- per-item chinese notes ---------------- */

/*
 * 備註存兩個地方：
 *  1. 直接掛在 record.items[i].note 上，這樣「匯出完整資料檔」會一起帶出去，push 之後大家都看得到。
 *  2. 另外在 localStorage 疊一份 overlay，讓還沒匯出就重新整理頁面時備註不會消失。
 * 讀完 data/expenses.json 後，用 overlay 蓋一次，之後才 render。
 */

function loadNoteOverlay() {
  try {
    return JSON.parse(localStorage.getItem(NOTE_KEY) || '{}');
  } catch (e) {
    return {};
  }
}

function saveNoteOverlay(overlay) {
  localStorage.setItem(NOTE_KEY, JSON.stringify(overlay));
}

function applyNoteOverlay() {
  const overlay = loadNoteOverlay();
  getAllRecords().forEach(r => {
    const notes = overlay[r.id];
    if (!notes) return;
    (r.items || []).forEach((it, i) => {
      const n = notes[i];
      if (n != null && n !== '') it.note = n;
    });
  });
}

function bindNoteEditing() {
  const list = document.getElementById('recordList');
  list.addEventListener('click', e => {
    const trigger = e.target.closest('[data-note-trigger]');
    if (!trigger) return;
    openNoteEditor(trigger.dataset.record, Number(trigger.dataset.index));
  });
}

function findNoteCell(recordId, index) {
  return [...document.querySelectorAll('#recordList .item-note')]
    .find(c => c.dataset.record === recordId && Number(c.dataset.index) === index);
}

function renderNoteCell(cell, item) {
  cell.textContent = item && item.note ? item.note : '';
}

function setNote(record, index, rawValue) {
  const item = (record.items || [])[index];
  if (!item) return;
  const value = String(rawValue).trim();

  if (value) item.note = value;
  else delete item.note;

  const overlay = loadNoteOverlay();
  const bucket = overlay[record.id] || (overlay[record.id] = {});
  if (value) {
    bucket[index] = value;
  } else {
    delete bucket[index];
    if (Object.keys(bucket).length === 0) delete overlay[record.id];
  }
  saveNoteOverlay(overlay);

  // 本機暫存紀錄的備註也要寫回 localRecords
  if (localRecords.some(lr => lr.id === record.id)) saveLocalRecords();
}

function openNoteEditor(recordId, index) {
  const cell = findNoteCell(recordId, index);
  if (!cell || cell.querySelector('input')) return;

  const record = getAllRecords().find(r => r.id === recordId);
  const item = record && (record.items || [])[index];
  if (!item) return;

  cell.textContent = '';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'note-input';
  input.value = item.note || '';
  input.maxLength = 40;
  input.placeholder = '中文註解';
  cell.appendChild(input);
  input.focus();
  input.select();

  let closed = false;
  const close = (save) => {
    if (closed) return;
    closed = true;
    if (save) setNote(record, index, input.value);
    renderNoteCell(cell, item);
  };

  input.addEventListener('click', e => e.stopPropagation());
  input.addEventListener('blur', () => close(true));
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    else if (e.key === 'Escape') { e.preventDefault(); close(false); }
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
            <div class="item-main">
              <div class="item-name">${escapeHtml(it.name)}</div>
              <div class="item-shared">${(it.sharedBy || []).map(escapeHtml).join('、') || '全員均分'}</div>
            </div>
            <div class="item-note">${it.note ? escapeHtml(it.note) : ''}</div>
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
