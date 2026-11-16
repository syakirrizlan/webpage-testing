const loginForm = document.getElementById("login-form");
const registerForm = document.getElementById("register-form");
const errorBox = document.getElementById("auth-error");
const infoBox = document.getElementById("auth-info");

// Only follow relative links to our own pages after login.
function nextPage() {
  const next = new URLSearchParams(location.search).get("next") || "";
  return /^[a-z]+\.html(\?.*)?$/.test(next) ? next : "members.html";
}

ready.then(() => {
  if (Auth.current()) location.replace(nextPage());
});

document.querySelectorAll(".tabs button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("active", b === btn));
    loginForm.classList.toggle("hidden", btn.dataset.tab !== "login");
    registerForm.classList.toggle("hidden", btn.dataset.tab !== "register");
    errorBox.classList.add("hidden");
    infoBox.classList.add("hidden");
  });
});

if (new URLSearchParams(location.search).get("tab") === "register") {
  document.querySelector('.tabs button[data-tab="register"]').click();
}

function showError(err) {
  infoBox.classList.add("hidden");
  errorBox.textContent = err.message;
  errorBox.classList.remove("hidden");
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  await ready;
  try {
    await Auth.login(document.getElementById("l-email").value, document.getElementById("l-pass").value);
    location.href = nextPage();
  } catch (err) {
    showError(err);
  }
});

registerForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  await ready;
  try {
    await Auth.register({
      name: document.getElementById("r-name").value,
      email: document.getElementById("r-email").value,
      phone: document.getElementById("r-phone").value,
      password: document.getElementById("r-pass").value,
    });
    location.href = nextPage();
  } catch (err) {
    showError(err);
  }
});

document.getElementById("forgot-btn").addEventListener("click", async () => {
  const email = document.getElementById("l-email").value.trim();
  if (!email) {
    showError(new Error("Enter your email above, then click \"Forgot password?\" again."));
    return;
  }
  await ready;
  try {
    await Auth.resetPassword(email);
    errorBox.classList.add("hidden");
    infoBox.textContent = `If ${email} has an account, a password reset link is on its way. Check your inbox and spam folder.`;
    infoBox.classList.remove("hidden");
  } catch (err) {
    showError(err);
  }
});
