import EventEmitter from "node:events";

export type Register = (this: RegisterThis, api: { config: Config }) => void;

export interface RegisterThis extends EventEmitter {
  getLogger(name: string): {
    debug: (msg: string) => void;
    info:  (msg: string) => void;
    warn:  (msg: string) => void;
    error: (msg: string) => void;
    fatal: (msg: string) => void;
  };
}

export type Config = Record<string, any>;

export interface ContentAggregated {
  contentAggregate: ComponentSpec[];
}

export interface ComponentSpec extends Version {
  ext?: Record<string, any>;
}

export interface DocumentsConverted {
  playbook: Playbook;
  contentCatalog: {
    getPages(): Page[];
    getComponents(): Component[];
  };
}

export interface Version {
  name:            string;
  title?:          string;
  version:         string;
  displayVersion?: string;
  prerelease?:     string | boolean;
}

export interface Component {
  name:              string;
  latest:            Version;
  versions:          Version[];
  latestPrerelease?: Version;
}

export interface Playbook {
  site: { url?: string; };
}

export interface Page {
  _contents: Buffer;
  src: {
    component: string;
    module:    string;
    version:   string;
    abspath:   string;
    origin: {
      gitdir:    string;
      worktree:  string;
      startPath: string;
    };
  };
  pub?: { url: string };
  asciidoc?: { attributes: Record<string, string>; doctitle: string };
}

export interface BeforePublish {
  siteCatalog: {
    addFile(file: { contents: Buffer, out: { path: string } }): void;
  };
}
