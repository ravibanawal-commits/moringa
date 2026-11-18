const loginPanel = document.querySelector("#login-panel");
const galleryEditor = document.querySelector("#gallery-editor");
const loginForm = document.querySelector("#login-form");
const loginStatus = document.querySelector("#login-status");
const passwordInput = loginForm.querySelector('[name="password"]');
const passwordToggle = loginForm.querySelector(".password-toggle");
const captchaImage = loginForm.querySelector(".captcha-image");
const captchaRefreshButton = loginForm.querySelector(".captcha-refresh");
const uploadForm = document.querySelector("#upload-form");
const uploadStatus = document.querySelector("#upload-status");
const fileInput = document.querySelector("#media-files");
const selectionLabel = document.querySelector("#upload-selection");
const uploadedGrid = document.querySelector("#uploaded-grid");
const galleryEmpty = document.querySelector("#gallery-admin-empty");

passwordToggle.addEventListener("click", () => {
  const isVisible = passwordInput.type === "text";
  passwordInput.type = isVisible ? "password" : "text";
  passwordToggle.setAttribute("aria-label", isVisible ? "Show password" : "Hide password");
  passwordToggle.setAttribute("aria-pressed", String(!isVisible));
});

function showStatus(target, text, error = false) {
  target.textContent = text;
  target.classList.toggle("error", error);
}

document.querySelector("#forgot-password").addEventListener("click", async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  showStatus(loginStatus, "");
  try {
    const result = await request("/api/admin/forgot-password", { method: "POST", body: "{}" });
    showStatus(loginStatus, result.message);
  } catch (error) {
    showStatus(loginStatus, error.message, true);
  } finally {
    button.disabled = false;
  }
});

async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers }
  });
  const data = response.headers.get("content-type")?.includes("application/json") ? await response.json() : {};
  if (!response.ok) {
    const message = response.status === 429
      ? "Too many failed sign-in attempts. Please wait 15 minutes before trying again."
      : `The server returned an error (${response.status}). Please try again.`;
    throw new Error(data.error || message);
  }
  return data;
}

async function refreshCaptcha() {
  const challenge = await request("/api/admin/captcha");
  loginForm.elements.captchaId.value = challenge.id;
  loginForm.elements.captchaCode.value = "";
  captchaImage.src = challenge.imageUrl;
}

captchaRefreshButton.addEventListener("click", async () => {
  captchaRefreshButton.disabled = true;
  try {
    await refreshCaptcha();
  } catch (error) {
    showStatus(loginStatus, error.message, true);
  } finally {
    captchaRefreshButton.disabled = false;
  }
});

function renderMedia(items) {
  uploadedGrid.replaceChildren(...items.map((item) => {
    const card = document.createElement("article");
    card.className = "uploaded-card";
    const media = document.createElement(item.mediaType === "video" ? "video" : "img");
    media.src = item.src;
    if (item.mediaType === "video") {
      media.controls = true;
      media.preload = "metadata";
      media.playsInline = true;
      media.setAttribute("aria-label", item.alt);
    } else {
      media.alt = item.alt;
      media.loading = "lazy";
    }
    const details = document.createElement("div");
    details.className = "uploaded-details";
    const filename = document.createElement("p");
    filename.textContent = item.alt;
    const date = document.createElement("span");
    date.textContent = new Date(item.uploadedAt).toLocaleDateString();
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-button";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Remove ${item.alt}`);
    remove.addEventListener("click", async () => {
      if (!window.confirm(`Remove "${item.alt}" from the website?`)) return;
      remove.disabled = true;
      try {
        await request(`/api/admin/gallery/${encodeURIComponent(item.id)}`, { method: "DELETE" });
        await loadMedia();
        showStatus(uploadStatus, "Gallery item removed from the website.");
      } catch (error) {
        showStatus(uploadStatus, error.message, true);
        remove.disabled = false;
      }
    });
    details.append(filename, date, remove);
    card.append(media, details);
    return card;
  }));
  galleryEmpty.hidden = items.length > 0;
}

async function loadMedia() {
  const result = await request("/api/admin/gallery");
  renderMedia(Array.isArray(result.photos) ? result.photos : []);
}

async function showEditor() {
  await loadMedia();
  loginPanel.hidden = true;
  galleryEditor.hidden = false;
}

fileInput.addEventListener("change", () => {
  const files = [...fileInput.files];
  if (!files.length) {
    selectionLabel.textContent = "No files selected yet.";
    return;
  }
  const clips = files.filter((file) => file.type.startsWith("video/")).length;
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  selectionLabel.textContent = `${files.length} file${files.length === 1 ? "" : "s"} selected · ${clips} clip${clips === 1 ? "" : "s"} · ${(totalSize / (1024 * 1024)).toFixed(1)} MB total`;
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showStatus(loginStatus, "");
  const button = loginForm.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const credentials = Object.fromEntries(new FormData(loginForm));
    credentials.rememberMe = loginForm.elements.rememberMe.checked;
    await request("/api/admin/login", { method: "POST", body: JSON.stringify(credentials) });
    await showEditor();
  } catch (error) {
    showStatus(loginStatus, error.message, true);
    try {
      await refreshCaptcha();
    } catch (refreshError) {
      showStatus(loginStatus, `${error.message} ${refreshError.message}`, true);
    }
  } finally {
    button.disabled = false;
  }
});

uploadForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showStatus(uploadStatus, "");
  const files = [...fileInput.files];
  const isVideo = (file) => ["video/mp4", "video/webm"].includes(file.type);
  const isImage = (file) => ["image/jpeg", "image/png", "image/webp"].includes(file.type);
  if (!files.length) return showStatus(uploadStatus, "Choose at least one photo or clip.", true);
  if (files.length > 5) return showStatus(uploadStatus, "Upload up to 5 files at a time.", true);
  if (files.some((file) => !isVideo(file) && !isImage(file))) return showStatus(uploadStatus, "Choose JPG, PNG, WebP, MP4, or WebM files.", true);
  if (files.filter(isVideo).length > 1) return showStatus(uploadStatus, "Upload one video clip at a time.", true);
  if (files.some((file) => file.size > (isVideo(file) ? 25 : 5) * 1024 * 1024)) {
    return showStatus(uploadStatus, "Photos must be 5 MB or smaller and video clips must be 25 MB or smaller.", true);
  }
  const button = uploadForm.querySelector('button[type="submit"]');
  button.disabled = true;
  showStatus(uploadStatus, "Uploading gallery files…");
  try {
    const response = await fetch("/api/admin/gallery", { method: "POST", body: new FormData(uploadForm) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "The gallery files could not be uploaded.");
    uploadForm.reset();
    selectionLabel.textContent = "No files selected yet.";
    await loadMedia();
    showStatus(uploadStatus, "Uploaded — the gallery items are now live on the website.");
  } catch (error) {
    showStatus(uploadStatus, error.message, true);
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#logout-button").addEventListener("click", async () => {
  try {
    await request("/api/admin/logout", { method: "POST" });
    galleryEditor.hidden = true;
    loginPanel.hidden = false;
    loginForm.reset();
    showStatus(loginStatus, "You have signed out.");
  } catch (error) {
    showStatus(uploadStatus, error.message, true);
  }
});

request("/api/admin/session")
  .then(showEditor)
  .catch(() => {
    loginPanel.hidden = false;
    galleryEditor.hidden = true;
    refreshCaptcha().catch((error) => showStatus(loginStatus, error.message, true));
  });
