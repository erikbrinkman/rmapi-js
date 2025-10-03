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
the token. Then you can use `listItems` to explore entries of different file
collections.

```ts
import { auth, register, remarkable, session } from "rmapi-js";

const code = "..."; // eight letter code from https://my.remarkable.com/device/desktop/connect
const token = await register(code);
// persist token so you don't have to register again
const api = await remarkable(token);
const fileEntries = await api.listItems();

// In stateless environments, exchange once and reuse.
const sessionToken = await auth(token);
const api = session(sessionToken);
// cache `sessionToken` and reuse it across workers
```

`auth` performs the same network call that `remarkable` does for you internally,
returning a short-lived session token. `session` is synchronous,
letting you construct clients from cached tokens without making a network call.

To upload an epub or pdf, simply call upload with the appropriate name and buffer.

```ts
import { remarkable } from "rmapi-js";

const api = await remarkable(...);
await api.uploadEpub("name", buffer);
await api.uploadPdf("name", buffer);
```

There are alos low level apis that more directly manipulate cloud storage.
Using these apis is a little riskier since they can potentially result in data loss, but it does come with increased flexibility.

```ts
// ...

// upload with custom line height not avilable through reMarkable
await api.putEpub("name", buffer, { lineHeight: 180 })

// fetch an uploaded pdf, using the hash (from listItems)
const buffer = await api.getEpub(hash)
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

## Users

- [✉️ Send Via](https://sendvia.me/) [[github](https://github.com/PaulKinlan/send-to-remarkable)] - upload to reMarkable via email
- [ⓡ rePub](https://chromewebstore.google.com/detail/repub/blkjpagbjaekkpojgcgdapmikoaolpbl) [[github](https://github.com/hafaio/repub)] - web clipper for reMarkable that supports images and customization
- [reMarkable Digest](https://digest.ferrucc.io) - create and receive a daily digest on your reMarkable

## Contributing

Since this has all been reverse engineered, any help expanding the api would be
helpful. For example, There's currently a function to download the entire state
of a document, but I ran into trouble trying to reupload that exact same file as
a clone.

You can also run `bun doc:md` to generate Markdown docs in `docs-md/`, which can
be handy when sharing context.
