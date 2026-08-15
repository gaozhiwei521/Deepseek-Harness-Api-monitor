// dsh-api-balance — client half
// Registers a "API 余额" section inside the Settings panel (settings.section
// slot). The UI is a plain React component styled with the global design
// tokens (--dsw-alias-*) so it matches the shipped dark theme, plus the
// workspace fx.css effects that already style the whole app.
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
.dshab_detailGrid{grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;display:grid}
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
.dshab_hint{color:var(--dsw-alias-label-dimmed);margin:0;font-size:12px;line-height:18px}`;

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

		function consumedOf(info) {
			const total = parseFloat(info.total_balance);
			const granted = parseFloat(info.granted_balance);
			const topped = parseFloat(info.topped_up_balance);
			if (![total, granted, topped].every(Number.isFinite)) return void 0;
			const used = granted + topped - total;
			return used > 0.005 ? used : 0;
		}

		function timeLabel(at) {
			if (!at) return "";
			const d = new Date(at);
			const pad = (x) => String(x).padStart(2, "0");
			return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
		}

		// ---- data hook ----
		function useBalance() {
			const [snap, setSnap] = react.useState({ status: "loading", data: null, error: null, at: null });
			const refresh = react.useCallback(async () => {
				setSnap((s) => ({ ...s, status: "loading" }));
				try {
					const resp = await fetch("/dsh-balance/query", { cache: "no-store" });
					const body = await resp.json();
					if (body && body.ok) {
						setSnap({ status: "done", data: body.data, error: null, at: Date.now() });
					} else {
						setSnap({ status: "done", data: null, error: body && body.message ? body.message : "余额接口返回异常", at: Date.now() });
					}
				} catch (err) {
					setSnap({ status: "done", data: null, error: String((err && err.message) || err), at: Date.now() });
				}
			}, []);
			react.useEffect(() => {
				refresh();
			}, [refresh]);
			return { snap, refresh };
		}

		// ---- UI ----
		function BalanceSection() {
			const { snap, refresh } = useBalance();
			const infos = snap.data && Array.isArray(snap.data.balance_infos) ? snap.data.balance_infos : [];
			const available = snap.data && typeof snap.data.is_available === "boolean" ? snap.data.is_available : void 0;
			const loading = snap.status === "loading";
			return react.createElement(
				"section",
				{ className: "dshab_section" },
				react.createElement("h2", { className: "dshab_title" }, "API 余额与用量"),
				react.createElement("p", { className: "dshab_intro" }, "实时查询已配置供应商的账户余额与可用状态。数据来自服务端直连查询，API Key 不会进入浏览器。"),
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
						),
						react.createElement(
							"div",
							{ className: "dshab_detailGrid" },
							react.createElement(
								"div",
								{ className: "dshab_detail" },
								react.createElement("span", { className: "dshab_detailLabel" }, "充值余额"),
								react.createElement("span", { className: "dshab_detailValue" }, fmtBalance(info.topped_up_balance))
							),
							react.createElement(
								"div",
								{ className: "dshab_detail" },
								react.createElement("span", { className: "dshab_detailLabel" }, "赠送余额"),
								react.createElement("span", { className: "dshab_detailValue" }, fmtBalance(info.granted_balance))
							),
							(() => {
								const used = consumedOf(info);
								return used === void 0
									? null
									: react.createElement(
											"div",
											{ className: "dshab_detail" },
											react.createElement("span", { className: "dshab_detailLabel" }, "已消耗（估算）"),
											react.createElement("span", { className: "dshab_detailValueDim" }, fmtBalance(used))
										);
							})()
						)
					)
				),
				react.createElement("p", { className: "dshab_hint" }, "已消耗为估算值（充值 + 赠送 − 当前总余额）。精确消耗以供应商账单为准。")
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
