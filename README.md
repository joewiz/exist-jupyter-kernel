# exist-jupyter-kernel

A Jupyter kernel that executes XQuery against a remote [eXist-db](https://exist-db.org) server. Once installed, you can open `.ipynb` notebooks in VS Code, JupyterLab, or any Jupyter client and run XQuery cells against your eXist-db instance.

This kernel is the Jupyter-ecosystem counterpart to eXist-db's [Notebook](https://github.com/joewiz/notebook) web app. Notebooks created in either tool are fully compatible — same `.ipynb` format, same eval API, same named-cell caching.

## Requirements

- **Node.js** 18+
- **eXist-db** with the [Notebook](https://github.com/joewiz/notebook) app installed (provides the `/api/eval` endpoint)
- **Jupyter** (for `jupyter kernelspec` management) or **VS Code** with the [Jupyter extension](https://marketplace.visualstudio.com/items?itemName=ms-toolsai.jupyter)

## Installation

### From source

```bash
git clone https://github.com/joewiz/exist-jupyter-kernel.git
cd exist-jupyter-kernel
npm install
npm run install-kernel
```

The `install-kernel` command registers the kernel spec with Jupyter. You should see `XQuery (eXist-db)` as an available kernel in VS Code or JupyterLab.

### VS Code language extension

For XQuery syntax highlighting in notebook cells, install the bundled VS Code extension:

```bash
cd vscode-xquery-language
npx @vscode/vsce package --allow-missing-repository
code --install-extension vscode-xquery-language-*.vsix
```

### Uninstall

```bash
npx exist-jupyter-kernel uninstall
```

## Configuration

The kernel connects to eXist-db using these settings, checked in priority order:

### 1. Environment variables (highest priority)

```bash
export EXIST_URL=http://localhost:8080/exist
export EXIST_USER=admin
export EXIST_PASSWORD=
export EXIST_TIMEOUT=30000
```

### 2. Config file (`~/.exist-jupyter.json`)

```json
{
    "server": "http://localhost:8080/exist",
    "user": "admin",
    "password": ""
}
```

### 3. Defaults

If neither is set, the kernel connects to `http://localhost:8080/exist` as `admin` with an empty password.

## Usage

### Basic execution

Create or open an `.ipynb` file, select the **XQuery (eXist-db)** kernel, and write XQuery in code cells:

```xquery
for $x in (1, 2, 3)
return $x * 10
```

Results are syntax-highlighted — adaptive output uses XQuery highlighting, and `method=xml` uses XML highlighting.

### Serialization directives

Control output serialization with xqdoc-style `@output` directives at the top of a cell:

```xquery
(:~ @output method=xml indent=yes :)
doc("/db/apps/myapp/data/config.xml")
```

All standard [W3C serialization parameters](https://qt4cg.org/specifications/xslt-xquery-serialization-40/Overview.html) are supported. The directive is a valid XQuery comment, so it doesn't affect execution.

#### Output methods

| Directive | Output |
|-----------|--------|
| *(none)* | XQuery adaptive output with syntax highlighting |
| `(:~ @output method=xml indent=yes :)` | Indented XML with syntax highlighting |
| `(:~ @output method=json indent=yes :)` | JSON with syntax highlighting |
| `(:~ @output method=html :)` | HTML raw source with syntax highlighting |
| `(:~ @output method=html media-type=text/html :)` | Rendered HTML |
| `(:~ @output method=csv :)` | CSV raw text |
| `(:~ @output method=csv media-type=text/html :)` | Rendered HTML table |
| `(:~ @output method=text :)` | Plain text (no highlighting) |

#### CSV parameters

When using `method=csv`, these additional parameters are available:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `header` | `false` | Output header row from map keys |
| `quotes` | `true` | Always quote fields |
| `field-delimiter` | `,` | Field separator |
| `row-delimiter` | `\n` | Line ending |
| `quote-character` | `"` | Quoting character |

Example with CSV table rendering:

```xquery
(:~ @output method=csv header=true quotes=false media-type=text/html :)
(
    map { "name": "Alice", "dept": "Engineering", "salary": 95000 },
    map { "name": "Bob",   "dept": "Marketing",   "salary": 82000 }
)
```

#### Combining with other xqdoc tags

The `@output` directive coexists with standard xqdoc tags — other tags are ignored by the kernel:

```xquery
(:~
 : Fetches the table of contents from the database.
 : @author Joe
 : @see https://example.com/docs
 : @output method=xml indent=yes
 :)
doc("/db/apps/myapp/data/toc.xml")
```

### Named cells and cell chaining

Name a cell with the `@name` directive, and subsequent cells can reference its result as a variable:

```xquery
(:~ @name books :)
collection("/db/apps/myapp/data")//book
```

A later cell can then use `$books`:

```xquery
for $book in $books
where $book/@year >= 2020
return $book/title/string()
```

The `@name` directive can be combined with `@output` on separate lines:

```xquery
(:~
 : @name results
 : @output method=xml indent=yes
 :)
collection("/db/data")
```

This is compatible with eXist-db Notebook's named-cell caching — the kernel sends the cell name and context to the eval API, and eXist caches the result server-side.

### Data cells

eXist-db Notebook supports data cells containing raw XML, JSON, or text. Since VS Code's Jupyter extension renders these as non-executable raw cells, the kernel provides a `@data` directive that lets you use code cells as data cells instead:

```xquery
(:~
 : @name config
 : @data json
 :)
{
    "appName": "My Dashboard",
    "version": "2.1",
    "features": ["search", "export"]
}
```

The kernel wraps the content before sending it to eXist-db for evaluation:

| Format | Wrapping | Use case |
|--------|----------|----------|
| `@data json` | `parse-json('...')` | JSON objects and arrays |
| `@data xml` | Passed through (XML literals are valid XQuery) | XML documents |
| `@data text` | String literal `'...'` | Plain text |

The result is cached under the cell's `@name`, so subsequent cells can reference it:

```xquery
"App: " || $config?appName || " v" || $config?version
```

Add `@silent` to suppress redundant output on data-only cells — the cell still executes and caches its result, but no output is displayed:

```xquery
(:~
 : @name config
 : @data json
 : @silent
 :)
{"appName": "Dashboard", "version": "2.1"}
```

All directives can be combined freely:

```xquery
(:~
 : @name people
 : @data xml
 : @output method=xml indent=yes
 :)
<people>
    <person age="30"><name>Alice</name></person>
    <person age="25"><name>Bob</name></person>
</people>
```

## Architecture

```
┌──────────────────────┐     ZeroMQ      ┌────────────────────┐     HTTP      ┌──────────────┐
│   Jupyter Client     │ ◄──────────────► │  xquery-kernel.js  │ ◄──────────► │   eXist-db   │
│  (VS Code / Lab)     │   Wire Protocol │  (Node.js process) │    REST API  │   /api/eval  │
└──────────────────────┘                  └────────────────────┘              └──────────────┘
```

The kernel implements the [Jupyter wire protocol](https://jupyter-client.readthedocs.io/en/stable/messaging.html) over ZeroMQ and proxies XQuery evaluation to eXist-db's Notebook eval API.

## Development

### Run tests

```bash
# Unit tests (no eXist-db required)
npm test

# Integration tests (requires eXist-db running on localhost:8080)
python3 test/integration.py
```

### Project structure

| File | Purpose |
|------|---------|
| `lib/kernel.js` | Main entry point — kernel startup and handler wiring |
| `lib/wire.js` | Jupyter wire protocol — ZeroMQ sockets, HMAC signing, message dispatch |
| `lib/exist-client.js` | HTTP client for eXist-db's eval API, MIME bundle construction |
| `lib/directives.js` | xqdoc directive parser (`@name`, `@data`, `@silent`, `@output`) |
| `lib/completeness.js` | XQuery completeness checker for `is_complete_request` |
| `lib/config.js` | Configuration loader (env vars, config file, defaults) |
| `bin/cli.js` | CLI for `install` / `uninstall` commands |
| `vscode-xquery-language/` | VS Code extension for XQuery syntax highlighting |

## License

[LGPL-2.1](LICENSE)
