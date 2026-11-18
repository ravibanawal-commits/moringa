const conversation = document.querySelector("#chat-messages");
const chatForm = document.querySelector("#chat-form");
const chatInput = document.querySelector("#chat-input");

function addMessage(text, role, link) {
  const message = document.createElement("article");
  message.className = "chat-message";
  message.dataset.role = role;

  const bubble = document.createElement("div");
  bubble.className = "chat-bubble";
  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  bubble.append(paragraph);

  if (link) {
    const anchor = document.createElement("a");
    anchor.className = "chat-message-link";
    anchor.href = link.href;
    anchor.textContent = link.label;
    bubble.append(anchor);
  }

  message.append(bubble);
  conversation.append(message);
  conversation.scrollTop = conversation.scrollHeight;
}

function getAnswer(question) {
  const text = question.toLowerCase();

  if (/^(hi|hello|hey|namaste|namaskar)\b/.test(text) || /^(नमस्ते|नमस्कार)/.test(text)) {
    return { text: "Hello! I can help with information about our orchard, moringa, and gallery. What are you curious about?" };
  }
  if (/(visit|tour|location|address|hours|opening|where|when can i come|पता|कहाँ|आना|समय|मुलाकात)/i.test(text)) {
    return {
      text: "I don't have current visitor hours or location details. Please contact our team to arrange a visit.",
      link: { href: "/#contact", label: "Send an inquiry" }
    };
  }
  if (/(gallery|photo|picture|image|photos|तस्वीर|फोटो|चित्र)/i.test(text)) {
    return {
      text: "You can explore moments from the orchard in our photo gallery.",
      link: { href: "/gallery", label: "Explore the gallery" }
    };
  }
  if (/(moringa|leaf|leaves|tea|smoothie|benefit|health|medicine|मोरिंगा|पत्ती|पत्ते|फायदे|स्वास्थ्य|दवा)/i.test(text)) {
    return {
      text: "Moringa leaves are often enjoyed fresh or dried in meals, soups, smoothies, or tea. Moringa is food, not medicine; enjoy it as part of a varied diet."
    };
  }
  if (/(orchard|farm|family|grow|growing|about|मोरिंगा ग्रोव|बाग|खेत|खेती|परिवार)/i.test(text)) {
    return {
      text: "Moringa Grove is a family-grown orchard rooted in healthy soil, patient care, and respect for the seasons."
    };
  }
  if (/(contact|inquiry|email|message|partnership|buy|price|order|संपर्क|पूछ|ईमेल|कीमत|खरीद)/i.test(text)) {
    return {
      text: "For personal questions, partnerships, or other details, send a message to the orchard team.",
      link: { href: "/#contact", label: "Contact the team" }
    };
  }
  return {
    text: "I don't have that detail available yet. You can ask about moringa, the orchard, or the gallery, or contact our team.",
    link: { href: "/#contact", label: "Contact the team" }
  };
}

function submitQuestion(question) {
  const text = question.trim();
  if (!text) return;
  addMessage(text, "user");
  const answer = getAnswer(text);
  addMessage(answer.text, "assistant", answer.link);
  chatInput.value = "";
  chatInput.focus();
}

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  submitQuestion(chatInput.value);
});

document.querySelectorAll(".chat-suggestions [data-question]").forEach((button) => {
  button.addEventListener("click", () => submitQuestion(button.dataset.question));
});

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

document.querySelector("#year").textContent = new Date().getFullYear();
