const loginPanel = document.querySelector("#login-panel");
const editor = document.querySelector("#editor");
const loginForm = document.querySelector("#login-form");
const loginStatus = document.querySelector("#login-status");
const passwordInput = loginForm.querySelector('[name="password"]');
const passwordToggle = loginForm.querySelector(".password-toggle");
const captchaImage = loginForm.querySelector(".captcha-image");
const captchaRefreshButton = loginForm.querySelector(".captcha-refresh");
const saveStatus = document.querySelector("#save-status");
const slidesEditor = document.querySelector("#slides-editor");
const benefitsEditor = document.querySelector("#benefits-editor");
const contentForm = document.querySelector("#content-form");
const benefitIcons = ["leaf", "bowl", "sun", "heart"];

passwordToggle.addEventListener("click", () => {
  const isVisible = passwordInput.type === "text";
  passwordInput.type = isVisible ? "password" : "text";
  passwordToggle.setAttribute("aria-label", isVisible ? "Show password" : "Hide password");
  passwordToggle.setAttribute("aria-pressed", String(!isVisible));
});

loginForm.addEventListener("reset", () => {
  passwordInput.type = "password";
  passwordToggle.setAttribute("aria-label", "Show password");
  passwordToggle.setAttribute("aria-pressed", "false");
  showStatus(loginStatus, "");
  refreshCaptcha().catch((error) => showStatus(loginStatus, error.message, true));
});

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

function showStatus(target, text, error = false) {
  target.textContent = text;
  target.classList.toggle("error", error);
}

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

function makeField(labelText, name, value, options = {}) {
  const label = document.createElement("label");
  label.textContent = labelText;
  const input = document.createElement(options.multiline ? "textarea" : "input");
  input.name = name;
  input.value = value || "";
  input.required = true;
  if (options.multiline) input.rows = options.rows || 3;
  if (options.maxlength) input.maxLength = options.maxlength;
  label.append(input);
  return label;
}

function makeRepeaterItem(type, item, index) {
  const wrapper = document.createElement("div");
  wrapper.className = "repeater-item";
  const top = document.createElement("div");
  top.className = "item-topline";
  const title = document.createElement("span");
  title.textContent = `${type === "slide" ? "Slide" : "Highlight"} ${String(index + 1).padStart(2, "0")}`;
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "remove-button";
  remove.textContent = "Remove";
  remove.addEventListener("click", () => {
    wrapper.remove();
    renumberItems(type);
  });
  top.append(title, remove);
  wrapper.append(top);
  if (type === "slide") {
    wrapper.append(
      makeField("Image URL", "image", item.image, { maxlength: 1000 }),
      makeField("Headline (supports <em>italics</em> markup)", "title", item.title, { multiline: true, rows: 2, maxlength: 180 }),
      makeField("Supporting text", "caption", item.caption, { multiline: true, rows: 2, maxlength: 240 })
    );
  } else {
    const iconLabel = document.createElement("label");
    iconLabel.textContent = "Icon";
    const select = document.createElement("select");
    select.name = "icon";
    benefitIcons.forEach((icon) => {
      const option = document.createElement("option");
      option.value = icon;
      option.textContent = icon.charAt(0).toUpperCase() + icon.slice(1);
      select.append(option);
    });
    select.value = benefitIcons.includes(item.icon) ? item.icon : "leaf";
    iconLabel.append(select);
    wrapper.append(
      iconLabel,
      makeField("Title", "title", item.title, { maxlength: 80 }),
      makeField("Description", "description", item.description, { multiline: true, rows: 2, maxlength: 320 })
    );
  }
  return wrapper;
}

function renumberItems(type) {
  const container = type === "slide" ? slidesEditor : benefitsEditor;
  [...container.children].forEach((item, index) => {
    item.querySelector(".item-topline span").textContent = `${type === "slide" ? "Slide" : "Highlight"} ${String(index + 1).padStart(2, "0")}`;
  });
}

function addItem(type, data = {}) {
  const container = type === "slide" ? slidesEditor : benefitsEditor;
  const count = container.children.length;
  if ((type === "slide" && count >= 5) || (type === "benefit" && count >= 8)) {
    showStatus(saveStatus, `You can add up to ${type === "slide" ? 5 : 8} ${type === "slide" ? "slides" : "highlights"}.`, true);
    return;
  }
  container.append(makeRepeaterItem(type, data, count));
}

function serializeItems(container, type) {
  return [...container.children].map((item) => {
    const values = Object.fromEntries([...item.querySelectorAll("[name]")].map((field) => [field.name, field.value.trim()]));
    return type === "slide"
      ? { image: values.image, title: values.title, caption: values.caption }
      : { icon: values.icon, title: values.title, description: values.description };
  });
}

function renderContent(data) {
  contentForm.elements.aboutTitle.value = data.aboutTitle || "";
  contentForm.elements.aboutCopy.value = data.aboutCopy || "";
  slidesEditor.replaceChildren(...(data.heroSlides || []).map((item, index) => makeRepeaterItem("slide", item, index)));
  benefitsEditor.replaceChildren(...(data.benefits || []).map((item, index) => makeRepeaterItem("benefit", item, index)));
  loginPanel.hidden = true;
  editor.hidden = false;
}

async function loadContent() {
  const data = await request("/api/admin/content");
  renderContent(data);
}

document.querySelector("#add-slide").addEventListener("click", () => addItem("slide", { image: "", title: "", caption: "" }));
document.querySelector("#add-benefit").addEventListener("click", () => addItem("benefit", { icon: "leaf", title: "", description: "" }));

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showStatus(loginStatus, "");
  const button = loginForm.querySelector('button[type="submit"]');
  button.disabled = true;
  try {
    const values = Object.fromEntries(new FormData(loginForm));
    values.rememberMe = loginForm.elements.rememberMe.checked;
    await request("/api/admin/login", { method: "POST", body: JSON.stringify(values) });
    await loadContent();
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

contentForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  showStatus(saveStatus, "");
  const button = contentForm.querySelector(".save-button");
  button.disabled = true;
  const content = {
    aboutTitle: contentForm.elements.aboutTitle.value.trim(),
    aboutCopy: contentForm.elements.aboutCopy.value.trim(),
    heroSlides: serializeItems(slidesEditor, "slide"),
    benefits: serializeItems(benefitsEditor, "benefit")
  };
  try {
    await request("/api/admin/content", { method: "PUT", body: JSON.stringify(content) });
    showStatus(saveStatus, "Saved — your homepage is up to date.");
  } catch (error) {
    showStatus(saveStatus, error.message, true);
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#logout-button").addEventListener("click", async () => {
  try {
    await request("/api/admin/logout", { method: "POST" });
    editor.hidden = true;
    loginPanel.hidden = false;
    loginForm.reset();
    showStatus(loginStatus, "You have signed out.");
  } catch (error) {
    showStatus(saveStatus, error.message, true);
  }
});

request("/api/admin/session")
  .then(() => loadContent())
  .catch(() => {
    loginPanel.hidden = false;
    editor.hidden = true;
    refreshCaptcha().catch((error) => showStatus(loginStatus, error.message, true));
  });
