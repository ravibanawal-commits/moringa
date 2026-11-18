const resetForm = document.querySelector("#reset-form");
const resetStatus = document.querySelector("#reset-status");
const resetToken = new URLSearchParams(window.location.search).get("token");

window.history.replaceState(null, "", window.location.pathname);

function showResetStatus(text, error = false) {
  resetStatus.textContent = text;
  resetStatus.classList.toggle("error", error);
}

if (!resetToken) {
  resetForm.hidden = true;
  showResetStatus("This password reset link is invalid or expired. Request a new one.", true);
}

resetForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showResetStatus("");
  const password = resetForm.elements.password.value;
  if (password !== resetForm.elements.confirmPassword.value) {
    showResetStatus("The passwords do not match.", true);
    return;
  }

  const button = resetForm.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const response = await fetch("/api/admin/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: resetToken, password })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `The server returned an error (${response.status}).`);
    resetForm.hidden = true;
    showResetStatus(result.message);
    const link = document.createElement("a");
    link.className = "reset-signin-link";
    link.href = "/admin";
    link.textContent = "Go to admin sign in";
    resetStatus.after(link);
  } catch (error) {
    showResetStatus(error.message, true);
  } finally {
    button.disabled = false;
  }
});
