function renderProfile(user) {
  document.getElementById("avatar").textContent = user.name.charAt(0).toUpperCase();
  document.getElementById("m-name").textContent = user.name;
  document.getElementById("m-since").textContent = `Member since ${formatDate(user.joined)}`;
  document.getElementById("p-name").value = user.name;
  document.getElementById("p-email").value = user.email;
  document.getElementById("p-phone").value = user.phone || "";
}

function bookingHTML(b, canCancel) {
  const room = getRoom(b.roomId);
  const nights = nightsBetween(b.checkIn, b.checkOut);
  const badge = b.status === "cancelled"
    ? `<span class="badge badge-muted">Cancelled</span>`
    : `<span class="badge badge-ok">Confirmed</span>`;
  return `
    <div class="booking-item">
      <img src="${room.image}" alt="">
      <div>
        ${badge}
        <h3><a href="room.html?id=${room.id}">${escapeHTML(room.name)}</a></h3>
        <div class="meta">${formatDate(b.checkIn)} → ${formatDate(b.checkOut)} · ${nights} night${nights > 1 ? "s" : ""} · ${b.guests} guest${b.guests > 1 ? "s" : ""}</div>
        <div class="meta">${escapeHTML(room.location)} · RM ${room.price * nights + CLEANING_FEE}</div>
      </div>
      <div class="actions">
        ${canCancel ? `<button class="btn btn-ghost" data-cancel="${b.id}">Cancel</button>` : ""}
      </div>
    </div>`;
}

function renderBookings(user) {
  const today = toISO(new Date());
  const mine = [...Bookings.forUser()].sort((a, b) => a.checkIn.localeCompare(b.checkIn));
  const confirmed = mine.filter((b) => b.status === "confirmed");
  const upcoming = confirmed.filter((b) => b.checkOut > today);
  const past = confirmed.filter((b) => b.checkOut <= today);
  const cancelled = mine.filter((b) => b.status === "cancelled");

  document.getElementById("s-upcoming").textContent = upcoming.length;
  document.getElementById("s-nights").textContent =
    confirmed.reduce((sum, b) => sum + nightsBetween(b.checkIn, b.checkOut), 0);
  document.getElementById("s-spent").textContent = "RM " + confirmed.reduce(
    (sum, b) => sum + getRoom(b.roomId).price * nightsBetween(b.checkIn, b.checkOut) + CLEANING_FEE, 0);

  const section = (title, list, canCancel) =>
    `<div class="section-title">${title}</div>` +
    (list.length ? list.map((b) => bookingHTML(b, canCancel && b.checkIn > today)).join("")
                 : `<p class="empty">Nothing here yet.</p>`);

  document.getElementById("bookings").innerHTML =
    section("Upcoming", upcoming, true) +
    (past.length ? section("Past stays", past, false) : "") +
    (cancelled.length ? section("Cancelled", cancelled, false) : "");
}

ready.then(() => {
  const user = Auth.require();
  if (!user) return;
  renderProfile(user);
  renderBookings(user);

  document.getElementById("bookings").addEventListener("click", async (e) => {
    const id = e.target.dataset.cancel;
    if (id && confirm("Cancel this booking? The dates will become available to other guests.")) {
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
