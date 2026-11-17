const box = document.getElementById("pay");

function summaryHTML(b) {
  const room = bookingRoom(b);
  const nights = nightsBetween(b.checkIn, b.checkOut);
  const total = bookingTotal(b);
  return `
    <div class="pay-summary">
      <img src="${escapeHTML(room.image)}" alt="" width="140" height="105">
      <div>
        <h2>${escapeHTML(room.name)}</h2>
        <div class="meta">${formatDate(b.checkIn)} → ${formatDate(b.checkOut)} · ${plural(nights, "night")} · ${plural(b.guests, "guest")}</div>
      </div>
      <div class="summary">
        <div><span>Total</span><span>RM ${total}</span></div>
        <div class="deposit-row"><span>Deposit (non-refundable)</span><span>RM ${PAYMENT.deposit}</span></div>
        <div><span>Balance on arrival</span><span>RM ${total - PAYMENT.deposit}</span></div>
      </div>
    </div>`;
}

function whatsappButton(b, text) {
  const link = whatsappLink(text);
  return link
    ? `<a class="btn btn-whatsapp" href="${escapeHTML(link)}" target="_blank" rel="noopener">Send receipt on WhatsApp</a>`
    : `<p class="meta">The owner's WhatsApp number will be added here soon.</p>`;
}

function paidMessage(b) {
  const room = bookingRoom(b);
  return `Hi, I've paid the RM${PAYMENT.deposit} deposit for booking #${b.id.slice(0, 6).toUpperCase()}: ` +
    `${room.name}, ${formatDate(b.checkIn)} to ${formatDate(b.checkOut)}.`;
}

function render(b) {
  const state = bookingState(b);
  if (state === "awaiting_approval") {
    box.innerHTML = `
      <div class="panel">
        <div class="alert alert-ok">Thank you! Your deposit is marked as paid. The owner will check it and confirm your booking.</div>
        ${summaryHTML(b)}
        <p>Please send your receipt to the owner so they can confirm faster.</p>
        ${whatsappButton(b, paidMessage(b))}
        <p><a href="members.html">Go to My account</a></p>
      </div>`;
    return;
  }
  if (state !== "awaiting_deposit") {
    const text = state === "expired"
      ? `The ${PAYMENT.holdHours}-hour hold on these dates ended before the deposit was paid, so the dates have been released. Please make a new booking.`
      : `This booking is ${STATUS[state].label.toLowerCase()}.`;
    box.innerHTML = `<div class="panel"><p>${text}</p><p><a href="members.html">Go to My account</a></p></div>`;
    return;
  }

  const qr = PAYMENT.qrImage
    ? `<img class="qr" src="${escapeHTML(PAYMENT.qrImage)}" alt="DuitNow QR code">`
    : `<div class="qr qr-placeholder">DuitNow QR code<br>coming soon</div>`;
  box.innerHTML = `
    <div class="panel">
      <h1>Pay your RM${PAYMENT.deposit} deposit</h1>
      <p class="hold">Your dates are held until <b>${formatDateTime(holdDeadline(b))}</b>. If the deposit isn't paid by then, they are released.</p>
      ${summaryHTML(b)}
      <div class="pay-methods">
        <div class="pay-qr">
          ${qr}
          <div class="meta">Scan with any banking or e-wallet app${PAYMENT.accountName ? `<br>Account name: <b>${escapeHTML(PAYMENT.accountName)}</b>` : ""}</div>
        </div>
        <form id="paid-form">
          <fieldset>
            <legend>How did you pay?</legend>
            <label class="check"><input type="radio" name="method" value="qr" checked> DuitNow QR transfer</label>
            <label class="check"><input type="radio" name="method" value="cash"> Cash by hand to the owner</label>
          </fieldset>
          <div class="field">
            <label for="ref">Transfer reference (optional for cash)</label>
            <input id="ref" maxlength="60" placeholder="e.g. the reference number in your banking app">
          </div>
          <div id="pay-error" class="alert alert-error hidden"></div>
          <button class="btn btn-primary btn-block" type="submit">I've paid the deposit</button>
          <p class="meta">The RM${PAYMENT.deposit} deposit is non-refundable. The balance of RM ${bookingTotal(b) - PAYMENT.deposit} is paid on arrival.</p>
        </form>
      </div>
      <p><a href="members.html">Pay later</a> · you can come back to this page from My account.</p>
    </div>`;

  document.getElementById("paid-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const method = e.target.method.value;
    const reference = document.getElementById("ref").value;
    const errorBox = document.getElementById("pay-error");
    if (method === "qr" && !reference.trim()) {
      errorBox.textContent = "Please enter the transfer reference so the owner can find your payment.";
      errorBox.classList.remove("hidden");
      return;
    }
    e.submitter.disabled = true;
    try {
      await Bookings.markPaid(b.id, { method, reference });
      render(b);
    } catch (err) {
      errorBox.textContent = err.code === "permission-denied"
        ? `The ${PAYMENT.holdHours}-hour hold has ended, so this booking can no longer be paid. Please make a new booking.`
        : friendlyError(err).message;
      errorBox.classList.remove("hidden");
      e.submitter.disabled = false;
    }
  });
}

ready.then(() => {
  if (!Auth.require()) return;
  const b = Bookings.get(new URLSearchParams(location.search).get("id"));
  if (!b) {
    box.innerHTML = `<div class="panel"><p>Booking not found.</p><p><a href="members.html">Go to My account</a></p></div>`;
    return;
  }
  render(b);
});
