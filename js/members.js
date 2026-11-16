function renderProfile(user) {
  document.getElementById("avatar").textContent = user.name.charAt(0).toUpperCase();
  document.getElementById("m-name").textContent = user.name;
  document.getElementById("m-since").textContent = `Member since ${formatDate(user.joined)}`;
  document.getElementById("p-name").value = user.name;
  document.getElementById("p-email").value = user.email;
  document.getElementById("p-phone").value = user.phone || "";
}

// What the guest should know or do next, by booking state.
function nextStep(b, state) {
  const balance = bookingTotal(b) - PAYMENT.deposit;
  switch (state) {
    case "awaiting_deposit":
      return `<p class="note">Pay the RM${PAYMENT.deposit} deposit by <b>${formatDateTime(Bookings.holdDeadline(b))}</b> to keep these dates.</p>`;
    case "awaiting_approval":
      return `<p class="note">Deposit sent. Waiting for the owner to confirm.</p>`;
    case "confirmed":
      return `<p class="note">Deposit received. Balance of RM ${balance} is paid on arrival.</p>`;
    case "denied":
      return `<p class="note">Declined by the owner${b.denyReason ? `: “${escapeHTML(b.denyReason)}”` : "."}` +
        `${b.depositRefund ? ` Your RM${PAYMENT.deposit} deposit will be refunded.` : ""}</p>`;
    case "expired":
      return `<p class="note">The deposit wasn't paid within ${PAYMENT.holdHours} hours, so the dates were released.</p>`;
    default:
      return "";
  }
}

function bookingHTML(b) {
  const room = getRoom(b.roomId);
  const nights = nightsBetween(b.checkIn, b.checkOut);
  const state = Bookings.state(b);
  const today = toISO(new Date());
  const canCancel = ["awaiting_deposit", "awaiting_approval", "confirmed"].includes(state) && b.checkIn > today;
  return `
    <div class="booking-item">
      <img src="${room.image}" alt="">
      <div>
        <span class="badge ${STATUS[state].badge}">${STATUS[state].label}</span>
        <h3><a href="room.html?id=${room.id}">${escapeHTML(room.name)}</a></h3>
        <div class="meta">${formatDate(b.checkIn)} → ${formatDate(b.checkOut)} · ${nights} night${nights > 1 ? "s" : ""} · ${b.guests} guest${b.guests > 1 ? "s" : ""}</div>
        <div class="meta">${escapeHTML(room.summary)} · RM ${bookingTotal(b)}</div>
        ${nextStep(b, state)}
      </div>
      <div class="actions">
        ${state === "awaiting_deposit" ? `<a class="btn btn-primary" href="pay.html?id=${b.id}">Pay deposit</a>` : ""}
        ${canCancel ? `<button class="btn btn-ghost" data-cancel="${b.id}">Cancel</button>` : ""}
      </div>
    </div>`;
}

function renderBookings(user) {
  const today = toISO(new Date());
  const mine = [...Bookings.forUser()].sort((a, b) => a.checkIn.localeCompare(b.checkIn));
  const withState = (states) => mine.filter((b) => states.includes(Bookings.state(b)));
  const action = withState(["awaiting_deposit"]);
  const upcoming = withState(["awaiting_approval", "confirmed"]).filter((b) => b.checkOut > today);
  const past = withState(["confirmed"]).filter((b) => b.checkOut <= today);
  const closed = withState(["denied", "expired", "cancelled"]);
  const confirmed = withState(["confirmed"]);

  document.getElementById("s-upcoming").textContent = action.length + upcoming.length;
  document.getElementById("s-nights").textContent =
    confirmed.reduce((sum, b) => sum + nightsBetween(b.checkIn, b.checkOut), 0);
  document.getElementById("s-spent").textContent = "RM " + confirmed.reduce((sum, b) => sum + bookingTotal(b), 0);

  const section = (title, list) =>
    `<div class="section-title">${title}</div>` +
    (list.length ? list.map(bookingHTML).join("") : `<p class="empty">Nothing here yet.</p>`);

  document.getElementById("bookings").innerHTML =
    (action.length ? section("Needs your action", action) : "") +
    section("Upcoming", upcoming) +
    (past.length ? section("Past stays", past) : "") +
    (closed.length ? section("Closed", closed) : "");
}

ready.then(() => {
  const user = Auth.require();
  if (!user) return;
  renderProfile(user);
  renderBookings(user);

  document.getElementById("bookings").addEventListener("click", async (e) => {
    const id = e.target.dataset.cancel;
    if (!id) return;
    const paid = ["awaiting_approval", "confirmed"].includes(Bookings.get(id).status);
    const warning = paid
      ? `Cancel this booking? Your RM${PAYMENT.deposit} deposit is non-refundable and will be forfeited.`
      : "Cancel this booking? The dates will be released for other guests.";
    if (confirm(warning)) {
      e.target.disabled = true;
      await Bookings.cancel(id);
      renderBookings(user);
    }
  });

  document.getElementById("profile-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    await Auth.update({
      name: document.getElementById("p-name").value.trim(),
      phone: document.getElementById("p-phone").value.trim(),
    });
    const updated = Auth.current();
    renderProfile(updated);
    renderNav();
    document.getElementById("profile-msg").classList.remove("hidden");
  });
});
