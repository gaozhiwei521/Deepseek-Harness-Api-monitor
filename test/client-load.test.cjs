// Simulate the browser module loader loading dsh-api-balance's client bundle,
// catching factory-level runtime errors before they reach the real GUI.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// --- browser-ish stubs ---
global.window = global;
global.document = {
	head: { appendChild() {} },
	getElementById: () => null,
	createElement: (tag) => ({ tag })
};
const entry = { factory: undefined };
global.__ModuleLoader__ = {
	load(e) {
		entry.factory = e.factory;
	}
};

const modules = {
	"react": new Proxy(
		{},
		{
			get(_t, key) {
				if (key === "useState") return (init) => [init, () => {}];
				if (key === "useCallback") return (fn) => fn;
				if (key === "useEffect") return () => {};
				if (key === "createElement") return (...args) => ({ type: args[0], args });
				return modules["react"];
			}
		}
	)
};

const clientSrc = fs.readFileSync(path.join(__dirname, "..", "lib", "client.js"), "utf8");
vm.runInThisContext(clientSrc);
if (typeof entry.factory !== "function") {
	console.error("FAIL: factory not captured");
	process.exit(1);
}
const mod = entry.factory((name) => {
	if (!(name in modules)) throw new Error(`require("${name}") — not stubbed`);
	return modules[name];
});

console.log("module loaded OK");
console.log("exports keys:", Object.keys(mod));
console.log("inject:", JSON.stringify(mod.inject));
if (typeof mod.apply !== "function") {
	console.error("FAIL: apply is not a function");
	process.exit(1);
}

// Simulate ctx with slots.inject capturing the registration
let captured;
const ctx = {
	slots: {
		inject(name, fn) {
			captured = { name, fn };
		},
		register(spec, component) {
			return { ...spec, component };
		}
	}
};
mod.apply(ctx);
const reg = captured.fn();
console.log("registered slot:", reg.name, "id:", reg.id, "order:", reg.order, "label:", reg.label);
if (typeof reg.component !== "function") {
	console.error("FAIL: section component is not a function");
	process.exit(1);
}
console.log("ALL CLIENT CHECKS PASSED");
