(function (global) {
  "use strict";

  const MIN_DISPLAY_MS = 1400;
  const FADE_MS = 350;
  const NAV_FLAG = "kw_ocean_nav";

  let loaderEl = null;
  let pageStart = Date.now();
  let hideScheduled = false;
  let internalNavigation = false;

  function ensureLoader() {
    if (loaderEl) return loaderEl;

    loaderEl = document.createElement("div");
    loaderEl.id = "kw-ocean-loader";
    loaderEl.setAttribute("role", "status");
    loaderEl.setAttribute("aria-live", "polite");
    loaderEl.setAttribute("aria-label", "Sayfa yükleniyor");
    loaderEl.innerHTML = `
      <div class="kw-loader-backdrop">
        <div class="kw-loader-wave wave-1"></div>
        <div class="kw-loader-wave wave-2"></div>
        <div class="kw-loader-wave wave-3"></div>
        <span class="kw-loader-bubble"></span>
        <span class="kw-loader-bubble"></span>
        <span class="kw-loader-bubble"></span>
        <span class="kw-loader-bubble"></span>
        <span class="kw-loader-bubble"></span>
      </div>
      <div class="kw-loader-panel">
        <div class="kw-loader-icon">🌊</div>
        <h2 class="kw-loader-title">Kelime Okyanusu</h2>
        <p class="kw-loader-subtitle">Dalgalar yükleniyor...</p>
        <div class="kw-loader-progress" aria-hidden="true">
          <div class="kw-loader-progress-bar"></div>
        </div>
      </div>
    `;

    const mount = function () {
      if (!loaderEl.parentNode) {
        (document.body || document.documentElement).appendChild(loaderEl);
      }
    };

    if (document.body) mount();
    else document.addEventListener("DOMContentLoaded", mount, { once: true });

    return loaderEl;
  }

  function showLoader(message) {
    ensureLoader();
    const subtitle = loaderEl.querySelector(".kw-loader-subtitle");
    if (subtitle && message) subtitle.textContent = message;
    document.documentElement.classList.add("kw-loading-active");
    loaderEl.classList.remove("is-hiding");
    loaderEl.classList.add("is-visible");
  }

  function hideLoader() {
    if (!loaderEl) return;
    loaderEl.classList.add("is-hiding");
    loaderEl.classList.remove("is-visible");
    document.documentElement.classList.remove("kw-loading-active");
    window.setTimeout(function () {
      if (loaderEl) loaderEl.classList.remove("is-hiding");
    }, FADE_MS);
  }

  function scheduleHideAfterLoad() {
    if (hideScheduled) return;
    hideScheduled = true;

    function finish() {
      const elapsed = Date.now() - pageStart;
      const remaining = Math.max(0, MIN_DISPLAY_MS - elapsed);
      window.setTimeout(hideLoader, remaining);
    }

    if (document.readyState === "complete") {
      finish();
      return;
    }

    window.addEventListener("load", finish, { once: true });
  }

  function markNavigation() {
    try {
      sessionStorage.setItem(NAV_FLAG, String(Date.now()));
    } catch (error) {
      /* ignore */
    }
  }

  function navigateTo(url, replace) {
  const target = String(url || "").trim();
  if (!target) return;

  markNavigation(); 

  showLoader("Rotaya geçiliyor...");

  setTimeout(() => {
    if (replace) {
      location.replace(target);
    } else {
      location.href = target;
    }
  }, 250);
}

  function shouldHandleLink(link) {
    if (!link || !link.getAttribute) return false;
    if (link.target === "_blank" || link.hasAttribute("download")) return false;

    const href = link.getAttribute("href");
    if (!href) return false;
    if (
      href.startsWith("#") ||
      href.startsWith("javascript:") ||
      href.startsWith("mailto:") ||
      href.startsWith("tel:")
    ) {
      return false;
    }

    try {
      const nextUrl = new URL(link.href, global.location.href);
      return nextUrl.origin === global.location.origin;
    } catch (error) {
      return false;
    }
  }

  function installNavigationHooks() {
    document.addEventListener(
      "click",
      function (event) {
        if (event.defaultPrevented) return;
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
          return;
        }

        const link = event.target.closest("a[href]");
        if (!shouldHandleLink(link)) return;

        event.preventDefault();
        navigateTo(link.href, false);
      },
      true
    );

    const locationProto = global.Location.prototype;
    const nativeAssign = locationProto.assign;
    const nativeReplace = locationProto.replace;

    locationProto.assign = function assignWithLoader(url) {
      if (internalNavigation) {
        internalNavigation = false;
        return nativeAssign.call(this, url);
      }
      navigateTo(url, false);
    };

    locationProto.replace = function replaceWithLoader(url) {
      if (internalNavigation) {
        internalNavigation = false;
        return nativeReplace.call(this, url);
      }
      navigateTo(url, true);
    };

   
  }

  pageStart = Date.now();
  try {
    if (sessionStorage.getItem(NAV_FLAG)) {
      sessionStorage.removeItem(NAV_FLAG);
    }
  } catch (error) {
    /* ignore */
  }

  showLoader("Dalgalar yükleniyor...");
  scheduleHideAfterLoad();

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", installNavigationHooks, { once: true });
  } else {
    installNavigationHooks();
  }
window.addEventListener("pageshow", function () {
  hideLoader();
});
window.addEventListener("popstate", function () {
  hideLoader();
});
  global.kwNavigate = navigateTo;
  global.kwShowLoader = showLoader;
  global.kwHideLoader = hideLoader;
})(window);
