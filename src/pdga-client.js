// Thin client for the PDGA REST API (https://www.pdga.com/dev).
// Handles the Drupal-style session login, caches the session cookie,
// and transparently logs in again when a session expires.

const DEFAULT_BASE_URL = "https://api.pdga.com";

export class PdgaApiError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = "PdgaApiError";
    this.status = status;
    this.body = body;
  }
}

export class PdgaClient {
  constructor({ username, password, baseUrl = DEFAULT_BASE_URL, fetchImpl = fetch } = {}) {
    if (!username || !password) {
      throw new Error(
        "PDGA credentials missing. Set PDGA_USERNAME and PDGA_PASSWORD (your pdga.com login)."
      );
    }
    this.username = username;
    this.password = password;
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.fetch = fetchImpl;
    this.session = null; // { cookie, token }
    this.loginPromise = null;
  }

  async login() {
    // Collapse concurrent logins into one request.
    if (!this.loginPromise) {
      this.loginPromise = this.#doLogin().finally(() => {
        this.loginPromise = null;
      });
    }
    return this.loginPromise;
  }

  async #doLogin() {
    const res = await this.fetch(`${this.baseUrl}/services/json/user/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ username: this.username, password: this.password }),
    });
    const body = await readBody(res);

    if (!res.ok || !body || !body.sessid || !body.session_name) {
      this.session = null;
      const detail = Array.isArray(body) ? body.join(" ") : typeof body === "string" ? body : "";
      throw new PdgaApiError(
        `PDGA login failed (HTTP ${res.status}). Check PDGA_USERNAME / PDGA_PASSWORD and that ` +
          `you've signed the PDGA API license agreement. ${detail}`.trim(),
        { status: res.status, body }
      );
    }

    this.session = {
      cookie: `${body.session_name}=${body.sessid}`,
      token: body.token,
    };
    return this.session;
  }

  async logout() {
    if (!this.session) return;
    try {
      await this.fetch(`${this.baseUrl}/services/json/user/logout`, {
        method: "POST",
        headers: {
          Cookie: this.session.cookie,
          "X-CSRF-Token": this.session.token ?? "",
          Accept: "application/json",
        },
      });
    } catch {
      // Best effort only.
    } finally {
      this.session = null;
    }
  }

  // GET a service endpoint, e.g. get("players", { last_name: "McBeth" }).
  async get(service, params = {}) {
    const url = new URL(`${this.baseUrl}/services/json/${service}`);
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === "") continue;
      url.searchParams.set(key, Array.isArray(value) ? value.join(",") : String(value));
    }

    if (!this.session) await this.login();

    let res = await this.#authedGet(url);
    if (res.status === 401 || res.status === 403) {
      // Session likely expired. Log in again and retry once.
      this.session = null;
      await this.login();
      res = await this.#authedGet(url);
    }

    const body = await readBody(res);
    if (!res.ok) {
      const detail = Array.isArray(body) ? body.join(" ") : typeof body === "string" ? body.slice(0, 300) : "";
      throw new PdgaApiError(`PDGA API error on ${service} (HTTP ${res.status}). ${detail}`.trim(), {
        status: res.status,
        body,
      });
    }
    return body;
  }

  #authedGet(url) {
    return this.fetch(url, {
      method: "GET",
      headers: { Cookie: this.session.cookie, Accept: "application/json" },
    });
  }
}

async function readBody(res) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
