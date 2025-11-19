import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { chdir, platform } from "node:process";
import { parseArgs } from "node:util";

// Bun doesn't have APIs for directory I/O yet

const BUNDLE_ZIP = "https://gitlab.com/antora/antora-ui-default/-/jobs/artifacts/HEAD/raw/build/ui-bundle.zip?job=bundle-stable";
const BUNDLE_DEST = "./build/bundle-source";
const BUNDLE_FILE = `${BUNDLE_DEST}/bundle.zip`;
const BUNDLE_PATCHED = "./build/bundle";

chdir((await Bun.$`git rev-parse --show-toplevel`.text()).trim());

const { values } = parseArgs({
	args: Bun.argv.slice(2),
	options: {
		fetch: { type: "boolean" },
		prod: { type: "boolean" },
		local: { type: "boolean" },
	},
});

if (values.fetch || !existsSync(BUNDLE_DEST)) {
	console.info("Downloading UI bundle");
	if (existsSync(BUNDLE_DEST)) rmSync(BUNDLE_DEST, { recursive: true });
	mkdirSync(BUNDLE_DEST, { recursive: true });
	await Bun.write(BUNDLE_FILE, await fetch(BUNDLE_ZIP));

	console.info("Extracting UI bundle");
	if (platform === "win32") await Bun.$`tar.exe -xf ${BUNDLE_FILE} -C ${BUNDLE_DEST}`;
	else await Bun.$`unzip -o ${BUNDLE_FILE} -d ${BUNDLE_DEST}`;
	await Bun.file(BUNDLE_FILE).unlink();
}

console.info("Copying UI bundle");
if (existsSync(BUNDLE_PATCHED)) rmSync(BUNDLE_PATCHED, { recursive: true });
cpSync(BUNDLE_DEST, BUNDLE_PATCHED, { recursive: true });

console.info("Patching UI bundle");
await Bun.$`bun x ast-grep scan ${BUNDLE_PATCHED} --update-all -c src/sgconfig.yml`;

console.info("Running Anatora");
const local = values.local ? "local-" : "";
const cmd = { raw: `bun x antora src/${local}antora-playbook.yml --stacktrace --attribute env=` };
if (values.prod) await Bun.$`${cmd}prod --html-url-extension-style drop`;
else await Bun.$`${cmd}dev`;
