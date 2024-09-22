# rmapi-js

[![build](https://github.com/erikbrinkman/rmapi-js/actions/workflows/build.yml/badge.svg)](https://github.com/erikbrinkman/rmapi-js/actions/workflows/build.yml)
[![docs](https://img.shields.io/badge/docs-docs-blue)](https://erikbrinkman.github.io/rmapi-js/modules.html)
[![npm](https://img.shields.io/npm/v/rmapi-js)](https://www.npmjs.com/package/rmapi-js)
[![license](https://img.shields.io/github/license/erikbrinkman/rmapi-js)](LICENSE)

JavaScript implementation of the reMarkable api. This implementation is built
around web standards for fetch, but can easily be patched to work for node. It
should also be pretty easy to customize to work with
[rmfakecloud](https://github.com/ddvk/rmfakecloud), although that might take a
little bit of extra plumbing.

reMarkable keep updating their API, makig it hard to keep all features
functioning. The current version is based on the api used by reMarkables web uploader and file viewer. While this api works for moving and uploading, it doesn't support more fine-grained access to document configuration, or downloading.

## API

Before using this API it's necessary to have some rudimentary understanding of
how the API works.

All data is stored via its sha256 hash. This includes raw files ("documents")
and folders ("collections"). The hash indicates the full current state to manage simultaneous edits. Most entries or edits will take an input hash, and return an output hash. Additionally, every entry has an id, which is a uuid4, and remains constantant over the lifetime of the file. There are two special ids, "" (the empty string) which corresponds to the root collection, e.g. the default location for all files, and "trash", which is the trash.

## Usage

To explore files in the cloud, you need to first register your api and persist
the token. Then you can use `listFiles` to explore entries of different file
collections.

```ts
import { register, remarkable } from "rmapi-js";

const code = "..."; // eight letter code from https://my.remarkable.com/device/desktop/connect
const token = await register(code);
// persist token so you don't have to register again
const api = await remarkable(token);
const fileEntries = await api.listFiles();
```

To upload an epub or pdf, simply call upload with the appropriate name and buffer.

```ts
import { remarkable } from "rmapi-js";

const api = await remarkable(...);
await api.uploadEpub("name", buffer);
await api.uploadPdf("name", buffer);
```

### Node

This uses web standards by default, so using within node takes a little more effort. You also need to have a globally defined fetch. There are several ways to
accomplish this. In node 17.5 or higher you can enable global fetch with
`node --experimental-fetch`

You can also rely on `"node-fetch"` which is compliant enough

```js
import fetch from "node-fetch";
global.fetch = fetch;
```

or

```js
import fetch from "node-fetch";
const api = await remarkable(token, { fetch });
```

### Gotchas

By default, all calls try to do their best to verify that the input and output matches what I expect. However, since I reverse-engineered this, some of it could be wrong. If you ever run into a `ValidationError` and know you want whatever data is returned, simply pass `{ verify: false }` in the options to that API, and that should temporarily remove the blocker. However note that in instances like this, the typescript types will be wrong.

## Contributing

Thie current API provides high level limited access. I'd love to reverse engineer what the apps use so this can one again tweak document settings as well as download files. Any help doing this or suggesting approaches would be grealy appreciated!
