// excalidraw-library-hook
// Detecta URLs de cenas (#room=ID,KEY ou #json=ID,KEY) e registra
// no excalidraw-library.
(function () {
  var LIBRARY_API =
    "https://excalidraw-library.agenciabluediamond.com/api/drawings";
  var TAG = "[excalidraw-library-hook]";
  var lastSavedUrl = "";

  function log() {
    try {
      var a = Array.prototype.slice.call(arguments);
      a.unshift(TAG);
      console.log.apply(console, a);
    } catch (e) {}
  }

  function isCollabUrl(hash) {
    return /^#(room|json)=[^,]+,.+/.test(hash || "");
  }

  function save(reason) {
    var url = window.location.href;
    if (url === lastSavedUrl) return;
    if (!isCollabUrl(window.location.hash)) return;
    lastSavedUrl = url;
    log("saving via", reason, "url=", url);

    fetch(LIBRARY_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: url,
        title:
          (document.title || "")
            .replace(/^Excalidraw.*?[-—|]\s*/i, "")
            .trim() || null,
      }),
      credentials: "omit",
    })
      .then(function (r) {
        log("POST status", r.status);
      })
      .catch(function (e) {
        log("POST failed", e);
      });
  }

  // 1. hashchange (caso clássico)
  window.addEventListener("hashchange", function () {
    save("hashchange");
  });

  // 2. monkey-patch em history.{push,replace}State (Excalidraw usa replaceState)
  ["pushState", "replaceState"].forEach(function (m) {
    var orig = history[m];
    if (!orig) return;
    history[m] = function () {
      var ret = orig.apply(this, arguments);
      setTimeout(function () {
        save("history." + m);
      }, 50);
      return ret;
    };
  });

  // 3. polling: a cada 1.5s, se o hash bateu, salva (cobre qualquer caso)
  setInterval(function () {
    save("poll");
  }, 1500);

  // 4. ao load
  window.addEventListener("load", function () {
    save("load");
  });

  log("installed");
})();
