/* Kintsugi: replies (swipe on a phone), pinned messages, what an agent remembers, dropping or pasting files, choosing a model from
   the list your key allows, and keyboard shortcuts. Loaded after app.js and extras.js; it wraps their functions the same way extras.js does. */

/* ---------- reply to a message ---------- */
// A reply is an ordinary message that starts with a one-line quote, so agents, exports and older screens all read it as text.
const QUOTE_RE = /^(@[a-z0-9_-]+\s+)?> ↩ \*\*([^*\n]{1,40})\*\*: ([^\n]{0,200})\n\n([\s\S]*)$/;
function quoteText(m) {
  const plain = m.text.replace(QUOTE_RE, "$4")
    .replace(/```[\s\S]*?(```|$)/g, " [code] ")            // code blocks
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")             // links and images: keep the words
    .replace(/<[^>]{1,200}>/g, " ")                          // tags
    .replace(/^\s*(?:[-*+]|\d+\.)\s+/gm, "")                 // list markers
    .replace(/[*_`>#~|]+/g, " ").replace(/\s+/g, " ").trim();
  return plain.length > 140 ? plain.slice(0, 139) + "…" : plain;
}
function startReply(m) {
  S.replyTo = {id: m.id, room: S.room, sender: m.sender === me().name ? "you" : m.sender, text: quoteText(m)};
  renderReplyBar();
  const ta = $("#msg"); if (ta) ta.focus();
}
function renderReplyBar() {
  let bar = $("#reply-bar");
  const box = document.querySelector("#composer-wrap .box"); if (!box) return;
  if (!bar) { bar = h("div", {id: "reply-bar", role: "status"}); box.before(bar); }
  if (!S.replyTo || S.replyTo.room !== S.room) { bar.hidden = true; fill(bar); return; }
  bar.hidden = false;
  fill(bar, h("span", {class: "rb-text"}, "↩ Replying to ", h("strong", {}, S.replyTo.sender), ": " + S.replyTo.text),
    h("button", {class: "mini", "aria-label": "Cancel reply", onclick: () => { S.replyTo = null; renderReplyBar(); }}, "✕"));
}
const _sendMsgBeforeReply = sendMsg;
sendMsg = async function () {
  const ta = $("#msg");
  if (S.replyTo && S.replyTo.room === S.room && ta && ta.value.trim() && !ta.value.trim().startsWith("/")) {
    const r = S.replyTo;
    ta.value = "> ↩ **" + r.sender + "**: " + r.text + "\n\n" + ta.value.trim();
    S.replyTo = null; renderReplyBar();
  }
  return _sendMsgBeforeReply();
};
function quoteBlock(sender, text) {
  return h("div", {class: "quote"}, h("strong", {}, "↩ " + sender), " " + text);
}

/* ---------- message buttons: reply and pin; on a phone the rarer ones move into "More" ---------- */
const SECONDARY = ["Ask again", "Share this message to a room", "Delete this message", "Delete my message"];
const _bodyOfBeforeMore = bodyOf;
bodyOf = function (m) {
  const el = _bodyOfBeforeMore(m);
  if (!el.classList || !el.classList.contains("row")) return el;
  const q = m.text.match(QUOTE_RE);
  if (q) {  // show a reply's quote as a quote, not as raw markdown
    const target = el.querySelector(".bubble:not(.shared)") || el.querySelector(".body[style*='pre-wrap']");
    if (target) target.replaceChildren(quoteBlock(q[2], q[3]), document.createTextNode((q[1] || "") + q[4]));
  }
  const bar = el.querySelector(".msg-actions") || el.querySelector(".me-actions");
  if (!bar) return el;
  bar.querySelectorAll("button").forEach((b) => { if (SECONDARY.includes(b.getAttribute("aria-label"))) b.classList.add("sec"); });
  const pinned = isPinned(m.id);
  const pin = h("button", {class: "mini sec pin-btn" + (pinned ? " on" : ""), "aria-label": pinned ? "Unpin this message" : "Pin this message", onclick: () => togglePin(m)}, pinned ? "Unpin" : "Pin");
  const reply = h("button", {class: "mini", "aria-label": "Reply to this message", onclick: () => startReply(m)}, "Reply");
  const more = h("button", {class: "mini more-btn", "aria-label": "More actions", onclick: () => moreSheet(el, m)}, "More");
  bar.prepend(reply);
  const rate = bar.querySelector(".rate-group");
  if (rate) rate.before(pin); else bar.append(pin);
  bar.append(more);
  return el;
};
function moreSheet(row, m) {
  const items = [...row.querySelectorAll(".sec")].map((b) => h("button", {class: "item", onclick: () => { close(); b.click(); }}, h("span", {class: "t"}, b.textContent)));
  const close = dialog("Message", (m.sender === me().name ? "You" : m.sender) + ": " + quoteText(m).slice(0, 80), h("div", {class: "sheet-list"}, items),
    (c) => [h("button", {class: "btn", onclick: c}, "Close")]);
}

/* swipe a message to the right to reply (touch screens) */
(function swipeToReply() {
  let start = null, row = null;
  const thread = () => $("#thread");
  document.addEventListener("touchstart", (e) => {
    const r = e.target.closest && e.target.closest("#thread .row[data-mid]");
    if (!r || e.touches.length !== 1 || e.target.closest("pre, a, button, details")) { start = null; return; }
    start = {x: e.touches[0].clientX, y: e.touches[0].clientY, moved: false}; row = r;
  }, {passive: true});
  document.addEventListener("touchmove", (e) => {
    if (!start || !row) return;
    const dx = e.touches[0].clientX - start.x, dy = e.touches[0].clientY - start.y;
    if (!start.moved && Math.abs(dy) > 14) { start = null; row.style.transform = ""; return; }  // scrolling, not swiping
    if (dx > 8) { start.moved = true; row.style.transition = "none"; row.style.transform = "translateX(" + Math.min(dx, 72) + "px)"; row.classList.toggle("swipe-ready", dx > 60); }
  }, {passive: true});
  document.addEventListener("touchend", (e) => {
    if (!start || !row) return;
    const dx = (e.changedTouches[0] || {}).clientX - start.x, r = row;
    r.style.transition = "transform .18s"; r.style.transform = ""; r.classList.remove("swipe-ready");
    if (start.moved && dx > 60) {
      const id = +r.dataset.mid, m = (S.msgIndex || {})[id];
      if (m) { startReply(m); if (navigator.vibrate) try { navigator.vibrate(10); } catch (err) { /* ok */ } }
    }
    start = null; row = null;
  }, {passive: true});
  void thread;
})();
// remember the messages on screen by id, so a swipe can find the one under the finger
const _renderThreadBeforeIndex = renderThread;
renderThread = function (msgs) { S.msgIndex = S.msgIndex || {}; (msgs || []).forEach((m) => { S.msgIndex[m.id] = m; }); return _renderThreadBeforeIndex(msgs); };

/* ---------- pinned messages ---------- */
function isPinned(id) { return !!((S.pinned || {})[S.room] || new Set()).has(id); }
async function loadPins(room) {
  try { const list = await api("/api/pins?room=" + encodeURIComponent(room)); (S.pinList = S.pinList || {})[room] = list; (S.pinned = S.pinned || {})[room] = new Set(list.map((p) => p.id)); }
  catch (e) { /* the strip just stays as it was */ }
}
async function togglePin(m) {
  try {
    const r = await api("/api/pins/toggle", {id: m.id});
    toast(r.pinned ? "Pinned for everyone in this chat" : "Unpinned");
    await loadPins(S.room); refreshPinButtons(); renderPins(true);
  } catch (e) { toast(e.message, true); }
}
function refreshPinButtons() {
  document.querySelectorAll("#thread .row[data-mid]").forEach((row) => {
    const b = row.querySelector(".pin-btn"); if (!b) return;
    const on = isPinned(+row.dataset.mid);
    b.textContent = on ? "Unpin" : "Pin"; b.classList.toggle("on", on); b.setAttribute("aria-label", on ? "Unpin this message" : "Pin this message");
  });
}
async function renderPins(force) {
  const r = curRoom(); let strip = $("#pin-strip");
  if (!strip) { strip = h("div", {id: "pin-strip"}); ($("#brief-strip") || $("#topbar")).after(strip); }
  const count = r ? (r.pins || 0) : 0, sig = (r ? r.name : "") + "|" + count;
  if (strip.dataset.sig === sig && !force) return;
  strip.dataset.sig = sig;
  if (!r || !count) { strip.hidden = true; fill(strip); if (r) { (S.pinned = S.pinned || {})[r.name] = new Set(); refreshPinButtons(); } return; }
  await loadPins(r.name); refreshPinButtons();
  const list = (S.pinList || {})[r.name] || [];
  if (!list.length) { strip.hidden = true; fill(strip); return; }
  strip.hidden = false;
  fill(strip, h("button", {class: "pin-open", "aria-label": "Show pinned messages", onclick: () => pinsDialog(r.name)},
    h("span", {class: "pin-count"}, "📌 " + list.length + " pinned"), h("span", {class: "pin-latest"}, list[0].sender + ": " + quoteText(list[0]).slice(0, 90))));
}
function pinsDialog(room) {
  const list = (S.pinList || {})[room] || [];
  const close = dialog("Pinned in this chat", "Anyone in the chat can pin or unpin. Pins are for things the whole group needs to find again.", h("div", {class: "stack"},
    list.map((p) => h("div", {class: "card pin-card"}, h("div", {class: "muted", style: "font-size:12px"}, p.sender + " · pinned by " + p.by + " · " + whenText(p.pinned_at)),
      h("div", {class: "pin-text"}, quoteText(p)),
      h("div", {style: "display:flex;gap:6px;margin-top:6px"}, h("button", {class: "mini", onclick: () => { close(); if (!document.querySelector('[data-mid="' + p.id + '"]')) toast("That message is further back in the chat: scroll up to see it"); else jumpTo(p.id); }}, "Show in chat"),
        h("button", {class: "mini", onclick: async () => { close(); await togglePin({id: p.id}); }}, "Unpin"))))),
    (c) => [h("button", {class: "btn", onclick: c}, "Close")]);
}
const _renderTopbarBeforePins = renderTopbar;
renderTopbar = function (force) { _renderTopbarBeforePins(force); try { renderPins(); renderReplyBar(); } catch (e) { /* cosmetic */ } };

/* ---------- what an agent remembers (Details > Memory) ---------- */
TABS.splice(TABS.findIndex((t) => t[0] === "lessons") + 1, 0, ["memory", "Memory"]);
const _loadTabBeforeMemory = loadTab;
loadTab = async function () {
  await _loadTabBeforeMemory();
  const a = focusAgent(); if (!a || !S.drawer || S.tab !== "memory") return;
  S.cache.memory = await api("/api/notes?agent=" + encodeURIComponent(a));
};
const _tabBodyBeforeMemory = tabBody;
tabBody = function (a) {
  if (S.tab !== "memory") return _tabBodyBeforeMemory(a);
  const c = S.cache.memory;
  const where = (n) => { if (!n.room) return "every chat (older note)"; const r = rooms().find((x) => x.name === n.room); return r ? (r.kind === "dm" ? "private chat" : "#" + r.name) : n.room; };
  return [h("p", {class: "muted"}, "Things " + a.name + " chose to remember. A note made in a chat is only recalled in that chat. Delete anything wrong or that should not be kept."),
    c === undefined ? h("p", {class: "muted"}, "Loading…") : c.length ? c.map((n) => h("div", {class: "card note-card"}, h("div", {class: "note-text"}, n.text),
      h("div", {class: "muted", style: "font-size:12px;display:flex;gap:8px;align-items:center;margin-top:6px"}, h("span", {style: "flex:1"}, where(n) + " · " + whenText(n.ts)),
        h("button", {class: "mini", "aria-label": "Forget this note", onclick: () => confirmDialog("Forget this note?", n.text.slice(0, 160), "Forget", async () => {
          await act(() => api("/api/notes/delete", {id: n.id}), "Forgotten"); S.cache.memory = undefined; S.sig.drawer = null; await loadTab(); renderDrawer(); })}, "Forget"))))
      : h("p", {class: "muted"}, a.name + " has not saved anything to remember yet. Ask it to \"remember\" something.")];
};

/* ---------- drop or paste a file into the chat ---------- */
(function dropAndPaste() {
  let depth = 0;
  const main = () => $("#main");
  const show = (on) => { const m = main(); if (m) m.classList.toggle("dropping", on); };
  document.addEventListener("dragenter", (e) => { if ([...(e.dataTransfer || {}).types || []].includes("Files")) { depth++; show(true); } });
  document.addEventListener("dragleave", () => { depth = Math.max(0, depth - 1); if (!depth) show(false); });
  document.addEventListener("dragover", (e) => { if ([...(e.dataTransfer || {}).types || []].includes("Files")) e.preventDefault(); });
  document.addEventListener("drop", (e) => {
    const files = [...((e.dataTransfer || {}).files || [])]; depth = 0; show(false);
    if (!files.length) return;
    e.preventDefault();
    if ($("#dialog-root .dialog")) return;
    attachFile(files[0]);
    if (files.length > 1) toast("One file at a time: gave the first one", true);
  });
  document.addEventListener("paste", (e) => {
    if (!e.target || e.target.id !== "msg") return;
    const file = [...((e.clipboardData || {}).files || [])][0];
    if (!file) return;  // ordinary text paste
    e.preventDefault(); attachFile(file);
  });
})();

/* ---------- choose a model from the list your key allows ---------- */
function modelPicker(r, profile, after) {
  const models = (r && r.models) || [];
  if (!models.length || !profile) return null;
  const filter = models.length > 12 ? h("input", {type: "search", placeholder: "Filter models", "aria-label": "Filter models", style: "margin:6px 0"}) : null;
  const list = h("div", {class: "model-chips"});
  const draw = () => {
    const q = filter ? filter.value.trim().toLowerCase() : "";
    fill(list, models.filter((m) => !q || m.toLowerCase().includes(q)).slice(0, 60).map((m) => h("button", {class: "chip" + (m === profile.model ? " on" : ""), onclick: async () => {
      try {
        await api("/api/providers/save", {id: profile.id, label: profile.label, kind: profile.kind, base_url: profile.base_url, model: m, keyless: !!profile.keyless});
        toast("Model set to " + m + ". Testing…"); if (after) after(m);
      } catch (e) { toast(e.message, true); }
    }}, m)));
  };
  if (filter) filter.oninput = draw;
  draw();
  return h("div", {class: "picker"}, h("div", {class: "muted", style: "font-size:13px;margin-top:6px"}, "Tap a model to use it:"), filter, list);
}
const _modelsPanelBeforePicker = SETTINGS_PANELS.models;
SETTINGS_PANELS.models = async () => {
  const panel = await _modelsPanelBeforePicker();
  let profiles = [];
  try { profiles = (await api("/api/providers")).profiles; } catch (e) { return panel; }
  // each Test button also offers the models the key can use, as buttons
  panel.querySelectorAll(".card button").forEach((b) => {
    if (b.textContent !== "Test") return;
    const card = b.closest(".card"), p = profiles.find((x) => card.textContent.startsWith(x.label));
    if (!p) return;
    b.onclick = async () => {
      const out = document.getElementById("model-test");
      const run = async () => {
        try {
          fill(out, h("div", {class: "card"}, "Testing " + p.label + "…"));
          const r = await api("/api/providers/test", {id: p.id});
          fill(out, testResult(r), modelPicker(r, p, async (m) => { p.model = m; await run(); }));
        } catch (e) { toast(e.message, true); }
      };
      run();
    };
  });
  return panel;
};

/* ---------- keyboard shortcuts (computers) ---------- */
const SHORTCUTS = [["Ctrl/⌘ + K", "Search chats, messages and settings"], ["Alt + ↑ / ↓", "Previous / next chat"], ["/", "Quick commands (in the message box)"],
  ["@", "Mention an agent"], ["Enter", "Send"], ["Shift + Enter", "New line"], ["Esc", "Close a window or cancel a reply"], ["?", "This list"]];
function shortcutsDialog() {
  dialog("Keyboard shortcuts", null, h("div", {class: "shortcuts"}, SHORTCUTS.map(([k, what]) => h("div", {class: "sc-row"}, h("kbd", {}, k), h("span", {}, what)))),
    (c) => [h("button", {class: "btn primary", onclick: c}, "Done")]);
}
document.addEventListener("keydown", (e) => {
  const typing = e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
  if (e.key === "Escape" && S.replyTo && !$("#dialog-root .dialog")) { S.replyTo = null; renderReplyBar(); return; }
  if ($("#dialog-root .dialog")) return;
  if (!typing && e.key === "?" && !e.ctrlKey && !e.metaKey) { e.preventDefault(); shortcutsDialog(); return; }
  if (e.altKey && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
    const list = rooms(); if (!list.length) return;
    const i = list.findIndex((r) => r.name === S.room), next = list[(i + (e.key === "ArrowUp" ? -1 : 1) + list.length) % list.length];
    e.preventDefault(); openRoom(next.name);
  }
});

/* the composer's send button was wired before this file loaded: point it at the reply-aware version */
(function rewire() {
  const b = $("#send"); if (b) b.onclick = () => sendMsg();
  const hint = $("#hint"); if (hint && matchMedia("(hover: hover)").matches) hint.append(" · ? for shortcuts");
})();
