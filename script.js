/* ═══════════════════════════════════════════
   STATE & STORAGE
═══════════════════════════════════════════ */
const STORAGE_KEY = 'mysaku_v2';
const TODAY = new Date().toLocaleDateString('id-ID', { weekday:'long', day:'numeric', month:'long', year:'numeric' });

const CATEGORIES = [
  { id: 'makan',      label: 'Makan',      icon: '🍜', color: '#FF6B6B' },
  { id: 'minum',      label: 'Minum',      icon: '🧋', color: '#4ECDC4' },
  { id: 'transport',  label: 'Transport',  icon: '🚌', color: '#5B8DEF' },
  { id: 'jajan',      label: 'Jajan',      icon: '🍡', color: '#FFD166' },
  { id: 'hiburan',    label: 'Hiburan',    icon: '🎮', color: '#A78BFA' },
  { id: 'listrik',    label: 'Listrik',    icon: '⚡', color: '#FFB84C' },
  { id: 'air',        label: 'Air',        icon: '🚰', color: '#38BDF8' },
  { id: 'pendidikan', label: 'Pendidikan', icon: '📚', color: '#34D399' },
  { id: 'belanja',    label: 'Belanja',    icon: '🛍️', color: '#F472B6' },
  { id: 'lainnya',    label: 'Lainnya',    icon: '📦', color: '#94A3B8' },
];

const MODE_LABELS = {
  harian:   { balance: 'Saldo Hari Ini',    add: 'Tambah Uang Saku (Harian)',  reset: 'hari ini' },
  mingguan: { balance: 'Saldo Minggu Ini',  add: 'Tambah Uang Saku (Mingguan)', reset: 'minggu ini' },
  bulanan:  { balance: 'Saldo Bulan Ini',   add: 'Tambah Uang Saku (Bulanan)',  reset: 'bulan ini' },
};

/* ── date-key helpers (pakai waktu lokal, bukan UTC) ── */
function pad2(n) { return String(n).padStart(2, '0'); }
function getDailyKey(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function getMonthKey(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}
function getWeekKey(d = new Date()) {
  const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4));
  const diff = dt - firstThursday;
  const week = 1 + Math.round(diff / (7 * 24 * 3600 * 1000));
  return `${dt.getUTCFullYear()}-W${pad2(week)}`;
}
const TODAY_KEY = getDailyKey();

let state = loadState();
let selectedCat = 'makan';
let donutChart = null;
let barChart = null;

function defaultState() {
  return {
    mode: 'harian',
    periods: {
      harian:   { key: getDailyKey(),  income: 0, expense: 0 },
      mingguan: { key: getWeekKey(),   income: 0, expense: 0 },
      bulanan:  { key: getMonthKey(),  income: 0, expense: 0 },
    },
    transactions: [], // {id,type,amount,desc,cat,time,dateKey,mode,periodKey}
    settings: {
      theme: 'dark',
      autoReset: true,
      autoAllowance: false,
      dailyAmount: 100000,
      showModeTabs: true,
    },
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const fresh = defaultState();
      seedDemoData(fresh);
      return fresh;
    }
    const saved = JSON.parse(raw);
    // fill in any new fields for users upgrading from an older version
    const fresh = defaultState();
    saved.settings = Object.assign(fresh.settings, saved.settings || {});
    saved.periods = saved.periods || fresh.periods;
    saved.mode = saved.mode || 'harian';
    saved.transactions = saved.transactions || [];
    return saved;
  } catch { return defaultState(); }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/* ── contoh transaksi awal (hanya dibuat sekali, saat pertama kali dibuka) ── */
function seedDemoData(s) {
  const dk = getDailyKey();
  const items = [
    { desc: 'Mie Ayam', amount: 10000, cat: 'makan' },
    { desc: 'Listrik',  amount: 100000, cat: 'lainnya' },
  ];
  items.forEach(it => {
    s.periods.harian.expense += it.amount;
    s.transactions.unshift({
      id: Date.now() + Math.random(),
      type: 'expense',
      amount: it.amount,
      desc: it.desc,
      cat: it.cat,
      time: nowTime(),
      dateKey: dk,
      mode: 'harian',
      periodKey: s.periods.harian.key,
    });
  });
}

/* ═══════════════════════════════════════════
   ROLLOVER (harian/mingguan/bulanan)
═══════════════════════════════════════════ */
function addTx({ type, amount, desc, cat = null, mode, periodKey, dateKey }) {
  state.transactions.unshift({
    id: Date.now() + Math.random(),
    type, amount, desc, cat,
    time: nowTime(),
    dateKey, mode, periodKey,
  });
}

/* Isi/top-up saku harian dari saldo Bulanan sesuai nominal di Pengaturan.
   Dipanggil saat: hari baru dimulai, toggle diaktifkan, atau nominal disimpan —
   supaya begitu user set nominal, hari ini juga langsung ke-isi (tidak nunggu besok). */
function applyDailyAllowance() {
  if (!state.settings.autoAllowance) return;
  const dailyKey = getDailyKey();
  const target = state.settings.dailyAmount || 0;

  // Berapa yang sudah diberikan otomatis untuk hari ini
  const already = state.periods.harian.allowanceDate === dailyKey
    ? (state.periods.harian.allowanceAmount || 0)
    : 0;

  const need = Math.max(target - already, 0);
  if (need <= 0) {
    state.periods.harian.allowanceDate = dailyKey;
    state.periods.harian.allowanceAmount = already;
    return;
  }

  const poolBalance = state.periods.bulanan.income - state.periods.bulanan.expense;
  const amt = Math.min(need, Math.max(poolBalance, 0));

  if (amt > 0) {
    state.periods.bulanan.expense += amt;
    state.periods.harian.income += amt;
    addTx({ type: 'expense', amount: amt, desc: 'Transfer ke Saku Harian',
      mode: 'bulanan', periodKey: state.periods.bulanan.key, dateKey: dailyKey });
    addTx({ type: 'income', amount: amt, desc: already > 0 ? 'Tambahan Saku Harian (Otomatis)' : 'Uang Saku Harian (Otomatis)',
      mode: 'harian', periodKey: dailyKey, dateKey: dailyKey });
  }

  state.periods.harian.allowanceDate = dailyKey;
  state.periods.harian.allowanceAmount = already + amt;
}

function checkRollover() {
  const dailyKey = getDailyKey();
  const weekKey  = getWeekKey();
  const monthKey = getMonthKey();
  let changed = false;

  // Mingguan: selalu reset otomatis saat minggu berganti
  if (state.periods.mingguan.key !== weekKey) {
    state.periods.mingguan = { key: weekKey, income: 0, expense: 0 };
    changed = true;
  }
  // Bulanan: selalu reset otomatis saat bulan berganti
  if (state.periods.bulanan.key !== monthKey) {
    state.periods.bulanan = { key: monthKey, income: 0, expense: 0 };
    changed = true;
  }
  // Harian
  if (state.periods.harian.key !== dailyKey) {
    const doAuto = state.settings.autoReset || state.settings.autoAllowance;
    if (doAuto) {
      const leftover = state.periods.harian.income - state.periods.harian.expense;

      // Sisa saku harian (jika ada) dikembalikan ke saldo Bulanan
      if (state.settings.autoAllowance && leftover > 0) {
        state.periods.bulanan.income += leftover;
        addTx({ type: 'income', amount: leftover, desc: 'Sisa Saku Harian Dikembalikan',
          mode: 'bulanan', periodKey: state.periods.bulanan.key, dateKey: dailyKey });
      }

      state.periods.harian = { key: dailyKey, income: 0, expense: 0 };
      applyDailyAllowance();
    } else {
      // autoReset & autoAllowance nonaktif: saldo tetap jalan, cuma perbarui key harinya
      state.periods.harian.key = dailyKey;
    }
    changed = true;
  } else if (state.settings.autoAllowance) {
    // Hari yang sama, tapi mungkin nominal baru saja diaktifkan/diubah
    applyDailyAllowance();
    changed = true;
  }

  if (changed) saveState();
}

/* ═══════════════════════════════════════════
   INIT
═══════════════════════════════════════════ */
function init() {
  checkRollover();
  applyTheme(state.settings.theme);
  renderCategoryChips();
  renderModeTabs();
  renderBalance();
  renderHistory();
  renderSettings();
  document.getElementById('balanceDate').textContent = TODAY;
}

/* ═══════════════════════════════════════════
   THEME
═══════════════════════════════════════════ */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const toggle = document.getElementById('themeToggle');
  toggle.classList.toggle('on', theme === 'dark');
}

function toggleTheme() {
  state.settings.theme = state.settings.theme === 'dark' ? 'light' : 'dark';
  applyTheme(state.settings.theme);
  saveState();
  // Re-render charts with new theme
  if (document.getElementById('page-chart').classList.contains('active')) {
    renderCharts();
  }
}

function toggleAutoReset() {
  state.settings.autoReset = !state.settings.autoReset;
  renderSettings();
  saveState();
  toast(state.settings.autoReset ? 'Reset otomatis aktif' : 'Reset otomatis nonaktif');
}

/* ═══════════════════════════════════════════
   NAVIGATION
═══════════════════════════════════════════ */
function goTo(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  document.getElementById('tab-' + page).classList.add('active');

  if (page === 'chart') {
    setTimeout(renderCharts, 80);
  }
}

/* ═══════════════════════════════════════════
   MODE TABS (Harian/Mingguan/Bulanan)
═══════════════════════════════════════════ */
function setMode(mode) {
  state.mode = mode;
  saveState();
  renderModeTabs();
  renderBalance();
  renderHistory();
  renderSettings();
  if (document.getElementById('page-chart').classList.contains('active')) {
    renderCharts();
  }
}

function renderModeTabs() {
  document.querySelectorAll('.mode-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.mode === state.mode);
  });
  document.getElementById('modeTabs').style.display = state.settings.showModeTabs ? 'flex' : 'none';
}

function toggleMoreMenu() {
  document.getElementById('moreMenu').classList.toggle('open');
}
document.addEventListener('click', function(e) {
  const wrap = document.querySelector('.more-menu-wrap');
  if (wrap && !wrap.contains(e.target)) {
    document.getElementById('moreMenu').classList.remove('open');
  }
});

function toggleModeTabsVisibility() {
  state.settings.showModeTabs = !state.settings.showModeTabs;
  saveState();
  renderModeTabs();
  document.getElementById('modeTabsMenuLabel').textContent =
    state.settings.showModeTabs ? 'Sembunyikan Tab Periode' : 'Tampilkan Tab Periode';
  toggleMoreMenu();
  toast(state.settings.showModeTabs ? 'Tab periode ditampilkan' : 'Tab periode disembunyikan');
}

/* ═══════════════════════════════════════════
   BALANCE & SAKU
═══════════════════════════════════════════ */
function addSaku() {
  const val = parseFormatted(document.getElementById('sakuInput').value);
  if (!val || val <= 0) { toast('Masukkan nominal yang valid'); return; }

  const p = state.periods[state.mode];
  p.income += val;
  addTx({
    type: 'income', amount: val, desc: 'Uang Saku',
    mode: state.mode, periodKey: p.key, dateKey: TODAY_KEY,
  });
  document.getElementById('sakuInput').value = '';
  document.getElementById('sakuInput').dispatchEvent(new Event('input'));
  saveState();
  renderBalance();
  renderHistory();
  toast('+ ' + rupiah(val) + ' ditambahkan 💰');
}

function renderBalance() {
  const p = state.periods[state.mode];
  const saldo = p.income - p.expense;
  const el = document.getElementById('balanceDisplay');
  el.textContent = (saldo < 0 ? '-' : '') + rupiah(saldo);
  el.className = 'balance-amount' + (saldo < 0 ? ' negative' : '');
  document.getElementById('statIncome').textContent = rupiah(p.income);
  document.getElementById('statExpense').textContent = rupiah(p.expense);
  document.getElementById('balanceLabel').textContent = MODE_LABELS[state.mode].balance;
  document.getElementById('addSakuLabel').textContent = MODE_LABELS[state.mode].add;
}

/* ═══════════════════════════════════════════
   EXPENSE
═══════════════════════════════════════════ */
function renderCategoryChips() {
  const wrap = document.getElementById('catChips');
  wrap.innerHTML = CATEGORIES.map(c =>
    `<div class="chip ${c.id === selectedCat ? 'active' : ''}" onclick="selectCat('${c.id}')">
      ${c.icon} ${c.label}
    </div>`
  ).join('');
}

function selectCat(id) {
  selectedCat = id;
  renderCategoryChips();
}

function addExpense() {
  const amount = parseFormatted(document.getElementById('expInput').value);
  const desc   = document.getElementById('expDesc').value.trim();
  if (!amount || amount <= 0) { toast('Masukkan nominal pengeluaran'); return; }
  if (!desc) { toast('Tambahkan keterangan'); return; }

  const p = state.periods[state.mode];
  const saldo = p.income - p.expense;
  if (amount > saldo) {
    toast('⚠️ Saldo tidak cukup!');
  }

  p.expense += amount;
  addTx({
    type: 'expense', amount, desc, cat: selectedCat,
    mode: state.mode, periodKey: p.key, dateKey: TODAY_KEY,
  });

  document.getElementById('expInput').value = '';
  document.getElementById('expDesc').value = '';
  saveState();
  renderBalance();
  renderHistory();

  const cat = CATEGORIES.find(c => c.id === selectedCat);
  toast(`${cat.icon} -${rupiah(amount)} dicatat`);
}

/* ═══════════════════════════════════════════
   HISTORY
═══════════════════════════════════════════ */
function currentPeriodTx() {
  const p = state.periods[state.mode];
  return state.transactions.filter(t => t.mode === state.mode && t.periodKey === p.key);
}

function renderHistory() {
  const list = document.getElementById('txList');
  const txs = currentPeriodTx();
  if (!txs.length) {
    list.innerHTML = `<div class="tx-empty"><i class="ph ph-receipt"></i>Belum ada transaksi ${MODE_LABELS[state.mode].reset}</div>`;
    return;
  }

  list.innerHTML = txs.map(tx => {
    const isIncome = tx.type === 'income';
    const cat = tx.cat ? CATEGORIES.find(c => c.id === tx.cat) : null;
    return `
      <div class="tx-item">
        <div class="tx-icon ${tx.type}">
          <i class="ph ph-${isIncome ? 'arrow-down-left' : 'arrow-up-right'}"></i>
        </div>
        <div class="tx-info">
          <div class="tx-desc">${tx.desc}</div>
          <div class="tx-meta">
            <span>${tx.time}</span>
            ${cat ? `<span class="tx-cat">${cat.icon} ${cat.label}</span>` : ''}
          </div>
        </div>
        <div class="tx-amount ${tx.type}">
          ${isIncome ? '+' : '-'}${rupiah(tx.amount)}
        </div>
      </div>
    `;
  }).join('');
}

function clearHistory() {
  const p = state.periods[state.mode];
  const txs = currentPeriodTx();
  if (!txs.length) { toast('Riwayat sudah kosong'); return; }
  const ids = new Set(txs.map(t => t.id));
  state.transactions = state.transactions.filter(t => !ids.has(t.id));
  p.income = 0;
  p.expense = 0;
  saveState();
  renderBalance();
  renderHistory();
  toast('Riwayat dihapus');
}

/* ═══════════════════════════════════════════
   CHARTS
═══════════════════════════════════════════ */
function getChartColors() {
  const isDark = state.settings.theme === 'dark';
  return {
    grid: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)',
    text: isDark ? '#888' : '#666',
    bar:  isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)',
    barHover: isDark ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.25)',
  };
}

function renderCharts() {
  renderDonut();
  renderBar();
  renderCatBreakdown();
}

function renderDonut() {
  const ctx = document.getElementById('donutChart').getContext('2d');
  const expenses = currentPeriodTx().filter(t => t.type === 'expense');

  // Group by category
  const bycat = {};
  CATEGORIES.forEach(c => { bycat[c.id] = 0; });
  expenses.forEach(t => { if (t.cat) bycat[t.cat] += t.amount; });

  const cats  = CATEGORIES.filter(c => bycat[c.id] > 0);
  const labels = cats.map(c => `${c.icon} ${c.label}`);
  const data   = cats.map(c => bycat[c.id]);
  const colors = cats.map(c => c.color);
  const isDark = state.settings.theme === 'dark';

  if (donutChart) donutChart.destroy();

  if (!data.length) {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.fillStyle = isDark ? '#444' : '#ccc';
    ctx.font = '13px Plus Jakarta Sans';
    ctx.textAlign = 'center';
    ctx.fillText('Belum ada pengeluaran', ctx.canvas.width / 2, ctx.canvas.height / 2);
    return;
  }

  donutChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data, backgroundColor: colors, borderWidth: 0, hoverOffset: 6 }]
    },
    options: {
      cutout: '68%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: isDark ? '#888' : '#666',
            font: { family: 'Plus Jakarta Sans', size: 11, weight: '600' },
            padding: 14,
            boxWidth: 10, boxHeight: 10,
            borderRadius: 3,
          }
        },
        tooltip: {
          callbacks: {
            label: ctx => ` ${rupiah(ctx.parsed)}`
          }
        }
      }
    }
  });
}

function renderBar() {
  const ctx = document.getElementById('barChart').getContext('2d');
  const c = getChartColors();
  const isDark = state.settings.theme === 'dark';

  // Build last 7 days labels & values
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push({
      key: d.toISOString().slice(0, 10),
      label: d.toLocaleDateString('id-ID', { weekday: 'short' })
    });
  }

  const vals = days.map(d =>
    state.transactions
      .filter(t => t.type === 'expense' && t.dateKey === d.key)
      .reduce((sum, t) => sum + t.amount, 0)
  );

  if (barChart) barChart.destroy();

  barChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: days.map(d => d.label),
      datasets: [{
        data: vals,
        backgroundColor: vals.map((_, i) =>
          i === 6 ? (isDark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.75)') : c.bar
        ),
        borderRadius: 8,
        borderSkipped: false,
      }]
    },
    options: {
      plugins: { legend: { display: false }, tooltip: {
        callbacks: { label: ctx => ` ${rupiah(ctx.parsed.y)}` }
      }},
      scales: {
        y: {
          grid: { color: c.grid },
          ticks: { color: c.text, font: { family: 'Plus Jakarta Sans', size: 11 },
            callback: v => v === 0 ? '0' : (v >= 1000 ? (v/1000).toFixed(0)+'k' : v)
          },
          border: { display: false }
        },
        x: {
          grid: { display: false },
          ticks: { color: c.text, font: { family: 'Plus Jakarta Sans', size: 11, weight: '600' } },
          border: { display: false }
        }
      }
    }
  });
}

function renderCatBreakdown() {
  const wrap = document.getElementById('catBreakdown');
  const expenses = currentPeriodTx().filter(t => t.type === 'expense');
  const total = state.periods[state.mode].expense || 1;

  const bycat = {};
  CATEGORIES.forEach(c => { bycat[c.id] = 0; });
  expenses.forEach(t => { if (t.cat) bycat[t.cat] += t.amount; });

  const items = CATEGORIES.filter(c => bycat[c.id] > 0)
    .sort((a, b) => bycat[b.id] - bycat[a.id]);

  if (!items.length) {
    wrap.innerHTML = `<div class="tx-empty" style="padding:20px 0;"><i class="ph ph-chart-bar"></i>Belum ada data kategori</div>`;
    return;
  }

  wrap.innerHTML = items.map(c => {
    const pct = Math.round((bycat[c.id] / total) * 100);
    return `
      <div class="cat-row">
        <div class="cat-icon" style="background:${c.color}26;">${c.icon}</div>
        <div class="cat-info">
          <div class="cat-name">${c.label}</div>
          <div class="cat-bar-wrap">
            <div class="cat-bar" style="width:${pct}%;background:${c.color};"></div>
          </div>
        </div>
        <div class="cat-amount">${rupiah(bycat[c.id])}</div>
      </div>
    `;
  }).join('');

  // Trigger bar animation
  requestAnimationFrame(() => {
    wrap.querySelectorAll('.cat-bar').forEach(b => {
      const w = b.style.width;
      b.style.width = '0';
      requestAnimationFrame(() => { b.style.width = w; });
    });
  });
}

/* ═══════════════════════════════════════════
   SETTINGS RENDER
═══════════════════════════════════════════ */
function renderSettings() {
  const arToggle = document.getElementById('autoResetToggle');
  arToggle.classList.toggle('on', state.settings.autoReset);

  const aaToggle = document.getElementById('autoAllowanceToggle');
  aaToggle.classList.toggle('on', state.settings.autoAllowance);

  const panel = document.getElementById('dailyAmountPanel');
  panel.style.display = state.settings.autoAllowance ? 'flex' : 'none';

  const input = document.getElementById('dailyAmountInput');
  if (document.activeElement !== input) {
    input.value = state.settings.dailyAmount ? state.settings.dailyAmount.toLocaleString('id-ID') : '';
  }

  const poolBalance = state.periods.bulanan.income - state.periods.bulanan.expense;
  document.getElementById('poolReadout').textContent = rupiah(poolBalance);

  document.getElementById('modeTabsMenuLabel').textContent =
    state.settings.showModeTabs ? 'Sembunyikan Tab Periode' : 'Tampilkan Tab Periode';

  document.getElementById('resetItemLabel').textContent = `Reset ${MODE_LABELS[state.mode].balance}`;
  document.getElementById('resetItemSub').textContent = `Hapus semua data ${MODE_LABELS[state.mode].reset}`;
}

function toggleAutoAllowance() {
  state.settings.autoAllowance = !state.settings.autoAllowance;
  if (state.settings.autoAllowance) applyDailyAllowance();
  renderSettings();
  renderBalance();
  saveState();
  toast(state.settings.autoAllowance ? 'Isi otomatis saku harian aktif' : 'Isi otomatis saku harian nonaktif');
}

function setDailyAmount() {
  const val = parseFormatted(document.getElementById('dailyAmountInput').value);
  if (!val || val <= 0) { toast('Masukkan nominal yang valid'); return; }
  state.settings.dailyAmount = val;
  applyDailyAllowance();
  saveState();
  renderSettings();
  renderBalance();
  toast('Nominal saku harian disimpan ✓');
}

/* ═══════════════════════════════════════════
   RESET MODAL
═══════════════════════════════════════════ */
function openResetModal() {
  document.getElementById('resetModalTitle').textContent = `Reset ${MODE_LABELS[state.mode].balance}?`;
  document.getElementById('resetModal').querySelector('.modal-sub').textContent =
    `Semua data ${MODE_LABELS[state.mode].reset} (saldo, pengeluaran, riwayat) untuk tab ini akan dihapus permanen dan tidak bisa dikembalikan.`;
  document.getElementById('resetModal').classList.add('open');
}
function closeResetModal() {
  document.getElementById('resetModal').classList.remove('open');
}
function confirmReset() {
  const mode = state.mode;
  const p = state.periods[mode];
  state.transactions = state.transactions.filter(t => !(t.mode === mode && t.periodKey === p.key));
  p.income = 0;
  p.expense = 0;
  saveState();

  closeResetModal();
  renderBalance();
  renderHistory();
  toast('Saldo direset ✓');
}

/* ═══════════════════════════════════════════
   EXPORT CSV
═══════════════════════════════════════════ */
function exportCSV() {
  if (!state.transactions.length) { toast('Tidak ada data untuk diekspor'); return; }
  const rows = [['Tanggal','Waktu','Mode','Tipe','Deskripsi','Kategori','Nominal']];
  state.transactions.forEach(t => {
    const cat = t.cat ? CATEGORIES.find(c => c.id === t.cat)?.label : '-';
    rows.push([t.dateKey || '-', t.time, t.mode || '-', t.type === 'income' ? 'Pemasukan' : 'Pengeluaran', t.desc, cat || '-', t.amount]);
  });
  const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mysaku_${TODAY_KEY}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast('File CSV diunduh ✓');
}

/* ═══════════════════════════════════════════
   UTILS
═══════════════════════════════════════════ */
function rupiah(n) {
  return 'Rp ' + Math.abs(Math.round(n)).toLocaleString('id-ID');
}

function nowTime() {
  return new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

let toastTimeout;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => el.classList.remove('show'), 2400);
}

/* ═══════════════════════════════════════════
   FORMATTED NUMBER INPUT
═══════════════════════════════════════════ */

// Parse "3.000.000" → 3000000
function parseFormatted(str) {
  return parseFloat((str || '').replace(/\./g, '').replace(/,/g, '.')) || 0;
}

// Format 3000000 → "3.000.000"
function formatNumber(str) {
  const digits = str.replace(/\D/g, '');           // strip non-digits
  if (!digits) return '';
  return parseInt(digits, 10).toLocaleString('id-ID');
}

// Attach live formatter to a text input
function attachFormatter(inputId) {
  const el = document.getElementById(inputId);
  el.addEventListener('input', function() {
    const pos    = this.selectionStart;
    const before = this.value.length;
    this.value   = formatNumber(this.value);
    // Reposition cursor accounting for added dots
    const diff = this.value.length - before;
    this.setSelectionRange(pos + diff, pos + diff);
  });
}

/* ═══════════════════════════════════════════
   ENTER KEY SUPPORT
═══════════════════════════════════════════ */
document.getElementById('sakuInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') addSaku();
});
document.getElementById('expDesc').addEventListener('keydown', e => {
  if (e.key === 'Enter') addExpense();
});

/* ═══════════════════════════════════════════
   CLOSE MODAL ON OVERLAY CLICK
═══════════════════════════════════════════ */
document.getElementById('resetModal').addEventListener('click', function(e) {
  if (e.target === this) closeResetModal();
});

// Attach formatted inputs
attachFormatter('sakuInput');
attachFormatter('expInput');
attachFormatter('dailyAmountInput');
document.getElementById('dailyAmountInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') setDailyAmount();
});

// BOOT
init();
