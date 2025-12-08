import { $ as sh, file, write, argv, env, stdout } from "bun";
import { promises, existsSync } from "node:fs";
import { chdir, platform } from "node:process";
import { parseArgs } from "node:util";
const { glob, rm, mkdir, cp } = promises;

const BUNDLE_ZIP = "https://gitlab.com/antora/antora-ui-default/-/jobs/artifacts/HEAD/raw/build/ui-bundle.zip?job=bundle-stable";
const BUNDLE_DEST = "./build/bundle-source";
const BUNDLE_FILE = `${BUNDLE_DEST}/bundle.zip`;
const BUNDLE_PATCHED = "./build/bundle";
const UI_SRC = "./src/ui";
const UI_DEST = "./build/ui";

type Writable<T> =  T extends (...args: any[]) => any
  ? T & { -readonly [P in keyof T]: Writable<T[P]> } // don't fuck up functions
  : { -readonly [P in keyof T]: Writable<T[P]> };

chdir((await sh`git rev-parse --show-toplevel`.text()).trim());

const { values: args } = parseArgs({
  args: argv.slice(2),
  options: {
    fetch: { type: "boolean" },
    prod: { type: "boolean" },
    local: { type: "boolean" },
  },
});

async function del(path: string, recreate = false): Promise<void> {
  await rm(path, { recursive: true, force: true });
  if (recreate) await mkdir(path, { recursive: true });
}

// globs all files with $ext, reads it as $format, calls $fn with $opts,
// and writes it with the value of $prop
async function minifyAll<K extends string | null, T extends "string" | "Buffer", U> (
  ext: string,
  format: T,
  fn: (
    data: T extends "string" ? string : Buffer,
    ...opts: U extends undefined ? [] : [opts: U]
  ) => Promise<K extends string ? { [key in K]: string | Buffer } : string | Buffer> |
       (K extends string ? { [key in K]: string | Buffer } : string | Buffer),
  prop: K,
  opts: U,
): Promise<void> {
  // proposal-async-iterator-helpers provides AsyncIterator.map
  // but it's not supported yet so this eyesore is needed
  let promises = [];
  for await (const fileName of glob(`build/site/**/*.${ext}`, { exclude: [
    `build/site/**/_attachments/**/*.${ext}`,
    `build/site/**/_images/**/*.${ext}`,
  ]}))
    promises.push((async () => {
      const fileObj = file(fileName);
      let minified =
        // @ts-expect-error typescript is stupid and
        // can't figure the sig of fn out from format === "string"
        format === "string" ? await fn(await fileObj.text(), opts) :
        // @ts-expect-error
        format === "Buffer" ? await fn(Buffer.from(await fileObj.arrayBuffer()), opts)
        : null;
      if (minified === null) return;
      // @ts-expect-error typescript is also stupid here
      await write(fileName, prop !== null ? minified[prop] : minified);
    })());
  await Promise.all(promises);
}

type Tasks<K extends string | number | symbol> = Record<K, {
  name: string;
  needs?: Array<K>;
  needed?: boolean;
  action: () => Promise<any>;
}>;

const tasks_ = {
  typescript: {
    name: "transpiling TypeScript",
    action: () => sh`bun x tsc`.nothrow(),
  },
  copyUi: {
    name: "copying supplemental UI",
    action: () => cp(UI_SRC, UI_DEST, { recursive: true }),
  },
  bundleUi: {
    name: "bundling supplemental UI",
    needs: ["copyUi"],
    action: async () => Bun.build({
      entrypoints: await Array.fromAsync(glob("src/ui/**/*.{js,css}")),
      outdir: UI_DEST,
      // not actually commonjs but using "esm" forces <script> to use type=module
      // which breaks certain scripts
      format: "cjs",
    }),
  },
  downloadBundle: {
    name: "downloading UI bundle",
    needed: args.fetch || !existsSync(BUNDLE_DEST),
    async action() {
      await del(BUNDLE_DEST, true);
      await write(BUNDLE_FILE, await fetch(BUNDLE_ZIP));
    },
  },
  extractBundle: {
    name: "extracting UI bundle",
    needs: ["downloadBundle"],
    get needed() { return tasks_.downloadBundle.needed },
    async action() {
      if (env["GITHUB_ACTIONS"]) stdout.write("::group::");
      if (platform === "win32") await sh`tar.exe -xf ${BUNDLE_FILE} -C ${BUNDLE_DEST}`;
      else await sh`unzip -o ${BUNDLE_FILE} -d ${BUNDLE_DEST}`;
      if (env["GITHUB_ACTIONS"]) console.info("::endgroup::");
      await file(BUNDLE_FILE).unlink();
    },
  },
  copyBundle: {
    name: "copying UI bundle",
    needs: ["extractBundle"],
    async action() {
      await del(BUNDLE_PATCHED, true);
      await cp(BUNDLE_DEST, BUNDLE_PATCHED, { recursive: true });
    },
  },
  patchBundle: {
    name: "patching UI bundle",
    needs: ["copyBundle"],
    action: () => sh`bun x ast-grep scan ${BUNDLE_PATCHED} --update-all -c src/sgconfig.yml`
  },
  antora: {
    name: "running Antora",
    needs: ["bundleUi", "typescript", "patchBundle"],
    async action() {
      const local = args.local ? "local-" : "";
      const cmd = {
        raw: `bun x antora src/${local}antora-playbook.yml` +
          " --log-level=info --log-format=pretty" +
          " --stacktrace --attribute env="
      };
      if (args.prod) await sh`${cmd}prod --html-url-extension-style=drop`;
      else await sh`${cmd}dev`;
    },
  },
  minifyHtml: {
    name: "minifying HTML",
    needs: ["antora"],
    needed: Boolean(args.prod),
    async action() {
      const { minify } = await import("@minify-html/node");
      await minifyAll("html", "Buffer", minify, null, {
        minify_css: true,
        minify_js: true,
        remove_processing_instructions: true,
      });
    },
  },
  minifyCss: {
    name: "minifying CSS",
    needs: ["antora"],
    needed: Boolean(args.prod),
    async action() {
      const { minify } = await import("csso");
      await minifyAll("css", "string", minify, "css", { comments: false });
    },
  },
  minifyJs: {
    name: "minifying JS",
    needs: ["antora"],
    needed: Boolean(args.prod),
    async action() {
      const { minify } = await import("@swc/core");
      await minifyAll("js", "string", minify, "code", {
        ecma: "2021",
        mangle: true,
        compress: true,
      });
    },
  },
  minifySvg: {
    name: "minifying SVG",
    needs: ["antora"],
    needed: Boolean(args.prod),
    async action() {
      const { optimize } = await import("svgo");
      await minifyAll("svg", "string", optimize, "data", { multipass: true });
    },
  },
  minifyXml: {
    name: "minifying XML",
    needs: ["antora"],
    needed: Boolean(args.prod),
    async action() {
      // defaultOptions isn't really needed but the package types are broken
      const { minify, defaultOptions } = await import("minify-xml");
      await minifyAll("xml", "string", minify, null, { ...defaultOptions, trimWhitespaceFromTexts: true });
    },
  },
} as const;
// ensure type safety
const tasks: Tasks<keyof typeof tasks_> = tasks_ as unknown as Writable<typeof tasks_>;

const running = new Map();
async function runTask(id: keyof typeof tasks) {
  if (running.has(id)) return running.get(id);
  const task = tasks[id];
  if (!task) return;
  const { name, action, needed = true, needs = [] } = task;
  if (!needed) return;

  const runner = (async () => {
    await Promise.all(needs.map(runTask));
    console.log(name.charAt(0).toUpperCase() + name.slice(1));
    await action();
    console.log("Finished " + name);
  })();
  running.set(id, runner);
  return runner;
}
await Promise.all((Object.keys(tasks) as Array<keyof typeof tasks>).map(runTask));
