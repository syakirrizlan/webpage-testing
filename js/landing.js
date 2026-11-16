document.getElementById("units").innerHTML = ROOMS.map((r) => `
  <li>
    <a href="room.html?id=${r.id}">
      <b>${escapeHTML(r.name)}</b>
      <span>${escapeHTML(r.summary)}</span>
      <em>RM ${r.price} / night</em>
    </a>
  </li>`).join("");

ready.then(() => {
  const user = Auth.current();
  if (!user) return;
  const btn = document.getElementById("signin-btn");
  btn.textContent = "My account";
  btn.href = "members.html";
  document.getElementById("new-guest").textContent = `Welcome back, ${user.name.split(" ")[0]}.`;
});
