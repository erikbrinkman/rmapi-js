rmapi-js
========
[![build](https://github.com/erikbrinkman/rmapi-js/actions/workflows/build.yml/badge.svg)](https://github.com/erikbrinkman/rmapi-js/actions/workflows/build.yml)
[![docs](https://img.shields.io/badge/docs-docs-blue)](https://erikbrinkman.github.io/rmapi-js/modules.html)
[![npm](https://img.shields.io/npm/v/rmapi-js)](https://www.npmjs.com/package/rmapi-js)
[![license](https://img.shields.io/github/license/erikbrinkman/rmapi-js)](LICENSE)

JavaScript implementation of the reMarkable 1.5 api. This implementation is
built around web standards for fetch and crypto, but can easily be patched to
work for node. It should also be pretty easy to customize to work with
[rmfakecloud](https://github.com/ddvk/rmfakecloud), although that might take a
little bit of extra plumbing. At the current time it's only partially complete,
but has the backbone to be flushed out more.

This implementation is based off of [`rmapi`](https://github.com/juruen/rmapi),
but aims to be a little simpler. Currently this does no direct handling of the
document tree or syncing efficiently with the cloud, although that support can
be build on top of this library. To make those calls efficient, it will be
helpful to supply a custom cache.

API
---

Before using this API it's necessary to have some rudimentary understanding of
how the API works.

All data is stored via its sha256 hash. This includes raw files and
"collections", which have a special format listing all of their `Entry`s by
hash and id. Each document or folder is a collection of it's constituant files,
which inclue metadata about the object.  All documents and folders are in the
root collection, and there's a versioned hash which indicates the hash of the
root collection. The root hash version is it's "generation".

Usage
-----

To explore files in the cloud, you need to first register your api and persist
the token. Then you can use `getEntries` to explore entries of different file
collections.
```ts
import { register, remarkable } from "rmapi-js";

const code = "..."  // eight letter code from https://my.remarkable.com/device/desktop/connect
const token = await register(code)
// persist token
const api = await remarkable(token);
const [root] = await api.getRootHash();
const fileEntries = await api.getEntries(root);
for (const entry of fileEntries) {
  const children = await api.getEntries(entry.hash);
  for (const { hash, documentId } of children) {
    if (documentId.endsWith(".metadata")) {
      const meta = api.getMetadata(hash);
      // get metadata for entry
      console.log(meta);
    }
  }
}
```

To upload an epub, simply call upload with the appropriate name and buffer.
```ts
import { remarkable } from "rmapi-js";

const api = await remarkable(...);
await api.putEpub("document name", epubBuffer);
```

Note that to actually update the reMarkable to display it, the root hash will
also need to be updated, see method documentation for more info.

### Node

This uses web standards by default, so using within node takes a little more effort.

You need import the node crypto library and assign it to globals
```js
import { webcrypto } from "crypto";
global.crypto = webcrypto;
```

or optionally pass it into the constructor
```js
import { webcrypto } from "crypto";
const api = await remarkable(token, { digest: webcrypto.subtle.digest });
```

You also need to have a globally defined fetch. There are several ways to
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

### Newer API

Recently I discovered the API the the Read on Remarkable extension uses, which
bypasses the syncing and fetching of the root hash. These APIs are pretty
limited but can be an easy first step.

```js
import { remarkable } from "rmapi-js";

const api = await remarkable(...);
// all the files and folders stored on the reMarkable, no roothash necessary
const entries = await api.getEntriesMetadata();
// upload epubs and pdfs without root hash
// NOTE pdfs aren't currently working as expected
// NOTE epub options aren't supported
await api.uploadEpub("name", buffer);
await api.uploadPdf("name", buffer);
```


Design
------

Building a full syncing version of the remarkable filesystem from the cloud API
is a project in and of itself, so I opted to only implement the primative calls
which should still be possible to compose into advanced functionality.

In order to make this as easily cross platform as possible, web standards were
chosen as the basis since they enjoy relative adoption in node. However, node
has middling support of webstreams and since none of the reading or writing is
that intensive or doesn't already require the whole file in memory, we opted to
process strings or ArrayBuffers ignoring Readable and WriteableStreams for the
time being.
