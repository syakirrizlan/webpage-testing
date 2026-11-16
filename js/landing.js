ready.then(() => {
  const user = Auth.current();
  if (!user) return;
  const btn = document.getElementById("signin-btn");
  btn.textContent = "My account";
  btn.href = "members.html";
  document.getElementById("new-guest").textContent = `Welcome back, ${user.name.split(" ")[0]}.`;
});
