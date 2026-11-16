const TABS = [
  { id: "approval", label: "Needs approval", states: ["awaiting_approval"] },
  { id: "deposit", label: "Awaiting deposit", states: ["awaiting_deposit"] },
  { id: "upcoming", label: "Upcoming confirmed", states: ["confirmed"], upcoming: true },
  { id: "closed", label: "Past & closed", states: ["confirmed", "denied", "expired", "cancelled"], past: true },
];

let all = [];
let activeTab = "approval";

function inTab(b, tab) {
  const state = Bookings.state(b);
  const today = toISO(new Date());
  if (!tab.states.includes(state)) return false;
  if (state === "confirmed" && tab.upcoming) return b.checkOut > today;
  if (state === "confirmed" && tab.past) return b.checkOut <= today;
  return true;
}

const METHOD = { qr: "DuitNow QR", cash: "Cash" };

function cardHTML(b) {
  const room = getRoom(b.roomId);
  const state = Bookings.state(b);
  const nights = nightsBetween(b.checkIn, b.checkOut);
  const total = bookingTotal(b);
  const g = b.guest || {};
  const contact = [
    g.phone ? `<a href="tel:${escapeHTML(g.phone)}">${escapeHTML(g.phone)}</a>` : "",
    g.email ? `<a href="mailto:${escapeHTML(g.email)}">${escapeHTML(g.email)}</a>` : "",
  ].filter(Boolean).join(" · ") || "No contact details";
  let payment = "";
  if (b.paymentMethod) {
    payment = `Paid by ${METHOD[b.paymentMethod] || escapeHTML(b.paymentMethod)}` +
      (b.paymentRef ? ` · ref <b>${escapeHTML(b.paymentRef)}</b>` : "");
  } else if (state === "awaiting_deposit") {
    payment = `Deposit not paid yet · hold ends ${formatDateTime(Bookings.holdDeadline(b))}`;
  }
  const actions = {
    awaiting_approval: `<button class="btn btn-primary" data-approve="${b.id}">Approve</button>
                        <button class="btn btn-ghost" data-deny="${b.id}">Decline</button>`,
    awaiting_deposit: `<button class="btn btn-primary" data-cash="${b.id}">Cash received – approve</button>
                       <button class="btn btn-ghost" data-deny="${b.id}">Decline</button>`,
  }[state] || "";
  const outcome = state === "denied"
    ? `<p class="note">Declined${b.denyReason ? `: “${escapeHTML(b.denyReason)}”` : ""}${b.depositRefund ? ` · <b>refund RM${PAYMENT.deposit} deposit</b>` : ""}</p>`
    : "";
  return `
    <div class="admin-card">
      <div class="admin-card-main">
        <span class="badge ${STATUS[state].badge}">${STATUS[state].label}</span>
        <h3>${escapeHTML(room.name)} · ${formatDate(b.checkIn)} → ${formatDate(b.checkOut)}</h3>
        <div class="meta">${nights} night${nights > 1 ? "s" : ""} · ${b.guests} guest${b.guests > 1 ? "s" : ""} · total RM ${total} · balance on arrival RM ${total - PAYMENT.deposit}</div>
        <div class="guest"><b>${escapeHTML(g.name || "Unknown guest")}</b> · ${contact}</div>
        ${payment ? `<div class="meta">${payment}</div>` : ""}
        ${outcome}
        <div class="meta small">Booking #${b.id.slice(0, 6).toUpperCase()}${b.createdAt ? ` · made ${formatDateTime(b.createdAt)}` : ""}</div>
      </div>
      <div class="actions">${actions}</div>
    </div>`;
}

function render() {
  document.getElementById("admin-tabs").innerHTML = TABS.map((t) => {
    const count = all.filter((b) => inTab(b, t)).length;
    return `<button class="${t.id === activeTab ? "active" : ""}" data-tab="${t.id}">${t.label} <span class="count">${count}</span></button>`;
  }).join("");
  const tab = TABS.find((t) => t.id === activeTab);
  const list = all.filter((b) => inTab(b, tab));
  if (tab.upcoming || tab.id === "approval" || tab.id === "deposit") list.sort((a, b) => a.checkIn.localeCompare(b.checkIn));
  document.getElementById("admin-list").innerHTML = list.length
    ? list.map(cardHTML).join("")
    : `<p class="empty">Nothing here.</p>`;
}

function showMsg(text, ok) {
  const el = document.getElementById("admin-msg");
  el.className = "alert " + (ok ? "alert-ok" : "alert-error");
  el.textContent = text;
}

async function reload() {
  all = await Admin.loadAll();
  render();
}

ready.then(async () => {
  const user = Auth.require();
  if (!user) return;
  if (!user.isAdmin) {
    document.getElementById("admin-denied").classList.remove("hidden");
    return;
  }
  document.getElementById("admin").classList.remove("hidden");
  await reload();

  document.getElementById("admin-tabs").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-tab]");
    if (!btn) return;
    activeTab = btn.dataset.tab;
    document.getElementById("admin-msg").classList.add("hidden");
    render();
  });

  document.getElementById("admin-list").addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (!btn) return;
    const id = btn.dataset.approve || btn.dataset.cash || btn.dataset.deny;
    const b = all.find((x) => x.id === id);
    if (!b) return;
    const name = `${getRoom(b.roomId).name}, ${formatDate(b.checkIn)}`;
    try {
      if (btn.dataset.deny) {
        const refund = b.status === "awaiting_approval"
          ? `\n\nThe guest has marked the RM${PAYMENT.deposit} deposit as paid, so they will be told it will be refunded.` : "";
        const reason = prompt(`Decline ${name}?${refund}\n\nReason shown to the guest (optional):`, "");
        if (reason === null) return;
        btn.disabled = true;
        await Admin.deny(b, reason);
        showMsg(`Declined ${name}. The dates are free again.`, true);
      } else {
        const cash = !!btn.dataset.cash;
        if (cash && !confirm(`Confirm you received the RM${PAYMENT.deposit} cash deposit for ${name}?`)) return;
        btn.disabled = true;
        await Admin.approve(b, { cashReceived: cash });
        showMsg(`Approved ${name}.`, true);
      }
      await reload();
    } catch (err) {
      showMsg(err.message, false);
      btn.disabled = false;
    }
  });
});
