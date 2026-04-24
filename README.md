# exist-jupyter-kernel

A Jupyter kernel that executes XQuery against a remote [eXist-db](https://exist-db.org) server. Once installed, you can open `.ipynb` notebooks in VS Code, JupyterLab, or any Jupyter client and run XQuery cells against your eXist-db instance.

This kernel is the Jupyter-ecosystem counterpart to eXist-db's [Notebook](https://github.com/eXist-db/notebook) web app. Notebooks created in either tool are fully compatible — same `.ipynb` format, same eval API, same named-cell caching.

## Requirements

- **Node.js** 18+
- **eXist-db** with the [Notebook](https://github.com/eXist-db/notebook) app installed (provides the `/api/eval` endpoint)
- **Jupyter** (for `jupyter kernelspec` management) or **VS Code** with the [Jupyter extension](https://marketplace.visualstudio.com/items?itemName=ms-toolsai.jupyter)

## Installation

### From source

```bash
git clone https://github.com/eXist-db/exist-jupyter-kernel.git
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
| `(:~ @output method=html :)` | HTML source with syntax highlighting |
| `(:~ @output method=html media-type=text/html :)` | Rendered HTML |
| `(:~ @output method=csv :)` | Raw CSV text |
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
 * Fetches the table of contents from the database.
 * @author Joe
 * @see https://example.com/docs
 * @output method=xml indent=yes
 :)
doc("/db/apps/myapp/data/toc.xml")
```

### Named cells and cell chaining

Cells can be named via cell metadata (`exist.name`), and subsequent cells can reference earlier results as variables:

```json
{
    "metadata": {
        "exist": { "name": "data" }
    }
}
```

A later cell can then use `$data` to reference the cached result. This is compatible with eXist-db Notebook's named-cell caching mechanism.

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
| `lib/directives.js` | xqdoc `@output` directive parser |
| `lib/completeness.js` | XQuery completeness checker for `is_complete_request` |
| `lib/config.js` | Configuration loader (env vars, config file, defaults) |
| `bin/cli.js` | CLI for `install` / `uninstall` commands |
| `vscode-xquery-language/` | VS Code extension for XQuery syntax highlighting |

## License

[LGPL-2.1](LICENSE)
