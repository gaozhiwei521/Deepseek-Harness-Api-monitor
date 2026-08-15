// dsh-api-balance — client half
// Registers a "API 余额" section inside the Settings panel (settings.section
// slot). The UI is a plain React component styled with the global design
// tokens (--dsw-alias-*) so it matches the shipped dark theme, plus the
// workspace fx.css effects that already style the whole app.
//
// Data sources (host loopback, key never leaves the backend):
//   GET /dsh-balance/query -> { is_available, balance_infos: [{ currency, total_balance, granted_balance, topped_up_balance }] }
//   GET /dsh-balance/usage -> { is_available, usage_infos: [{ currency, total_usage, today_usage, ... }] }
// The old "已消耗（估算）" guess is gone: consumption now comes from the real
// /user/usage fields. "赠送余额" is hidden when the account has none (0).
window.__ModuleLoader__.load({
	id: "dsh-api-balance",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");

		// ---- scoped styles (global theme tokens) ----
		const CSS = `
.dshab_section{max-width:720px;color:var(--dsw-alias-label-primary);flex-direction:column;gap:12px;display:flex}
.dshab_title{color:var(--dsw-alias-label-primary);margin:0;font-size:16px;font-weight:500;line-height:24px}
.dshab_intro{color:var(--dsw-alias-label-tertiary);margin:0;font-size:14px;line-height:22px}
.dshab_card{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-module-platform);border-radius:12px;flex-direction:column;gap:14px;padding:14px 16px;display:flex}
.dshab_balanceRow{align-items:center;gap:12px;display:flex}
.dshab_balanceNumber{color:var(--dsw-alias-label-primary);font-size:30px;font-weight:600;line-height:36px;letter-spacing:.3px}
.dshab_balanceCurrency{color:var(--dsw-alias-label-tertiary);font-size:14px;line-height:22px}
.dshab_badge{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-secondary);border-radius:4px;flex:none;padding:1px 6px;font-size:11px;line-height:16px}
.dshab_badgeOk{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary)}
.dshab_badgeErr{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
.dshab_detail{border-top:1px solid var(--dsw-alias-border-l2);flex-direction:column;gap:2px;padding-top:10px;display:flex}
.dshab_detailLabel{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.dshab_detailValue{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:500;line-height:22px}
.dshab_detailValueDim{color:var(--dsw-alias-label-secondary);font-size:15px;font-weight:500;line-height:22px}
.dshab_toolbar{align-items:center;gap:10px;display:flex}
.dshab_refreshBtn{box-sizing:border-box;height:36px;color:var(--dsw-alias-label-primary-foreground);font:inherit;cursor:pointer;border:none;border-radius:18px;justify-content:center;align-items:center;gap:6px;padding:0 16px;font-size:14px;line-height:22px;display:inline-flex;background:var(--dsw-alias-button-primary-fill)}
.dshab_refreshBtn:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
.dshab_refreshBtn:disabled{opacity:.4;cursor:default}
.dshab_refreshBtn:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-border-l3);outline:none}
.dshab_timestamp{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
.dshab_error{color:var(--dsw-alias-state-error-primary);margin:0;font-size:12px;line-height:18px}
.dshab_loading{color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px;line-height:20px}
.dshab_empty{color:var(--dsw-alias-label-tertiary);margin:0;font-size:13px;line-height:20px}
.dshab_hint{color:var(--dsw-alias-label-dimmed);margin:0;font-size:12px;line-height:18px}
.dshab_usageRow{align-items:baseline;gap:8px;display:flex;flex-wrap:wrap}
.dshab_usageValue{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:500;line-height:22px}
.dshab_usageLabel{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}`;

		function mountStyle() {
			const id = "dsh-api-balance-style";
			if (document.getElementById(id)) return;
			const style = document.createElement("style");
			style.id = id;
			style.textContent = CSS;
			document.head.appendChild(style);
		}

		// ---- helpers ----
		function fmtBalance(value) {
			const n = typeof value === "number" ? value : parseFloat(value);
			if (!Number.isFinite(n)) return "—";
			return `¥${n.toFixed(2)}`;
		}

		function fmtTokens(value) {
			const n = typeof value === "number" ? value : parseInt(value, 10);
			if (!Number.isFinite(n)) return "—";
			if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
			if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
			return String(n);
		}

		function timeLabel(at) {
			if (!at) return "";
			const d = new Date(at);
			const pad = (x) => String(x).padStart(2, "0");
			return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
		}

		// ---- data hook (balance + usage in one refresh) ----
		function useBalanceData() {
			const [snap, setSnap] = react.useState({ status: "loading", balance: null, usage: null, error: null, at: null });
			const refresh = react.useCallback(async () => {
				setSnap((s) => ({ ...s, status: "loading" }));
				let balance = null;
				let usage = null;
				let error = null;
				try {
					const resp = await fetch("/dsh-balance/query", { cache: "no-store" });
					const body = await resp.json();
					if (body && body.ok) {
						balance = body.data;
					} else {
						error = body && body.message ? body.message : "余额接口返回异常";
					}
				} catch (err) {
					error = String((err && err.message) || err);
				}
				// Usage is a bonus view: its failure must not hide the balance.
				if (!error) {
					try {
						const resp2 = await fetch("/dsh-balance/usage", { cache: "no-store" });
						const body2 = await resp2.json();
						if (body2 && body2.ok) usage = body2.data;
					} catch {
						/* usage unavailable — keep balance view */
					}
				}
				setSnap({ status: "done", balance, usage, error, at: Date.now() });
			}, []);
			react.useEffect(() => {
				refresh();
			}, [refresh]);
			return { snap, refresh };
		}

		// ---- UI ----
		function BalanceSection() {
			const { snap, refresh } = useBalanceData();
			const infos = snap.balance && Array.isArray(snap.balance.balance_infos) ? snap.balance.balance_infos : [];
			const usageInfos = snap.usage && Array.isArray(snap.usage.usage_infos) ? snap.usage.usage_infos : [];
			const available = snap.balance && typeof snap.balance.is_available === "boolean" ? snap.balance.is_available : void 0;
			const usage = usageInfos.length > 0 ? usageInfos[0] : null;
			const loading = snap.status === "loading";
			return react.createElement(
				"section",
				{ className: "dshab_section" },
				react.createElement("h2", { className: "dshab_title" }, "API 余额与用量"),
				react.createElement("p", { className: "dshab_intro" }, "实时查询已配置供应商的账户余额与用量。数据来自服务端直连查询，API Key 不会进入浏览器。"),
				react.createElement(
					"div",
					{ className: "dshab_toolbar" },
					react.createElement(
						"button",
						{ type: "button", className: "dshab_refreshBtn", onClick: refresh, disabled: loading },
						loading ? "刷新中…" : "刷新"
					),
					snap.at ? react.createElement("span", { className: "dshab_timestamp" }, `上次更新：${timeLabel(snap.at)}`) : null
				),
				loading && !snap.at
					? react.createElement("p", { className: "dshab_loading" }, "正在查询余额…")
					: null,
				snap.error
					? react.createElement(
							"div",
							{ className: "dshab_card" },
							react.createElement("p", { className: "dshab_error" }, snap.error)
						)
					: null,
				!loading && !snap.error && infos.length === 0
					? react.createElement("p", { className: "dshab_empty" }, "没有可显示的余额信息。")
					: null,
				infos.map((info, index) =>
					react.createElement(
						"div",
						{ className: "dshab_card", key: String(index) },
						react.createElement("span", { className: "dshab_detailLabel" }, "可用额度"),
						react.createElement(
							"div",
							{ className: "dshab_balanceRow" },
							react.createElement("span", { className: "dshab_balanceNumber" }, fmtBalance(info.total_balance)),
							react.createElement("span", { className: "dshab_balanceCurrency" }, info.currency || "CNY"),
							available === void 0
								? null
								: react.createElement(
										"span",
										{ className: `dshab_badge ${available ? "dshab_badgeOk" : "dshab_badgeErr"}` },
										available ? "可用" : "不可用"
									)
						)
					)
				),
				usage
					? react.createElement(
							"div",
							{ className: "dshab_card" },
							react.createElement("span", { className: "dshab_detailLabel" }, "用量（来自本地会话记录）"),
							react.createElement(
								"div",
								{ className: "dshab_usageRow" },
								react.createElement(
									"div",
									{ className: "dshab_detail" },
									react.createElement("span", { className: "dshab_detailLabel" }, "累计 Tokens"),
									react.createElement("span", { className: "dshab_detailValue" }, fmtTokens(usage.totalTokens))
								),
								react.createElement(
									"div",
									{ className: "dshab_detail" },
									react.createElement("span", { className: "dshab_detailLabel" }, "今日 Tokens"),
									react.createElement("span", { className: "dshab_detailValue" }, fmtTokens(usage.todayTokens))
								),
								react.createElement(
									"div",
									{ className: "dshab_detail" },
									react.createElement("span", { className: "dshab_detailLabel" }, "会话数"),
									react.createElement("span", { className: "dshab_detailValueDim" }, String(usage.sessions))
								),
								react.createElement(
									"div",
									{ className: "dshab_detail" },
									react.createElement("span", { className: "dshab_detailLabel" }, "用量记录"),
									react.createElement("span", { className: "dshab_detailValueDim" }, String(usage.records))
								)
							)
						)
					: null,
				react.createElement("p", { className: "dshab_hint" }, "消耗为真实 Token 用量：由本地会话记录中的每次调用 usage（输入/输出/缓存/推理）汇总，非估算。余额以供应商账户页为准。")
			);
		}

		// ---- registration ----
		const apply = (ctx) => {
			mountStyle();
			ctx.slots.inject("settings.section", () =>
				ctx.slots.register(
					{
						name: "settings.section",
						id: "api-balance",
						order: 100,
						label: "API 余额"
					},
					BalanceSection
				)
			);
		};

		exports.apply = apply;
		exports.inject = ["slots"];
		return module.exports;
	}
});
