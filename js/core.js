// Business rules with no browser or Firebase dependencies: configuration,
// dates, pricing and booking state. Loaded by every page before store.js, and
// by the unit tests in tests/unit (see the export at the bottom).
//
// Limits marked "rules" are also enforced in firestore.rules; change both.

const BUSINESS_NAME = "Redzai Guesthouse";

// Prices, capacities, photos and amenities are placeholders: edit them here.
// Prices are only shown to signed-in members.
// "includes" marks the whole-house option: booking it books every room listed.
const ROOMS = [
  {
    id: "house",
    name: "Whole House",
    summary: "Entire house · 3 bedrooms",
    price: 260,
    guests: 8,
    includes: ["r1", "r2", "r3"],
    image: "images/whole-house.jpg",
    amenities: ["3 bedrooms", "Living room", "Kitchen", "Wi-Fi", "Air-cond", "Free parking"],
    description: "Have the whole guesthouse to yourselves: the big ground-floor room and both upstairs rooms, plus the living room and kitchen. Ideal for families and groups.",
  },
  {
    id: "r1",
    name: "Room 1",
    summary: "Big room · Ground floor",
    price: 120,
    guests: 4,
    image: "images/room1.jpg",
    amenities: ["Ground floor", "Air-cond", "Wi-Fi", "Attached bathroom"],
    description: "Our largest room, on the ground floor with no stairs to climb. Comfortable for a small family or anyone who prefers easy access.",
  },
  {
    id: "r2",
    name: "Room 2",
    summary: "Small room · Upstairs",
    price: 80,
    guests: 2,
    image: "images/room2.jpg",
    amenities: ["Upstairs", "Air-cond", "Wi-Fi"],
    description: "A cosy upstairs room for one or two guests, quiet and away from the living area.",
  },
  {
    id: "r3",
    name: "Room 3",
    summary: "Small room · Upstairs",
    price: 80,
    guests: 2,
    image: "images/room3.jpg",
    amenities: ["Upstairs", "Air-cond", "Wi-Fi"],
    description: "A cosy upstairs room for one or two guests, next to Room 2. Book both for a small group.",
  },
];

const CLEANING_FEE = 30;

// Deposit and payment details. The QR image, account name and WhatsApp number
// are placeholders until the owner provides them.
const PAYMENT = {
  deposit: 50,
  holdHours: 24,
  accountName: "", // e.g. "REDZAI GUESTHOUSE"
  qrImage: "", // e.g. "images/duitnow-qr.png"
  whatsapp: "", // international format without "+", e.g. "60123456789"
};

const HOLD_MS = PAYMENT.holdHours * 3600 * 1000; // rules
const MAX_NIGHTS = 30; // rules
const MAX_ADVANCE_DAYS = 365; // rules

const STATUS = {
  awaiting_deposit: { label: "Awaiting deposit", badge: "badge-warn" },
  awaiting_approval: { label: "Awaiting approval", badge: "badge-warn" },
  confirmed: { label: "Confirmed", badge: "badge-ok" },
  denied: { label: "Declined", badge: "badge-no" },
  expired: { label: "Expired", badge: "badge-muted" },
  cancelled: { label: "Cancelled", badge: "badge-muted" },
};

// ---------- Text ----------

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// plural(2, "night") → "2 nights"
function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

// ---------- Dates ----------
// Dates are "YYYY-MM-DD" strings in the visitor's local time, so they compare
// and sort correctly as plain strings.

function toISO(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isISODate(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  return toISO(new Date(y, m - 1, d)) === s; // rejects 2026-02-31
}

function addDays(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  return toISO(new Date(y, m - 1, d + n));
}

function nightsBetween(checkIn, checkOut) {
  const a = new Date(checkIn + "T00:00:00");
  const b = new Date(checkOut + "T00:00:00");
  return Math.round((b - a) / 86400000);
}

function formatDate(iso) {
  return new Date(iso + "T00:00:00").toLocaleDateString(undefined, {
    day: "numeric", month: "short", year: "numeric",
  });
}

function formatDateTime(ms) {
  return new Date(ms).toLocaleString(undefined, {
    weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit",
  });
}

// ---------- Rooms, stays and pricing ----------

function getRoom(id) {
  return ROOMS.find((r) => r.id === id);
}

// Why a stay can't be booked, or null if the dates are acceptable.
function stayError(checkIn, checkOut, today = toISO(new Date())) {
  if (!isISODate(checkIn) || !isISODate(checkOut)) return "Please choose both check-in and check-out dates.";
  if (checkOut <= checkIn) return "Check-out must be after check-in.";
  if (checkIn < today) return "Check-in cannot be in the past.";
  if (nightsBetween(checkIn, checkOut) > MAX_NIGHTS) return `Stays are limited to ${MAX_NIGHTS} nights.`;
  if (checkIn > addDays(today, MAX_ADVANCE_DAYS)) return "Bookings open up to a year ahead.";
  return null;
}

// The booking's room, or a placeholder if that room was later removed.
function bookingRoom(b) {
  return getRoom(b.roomId) || { id: b.roomId, name: "Removed room", summary: "", image: "", price: 0, guests: 0 };
}

function stayTotal(room, nights) {
  return room.price * nights + CLEANING_FEE;
}

function bookingTotal(b) {
  const room = getRoom(b.roomId);
  return room ? stayTotal(room, nightsBetween(b.checkIn, b.checkOut)) : 0;
}

// Night documents only exist for real rooms. Booking the whole house writes a
// night for each of its rooms, so it clashes with any room booking and vice versa.
function lockedRooms(roomId) {
  const room = getRoom(roomId);
  return room ? room.includes || [roomId] : [];
}

// Ids of the night documents a booking needs: "<roomId>_<date>". Capped so a
// malformed booking can't make this loop run away.
function nightIds(booking) {
  const ids = [];
  let d = booking.checkIn;
  for (let i = 0; i < MAX_NIGHTS && d < booking.checkOut; i++, d = addDays(d, 1)) {
    for (const r of lockedRooms(booking.roomId)) ids.push(`${r}_${d}`);
  }
  return ids;
}

// ---------- Booking state ----------

function holdDeadline(b) {
  return b.createdAt + HOLD_MS;
}

// The stored status, except that an unpaid booking past its deadline is "expired".
function bookingState(b, now = Date.now()) {
  return b.status === "awaiting_deposit" && now >= holdDeadline(b) ? "expired" : b.status;
}

// A night document blocks other guests unless its unpaid hold has run out.
function nightBlocks(night, now = Date.now()) {
  return !!night && (night.heldAt === null || night.heldAt + HOLD_MS > now);
}

if (typeof module !== "undefined") {
  module.exports = {
    ROOMS, CLEANING_FEE, PAYMENT, HOLD_MS, MAX_NIGHTS, MAX_ADVANCE_DAYS, STATUS,
    escapeHTML, plural, toISO, isISODate, addDays, nightsBetween, getRoom, stayError,
    bookingRoom, stayTotal, bookingTotal, lockedRooms, nightIds, holdDeadline, bookingState, nightBlocks,
  };
}
