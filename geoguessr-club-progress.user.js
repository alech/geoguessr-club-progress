// ==UserScript==
// @name         GeoGuessr Club Progress
// @namespace    https://github.com/alech/geoguessr-club-progress
// @version      1.5.0
// @description  Club page "Progress" tab: weekly mission progress per member and challenge day.
// @author       Alexander Klink
// @homepageURL  https://github.com/alech/geoguessr-club-progress
// @downloadURL  https://github.com/alech/geoguessr-club-progress/raw/refs/heads/main/geoguessr-club-progress.user.js
// @updateURL    https://github.com/alech/geoguessr-club-progress/raw/refs/heads/main/geoguessr-club-progress.user.js
// @match        https://www.geoguessr.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  "use strict";

  const DAY_MS = 86_400_000;
  const REFRESH_MS = 60_000;
  const TAB_ID = "tbgg-progress-tab";
  const PANEL_ID = "tbgg-progress-panel";
  const HIDE_ATTR = "data-tbgg-hide";
  const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const OPEN_WARN_MS = 6 * 3_600_000;
  const OPEN_ALERT_MS = 12 * 3_600_000;

  const state = { active: false, prevTab: null, timer: null, nicks: null };

  // ---------- data ----------

  async function getJson(path) {
    const response = await fetch(path, { credentials: "include" });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    return response.json();
  }

  async function loadNicks() {
    if (state.nicks) return state.nicks;
    const { clubId } = await getJson("/api/v4/clubs/my");
    const members = await getJson(`/api/v4/clubs/${clubId}/members`);
    state.nicks = new Map(members.map((m) => [m.user.userId, m.user.nick]));
    return state.nicks;
  }

  function challengeDay(ts, periodStart) {
    return Math.floor((Date.parse(ts) - periodStart) / DAY_MS);
  }

  function tileTitle(tile, templates) {
    const tpl = templates[tile.templateId];
    const fmt = tpl && (tile.targetProgress === 1 ? tpl.title : tpl.titlePlural);
    if (!fmt) return tile.templateId;
    return fmt
      .replace("{0}", tile.targetProgress.toLocaleString("en"))
      .replace("{1}", tpl.mapName ?? "?");
  }

  function summarize(board, nicks) {
    const periodStart = Date.parse(board.periodStart);
    const dayCount = Math.round((Date.parse(board.periodEnd) - periodStart) / DAY_MS);
    const templates = board.templates ?? {};
    const tiles = board.boards.flatMap((b) =>
      b.tiles
        .filter((t) => t.claimedBy)
        .map((t) => ({
          ...t,
          board: b.number,
          title: tileTitle(t, templates),
          day: t.completedAt ? challengeDay(t.completedAt, periodStart) : null,
        })),
    );
    const total = board.boards.reduce((n, b) => n + b.tiles.length, 0);
    const finished = tiles.filter((t) => t.completed).length;
    const today = challengeDay(new Date().toISOString(), periodStart);
    const daysAhead = Math.max(0, dayCount - today - 1);
    return {
      board,
      periodStart,
      dayCount,
      total,
      // Missions a day needs to clear every board by week's end (100 over 7 days -> 14).
      dailyTarget: Math.floor(total / dayCount),
      // What's left, spread over the days after today, so finished + stillNeeded * daysAhead
      // reaches the total even if nothing more gets done today.
      stillNeeded: Math.ceil(Math.max(0, total - finished) / Math.max(1, daysAhead)),
      daysAhead,
      // Once the last board is cleared, currentBoardNumber points one past it.
      cleared:
        board.allBoardsCleared || !board.boards.some((b) => b.number === board.currentBoardNumber),
      finished,
      today,
      tiles,
      players: summarizePlayers(tiles, nicks, dayCount),
      nick: (id) => nicks.get(id) ?? id.slice(0, 8),
    };
  }

  function summarizePlayers(tiles, nicks, dayCount) {
    const players = new Map();
    const get = (id) => {
      if (!players.has(id)) {
        players.set(id, {
          id,
          nick: nicks.get(id) ?? id.slice(0, 8),
          member: nicks.has(id),
          completed: 0,
          helped: 0,
          open: null,
          days: Array.from({ length: dayCount }, () => ({ done: [], helped: [] })),
        });
      }
      return players.get(id);
    };
    for (const id of nicks.keys()) get(id);
    for (const t of tiles) {
      const p = get(t.claimedBy);
      if (!t.completed) {
        p.open = t;
        continue;
      }
      const inWeek = t.day >= 0 && t.day < dayCount;
      p.completed += 1;
      if (inWeek) p.days[t.day].done.push(t);
      for (const h of t.helpers) {
        get(h).helped += 1;
        if (inWeek) get(h).days[t.day].helped.push(t);
      }
    }
    return [...players.values()].sort(
      (a, b) => b.completed - a.completed || b.helped - a.helped || a.nick.localeCompare(b.nick),
    );
  }

  // ---------- formatting ----------

  const pad = (n) => String(n).padStart(2, "0");

  function fmtTime(ms) {
    const d = new Date(ms);
    return `${WEEKDAYS[d.getUTCDay()]} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  }

  function fmtDate(ms) {
    const d = new Date(ms);
    return `${WEEKDAYS[d.getUTCDay()]} ${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }

  function fmtDuration(ms) {
    const minutes = Math.max(0, Math.round(ms / 60_000));
    const h = Math.floor(minutes / 60);
    if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
    return h ? `${h}h ${minutes % 60}m` : `${minutes}m`;
  }

  const fmtNum = (n) => n.toLocaleString("en");

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  }

  const profile = (id, text) => `<a href="/user/${esc(id)}">${esc(text)}</a>`;
  const todayCls = (i, s) => (i === s.today ? ' class="today"' : "");

  // ---------- rendering ----------

  function renderHeader(s) {
    const { board } = s;
    const current = board.boards.find((b) => b.number === board.currentBoardNumber);
    const done = current ? current.tiles.filter((t) => t.completed).length : 0;
    const now = Date.now();
    const end = Date.parse(board.periodEnd);
    const nextDay = s.periodStart + (s.today + 1) * DAY_MS;
    const you = board.you ?? {};
    const nextClaim = Date.parse(you.nextDayAt);
    let claim = "you can take a mission now";
    if (s.cleared) claim = "all boards cleared, nothing left to take";
    else if (!you.canClaim && nextClaim) {
      claim = `your next mission in ${fmtDuration(nextClaim - now)}`;
    } else if (!you.canClaim) claim = "you can't take a mission right now";
    const stats = [
      s.cleared
        ? ["Board", `all ${board.boards.length} cleared 🎉`]
        : ["Board", `${board.currentBoardNumber} of ${board.boards.length}`],
      ["This board", s.cleared ? "–" : `${done} / ${current.tiles.length}`],
      ["Next challenge day", fmtDuration(nextDay - now)],
      ["Week ends", `${board.periodEnd.slice(0, 10)} (${fmtDuration(end - now)})`],
    ];
    const cells = stats.map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`);
    return `
      <div class="tbgg-head">
        <div class="tbgg-stats">${cells.join("")}</div>
        ${renderOverall(s)}
        <div class="tbgg-sub">All times UTC · challenge days start 11:00 UTC · ${esc(claim)}
          <button type="button" class="tbgg-refresh">Refresh</button></div>
      </div>`;
  }

  function renderOverall(s) {
    const weekMs = s.dayCount * DAY_MS;
    const elapsed = Math.min(Math.max(Date.now() - s.periodStart, 1), weekMs);
    const projected = Math.round((s.finished / elapsed) * weekMs);
    const onTrack = s.finished >= s.total || projected >= s.total;
    const left = s.total - s.finished;
    const verdict =
      s.cleared || left <= 0
        ? "🎉 All boards cleared! 🎉"
        : `${onTrack ? "On track" : "Behind pace"}: at this speed ≈${projected} by week's end` +
          ` · ${left} to go` +
          (s.daysAhead ? `, ${s.stillNeeded} a day needed from tomorrow` : " today");
    const pct = (n) => `${Math.min(100, (100 * n) / s.total)}%`;
    const paceTip = "Where an even pace would be now";
    const pace = `<u style="left:${(100 * elapsed) / weekMs}%" data-tip="${paceTip}"></u>`;
    return `
      <div class="tbgg-overall ${onTrack ? "good" : "bad"}">
        <div class="tbgg-overall-top">
          <b>${s.finished} / ${s.total}</b><span>${esc(verdict)}</span>
        </div>
        <div class="tbgg-bar big"><i style="width:${pct(s.finished)}"></i>${pace}</div>
      </div>`;
  }

  function dayStatus(n, i, s) {
    if (i > s.today) return "future";
    if (n > s.dailyTarget) return "good";
    if (n === s.dailyTarget) return "ok";
    return i === s.today ? "running" : "bad"; // today isn't over yet, so don't call it short
  }

  function renderDays(s) {
    const counts = Array.from({ length: s.dayCount }, () => 0);
    for (const t of s.tiles) if (t.day !== null && t.day < s.dayCount) counts[t.day] += 1;
    const scale = Math.max(Math.max(s.dailyTarget, s.stillNeeded) + 4, ...counts);
    const line = (n, tip) =>
      `<u style="left:${(100 * n) / scale}%" data-tip="${esc(tip)}"></u>`;
    const fixed = line(s.dailyTarget, `Target: ${s.dailyTarget} a day`);
    // Nothing left to do: no line on the days ahead rather than one at 0.
    const ahead = s.stillNeeded
      ? line(s.stillNeeded, `Still needed: ${s.stillNeeded} a day to clear all boards`)
      : "";
    const aheadNote = s.stillNeeded
      ? `; on days ahead, the ${s.stillNeeded} a day still needed`
      : "";
    const rows = counts.map((n, i) => {
      const isToday = i === s.today;
      const target = i > s.today ? ahead : fixed;
      const label = `${fmtDate(s.periodStart + i * DAY_MS)}${isToday ? " · today" : ""}`;
      return `
        <div class="tbgg-day ${dayStatus(n, i, s)}${isToday ? " today" : ""}">
          <span>${label}</span>
          <div class="tbgg-bar"><i style="width:${(100 * n) / scale}%"></i>${target}</div>
          <b>${i > s.today ? "" : n}</b>
        </div>`;
    });
    return `
      <section>
        <h3>Missions finished per challenge day
          <small>line marks the target of ${s.dailyTarget} a day${aheadNote}</small></h3>
        ${rows.join("")}
      </section>`;
  }

  function mark(tiles, cls) {
    if (!tiles.length) return "";
    return `<span class="${cls}">${tiles.length > 1 ? tiles.length : "✓"}</span>`;
  }

  function dayCell({ done, helped }, i, s) {
    const cls = todayCls(i, s);
    if (!done.length && !helped.length) return `<td${cls}>${i > s.today ? "" : "·"}</td>`;
    const when = (t) => fmtTime(Date.parse(t.completedAt));
    const tip = [
      ...done.map((t) => `✓ ${when(t)} · ${t.title}`),
      ...helped.map((t) => `Helped ${s.nick(t.claimedBy)} · ${when(t)} · ${t.title}`),
    ].join("\n");
    const marks = mark(done, "tbgg-check") + mark(helped, "tbgg-check small");
    return `<td${cls} data-tip="${esc(tip)}"><span class="tbgg-marks">${marks}</span></td>`;
  }

  function playerRow(p, s) {
    const open = p.open
      ? `<span class="tbgg-open" data-tip="${esc(p.open.title)}">working on one</span>`
      : "";
    const cls = [p.completed || p.helped || p.open ? "" : "idle", p.member ? "" : "left"];
    const name = `${profile(p.id, p.nick)}${p.member ? "" : " (left)"}`;
    return `
      <tr class="${cls.join(" ")}">
        <td class="name">${name} ${open}</td>
        <td class="num">${p.completed}</td>
        <td class="num">${p.helped || ""}</td>
        ${p.days.map((day, i) => dayCell(day, i, s)).join("")}
      </tr>`;
  }

  function renderPlayers(s) {
    const days = Array.from({ length: s.dayCount }, (_, i) => {
      const weekday = WEEKDAYS[new Date(s.periodStart + i * DAY_MS).getUTCDay()];
      return `<th${todayCls(i, s)}>${weekday}</th>`;
    });
    return `
      <section>
        <h3>Members <small>✓ finished · small ✓ helped · hover for details</small></h3>
        <div class="tbgg-scroll"><table class="tbgg-players">
          <thead><tr>
            <th class="name">Player</th><th class="num">Done</th><th class="num">Helped</th>
            ${days.join("")}
          </tr></thead>
          <tbody>${s.players.map((p) => playerRow(p, s)).join("")}</tbody>
        </table></div>
      </section>`;
  }

  function helpersLine(t, s) {
    if (!t.helpers.length) return "";
    const names = t.helpers.map((h) => profile(h, s.nick(h)));
    return `<div class="tbgg-helpers">helped by ${names.join(", ")}</div>`;
  }

  function openRow(t, s) {
    const age = Date.now() - Date.parse(t.claimedAt);
    const cls = age > OPEN_ALERT_MS ? "bad" : age > OPEN_WARN_MS ? "ok" : "";
    const badge = t.helpRequestedAt ? `<span class="tbgg-badge">Help requested</span>` : "";
    const progress = `${fmtNum(t.currentProgress)} / ${fmtNum(t.targetProgress)}`;
    return `
      <tr>
        <td class="time"><span class="tbgg-age ${cls}">${fmtDuration(age)}</span></td>
        <td class="time dim">${fmtTime(Date.parse(t.claimedAt))}</td>
        <td class="dim">${t.board}/${t.index}</td>
        <td>${profile(t.claimedBy, s.nick(t.claimedBy))}</td>
        <td>${esc(t.title)} ${badge}${helpersLine(t, s)}</td>
        <td class="time tbgg-progress">${progress}</td>
      </tr>`;
  }

  function renderOpen(s) {
    const open = s.tiles
      .filter((t) => !t.completed)
      .sort((a, b) => a.claimedAt.localeCompare(b.claimedAt));
    const body = open.length
      ? `<div class="tbgg-scroll"><table class="tbgg-missions">
          <thead><tr>
            <th>Open for</th><th>Taken</th><th>Tile</th><th>Taken by</th><th>Mission</th>
            <th>Progress</th>
          </tr></thead>
          <tbody>${open.map((t) => openRow(t, s)).join("")}</tbody>
        </table></div>`
      : `<div class="tbgg-empty">Nobody is working on a mission right now.</div>`;
    return `
      <section>
        <h3>Open missions <small>yellow after 6h, red after 12h</small></h3>
        ${body}
      </section>`;
  }

  function missionRow(t, s) {
    return `
      <tr>
        <td class="time">${fmtTime(Date.parse(t.completedAt))}</td>
        <td class="time dim">${fmtTime(Date.parse(t.claimedAt))}</td>
        <td class="dim">${t.board}/${t.index}</td>
        <td>${profile(t.claimedBy, s.nick(t.claimedBy))}</td>
        <td>${esc(t.title)} ${helpersLine(t, s)}</td>
      </tr>`;
  }

  function renderMissions(s) {
    const sorted = s.tiles
      .filter((t) => t.completed)
      .sort((a, b) => b.completedAt.localeCompare(a.completedAt));
    const groups = [];
    for (const t of sorted) {
      const last = groups.at(-1);
      if (last && last.day === t.day) last.tiles.push(t);
      else groups.push({ day: t.day, tiles: [t] });
    }
    const body = groups.map((g) => {
      const start = fmtDate(s.periodStart + g.day * DAY_MS);
      const label = `Challenge day ${start} 11:00 · ${g.tiles.length} finished`;
      const rows = g.tiles.map((t) => missionRow(t, s));
      return `<tr class="tbgg-group"><td colspan="5">${esc(label)}</td></tr>${rows.join("")}`;
    });
    return `
      <section>
        <h3>Missions</h3>
        <div class="tbgg-scroll"><table class="tbgg-missions">
          <thead><tr>
            <th>Finished</th><th>Taken</th><th>Tile</th><th>Taken by</th><th>Mission</th>
          </tr></thead>
          <tbody>${body.join("")}</tbody>
        </table></div>
      </section>`;
  }

  async function refresh(panel) {
    panel.querySelector(".tbgg-refresh")?.setAttribute("disabled", "");
    try {
      const [board, nicks] = await Promise.all([
        getJson("/api/v4/missions/club/board"),
        loadNicks(),
      ]);
      const s = summarize(board, nicks);
      const sections = [renderHeader, renderOpen, renderDays, renderPlayers, renderMissions];
      panel.innerHTML = sections
        .filter((render) => !(s.cleared && render === renderOpen)) // nothing left to work on
        .map((render) => render(s))
        .join("");
    } catch (error) {
      panel.innerHTML = `
        <div class="tbgg-error">Could not load missions: ${esc(error.message)}
          <button type="button" class="tbgg-refresh">Retry</button></div>`;
    }
  }

  // ---------- tab integration ----------

  function findTabs() {
    if (!/^(\/[a-z]{2})?\/clubs\/my\/?$/.test(location.pathname)) return null;
    const wrapper = document.querySelector('[class*="club-tabs_tabsWrapper"]');
    const list = wrapper?.querySelector('[role="tablist"]');
    return list ? { wrapper, list } : null;
  }

  function contentSiblings(wrapper) {
    const out = [];
    for (let el = wrapper.nextElementSibling; el; el = el.nextElementSibling) {
      if (el.id !== PANEL_ID) out.push(el);
    }
    return out;
  }

  function setTabState(tab, active) {
    tab.dataset.state = active ? "active" : "inactive";
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  }

  function showPanel(wrapper) {
    let panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = document.createElement("div");
      panel.id = PANEL_ID;
      panel.addEventListener("click", (e) => {
        if (e.target.closest(".tbgg-refresh")) refresh(panel);
      });
      wrapper.after(panel);
    }
    panel.hidden = false;
    panel.innerHTML = `<div class="tbgg-loading">Loading missions…</div>`;
    return panel;
  }

  function activate(tabs, button) {
    if (state.active) return;
    state.active = true;
    state.nicks = null; // pick up membership changes
    state.prevTab = tabs.list.querySelector('[role="tab"][data-state="active"]');
    if (state.prevTab) setTabState(state.prevTab, false);
    setTabState(button, true);
    for (const el of contentSiblings(tabs.wrapper)) el.setAttribute(HIDE_ATTR, "");
    const panel = showPanel(tabs.wrapper);
    refresh(panel);
    state.timer = setInterval(() => document.hidden || refresh(panel), REFRESH_MS);
  }

  function deactivate() {
    if (!state.active) return;
    state.active = false;
    clearInterval(state.timer);
    const button = document.getElementById(TAB_ID);
    if (button) setTabState(button, false);
    // Give React's own tab back its active look; if another tab was clicked, React re-renders both.
    if (state.prevTab?.isConnected) setTabState(state.prevTab, true);
    state.prevTab = null;
    document.querySelectorAll(`[${HIDE_ATTR}]`).forEach((el) => el.removeAttribute(HIDE_ATTR));
    const panel = document.getElementById(PANEL_ID);
    if (panel) panel.hidden = true;
  }

  function inject() {
    const tabs = findTabs();
    if (!tabs) {
      deactivate();
      return;
    }
    if (document.getElementById(TAB_ID)) return;
    const template = tabs.list.querySelector('[role="tab"]');
    if (!template) return;
    deactivate(); // the club page remounted while our tab was open
    const button = template.cloneNode(true);
    button.id = TAB_ID;
    button.removeAttribute("aria-controls");
    button.querySelectorAll("span > span").forEach((el) => el.remove()); // notification dots
    button.querySelector("span").textContent = "Progress";
    setTabState(button, false);
    button.addEventListener("click", () => activate(tabs, button));
    const stats = tabs.list.querySelector('[role="tab"][id$="-tab-stats"]');
    if (stats) stats.after(button);
    else tabs.list.append(button);
    // Capture phase, so this runs before React switches to the native tab that was clicked.
    const onNativeTab = (e) => {
      const tab = e.target.closest('[role="tab"]');
      if (tab && tab.id !== TAB_ID) deactivate();
    };
    tabs.list.addEventListener("click", onNativeTab, true);
  }

  // One shared tooltip, looked up on every mouse move so it survives the panel re-rendering
  // underneath the cursor (native title tooltips get cancelled by that).
  function setupTooltip() {
    const tip = document.createElement("div");
    tip.id = "tbgg-tip";
    tip.hidden = true;
    document.body.append(tip);
    const onMove = (e) => {
      const el = e.target.closest?.(`#${PANEL_ID} [data-tip]`);
      if (!el) {
        tip.hidden = true;
        return;
      }
      tip.textContent = el.dataset.tip;
      tip.hidden = false;
      const x = Math.min(e.clientX + 14, innerWidth - tip.offsetWidth - 8);
      const below = e.clientY + 18;
      const y = below + tip.offsetHeight > innerHeight ? e.clientY - tip.offsetHeight - 10 : below;
      tip.style.left = `${Math.max(8, x)}px`;
      tip.style.top = `${Math.max(8, y)}px`;
    };
    document.addEventListener("mousemove", onMove, { passive: true });
  }

  // ---------- styles & startup ----------

  const style = document.createElement("style");
  style.textContent = `
    [${HIDE_ATTR}] { display: none !important; }
    #${PANEL_ID} {
      flex: 1;
      display: grid;
      gap: 1rem;
      margin-top: 1rem;
      color: #fff;
      font-size: 0.875rem;
    }
    #${PANEL_ID}[hidden] { display: none; }
    #${PANEL_ID} :is(section, .tbgg-head, .tbgg-loading, .tbgg-error) {
      padding: 1rem 1.25rem;
      border: 1px solid rgb(255 255 255 / 12%);
      border-radius: 1rem;
      background: rgb(16 10 44 / 78%);
      backdrop-filter: blur(6px);
    }
    #${PANEL_ID} h3 {
      margin: 0 0 0.75rem;
      font-size: 0.8rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: rgb(255 255 255 / 65%);
    }
    #${PANEL_ID} h3 small {
      margin-left: 0.5rem;
      font-weight: 400;
      letter-spacing: 0;
      text-transform: none;
      color: rgb(255 255 255 / 45%);
    }
    #${PANEL_ID} a { color: inherit; text-decoration: none; }
    #${PANEL_ID} a:hover { text-decoration: underline; }
    .tbgg-stats { display: flex; flex-wrap: wrap; gap: 0.5rem 2rem; }
    .tbgg-stats div { display: grid; }
    .tbgg-stats span {
      font-size: 0.7rem;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: rgb(255 255 255 / 60%);
    }
    .tbgg-stats b { font-size: 1.15rem; }
    .tbgg-sub {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 1rem;
      margin-top: 0.75rem;
      color: rgb(255 255 255 / 65%);
    }
    .tbgg-refresh {
      margin-left: auto;
      padding: 0.3rem 0.9rem;
      border: 1px solid rgb(255 255 255 / 25%);
      border-radius: 999px;
      background: rgb(255 255 255 / 10%);
      color: #fff;
      font: inherit;
      cursor: pointer;
    }
    .tbgg-refresh:hover { background: rgb(255 255 255 / 20%); }
    .tbgg-refresh[disabled] { opacity: 0.5; cursor: default; }
    .tbgg-overall { margin-top: 1rem; }
    .tbgg-overall-top {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 1rem;
      margin-bottom: 0.5rem;
    }
    .tbgg-overall-top b { font-size: 1.15rem; }
    .tbgg-overall.good .tbgg-overall-top span { color: #6cb928; }
    .tbgg-overall.bad .tbgg-overall-top span { color: #e94560; }
    .tbgg-day {
      display: grid;
      grid-template-columns: 8rem 1fr 2rem;
      align-items: center;
      gap: 0.75rem;
      padding: 0.15rem 0;
    }
    .tbgg-day b { text-align: right; }
    .tbgg-day.future { opacity: 0.4; }
    .tbgg-day.today span { font-weight: 700; }
    .tbgg-bar {
      position: relative;
      height: 0.6rem;
      border-radius: 999px;
      background: rgb(255 255 255 / 8%);
    }
    .tbgg-bar i {
      display: block;
      height: 100%;
      border-radius: inherit;
      background: #b18cff;
      transition: width 0.4s;
    }
    .tbgg-bar u {
      position: absolute;
      top: -0.2rem;
      bottom: -0.2rem;
      width: 2px;
      margin-left: -1px;
      border-radius: 1px;
      background: rgb(255 255 255 / 70%);
    }
    .tbgg-bar.big { height: 1rem; }
    .tbgg-bar.big u { top: -0.3rem; bottom: -0.3rem; }
    .good .tbgg-bar i { background: #6cb928; }
    .ok .tbgg-bar i { background: #fecd19; }
    .bad .tbgg-bar i { background: #e94560; }
    .tbgg-day.good b { color: #6cb928; }
    .tbgg-day.ok b { color: #fecd19; }
    .tbgg-day.bad b { color: #e94560; }
    .tbgg-scroll { overflow-x: auto; }
    #${PANEL_ID} table { width: 100%; border-collapse: collapse; }
    #${PANEL_ID} th {
      padding: 0.3rem 0.5rem;
      font-size: 0.7rem;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-align: left;
      text-transform: uppercase;
      color: rgb(255 255 255 / 55%);
    }
    #${PANEL_ID} td {
      padding: 0.35rem 0.5rem;
      border-top: 1px solid rgb(255 255 255 / 7%);
      vertical-align: top;
    }
    .tbgg-players :is(td, th) { text-align: center; }
    .tbgg-players .name { text-align: left; white-space: nowrap; }
    .tbgg-players .num { width: 3.5rem; text-align: right; font-variant-numeric: tabular-nums; }
    .tbgg-players .today { background: rgb(255 255 255 / 6%); }
    .tbgg-players th.today { color: #fff; }
    .tbgg-players tr.idle { opacity: 0.45; }
    .tbgg-players tr.left .name { font-style: italic; }
    .tbgg-check {
      display: inline-grid;
      place-items: center;
      width: 1.3rem;
      height: 1.3rem;
      border-radius: 50%;
      background: #6cb928;
      font-size: 0.75rem;
      font-weight: 700;
    }
    .tbgg-marks { display: inline-flex; align-items: center; gap: 3px; }
    .tbgg-check.small { width: 0.95rem; height: 0.95rem; font-size: 0.6rem; background: #7950e5; }
    .tbgg-players td[data-tip], .tbgg-open, .tbgg-bar u { cursor: help; }
    #tbgg-tip {
      position: fixed;
      z-index: 10000;
      max-width: 28rem;
      padding: 0.5rem 0.75rem;
      border: 1px solid rgb(255 255 255 / 18%);
      border-radius: 0.6rem;
      background: #1b1040;
      box-shadow: 0 6px 24px rgb(0 0 0 / 45%);
      color: #fff;
      font-size: 0.8rem;
      line-height: 1.45;
      white-space: pre-line;
      pointer-events: none;
    }
    #tbgg-tip[hidden] { display: none; }
    .tbgg-open { margin-left: 0.4rem; font-size: 0.7rem; color: #b18cff; }
    .tbgg-missions .time { white-space: nowrap; font-variant-numeric: tabular-nums; }
    .tbgg-missions .dim { white-space: nowrap; color: rgb(255 255 255 / 50%); }
    .tbgg-missions tr.tbgg-group td {
      padding-top: 1rem;
      border-top: none;
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: #b18cff;
    }
    .tbgg-helpers { margin-top: 0.15rem; font-size: 0.75rem; color: rgb(255 255 255 / 55%); }
    .tbgg-progress { color: #b18cff; }
    .tbgg-age { font-weight: 700; }
    .tbgg-age.ok { color: #fecd19; }
    .tbgg-age.bad { color: #e94560; }
    .tbgg-empty { color: rgb(255 255 255 / 55%); }
    .tbgg-badge {
      display: inline-block;
      margin-left: 0.4rem;
      padding: 0.05rem 0.5rem;
      border-radius: 999px;
      background: #e94560;
      font-size: 0.7rem;
      font-weight: 700;
    }
    .tbgg-error { display: flex; align-items: center; gap: 1rem; border-color: #e94560; }
  `;
  document.head.append(style);
  setupTooltip();

  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      inject();
    });
  }).observe(document.body, { childList: true, subtree: true });
  inject();
})();
