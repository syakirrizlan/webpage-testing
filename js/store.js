// Shared data layer: rooms (static), plus members and bookings stored in
// Firebase Authentication and Cloud Firestore. Access rules: firestore.rules.

const ROOMS = [
  {
    id: "r1",
    name: "Kampung Garden Chalet",
    location: "Kuala Selangor",
    price: 180,
    guests: 4,
    beds: 2,
    image: "https://images.unsplash.com/photo-1499793983690-e29da59ef1c2?w=800&q=70",
    amenities: ["Wi-Fi", "Air-cond", "Kitchen", "Free parking"],
    description: "A wooden chalet surrounded by fruit trees, a short drive from the fireflies of Kampung Kuantan.",
  },
  {
    id: "r2",
    name: "Seaside Family House",
    location: "Port Dickson",
    price: 320,
    guests: 8,
    beds: 4,
    image: "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?w=800&q=70",
    amenities: ["Wi-Fi", "Air-cond", "BBQ pit", "Beach access"],
    description: "Spacious double-storey home two minutes' walk from the beach. Ideal for family gatherings.",
  },
  {
    id: "r3",
    name: "Highland Pine Cabin",
    location: "Cameron Highlands",
    price: 250,
    guests: 3,
    beds: 1,
    image: "https://images.unsplash.com/photo-1449158743715-0a90ebb6d2d8?w=800&q=70",
    amenities: ["Wi-Fi", "Fireplace", "Hot shower", "Tea farm view"],
    description: "Cosy cabin among the pines with views over the tea plantations. Cool weather all year.",
  },
  {
    id: "r4",
    name: "Heritage Shophouse Loft",
    location: "Melaka",
    price: 210,
    guests: 2,
    beds: 1,
    image: "https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=800&q=70",
    amenities: ["Wi-Fi", "Air-cond", "Walk to Jonker Street"],
    description: "Restored 1920s shophouse loft in the heart of the UNESCO heritage zone.",
  },
  {
    id: "r5",
    name: "Paddy Field Villa",
    location: "Langkawi",
    price: 400,
    guests: 6,
    beds: 3,
    image: "https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800&q=70",
    amenities: ["Wi-Fi", "Private pool", "Air-cond", "Kitchen"],
    description: "Private villa with an infinity pool overlooking emerald paddy fields.",
  },
  {
    id: "r6",
    name: "City Studio Retreat",
    location: "Kuala Lumpur",
    price: 150,
    guests: 2,
    beds: 1,
    image: "https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=800&q=70",
    amenities: ["Wi-Fi", "Air-cond", "Gym", "Near LRT"],
    description: "Modern studio with skyline views, five minutes from the LRT station.",
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

const Bookings = {
  forUser() {
    return myBookings;
  },
  isNightBooked(roomId, iso) {
    return bookedNights.has(`${roomId}_${iso}`);
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
    if (!this.isAvailable(roomId, checkIn, checkOut)) throw new Error("Sorry, those dates are already booked.");

    const ref = fb.doc(fb.collection(fb.db, "bookings"));
    const booking = { roomId, userId: profile.id, checkIn, checkOut, guests, status: "confirmed" };
    const batch = fb.writeBatch(fb.db);
    batch.set(ref, booking);
    for (let d = checkIn; d < checkOut; d = addDays(d, 1)) {
      batch.set(fb.doc(fb.db, "nights", `${roomId}_${d}`), { roomId, date: d, bookingId: ref.id });
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
    for (let d = checkIn; d < checkOut; d = addDays(d, 1)) bookedNights.add(`${roomId}_${d}`);
    return booking;
  },
  async cancel(id) {
    const booking = myBookings.find((b) => b.id === id);
    if (!booking) return;
    const batch = fb.writeBatch(fb.db);
    batch.update(fb.doc(fb.db, "bookings", id), { status: "cancelled" });
    for (let d = booking.checkIn; d < booking.checkOut; d = addDays(d, 1)) {
      batch.delete(fb.doc(fb.db, "nights", `${booking.roomId}_${d}`));
    }
    await batch.commit();
    booking.status = "cancelled";
    for (let d = booking.checkIn; d < booking.checkOut; d = addDays(d, 1)) bookedNights.delete(`${booking.roomId}_${d}`);
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
    ? `<a href="index.html">Rooms</a>
       <a href="members.html">My account</a>
       <span class="nav-user">Hi, ${escapeHTML(user.name.split(" ")[0])}</span>
       <button class="btn btn-ghost" id="logout-btn">Log out</button>`
    : `<a href="index.html">Rooms</a>
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
