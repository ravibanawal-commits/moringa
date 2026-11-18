(() => {
const assistantWidget = document.createElement("a");
assistantWidget.className = "assistant-widget";
assistantWidget.href = "/ask";
assistantWidget.setAttribute("aria-label", "Open the Moringa Grove assistant");
assistantWidget.innerHTML = `
  <span class="assistant-widget-avatar" aria-hidden="true">
    <img class="assistant-widget-image" src="/assistant-avatar.avif" alt="" width="68" height="68">
  </span>
`;

if (!document.querySelector("#chat-input")) document.body.append(assistantWidget);
})();
