/* Progressive enhancements only: the page is complete without this script. */
(() => {
  "use strict";

  const root = document.documentElement;
  const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  /* ---- Theme toggle: follows the system until the visitor picks a theme ---- */
  const toggle = document.querySelector("[data-theme-toggle]");
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)");
  const themeColor = document.querySelector('meta[name="theme-color"]');
  const currentTheme = () => root.dataset.theme || (systemDark.matches ? "dark" : "light");

  const paintTheme = () => {
    const theme = currentTheme();
    if (toggle) {
      toggle.dataset.mode = theme;
      toggle.setAttribute("aria-pressed", String(theme === "dark"));
    }
    if (themeColor) themeColor.content = getComputedStyle(root).getPropertyValue("--bg").trim();
  };

  if (toggle) {
    toggle.hidden = false;
    toggle.addEventListener("click", () => {
      const next = currentTheme() === "dark" ? "light" : "dark";
      const apply = () => {
        root.dataset.theme = next;
        paintTheme();
      };
      // where the browser can, the two themes cross-fade instead of snapping
      if (document.startViewTransition && !reducedMotion.matches) document.startViewTransition(apply);
      else apply();
      try {
        localStorage.setItem("theme", next);
      } catch (error) {
        /* private mode: the choice just won't persist */
      }
    });
  }
  systemDark.addEventListener("change", paintTheme);
  paintTheme();

  /* ---- External links and PDFs open in a new tab ---- */
  $$("a[href]").forEach((link) => {
    const external = link.protocol.startsWith("http") && link.host !== window.location.host;
    if (external || link.pathname.endsWith(".pdf")) {
      link.target = "_blank";
      link.rel = "noopener";
    }
  });

  /* ---- Top bar: hairline once the page is scrolled, current section in the nav ---- */
  const topbar = document.querySelector(".topbar");
  const navBar = document.querySelector(".nav");
  const navLinks = $$(".nav a").filter(
    (link) => link.pathname === window.location.pathname && document.getElementById(link.hash.slice(1))
  );
  const sections = navLinks.map((link) => document.getElementById(link.hash.slice(1)));
  let active = -2;
  let queued = false;

  const updateNavFade = () => {
    if (!navBar) return;
    const maxScroll = navBar.scrollWidth - navBar.clientWidth;
    const overflow = maxScroll > 1;
    navBar.classList.toggle("is-fade-left", overflow && navBar.scrollLeft > 2);
    navBar.classList.toggle("is-fade-right", overflow && maxScroll - navBar.scrollLeft > 2);
  };
  if (navBar) navBar.addEventListener("scroll", updateNavFade, { passive: true });

  const onScroll = () => {
    queued = false;
    if (topbar) topbar.classList.toggle("is-stuck", window.scrollY > 4);
    updateNavFade();
    if (!sections.length) return;

    const line = window.innerHeight * 0.35;
    let index = -1;
    sections.forEach((section, i) => {
      if (section.getBoundingClientRect().top <= line) index = i;
    });
    if (window.innerHeight + window.scrollY >= root.scrollHeight - 4) index = sections.length - 1;
    if (index === active) return;
    active = index;

    // keep the current link in view when the nav itself scrolls (narrow screens)
    const scrollable = navBar && navBar.scrollWidth > navBar.clientWidth + 1;
    if (scrollable && index < 0) navBar.scrollTo({ left: 0, behavior: "smooth" });

    navLinks.forEach((link, i) => {
      if (i !== index) return link.removeAttribute("aria-current");
      link.setAttribute("aria-current", "true");
      if (scrollable) {
        navBar.scrollTo({ left: link.offsetLeft - navBar.clientWidth / 2 + link.offsetWidth / 2, behavior: "smooth" });
      }
    });
  };

  const schedule = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(onScroll);
  };
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule);
  onScroll();

  /* ---- Blocks below the fold ease in as they are scrolled to ----
     Only what is off screen when the page loads is touched, so nothing that is already
     visible flickers, and without this script nothing is ever hidden. */
  if (!reducedMotion.matches && "IntersectionObserver" in window) {
    const revealEls = [];
    const arrive = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting && entry.boundingClientRect.top > 0) return; // still below
          entry.target.classList.add("is-in");
          arrive.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px 40px 0px" }
    );
    $$(".section__head, .about__main, .news, .theme__intro, .pub, .exploring, .job, .side, .duo > *, .contact").forEach((el) => {
      if (el.getBoundingClientRect().top < window.innerHeight + 40) return;
      el.classList.add("reveal");
      revealEls.push(el);
      arrive.observe(el);
    });
    const flushVisible = () => {
      const limit = window.innerHeight + 40;
      revealEls.forEach((el) => {
        if (!el.classList.contains("is-in") && el.getBoundingClientRect().top <= limit) {
          el.classList.add("is-in");
          arrive.unobserve(el);
        }
      });
    };
    window.addEventListener("hashchange", () => requestAnimationFrame(flushVisible));
  }

  /* ---- Paper figures open in place, over the page ---- */
  const figureLinks = $$("a.pub__media");
  if (figureLinks.length && typeof HTMLDialogElement === "function") {
    const box = document.createElement("dialog");
    box.className = "lightbox";
    box.innerHTML =
      '<figure><img alt="" decoding="async"><figcaption></figcaption></figure>' +
      '<button class="lightbox__close" type="button" aria-label="Close the figure">' +
      '<svg class="icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
      "</button>";
    const image = box.querySelector("img");
    const caption = box.querySelector("figcaption");
    document.body.append(box);

    image.addEventListener("load", () => box.classList.add("is-ready"));
    box.addEventListener("click", (event) => {
      if (!event.target.closest("img, figcaption")) box.close(); // the backdrop, or the close button
    });
    box.addEventListener("close", () => {
      box.classList.remove("is-ready");
      image.removeAttribute("src");
    });

    figureLinks.forEach((link) => {
      link.addEventListener("click", (event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; // a new tab was asked for
        event.preventDefault();
        const paper = link.closest(".pub");
        const title = paper && paper.querySelector(".pub__title");
        const thumb = link.querySelector("img");
        image.alt = thumb ? thumb.alt : "";
        caption.textContent = title ? title.textContent.trim() : "";
        box.setAttribute("aria-label", caption.textContent ? `Figure: ${caption.textContent}` : "Figure");
        image.src = link.href;
        box.showModal();
        if (image.complete && image.naturalWidth) box.classList.add("is-ready");
      });
    });
  }

  /* ---- Abstract / BibTeX panels ---- */
  $$("[data-toggle]").forEach((button) => {
    const panel = document.getElementById(button.dataset.toggle);
    if (!panel) return;
    button.hidden = false;
    button.addEventListener("click", () => {
      const open = button.getAttribute("aria-expanded") !== "true";
      // only one panel per paper at a time
      $$("[data-toggle]", button.closest(".pub")).forEach((other) => {
        const otherPanel = document.getElementById(other.dataset.toggle);
        const show = other === button && open;
        other.setAttribute("aria-expanded", String(show));
        if (otherPanel) otherPanel.hidden = !show;
      });
    });
  });

  /* ---- Email ----
     The address is not written in the page source. profile.yml holds it encoded
     (scripts/encode_email.py) and it is decoded here. The contact section shows a small terminal
     with a command already typed, the address in base64 piped to a decoder; the visitor runs it
     with Enter. Until then the address itself is in this script only; running the command prints
     it and shows the email and copy buttons. */
  const MAIL_KEY = "world.py";
  const mailAddress = (() => {
    try {
      const mixed = atob(document.body.dataset.mailCode || "");
      const bytes = Uint8Array.from(mixed, (char, i) => char.charCodeAt(0) ^ MAIL_KEY.charCodeAt(i % MAIL_KEY.length));
      const address = new TextDecoder().decode(bytes);
      return address.includes("@") ? address : "";
    } catch (error) {
      return "";
    }
  })();

  const term = document.querySelector("[data-term]");
  if (mailAddress && term) {
    const part = (name) => term.querySelector(`[data-term-${name}]`);
    const run = part("run");
    const link = term.querySelector("[data-mail]");
    part("code").textContent = btoa(String.fromCharCode(...new TextEncoder().encode(mailAddress)));
    term.hidden = false;

    let done = false;
    const execute = () => {
      if (done) return;
      done = true;
      const hadFocus = term.contains(document.activeElement);
      part("cursor").remove();
      part("out").textContent = mailAddress;
      part("out").hidden = false;
      part("next").hidden = false;
      run.hidden = true;
      part("hint").hidden = true;
      link.href = `mailto:${mailAddress}`;
      link.hidden = false;
      term.querySelector("[data-copy-mail]").hidden = false;
      term.classList.add("is-done");
      if (hadFocus) link.focus({ preventScroll: true });
    };

    run.addEventListener("click", execute);
    // a click on the terminal puts the keyboard in it, as in a real one
    term.addEventListener("click", (event) => {
      if (!done && !event.target.closest("button, a")) run.focus({ preventScroll: true });
    });
    // Enter also runs the command when nothing else has the keyboard and the terminal is in view
    document.addEventListener("keydown", (event) => {
      if (done || event.key !== "Enter" || event.defaultPrevented || event.repeat) return;
      const active = document.activeElement;
      if (active && active !== document.body && active !== document.documentElement) return;
      const box = term.getBoundingClientRect();
      const middle = (box.top + box.bottom) / 2;
      if (middle < 0 || middle > window.innerHeight) return;
      event.preventDefault();
      execute();
    });
  }

  /* ---- Copy buttons (BibTeX, email) ---- */
  const copyText = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      const area = document.createElement("textarea");
      area.value = text;
      area.setAttribute("readonly", "");
      area.style.cssText = "position:fixed;opacity:0";
      document.body.append(area);
      area.select();
      const ok = document.execCommand("copy");
      area.remove();
      return ok;
    }
  };

  $$("[data-copy]").forEach((button) => {
    // the email's copy button appears once the terminal has printed the address
    if (!("copyMail" in button.dataset)) button.hidden = false;
    const label = button.querySelector("[data-copy-label]");
    const original = label ? label.textContent : button.getAttribute("aria-label");
    const originalTitle = button.getAttribute("title");
    let timer;
    button.addEventListener("click", async () => {
      const ok = await copyText("copyMail" in button.dataset ? mailAddress : button.dataset.copy);
      const message = ok ? "Copied" : "Press Ctrl+C";
      if (label) label.textContent = message;
      else button.setAttribute("aria-label", message);
      if (originalTitle) button.setAttribute("title", message);
      button.dataset.copyStatus = message;
      button.classList.toggle("is-done", ok);
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (label) label.textContent = original;
        else button.setAttribute("aria-label", original);
        if (originalTitle) button.setAttribute("title", originalTitle);
        delete button.dataset.copyStatus;
        button.classList.remove("is-done");
      }, 1600);
    });
  });

  /* ---- Citation counts from OpenAlex ----
     One request covers every paper on the page. Without a key the API gives each visitor
     address a small daily allowance, so the counts are kept in the browser for a day, and
     older ones are reused if the request fails. */
  const CITES_KEY = "cites:openalex";
  const CITES_TTL = 24 * 60 * 60 * 1000;
  const perPaper = $$("[data-cites]");
  const works = [...new Set(perPaper.map((el) => el.dataset.cites))].filter((id) => /^W\d+$/.test(id));

  const showCites = (counts) => {
    perPaper.forEach((el) => {
      const count = Number(counts[el.dataset.cites]);
      if (!(count > 0)) return;
      el.textContent = `Cited by ${count}`;
      el.hidden = false;
    });
    const all = works.reduce((sum, id) => sum + (Number(counts[id]) || 0), 0);
    if (!(all > 0)) return;
    $$("[data-cites-total]").forEach((el) => {
      el.textContent = `${all} citations`;
      el.hidden = false;
    });
  };

  if (works.length) {
    (async () => {
      let saved = null;
      try {
        saved = JSON.parse(localStorage.getItem(CITES_KEY));
      } catch (error) {
        /* no storage, or nothing saved yet */
      }
      let counts = (saved && saved.counts) || {};
      const fresh = saved && Date.now() - saved.at < CITES_TTL && works.every((id) => id in counts);

      if (!fresh) {
        try {
          const response = await fetch(
            `https://api.openalex.org/works?filter=openalex:${works.join("|")}&select=id,cited_by_count&per-page=100`
          );
          if (response.ok) {
            const fetched = {};
            ((await response.json()).results || []).forEach((work) => {
              fetched[String(work.id).split("/").pop()] = Number(work.cited_by_count) || 0;
            });
            counts = Object.assign({}, counts, fetched);
            try {
              localStorage.setItem(CITES_KEY, JSON.stringify({ counts, at: Date.now() }));
            } catch (error) {
              /* the counts just won't be remembered */
            }
          }
        } catch (error) {
          /* offline or blocked: fall back to the saved counts, if any */
        }
      }
      showCites(counts);
    })();
  }

  /* ---- GitHub stars on code links (shown from 10 stars up) ----
     The public API allows 60 requests an hour per visitor address, so a count is kept in
     the browser for half a day, and an older one is reused if the request fails. */
  const MIN_STARS = 10;
  const STARS_TTL = 12 * 60 * 60 * 1000;
  const formatStars = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : String(n));

  const savedStars = (key) => {
    try {
      const saved = JSON.parse(localStorage.getItem(key));
      if (saved && Number.isFinite(saved.stars)) return saved;
    } catch (error) {
      /* no storage, or nothing saved yet */
    }
    return null;
  };

  $$("[data-stars]").forEach(async (el) => {
    const repo = el.dataset.stars;
    const key = `stars:${repo}`;
    const saved = savedStars(key);
    let stars = saved ? saved.stars : null;

    if (!saved || Date.now() - saved.at > STARS_TTL) {
      try {
        const response = await fetch(`https://api.github.com/repos/${repo}`, {
          headers: { Accept: "application/vnd.github+json" },
        });
        if (response.ok) {
          stars = Number((await response.json()).stargazers_count);
          try {
            localStorage.setItem(key, JSON.stringify({ stars, at: Date.now() }));
          } catch (error) {
            /* the count just won't be remembered */
          }
        }
      } catch (error) {
        /* offline or blocked: fall back to the saved count, if any */
      }
    }

    if (!(stars >= MIN_STARS)) return;
    el.querySelector("span").textContent = formatStars(stars);
    el.setAttribute("aria-label", `${stars} GitHub stars`);
    el.hidden = false;
  });
})();
