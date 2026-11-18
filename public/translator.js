(() => {
  const preferenceKey = "moringa-language";
  const excludedSelector = "script, style, noscript, textarea, select, option, svg, [aria-hidden='true'], .language-dropdown, .language-status";
  const translatableAttributes = ["alt", "aria-label", "title", "placeholder"];
  const originalText = new Map();
  const originalAttributes = new Map();
  let originalTitle = document.title;
  let originalDescription = document.querySelector('meta[name="description"]')?.content || "";
  let titleTranslated = false;
  let descriptionTranslated = false;
  let isHindi = false;
  let isTranslating = false;
  let pendingUpdate = false;
  let updateTimer;

  const languageDropdown = document.createElement("div");
  languageDropdown.className = "nav-dropdown language-dropdown";
  const languageToggle = document.createElement("button");
  languageToggle.className = "nav-dropdown-toggle language-dropdown-toggle";
  languageToggle.type = "button";
  languageToggle.setAttribute("aria-expanded", "false");
  languageToggle.setAttribute("aria-controls", "language-menu");
  languageToggle.setAttribute("aria-label", "Choose page language");
  languageToggle.innerHTML = 'Translate <span class="nav-dropdown-caret" aria-hidden="true"></span>';

  const languageMenu = document.createElement("div");
  languageMenu.className = "nav-dropdown-menu language-dropdown-menu";
  languageMenu.id = "language-menu";
  const hindiOption = document.createElement("button");
  hindiOption.className = "language-option";
  hindiOption.type = "button";
  hindiOption.textContent = "हिंदी";
  hindiOption.setAttribute("aria-label", "Translate this website to Hindi");
  const englishOption = document.createElement("button");
  englishOption.className = "language-option";
  englishOption.type = "button";
  englishOption.textContent = "English";
  englishOption.setAttribute("aria-label", "Show this website in English");
  languageMenu.append(hindiOption, englishOption);
  languageDropdown.append(languageToggle, languageMenu);

  const navigation = document.querySelector("#primary-nav");
  const header = document.querySelector(".admin-header");
  const headerActions = document.querySelector(".admin-header-actions");
  const headerLinks = document.querySelector(".gallery-header-links");
  if (navigation) {
    navigation.insertBefore(languageDropdown, navigation.querySelector('a[href^="/admin"]'));
  } else if (headerActions) {
    headerActions.insertBefore(languageDropdown, headerActions.firstElementChild);
  } else if (headerLinks) {
    headerLinks.insertBefore(languageDropdown, headerLinks.firstElementChild);
  } else {
    header.insertBefore(languageDropdown, header.querySelector(".back-link"));
  }

  const status = document.createElement("span");
  status.className = "language-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.hidden = true;
  document.body.append(status);

  function setLanguageMenuOpen(open) {
    languageDropdown.classList.toggle("is-open", open);
    languageToggle.setAttribute("aria-expanded", String(open));
  }

  function getPreference() {
    try {
      return localStorage.getItem(preferenceKey);
    } catch {
      return null;
    }
  }

  function savePreference(language) {
    try {
      localStorage.setItem(preferenceKey, language);
    } catch {
      // Translation still works for this page when browser storage is disabled.
    }
  }

  function setStatus(message) {
    status.textContent = message;
    status.hidden = !message;
  }

  function isExcluded(element) {
    return !element || Boolean(element.closest(excludedSelector));
  }

  function makeTarget(value, apply) {
    const leading = value.match(/^\s*/)[0];
    const trailing = value.match(/\s*$/)[0];
    const text = value.slice(leading.length, value.length - trailing.length);
    return {
      text,
      apply: (translated) => apply(`${leading}${translated}${trailing}`)
    };
  }

  function collectTargets() {
    const targets = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (isExcluded(node.parentElement) || !node.nodeValue.trim() || originalText.has(node)) continue;
      const textNode = node;
      const original = textNode.nodeValue;
      targets.push({
        ...makeTarget(original, (value) => { textNode.nodeValue = value; }),
        onTranslated: () => originalText.set(textNode, original)
      });
    }

    document.querySelectorAll("body *").forEach((element) => {
      if (isExcluded(element)) return;
      for (const attribute of translatableAttributes) {
        const value = element.getAttribute(attribute);
        if (!value || !value.trim()) continue;
        let originals = originalAttributes.get(element);
        if (!originals) {
          originals = new Map();
          originalAttributes.set(element, originals);
        }
        if (originals.has(attribute)) continue;
        targets.push({
          ...makeTarget(value, (translated) => element.setAttribute(attribute, translated)),
          onTranslated: () => originals.set(attribute, value)
        });
      }
    });

    if (!titleTranslated && originalTitle.trim()) {
      targets.push({
        text: originalTitle,
        apply: (translated) => { document.title = translated; },
        onTranslated: () => { titleTranslated = true; }
      });
    }

    const description = document.querySelector('meta[name="description"]');
    if (description && !descriptionTranslated && originalDescription.trim()) {
      targets.push({
        text: originalDescription,
        apply: (translated) => { description.content = translated; },
        onTranslated: () => { descriptionTranslated = true; }
      });
    }

    return targets.filter((target) => target.text);
  }

  async function translateTargets(targets) {
    async function requestBatch(batch) {
      let response;
      try {
        response = await fetch("/api/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ texts: batch.map((target) => target.text) })
        });
      } catch {
        throw new Error("Cannot reach the translation server. Check that the site is running and try again.");
      }

      let result;
      try {
        result = await response.json();
      } catch {
        throw new Error("The translation server returned an invalid response. Please restart the site and try again.");
      }

      if (!response.ok) {
        if (
          response.status === 400 &&
          /^Send up to \d+ short text items/i.test(result.error || "") &&
          batch.length > 1
        ) {
          const midpoint = Math.ceil(batch.length / 2);
          return [
            ...await requestBatch(batch.slice(0, midpoint)),
            ...await requestBatch(batch.slice(midpoint))
          ];
        }
        throw new Error(result.error || "The translation service could not complete this request. Please try again.");
      }
      if (!Array.isArray(result.texts) || result.texts.length !== batch.length) {
        throw new Error("The translation response was incomplete.");
      }
      return result.texts;
    }

    const translations = [];
    for (let start = 0; start < targets.length;) {
      const batch = [];
      let totalLength = 0;
      while (start < targets.length && batch.length < 40) {
        const nextLength = targets[start].text.length;
        if (batch.length && totalLength + nextLength > 2200) break;
        batch.push(targets[start]);
        totalLength += nextLength;
        start += 1;
      }

      translations.push(...await requestBatch(batch));
    }
    return translations;
  }

  function setLanguageOptionsState() {
    hindiOption.disabled = isTranslating;
    englishOption.disabled = isTranslating;
    hindiOption.setAttribute("aria-pressed", String(isHindi));
    englishOption.setAttribute("aria-pressed", String(!isHindi));
  }

  async function enableHindi(saveChoice = true) {
    if (isTranslating) return;
    isTranslating = true;
    setStatus("");
    setLanguageOptionsState();
    try {
      const targets = collectTargets();
      const translations = await translateTargets(targets);
      targets.forEach((target, index) => {
        target.apply(translations[index]);
        target.onTranslated();
      });
      isHindi = true;
      document.documentElement.lang = "hi";
      if (saveChoice) savePreference("hi");
    } catch (error) {
      isHindi = false;
      document.documentElement.lang = "en";
      savePreference("en");
      setStatus(error.message || "The translation service could not complete this request. Please try again.");
    } finally {
      isTranslating = false;
      setLanguageOptionsState();
      if (isHindi) scheduleNewContent();
    }
  }

  function restoreEnglish() {
    originalText.forEach((value, node) => {
      if (node.isConnected) node.nodeValue = value;
    });
    originalText.clear();
    originalAttributes.forEach((attributes, element) => {
      if (!element.isConnected) return;
      attributes.forEach((value, name) => element.setAttribute(name, value));
    });
    originalAttributes.clear();
    if (titleTranslated) document.title = originalTitle;
    if (descriptionTranslated) {
      const description = document.querySelector('meta[name="description"]');
      if (description) description.content = originalDescription;
    }
    titleTranslated = false;
    descriptionTranslated = false;
    isHindi = false;
    document.documentElement.lang = "en";
    savePreference("en");
    setStatus("");
    setLanguageOptionsState();
  }

  function scheduleNewContent() {
    if (!isHindi) return;
    clearTimeout(updateTimer);
    updateTimer = setTimeout(async () => {
      if (isTranslating) {
        pendingUpdate = true;
        return;
      }
      const targets = collectTargets();
      if (!targets.length) return;
      isTranslating = true;
      setLanguageOptionsState();
      try {
        const translations = await translateTargets(targets);
        targets.forEach((target, index) => {
          target.apply(translations[index]);
          target.onTranslated();
        });
      } catch (error) {
        setStatus(error.message || "Hindi translation could not finish. Please try again.");
      } finally {
        isTranslating = false;
        setLanguageOptionsState();
        if (pendingUpdate) {
          pendingUpdate = false;
          scheduleNewContent();
        }
      }
    }, 120);
  }

  languageToggle.addEventListener("click", () => {
    setLanguageMenuOpen(languageToggle.getAttribute("aria-expanded") !== "true");
  });
  hindiOption.addEventListener("click", () => {
    setLanguageMenuOpen(false);
    if (!isHindi) enableHindi();
  });
  englishOption.addEventListener("click", () => {
    setLanguageMenuOpen(false);
    if (isHindi) restoreEnglish();
    else {
      savePreference("en");
      setStatus("");
    }
  });
  document.addEventListener("click", (event) => {
    if (!languageDropdown.contains(event.target)) setLanguageMenuOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && languageToggle.getAttribute("aria-expanded") === "true") {
      setLanguageMenuOpen(false);
      languageToggle.focus();
    }
  });

  const observer = new MutationObserver(scheduleNewContent);
  observer.observe(document.body, { childList: true, subtree: true });

  setLanguageOptionsState();
  if (getPreference() === "hi") enableHindi(false);
})();
