// Data layer: member accounts (Firebase Authentication) and bookings (Cloud
// Firestore), plus the shared header. Business rules live in core.js; access
// rules in firestore.rules.

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
// booking waits for its deposit; after the hold runs out the night is free again.
let nights = new Map();

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

// Turns Firebase errors into messages a guest can act on.
function friendlyError(err) {
  const messages = {
    "permission-denied": "You don't have permission to do that. Please refresh the page and try again.",
    "unavailable": "Can't reach the server. Check your connection and try again.",
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

// Nights still held by this booking (an expired hold may have been taken by someone else).
function ownNights(booking) {
  return nightIds(booking).filter((id) => nights.get(id)?.bookingId === booking.id);
}

const Bookings = {
  forUser() {
    return myBookings;
  },
  get(id) {
    return myBookings.find((b) => b.id === id) || null;
  },
  isNightBooked(roomId, iso) {
    return lockedRooms(roomId).some((r) => nightBlocks(nights.get(`${r}_${iso}`)));
  },
  // Whether the booking still holds every night it needs from today onwards.
  // False when an expired hold was taken over, or the booking never had its
  // nights; such a booking must not be approved. (Past nights aren't loaded.)
  holdsDates(b) {
    const today = toISO(new Date());
    const needed = nightIds(b).filter((id) => id.split("_")[1] >= today);
    return needed.every((id) => nights.get(id)?.bookingId === b.id);
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
    const problem = stayError(checkIn, checkOut);
    if (problem) throw new Error(problem);
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
      throw friendlyError(err);
    }
    const now = Date.now();
    myBookings.push({ ...booking, id: ref.id, createdAt: now });
    for (const id of nightIds(booking)) nights.set(id, { bookingId: ref.id, heldAt: now });
    return ref.id;
  },
  // The guest says the deposit is paid; the hold stops expiring until the admin decides.
  async markPaid(id, { method, reference }) {
    const booking = this.get(id);
    if (!booking || bookingState(booking) !== "awaiting_deposit") throw new Error("This booking can no longer be paid.");
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
    if (!Bookings.holdsDates(booking)) throw new Error("This booking no longer holds its dates, so it can't be approved. Decline it instead.");
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
      try {
        await Auth.logout();
        location.href = "index.html";
      } catch (err) {
        showError(friendlyError(err));
      }
    });
  }
}

// Page-level error banner, for failures with no better place to show them.
function showError(err, prefix = "") {
  const main = document.querySelector("main");
  if (!main) return;
  let box = document.getElementById("page-error");
  if (!box) {
    box = document.createElement("div");
    box.id = "page-error";
    box.className = "alert alert-error";
    box.setAttribute("role", "alert");
    main.prepend(box);
  }
  box.textContent = prefix + (err && err.message ? err.message : "Something went wrong. Please try again.");
  box.scrollIntoView({ block: "nearest" });
}

// On small screens the nav folds into a menu button.
function setupMenu() {
  const header = document.querySelector(".site-header");
  const nav = document.getElementById("nav-links");
  if (!header || !nav) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "menu-btn";
  btn.setAttribute("aria-label", "Menu");
  btn.setAttribute("aria-expanded", "false");
  btn.setAttribute("aria-controls", "nav-links");
  btn.innerHTML = "<span></span><span></span><span></span>";
  nav.before(btn);
  btn.addEventListener("click", () => {
    const open = header.classList.toggle("menu-open");
    btn.setAttribute("aria-expanded", String(open));
  });
}

setupMenu();
const ready = initFirebase().then(renderNav);
ready.catch((err) => showError(err, "Sorry, the site could not connect to its database. "));

// Safety net: no failed request should ever fail silently.
window.addEventListener("unhandledrejection", (e) => {
  console.error(e.reason);
  showError(friendlyError(e.reason || {}));
});
