// dsh-api-balance — node half
// Registers loopback HTTP routes that resolve the DeepSeek API key through
// the credentials seam (same apiKeyEnv / baseURL the llm-deepseek adapter
// uses) and query the provider balance endpoint. The browser never sees the
// key: only this host route talks to api.deepseek.com.
//
// Routes:
//   GET /dsh-balance/query  -> { ok: true, data: { is_available, balance_infos: [...] } }
//   GET /dsh-balance/usage  -> { ok: true, data: local token usage aggregated
//                                from DSH session logs (real per-call usage,
//                                not a provider API that does not exist) }
//   -> { ok: false, error, message }
//
// DeepSeek exposes no usage API (GET /user/usage is 404), so "消耗" comes from
// the account's own DSH session logs: every assistant message carries the real
// token usage the provider returned (input/output/cacheRead/reasoning).
import { zstdDecompressSync } from "node:zlib";
import { readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const name = "api-balance";
const inject = ["webServer"];

const DEFAULT_API_KEY_ENV = "DEEPSEEK_API_KEY";
const DEFAULT_BASE_URL = "https://api.deepseek.com";
const LLM_NS = "llm-deepseek";
const REQUEST_TIMEOUT_MS = 15000;

const BALANCE_ROUTE = "/dsh-balance/query";
const USAGE_ROUTE = "/dsh-balance/usage";
const USAGE_CACHE_TTL_MS = 60000;
const ZSTD_MAGIC = 4247762216; // 0xFD2FB528, little-endian in file

function json(res, status, body) {
	const data = JSON.stringify(body);
	res.writeHead(status, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store"
	});
	res.end(data);
}

// ---- local token usage aggregation ----

function sessionsRoot() {
	return process.env.DSH_HOME
		? join(process.env.DSH_HOME, "sessions")
		: join(homedir(), ".dsh", "sessions");
}

/** DSH session logs are multi-frame zstd: scan frame headers, decompress each. */
function scanZstdFrames(buffer) {
	const frames = [];
	let offset = 0;
	while (offset < buffer.length) {
		const start = offset;
		if (buffer.length - offset < 4) break;
		if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) break;
		offset += 4;
		const descriptor = buffer.readUInt8(offset);
		offset += 1;
		const contentSizeFlag = descriptor >>> 6;
		const singleSegment = (descriptor & 32) !== 0;
		const checksum = (descriptor & 4) !== 0;
		const dictionaryFlag = descriptor & 3;
		const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
		const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : (1 << contentSizeFlag);
		offset += (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
		for (;;) {
			const blockHeader = buffer.readUIntLE(offset, 3);
			offset += 3;
			const lastBlock = (blockHeader & 1) !== 0;
			const blockType = (blockHeader >>> 1) & 3;
			const blockSize = blockHeader >>> 3;
			offset += blockType === 1 ? 1 : blockSize;
			if (lastBlock) break;
		}
		if (checksum) offset += 4;
		frames.push({ start, end: offset });
	}
	return frames;
}

function beijingDayKey(ms) {
	return new Date(ms + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function zeroTotals() {
	return {
		sessions: 0,
		records: 0,
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		reasoningTokens: 0,
		totalTokens: 0,
		todayTokens: 0
	};
}

function sumUsage(u) {
	return (u.inputTokens ?? 0) + (u.outputTokens ?? 0) + (u.cacheReadTokens ?? 0) + (u.reasoningTokens ?? 0);
}

// Walk $DSH_HOME/sessions/<workspace>/session-* / session.jsonl.zstd and tally usage.
function aggregateLocalUsage() {
	const totals = zeroTotals();
	const root = sessionsRoot();
	const todayKey = beijingDayKey(Date.now());
	let workspaces;
	try {
		workspaces = readdirSync(root, { withFileTypes: true });
	} catch {
		return totals; // no session data yet — empty, not an error
	}
	for (const ws of workspaces) {
		if (!ws.isDirectory()) continue;
		const wsDir = join(root, ws.name);
		let sessions;
		try {
			sessions = readdirSync(wsDir, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const s of sessions) {
			if (!s.isDirectory() || !s.name.startsWith("session-")) continue;
			const file = join(wsDir, s.name, "session.jsonl.zstd");
			totals.sessions += 1;
			let buf;
			try {
				buf = readFileSync(file);
			} catch {
				continue;
			}
			let text = "";
			try {
				for (const f of scanZstdFrames(buf)) {
					text += zstdDecompressSync(buf.subarray(f.start, f.end)).toString("utf8");
				}
			} catch {
				continue; // corrupt/unreadable session — skip, keep others
			}
			for (const line of text.split("\n")) {
				const t = line.trim();
				if (t === "") continue;
				let r;
				try {
					r = JSON.parse(t);
				} catch {
					continue;
				}
				if (!r || !r.data) continue;
				const usage = r.data.usage || (r.data.chunk && r.data.chunk.usage);
				if (!usage) continue;
				totals.records += 1;
				const input = usage.inputTokens ?? 0;
				const output = usage.outputTokens ?? 0;
				const cache = usage.cacheReadTokens ?? 0;
				const reason = usage.reasoningTokens ?? 0;
				const sum = input + output + cache + reason;
				totals.totalTokens += sum;
				totals.inputTokens += input;
				totals.outputTokens += output;
				totals.cacheReadTokens += cache;
				totals.reasoningTokens += reason;
				const at = typeof r.time === "number" ? r.time : Date.now();
				if (beijingDayKey(at) === todayKey) totals.todayTokens += sum;
			}
		}
	}
	return totals;
}

const usageCache = { at: 0, data: null };
function localUsage() {
	if (Date.now() - usageCache.at > USAGE_CACHE_TTL_MS) {
		try {
			usageCache.data = aggregateLocalUsage();
			usageCache.at = Date.now();
		} catch {
			/* keep last known-good */
		}
	}
	return usageCache.data ?? aggregateLocalUsage();
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
		if (req.method !== "GET") {
			json(res, 404, { ok: false, error: "not-found" });
			return;
		}

		// Local usage needs no provider call and no key.
		if (pathname === USAGE_ROUTE) {
			json(res, 200, { ok: true, data: localUsage() });
			return;
		}
		if (pathname !== BALANCE_ROUTE) {
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
