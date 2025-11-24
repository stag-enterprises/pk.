import { $ as sh, file, write, argv } from "bun"; 
import { cpSync as cp, existsSync as exists, mkdirSync as mkdir, rmSync as rm, promises } from "node:fs";
import { chdir, platform } from "node:process";
import { parseArgs } from "node:util";
const { glob } = promises;

const BUNDLE_ZIP = "https://gitlab.com/antora/antora-ui-default/-/jobs/artifacts/HEAD/raw/build/ui-bundle.zip?job=bundle-stable";
const BUNDLE_DEST = "./build/bundle-source";
const BUNDLE_FILE = `${BUNDLE_DEST}/bundle.zip`;
const BUNDLE_PATCHED = "./build/bundle";

const rmrf = x => rm(x, { recursive: true, force: true });

chdir((await sh`git rev-parse --show-toplevel`.text()).trim());

const { values } = parseArgs({
  args: argv.slice(2),
  options: {
    fetch: { type: "boolean" },
    prod: { type: "boolean" },
    local: { type: "boolean" },
  },
});

// this can be ran in parallel
console.info("Transpiling TypeScript");
const typescript = sh`bun x tsc`.nothrow();

if (values.fetch || !exists(BUNDLE_DEST)) {
  console.info("Downloading UI bundle");
  rmrf(BUNDLE_DEST);
  mkdir(BUNDLE_DEST, { recursive: true });
  await write(BUNDLE_FILE, await fetch(BUNDLE_ZIP));

  console.info("Extracting UI bundle");
  if (platform === "win32") await sh`tar.exe -xf ${BUNDLE_FILE} -C ${BUNDLE_DEST}`;
  else await sh`unzip -o ${BUNDLE_FILE} -d ${BUNDLE_DEST}`;
  await file(BUNDLE_FILE).unlink();
}

console.info("Copying UI bundle");
rmrf(BUNDLE_PATCHED);
cp(BUNDLE_DEST, BUNDLE_PATCHED, { recursive: true });

console.info("Patching UI bundle");
await sh`bun x ast-grep scan ${BUNDLE_PATCHED} --update-all -c src/sgconfig.yml`;

await typescript;

console.info("Running Anatora");
const local = values.local ? "local-" : "";
const cmd = { raw: `bun x antora src/${local}antora-playbook.yml --log-level=info --log-format=pretty --stacktrace --attribute env=`, };
if (values.prod) await sh`${cmd}prod --html-url-extension-style=drop`;
else await sh`${cmd}dev`;

if (values.prod) {
  // these are optional dependencies
  async function tryImport(module) {
    try { return await import(module); }
    catch (e) {
      console.error(e);
      throw new Error(`Module ${module} not installed`);
    }
  }

  const { minify: minifyHtml } = await tryImport("@minify-html/node");
  const { minify: minifyJs } = await tryImport("@swc/core");
  const { minify: minifyCss } = await tryImport("csso");
  const { optimize: minifySvg } = await tryImport("svgo");
  const { minify: minifyXml } = await tryImport("minify-xml");

  console.info("Minifying output");

  // globs all files with $ext, reads it as $format, calls $fn with $opts,
  // and writes it with the value of $prop
  async function minify(ext, format, fn, prop, opts) {
    // proposal-async-iterator-helpers provides AsyncIterator.map
    // but it's not supported yet so this eyesore is needed
    let promises = [];
    for await (const fileName of glob(`build/site/**/*.${ext}`, { exclude: [
      `build/site/**/_attachments/**/*.${ext}`,
      `build/site/**/_images/**/*.${ext}`,
    ]}))
      promises.push((async () => {
        const fileObj = file(fileName);
        let content;
        if (format === "string") content = await fileObj.text();
        else if (format === "Buffer") content = Buffer.from(await fileObj.arrayBuffer());
        let minified = await fn(content, opts);
        if (prop !== null) minified = minified[prop];
        return write(fileName, minified);
      })());
    await Promise.all(promises);
    console.info(`Minified ${ext}`);
  }

  await Promise.all([
    minify("html", "Buffer", minifyHtml, null, {
      minify_css: true,
      minify_js: true,
      remove_processing_instructions: true,
    }),
    minify("js", "string", minifyJs, "code", {
      ecma: "2021",
      mangle: true,
      compress: true,
    }),
    minify("css", "string", minifyCss, "css", { comments: false }),
    minify("svg", "string", minifySvg, "data", { multipass: true }),
    minify("xml", "string", minifyXml, null, { trimWhitespaceFromTexts: true }),
  ]);
}
