import { cleanInsert } from "../utils";
import { exec } from "node:child_process";
import type * as T from "../antora";

const VERSION = "0.1.0";
const ALL = Symbol("all");
const LATEST = Symbol("latest");
const DEFAULT_FEED_CONFIG: FeedConfig = {
  title:      "My Atom Feed",
  tags:       [],
  maxEntries: 20,
};

interface AtomPage {
  author:       Person;
  component:    string;
  content:      string;
  contributors: Person[];
  module:       string;
  published:    string;
  tags:         string[];
  title:        string;
  updated:      string;
  url:          string;
  version:      string;
}

interface Person {
  name?:  string;
  email?: string;
}

interface FeedConfig {
  title:         string;
  name?:         string;
  tags:          string[];
  maxEntries:    number;
  author?:       Person;
  categories?:   string[];
  contributors?: Person[];
  copyright?:    string;
  description?:  string;
  icon?:         string;
  logo?:         string;
}

interface GlobalConfig {
  feedOptions?: Omit<FeedConfig, "tags">;
  defaultComponentFeeds?: FeedConfig[];
}

interface ComponentConfig {
  feedOptions?: Omit<FeedConfig, "tags">;
  componentFeeds?: FeedConfig[];
}

export const register: T.Register =
async function register({ config }): Promise<void> {
  const log = this.getLogger("antora-atom-" + VERSION);
  const globalConfig = config as GlobalConfig;

  log.info("Started");

  // in antora 3.2 this won't need a seperate step: https://gitlab.com/antora/antora/-/issues/995
  const enabledComponents: {
    name: string, version: string, config: ComponentConfig | undefined
  }[] = []; 
  this.on("contentAggregated", ({ contentAggregate }: T.ContentAggregated) => {
    for (let {
      name, version, ext: { atom: config = undefined } = {}
    } of contentAggregate) {
      if (config === false || config === null) return;
      log.info(`Found component ${name}`);
      enabledComponents.push({ name, version, config });
    }
  });

  let siteUrl: string;
  // component->version|LATEST->module->tag|ALL->pages
  type ByModule = Map<string, Map<string | typeof ALL, AtomPage[]>>;
  type ByComponent = Map<string, Map<string | typeof LATEST, ByModule>>;
  let allPagesByPromise: Promise<ByComponent>;
  this.once("documentsConverted", ({
    playbook: { site }, contentCatalog,
  }: T.DocumentsConverted) => {
    if (!site.url) {
      log.fatal("No site.url key specified, cannot build feed");
      throw new Error("No site.url key specified, cannot build feed");
    }
    siteUrl = site.url;
    allPagesByPromise = Promise.all(
      contentCatalog.getPages().partialMap(makePage.bind(null, site.url)),
    ).then(allPages => {
      let pages: ByComponent = new Map();
      for (let page of allPages) {
        const moduleTags = pages
          .getOrInsert(page.component, new Map())
          .getOrInsert(page.version, new Map())
          .getOrInsert(page.module, new Map());
        moduleTags.getOrInsert(ALL, []).push(page);
        for (let tag of page.tags) moduleTags.getOrInsert(tag, []).push(page);
      }
      const components = contentCatalog.getComponents();
      for (let [component, byVersion] of pages.entries()) {
        const latest = components.find(x => x.name === component)!.latest.name;
        byVersion.set(LATEST, byVersion.get(latest)!);
      }
      return pages;
    });
  });

  this.once("beforePublish", async ({ siteCatalog }: T.BeforePublish) => {
    const allPagesBy = await allPagesByPromise;
    const enabledComponentNames = enabledComponents.map(x => x.name);
    for (let component of enabledComponents) {
      const componentFeeds = component.config?.componentFeeds
        ?? globalConfig.defaultComponentFeeds;
      if (!componentFeeds) continue;

      feed: for (let componentFeed of componentFeeds) {
        const feedConfig = Object.assign({},
          DEFAULT_FEED_CONFIG,
          globalConfig.feedOptions,
          component.config?.feedOptions,
          componentFeed,
        ) as FeedConfig;
        if (!feedConfig.name) {
          log.fatal(`No feed name provided for feed in ${component.name}`);
          return;
        }

        if (!feedConfig.logo && feedConfig.icon)
          feedConfig.logo = feedConfig.icon;
        if (!feedConfig.icon && feedConfig.logo)
          feedConfig.icon = feedConfig.logo;

        const feedPages = new Set<AtomPage>();
        for (let [tagIdx, rawTag] of feedConfig.tags.entries()) {
          const tagParts = rawTag.split(":");
          let tagComponent: string, tagModule: string, tagName: string;
          if (tagParts.length === 3)
            [tagComponent, tagModule, tagName] =
              tagParts as [string, string, string];
          else if (tagParts.length === 2) {
            tagComponent = `${component.version}@${component.name}`;
            [tagModule, tagName] = tagParts as [string, string];
          } else {
            log.fatal("Invalid tag identifier " + rawTag);
            return;
          }

          if (tagComponent === "{*}") {
            for (let component of enabledComponentNames)
              componentFeeds.push(Object.assign({},
                JSON.parse(JSON.stringify(componentFeed)
                  .replaceAll("{component}", component)),
                {
                  tags: feedConfig.tags.with(tagIdx,
                    `${component}:${tagModule}:${tagName}`)
                }
              ));
            continue feed;
          }
        
          for (let component of
            tagComponent === "*" ? enabledComponentNames : [tagComponent]
          ) {
            let [a, b] = component.split("@") as [string, string?];
            let [componentVersion, componentName] =
              b ? [a, b] : [LATEST, a] as const;

            const byComponent = allPagesBy.get(componentName);
            if (!byComponent) continue;

            const byVersion = byComponent.get(componentVersion);
            if (!byVersion) continue;

            if (tagModule === "{*}") {
              for (let module of byVersion.keys())
                componentFeeds.push(Object.assign({},
                  JSON.parse(JSON.stringify(componentFeed)
                    .replaceAll("{module}", module)),
                  {
                    tags: feedConfig.tags.with(tagIdx,
                      `${component}:${module}:${tagName}`)
                  }
                ));
              continue feed;
            }

            for (let module of
              tagModule === "*" ? byVersion.keys() : [tagModule]
            ) {
              const byModule = byVersion.get(module);
              if (!byModule) continue;

              if (tagName === "{*}") {
                for (let tag of byModule.keys()) if (tag !== ALL)
                  componentFeeds.push(Object.assign({},
                    JSON.parse(JSON.stringify(componentFeed)
                      .replaceAll("{tag}", tag)),
                    {
                      tags: feedConfig.tags.with(tagIdx,
                        `${component}:${module}:${tag}`)
                    }
                  ));
                continue feed;
              }

              const byTag = byModule.get(tagName === "*" ? ALL : tagName);
              if (!byTag) continue;
              byTag.forEach(x => feedPages.add(x));
            }
          }
        }
        let feedPagesArr = Array.from(feedPages);
        feedPagesArr.sort((a, b) =>
          a.updated > b.updated ? 1 : a.updated < b.updated ? -1 : 0);
        feedPagesArr = feedPagesArr.slice(0, feedConfig.maxEntries);

        let feedUrl = "";
        if (component.name !== "ROOT") feedUrl += "/" + component.name;
        if (component.version !== "") feedUrl += "/" + component.version;
        feedUrl += `/${feedConfig.name}.xml`;

        siteCatalog.addFile({
          out: { path: feedUrl },
          contents: Buffer.from(`<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<id>${siteUrl}${feedUrl}</id>
<title>${feedConfig.title}</title>
${feedPagesArr[0] ? `<updated>${feedPagesArr[0].updated}</updated>` : ""}
<link href="${siteUrl}${feedUrl}" rel="self" type="application/atom+xml" />
${feedConfig.author?.name ?
  `<author>
    <name>${feedConfig.author.name}</name>
    ${feedConfig.author.email ?
      `<email>${feedConfig.author.email}</email>` : ""}
  </author>` : ""}
${feedConfig.contributors?.map(x => x.name ?
  `<contributor>
    <name>${x.name}</name>
    ${x.email ? `<email>${x.email}</email>` : ""}
  </contributor>` : "").join("") ?? ""}
${feedConfig.categories?.map(x => `<category term="${x}"/>`).join("") ?? ""}
<generator
  uri="https://github.com/stag-enterprises/pk./tree/main/src/ext/antora-atom"
  version="${VERSION}"
>antora-atom.js</generator>
${feedConfig.icon ? `<icon>${feedConfig.icon}</icon>` : ""}
${feedConfig.logo ? `<logo>${feedConfig.logo}</logo>` : ""}
${feedConfig.copyright ?
  `<rights type="text">${feedConfig.copyright}</rights>` : ""}
${feedConfig.description ?
  `<subtitle>${feedConfig.description}</subtitle>` : ""}
${feedPagesArr.map(x =>
  `<entry>
    <id>${x.url}</id>
    <title type="text">${x.title || "Untitled post"}</title>
    <updated>${x.updated}</updated>
    <published>${x.published}</published>
    <content type="html">${x.content}</content>
    ${x.tags?.map(x => `<category term="${x}" />`).join("") ?? ""}
    <link href="${x.url}" rel="alternate" type="text/html" />
    ${x.author?.name ?
      `<author>
        <name>${x.author.name}</name>
        ${x.author.email ? `<email>${x.author.email}</email>` : ""}
      </author>` : ""}
    ${x.contributors?.map(x => x.name ?
      `<contributor>
        <name>${x.name}</name>
        ${x.email ? `<email>${x.email}</email>` : ""}
      </contributor>` : "").join("") ?? ""}
  </entry>`).join("")}
</feed>`),
        });
        log.info("Built feed " + feedUrl);
      }
    }
  });
};

const HTML_ESCAPE = /[&<>]/g;
const HTML_ESCAPE_MAP = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
} as { [k: string]: string };
const HTML_ESCAPE_REPLACER = (x: string): string => HTML_ESCAPE_MAP[x]!;
function makePage(baseUrl: string, {
  _contents: content,
  src: {
    component, module, version,
    abspath: path,
    origin: { startPath, worktree },
  },
  pub: { url },
  asciidoc: { attributes, doctitle: title },
}: T.Page): Promise<AtomPage> | undefined {
  if (!(attributes["feedphobic"] ?? true)) return;

  function gitlog(args: string): Promise<string> {
    return new Promise((res, rej) =>
      exec(`git -C ${worktree}/${startPath} log --follow --format=%aI ${args} -- ${path}`,
        (err, stdout, stderr) =>
          err ? rej([err, stderr]) : res(stdout.trim())));
  }

  const tags =
    (attributes["feed-tags"] ?? attributes["tags"])
      ?.split(",")
      ?.map(x => x.trim()) ?? [];
  
  // TODO caching and optimization for git
  return Promise.all([
    attributes["feed-published"]
      ?? attributes["published"]
      ?? gitlog("--diff-filter=A --reverse"),
    gitlog("-1").then(x =>
      x.substring(x.lastIndexOf("\n") + 1).trim(),
    ),
  ]).then(([published, updated]) => {
    const page: AtomPage = {
      url: baseUrl + url,
      title, tags, module, component, version, published, updated,
      contributors: [],
      author: {
        ...cleanInsert("name", attributes["author"] ?? attributes["author_1"]),
        ...cleanInsert("email", attributes["email"] ?? attributes["email_1"]),
      },
      content: content.toString().replace(HTML_ESCAPE, HTML_ESCAPE_REPLACER),
    };
    for (
      let i = 2, v = attributes[`author_${i}`];
      v;
      i++, v = attributes[`author_${i}`]
    ) page.contributors.push({
      name: v,
      ...cleanInsert("email", attributes[`email_${i}`]),
    });
    return page;
  });
}
