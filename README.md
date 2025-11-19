# pk.

This contains the source for [pk.stag.lol], not including the actual content.
The public content can be found at [stag-enterprises/pk.pub][pk.pub].

## building

You will need [Bun] to run the build script, and `glibc >= 2.32` for [ast-grep].
Also make sure that submodules are initialized and updated (`git submodule update --init --fetch`).

To build:

```sh
bun install --frozen-lockfile
bun run build-ci
```

You can make a dev build with `bun run build`.
Start a static server using `bun run serve`.

### architecture

The default UI is downloaded to `build/bundle-source`, if requested using `--fetch`.
It is then copied to `build/bundle`, and [ast-grep] patches in `src/patches` are applied.
Finally, [Anatora] builds with component sources from `components/*`, UI from `build/bundle`, and extra UI assets from `src/ui`.

[pk.stag.lol]: https://pk.stag.lol
[pk.pub]: https://github.com/stag-enterprises/pk.pub
[Bun]: https://bun.sh
[Anatora]: https://antora.org/
[ast-grep]: https://ast-grep.github.io
