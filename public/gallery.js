function renderPhotos(photos) {
  const grid = document.querySelector("#gallery-grid");
  const empty = document.querySelector("#gallery-empty");
  const count = document.querySelector("#media-count");
  const total = photos.length;
  count.textContent = `${String(total).padStart(2, "0")} ${total === 1 ? "ITEM" : "ITEMS"}`;
  grid.replaceChildren(...photos.map((photo, index) => {
    const figure = document.createElement("figure");
    figure.className = "gallery-page-card";
    const media = document.createElement(photo.mediaType === "video" ? "video" : "img");
    media.src = photo.src;
    if (photo.mediaType === "video") {
      media.controls = true;
      media.preload = "metadata";
      media.playsInline = true;
      media.setAttribute("aria-label", photo.alt);
    } else {
      media.alt = photo.alt;
      media.loading = index < 3 ? "eager" : "lazy";
    }
    const caption = document.createElement("figcaption");
    const number = document.createElement("span");
    number.textContent = String(index + 1).padStart(2, "0");
    const label = document.createElement("span");
    label.textContent = photo.alt;
    caption.append(number, label);
    figure.append(media, caption);
    return figure;
  }));
  empty.hidden = total > 0;
}

fetch("/api/gallery")
  .then((response) => response.ok ? response.json() : Promise.reject(new Error("Could not load gallery photos")))
  .then((result) => renderPhotos(Array.isArray(result.photos) ? result.photos : []))
  .catch((error) => {
    console.error("Could not load gallery photos:", error);
    document.querySelector("#gallery-empty").textContent = "The gallery is temporarily unavailable. Please try again later.";
  });

document.querySelector("#year").textContent = new Date().getFullYear();

const menuToggle = document.querySelector(".menu-toggle");
const navigation = document.querySelector("#primary-nav");
const aboutDropdown = navigation.querySelector(".nav-dropdown");
const aboutDropdownToggle = aboutDropdown.querySelector(".nav-dropdown-toggle");
function setAboutDropdownOpen(open) {
  aboutDropdown.classList.toggle("is-open", open);
  aboutDropdownToggle.setAttribute("aria-expanded", String(open));
}
aboutDropdownToggle.addEventListener("click", () => {
  setAboutDropdownOpen(aboutDropdownToggle.getAttribute("aria-expanded") !== "true");
});
document.addEventListener("click", (event) => {
  if (!aboutDropdown.contains(event.target)) setAboutDropdownOpen(false);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && aboutDropdownToggle.getAttribute("aria-expanded") === "true") {
    setAboutDropdownOpen(false);
    aboutDropdownToggle.focus();
  }
});
menuToggle.addEventListener("click", () => {
  const open = menuToggle.getAttribute("aria-expanded") !== "true";
  menuToggle.setAttribute("aria-expanded", String(open));
  navigation.classList.toggle("is-open", open);
});
navigation.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => {
  setAboutDropdownOpen(false);
  menuToggle.setAttribute("aria-expanded", "false");
  navigation.classList.remove("is-open");
}));
