const params = new URLSearchParams(location.search);
const room = getRoom(params.get("id"));

if (!room) {
  document.getElementById("room-main").innerHTML =
    `<p class="empty">Room not found. <a href="rooms.html">Back to rooms</a></p>`;
  throw new Error("Unknown room");
}

const today = toISO(new Date());
const inEl = document.getElementById("b-in");
const outEl = document.getElementById("b-out");
const guestsEl = document.getElementById("b-guests");
const statusEl = document.getElementById("avail-status");
const summaryEl = document.getElementById("summary");
const bookBtn = document.getElementById("book-btn");
const msgEl = document.getElementById("book-msg");

document.title = `${room.name} – ${BUSINESS_NAME}`;
document.getElementById("room-img").src = room.image;
document.getElementById("room-img").alt = room.name;
document.getElementById("room-name").textContent = room.name;
document.getElementById("room-meta").textContent =
  `${room.summary} · up to ${room.guests} guests`;
document.getElementById("room-desc").textContent = room.description;
document.getElementById("room-amenities").innerHTML =
  room.amenities.map((a) => `<li>${escapeHTML(a)}</li>`).join("");

for (let n = 1; n <= room.guests; n++) guestsEl.add(new Option(`${n} guest${n > 1 ? "s" : ""}`, n));
guestsEl.value = Math.min(Number(params.get("guests")) || 1, room.guests);
inEl.min = today;
outEl.min = addDays(today, 1);
inEl.value = params.get("in") || "";
outEl.value = params.get("out") || "";

// ---------- Calendar ----------

let viewMonth = new Date();
viewMonth.setDate(1);
let picking = "in"; // which end of the range the next calendar click sets

function monthHTML(year, month) {
  const first = new Date(year, month, 1);
  const days = new Date(year, month + 1, 0).getDate();
  const title = first.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  let cells = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => `<div class="dow">${d}</div>`).join("");
  cells += "<div></div>".repeat(first.getDay());
  for (let d = 1; d <= days; d++) {
    const iso = toISO(new Date(year, month, d));
    const cls = ["cal-day"];
    if (iso < today) cls.push("past");
    else if (Bookings.isNightBooked(room.id, iso)) cls.push("booked");
    if (iso === today) cls.push("today");
    if (iso === inEl.value || iso === outEl.value) cls.push("selected");
    else if (inEl.value && outEl.value && iso > inEl.value && iso < outEl.value) cls.push("in-range");
    cells += `<div class="${cls.join(" ")}" data-date="${iso}">${d}</div>`;
  }
  return `<div class="cal-month"><h4>${title}</h4><div class="cal-grid">${cells}</div></div>`;
}

// Two months side by side on wide screens, one on phones.
const wide = matchMedia("(min-width: 641px)");

function renderCalendar() {
  const y = viewMonth.getFullYear();
  const m = viewMonth.getMonth();
  document.getElementById("cal-months").innerHTML = monthHTML(y, m) + (wide.matches ? monthHTML(y, m + 1) : "");
  const now = new Date();
  document.getElementById("cal-prev").disabled = y === now.getFullYear() && m === now.getMonth();
}

wide.addEventListener("change", renderCalendar);

document.getElementById("cal-prev").addEventListener("click", () => {
  viewMonth.setMonth(viewMonth.getMonth() - 1);
  renderCalendar();
});
document.getElementById("cal-next").addEventListener("click", () => {
  viewMonth.setMonth(viewMonth.getMonth() + 1);
  renderCalendar();
});

document.getElementById("cal-months").addEventListener("click", (e) => {
  const cell = e.target.closest(".cal-day");
  if (!cell || cell.classList.contains("past")) return;
  const iso = cell.dataset.date;
  // A booked night can still be a check-out day (you leave that morning).
  if (picking === "in" || iso <= inEl.value) {
    if (cell.classList.contains("booked")) return;
    inEl.value = iso;
    outEl.value = "";
    picking = "out";
  } else {
    outEl.value = iso;
    picking = "in";
  }
  update();
});

// ---------- Booking box ----------

function loginUrl() {
  const next = `room.html?id=${room.id}&in=${inEl.value}&out=${outEl.value}&guests=${guestsEl.value}`;
  return "login.html?next=" + encodeURIComponent(next);
}

function update() {
  const member = Auth.current();
  document.getElementById("price-line").innerHTML = member
    ? `<b>RM ${room.price}</b> / night`
    : `<a href="${escapeHTML(loginUrl())}">Sign in</a> to see prices`;
  bookBtn.textContent = member ? "Reserve & pay deposit" : "Sign in to book";
  if (inEl.value) outEl.min = addDays(inEl.value, 1);
  msgEl.classList.add("hidden");
  const checkIn = inEl.value;
  const checkOut = outEl.value;
  const valid = checkIn && checkOut && checkOut > checkIn && checkIn >= today;

  if (!valid) {
    statusEl.innerHTML = checkIn && !checkOut
      ? `<span class="badge badge-muted">Now choose a check-out date</span>` : "";
    summaryEl.classList.add("hidden");
    bookBtn.disabled = !!(checkIn && checkOut);
  } else {
    const free = Bookings.isAvailable(room.id, checkIn, checkOut);
    const nights = nightsBetween(checkIn, checkOut);
    statusEl.innerHTML = free
      ? `<span class="badge badge-ok">✓ Available for your dates</span>`
      : `<span class="badge badge-no">✕ Not available – some nights are booked</span>`;
    summaryEl.innerHTML = `
      <div><span>RM ${room.price} × ${nights} night${nights > 1 ? "s" : ""}</span><span>RM ${room.price * nights}</span></div>
      <div><span>Cleaning fee</span><span>RM ${CLEANING_FEE}</span></div>
      <div class="total"><span>Total</span><span>RM ${room.price * nights + CLEANING_FEE}</span></div>
      <div class="deposit-row"><span>Deposit now</span><span>RM ${PAYMENT.deposit}</span></div>
      <div><span>Balance on arrival</span><span>RM ${room.price * nights + CLEANING_FEE - PAYMENT.deposit}</span></div>`;
    summaryEl.classList.toggle("hidden", !member);
    bookBtn.disabled = !free;
  }
  document.getElementById("deposit-note").classList.toggle("hidden", !member);
  renderBookBar(member, valid);
  renderCalendar();
}

function renderBookBar(member, valid) {
  const nights = valid ? nightsBetween(inEl.value, outEl.value) : 0;
  document.getElementById("bar-price").textContent = !member ? room.name
    : valid ? `RM ${room.price * nights + CLEANING_FEE}` : `RM ${room.price} / night`;
  document.getElementById("bar-sub").textContent = !member ? "Sign in to see prices"
    : valid ? `${nights} night${nights > 1 ? "s" : ""} · ${formatDate(inEl.value)} → ${formatDate(outEl.value)}`
    : "Choose your dates";
  document.getElementById("bar-btn").textContent = member ? "Book" : "Sign in";
}

// Hide the bar once the booking box itself is on screen.
new IntersectionObserver(([entry]) => {
  document.getElementById("book-bar").classList.toggle("off", entry.isIntersecting);
}).observe(document.querySelector(".booking-box"));

document.getElementById("bar-btn").addEventListener("click", () => {
  if (!Auth.current()) {
    location.href = loginUrl();
    return;
  }
  document.querySelector(".booking-box").scrollIntoView({ behavior: "smooth", block: "start" });
});

document.getElementById("deposit-amount").textContent = `RM${PAYMENT.deposit}`;

inEl.addEventListener("change", () => {
  if (outEl.value && outEl.value <= inEl.value) outEl.value = "";
  update();
});
outEl.addEventListener("change", update);

function showMsg(text, ok) {
  msgEl.className = "alert " + (ok ? "alert-ok" : "alert-error");
  msgEl.innerHTML = text;
}

// Signed-out visitors go straight to the login page, even before choosing dates.
bookBtn.addEventListener("click", (e) => {
  if (!Auth.current()) {
    e.preventDefault();
    location.href = loginUrl();
  }
});

document.getElementById("book-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const user = Auth.current();
  if (!user) {
    location.href = loginUrl();
    return;
  }
  bookBtn.disabled = true;
  try {
    const id = await Bookings.create({
      roomId: room.id,
      checkIn: inEl.value,
      checkOut: outEl.value,
      guests: Number(guestsEl.value),
      depositAgreed: document.getElementById("b-agree").checked,
    });
    location.href = `pay.html?id=${id}`;
  } catch (err) {
    update();
    showMsg(escapeHTML(err.message), false);
  }
});

// Open the calendar on the month of a pre-filled check-in date.
if (inEl.value) {
  const [y, m] = inEl.value.split("-").map(Number);
  viewMonth = new Date(y, m - 1, 1);
}
ready.then(update);
