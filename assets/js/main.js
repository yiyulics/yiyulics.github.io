/* Progressive enhancements only: the page is complete without this script. */
(() => {
  "use strict";

  const root = document.documentElement;

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
      root.dataset.theme = next;
      try {
        localStorage.setItem("theme", next);
      } catch (error) {
        /* private mode: the choice just won't persist */
      }
      paintTheme();
    });
  }
  systemDark.addEventListener("change", paintTheme);
  paintTheme();

  /* ---- External links open in a new tab ---- */
  document.querySelectorAll("a[href]").forEach((link) => {
    const external = link.protocol.startsWith("http") && link.host !== window.location.host;
    if (external || link.pathname.endsWith(".pdf")) {
      link.target = "_blank";
      link.rel = "noopener";
    }
  });

  /* ---- Highlight the section being read in the navigation ---- */
  const navLinks = Array.from(document.querySelectorAll(".toc a")).filter(
    (link) => link.pathname === window.location.pathname && document.getElementById(link.hash.slice(1))
  );
  const sections = navLinks.map((link) => document.getElementById(link.hash.slice(1)));

  if (sections.length) {
    let active = null;
    let queued = false;

    const update = () => {
      queued = false;
      const line = window.innerHeight * 0.35;
      let index = 0;
      sections.forEach((section, i) => {
        if (section.getBoundingClientRect().top <= line) index = i;
      });
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
      if (atBottom) index = sections.length - 1;
      if (index === active) return;
      active = index;
      navLinks.forEach((link, i) => {
        if (i === index) {
          link.setAttribute("aria-current", "true");
          const bar = link.closest(".toc");
          if (bar && bar.scrollWidth > bar.clientWidth) {
            bar.scrollTo({ left: link.offsetLeft - bar.clientWidth / 2 + link.offsetWidth / 2, behavior: "smooth" });
          }
        } else {
          link.removeAttribute("aria-current");
        }
      });
    };

    const schedule = () => {
      if (!queued) {
        queued = true;
        requestAnimationFrame(update);
      }
    };
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    update();
  }

  /* ---- Citation counts from the google-scholar-stats branch ---- */
  const statsUrl = document.body.dataset.scholarStats;
  const perPaper = document.querySelectorAll("[data-cites]");
  const total = document.querySelectorAll("[data-cites-total]");

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
})();
