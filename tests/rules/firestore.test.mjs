// Security-rule tests against the Firestore emulator. Run with: npm run test:rules
import test, { after, before } from "node:test";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { setLogLevel } from "firebase/app";
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, writeBatch, collection, getDocs, query, where,
  serverTimestamp, Timestamp,
} from "firebase/firestore";

setLogLevel("silent"); // refused writes are expected here

const day = (n) => new Date(Date.now() + n * 86400e3).toISOString().slice(0, 10);
const hoursAgo = (h) => Timestamp.fromMillis(Date.now() - h * 3600e3);
// Booking ids must look like Firestore auto-ids (20 letters and digits).
const id = (name) => name.padEnd(20, "0");
const ROOMS_OF = { house: ["r1", "r2", "r3"] };

let env, alice, bob, owner, anon;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "demo-homestay",
    firestore: { rules: readFileSync("firestore.rules", "utf8") },
  });
  await env.clearFirestore();
  const as = (uid) => env.authenticatedContext(uid, { email: `${uid}@example.com` }).firestore();
  [alice, bob, owner] = ["alice", "bob", "owner"].map(as);
  anon = env.unauthenticatedContext().firestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "admins/owner"), { role: "owner" });
    // Carol's unpaid hold from 25 hours ago (expired) and Alice's own expired booking.
    await setDoc(doc(db, "bookings", id("carolOld")), booking("r2", "carol", 50, 1, { createdAt: hoursAgo(25) }));
    await setDoc(doc(db, "nights", `r2_${day(50)}`), { roomId: "r2", date: day(50), bookingId: id("carolOld"), heldAt: hoursAgo(25) });
    await setDoc(doc(db, "bookings", id("aliceOld")), booking("r3", "alice", 60, 1, { createdAt: hoursAgo(25) }));
  });
});

after(() => env.cleanup());

function booking(roomId, userId, start, nights, extra = {}) {
  return {
    roomId, userId, checkIn: day(start), checkOut: day(start + nights), guests: 2,
    status: "awaiting_deposit", depositAgreed: true, createdAt: serverTimestamp(), ...extra,
  };
}

function nightsOf(roomId, start, nights) {
  const rooms = ROOMS_OF[roomId] || [roomId];
  return Array.from({ length: nights }, (_, i) => day(start + i)).flatMap((d) => rooms.map((r) => ({ roomId: r, date: d })));
}

// What the site does on Reserve: the booking and its night locks in one write.
function reserve(db, name, userId, roomId, start, nights, extra = {}) {
  const batch = writeBatch(db);
  batch.set(doc(db, "bookings", id(name)), booking(roomId, userId, start, nights, extra));
  for (const n of nightsOf(extra.nightRoom || roomId, start, nights)) {
    batch.set(doc(db, "nights", `${n.roomId}_${n.date}`), { ...n, bookingId: id(name), heldAt: serverTimestamp() });
  }
  return batch.commit();
}

function pay(db, name, roomId, start, nights, extra = {}) {
  const batch = writeBatch(db);
  batch.update(doc(db, "bookings", id(name)), { status: "awaiting_approval", paymentMethod: "qr", paymentRef: "REF123", paidAt: serverTimestamp(), ...extra });
  for (const n of nightsOf(roomId, start, nights)) batch.update(doc(db, "nights", `${n.roomId}_${n.date}`), { heldAt: null });
  return batch.commit();
}

const decided = () => ({ decidedAt: serverTimestamp() });

test("profiles are private to their owner and admins", async () => {
  await assertSucceeds(setDoc(doc(alice, "users/alice"), { name: "Alice", phone: "1", email: "alice@example.com", joined: day(0) }));
  await assertFails(setDoc(doc(bob, "users/bob"), { name: "Bob", phone: "", email: "alice@example.com", joined: day(0) })); // someone else's email
  await assertSucceeds(setDoc(doc(bob, "users/bob"), { name: "Bob", phone: "", joined: day(0) }));
  await assertFails(updateDoc(doc(alice, "users/alice"), { admin: true }));
  await assertFails(getDoc(doc(bob, "users/alice")));
  await assertFails(getDoc(doc(anon, "users/alice")));
  await assertSucceeds(getDoc(doc(owner, "users/alice")));
});

test("the admin list can't be read or changed by members", async () => {
  await assertSucceeds(getDoc(doc(alice, "admins/alice"))); // "am I an admin?"
  await assertFails(getDoc(doc(alice, "admins/owner")));
  await assertFails(setDoc(doc(alice, "admins/alice"), { role: "owner" }));
});

test("reserving: only valid, unpaid bookings for yourself", async () => {
  await assertSucceeds(reserve(alice, "house1", "alice", "house", 10, 2));
  await assertFails(reserve(bob, "x1", "bob", "r1", 100, 1, { status: "confirmed" }));
  await assertFails(reserve(bob, "x2", "bob", "r1", 100, 1, { depositAgreed: false }));
  await assertFails(reserve(bob, "x3", "alice", "r1", 100, 1)); // as someone else
  await assertFails(reserve(bob, "x4", "bob", "r9", 100, 1)); // unknown room
  await assertFails(reserve(anon, "x5", "anon", "r1", 100, 1));
});

test("reserving: dates must exist, be current, and at most 30 nights", async () => {
  await assertFails(reserve(bob, "d1", "bob", "r1", -5, 1)); // in the past
  await assertFails(reserve(bob, "d2", "bob", "r1", 400, 1)); // more than a year ahead
  await assertFails(reserve(bob, "d3", "bob", "r1", 100, 31)); // too long
  await assertFails(setDoc(doc(bob, "bookings", id("d4")), booking("r1", "bob", 100, 1, { checkOut: "9999-12-31" })));
  await assertFails(setDoc(doc(bob, "bookings", id("d5")), booking("r1", "bob", 100, 1, { checkIn: "2027-02-31", checkOut: "2027-03-02" })));
  await assertSucceeds(reserve(bob, "d6", "bob", "r3", 0, 1)); // tonight
});

test("reserving: booking ids must be plain auto-ids", async () => {
  // The admin page shows booking ids, so markup in an id must never get in.
  await assertFails(setDoc(doc(bob, "bookings", `"><img src=x onerror=alert(1)>`), booking("r1", "bob", 100, 1)));
  await assertFails(setDoc(doc(bob, "bookings", "short"), booking("r1", "bob", 100, 1)));
});

test("night locks: no double booking, holds expire, locks must match the booking", async () => {
  await assertFails(reserve(bob, "n1", "bob", "r2", 10, 1)); // held by Alice's whole-house booking
  await assertSucceeds(reserve(bob, "n2", "bob", "r2", 50, 1)); // Carol's hold expired
  await assertFails(reserve(bob, "n3", "bob", "r2", 110, 1, { nightRoom: "r3" })); // lock for another room
  await assertFails(setDoc(doc(bob, "nights", `house_${day(120)}`), { roomId: "house", date: day(120), bookingId: id("n2"), heldAt: serverTimestamp() }));
  await assertSucceeds(getDocs(collection(anon, "nights"))); // availability is public
});

test("whole house and rooms block each other; different rooms don't", async () => {
  await assertSucceeds(reserve(bob, "w1", "bob", "r3", 70, 1));
  await assertFails(reserve(alice, "w2", "alice", "house", 70, 1));
  await assertSucceeds(reserve(alice, "w3", "alice", "r1", 70, 1));
});

test("paying: only the guest, only in time, and never self-approval", async () => {
  await assertFails(pay(bob, "house1", "house", 10, 2)); // not Bob's booking
  await assertFails(updateDoc(doc(alice, "nights", `r1_${day(10)}`), { heldAt: null })); // keep the hold without paying
  await assertFails(updateDoc(doc(alice, "bookings", id("aliceOld")), { status: "awaiting_approval", paymentMethod: "qr", paymentRef: "", paidAt: serverTimestamp() })); // expired
  await assertFails(pay(alice, "house1", "house", 10, 2, { paymentMethod: "crypto" }));
  await assertSucceeds(pay(alice, "house1", "house", 10, 2));
  await assertFails(updateDoc(doc(alice, "bookings", id("house1")), { status: "confirmed", ...decided() }));
});

test("admin: reads everything, approves and declines, can't rewrite bookings", async () => {
  await assertSucceeds(getDocs(collection(owner, "bookings")));
  await assertFails(getDocs(collection(bob, "bookings")));
  await assertSucceeds(getDocs(query(collection(bob, "bookings"), where("userId", "==", "bob"))));
  await assertFails(getDoc(doc(bob, "bookings", id("house1"))));
  await assertFails(updateDoc(doc(owner, "bookings", id("house1")), { checkIn: day(11) }));
  await assertSucceeds(updateDoc(doc(owner, "bookings", id("house1")), { status: "confirmed", ...decided() }));
  await assertFails(reserve(bob, "a1", "bob", "r1", 10, 1)); // confirmed nights stay locked
});

test("admin: cash approval, and decline frees the dates for someone else", async () => {
  await assertSucceeds(reserve(bob, "c1", "bob", "r1", 80, 1));
  const cash = writeBatch(owner);
  cash.update(doc(owner, "bookings", id("c1")), { status: "confirmed", paymentMethod: "cash", ...decided() });
  cash.update(doc(owner, "nights", `r1_${day(80)}`), { heldAt: null });
  await assertSucceeds(cash.commit());

  await assertSucceeds(reserve(alice, "c2", "alice", "r3", 90, 1));
  await assertSucceeds(pay(alice, "c2", "r3", 90, 1));
  const decline = writeBatch(owner);
  decline.update(doc(owner, "bookings", id("c2")), { status: "denied", denyReason: "Closed for repairs", depositRefund: true, ...decided() });
  decline.delete(doc(owner, "nights", `r3_${day(90)}`));
  await assertSucceeds(decline.commit());
  await assertFails(updateDoc(doc(owner, "bookings", id("c2")), { status: "confirmed", ...decided() })); // final
  await assertSucceeds(reserve(bob, "c3", "bob", "r3", 90, 1));
});

test("cancelling: only your own, and nights are freed only by cancelling", async () => {
  await assertFails(updateDoc(doc(bob, "bookings", id("house1")), { status: "cancelled", cancelledAt: serverTimestamp() }));
  await assertFails(deleteDoc(doc(bob, "nights", `r1_${day(10)}`))); // someone else's night
  await assertFails(deleteDoc(doc(bob, "nights", `r1_${day(80)}`))); // own night, booking still confirmed
  const cancel = writeBatch(alice);
  cancel.update(doc(alice, "bookings", id("house1")), { status: "cancelled", cancelledAt: serverTimestamp() });
  for (const n of nightsOf("house", 10, 2)) cancel.delete(doc(alice, "nights", `${n.roomId}_${n.date}`));
  await assertSucceeds(cancel.commit());
  await assertFails(updateDoc(doc(alice, "bookings", id("house1")), { status: "awaiting_approval", paymentMethod: "qr", paymentRef: "", paidAt: serverTimestamp() })); // no reviving
  await assertSucceeds(reserve(bob, "z1", "bob", "r2", 10, 1));
});

test("the longest stay (30 nights, whole house) fits in one write at every step", async () => {
  await assertSucceeds(reserve(alice, "long", "alice", "house", 200, 30)); // 91 documents
  await assertSucceeds(pay(alice, "long", "house", 200, 30));
  const decline = writeBatch(owner);
  decline.update(doc(owner, "bookings", id("long")), { status: "denied", denyReason: "", depositRefund: true, ...decided() });
  for (const n of nightsOf("house", 200, 30)) decline.delete(doc(owner, "nights", `${n.roomId}_${n.date}`));
  await assertSucceeds(decline.commit());
});
