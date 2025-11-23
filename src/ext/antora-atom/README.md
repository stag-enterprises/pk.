# antora-atom

This extension automatically generates Atom feeds per-component for Antora.

This extension is very new and barely tested so expect lots of bugs.

## installation

Clone this repository and run tsc.
The artifact is located at `build/js/antora-atom/antora-atom.js`.
Prebuilts are coming soon.

```
git clone https://github.com/stag-enterprises/pk.
npx tsc
```

Then, add the file to `antora.extensions`.

```yaml
# antora-playbook.yml
antora:
  extensions:
    - require: './build/js/antora-atom/antora-atom.js'
```

## configuration

This extension supports supplying default configs at the playbook-level,
which are inherited to the component-level, then finally inherited to each feed.
At the component-level, you define the list of feeds to generate.

```yaml
# antora-playbook.yml
antora:
  extensions:
    - require: './build/js/antora-atom/antora-atom.js'
      feed_options:
        # all feed options, to be inherited
      default_component_feeds:
        # if supplied, components without an ext.atom_feed.component_feeds value
        # will act like they have it. it can be disabled by supplying a config
        # or by supplying null or false.

# antora.yml
# unless otherwise specified, fields are optional
ext:
  antora_feed:
    feed_options:
      # all feed options, to be inherited
    component_feeds:
      - title: "title of the feed, shown in the generated page" # strongly recommended
        name: "url of the feed" # required!
        # note! all feeds (except for ROOT) will have their component prepended
        # and their version prepended (unless it is empty), like normal pages
        # example: https://example.com/component/1.0.0/name.xml
        tags: [ "list of tags, see below" ] # strongly recommended
        max_entries: 100 # defaults to 20
        author:
          name: "strongly recommended"
          email: "optional!"
        categories:
          - "honestly don't know what this is actually for"
          - "creates a <category term=> element"
        contributors:
          - name: "same format as author"
        copyright: "copyright text"
        description: "hello world!"
        icon: "url to icon, falls back to logo"
        logo: "url to logo, falls back to icon, should be larger"
```

You can use feedphobic to remove a page from being present in the feed.
Use feed-tags or just tags to add tags to a page.
Use feed-published to specify published date,
otherwise it will be automatically determined from Git
(last updated will always be from Git).
If an author line is present, author(s) will be automatically determined.
In the case of multiple, the author will be the first,
and contributors the remaining ones.

> Protip! You can use the `asciidoc.attributes` key in the playbook
> or component config to globally set attributes.
> This is especially useful for `feedphobic`
> to work with a whitelist instead of a blacklist.

Example:

```asciidoc
= My Page
:feedphobic:
:feed-tags: taga, tagb
```

### tags

You can tag pages to produce feeds that only include certain articles.
They will also show up in the entry element in the feed.
For example, by applying a tag `foo` to some pages,
you can create a feed with `tags: [ '*:foo' ]`
to only include those those pages.

Note the syntax above. Tag filters have this format: `component:module:name`.
Component can be omitted to mean the current component,
but module and name are always required.

You can use the `*` glyph to represent any available option, as shown above.
To get a feed with all pages from a component, you could do `*:*`.

You can use the `{*}` glyph,
which acts like the current feed was duplicated for every possible value for it.
In addition, `{tag}`, `{module}`, and `{component}` are replaced with the name.
You can use multiple `{*}` at the same time too.
For example, if there was `*:{*}`,
and the tags in the component are foo and bar, then this would be the result.

```yaml
# original
ext:
  antora_feed:
    component_feeds:
      - title: "All from {tag}"
        name: "{tag}"
        tags: [ "*:{*}" ]
# result
ext:
  antora_feed:
    component_feeds:
      - title: "All from foo"
        name: "foo"
        tags: [ "*:foo" ]
      - title: "All from bar"
        name: "bar"
        tags: [ "*:bar" ]
```

