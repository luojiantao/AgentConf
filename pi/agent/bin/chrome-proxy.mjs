#!/usr/bin/env node
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const skillScript = path.join(
	os.homedir(),
	".pi",
	"agent",
	"skills",
	"chrome-proxy",
	"scripts",
	"chrome-proxy.mjs",
);
await import(pathToFileURL(skillScript).href);
