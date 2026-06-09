// excalidraw-library-hook
// Detecta URLs de cenas (#room=ID,KEY ou #json=ID,KEY) e registra
// no excalidraw-library pra você poder reabrir depois.
(function () {
  var LIBRARY_API =
    "https://excalidraw-library.agenciabluediamond.com/api/drawings";
  var DEBOUNCE_MS = 1500;
  var lastSavedUrl = "";
  var timer = null;

  function isCollabUrl(hash) {
    return /^#(room|json)=[^,]+,/.test(hash || "");
  }

  function save() {
    var url = window.location.href;
    if (url === lastSavedUrl) return;
    if (!isCollabUrl(window.location.hash)) return;
    lastSavedUrl = url;

    fetch(LIBRARY_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: url,
        title: document.title.replace(/^Excalidraw.*?[-—|]\s*/i, "").trim() || null,
      }),
      credentials: "omit",
    }).catch(function () {
      // falha silenciosa: library indisponível não deve quebrar o app
    });
  }

  function debouncedSave() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, DEBOUNCE_MS);
  }

  window.addEventListener("hashchange", debouncedSave);
  window.addEventListener("load", debouncedSave);
  // fallback: às vezes o hash é setado via pushState/replaceState
  setTimeout(debouncedSave, 2000);
})();
