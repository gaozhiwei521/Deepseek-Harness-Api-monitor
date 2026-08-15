// dsh-api-balance — node half
// Registers a loopback HTTP route that resolves the DeepSeek API key through
// the credentials seam (same apiKeyEnv / baseURL the llm-deepseek adapter
// uses) and queries the provider balance endpoint. The browser never sees the
// key: only this host route talks to api.deepseek.com.
//
// Route: GET /dsh-balance/query
//   -> { ok: true,  data: { is_available, balance_infos: [...] } }
//   -> { ok: false, error, message }
const name = "api-balance";
const inject = ["webServer"];

const DEFAULT_API_KEY_ENV = "DEEPSEEK_API_KEY";
const DEFAULT_BASE_URL = "https://api.deepseek.com";
const LLM_NS = "llm-deepseek";
const REQUEST_TIMEOUT_MS = 15000;

function json(res, status, body) {
	const data = JSON.stringify(body);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store"
	});
	res.end(data);
}

function apply(ctx, config) {
	const cfg = {
		apiKeyEnv: config?.apiKeyEnv ?? DEFAULT_API_KEY_ENV,
		baseURL: config?.baseURL ?? DEFAULT_BASE_URL
	};

	// Mirror llm-deepseek: the user-settings `llm-deepseek` section (Models
	// page) overrides the row defaults, so balance checks follow the exact
	// endpoint/key the chat provider uses.
	const resolveConnection = () => {
		let apiKeyEnv = cfg.apiKeyEnv;
		let baseURL = cfg.baseURL;
		try {
			const settings = ctx.get("settings");
			const descriptor = settings?.describe().find((d) => d.ns === LLM_NS);
			const user = descriptor?.user;
			if (user && typeof user === "object") {
				if (typeof user.apiKeyEnv === "string" && user.apiKeyEnv.length > 0) apiKeyEnv = user.apiKeyEnv;
				if (typeof user.baseURL === "string" && user.baseURL.length > 0) baseURL = user.baseURL;
			}
		} catch {
			/* settings unavailable — keep row defaults */
		}
		return { apiKeyEnv, baseURL };
	};

	const resolveKey = async (ref) => {
		try {
			const credentials = ctx.get("credentials");
			if (credentials !== void 0) {
				const hit = await credentials.resolve(ref);
				if (hit !== void 0 && typeof hit.value === "string" && hit.value.length > 0) return hit.value;
			}
		} catch {
			/* fall through to environment */
		}
		const ambient = process.env[ref];
		if (typeof ambient === "string" && ambient.length > 0) return ambient;
		return void 0;
	};

	const handler = async (req, res) => {
		let pathname;
		try {
			pathname = new URL(req.url ?? "/", "http://x").pathname;
		} catch {
			json(res, 400, { ok: false, error: "bad-request", message: "invalid URL" });
			return;
		}
		if (req.method !== "GET" || pathname !== "/dsh-balance/query") {
			json(res, 404, { ok: false, error: "not-found" });
			return;
		}

		const { apiKeyEnv, baseURL } = resolveConnection();
		const key = await resolveKey(apiKeyEnv);
		if (key === void 0) {
			json(res, 200, {
				ok: false,
				error: "missing-key",
				message: `未找到 API Key（${apiKeyEnv}）。请先在「设置 → 模型」中配置，或在环境变量中设置。`
			});
			return;
		}

		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
		try {
			const resp = await fetch(`${baseURL}/user/balance`, {
				method: "GET",
				headers: { authorization: `Bearer ${key}` },
				signal: controller.signal
			});
			const text = await resp.text();
			let body = null;
			try {
				body = JSON.parse(text);
			} catch {
				/* non-JSON body */
			}
			if (!resp.ok) {
				json(res, 200, {
					ok: false,
					error: "http",
					status: resp.status,
					message: body?.error?.message ?? `余额接口返回 HTTP ${resp.status}`
				});
				return;
			}
			json(res, 200, { ok: true, data: body ?? {} });
		} catch (error) {
			const aborted = error?.name === "AbortError";
			json(res, 200, {
				ok: false,
				error: aborted ? "timeout" : "transport",
				message: aborted
					? `请求超时（${REQUEST_TIMEOUT_MS / 1000}s）：${baseURL}/user/balance`
					: `请求失败：${String(error?.message ?? error)}`
			});
		} finally {
			clearTimeout(timer);
		}
	};

	const disposer = ctx.webServer.register({ kind: "prefix", path: "/dsh-balance", handler });
	return () => disposer();
}

export { apply, inject, name };
