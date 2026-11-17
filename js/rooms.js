const form = document.getElementById("search-form");
const checkInEl = document.getElementById("check-in");
const checkOutEl = document.getElementById("check-out");
const guestsSel = document.getElementById("guests");
const grid = document.getElementById("room-grid");
const errorBox = document.getElementById("search-error");

const today = toISO(new Date());
checkInEl.min = today;
checkOutEl.min = addDays(today, 1);
checkInEl.max = addDays(today, MAX_ADVANCE_DAYS);

const maxGuests = Math.max(...ROOMS.map((r) => r.guests));
for (let n = 1; n <= maxGuests; n++) guestsSel.add(new Option(plural(n, "guest"), n));

// Restore a previous search from the URL so the back button keeps results.
const params = new URLSearchParams(location.search);
checkInEl.value = params.get("in") || "";
checkOutEl.value = params.get("out") || "";
guestsSel.value = params.get("guests") || "1";

checkInEl.addEventListener("change", () => {
  if (!checkInEl.value) return;
  checkOutEl.min = addDays(checkInEl.value, 1);
  if (!checkOutEl.value || checkOutEl.value <= checkInEl.value) checkOutEl.value = addDays(checkInEl.value, 1);
});

function render() {
  const checkIn = checkInEl.value;
  const checkOut = checkOutEl.value;
  const guests = Number(guestsSel.value);
  const hasDates = !!(checkIn || checkOut);

  // No dates is fine (browse everything); otherwise both must make a valid stay.
  const problem = hasDates ? stayError(checkIn, checkOut, today) : null;
  errorBox.classList.toggle("hidden", !problem);
  if (problem) {
    errorBox.textContent = problem;
    return;
  }

  const rooms = ROOMS.filter((r) => r.guests >= guests).map((r) => ({
    ...r,
    available: hasDates ? Bookings.isAvailable(r.id, checkIn, checkOut) : null,
  }));
  // Available rooms first when the guest has chosen dates.
  rooms.sort((a, b) => (b.available === true) - (a.available === true));

  const member = Auth.current();
  const next = encodeURIComponent("rooms.html" + location.search);
  document.getElementById("price-note").classList.toggle("hidden", !!member);
  document.getElementById("price-signin").href = `login.html?next=${next}`;
  document.getElementById("price-register").href = `login.html?tab=register&next=${next}`;

  const nights = hasDates ? nightsBetween(checkIn, checkOut) : 0;
  const availableCount = rooms.filter((r) => r.available).length;
  document.getElementById("results-title").textContent = hasDates
    ? `${formatDate(checkIn)} – ${formatDate(checkOut)}`
    : "Rooms & whole house";
  document.getElementById("results-count").textContent = hasDates
    ? `${availableCount} of ${rooms.length} available · ${plural(nights, "night")}`
    : `${rooms.length} option${rooms.length === 1 ? "" : "s"}`;

  const query = hasDates ? `&in=${checkIn}&out=${checkOut}&guests=${guests}` : "";
  grid.innerHTML = rooms.length
    ? rooms.map((r) => {
        const badge = r.available === null ? ""
          : r.available ? `<span class="badge badge-ok">Available</span>`
          : `<span class="badge badge-no">Booked for these dates</span>`;
        const price = !member ? `<span class="price-locked">Sign in to see prices</span>`
          : hasDates ? `<b>RM ${stayTotal(r, nights)}</b> total · RM ${r.price}/night`
          : `<b>RM ${r.price}</b> / night`;
        return `
          <a class="room-card ${r.available === false ? "unavailable" : ""}" href="room.html?id=${r.id}${query}">
            <img src="${escapeHTML(r.image)}" alt="${escapeHTML(r.name)}" width="400" height="190" loading="lazy" decoding="async">
            <div class="body">
              ${badge}
              <h3>${escapeHTML(r.name)}</h3>
              <div class="meta">${escapeHTML(r.summary)} · up to ${r.guests} guests</div>
              <div class="price">${price}</div>
            </div>
          </a>`;
      }).join("")
    : `<p class="empty">Nothing fits that many guests. Try fewer guests.</p>`;
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const p = new URLSearchParams();
  if (checkInEl.value) p.set("in", checkInEl.value);
  if (checkOutEl.value) p.set("out", checkOutEl.value);
  if (guestsSel.value !== "1") p.set("guests", guestsSel.value);
  history.replaceState(null, "", "?" + p.toString());
  render();
});

ready.then(render);
