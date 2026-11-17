// Unit tests for the business rules in js/core.js. Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../../js/core.js");

const TODAY = "2026-11-17";

test("dates: ISO validation rejects impossible and malformed dates", () => {
  assert.equal(core.isISODate("2026-12-31"), true);
  assert.equal(core.isISODate("2028-02-29"), true); // leap year
  assert.equal(core.isISODate("2026-02-31"), false);
  assert.equal(core.isISODate("2026-13-01"), false);
  assert.equal(core.isISODate("26-1-1"), false);
  assert.equal(core.isISODate(""), false);
  assert.equal(core.isISODate(null), false);
});

test("dates: addDays crosses month and year ends", () => {
  assert.equal(core.addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(core.addDays("2027-03-01", -1), "2027-02-28");
  assert.equal(core.nightsBetween("2026-12-30", "2027-01-02"), 3);
});

test("stayError: accepts a normal stay", () => {
  assert.equal(core.stayError("2026-12-01", "2026-12-03", TODAY), null);
  assert.equal(core.stayError(TODAY, core.addDays(TODAY, 1), TODAY), null); // tonight
});

test("stayError: rejects missing, reversed, past, too long and too far ahead", () => {
  assert.match(core.stayError("", "2026-12-03", TODAY), /both/);
  assert.match(core.stayError("2026-12-01", "garbage", TODAY), /both/);
  assert.match(core.stayError("2026-12-03", "2026-12-03", TODAY), /after check-in/);
  assert.match(core.stayError("2026-12-03", "2026-12-01", TODAY), /after check-in/);
  assert.match(core.stayError("2026-11-16", "2026-11-18", TODAY), /past/);
  assert.equal(core.stayError("2026-12-01", "2026-12-31", TODAY), null); // exactly 30 nights
  assert.match(core.stayError("2026-12-01", "2027-01-01", TODAY), /30 nights/);
  assert.match(core.stayError("2026-12-01", "9999-12-31", TODAY), /30 nights/);
  assert.equal(core.stayError("2027-11-17", "2027-11-18", TODAY), null); // exactly a year ahead
  assert.match(core.stayError("2027-11-18", "2027-11-19", TODAY), /year ahead/);
});

test("pricing: total is nights × price + cleaning fee", () => {
  const house = core.getRoom("house");
  assert.equal(core.stayTotal(house, 2), house.price * 2 + core.CLEANING_FEE);
  assert.equal(
    core.bookingTotal({ roomId: "r2", checkIn: "2026-12-01", checkOut: "2026-12-04" }),
    core.getRoom("r2").price * 3 + core.CLEANING_FEE,
  );
  assert.equal(core.bookingTotal({ roomId: "gone", checkIn: "2026-12-01", checkOut: "2026-12-02" }), 0);
});

test("rooms: every included room exists and the deposit is below the cheapest stay", () => {
  for (const room of core.ROOMS) {
    for (const id of room.includes || []) assert.ok(core.getRoom(id), `${room.id} includes unknown room ${id}`);
    assert.ok(core.stayTotal(room, 1) > core.PAYMENT.deposit, `${room.id}: deposit exceeds a one-night stay`);
  }
  assert.equal(core.bookingRoom({ roomId: "gone" }).name, "Removed room");
});

test("nightIds: a room locks itself, the whole house locks every room", () => {
  assert.deepEqual(core.nightIds({ roomId: "r2", checkIn: "2026-12-01", checkOut: "2026-12-03" }),
    ["r2_2026-12-01", "r2_2026-12-02"]); // check-out day stays free
  assert.deepEqual(core.nightIds({ roomId: "house", checkIn: "2026-12-01", checkOut: "2026-12-02" }),
    ["r1_2026-12-01", "r2_2026-12-01", "r3_2026-12-01"]);
  assert.deepEqual(core.nightIds({ roomId: "gone", checkIn: "2026-12-01", checkOut: "2026-12-02" }), []);
});

test("nightIds: a malformed booking can't run away", () => {
  const ids = core.nightIds({ roomId: "house", checkIn: "2026-12-01", checkOut: "9999-12-31" });
  assert.equal(ids.length, core.MAX_NIGHTS * 3);
});

test("bookingState: an unpaid booking expires when its hold runs out", () => {
  const createdAt = Date.UTC(2026, 10, 17, 8);
  const unpaid = { status: "awaiting_deposit", createdAt };
  assert.equal(core.bookingState(unpaid, createdAt + core.HOLD_MS - 1), "awaiting_deposit");
  assert.equal(core.bookingState(unpaid, createdAt + core.HOLD_MS), "expired");
  // Once paid or decided, time no longer matters.
  for (const status of ["awaiting_approval", "confirmed", "denied", "cancelled"]) {
    assert.equal(core.bookingState({ status, createdAt }, createdAt + core.HOLD_MS * 10), status);
  }
});

test("nightBlocks: holds block until they expire; paid nights block forever", () => {
  const now = Date.UTC(2026, 10, 17, 8);
  assert.equal(core.nightBlocks(undefined, now), false);
  assert.equal(core.nightBlocks({ heldAt: now - 1000 }, now), true);
  assert.equal(core.nightBlocks({ heldAt: now - core.HOLD_MS }, now), false);
  assert.equal(core.nightBlocks({ heldAt: null }, now + core.HOLD_MS * 100), true);
});

test("text: escapeHTML neutralises markup, plural agrees with the count", () => {
  assert.equal(core.escapeHTML(`"><img src=x onerror=alert(1)>`), "&quot;&gt;&lt;img src=x onerror=alert(1)&gt;");
  assert.equal(core.plural(1, "night"), "1 night");
  assert.equal(core.plural(2, "night"), "2 nights");
});
