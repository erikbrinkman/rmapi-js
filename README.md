# rmapi-js

[![build](https://github.com/erikbrinkman/rmapi-js/actions/workflows/build.yml/badge.svg)](https://github.com/erikbrinkman/rmapi-js/actions/workflows/build.yml)
[![docs](https://img.shields.io/badge/docs-docs-blue)](https://erikbrinkman.github.io/rmapi-js/modules.html)
[![npm](https://img.shields.io/npm/v/rmapi-js)](https://www.npmjs.com/package/rmapi-js)
[![license](https://img.shields.io/github/license/erikbrinkman/rmapi-js)](LICENSE)

JavaScript implementation of the reMarkable api. It should also be pretty easy
to customize to work with
[rmfakecloud](https://github.com/ddvk/rmfakecloud), although that might take a
little bit of extra plumbing.

## API

Before using this API it's necessary to have some rudimentary understanding of
how the API works.

All data is stored via its sha256 hash. This includes raw files ("documents")
and folders ("collections"). The hash indicates the full current state to manage simultaneous edits. Most entries or edits will take an input hash, and return an output hash. Additionally, every entry has an id, which is a uuid4, and remains constantant over the lifetime of the file or folder. There are two special ids, "" (the empty string) which corresponds to the root collection, e.g. the default location for all files, and "trash", which is the trash.

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

### Gotchas

By default, all calls try to do their best to verify that the input and output
matches what I expect. However, since I reverse-engineered this, some of it
could be wrong. If you ever run into a `ValidationError` and know you want
whatever data is returned, You'll have to use the low-level api under `api.raw`
to access the raw text file and parse the result yourself.

It seems that exporting happens within the apps themselves, which will require
layout of the remarkable file structure. That's currently outside the scope of
this project.

## Contributing

Since this has all been reverse engineered, any help expanding the api would be
helpful. For example, There's currently a function to download the entire state
of a document, but I ran into trouble trying to reupload that exact same file as
a clone.
