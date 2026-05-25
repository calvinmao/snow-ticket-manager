// This file is injected into ServiceNow pages via chrome.scripting.executeScript.
// It runs in the page's MAIN world; fetch uses credentials: "same-origin" so the
// user's existing session cookies are sent automatically (no chrome.cookies API).

async function snowFetch(method, relUrl, body) {
  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  try {
    if (typeof g_ck !== "undefined" && g_ck) headers["X-UserToken"] = g_ck;
  } catch {}
  const opts = { method, headers, credentials: "same-origin" };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(relUrl, opts);
  const text = await resp.text();
  if (!resp.ok) throw new Error("HTTP " + resp.status + ": " + text);
  return JSON.parse(text);
}
