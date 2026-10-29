const form = document.getElementById("search-form");
const locationSel = document.getElementById("q");
const checkInEl = document.getElementById("check-in");
const checkOutEl = document.getElementById("check-out");
const guestsSel = document.getElementById("guests");
const grid = document.getElementById("room-grid");
const errorBox = document.getElementById("search-error");

const today = toISO(new Date());
checkInEl.min = today;
checkOutEl.min = addDays(today, 1);

[...new Set(ROOMS.map((r) => r.location))].sort().forEach((loc) => {
  locationSel.add(new Option(loc, loc));
});
for (let n = 1; n <= 8; n++) guestsSel.add(new Option(`${n} guest${n > 1 ? "s" : ""}`, n));

// Restore a previous search from the URL so the back button keeps results.
const params = new URLSearchParams(location.search);
locationSel.value = params.get("where") || "";
checkInEl.value = params.get("in") || "";
checkOutEl.value = params.get("out") || "";
guestsSel.value = params.get("guests") || "1";

checkInEl.addEventListener("change", () => {
  if (!checkInEl.value) return;
  checkOutEl.min = addDays(checkInEl.value, 1);
  if (!checkOutEl.value || checkOutEl.value <= checkInEl.value) checkOutEl.value = addDays(checkInEl.value, 1);
});

function render() {
  const where = locationSel.value;
  const checkIn = checkInEl.value;
  const checkOut = checkOutEl.value;
  const guests = Number(guestsSel.value);
  const hasDates = checkIn && checkOut;

  errorBox.classList.add("hidden");
  if ((checkIn && !checkOut) || (!checkIn && checkOut)) {
    errorBox.textContent = "Please choose both check-in and check-out dates.";
    errorBox.classList.remove("hidden");
    return;
  }
  if (hasDates && checkOut <= checkIn) {
    errorBox.textContent = "Check-out must be after check-in.";
    errorBox.classList.remove("hidden");
    return;
  }

  const rooms = ROOMS.filter((r) => (!where || r.location === where) && r.guests >= guests).map((r) => ({
    ...r,
    available: hasDates ? Bookings.isAvailable(r.id, checkIn, checkOut) : null,
  }));
  // Available rooms first when the guest has chosen dates.
  rooms.sort((a, b) => (b.available === true) - (a.available === true));

  const nights = hasDates ? nightsBetween(checkIn, checkOut) : 0;
  const availableCount = rooms.filter((r) => r.available).length;
  document.getElementById("results-title").textContent = hasDates
    ? `${formatDate(checkIn)} – ${formatDate(checkOut)}`
    : "All rooms";
  document.getElementById("results-count").textContent = hasDates
    ? `${availableCount} of ${rooms.length} available · ${nights} night${nights > 1 ? "s" : ""}`
    : `${rooms.length} room${rooms.length === 1 ? "" : "s"}`;

  const query = hasDates ? `&in=${checkIn}&out=${checkOut}&guests=${guests}` : "";
  grid.innerHTML = rooms.length
    ? rooms.map((r) => {
        const badge = r.available === null ? ""
          : r.available ? `<span class="badge badge-ok">Available</span>`
          : `<span class="badge badge-no">Booked for these dates</span>`;
        const price = hasDates
          ? `<b>RM ${r.price * nights}</b> total · RM ${r.price}/night`
          : `<b>RM ${r.price}</b> / night`;
        return `
          <a class="room-card ${r.available === false ? "unavailable" : ""}" href="room.html?id=${r.id}${query}">
            <img src="${r.image}" alt="${escapeHTML(r.name)}" loading="lazy">
            <div class="body">
              ${badge}
              <h3>${escapeHTML(r.name)}</h3>
              <div class="meta">${escapeHTML(r.location)} · up to ${r.guests} guests · ${r.beds} bedroom${r.beds > 1 ? "s" : ""}</div>
              <div class="price">${price}</div>
            </div>
          </a>`;
      }).join("")
    : `<p class="empty">No rooms match your search. Try fewer guests or another location.</p>`;
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const p = new URLSearchParams();
  if (locationSel.value) p.set("where", locationSel.value);
  if (checkInEl.value) p.set("in", checkInEl.value);
  if (checkOutEl.value) p.set("out", checkOutEl.value);
  if (guestsSel.value !== "1") p.set("guests", guestsSel.value);
  history.replaceState(null, "", "?" + p.toString());
  render();
});

ready.then(render);
