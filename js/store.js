// Shared data layer: rooms (static), plus members and bookings stored in
// Firebase Authentication and Cloud Firestore. Access rules: firestore.rules.

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
    image: "images/house.jpg",
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
// are placeholders until the owner provides them. holdHours must match the
// 24 hours in firestore.rules.
const PAYMENT = {
  deposit: 50,
  holdHours: 24,
  accountName: "", // e.g. "REDZAI GUESTHOUSE"
  qrImage: "", // e.g. "images/duitnow-qr.png"
  whatsapp: "", // international format without "+", e.g. "60123456789"
};

// ---------- Dates ----------

function toISO(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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

// ---------- Firebase ----------

// Same files as the "firebase" npm package; loaded from Google's CDN so the
// site needs no build step.
const FIREBASE_VERSION = "12.19.0";
const loadSdk = (name) => import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-${name}.js`);

let fb = null; // { auth, db, ...SDK functions }
let profile = null; // users/{uid} document of the signed-in member, plus isAdmin
let myBookings = [];
// One document per booked night of a room, id "<roomId>_<date>", mapped to
// { bookingId, heldAt }. Firestore refuses to create a night that already
// exists, which is what stops double bookings. heldAt is set while the
// booking waits for its deposit; after HOLD_HOURS the night is free again.
let nights = new Map();

const HOLD_MS = PAYMENT.holdHours * 3600 * 1000;
const toMillis = (t) => (t && t.toMillis ? t.toMillis() : t ?? null);
const fromDoc = (d) => ({ id: d.id, ...d.data(), createdAt: toMillis(d.data().createdAt) });

async function initFirebase() {
  if (!window.FIREBASE_CONFIG || !FIREBASE_CONFIG.apiKey) {
    throw new Error("Firebase is not configured yet. Fill in js/firebase-config.js.");
  }
  const [appSdk, authSdk, dbSdk] = await Promise.all([loadSdk("app"), loadSdk("auth"), loadSdk("firestore")]);
  const app = appSdk.initializeApp(FIREBASE_CONFIG);
  const auth = authSdk.getAuth(app);
  const db = dbSdk.getFirestore(app);
  if (FIREBASE_CONFIG.useEmulators) {
    authSdk.connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    dbSdk.connectFirestoreEmulator(db, "127.0.0.1", 8080);
  }
  fb = { auth, db, ...authSdk, ...dbSdk };
  await auth.authStateReady();
  await Promise.all([loadMember(), loadNights()]);
}

async function loadMember() {
  const user = fb.auth.currentUser;
  if (!user) {
    profile = null;
    myBookings = [];
    return;
  }
  const [snap, admin, bookings] = await Promise.all([
    fb.getDoc(fb.doc(fb.db, "users", user.uid)),
    fb.getDoc(fb.doc(fb.db, "admins", user.uid)),
    fb.getDocs(fb.query(fb.collection(fb.db, "bookings"), fb.where("userId", "==", user.uid))),
  ]);
  profile = {
    id: user.uid,
    ...(snap.exists() ? snap.data() : { name: user.email, phone: "", joined: toISO(new Date()) }),
    email: user.email,
    isAdmin: admin.exists(),
  };
  myBookings = bookings.docs.map(fromDoc);
}

async function loadNights() {
  const snap = await fb.getDocs(fb.query(fb.collection(fb.db, "nights"), fb.where("date", ">=", toISO(new Date()))));
  nights = new Map(snap.docs.map((d) => [d.id, { bookingId: d.data().bookingId, heldAt: toMillis(d.data().heldAt) }]));
}

function friendlyError(err) {
  const messages = {
    "auth/invalid-credential": "Incorrect email or password.",
    "auth/wrong-password": "Incorrect email or password.",
    "auth/user-not-found": "Incorrect email or password.",
    "auth/invalid-email": "Please enter a valid email address.",
    "auth/email-already-in-use": "An account with this email already exists.",
    "auth/weak-password": "Password must be at least 6 characters.",
    "auth/too-many-requests": "Too many attempts. Please wait a moment and try again.",
    "auth/network-request-failed": "Network error. Check your connection and try again.",
  };
  return new Error(messages[err.code] || err.message);
}

// ---------- Auth ----------

const Auth = {
  current() {
    return profile;
  },
  async login(email, password) {
    try {
      await fb.signInWithEmailAndPassword(fb.auth, email.trim(), password);
    } catch (err) {
      throw friendlyError(err);
    }
    await loadMember();
    return profile;
  },
  // Firebase emails a reset link. For privacy it does not say whether the
  // email has an account, so neither do we.
  async resetPassword(email) {
    try {
      await fb.sendPasswordResetEmail(fb.auth, email.trim());
    } catch (err) {
      if (err.code === "auth/user-not-found") return;
      throw friendlyError(err);
    }
  },
  async register({ name, email, phone, password }) {
    let cred;
    try {
      cred = await fb.createUserWithEmailAndPassword(fb.auth, email.trim(), password);
    } catch (err) {
      throw friendlyError(err);
    }
    await fb.setDoc(fb.doc(fb.db, "users", cred.user.uid), {
      name: name.trim(),
      phone: phone.trim(),
      email: cred.user.email,
      joined: toISO(new Date()),
    });
    await loadMember();
    return profile;
  },
  // setDoc with merge also creates the profile for accounts added in the
  // Firebase console, which have none yet. The email is copied so the admin
  // page can show how to contact the guest.
  async update(changes) {
    await fb.setDoc(fb.doc(fb.db, "users", profile.id), { joined: profile.joined, email: profile.email, ...changes }, { merge: true });
    Object.assign(profile, changes);
  },
  async logout() {
    await fb.signOut(fb.auth);
    profile = null;
    myBookings = [];
  },
  // Redirect to the login page if nobody is signed in.
  require() {
    if (!profile) {
      const next = encodeURIComponent(location.pathname.split("/").pop() + location.search);
      location.href = "login.html?next=" + next;
    }
    return profile;
  },
};

// ---------- Bookings & availability ----------

// Night documents only exist for real rooms. Booking the whole house writes a
// night for each of its rooms, so it clashes with any room booking and vice versa.
function lockedRooms(roomId) {
  return getRoom(roomId).includes || [roomId];
}

function nightIds(booking) {
  const ids = [];
  for (let d = booking.checkIn; d < booking.checkOut; d = addDays(d, 1)) {
    for (const r of lockedRooms(booking.roomId)) ids.push(`${r}_${d}`);
  }
  return ids;
}

// Nights still held by this booking (an expired hold may have been taken by someone else).
function ownNights(booking) {
  return nightIds(booking).filter((id) => nights.get(id)?.bookingId === booking.id);
}

function nightTaken(id) {
  const n = nights.get(id);
  return !!n && (n.heldAt === null || n.heldAt + HOLD_MS > Date.now());
}

const MAX_NIGHTS = 30;

const STATUS = {
  awaiting_deposit: { label: "Awaiting deposit", badge: "badge-warn" },
  awaiting_approval: { label: "Awaiting approval", badge: "badge-warn" },
  confirmed: { label: "Confirmed", badge: "badge-ok" },
  denied: { label: "Declined", badge: "badge-no" },
  expired: { label: "Expired", badge: "badge-muted" },
  cancelled: { label: "Cancelled", badge: "badge-muted" },
};

function bookingTotal(b) {
  return getRoom(b.roomId).price * nightsBetween(b.checkIn, b.checkOut) + CLEANING_FEE;
}

const Bookings = {
  forUser() {
    return myBookings;
  },
  get(id) {
    return myBookings.find((b) => b.id === id) || null;
  },
  holdDeadline(b) {
    return b.createdAt + HOLD_MS;
  },
  // The stored status, except that an unpaid booking past its deadline is "expired".
  state(b) {
    return b.status === "awaiting_deposit" && Date.now() >= this.holdDeadline(b) ? "expired" : b.status;
  },
  isNightBooked(roomId, iso) {
    return lockedRooms(roomId).some((r) => nightTaken(`${r}_${iso}`));
  },
  // A room is free for [checkIn, checkOut) if none of those nights is booked or held.
  isAvailable(roomId, checkIn, checkOut) {
    for (let d = checkIn; d < checkOut; d = addDays(d, 1)) {
      if (this.isNightBooked(roomId, d)) return false;
    }
    return true;
  },
  // Holds the dates for PAYMENT.holdHours while the guest pays the deposit.
  async create({ roomId, checkIn, checkOut, guests, depositAgreed }) {
    if (!profile) throw new Error("Please log in to book.");
    if (!checkIn || !checkOut || checkOut <= checkIn) throw new Error("Check-out must be after check-in.");
    if (checkIn < toISO(new Date())) throw new Error("Check-in cannot be in the past.");
    if (nightsBetween(checkIn, checkOut) > MAX_NIGHTS) throw new Error(`Stays are limited to ${MAX_NIGHTS} nights.`);
    if (!depositAgreed) throw new Error(`Please tick the box to accept the non-refundable RM${PAYMENT.deposit} deposit.`);
    if (!this.isAvailable(roomId, checkIn, checkOut)) throw new Error("Sorry, those dates are already booked.");

    const ref = fb.doc(fb.collection(fb.db, "bookings"));
    const booking = {
      roomId, userId: profile.id, checkIn, checkOut, guests,
      status: "awaiting_deposit", depositAgreed: true, createdAt: fb.serverTimestamp(),
    };
    const batch = fb.writeBatch(fb.db);
    batch.set(ref, booking);
    for (const id of nightIds(booking)) {
      const [r, date] = id.split("_");
      batch.set(fb.doc(fb.db, "nights", id), { roomId: r, date, bookingId: ref.id, heldAt: fb.serverTimestamp() });
    }
    try {
      await batch.commit();
    } catch (err) {
      // Someone else booked one of these nights after this page loaded.
      await loadNights();
      if (err.code === "permission-denied") throw new Error("Sorry, those dates were just booked by someone else.");
      throw err;
    }
    const now = Date.now();
    myBookings.push({ ...booking, id: ref.id, createdAt: now });
    for (const id of nightIds(booking)) nights.set(id, { bookingId: ref.id, heldAt: now });
    return ref.id;
  },
  // The guest says the deposit is paid; the hold stops expiring until the admin decides.
  async markPaid(id, { method, reference }) {
    const booking = this.get(id);
    if (!booking || this.state(booking) !== "awaiting_deposit") throw new Error("This booking can no longer be paid.");
    const update = { status: "awaiting_approval", paymentMethod: method, paymentRef: reference.trim().slice(0, 60), paidAt: fb.serverTimestamp() };
    const batch = fb.writeBatch(fb.db);
    batch.update(fb.doc(fb.db, "bookings", id), update);
    for (const n of ownNights(booking)) batch.update(fb.doc(fb.db, "nights", n), { heldAt: null });
    await batch.commit();
    Object.assign(booking, update, { paidAt: Date.now() });
    for (const n of ownNights(booking)) nights.get(n).heldAt = null;
  },
  async cancel(id) {
    const booking = this.get(id);
    if (!booking) return;
    const own = ownNights(booking);
    const batch = fb.writeBatch(fb.db);
    batch.update(fb.doc(fb.db, "bookings", id), { status: "cancelled", cancelledAt: fb.serverTimestamp() });
    for (const n of own) batch.delete(fb.doc(fb.db, "nights", n));
    await batch.commit();
    booking.status = "cancelled";
    for (const n of own) nights.delete(n);
  },
};

// ---------- Admin ----------

const Admin = {
  // Every booking, newest first, each with its guest's profile.
  async loadAll() {
    const snap = await fb.getDocs(fb.collection(fb.db, "bookings"));
    const all = snap.docs.map(fromDoc).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const guests = new Map();
    await Promise.all([...new Set(all.map((b) => b.userId))].map(async (uid) => {
      const u = await fb.getDoc(fb.doc(fb.db, "users", uid));
      guests.set(uid, u.exists() ? u.data() : {});
    }));
    return all.map((b) => ({ ...b, guest: guests.get(b.userId) }));
  },
  async approve(booking, { cashReceived = false } = {}) {
    const update = { status: "confirmed", decidedAt: fb.serverTimestamp() };
    if (cashReceived) update.paymentMethod = "cash";
    const batch = fb.writeBatch(fb.db);
    batch.update(fb.doc(fb.db, "bookings", booking.id), update);
    for (const n of ownNights(booking)) batch.update(fb.doc(fb.db, "nights", n), { heldAt: null });
    await batch.commit();
    for (const n of ownNights(booking)) nights.get(n).heldAt = null;
  },
  // A deposit already paid is refunded when the owner declines.
  async deny(booking, reason) {
    const own = ownNights(booking);
    const batch = fb.writeBatch(fb.db);
    batch.update(fb.doc(fb.db, "bookings", booking.id), {
      status: "denied",
      decidedAt: fb.serverTimestamp(),
      denyReason: reason.trim().slice(0, 200),
      depositRefund: booking.status === "awaiting_approval",
    });
    for (const n of own) batch.delete(fb.doc(fb.db, "nights", n));
    await batch.commit();
    for (const n of own) nights.delete(n);
  },
};

function whatsappLink(text) {
  return PAYMENT.whatsapp ? `https://wa.me/${PAYMENT.whatsapp}?text=${encodeURIComponent(text)}` : null;
}

function getRoom(id) {
  return ROOMS.find((r) => r.id === id);
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ---------- Shared header ----------

function renderNav() {
  const nav = document.getElementById("nav-links");
  if (!nav) return;
  const user = Auth.current();
  nav.innerHTML = user
    ? `<a href="rooms.html">Rooms</a>
       <a href="members.html">My account</a>
       ${user.isAdmin ? `<a href="admin.html">Admin</a>` : ""}
       <span class="nav-user">Hi, ${escapeHTML(user.name.split(" ")[0])}</span>
       <button class="btn btn-ghost" id="logout-btn">Log out</button>`
    : `<a href="rooms.html">Rooms</a>
       <a class="btn btn-primary" href="login.html">Log in</a>`;
  const logout = document.getElementById("logout-btn");
  if (logout) {
    logout.addEventListener("click", async () => {
      await Auth.logout();
      location.href = "index.html";
    });
  }
}

function showStartupError(err) {
  const main = document.querySelector("main");
  if (!main) return;
  const box = document.createElement("div");
  box.className = "alert alert-error";
  box.textContent = "Sorry, the site could not connect to its database. " + err.message;
  main.prepend(box);
}

const ready = initFirebase().then(renderNav);
ready.catch(showStartupError);
