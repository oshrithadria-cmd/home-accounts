/* ===== ניהול חשבונות הבית ===== */
(() => {
  "use strict";

  const STORE_KEY = "home_accounts_v1";
  const MONTHS = ["ינואר","פברואר","מרץ","אפריל","מאי","יוני","יולי","אוגוסט","ספטמבר","אוקטובר","נובמבר","דצמבר"];

  /* ---------- Default data ---------- */
  const DEFAULT_CATEGORIES = [
    { id: "rent",      name: "שכר דירה",  icon: "🔑", color: "#6366f1", budget: 0 },
    { id: "vaad",      name: "ועד בית",   icon: "🏢", color: "#0ea5e9", budget: 0 },
    { id: "electric",  name: "חשמל",      icon: "💡", color: "#f59e0b", budget: 0 },
    { id: "water",     name: "מים",       icon: "💧", color: "#06b6d4", budget: 0 },
    { id: "arnona",    name: "ארנונה",    icon: "🏛️", color: "#8b5cf6", budget: 0 },
    { id: "internet",  name: "אינטרנט",   icon: "🌐", color: "#10b981", budget: 0 },
    { id: "super",     name: "סופר",      icon: "🛒", color: "#ef4444", budget: 0 },
  ];

  const DEFAULT_PEOPLE = [
    { id: "oshi", name: "אושי", icon: "👩", color: "#ec4899" },
    { id: "nat",  name: "נת",   icon: "👨", color: "#3b82f6" },
  ];

  /* ---------- State ---------- */
  let state = load();
  let view = "dashboard";
  let cur = new Date();
  let curMonth = cur.getMonth();
  let curYear = cur.getFullYear();
  let billFilter = "all";
  let charts = {};

  /* ---------- Persistence ---------- */
  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (!data.categories) data.categories = [...DEFAULT_CATEGORIES];
        if (!data.bills) data.bills = [];
        if (!data.people || !data.people.length) data.people = JSON.parse(JSON.stringify(DEFAULT_PEOPLE));
        if (!data.settings) data.settings = { theme: "light" };
        if (data.settings.welcomed === undefined) data.settings.welcomed = !!data.settings.currentUser;
        data.bills.forEach(b => migrateBill(b, data.people));
        return data;
      }
    } catch (e) { console.warn("load failed", e); }
    return {
      categories: [...DEFAULT_CATEGORIES],
      people: JSON.parse(JSON.stringify(DEFAULT_PEOPLE)),
      bills: [],
      settings: { theme: "light", currentUser: null, welcomed: false },
    };
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
    catch (e) { console.warn("save failed", e); }
  }

  /* ---------- Helpers ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const monthKey = (y, m) => `${y}-${String(m + 1).padStart(2, "0")}`;
  const fmt = (n) => "₪" + Number(n || 0).toLocaleString("he-IL", { maximumFractionDigits: 0 });
  const fmtP = (n) => Number(n || 0).toLocaleString("he-IL", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));

  function catById(id) { return state.categories.find(c => c.id === id); }
  function personById(id) { return state.people.find(p => p.id === id); }

  function migrateBill(b, people) {
    if (!b.paidBy) b.paidBy = people[0] ? people[0].id : null;
    if (!b.split) b.split = "equal";
    if (b.split === "single" && !b.splitTarget) b.splitTarget = b.paidBy;
    if (b.split === "custom" && !b.splitCustom) b.splitCustom = {};
  }

  /* How much a given person is responsible for in a bill (their share of cost). */
  function shareFor(bill, personId) {
    const amt = +bill.amount || 0;
    const people = state.people;
    if (!people.length) return 0;
    if (bill.split === "single") return bill.splitTarget === personId ? amt : 0;
    if (bill.split === "custom") {
      const pct = (bill.splitCustom && bill.splitCustom[personId]) || 0;
      return amt * pct / 100;
    }
    return amt / people.length; // equal
  }

  function billsForMonth(y, m) {
    const key = monthKey(y, m);
    return state.bills.filter(b => b.month === key);
  }

  function isOverdue(b) {
    if (b.status === "paid" || !b.due) return false;
    const d = new Date(b.due + "T23:59:59");
    return d < new Date();
  }

  /* ---------- Toast ---------- */
  let toastTimer;
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 2400);
  }

  /* ===================================================================
   *  RENDER
   * =================================================================== */
  const content = $("#content");

  function render() {
    $("#monthLabel").textContent = `${MONTHS[curMonth]} ${curYear}`;
    $$(".nav-item").forEach(n => n.classList.toggle("active", n.dataset.view === view));
    destroyCharts();
    if (view === "dashboard") renderDashboard();
    else if (view === "bills") renderBills();
    else if (view === "settlement") renderSettlement();
    else if (view === "categories") renderCategories();
    else if (view === "reports") renderReports();
    else if (view === "settings") renderSettings();
    renderUserChip();
  }

  function destroyCharts() {
    Object.values(charts).forEach(c => { try { c.destroy(); } catch(e){} });
    charts = {};
  }

  /* ---------- Dashboard ---------- */
  function renderDashboard() {
    const bills = billsForMonth(curYear, curMonth);
    const exp = bills.filter(b => b.type !== "income");
    const inc = bills.filter(b => b.type === "income");
    const totalExp = exp.reduce((s, b) => s + (+b.amount || 0), 0);
    const totalInc = inc.reduce((s, b) => s + (+b.amount || 0), 0);
    const paid = exp.filter(b => b.status === "paid").reduce((s, b) => s + (+b.amount || 0), 0);
    const unpaid = totalExp - paid;
    const balance = totalInc - totalExp;
    const overdueCount = exp.filter(isOverdue).length;

    content.innerHTML = `
      <div class="section-title">סקירה כללית</div>
      <div class="section-sub">${MONTHS[curMonth]} ${curYear} — מבט מהיר על המצב</div>

      <div class="stats-grid">
        <div class="stat-card accent-danger">
          <div class="stat-icon">💸</div>
          <div class="stat-label">סך הוצאות</div>
          <div class="stat-value">${fmt(totalExp)}</div>
          <div class="stat-sub">${exp.length} חשבונות</div>
        </div>
        <div class="stat-card accent-success">
          <div class="stat-icon">💰</div>
          <div class="stat-label">סך הכנסות</div>
          <div class="stat-value">${fmt(totalInc)}</div>
          <div class="stat-sub">${inc.length} רישומים</div>
        </div>
        <div class="stat-card accent-primary">
          <div class="stat-icon">${balance >= 0 ? "📈" : "📉"}</div>
          <div class="stat-label">מאזן חודשי</div>
          <div class="stat-value" style="color:${balance >= 0 ? "var(--success)" : "var(--danger)"}">${fmt(balance)}</div>
          <div class="stat-sub">${balance >= 0 ? "במאזן חיובי" : "בגירעון"}</div>
        </div>
        <div class="stat-card accent-warn">
          <div class="stat-icon">⏳</div>
          <div class="stat-label">ממתין לתשלום</div>
          <div class="stat-value">${fmt(unpaid)}</div>
          <div class="stat-sub">${overdueCount > 0 ? `${overdueCount} באיחור` : "אין איחורים"}</div>
        </div>
      </div>

      ${dashSettlementHtml()}

      <div class="grid-2">
        <div class="panel">
          <div class="panel-head">
            <h3>חשבונות החודש</h3>
            <button class="btn btn-ghost" data-goto="bills">הצג הכל</button>
          </div>
          <div id="dashBills"></div>
        </div>
        <div class="panel">
          <div class="panel-head"><h3>פילוח לפי קטגוריה</h3></div>
          <div class="chart-wrap sm"><canvas id="catChart"></canvas></div>
        </div>
      </div>
    `;

    const list = $("#dashBills");
    const recent = bills.slice().sort(sortBills).slice(0, 6);
    if (!recent.length) {
      list.innerHTML = emptyHtml("🧾", "אין חשבונות החודש", "הוסיפו הוצאה חדשה כדי להתחיל");
    } else {
      list.innerHTML = recent.map(billRowHtml).join("");
      bindBillRows(list);
    }

    drawCategoryChart(exp);
    $("[data-goto]")?.addEventListener("click", () => { view = "bills"; render(); });
    $("[data-goto-settle]")?.addEventListener("click", () => { view = "settlement"; render(); });
  }

  function dashSettlementHtml() {
    if (state.people.length < 2) return "";
    const s = computeSettlement(false);
    let inner;
    if (!s.tx.length) {
      inner = `<div class="settle-main" style="font-size:18px">${s.count ? "🎉 הכל מאוזן בין בני הזוג" : "אין הוצאות ששולמו החודש"}</div>`;
    } else {
      inner = s.tx.map(t => `<div class="settle-main" style="font-size:18px">${esc(personById(t.from)?.name)} ➜ ${esc(personById(t.to)?.name)} <span class="em">${fmt(t.amount)}</span></div>`).join("");
    }
    const cls = s.tx.length ? "" : "even";
    return `<div class="settle-hero ${cls}" data-goto-settle style="cursor:pointer;margin-bottom:24px">
      <div class="settle-label">התחשבנות (לפי מה ששולם) — לחצו לפירוט</div>${inner}</div>`;
  }

  /* ---------- Bills ---------- */
  function sortBills(a, b) {
    const ao = isOverdue(a) ? 0 : a.status === "unpaid" ? 1 : 2;
    const bo = isOverdue(b) ? 0 : b.status === "unpaid" ? 1 : 2;
    if (ao !== bo) return ao - bo;
    return (a.due || "9999").localeCompare(b.due || "9999");
  }

  function renderBills() {
    let bills = billsForMonth(curYear, curMonth);
    const total = bills.filter(b => b.type !== "income").reduce((s,b)=>s+(+b.amount||0),0);

    content.innerHTML = `
      <div class="section-title">חשבונות חודשיים</div>
      <div class="section-sub">${MONTHS[curMonth]} ${curYear} — סך הוצאות ${fmt(total)}</div>
      <div class="filters">
        ${chip("all","הכל")}${chip("unpaid","לא שולם")}${chip("paid","שולם")}
        ${chip("overdue","באיחור")}${chip("income","הכנסות")}
      </div>
      <div class="panel"><div id="billsList"></div></div>
    `;

    $$(".chip").forEach(c => c.addEventListener("click", () => {
      billFilter = c.dataset.f; renderBills();
    }));

    let filtered = bills;
    if (billFilter === "unpaid") filtered = bills.filter(b => b.type !== "income" && b.status === "unpaid");
    else if (billFilter === "paid") filtered = bills.filter(b => b.status === "paid");
    else if (billFilter === "overdue") filtered = bills.filter(isOverdue);
    else if (billFilter === "income") filtered = bills.filter(b => b.type === "income");

    const list = $("#billsList");
    filtered = filtered.slice().sort(sortBills);
    if (!filtered.length) {
      list.innerHTML = emptyHtml("🧾", "אין חשבונות להצגה", "נסו לשנות סינון או הוסיפו הוצאה חדשה");
    } else {
      list.innerHTML = filtered.map(billRowHtml).join("");
      bindBillRows(list);
    }
  }

  function chip(f, label) {
    return `<button class="chip ${billFilter === f ? "active" : ""}" data-f="${f}">${label}</button>`;
  }

  function billRowHtml(b) {
    const c = catById(b.category) || { name: "כללי", icon: "📌", color: "#94a3b8" };
    const overdue = isOverdue(b);
    let statusBadge = "";
    if (b.type === "income") statusBadge = `<span class="badge badge-paid">הכנסה</span>`;
    else if (overdue) statusBadge = `<span class="badge badge-overdue">באיחור</span>`;
    else if (b.status === "paid") statusBadge = `<span class="badge badge-paid">שולם</span>`;
    else statusBadge = `<span class="badge badge-unpaid">לא שולם</span>`;
    const rec = b.recurring ? `<span class="badge badge-recurring">קבוע</span>` : "";
    const dueTxt = b.due ? `📅 ${new Date(b.due+"T00:00:00").toLocaleDateString("he-IL")}` : "";
    const sign = b.type === "income" ? "+" : "";
    const toggleLabel = b.status === "paid" ? "בטל תשלום" : "סמן כשולם";

    let payTxt = "";
    if (b.type !== "income") {
      const p = personById(b.paidBy);
      const splitLabel = b.split === "single"
        ? `על חשבון ${esc(personById(b.splitTarget)?.name || "—")}`
        : b.split === "custom" ? "חלוקה מותאמת" : "חצי-חצי";
      if (p) payTxt = `<span class="split-tag"><span class="payer-av" style="background:${p.color}">${p.icon}</span> שילם/ה ${esc(p.name)} · ${splitLabel}</span>`;
    }

    return `
      <div class="bill-row" data-id="${b.id}">
        <div class="bill-cat-icon" style="background:${c.color}">${c.icon}</div>
        <div class="bill-info">
          <div class="bill-name">${esc(b.name || c.name)}</div>
          <div class="bill-meta">
            <span>${esc(c.name)}</span>${dueTxt ? `<span>${dueTxt}</span>` : ""}
            ${payTxt ? `<span>${payTxt}</span>` : ""}
            ${statusBadge}${rec}
          </div>
        </div>
        <div class="bill-amount ${b.type === "income" ? "income" : "expense"}">${sign}${fmt(b.amount)}</div>
        ${b.type !== "income" ? `<button class="status-toggle" data-toggle="${b.id}">${toggleLabel}</button>` : ""}
      </div>`;
  }

  function bindBillRows(root) {
    $$(".bill-row", root).forEach(row => {
      row.addEventListener("click", e => {
        if (e.target.closest("[data-toggle]")) return;
        openBillModal(row.dataset.id);
      });
    });
    $$("[data-toggle]", root).forEach(btn => {
      btn.addEventListener("click", e => {
        e.stopPropagation();
        const b = state.bills.find(x => x.id === btn.dataset.toggle);
        if (b) { b.status = b.status === "paid" ? "unpaid" : "paid"; save(); render();
          toast(b.status === "paid" ? "סומן כשולם ✓" : "סומן כלא שולם"); }
      });
    });
  }

  /* ---------- Settlement ---------- */
  let settleIncludePending = false;

  function computeSettlement(includePending) {
    const ppl = state.people;
    const paid = {}, share = {};
    ppl.forEach(p => { paid[p.id] = 0; share[p.id] = 0; });
    const all = billsForMonth(curYear, curMonth).filter(b => b.type !== "income");
    const considered = all.filter(b => includePending || b.status === "paid");
    considered.forEach(b => {
      if (paid[b.paidBy] !== undefined) paid[b.paidBy] += (+b.amount || 0);
      ppl.forEach(p => share[p.id] += shareFor(b, p.id));
    });
    const net = {};
    ppl.forEach(p => net[p.id] = paid[p.id] - share[p.id]);
    const creditors = ppl.map(p => ({ id: p.id, amt: net[p.id] })).filter(x => x.amt > 0.5).sort((a, b) => b.amt - a.amt);
    const debtors = ppl.map(p => ({ id: p.id, amt: -net[p.id] })).filter(x => x.amt > 0.5).sort((a, b) => b.amt - a.amt);
    const tx = [];
    let i = 0, j = 0;
    while (i < debtors.length && j < creditors.length) {
      const pay = Math.min(debtors[i].amt, creditors[j].amt);
      tx.push({ from: debtors[i].id, to: creditors[j].id, amount: pay });
      debtors[i].amt -= pay; creditors[j].amt -= pay;
      if (debtors[i].amt <= 0.5) i++;
      if (creditors[j].amt <= 0.5) j++;
    }
    const totalShared = considered.reduce((s, b) => s + (+b.amount || 0), 0);
    return { paid, share, net, tx, totalShared, count: considered.length, pending: all.length - considered.length };
  }

  function renderSettlement() {
    const s = computeSettlement(settleIncludePending);

    let heroHtml;
    if (!s.count) {
      heroHtml = `<div class="settle-hero even"><div class="settle-label">התחשבנות חודשית</div><div class="settle-main">אין הוצאות ${settleIncludePending ? "" : "ששולמו "}החודש</div></div>`;
    } else if (!s.tx.length) {
      heroHtml = `<div class="settle-hero even"><div class="settle-label">סטטוס התחשבנות</div><div class="settle-main">🎉 הכל מאוזן — אף אחד לא חייב</div></div>`;
    } else {
      const lines = s.tx.map(t => {
        const from = personById(t.from), to = personById(t.to);
        return `<div class="settle-main">${esc(from?.name)} ➜ ${esc(to?.name)} <span class="em">${fmt(t.amount)}</span></div>`;
      }).join("");
      heroHtml = `<div class="settle-hero"><div class="settle-label">שורה תחתונה — מי חייב למי</div>${lines}</div>`;
    }

    const cards = state.people.map(p => {
      const net = s.net[p.id] || 0;
      const cls = net > 0.5 ? "pos" : net < -0.5 ? "neg" : "muted";
      const netTxt = Math.abs(net) < 0.5 ? "מאוזן" : (net > 0 ? `+${fmt(net)}` : `−${fmt(Math.abs(net))}`);
      const status = Math.abs(net) < 0.5 ? "מאוזן/ת" : net > 0 ? "מגיע/ה לו/לה החזר" : "חייב/ת";
      return `
        <div class="person-card" style="--person-c:${p.color}">
          <div class="person-head">
            <div class="person-av" style="background:${p.color}">${p.icon}</div>
            <div>
              <div class="person-name">${esc(p.name)}</div>
              <div class="cat-card-count">${status}</div>
            </div>
          </div>
          <div class="person-line"><span class="muted">שילם/ה בפועל</span><span>${fmt(s.paid[p.id])}</span></div>
          <div class="person-line"><span class="muted">החלק שלו/שלה בהוצאות</span><span>${fmt(s.share[p.id])}</span></div>
          <div class="person-line total"><span>מאזן</span><span class="${cls}">${netTxt}</span></div>
        </div>`;
    }).join("");

    content.innerHTML = `
      <div class="section-title">התחשבנות בין בני הזוג</div>
      <div class="section-sub">${MONTHS[curMonth]} ${curYear} — חלוקת הוצאות וחישוב מי חייב למי</div>
      <div class="filters">
        <button class="chip ${!settleIncludePending ? "active" : ""}" data-pend="0">רק מה ששולם</button>
        <button class="chip ${settleIncludePending ? "active" : ""}" data-pend="1">כולל ממתין לתשלום</button>
      </div>
      ${heroHtml}
      <div class="person-grid">${cards}</div>
      <div class="panel">
        <div class="panel-head">
          <h3>סה״כ הוצאות משותפות: ${fmt(s.totalShared)}</h3>
          ${s.pending > 0 && !settleIncludePending ? `<span class="badge badge-unpaid">${s.pending} ממתינים לא נכללו</span>` : ""}
        </div>
        <div id="settleBills"></div>
      </div>
    `;

    $$("[data-pend]").forEach(c => c.addEventListener("click", () => {
      settleIncludePending = c.dataset.pend === "1"; renderSettlement();
    }));

    const list = $("#settleBills");
    const bills = billsForMonth(curYear, curMonth).filter(b => b.type !== "income")
      .filter(b => settleIncludePending || b.status === "paid").sort(sortBills);
    if (!bills.length) {
      list.innerHTML = emptyHtml("🤝", "אין הוצאות להתחשבנות", "סמנו הוצאות כ\"שולם\" או הוסיפו חדשות");
    } else {
      list.innerHTML = bills.map(billRowHtml).join("");
      bindBillRows(list);
    }
  }

  /* ---------- Categories ---------- */
  function renderCategories() {
    const bills = billsForMonth(curYear, curMonth).filter(b => b.type !== "income");
    content.innerHTML = `
      <div class="section-title">קטגוריות</div>
      <div class="section-sub">ניהול קטגוריות והגדרת תקציב חודשי</div>
      <div class="cat-grid" id="catGrid"></div>
    `;
    const grid = $("#catGrid");
    grid.innerHTML = state.categories.map(c => {
      const cBills = bills.filter(b => b.category === c.id);
      const sum = cBills.reduce((s,b)=>s+(+b.amount||0),0);
      let budgetHtml = "";
      if (c.budget > 0) {
        const pct = Math.min(100, (sum / c.budget) * 100);
        const over = sum > c.budget;
        const col = over ? "var(--danger)" : pct > 80 ? "var(--warn)" : "var(--success)";
        budgetHtml = `
          <div class="cat-budget">
            <div class="cat-budget-bar"><div class="cat-budget-fill" style="width:${pct}%;background:${col}"></div></div>
            <div class="cat-budget-text"><span>${fmt(sum)} / ${fmt(c.budget)}</span><span style="color:${col}">${Math.round(pct)}%</span></div>
          </div>`;
      }
      return `
        <div class="cat-card" data-cat="${c.id}">
          <div class="cat-card-head">
            <div class="cat-card-icon" style="background:${c.color}">${c.icon}</div>
            <div>
              <div class="cat-card-name">${esc(c.name)}</div>
              <div class="cat-card-count">${cBills.length} חשבונות החודש</div>
            </div>
          </div>
          <div class="cat-card-amount">${fmt(sum)}</div>
          ${budgetHtml}
        </div>`;
    }).join("") + `<div class="cat-card cat-add-card" id="addCatCard"><span style="font-size:22px">＋</span> קטגוריה חדשה</div>`;

    $$(".cat-card[data-cat]").forEach(card =>
      card.addEventListener("click", () => openCatModal(card.dataset.cat)));
    $("#addCatCard").addEventListener("click", () => openCatModal());
  }

  /* ---------- Reports ---------- */
  function renderReports() {
    content.innerHTML = `
      <div class="section-title">דוחות</div>
      <div class="section-sub">ניתוח מגמות לאורך 6 החודשים האחרונים</div>
      <div class="panel">
        <div class="panel-head"><h3>הכנסות מול הוצאות</h3></div>
        <div class="chart-wrap"><canvas id="trendChart"></canvas></div>
      </div>
      <div class="grid-2">
        <div class="panel">
          <div class="panel-head"><h3>פילוח הוצאות (החודש)</h3></div>
          <div class="chart-wrap sm"><canvas id="catChart2"></canvas></div>
        </div>
        <div class="panel">
          <div class="panel-head"><h3>סיכום</h3></div>
          <div id="reportSummary"></div>
        </div>
      </div>
    `;
    drawTrendChart();
    const exp = billsForMonth(curYear, curMonth).filter(b => b.type !== "income");
    drawCategoryChart(exp, "catChart2");
    renderReportSummary();
  }

  function renderReportSummary() {
    const months = lastMonths(6);
    let totalExp = 0, totalInc = 0;
    months.forEach(({ y, m }) => {
      billsForMonth(y, m).forEach(b => {
        if (b.type === "income") totalInc += +b.amount || 0; else totalExp += +b.amount || 0;
      });
    });
    const avg = totalExp / months.length;
    const allExp = billsForMonth(curYear, curMonth).filter(b=>b.type!=="income");
    const byCat = {};
    allExp.forEach(b => byCat[b.category] = (byCat[b.category]||0) + (+b.amount||0));
    const top = Object.entries(byCat).sort((a,b)=>b[1]-a[1])[0];
    const topCat = top ? catById(top[0]) : null;

    $("#reportSummary").innerHTML = `
      <div class="setting-row"><div><strong>סך הוצאות (6 ח')</strong></div><div style="font-weight:800;color:var(--danger)">${fmt(totalExp)}</div></div>
      <div class="setting-row"><div><strong>סך הכנסות (6 ח')</strong></div><div style="font-weight:800;color:var(--success)">${fmt(totalInc)}</div></div>
      <div class="setting-row"><div><strong>ממוצע הוצאה חודשית</strong></div><div style="font-weight:800">${fmt(avg)}</div></div>
      <div class="setting-row"><div><strong>הקטגוריה היקרה החודש</strong></div><div style="font-weight:800">${topCat ? `${topCat.icon} ${esc(topCat.name)}` : "—"}</div></div>
    `;
  }

  /* ---------- Settings ---------- */
  function renderSettings() {
    const billCount = state.bills.length;
    content.innerHTML = `
      <div class="section-title">הגדרות</div>
      <div class="section-sub">בני זוג, נתונים, גיבוי וכלים</div>
      <div class="panel">
        <div class="panel-head"><h3>בני הזוג</h3></div>
        <div id="peopleRows"></div>
      </div>
      <div class="panel">
        <div class="panel-head"><h3>ניהול נתונים</h3></div>
        <div class="setting-row">
          <div><strong>גיבוי נתונים</strong><div class="desc">ייצוא כל הנתונים לקובץ JSON</div></div>
          <button class="btn btn-ghost" id="exportBtn">📥 ייצוא</button>
        </div>
        <div class="setting-row">
          <div><strong>שחזור מגיבוי</strong><div class="desc">ייבוא נתונים מקובץ JSON</div></div>
          <button class="btn btn-ghost" id="importBtn">📤 ייבוא</button>
          <input type="file" id="importFile" accept="application/json" hidden />
        </div>
        <div class="setting-row">
          <div><strong>שכפול חשבונות קבועים</strong><div class="desc">העתקת ההוצאות הקבועות לחודש הנוכחי</div></div>
          <button class="btn btn-ghost" id="cloneBtn">🔁 שכפל</button>
        </div>
        <div class="setting-row">
          <div><strong>איפוס הכל</strong><div class="desc">מחיקת כל הנתונים (${billCount} רישומים)</div></div>
          <button class="btn btn-ghost" id="resetBtn" style="color:var(--danger)">🗑️ איפוס</button>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><h3>אודות</h3></div>
        <p style="color:var(--text-soft);font-size:14px;line-height:1.7">
          אפליקציה לניהול ומעקב חשבונות הבית. כל הנתונים נשמרים מקומית בדפדפן שלכם (localStorage) — שום מידע לא נשלח לשרת.
          ניתן לעבוד גם ללא חיבור לאינטרנט. מומלץ לבצע גיבוי מעת לעת.
        </p>
      </div>
    `;
    $("#peopleRows").innerHTML = state.people.map(p => {
      const isCurrent = state.settings.currentUser === p.id;
      return `
        <div class="setting-row">
          <div style="display:flex;align-items:center;gap:12px">
            <span class="person-av" style="background:${p.color};width:40px;height:40px;font-size:20px">${p.icon}</span>
            <div><strong>${esc(p.name)}</strong>${isCurrent ? ` <span class="badge badge-recurring">מחובר/ת</span>` : ""}</div>
          </div>
          <button class="btn btn-ghost" data-editperson="${p.id}">✏️ עריכה</button>
        </div>`;
    }).join("");
    $$("[data-editperson]").forEach(b => b.addEventListener("click", () => openPersonModal(b.dataset.editperson)));

    $("#exportBtn").addEventListener("click", exportData);
    $("#importBtn").addEventListener("click", () => $("#importFile").click());
    $("#importFile").addEventListener("change", importData);
    $("#cloneBtn").addEventListener("click", cloneRecurring);
    $("#resetBtn").addEventListener("click", resetAll);
  }

  /* ---------- Charts ---------- */
  function chartColors() {
    const dark = state.settings.theme === "dark";
    return { text: dark ? "#9aa4b6" : "#667085", grid: dark ? "#2a3140" : "#e6e9f0" };
  }

  function drawCategoryChart(exp, canvasId = "catChart") {
    const el = $("#" + canvasId);
    if (!el) return;
    const byCat = {};
    exp.forEach(b => byCat[b.category] = (byCat[b.category]||0) + (+b.amount||0));
    const entries = Object.entries(byCat).filter(([,v]) => v > 0);
    if (!entries.length) {
      el.parentElement.innerHTML = emptyHtml("📊", "אין נתונים", "הוסיפו הוצאות כדי לראות פילוח");
      return;
    }
    const labels = entries.map(([id]) => (catById(id)?.name) || "כללי");
    const data = entries.map(([,v]) => v);
    const colors = entries.map(([id]) => (catById(id)?.color) || "#94a3b8");
    charts[canvasId] = new Chart(el, {
      type: "doughnut",
      data: { labels, datasets: [{ data, backgroundColor: colors, borderWidth: 0, hoverOffset: 6 }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: "62%",
        plugins: {
          legend: { position: "bottom", labels: { color: chartColors().text, font: { family: "Heebo", size: 12 }, padding: 14, usePointStyle: true } },
          tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${fmt(ctx.parsed)}` } }
        }
      }
    });
  }

  function drawTrendChart() {
    const el = $("#trendChart");
    if (!el) return;
    const months = lastMonths(6);
    const labels = months.map(({ m, y }) => `${MONTHS[m].slice(0,3)}' ${String(y).slice(2)}`);
    const expData = months.map(({ y, m }) => billsForMonth(y, m).filter(b=>b.type!=="income").reduce((s,b)=>s+(+b.amount||0),0));
    const incData = months.map(({ y, m }) => billsForMonth(y, m).filter(b=>b.type==="income").reduce((s,b)=>s+(+b.amount||0),0));
    const cc = chartColors();
    charts.trend = new Chart(el, {
      type: "bar",
      data: { labels, datasets: [
        { label: "הוצאות", data: expData, backgroundColor: "#ef4444", borderRadius: 6, maxBarThickness: 34 },
        { label: "הכנסות", data: incData, backgroundColor: "#10b981", borderRadius: 6, maxBarThickness: 34 },
      ]},
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { labels: { color: cc.text, font: { family: "Heebo" }, usePointStyle: true } },
          tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${fmt(ctx.parsed.y)}` } } },
        scales: {
          x: { ticks: { color: cc.text, font: { family: "Heebo" } }, grid: { display: false } },
          y: { ticks: { color: cc.text, font: { family: "Heebo" }, callback: v => fmt(v) }, grid: { color: cc.grid } }
        }
      }
    });
  }

  function lastMonths(n) {
    const arr = [];
    for (let i = n - 1; i >= 0; i--) {
      const d = new Date(curYear, curMonth - i, 1);
      arr.push({ y: d.getFullYear(), m: d.getMonth() });
    }
    return arr;
  }

  /* ---------- Empty ---------- */
  function emptyHtml(icon, title, sub) {
    return `<div class="empty"><div class="empty-icon">${icon}</div><h4>${title}</h4><div>${sub}</div></div>`;
  }

  /* ===================================================================
   *  MODALS
   * =================================================================== */
  function fillCategorySelect() {
    $("#billCategory").innerHTML = state.categories
      .map(c => `<option value="${c.id}">${c.icon} ${esc(c.name)}</option>`).join("");
  }

  function fillPeopleSelects() {
    const opts = state.people.map(p => `<option value="${p.id}">${p.icon} ${esc(p.name)}</option>`).join("");
    $("#billPaidBy").innerHTML = opts;
    $("#billSplitTarget").innerHTML = opts;
  }

  function buildCustomInputs(current) {
    $("#splitCustomInputs").innerHTML = state.people.map(p => {
      const val = (current && current[p.id] != null) ? current[p.id] : Math.round(100 / state.people.length);
      return `
        <div class="split-line">
          <span class="split-av" style="background:${p.color}">${p.icon}</span>
          <span class="split-name">${esc(p.name)}</span>
          <input type="number" min="0" max="100" step="1" data-pct="${p.id}" value="${val}" />
          <span>%</span>
        </div>`;
    }).join("");
    $$("#splitCustomInputs input").forEach(inp => inp.addEventListener("input", updateSplitHint));
    updateSplitHint();
  }

  function updateSplitHint() {
    const total = $$("#splitCustomInputs input").reduce((s, i) => s + (parseFloat(i.value) || 0), 0);
    const hint = $("#splitHint");
    hint.textContent = `סך האחוזים: ${total}% ${total === 100 ? "✓" : "(צריך להסתכם ל-100%)"}`;
    hint.classList.toggle("err", total !== 100);
  }

  function applySplitMode() {
    const mode = $("#billSplit").value;
    const isMulti = state.people.length > 1;
    $("#payRow").style.display = isMulti ? "" : "none";
    $("#splitSingleRow").style.display = mode === "single" && isMulti ? "" : "none";
    $("#splitCustomRow").style.display = mode === "custom" && isMulti ? "" : "none";
  }

  function openBillModal(id) {
    fillCategorySelect();
    fillPeopleSelects();
    const form = $("#billForm");
    form.reset();
    const del = $("#deleteBillBtn");
    if (id) {
      const b = state.bills.find(x => x.id === id);
      if (!b) return;
      $("#modalTitle").textContent = "עריכת הוצאה";
      $("#billId").value = b.id;
      $("#billCategory").value = b.category;
      $("#billName").value = b.name || "";
      $("#billAmount").value = b.amount;
      $("#billDue").value = b.due || "";
      $("#billType").value = b.type || "expense";
      $("#billStatus").value = b.status || "unpaid";
      $("#billPaidBy").value = b.paidBy || (state.people[0] && state.people[0].id);
      $("#billSplit").value = b.split || "equal";
      if (b.splitTarget) $("#billSplitTarget").value = b.splitTarget;
      buildCustomInputs(b.splitCustom);
      $("#billRecurring").checked = !!b.recurring;
      $("#billNote").value = b.note || "";
      del.style.display = "inline-flex";
    } else {
      $("#modalTitle").textContent = "הוצאה חדשה";
      $("#billId").value = "";
      $("#billDue").value = monthKey(curYear, curMonth) + "-10";
      $("#billPaidBy").value = state.settings.currentUser || (state.people[0] && state.people[0].id);
      $("#billSplit").value = "equal";
      buildCustomInputs(null);
      del.style.display = "none";
    }
    toggleTypeFields();
    applySplitMode();
    openModal("#modalBackdrop");
    setTimeout(() => $("#billAmount").focus(), 60);
  }

  function toggleTypeFields() {
    const isIncome = $("#billType").value === "income";
    $("#payRow").style.display = isIncome ? "none" : "";
    if (isIncome) {
      $("#splitSingleRow").style.display = "none";
      $("#splitCustomRow").style.display = "none";
    } else {
      applySplitMode();
    }
  }

  function saveBill(e) {
    e.preventDefault();
    const id = $("#billId").value;
    const splitCustom = {};
    $$("#splitCustomInputs input").forEach(i => splitCustom[i.dataset.pct] = parseFloat(i.value) || 0);
    const data = {
      category: $("#billCategory").value,
      name: $("#billName").value.trim(),
      amount: parseFloat($("#billAmount").value) || 0,
      due: $("#billDue").value,
      type: $("#billType").value,
      status: $("#billStatus").value,
      paidBy: $("#billPaidBy").value,
      split: $("#billSplit").value,
      splitTarget: $("#billSplitTarget").value,
      splitCustom,
      recurring: $("#billRecurring").checked,
      note: $("#billNote").value.trim(),
    };
    if (id) {
      const b = state.bills.find(x => x.id === id);
      Object.assign(b, data);
      toast("עודכן בהצלחה ✓");
    } else {
      data.id = uid();
      data.month = $("#billDue").value ? $("#billDue").value.slice(0, 7) : monthKey(curYear, curMonth);
      state.bills.push(data);
      toast("נוסף בהצלחה ✓");
    }
    save();
    closeModal("#modalBackdrop");
    render();
  }

  function deleteBill() {
    const id = $("#billId").value;
    if (!id) return;
    if (!confirm("למחוק את ההוצאה?")) return;
    state.bills = state.bills.filter(b => b.id !== id);
    save();
    closeModal("#modalBackdrop");
    render();
    toast("נמחק");
  }

  /* ---------- Category modal ---------- */
  function openCatModal(id) {
    const form = $("#catForm");
    form.reset();
    const del = $("#deleteCatBtn");
    if (id) {
      const c = catById(id);
      $("#catModalTitle").textContent = "עריכת קטגוריה";
      $("#catId").value = c.id;
      $("#catIcon").value = c.icon;
      $("#catColor").value = c.color;
      $("#catName").value = c.name;
      $("#catBudget").value = c.budget || "";
      del.style.display = "inline-flex";
    } else {
      $("#catModalTitle").textContent = "קטגוריה חדשה";
      $("#catId").value = "";
      $("#catIcon").value = "🏷️";
      $("#catColor").value = "#6366f1";
      del.style.display = "none";
    }
    openModal("#catModalBackdrop");
  }

  function saveCat(e) {
    e.preventDefault();
    const id = $("#catId").value;
    const data = {
      icon: $("#catIcon").value.trim() || "🏷️",
      color: $("#catColor").value,
      name: $("#catName").value.trim(),
      budget: parseFloat($("#catBudget").value) || 0,
    };
    if (!data.name) return;
    if (id) {
      Object.assign(catById(id), data);
      toast("הקטגוריה עודכנה ✓");
    } else {
      data.id = uid();
      state.categories.push(data);
      toast("קטגוריה נוספה ✓");
    }
    save();
    closeModal("#catModalBackdrop");
    render();
  }

  function deleteCat() {
    const id = $("#catId").value;
    if (!id) return;
    const used = state.bills.some(b => b.category === id);
    if (used && !confirm("קיימים חשבונות בקטגוריה זו. למחוק בכל זאת? (החשבונות יישארו ללא קטגוריה)")) return;
    if (!used && !confirm("למחוק את הקטגוריה?")) return;
    state.categories = state.categories.filter(c => c.id !== id);
    save();
    closeModal("#catModalBackdrop");
    render();
    toast("הקטגוריה נמחקה");
  }

  /* ---------- Data tools ---------- */
  function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `חשבונות-בית-${monthKey(curYear, curMonth)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast("הקובץ יוצא ✓");
  }

  function importData(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data.bills || !data.categories) throw new Error("invalid");
        state = data;
        if (!state.people || !state.people.length) state.people = JSON.parse(JSON.stringify(DEFAULT_PEOPLE));
        if (!state.settings) state.settings = { theme: "light" };
        state.bills.forEach(b => migrateBill(b, state.people));
        save();
        applyTheme();
        render();
        toast("הנתונים יובאו בהצלחה ✓");
      } catch (err) { toast("קובץ לא תקין"); }
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  function cloneRecurring() {
    const key = monthKey(curYear, curMonth);
    const recurring = state.bills.filter(b => b.recurring);
    const seen = new Set(state.bills.filter(b => b.month === key).map(b => b.category + "|" + (b.name||"")));
    let added = 0;
    recurring.forEach(b => {
      const sig = b.category + "|" + (b.name||"");
      if (b.month === key || seen.has(sig)) return;
      seen.add(sig);
      const day = b.due ? b.due.slice(8) : "10";
      state.bills.push({ ...b, id: uid(), month: key, due: `${key}-${day}`, status: "unpaid" });
      added++;
    });
    save();
    render();
    toast(added ? `שוכפלו ${added} חשבונות קבועים ✓` : "אין חשבונות קבועים חדשים לשכפול");
  }

  function resetAll() {
    if (!confirm("האם למחוק את כל הנתונים? פעולה זו אינה הפיכה.")) return;
    state = { categories: [...DEFAULT_CATEGORIES], people: state.people, bills: [], settings: state.settings };
    save();
    render();
    toast("כל הנתונים אופסו");
  }

  /* ---------- Modal helpers ---------- */
  function openModal(sel) { $(sel).classList.add("open"); }
  function closeModal(sel) { $(sel).classList.remove("open"); }

  /* ---------- Welcome / current user ---------- */
  function showWelcome() {
    const wrap = $("#welcomeProfiles");
    wrap.innerHTML = state.people.map(p => `
      <button class="welcome-profile" data-person="${p.id}" style="--profile-c:${p.color}">
        <div class="wp-av" style="background:${p.color}">${p.icon}</div>
        <div class="wp-name">${esc(p.name)}</div>
      </button>`).join("");
    $$(".welcome-profile").forEach(b => b.addEventListener("click", () => {
      state.settings.currentUser = b.dataset.person;
      state.settings.welcomed = true;
      save();
      hideWelcome();
      renderUserChip();
      toast(`שלום ${personById(b.dataset.person)?.name} 👋`);
    }));
    $("#welcome").classList.add("open");
  }
  function hideWelcome() {
    state.settings.welcomed = true; save();
    $("#welcome").classList.remove("open");
  }

  function renderUserChip() {
    const p = personById(state.settings.currentUser);
    $$(".js-user-av").forEach(av => {
      av.textContent = p ? p.icon : "👤";
      av.style.background = p ? p.color : "var(--text-mut)";
    });
    $$(".js-user-name").forEach(n => n.textContent = p ? p.name : "אורח/ת");
  }

  /* ---------- Person edit ---------- */
  function openPersonModal(id) {
    const p = personById(id);
    if (!p) return;
    $("#personId").value = p.id;
    $("#personIcon").value = p.icon;
    $("#personColor").value = p.color;
    $("#personName").value = p.name;
    openModal("#personModalBackdrop");
  }
  function savePerson(e) {
    e.preventDefault();
    const p = personById($("#personId").value);
    if (!p) return;
    p.name = $("#personName").value.trim() || p.name;
    p.icon = $("#personIcon").value.trim() || p.icon;
    p.color = $("#personColor").value;
    save();
    closeModal("#personModalBackdrop");
    render();
    toast("הפרטים נשמרו ✓");
  }

  /* ---------- Theme ---------- */
  function applyTheme() {
    const dark = state.settings.theme === "dark";
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    $$(".theme-icon").forEach(ti => ti.textContent = dark ? "☀️" : "🌙");
    $$(".theme-label").forEach(tl => tl.textContent = dark ? "מצב בהיר" : "מצב כהה");
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", dark ? "#171b24" : "#6366f1");
  }

  /* ===================================================================
   *  EVENTS
   * =================================================================== */
  function bindGlobal() {
    $$(".nav-item").forEach(n => n.addEventListener("click", () => {
      view = n.dataset.view; render(); scrollTop();
    }));
    $$(".js-settings").forEach(b => b.addEventListener("click", () => { view = "settings"; render(); scrollTop(); }));

    $("#prevMonth").addEventListener("click", () => {
      curMonth--; if (curMonth < 0) { curMonth = 11; curYear--; } render();
    });
    $("#nextMonth").addEventListener("click", () => {
      curMonth++; if (curMonth > 11) { curMonth = 0; curYear++; } render();
    });

    $$(".js-add").forEach(b => b.addEventListener("click", () => openBillModal()));
    $("#billForm").addEventListener("submit", saveBill);
    $("#deleteBillBtn").addEventListener("click", deleteBill);
    $("#modalClose").addEventListener("click", () => closeModal("#modalBackdrop"));
    $("#cancelBtn").addEventListener("click", () => closeModal("#modalBackdrop"));
    $("#billType").addEventListener("change", toggleTypeFields);
    $("#billSplit").addEventListener("change", applySplitMode);

    $("#personForm").addEventListener("submit", savePerson);
    $("#personModalClose").addEventListener("click", () => closeModal("#personModalBackdrop"));
    $("#personCancelBtn").addEventListener("click", () => closeModal("#personModalBackdrop"));
    $$(".js-user").forEach(b => b.addEventListener("click", showWelcome));
    $("#welcomeSkip").addEventListener("click", () => {
      state.settings.currentUser = null; hideWelcome(); renderUserChip();
    });
    $("#welcome").addEventListener("click", e => { if (e.target.id === "welcome") hideWelcome(); });

    $("#catForm").addEventListener("submit", saveCat);
    $("#deleteCatBtn").addEventListener("click", deleteCat);
    $("#catModalClose").addEventListener("click", () => closeModal("#catModalBackdrop"));
    $("#catCancelBtn").addEventListener("click", () => closeModal("#catModalBackdrop"));

    $$(".modal-backdrop").forEach(bd => bd.addEventListener("click", e => {
      if (e.target === bd) bd.classList.remove("open");
    }));
    document.addEventListener("keydown", e => {
      if (e.key === "Escape") $$(".modal-backdrop.open").forEach(m => m.classList.remove("open"));
    });

    $$(".js-theme").forEach(b => b.addEventListener("click", () => {
      state.settings.theme = state.settings.theme === "dark" ? "light" : "dark";
      save(); applyTheme(); render();
    }));
  }

  function scrollTop() {
    const sc = document.querySelector(".content-scroll");
    if (sc) sc.scrollTop = 0;
  }

  /* ---------- Init ---------- */
  /* ---------- PWA ---------- */
  let deferredPrompt = null;
  function setupPWA() {
    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
    window.addEventListener("beforeinstallprompt", e => {
      e.preventDefault();
      deferredPrompt = e;
      if (!state.settings.installDismissed) $("#installBanner").classList.add("show");
    });
    $("#installBtn")?.addEventListener("click", async () => {
      $("#installBanner").classList.remove("show");
      if (deferredPrompt) { deferredPrompt.prompt(); await deferredPrompt.userChoice; deferredPrompt = null; }
    });
    $("#installDismiss")?.addEventListener("click", () => {
      $("#installBanner").classList.remove("show");
      state.settings.installDismissed = true; save();
    });
    window.addEventListener("appinstalled", () => {
      $("#installBanner").classList.remove("show");
      toast("האפליקציה הותקנה ✓");
    });
  }

  function init() {
    applyTheme();
    bindGlobal();
    render();
    setupPWA();
    if (!state.settings.welcomed) showWelcome();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
