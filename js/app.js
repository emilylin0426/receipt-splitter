const LOCAL_KEY = 'receiptSplitter.localRecords';
const EDIT_KEY = 'receiptSplitter.itemEdits';
const OLD_NOTE_KEY = 'receiptSplitter.itemNotes';

let baseData = { people: [], records: [] };
let localRecords = [];
let chartInstance = null;

init();

async function init() {
  bindTabs();
  bindAddView();
  bindFilters();
  bindItemEditing();
  loadLocalRecords();
  await loadBaseData();
  backfillIds();
  migrateOldEdits();
  applyEdits();
  populateFilters();
  renderAll();
}

// 保底：每筆紀錄都要有 id，備註 / 分帳的 overlay 才有穩定的 key 可以掛。
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

// 只回傳「人」，不含公用支出。
function getAllPeople() {
  const set = new Set(baseData.people || []);
  getAllRecords().forEach(r => {
    if (r.payer && r.payer !== PUBLIC_PAYER) set.add(r.payer);
    (r.items || []).forEach(it => {
      (it.split || []).forEach(s => { if (s && s.who && s.who !== PUBLIC_PAYER) set.add(s.who); });
      (it.sharedBy || []).forEach(p => set.add(p));
    });
  });
  return [...set];
}

// 分帳下拉選單的對象：所有人 + 公用支出。
function getShareTargets() {
  return [...getAllPeople(), PUBLIC_PAYER];
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

function recordConsumers(record) {
  const set = new Set();
  (record.items || []).forEach(it => {
    Object.keys(itemShares(it)).forEach(who => set.add(who));
  });
  return set;
}

function getFilteredRecords() {
  const person = document.getElementById('filterPerson').value;
  const store = document.getElementById('filterStore').value;
  const date = document.getElementById('filterDate').value;

  return getAllRecords()
    .filter(r => !date || r.date === date)
    .filter(r => !store || r.store === store)
    .filter(r => !person || r.payer === person || recordConsumers(r).has(person))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

// 品項的分帳摘要，沒有自訂分帳就回空字串（列表上什麼都不顯示）。
function splitSummary(item) {
  let rows = Array.isArray(item.split) && item.split.length ? item.split : null;
  if (!rows && Array.isArray(item.sharedBy) && item.sharedBy.length) {
    rows = item.sharedBy.map(w => ({ who: w, units: 1 }));
  }
  if (!rows) return '';
  return rows
    .filter(r => r && r.who)
    .map(r => {
      const who = r.who === PUBLIC_PAYER ? '公用' : r.who;
      return Number(r.units) > 1 ? `${who}×${r.units}` : who;
    })
    .join(' · ');
}

function renderList() {
  const container = document.getElementById('recordList');
  const expanded = new Set(
    [...container.querySelectorAll('.receipt-card.expanded')].map(c => c.dataset.id)
  );
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
        <div class="toggle-hint">點店名展開 / 收合細項 ▾</div>
        <div class="items">
          ${(r.items || []).map((it, idx) => {
            const sum = splitSummary(it);
            return `
            <div class="item-row">
              <div class="item-main">
                <div class="item-name" data-note-trigger data-record="${escapeAttr(r.id)}" data-index="${idx}" title="點品名可加中文註解 / 分帳">${escapeHtml(it.name)}</div>
                ${sum
                  ? `<div class="split-summary">${escapeHtml(sum)}</div>`
                  : `<div class="split-summary is-public">未分帳 → 公用支出</div>`}
              </div>
              <div class="item-note" data-note-cell data-record="${escapeAttr(r.id)}" data-index="${idx}">${it.note ? escapeHtml(it.note) : ''}</div>
              <div class="item-price">¥${formatNum(it.price)}</div>
            </div>`;
          }).join('')}
          <div class="total-row"><span>合計</span><span>¥${formatNum(total)}</span></div>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.receipt-card').forEach(card => {
    if (expanded.has(card.dataset.id)) card.classList.add('expanded');
    // 只有點店名才展開 / 收合
    const store = card.querySelector('.store');
    if (store) store.addEventListener('click', () => card.classList.toggle('expanded'));
  });
}

function renderChart() {
  const people = getAllPeople();
  const totals = {};
  people.forEach(p => { totals[p] = 0; });

  getAllRecords().forEach(r => (r.items || []).forEach(it => {
    Object.entries(itemShares(it)).forEach(([who, amt]) => {
      if (who === PUBLIC_PAYER) return;
      totals[who] = (totals[who] || 0) + amt;
    });
  }));

  const ctx = document.getElementById('spendChart');
  if (chartInstance) chartInstance.destroy();
  chartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: people,
      datasets: [{
        label: '每人分攤總額',
        data: people.map(p => Math.round(totals[p] || 0)),
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

/* ---------------- per-item edits: 中文備註 + 分帳 ---------------- */

/*
 * 備註和分帳都存兩個地方：
 *  1. 直接掛在 record.items[i] 上（it.note / it.split），「匯出完整資料檔」會一起帶出去，
 *     push 之後大家都看得到。
 *  2. 另外在 localStorage（EDIT_KEY）疊一份 overlay，讓還沒匯出就重新整理頁面時不會消失。
 * 讀完 data/expenses.json 後，用 overlay 蓋一次，之後才 render。
 *
 * overlay 結構：{ [recordId]: { [itemIndex]: { note?: string, split?: [{who,units}] } } }
 */

function loadEdits() {
  try {
    return JSON.parse(localStorage.getItem(EDIT_KEY) || '{}');
  } catch (e) {
    return {};
  }
}

function saveEdits(overlay) {
  localStorage.setItem(EDIT_KEY, JSON.stringify(overlay));
}

// 舊版本只存備註、格式是 { rid: { idx: "字串" } }，搬成新結構。
function migrateOldEdits() {
  if (localStorage.getItem(EDIT_KEY)) return;
  let old;
  try {
    old = JSON.parse(localStorage.getItem(OLD_NOTE_KEY) || 'null');
  } catch (e) {
    old = null;
  }
  if (!old) return;
  const next = {};
  Object.entries(old).forEach(([rid, notes]) => {
    next[rid] = {};
    Object.entries(notes).forEach(([idx, note]) => {
      if (note) next[rid][idx] = { note };
    });
  });
  saveEdits(next);
  localStorage.removeItem(OLD_NOTE_KEY);
}

function applyEdits() {
  const overlay = loadEdits();
  getAllRecords().forEach(r => {
    const bucket = overlay[r.id];
    if (!bucket) return;
    (r.items || []).forEach((it, i) => {
      const entry = bucket[i];
      if (!entry) return;
      if (entry.note != null && entry.note !== '') it.note = entry.note;
      if (Array.isArray(entry.split) && entry.split.length) it.split = entry.split;
    });
  });
}

function bindItemEditing() {
  const list = document.getElementById('recordList');
  list.addEventListener('click', e => {
    const trigger = e.target.closest('[data-note-trigger]');
    if (!trigger) return;
    openItemEditor(trigger.dataset.record, Number(trigger.dataset.index));
  });
}

function findNoteCell(recordId, index) {
  return [...document.querySelectorAll('#recordList .item-note')]
    .find(c => c.dataset.record === recordId && Number(c.dataset.index) === index);
}

function renderItemCell(cell, item) {
  cell.textContent = item && item.note ? item.note : '';
}

// 從現有品項讀出可編輯的分帳列（沒有就回空陣列）。
function currentSplitRows(item) {
  if (Array.isArray(item.split) && item.split.length) {
    return item.split
      .filter(s => s && s.who)
      .map(s => ({ who: s.who, units: Math.max(1, Math.floor(Number(s.units) || 1)) }));
  }
  if (Array.isArray(item.sharedBy) && item.sharedBy.length) {
    return item.sharedBy.map(w => ({ who: w, units: 1 }));
  }
  return [];
}

function openItemEditor(recordId, index) {
  const cell = findNoteCell(recordId, index);
  if (!cell || cell.classList.contains('editing')) return;

  const record = getAllRecords().find(r => r.id === recordId);
  const item = record && (record.items || [])[index];
  if (!item) return;

  const targets = getShareTargets();
  let rows = currentSplitRows(item);
  let total = Math.max(1, rows.reduce((s, r) => s + r.units, 0) || 1);

  // 註解輸入框留在原位（品名右邊、價錢左邊，同一行）；分帳做成往下開的小框。
  cell.textContent = '';
  cell.classList.add('editing');

  const noteInput = document.createElement('input');
  noteInput.type = 'text';
  noteInput.className = 'note-input';
  noteInput.maxLength = 40;
  noteInput.placeholder = '中文註解';
  noteInput.value = item.note || '';

  const splitToggle = document.createElement('button');
  splitToggle.type = 'button';
  splitToggle.className = 'split-toggle';
  splitToggle.textContent = '分帳';

  const box = document.createElement('div');
  box.className = 'split-box';
  box.hidden = rows.length === 0;
  box.innerHTML = `
    <label class="split-total">總數量
      <input class="split-total-input" type="number" min="1" step="1" value="${total}">
    </label>
    <div class="split-rows"></div>
    <button type="button" class="pop-btn split-more">繼續分帳</button>
    <div class="split-warn" hidden></div>
  `;

  cell.append(noteInput, splitToggle, box);
  if (!box.hidden) splitToggle.classList.add('on');

  const totalInput = box.querySelector('.split-total-input');
  const rowsWrap = box.querySelector('.split-rows');
  const moreBtn = box.querySelector('.split-more');
  const warn = box.querySelector('.split-warn');

  const assigned = () => rows.reduce((s, r) => s + (Number(r.units) || 0), 0);

  function renderRows() {
    const multi = total > 1;
    rowsWrap.innerHTML = rows.map((row, i) => {
      const opts = targets.map(t =>
        `<option value="${escapeAttr(t)}" ${t === row.who ? 'selected' : ''}>${escapeHtml(t)}</option>`
      ).join('');
      let cnt = '';
      if (multi) {
        const cap = Math.max(row.units, total - assigned() + (Number(row.units) || 0), 1);
        let o = '';
        for (let n = 1; n <= cap; n++) {
          o += `<option value="${n}" ${n === row.units ? 'selected' : ''}>${n}</option>`;
        }
        cnt = `<select class="split-cnt" data-i="${i}">${o}</select>`;
      }
      return `<div class="split-row">
        <select class="split-who" data-i="${i}"><option value="">分給誰…</option>${opts}</select>
        ${cnt}
        <button type="button" class="split-del" data-i="${i}" title="移除">✕</button>
      </div>`;
    }).join('');

    const rem = total - assigned();
    moreBtn.hidden = multi ? rem <= 0 : false;

    if (multi && rem > 0) {
      warn.hidden = false;
      warn.textContent = `還有 ${rem} 個沒分，關掉後算 ${record.payer} 個人的`;
    } else if (multi && rem < 0) {
      warn.hidden = false;
      warn.textContent = `已分配 ${assigned()} 個，超過總數量 ${total} 個`;
    } else {
      warn.hidden = true;
    }
  }
  renderRows();

  splitToggle.addEventListener('click', () => {
    box.hidden = !box.hidden;
    splitToggle.classList.toggle('on', !box.hidden);
    if (!box.hidden && rows.length === 0) {
      rows.push({ who: '', units: 1 });
      renderRows();
    }
  });

  totalInput.addEventListener('input', () => {
    total = Math.max(1, Math.floor(Number(totalInput.value) || 1));
    renderRows();
  });

  moreBtn.addEventListener('click', () => {
    const rem = total - assigned();
    rows.push({ who: '', units: total > 1 ? Math.max(1, rem) : 1 });
    renderRows();
  });

  rowsWrap.addEventListener('change', e => {
    const i = Number(e.target.dataset.i);
    if (Number.isNaN(i) || !rows[i]) return;
    if (e.target.classList.contains('split-who')) rows[i].who = e.target.value;
    else if (e.target.classList.contains('split-cnt')) rows[i].units = Math.max(1, Number(e.target.value) || 1);
    renderRows();
  });

  rowsWrap.addEventListener('click', e => {
    if (!e.target.classList.contains('split-del')) return;
    const i = Number(e.target.dataset.i);
    rows.splice(i, 1);
    renderRows();
  });

  let closed = false;
  function close(save) {
    if (closed) return;
    closed = true;
    document.removeEventListener('mousedown', onDocDown, true);
    cell.classList.remove('editing');
    if (save) {
      commitItemEditor(record, index, {
        note: noteInput.value,
        rows: box.hidden ? null : rows,
        total
      });
    }
    renderItemCell(cell, item);
  }
  // 點到編輯區以外（含品名、店名、其他卡片）就存檔收起
  function onDocDown(e) {
    if (!cell.contains(e.target)) close(true);
  }
  setTimeout(() => document.addEventListener('mousedown', onDocDown, true), 0);

  cell.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); close(false); }
  });

  noteInput.focus();
  noteInput.select();
}

function commitItemEditor(record, index, { note, rows, total }) {
  const item = (record.items || [])[index];
  if (!item) return;

  // ---- 備註 ----
  const noteVal = String(note || '').trim();
  if (noteVal) item.note = noteVal;
  else delete item.note;

  // ---- 分帳 ----
  let splitVal; // undefined = 這次沒動分帳
  if (rows) {
    const clean = rows
      .filter(r => r.who)
      .map(r => ({
        who: r.who,
        units: total > 1 ? Math.max(1, Math.floor(Number(r.units) || 1)) : 1
      }));

    // 買了不只一個：沒分完的數量算 payer 個人的（Q4）
    if (total > 1) {
      const leftover = total - clean.reduce((s, r) => s + r.units, 0);
      if (leftover > 0 && record.payer) {
        const hit = clean.find(r => r.who === record.payer);
        if (hit) hit.units += leftover;
        else clean.push({ who: record.payer, units: leftover });
      }
    }
    // 單一數量、又沒選任何人 → 當作沒特別分（回到全員均分預設），不要硬塞給 payer

    // 合併同一個 who 的多列
    const merged = [];
    clean.forEach(r => {
      const hit = merged.find(m => m.who === r.who);
      if (hit) hit.units += r.units;
      else merged.push({ ...r });
    });

    splitVal = merged;
    if (splitVal.length) item.split = splitVal;
    else delete item.split;
  }

  // ---- overlay ----
  const overlay = loadEdits();
  const bucket = overlay[record.id] || (overlay[record.id] = {});
  const entry = bucket[index] || (bucket[index] = {});
  if (noteVal) entry.note = noteVal; else delete entry.note;
  if (splitVal !== undefined) {
    if (splitVal.length) entry.split = splitVal;
    else delete entry.split;
  }
  if (Object.keys(entry).length === 0) delete bucket[index];
  if (Object.keys(bucket).length === 0) delete overlay[record.id];
  saveEdits(overlay);

  if (localRecords.some(lr => lr.id === record.id)) saveLocalRecords();

  renderList();
  renderChart();
  renderSettlement();
  populateFilters();
}

/* ---------------- settlement ---------------- */
/*
 * 個人區塊：只列「有按下分帳」的品項，也就是這個人實際被分到的那幾筆。
 *   - 品項有註解就只顯示註解，沒有才顯示品名
 *   - 不是他自己付錢的用紅字，區塊底下依付款人小計「給 X ¥Y」
 * 公用支出區塊：把每張收據「沒被分掉的金額」（＝沒分帳的品項 + 明確分給公用支出的份額）
 *   依收據合併成一行，只顯示店家 + 金額，最後加總。
 */

function renderSettlement() {
  const people = getAllPeople();
  const records = getAllRecords();

  const byPerson = {};
  people.forEach(p => { byPerson[p] = []; });
  const publicReceipts = [];

  records.forEach(r => {
    let publicAmt = 0;
    (r.items || []).forEach(it => {
      Object.entries(itemShares(it)).forEach(([who, amt]) => {
        if (amt <= 0.5) return;
        if (who === PUBLIC_PAYER) { publicAmt += amt; return; }
        if (!itemHasSplit(it)) return; // 個人區塊只收有分帳的品項
        (byPerson[who] || (byPerson[who] = [])).push({
          label: it.note ? it.note : it.name,
          date: r.date, store: r.store, payer: r.payer, amt
        });
      });
    });
    if (publicAmt > 0.5) publicReceipts.push({ store: r.store, date: r.date, amt: publicAmt });
  });

  const host = document.getElementById('settleByPerson');
  const names = Object.keys(byPerson);

  if (records.length === 0 || names.length === 0) {
    host.innerHTML = '<div class="empty-state">尚無資料</div>';
  } else {
    host.innerHTML = names.map(p => {
      const lines = byPerson[p].slice().sort((a, b) => (a.date < b.date ? -1 : 1));
      if (lines.length === 0) {
        return `<div class="settle-person">
          <div class="settle-person-head"><span class="sp-name">${escapeHtml(p)}</span>
          <span class="sp-sum">還沒分到任何品項</span></div></div>`;
      }
      const total = lines.reduce((s, l) => s + l.amt, 0);
      const owedLines = lines.filter(l => l.payer !== p);
      const owed = owedLines.reduce((s, l) => s + l.amt, 0);
      const byPayer = {};
      owedLines.forEach(l => { byPayer[l.payer] = (byPayer[l.payer] || 0) + l.amt; });

      return `
        <div class="settle-person">
          <div class="settle-person-head">
            <span class="sp-name">${escapeHtml(p)}</span>
            <span class="sp-sum">分到 ¥${formatNum(Math.round(total))}
              ${owed > 0.5 ? `<span class="sp-owe">要還 ¥${formatNum(Math.round(owed))}</span>` : ''}
            </span>
          </div>
          <div class="settle-lines">
            ${lines.map(l => `
              <div class="settle-line ${l.payer !== p ? 'owed' : ''}">
                <span class="sl-main">${escapeHtml(l.label)}
                  <span class="sl-meta">${escapeHtml(l.date)} · ${escapeHtml(l.store)}${l.payer !== p ? ` · ${escapeHtml(l.payer)} 付` : ''}</span>
                </span>
                <span class="sl-amt">¥${formatNum(Math.round(l.amt))}</span>
              </div>
            `).join('')}
          </div>
          ${Object.keys(byPayer).length ? `<div class="settle-topay">${
            Object.entries(byPayer).map(([py, v]) =>
              `<span>給 ${escapeHtml(py)} <b>¥${formatNum(Math.round(v))}</b></span>`).join('')
          }</div>` : ''}
        </div>`;
    }).join('');
  }

  const pub = document.getElementById('settlePublic');
  if (publicReceipts.length === 0) {
    pub.innerHTML = '<div class="empty-state">目前沒有公用支出</div>';
  } else {
    const t = publicReceipts.reduce((s, l) => s + l.amt, 0);
    pub.innerHTML = publicReceipts
      .slice()
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .map(l => `
        <div class="settle-line">
          <span class="sl-main">${escapeHtml(l.store)}
            <span class="sl-meta">${escapeHtml(l.date)}</span>
          </span>
          <span class="sl-amt">¥${formatNum(Math.round(l.amt))}</span>
        </div>`).join('') +
      `<div class="settle-line total"><span class="sl-main">合計</span><span class="sl-amt">¥${formatNum(Math.round(t))}</span></div>`;
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
        ${parsed.items.map(it => {
          const sum = splitSummary(it);
          return `
          <div class="item-row">
            <div class="item-main">
              <div class="item-name">${escapeHtml(it.name)}</div>
              ${sum
                ? `<div class="split-summary">${escapeHtml(sum)}</div>`
                : `<div class="split-summary is-public">未分帳 → 公用支出</div>`}
            </div>
            <div class="item-note">${it.note ? escapeHtml(it.note) : ''}</div>
            <div class="item-price">¥${formatNum(it.price)}</div>
          </div>`;
        }).join('')}
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
    if (it.split != null) {
      if (!Array.isArray(it.split)) return `品項「${it.name}」的 split 必須是陣列`;
      for (const s of it.split) {
        if (!s || !s.who || typeof s.units !== 'number') {
          return `品項「${it.name}」的 split 每項都要有 who 和數字 units`;
        }
      }
    }
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
