#!/usr/bin/env node
/**
 * Resolve a URL/host the way current Chrome does (无忧行 PAC),
 * then optionally fetch it with curl. Tokens stay in Chrome storage;
 * this script only prints a proxy URL at call time.
 *
 * Usage:
 *   node chrome-proxy.mjs www.google.com
 *   node chrome-proxy.mjs --json www.google.com
 *   node chrome-proxy.mjs --fetch https://www.google.com
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const JEGO_EXT_ID = "bnnamacamhjbdoimlbkegmbgkekphcbb";
const LOCAL_PROXY_PORTS = [7890, 7897, 7891, 10809, 10808, 1080, 20171, 6152];

function parseArgs(argv) {
	const out = { json: false, fetch: false, target: "", maxTime: 20 };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--json") out.json = true;
		else if (a === "--fetch") out.fetch = true;
		else if (a === "--max-time" && argv[i + 1]) out.maxTime = Number(argv[++i]);
		else if (!a.startsWith("-") && !out.target) out.target = a;
	}
	return out;
}

function hostFromTarget(target) {
	if (!target) return "";
	try {
		if (target.includes("://")) return new URL(target).hostname;
	} catch {
		/* fall through */
	}
	return target.replace(/^[a-z]+:\/\//i, "").split("/")[0].split(":")[0];
}

function extractPrintable(buf) {
	let out = "";
	for (let i = 0; i < buf.length; i++) {
		const c = buf[i];
		out += c >= 32 && c < 127 ? String.fromCharCode(c) : "\n";
	}
	return out;
}

function loadJegoPac() {
	const dir = path.join(
		process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData/Local"),
		"Google/Chrome/User Data/Default/Local Extension Settings",
		JEGO_EXT_ID,
	);
	if (!fs.existsSync(dir)) return null;

	const files = fs
		.readdirSync(dir)
		.filter((f) => f.endsWith(".log") || f.endsWith(".ldb"))
		.map((f) => ({ f, p: path.join(dir, f), mtime: fs.statSync(path.join(dir, f)).mtimeMs }))
		.sort((a, b) => a.mtime - b.mtime);

	let text = "";
	for (const file of files) {
		try {
			text += extractPrintable(fs.readFileSync(file.p)) + "\n";
		} catch {
			/* Chrome may lock a file; skip */
		}
	}
	if (!text) return null;

	const modes = [...text.matchAll(/diagnostics_proxy_mode["'\s:]*([0-9]+)/g)].map((m) => m[1]);
	const mode = modes.at(-1) ?? "0";

	const rules = new Map();
	const ruleRe =
		/"((?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}|\d+\.\d+\.\d+\.\d+)"\s*:\s*"(DIRECT|HTTPS [^"]+|PROXY [^"]+|SOCKS5? [^"]+)"/g;
	for (const m of text.matchAll(ruleRe)) {
		rules.set(m[1].toLowerCase(), m[2]);
	}

	const globals = [...text.matchAll(/"proxy"\s*:\s*"(HTTPS [^"]+|PROXY [^"]+|SOCKS5? [^"]+)"/g)].map((m) => m[1]);
	return { mode, rules, globalProxy: globals.at(-1) ?? "", source: "chrome-jego" };
}

function matchHost(host, ruleHost) {
	const h = host.toLowerCase();
	const r = ruleHost.toLowerCase();
	if (h === r) return true;
	if (h.endsWith(`.${r}`)) return true;
	if (r.includes("*")) {
		const re = new RegExp(`^${r.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`, "i");
		return re.test(h);
	}
	return false;
}

function pacToCurlProxies(pac) {
	if (!pac) return [];
	const upper = pac.trim().toUpperCase();
	if (upper === "DIRECT" || upper.startsWith("DIRECT ")) return [];
	const parts = pac
		.split(";")
		.map((s) => s.trim())
		.filter(Boolean);
	const out = [];
	for (const part of parts) {
		const m = part.match(/^(HTTPS|HTTP|PROXY|SOCKS5|SOCKS4|SOCKS)\s+(\S+)$/i);
		if (!m) continue;
		const scheme = m[1].toUpperCase();
		const hostport = m[2];
		if (scheme === "HTTPS") out.push(`https://${hostport}`);
		else if (scheme === "SOCKS5" || scheme === "SOCKS") out.push(`socks5h://${hostport}`);
		else if (scheme === "SOCKS4") out.push(`socks4://${hostport}`);
		else out.push(`http://${hostport}`);
	}
	return out;
}

function resolveFromPac(host, pac) {
	if (!pac || pac.mode === "0") {
		return { route: "direct", reason: pac ? "chrome-off" : "no-chrome-pac", proxies: [] };
	}

	let best = null;
	let bestLen = -1;
	for (const [ruleHost, value] of pac.rules) {
		if (matchHost(host, ruleHost) && ruleHost.length > bestLen) {
			best = value;
			bestLen = ruleHost.length;
		}
	}
	if (best) {
		const proxies = pacToCurlProxies(best);
		if (proxies.length === 0) return { route: "direct", reason: "rule-direct", proxies: [] };
		return { route: "proxy", reason: "chrome-rule", proxies };
	}

	if (pac.mode === "5" || pac.mode === "7") {
		const proxies = pacToCurlProxies(pac.globalProxy);
		if (proxies.length > 0) return { route: "proxy", reason: "chrome-global", proxies };
	}
	return { route: "direct", reason: "chrome-default", proxies: [] };
}

function readWindowsProxy() {
	if (process.platform !== "win32") return null;
	const r = spawnSync("reg", ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings"], {
		encoding: "utf8",
		timeout: 5000,
		windowsHide: true,
	});
	if (r.status !== 0) return null;
	const text = r.stdout || "";
	const enable = /ProxyEnable\s+REG_DWORD\s+0x1\b/i.test(text);
	const server = (text.match(/ProxyServer\s+REG_SZ\s+(\S+)/i) || [])[1];
	if (!enable || !server) return null;
	if (server.includes("=")) {
		const http = (server.match(/https?=([\w.[\]:-]+)/i) || [])[1];
		const socks = (server.match(/socks=([\w.[\]:-]+)/i) || [])[1];
		if (http) return [`http://${http}`];
		if (socks) return [`socks5h://${socks}`];
	}
	if (server.startsWith("socks")) return [`socks5h://${server.replace(/^socks5?:\/\//i, "")}`];
	return [`http://${server}`];
}

function envProxies() {
	const v =
		process.env.HTTPS_PROXY ||
		process.env.https_proxy ||
		process.env.HTTP_PROXY ||
		process.env.http_proxy ||
		process.env.ALL_PROXY ||
		process.env.all_proxy;
	return v ? [v] : [];
}

function portOpen(port, timeoutMs = 200) {
	return new Promise((resolve) => {
		const socket = net.connect({ host: "127.0.0.1", port });
		const done = (ok) => {
			socket.removeAllListeners();
			socket.destroy();
			resolve(ok);
		};
		socket.setTimeout(timeoutMs);
		socket.on("connect", () => done(true));
		socket.on("timeout", () => done(false));
		socket.on("error", () => done(false));
	});
}

async function localClashProxies() {
	for (const port of LOCAL_PROXY_PORTS) {
		if (await portOpen(port)) return [`http://127.0.0.1:${port}`];
	}
	return [];
}

function isLocalHost(host) {
	return !host || host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".local");
}

async function resolveProxy(host) {
	if (isLocalHost(host)) {
		return { host, route: "direct", reason: "localhost", proxies: [], source: "local" };
	}

	const pac = loadJegoPac();
	const chrome = resolveFromPac(host, pac);
	if (chrome.route === "proxy" && chrome.proxies.length > 0) {
		return { host, ...chrome, source: "chrome-jego", mode: pac?.mode };
	}

	const win = readWindowsProxy();
	if (win?.length) {
		return { host, route: "proxy", reason: "windows-system", proxies: win, source: "windows", mode: pac?.mode };
	}

	const env = envProxies();
	if (env.length) {
		return { host, route: "proxy", reason: "env", proxies: env, source: "env", mode: pac?.mode };
	}

	const local = await localClashProxies();
	if (local.length) {
		return { host, route: "proxy", reason: "local-port", proxies: local, source: "local-port", mode: pac?.mode };
	}

	return { host, route: chrome.route, reason: chrome.reason, proxies: [], source: chrome.reason, mode: pac?.mode };
}

function runCurl(url, proxy, maxTime, extra = []) {
	const args = [
		"-sS",
		"-L",
		"--max-time",
		String(maxTime),
		"-A",
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0.0.0",
		...extra,
	];
	if (proxy) args.push("-x", proxy);
	args.push(url);
	return spawnSync("curl", args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
}

function fetchUrl(url, resolved, maxTime) {
	const attempts = resolved.proxies.length > 0 ? resolved.proxies : [null];
	const errors = [];
	for (const proxy of attempts) {
		for (const extra of [[], ["--proxy-insecure"]]) {
			if (!proxy && extra.length) continue;
			const r = runCurl(url, proxy, maxTime, extra);
			if (r.status === 0 && r.stdout) {
				process.stderr.write(
					`[chrome-proxy] ${resolved.reason} ${proxy ?? "DIRECT"}${extra.length ? " insecure" : ""}\n`,
				);
				process.stdout.write(r.stdout);
				return 0;
			}
			errors.push(`${proxy ?? "DIRECT"}: ${(r.stderr || r.stdout || `exit ${r.status}`).trim()}`);
		}
	}
	process.stderr.write(`[chrome-proxy] fetch failed for ${url}\n${errors.join("\n")}\n`);
	process.stdout.write(`FETCH_FAILED ${url}\n${errors.join("\n")}\n`);
	return 1;
}

const args = parseArgs(process.argv.slice(2));
if (!args.target) {
	process.stderr.write("usage: chrome-proxy.mjs [--json] [--fetch] [--max-time N] <host-or-url>\n");
	process.exit(2);
}

const host = hostFromTarget(args.target);
const resolved = await resolveProxy(host);

if (args.fetch) {
	const url = args.target.includes("://") ? args.target : `https://${args.target}`;
	process.exit(fetchUrl(url, resolved, args.maxTime));
}

if (args.json) {
	process.stdout.write(`${JSON.stringify(resolved, null, 2)}\n`);
} else if (resolved.proxies[0]) {
	process.stdout.write(`${resolved.proxies[0]}\n`);
} else {
	process.stdout.write("DIRECT\n");
}
