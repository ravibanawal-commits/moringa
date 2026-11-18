const fallbackContent = {
  heroSlides: [
    { image: "https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=2000&q=88", title: "Good things<br>grow <em>here.</em>", caption: "A family-grown moringa orchard, rooted in the land and nurtured with care." },
    { image: "https://images.unsplash.com/photo-1470252649378-9c29740c9fa8?auto=format&fit=crop&w=2000&q=88", title: "Rooted in<br><em>goodness.</em>", caption: "Discover the quiet joy of growing thoughtfully, one season at a time." },
    { image: "https://images.unsplash.com/photo-1523348837708-15d4a09cfac2?auto=format&fit=crop&w=2000&q=88", title: "Grown with<br><em>purpose.</em>", caption: "Meet the people and practices behind our little corner of green." }
  ],
  aboutTitle: "A slower way to<br><em>grow something good.</em>",
  aboutCopy: "At Moringa Grove, we believe the best things begin with healthy soil, patient hands, and respect for the seasons. Our orchard brings together moringa trees and a thoughtful approach to growing—so every harvest has a story worth sharing.",
  benefits: [
    { icon: "leaf", title: "A leafy addition", description: "Moringa leaves can be enjoyed fresh or dried, bringing a distinctive green note to everyday meals." },
    { icon: "bowl", title: "Made for the kitchen", description: "Stir into soups, blend into smoothies, or steep as a simple herbal tea." },
    { icon: "sun", title: "A naturally versatile plant", description: "From its leaves to its pods, moringa has a long history of practical, culinary uses." },
    { icon: "heart", title: "Part of a balanced life", description: "A flavorful plant food to enjoy alongside a varied diet and healthy daily habits." }
  ]
};

const iconMarkup = {
  leaf: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M19.5 4.5c-8.5 0-14 3.8-14 9.2a5.8 5.8 0 0 0 5.8 5.8c5.4 0 8.2-6 8.2-15Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M5.5 19.5c2.3-3.5 5.1-6.2 9-8.2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  bowl: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 12h16l-1.6 6.2H5.6L4 12Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M3 9c1.7 0 1.7-1.5 3.4-1.5S8.1 9 9.8 9s1.7-1.5 3.4-1.5S14.9 9 16.6 9 18.3 7.5 20 7.5M8 21h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  sun: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="1.5"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>',
  heart: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20.8 8.7c0 5.2-8.8 10.1-8.8 10.1S3.2 13.9 3.2 8.7a4.5 4.5 0 0 1 8.8-1.3 4.5 4.5 0 0 1 8.8 1.3Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>'
};

const heroImage = document.querySelector("#hero-image");
const dots = document.querySelector("#slide-dots");
let slides = fallbackContent.heroSlides;
let currentSlide = 0;
let slideTimer;

function renderSlide(index) {
  if (!slides.length) return;
  currentSlide = (index + slides.length) % slides.length;
  const slide = slides[currentSlide];
  heroImage.style.backgroundImage = `url("${slide.image}")`;
  document.querySelector("#hero-title").innerHTML = slide.title;
  document.querySelector("#hero-caption").textContent = slide.caption;
  document.querySelector("#slide-current").textContent = String(currentSlide + 1).padStart(2, "0");
  document.querySelector("#slide-total").textContent = String(slides.length).padStart(2, "0");
  [...dots.children].forEach((dot, i) => dot.setAttribute("aria-current", String(i === currentSlide)));
}

function setSlides(newSlides) {
  if (!Array.isArray(newSlides) || !newSlides.length) return;
  slides = newSlides;
  dots.replaceChildren(...slides.map((_, i) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.setAttribute("aria-label", `Show slide ${i + 1}`);
    dot.addEventListener("click", () => { renderSlide(i); restartSlideTimer(); });
    return dot;
  }));
  renderSlide(0);
}

function restartSlideTimer() {
  window.clearInterval(slideTimer);
  slideTimer = window.setInterval(() => renderSlide(currentSlide + 1), 6500);
}

function renderBenefits(items) {
  const grid = document.querySelector("#benefit-grid");
  grid.replaceChildren(...items.map((item) => {
    const card = document.createElement("article");
    card.className = "benefit-card";
    const icon = document.createElement("span");
    icon.className = "benefit-icon";
    icon.innerHTML = iconMarkup[item.icon] || iconMarkup.leaf;
    const title = document.createElement("h3");
    title.textContent = item.title;
    const description = document.createElement("p");
    description.textContent = item.description;
    card.append(icon, title, description);
    return card;
  }));
}

function applyContent(content) {
  if (typeof content.aboutTitle === "string") document.querySelector("#about-title").innerHTML = content.aboutTitle;
  if (typeof content.aboutCopy === "string") document.querySelector("#about-copy").textContent = content.aboutCopy;
  if (Array.isArray(content.heroSlides) && content.heroSlides.length) setSlides(content.heroSlides);
  if (Array.isArray(content.benefits) && content.benefits.length) renderBenefits(content.benefits);
}

setSlides(slides);
renderBenefits(fallbackContent.benefits);
restartSlideTimer();
document.querySelector("#year").textContent = new Date().getFullYear();

fetch("/api/content")
  .then((response) => response.ok ? response.json() : Promise.reject(new Error("Could not load site content")))
  .then(applyContent)
  .catch((error) => console.error("Using default site content:", error));

function renderGallery(photos) {
  const grid = document.querySelector("#homepage-gallery");
  const empty = document.querySelector("#homepage-gallery-empty");
  const recentPhotos = photos.slice(0, 3);
  grid.classList.toggle("single-photo", recentPhotos.length === 1);
  grid.replaceChildren(...recentPhotos.map((photo, index) => {
    const figure = document.createElement("figure");
    figure.tabIndex = 0;
    if (index === 0) figure.className = "gallery-main";
    const media = document.createElement(photo.mediaType === "video" ? "video" : "img");
    media.src = photo.src;
    if (photo.mediaType === "video") {
      media.controls = true;
      media.preload = "metadata";
      media.playsInline = true;
      media.setAttribute("aria-label", photo.alt);
    } else {
      media.alt = photo.alt;
      media.loading = "lazy";
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
  empty.hidden = photos.length > 0;
}

fetch("/api/gallery")
  .then((response) => response.ok ? response.json() : Promise.reject(new Error("Could not load gallery photos")))
  .then((result) => renderGallery(Array.isArray(result.photos) ? result.photos : []))
  .catch((error) => {
    console.error("Could not load gallery photos:", error);
    document.querySelector("#homepage-gallery-empty").textContent = "The gallery is temporarily unavailable. Please try again later.";
  });

document.querySelector("#slide-prev").addEventListener("click", () => { renderSlide(currentSlide - 1); restartSlideTimer(); });
document.querySelector("#slide-next").addEventListener("click", () => { renderSlide(currentSlide + 1); restartSlideTimer(); });

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

document.querySelector("#inquiry-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const feedback = document.querySelector("#form-feedback");
  const button = form.querySelector('button[type="submit"]');
  feedback.textContent = "";
  feedback.classList.remove("error");
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  const data = Object.fromEntries(new FormData(form).entries());
  try {
    const response = await fetch("/api/inquiries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "We couldn't send your inquiry. Please try again.");
    form.reset();
    feedback.textContent = result.emailStatus === "sent"
      ? "Thanks — your inquiry has been emailed to our team."
      : result.emailStatus === "logged"
        ? "Your inquiry was saved. Email delivery is mocked; a preview was written to the server console."
      : result.emailStatus === "not_configured"
        ? "Your inquiry was saved, but email notifications are not configured yet."
        : result.emailStatus === "failed"
          ? "Your inquiry was saved, but the email notification could not be sent. Please contact us directly."
          : result.notification === "sent"
            ? "Thanks — your message is on its way. We’ll be in touch soon."
            : "Thanks — your inquiry has been received. Our team will be in touch soon.";
  } catch (error) {
    feedback.textContent = error.message || "Something went wrong. Please try again.";
    feedback.classList.add("error");
  } finally {
    button.disabled = false;
    button.removeAttribute("aria-busy");
  }
});
