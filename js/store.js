// Shared data layer: rooms, users, bookings and session, persisted in localStorage.
// NOTE: this is a front-end demo. Passwords are hashed client-side but there is
// no server, so it is not real security.

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

const KEYS = { users: "hs_users", bookings: "hs_bookings", session: "hs_session" };

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

async function hashPassword(password) {
  const data = new TextEncoder().encode("homestay:" + password);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

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

// ---------- Seed demo data ----------

async function seed() {
  if (load(KEYS.users, null)) return;
  save(KEYS.users, [
    {
      id: "u_demo",
      name: "Demo Member",
      email: "demo@homestay.my",
      phone: "012-345 6789",
      passwordHash: await hashPassword("demo123"),
      joined: toISO(new Date()),
    },
  ]);
  // A few bookings by other guests so the availability calendar is not empty.
  const today = toISO(new Date());
  save(KEYS.bookings, [
    { id: "b1", roomId: "r1", userId: "u_other", checkIn: addDays(today, 3), checkOut: addDays(today, 6), guests: 2, status: "confirmed" },
    { id: "b2", roomId: "r2", userId: "u_other", checkIn: addDays(today, 1), checkOut: addDays(today, 4), guests: 6, status: "confirmed" },
    { id: "b3", roomId: "r3", userId: "u_other", checkIn: addDays(today, 10), checkOut: addDays(today, 13), guests: 2, status: "confirmed" },
    { id: "b4", roomId: "r5", userId: "u_other", checkIn: addDays(today, 0), checkOut: addDays(today, 7), guests: 4, status: "confirmed" },
    { id: "b5", roomId: "r1", userId: "u_demo", checkIn: addDays(today, 20), checkOut: addDays(today, 22), guests: 2, status: "confirmed" },
  ]);
}

// ---------- Auth ----------

const Auth = {
  users() {
    return load(KEYS.users, []);
  },
  current() {
    const id = load(KEYS.session, null);
    return id ? this.users().find((u) => u.id === id) || null : null;
  },
  async login(email, password) {
    const hash = await hashPassword(password);
    const user = this.users().find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
    if (!user || user.passwordHash !== hash) throw new Error("Incorrect email or password.");
    save(KEYS.session, user.id);
    return user;
  },
  async register({ name, email, phone, password }) {
    const users = this.users();
    if (users.some((u) => u.email.toLowerCase() === email.trim().toLowerCase())) {
      throw new Error("An account with this email already exists.");
    }
    if (password.length < 6) throw new Error("Password must be at least 6 characters.");
    const user = {
      id: "u_" + Date.now().toString(36),
      name: name.trim(),
      email: email.trim(),
      phone: phone.trim(),
      passwordHash: await hashPassword(password),
      joined: toISO(new Date()),
    };
    users.push(user);
    save(KEYS.users, users);
    save(KEYS.session, user.id);
    return user;
  },
  update(changes) {
    const users = this.users();
    const user = users.find((u) => u.id === load(KEYS.session, null));
    if (!user) return;
    Object.assign(user, changes);
    save(KEYS.users, users);
  },
  logout() {
    localStorage.removeItem(KEYS.session);
  },
  // Redirect to the login page if nobody is signed in.
  require() {
    const user = this.current();
    if (!user) {
      const next = encodeURIComponent(location.pathname.split("/").pop() + location.search);
      location.href = "login.html?next=" + next;
    }
    return user;
  },
};

// ---------- Bookings & availability ----------

const Bookings = {
  all() {
    return load(KEYS.bookings, []);
  },
  forRoom(roomId) {
    return this.all().filter((b) => b.roomId === roomId && b.status === "confirmed");
  },
  forUser(userId) {
    return this.all().filter((b) => b.userId === userId);
  },
  // A room is free for [checkIn, checkOut) if no confirmed booking overlaps it.
  isAvailable(roomId, checkIn, checkOut) {
    return this.forRoom(roomId).every((b) => checkOut <= b.checkIn || checkIn >= b.checkOut);
  },
  isNightBooked(roomId, iso) {
    return this.forRoom(roomId).some((b) => iso >= b.checkIn && iso < b.checkOut);
  },
  create({ roomId, userId, checkIn, checkOut, guests }) {
    if (!checkIn || !checkOut || checkOut <= checkIn) throw new Error("Check-out must be after check-in.");
    if (checkIn < toISO(new Date())) throw new Error("Check-in cannot be in the past.");
    if (!this.isAvailable(roomId, checkIn, checkOut)) throw new Error("Sorry, those dates are already booked.");
    const bookings = this.all();
    const booking = { id: "b_" + Date.now().toString(36), roomId, userId, checkIn, checkOut, guests, status: "confirmed" };
    bookings.push(booking);
    save(KEYS.bookings, bookings);
    return booking;
  },
  cancel(id, userId) {
    const bookings = this.all();
    const booking = bookings.find((b) => b.id === id && b.userId === userId);
    if (booking) {
      booking.status = "cancelled";
      save(KEYS.bookings, bookings);
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
    ? `<a href="index.html">Rooms</a>
       <a href="members.html">My account</a>
       <span class="nav-user">Hi, ${escapeHTML(user.name.split(" ")[0])}</span>
       <button class="btn btn-ghost" id="logout-btn">Log out</button>`
    : `<a href="index.html">Rooms</a>
       <a class="btn btn-primary" href="login.html">Log in</a>`;
  const logout = document.getElementById("logout-btn");
  if (logout) {
    logout.addEventListener("click", () => {
      Auth.logout();
      location.href = "index.html";
    });
  }
}

const ready = seed().then(renderNav);
