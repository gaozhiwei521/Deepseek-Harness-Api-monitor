// Offline unit test for dsh-api-balance node half.
// Mocks ctx (webServer.register / credentials / settings) and global.fetch.
import { apply } from "../lib/index.js";

let failures = 0;
function check(label, cond, extra) {
	if (cond) {
		console.log(`  ok  ${label}`);
	} else {
		failures++;
		console.log(`FAIL  ${label}${extra ? " — " + JSON.stringify(extra) : ""}`);
	}
}

// --- fake plumbing ---
function makeReq(method, url) {
	return {
		method,
		url,
		headers: {},
		on() {}
	};
}
function makeRes() {
	const res = {
		status: 0,
		body: "",
		writeHead(s, h) { this.status = s; this.head = h; },
		end(data) { this.body = data || ""; }
	};
	return res;
}

async function run() {
	// Case A: missing key
	{
		const routes = [];
		const credentials = { resolve: async () => void 0 };
		const ctx = {
			get: (n) => (n === "credentials" ? credentials : n === "settings" ? void 0 : void 0),
			webServer: { register: (r) => { routes.push(r); return () => {}; } }
		};
		apply(ctx, {});
		const handler = routes.find((r) => r.path === "/dsh-balance").handler;
		const res = makeRes();
		await handler(makeReq("GET", "/dsh-balance/query"), res);
		const body = JSON.parse(res.body);
		check("missing key -> ok:false missing-key", res.status === 200 && body.ok === false && body.error === "missing-key", body);
	}

	// Case B: success
	{
		const routes = [];
		const credentials = { resolve: async () => ({ value: "sk-test-123" }) };
		const ctx = {
			get: (n) => (n === "credentials" ? credentials : n === "settings" ? void 0 : void 0),
			webServer: { register: (r) => { routes.push(r); return () => {}; } }
		};
		apply(ctx, {});
		const handler = routes.find((r) => r.path === "/dsh-balance").handler;
		global.fetch = async (url, opts) => {
			check("fetch url is baseURL/user/balance", url === "https://api.deepseek.com/user/balance", url);
			check("auth header carries bearer", opts.headers.authorization === "Bearer sk-test-123", opts.headers);
			return new Response(JSON.stringify({
				is_available: true,
				balance_infos: [{ currency: "CNY", total_balance: "110.00", granted_balance: "10.00", topped_up_balance: "100.00" }]
			}), { status: 200, headers: { "content-type": "application/json" } });
		};
		const res = makeRes();
		await handler(makeReq("GET", "/dsh-balance/query"), res);
		const body = JSON.parse(res.body);
		check("success -> ok:true", body.ok === true, body);
		check("balance data intact", body.data.balance_infos[0].total_balance === "110.00", body.data);
	}

	// Case C: upstream HTTP error (e.g., 401)
	{
		const routes = [];
		const credentials = { resolve: async () => ({ value: "sk-bad" }) };
		const ctx = {
			get: (n) => (n === "credentials" ? credentials : n === "settings" ? void 0 : void 0),
			webServer: { register: (r) => { routes.push(r); return () => {}; } }
		};
		apply(ctx, {});
		const handler = routes.find((r) => r.path === "/dsh-balance").handler;
		global.fetch = async () => new Response(JSON.stringify({ error: { message: "Authentication Fails" } }), { status: 401 });
		const res = makeRes();
		await handler(makeReq("GET", "/dsh-balance/query"), res);
		const body = JSON.parse(res.body);
		check("http error -> ok:false http with upstream message", body.ok === false && body.error === "http" && body.status === 401 && /Authentication/.test(body.message), body);
	}

	// Case D: settings llm-deepseek override (apiKeyEnv + baseURL from user section)
	{
		const routes = [];
		const credentials = { resolve: async (ref) => ({ value: `key-for-${ref}` }) };
		const settings = {
			describe: () => [
				{ ns: "llm-deepseek", user: { apiKeyEnv: "MY_CUSTOM_KEY", baseURL: "https://custom.example" } }
			]
		};
		const ctx = {
			get: (n) => (n === "credentials" ? credentials : n === "settings" ? settings : void 0),
			webServer: { register: (r) => { routes.push(r); return () => {}; } }
		};
		apply(ctx, {});
		const handler = routes.find((r) => r.path === "/dsh-balance").handler;
		global.fetch = async (url, opts) => {
			check("settings override baseURL used", url === "https://custom.example/user/balance", url);
			check("settings override apiKeyEnv used", opts.headers.authorization === "Bearer key-for-MY_CUSTOM_KEY", opts.headers);
			return new Response(JSON.stringify({ is_available: true, balance_infos: [] }), { status: 200 });
		};
		const res = makeRes();
		await handler(makeReq("GET", "/dsh-balance/query"), res);
		const body = JSON.parse(res.body);
		check("override success", body.ok === true, body);
	}

	// Case E: transport failure
	{
		const routes = [];
		const credentials = { resolve: async () => ({ value: "sk-x" }) };
		const ctx = {
			get: (n) => (n === "credentials" ? credentials : n === "settings" ? void 0 : void 0),
			webServer: { register: (r) => { routes.push(r); return () => {}; } }
		};
		apply(ctx, {});
		const handler = routes.find((r) => r.path === "/dsh-balance").handler;
		global.fetch = async () => { throw new Error("ENOTFOUND api.deepseek.com"); };
		const res = makeRes();
		await handler(makeReq("GET", "/dsh-balance/query"), res);
		const body = JSON.parse(res.body);
		check("transport error -> ok:false transport", body.ok === false && body.error === "transport", body);
	}

	// Case F: usage route -> local aggregation (no provider call, no key needed)
	{
		const routes = [];
		const ctx = {
			get: (n) => void 0,
			webServer: { register: (r) => { routes.push(r); return () => {}; } }
		};
		apply(ctx, {});
		const handler = routes.find((r) => r.path === "/dsh-balance").handler;
		const res = makeRes();
		await handler(makeReq("GET", "/dsh-balance/usage"), res);
		const body = JSON.parse(res.body);
		check("usage ok:true (local aggregation)", body.ok === true, body);
		check(
			"usage returns numeric shape",
			body.data &&
				typeof body.data.sessions === "number" &&
				typeof body.data.totalTokens === "number" &&
				typeof body.data.todayTokens === "number" &&
				typeof body.data.records === "number",
			body.data
		);
	}

	// Case G: unknown route -> 404
	{
		const routes = [];
		const credentials = { resolve: async () => ({ value: "sk-x" }) };
		const ctx = {
			get: (n) => (n === "credentials" ? credentials : n === "settings" ? void 0 : void 0),
			webServer: { register: (r) => { routes.push(r); return () => {}; } }
		};
		apply(ctx, {});
		const handler = routes.find((r) => r.path === "/dsh-balance").handler;
		const res = makeRes();
		await handler(makeReq("GET", "/dsh-balance/nope"), res);
		const body = JSON.parse(res.body);
		check("unknown route -> 404 not-found", res.status === 404 && body.error === "not-found", body);
	}

	console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} TEST(S) FAILED`);
	process.exit(failures === 0 ? 0 : 1);
}

run().catch((e) => { console.error(e); process.exit(1); });
