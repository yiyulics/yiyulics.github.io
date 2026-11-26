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

  /* ---- Email, and the terminal that prints it ----
     The address is not written in the page source. profile.yml holds it encoded
     (scripts/encode_email.py) and it is decoded here, into this script only. The contact section
     is a small terminal whose command line starts with the command that prints the address: the
     address in base64, piped to a decoder. The visitor runs it with "Show email" or Enter, and
     may type other commands instead. Once a command has printed the address, the email and copy
     buttons appear. */
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
    const body = part("body");
    const log = part("log");
    const input = part("input");
    const field = part("field");
    const run = part("run");
    const link = term.querySelector("[data-mail]");
    const toBase64 = (text) => btoa(Array.from(new TextEncoder().encode(text), (byte) => String.fromCharCode(byte)).join(""));
    const fromBase64 = (code) => new TextDecoder().decode(Uint8Array.from(atob(code), (char) => char.charCodeAt(0)));
    const script = `echo ${toBase64(mailAddress)} | base64 -d`;
    const coarse = window.matchMedia("(pointer: coarse)").matches;

    /* -- the shell: a handful of commands, and pipes between them -- */
    // split on spaces, keeping quoted text together; a bare | separates the commands of a pipe
    const parse = (line) => {
      const stages = [[]];
      const pattern = /"([^"]*)"|'([^']*)'|(\|)|([^\s|"']+)/g;
      let match;
      while ((match = pattern.exec(line))) {
        if (match[3]) stages.push([]);
        else stages[stages.length - 1].push(match[1] ?? match[2] ?? match[4]);
      }
      return stages;
    };

    const files = () => ["contact.sh"].concat(term.dataset.cv ? ["cv.pdf"] : []);
    const commands = {
      help: () => [
        "./contact.sh    print my email address",
        ...(term.dataset.cv ? ["open cv.pdf     open my CV"] : []),
        "whoami  ls  cat  echo  base64  clear",
      ].join("\n"),
      echo: (args) => (args[0] === "-n" ? args.slice(1).join(" ") : `${args.join(" ")}\n`),
      base64: (args, stdin) => {
        if (stdin === null) throw new Error("usage: echo <text> | base64 [-d]");
        if (!args.some((arg) => ["-d", "-D", "--decode"].includes(arg))) return `${toBase64(stdin)}\n`;
        try {
          return fromBase64(stdin.replace(/\s+/g, ""));
        } catch (error) {
          throw new Error("base64: invalid input");
        }
      },
      whoami: () => term.dataset.who,
      ls: () => files().join("  "),
      cat: (args) => {
        if (!args.length) throw new Error("usage: cat <file>");
        return args
          .map((name) => {
            const file = name.replace(/^\.\//, "");
            if (file === "contact.sh") return script;
            if (file === "cv.pdf" && term.dataset.cv) return "cat: cv.pdf is a PDF; try: open cv.pdf";
            throw new Error(`cat: ${name}: No such file or directory`);
          })
          .join("\n");
      },
      open: (args) => {
        const file = (args[0] || "").replace(/^\.\//, "");
        if (file !== "cv.pdf" || !term.dataset.cv) throw new Error(args[0] ? `open: ${args[0]}: No such file or directory` : "usage: open cv.pdf");
        window.open(term.dataset.cv, "_blank", "noopener");
        return "opening cv.pdf";
      },
      "./contact.sh": () => mailAddress,
      email: () => mailAddress,
    };
    ["sh", "bash", "zsh"].forEach((name) => {
      commands[name] = (args) => {
        if ((args[0] || "").replace(/^\.\//, "") === "contact.sh") return mailAddress;
        throw new Error(`${name}: ${args[0] || "missing script"}: No such file or directory`);
      };
    });

    // returns the text the line prints, or null when it prints nothing
    const evaluate = (line) => {
      let stream = null;
      for (const [name, ...args] of parse(line)) {
        if (!name) throw new Error("zsh: parse error near `|'");
        if (!Object.hasOwn(commands, name)) throw new Error(`zsh: command not found: ${name}`);
        stream = commands[name](args, stream);
      }
      return stream;
    };

    /* -- the screen -- */
    const print = (text, kind) => {
      const row = document.createElement("p");
      if (kind) row.className = `term__${kind}`;
      row.textContent = text;
      log.append(row);
      while (log.childElementCount > 60) log.firstElementChild.remove();
    };
    // the command line grows with what is typed; on touch screens it is drawn at 16px and scaled
    // down (see .term__input), so its box is measured rather than assumed
    const fit = () => {
      input.style.height = "auto";
      input.style.height = `${input.scrollHeight}px`;
      field.style.height = `${input.getBoundingClientRect().height}px`;
      body.scrollTop = body.scrollHeight;
    };

    let revealed = false;
    const reveal = () => {
      if (revealed) return;
      revealed = true;
      run.hidden = true;
      part("hint").hidden = true;
      link.href = `mailto:${mailAddress}`;
      link.hidden = false;
      term.querySelector("[data-copy-mail]").hidden = false;
      term.classList.add("is-done");
    };

    const past = [];
    let at = 0;
    let draft = ""; // what was being typed when the visitor started going back through the history
    const execute = (line) => {
      const text = line.trim();
      const prompt = document.createElement("p");
      const sign = document.createElement("span");
      sign.className = "term__prompt";
      sign.textContent = "$";
      prompt.append(sign, ` ${text}`);
      log.append(prompt);
      if (text) {
        if (past[past.length - 1] !== text) past.push(text);
        if (/^clear$/.test(text)) {
          log.replaceChildren();
        } else {
          try {
            const output = evaluate(text);
            if (output !== null && output !== "") {
              const shown = output.replace(/\n$/, "");
              const isMail = shown.trim() === mailAddress;
              print(shown, isMail ? "out" : "text");
              if (isMail) reveal();
            }
          } catch (error) {
            print(error.message, "error");
            if (/command not found/.test(error.message) && !revealed) print("try: help", "note");
          }
        }
      }
      at = past.length;
      draft = "";
      input.value = "";
      fit();
    };

    input.value = script;
    term.hidden = false;
    fit();
    new ResizeObserver(fit).observe(term);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);

    input.addEventListener("input", fit);
    input.addEventListener("keydown", (event) => {
      if (event.isComposing) return;
      if (event.key === "Enter") {
        event.preventDefault();
        execute(input.value);
      } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        if (!past.length) return;
        event.preventDefault();
        if (at === past.length) draft = input.value;
        at = Math.max(0, Math.min(past.length, at + (event.key === "ArrowUp" ? -1 : 1)));
        input.value = at < past.length ? past[at] : draft;
        fit();
      } else if (event.key === "l" && event.ctrlKey) {
        event.preventDefault();
        log.replaceChildren();
        fit();
      }
    });

    // the button runs the command that prints the address, whatever is on the command line
    const showEmail = () => {
      const hadFocus = term.contains(document.activeElement);
      execute(script);
      if (hadFocus) link.focus({ preventScroll: true });
    };
    run.addEventListener("click", showEmail);

    // While the command line still holds the prefilled command, taking the keyboard selects all of
    // it: Enter runs it as it is, and typing anything (help, say) replaces it instead of adding to it.
    const untouched = () => !past.length && input.value === script;
    input.addEventListener("focus", () => {
      if (untouched()) setTimeout(() => untouched() && document.activeElement === input && input.select(), 0);
    });
    // a click on the terminal puts the keyboard in it, as in a real one
    const caretToEnd = () => {
      if (!untouched()) input.setSelectionRange(input.value.length, input.value.length);
    };
    body.addEventListener("click", (event) => {
      if (event.target === input || String(window.getSelection())) return;
      input.focus({ preventScroll: true });
      caretToEnd();
    });
    // A link to the contact section hands the keyboard to the terminal, so that Enter runs it.
    // On a touch screen that goes to the button: focusing the command line would raise the keyboard.
    const arrive = () => {
      if (window.location.hash !== "#contact") return;
      if (coarse) {
        if (!revealed) run.focus({ preventScroll: true });
      } else {
        input.focus({ preventScroll: true });
        caretToEnd();
      }
    };
    window.addEventListener("hashchange", arrive);
    document.addEventListener("click", (event) => {
      const anchor = event.target.closest('a[href$="#contact"]');
      if (anchor && !term.contains(anchor)) setTimeout(arrive, 0);
    });
    arrive();
    // Enter also shows the address when nothing else has the keyboard and the terminal is in view
    document.addEventListener("keydown", (event) => {
      if (revealed || event.key !== "Enter" || event.defaultPrevented || event.repeat) return;
      const active = document.activeElement;
      if (active && active !== document.body && active !== document.documentElement) return;
      const box = term.getBoundingClientRect();
      const middle = (box.top + box.bottom) / 2;
      if (middle < 0 || middle > window.innerHeight) return;
      event.preventDefault();
      showEmail();
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
