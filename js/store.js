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

// ---------- Firebase ----------

// Same files as the "firebase" npm package; loaded from Google's CDN so the
// site needs no build step.
const FIREBASE_VERSION = "12.19.0";
const loadSdk = (name) => import(`https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/firebase-${name}.js`);

let fb = null; // { auth, db, ...SDK functions }
let profile = null; // users/{uid} document of the signed-in member
let myBookings = [];
// One document per booked night, id "<roomId>_<date>". Firestore refuses to
// create a night that already exists, which is what stops double bookings.
let bookedNights = new Set();

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
  const [snap, bookings] = await Promise.all([
    fb.getDoc(fb.doc(fb.db, "users", user.uid)),
    fb.getDocs(fb.query(fb.collection(fb.db, "bookings"), fb.where("userId", "==", user.uid))),
  ]);
  profile = { id: user.uid, email: user.email, ...(snap.exists() ? snap.data() : { name: user.email, phone: "", joined: toISO(new Date()) }) };
  myBookings = bookings.docs.map((d) => ({ id: d.id, ...d.data() }));
}

async function loadNights() {
  const snap = await fb.getDocs(fb.query(fb.collection(fb.db, "nights"), fb.where("date", ">=", toISO(new Date()))));
  bookedNights = new Set(snap.docs.map((d) => d.id));
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
      joined: toISO(new Date()),
    });
    await loadMember();
    return profile;
  },
  async update(changes) {
    await fb.updateDoc(fb.doc(fb.db, "users", profile.id), changes);
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

const MAX_NIGHTS = 30;

const Bookings = {
  forUser() {
    return myBookings;
  },
  isNightBooked(roomId, iso) {
    return lockedRooms(roomId).some((r) => bookedNights.has(`${r}_${iso}`));
  },
  // A room is free for [checkIn, checkOut) if none of those nights is booked.
  isAvailable(roomId, checkIn, checkOut) {
    for (let d = checkIn; d < checkOut; d = addDays(d, 1)) {
      if (this.isNightBooked(roomId, d)) return false;
    }
    return true;
  },
  async create({ roomId, checkIn, checkOut, guests }) {
    if (!profile) throw new Error("Please log in to book.");
    if (!checkIn || !checkOut || checkOut <= checkIn) throw new Error("Check-out must be after check-in.");
    if (checkIn < toISO(new Date())) throw new Error("Check-in cannot be in the past.");
    if (nightsBetween(checkIn, checkOut) > MAX_NIGHTS) throw new Error(`Stays are limited to ${MAX_NIGHTS} nights.`);
    if (!this.isAvailable(roomId, checkIn, checkOut)) throw new Error("Sorry, those dates are already booked.");

    const ref = fb.doc(fb.collection(fb.db, "bookings"));
    const booking = { roomId, userId: profile.id, checkIn, checkOut, guests, status: "confirmed" };
    const batch = fb.writeBatch(fb.db);
    batch.set(ref, booking);
    for (let d = checkIn; d < checkOut; d = addDays(d, 1)) {
      for (const r of lockedRooms(roomId)) {
        batch.set(fb.doc(fb.db, "nights", `${r}_${d}`), { roomId: r, date: d, bookingId: ref.id });
      }
    }
    try {
      await batch.commit();
    } catch (err) {
      // Someone else booked one of these nights after this page loaded.
      await loadNights();
      if (err.code === "permission-denied") throw new Error("Sorry, those dates were just booked by someone else.");
      throw err;
    }
    myBookings.push({ id: ref.id, ...booking });
    for (let d = checkIn; d < checkOut; d = addDays(d, 1)) {
      for (const r of lockedRooms(roomId)) bookedNights.add(`${r}_${d}`);
    }
    return booking;
  },
  async cancel(id) {
    const booking = myBookings.find((b) => b.id === id);
    if (!booking) return;
    const batch = fb.writeBatch(fb.db);
    batch.update(fb.doc(fb.db, "bookings", id), { status: "cancelled" });
    for (let d = booking.checkIn; d < booking.checkOut; d = addDays(d, 1)) {
      for (const r of lockedRooms(booking.roomId)) batch.delete(fb.doc(fb.db, "nights", `${r}_${d}`));
    }
    await batch.commit();
    booking.status = "cancelled";
    for (let d = booking.checkIn; d < booking.checkOut; d = addDays(d, 1)) {
      for (const r of lockedRooms(booking.roomId)) bookedNights.delete(`${r}_${d}`);
    }
  },
};

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
