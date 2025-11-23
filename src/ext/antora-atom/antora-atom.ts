import { cleanInsert } from "../utils";
import { exec } from "node:child_process";
import type * as T from "../antora";

const VERSION = "0.1.0";
const ALL = Symbol("all");
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

export const register: T.Register = async function register({ config }) {
  const log                = this.getLogger("antora-atom-" + VERSION);
  const globalConfig       = config as GlobalConfig;

  log.info("Started");

  // in antora 3.2 this won't need a seperate step: https://gitlab.com/antora/antora/-/issues/995
  const enabledComponents: {
    name: string, version: string, config: ComponentConfig | undefined
  }[] = []; 
  this.on("contentAggregated", ({ contentAggregate }: T.ContentAggregated) => {
    for (let {
      name, version, ext: { atomFeed: config = undefined } = {}
    } of contentAggregate) {
      if (config === false || config === null) return;
      log.info(`Found component ${name}`);
      enabledComponents.push({ name, version, config });
    }
  });

  let siteUrl: string;
  // component->module->tag->pages
  let allPagesByPromise:
    Promise<Map<string, Map<string, Map<string | typeof ALL, AtomPage[]>>>>;
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
      let pages = new Map();
      for (let page of allPages) {
        const moduleTags = pages
          .getOrInsert(page.component, new Map())
          .getOrInsert(page.module, new Map());
        moduleTags.getOrInsert(ALL, []).push(page);
        for (let tag of page.tags) moduleTags.getOrInsert(tag, []).push(page);
      }
      return pages;
    });
  });

  this.once("beforePublish", async ({ siteCatalog }: T.BeforePublish) => {
    const allPagesBy = await allPagesByPromise;
    const enabledComponentNames = enabledComponents.map(x => x.name);
    for (let {
      name: componentName, version: componentVersion, config: componentConfig
    } of enabledComponents) {
      const componentFeeds = componentConfig?.componentFeeds
        ?? globalConfig.defaultComponentFeeds;
      if (!componentFeeds) continue;

      feed: for (let componentFeed of componentFeeds) {
        const feedConfig = Object.assign({},
          DEFAULT_FEED_CONFIG,
          globalConfig.feedOptions,
          componentConfig?.feedOptions,
          componentFeed,
        ) as FeedConfig;
        if (!feedConfig.name) {
          log.fatal(`No feed name provided for feed in ${componentName}`);
          return;
        }

        if (!feedConfig.logo && feedConfig.icon) feedConfig.logo = feedConfig.icon;
        if (!feedConfig.icon && feedConfig.logo) feedConfig.icon = feedConfig.logo;

        const feedPages = new Set<AtomPage>();
        for (let [i, rawTag] of feedConfig.tags.entries()) {
          const tagParts = rawTag.split(":");
          let tagComponent: string, tagModule: string, tagName: string;
          if (tagParts.length === 3)
            [tagComponent, tagModule, tagName] =
              tagParts as [string, string, string];
          else if (tagParts.length === 2) {
            tagComponent = componentName;
            [tagModule, tagName] = tagParts as [string, string];
          } else {
            log.fatal("Invalid tag identifier " + rawTag);
            return;
          }

          if (tagComponent === "{*}") {
            for (let component of enabledComponentNames)
              componentFeeds.push(Object.assign({}, componentFeed, {
                tags: feedConfig.tags.with(i,
                  `${component}:${tagModule}:${tagName}`)
              }));
            continue feed;
          }
        
          for (let component of
            tagComponent === "*" ? enabledComponentNames : [tagComponent]
          ) {
            const byComponent = allPagesBy.get(component);
            if (!byComponent) continue;

            if (tagModule === "{*}") {
              for (let module of byComponent.keys())
                componentFeeds.push(Object.assign({}, componentFeed, {
                  tags: feedConfig.tags.with(i,
                    `${component}:${module}:${tagName}`)
                }))
              continue feed;
            }

            for (let module of
              tagModule === "*" ? byComponent.keys() : [tagModule]
            ) {
              const byModule = byComponent.get(module);
              if (!byModule) continue;

              if (tagName === "{*}") {
                for (let tag of byModule.get(ALL)!)
                  componentFeeds.push(Object.assign({}, componentFeed, {
                    tags: feedConfig.tags.with(i,
                      `${component}:${module}:${tag}`)
                  }))
                continue feed;
              }

              const byTag = byModule.get(tagName === "*" ? ALL : tagName);
              if (!byTag) continue;
              byTag.forEach(x => feedPages.add(x));
            }
          }
        }
        const feedPagesArr = Array.from(feedPages); 

        let feedUrl = "";
        if (componentName !== "ROOT") feedUrl += "/" + componentName;
        if (componentVersion !== "") feedUrl += "/" + componentVersion;
        feedUrl += `/${feedConfig.name}.xml`;

        siteCatalog.addFile({
          contents: Buffer.from(`<?xml version="1.0" encoding="utf-8"?>
  <feed xmlns="http://www.w3.org/2005/Atom">
  <id>${siteUrl}${feedUrl}</id>
  <title>${feedConfig.title}</title>
  <updated>${feedPagesArr.map(x => x.updated).toSorted().at(-1)}</updated>
  <link href="${siteUrl}${feedUrl}" rel="self" type="application/atom+xml" />
  ${feedConfig.author?.name ? `
    <author>
      <name>${feedConfig.author.name}</name>
      ${feedConfig.author.email ? `
        <email>${feedConfig.author.email}</email>` : ""}
    </author>` : ""}
  ${feedConfig.contributors?.map(x => x.name ? `
    <contributor>
      <name>${x.name}</name>
      ${x.email ? `<email>${x.email}</email>` : ""}
    </contributor>` : "") ?? ""}
  ${feedConfig.categories?.map(x => `<category term="${x}"/>`) ?? ""}
  <generator
    uri="https://github.com/stag-enterprises/pk./tree/main/src/ext/antora-atom"
    version="${VERSION}"
  >antora-atom.js</generator>
  ${feedConfig.icon ? `<icon>${feedConfig.icon}</icon>` : ""}
  ${feedConfig.logo ? `<logo>${feedConfig.logo}</logo>` : ""}
  ${feedConfig.copyright ? `
    <rights type="text">${feedConfig.logo}</rights>` : ""}
  ${feedConfig.description ?
    `<subtitle>${feedConfig.description}</subtitle>` : ""}
  ${feedPagesArr.map(x => `
    <entry>
      <id>${x.url}</id>
      <title type="text">${x.title || "Untitled post"}</title>
      <updated>${x.updated}</updated>
      <published>${x.published}</published>
      <content type="html">${x.content}</content>
      ${x.tags?.map(x => `<category term="${x}" />`) ?? ""}
      <link href="${x.url}" rel="alternate" type="text/html" />
      ${x.author?.name ? `
        <author>
          <name>${x.author.name}</name>
          ${x.author.email ? `<email>${x.author.email}</email>` : ""}
        </author>` : ""}
      ${x.contributors?.map(x => x.name ? `
        <contributor>
          <name>${x.name}</name>
          ${x.email ? `<email>${x.email}</email>` : ""}
        </contributor>` : "") ?? ""}
    </entry>`)}
  </feed>`),
          out: { path: feedUrl },
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
    component, module,
    abspath: path,
    origin: { startPath, worktree },
  },
  pub: { url },
  asciidoc: { attributes, doctitle: title },
}: T.Page): Promise<AtomPage> | undefined {
  if (attributes["feedphobic"]) return;

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
      title, tags, module, component, published, updated,
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
