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
  const navLinks = $$(".nav a").filter(
    (link) => link.pathname === window.location.pathname && document.getElementById(link.hash.slice(1))
  );
  const sections = navLinks.map((link) => document.getElementById(link.hash.slice(1)));
  let active = -2;
  let queued = false;

  const onScroll = () => {
    queued = false;
    if (topbar) topbar.classList.toggle("is-stuck", window.scrollY > 4);
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
    const bar = document.querySelector(".nav");
    const scrollable = bar && bar.scrollWidth > bar.clientWidth;
    if (scrollable && index < 0) bar.scrollTo({ left: 0, behavior: "smooth" });

    navLinks.forEach((link, i) => {
      if (i !== index) return link.removeAttribute("aria-current");
      link.setAttribute("aria-current", "true");
      if (scrollable) {
        bar.scrollTo({ left: link.offsetLeft - bar.clientWidth / 2 + link.offsetWidth / 2, behavior: "smooth" });
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
    const arrive = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting && entry.boundingClientRect.top > 0) return; // still below
          entry.target.classList.add("is-in");
          arrive.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -8% 0px" }
    );
    $$(".section__head, .about__main, .news, .theme__intro, .pub, .exploring, .job, .side, .duo > *, .contact").forEach((el) => {
      if (el.getBoundingClientRect().top < window.innerHeight) return;
      el.classList.add("reveal");
      arrive.observe(el);
    });
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
    button.hidden = false;
    const label = button.querySelector("span");
    const original = label ? label.textContent : button.getAttribute("aria-label");
    let timer;
    button.addEventListener("click", async () => {
      const ok = await copyText(button.dataset.copy);
      const message = ok ? "Copied" : "Press Ctrl+C";
      if (label) label.textContent = message;
      else button.setAttribute("aria-label", message);
      button.classList.toggle("is-done", ok);
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (label) label.textContent = original;
        else button.setAttribute("aria-label", original);
        button.classList.remove("is-done");
      }, 1600);
    });
  });

  /* ---- Citation counts from the google-scholar-stats branch ---- */
  const statsUrl = document.body.dataset.scholarStats;
  const perPaper = $$("[data-cites]");
  const total = $$("[data-cites-total]");

  if (statsUrl && (perPaper.length || total.length)) {
    fetch(statsUrl)
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(response.status))))
      .then((stats) => {
        const publications = stats.publications || {};
        perPaper.forEach((el) => {
          const count = Number((publications[el.dataset.cites] || {}).num_citations);
          if (count > 0) {
            el.textContent = `Cited by ${count}`;
            el.hidden = false;
          }
        });
        const all = Number(stats.citedby);
        if (all > 0) {
          total.forEach((el) => {
            el.textContent = `${all} citations`;
            el.hidden = false;
          });
        }
      })
      .catch(() => {
        /* stats are optional; leave the counters hidden */
      });
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
