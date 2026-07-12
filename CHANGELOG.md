# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [11.0.0] - 2026-07-05

### Changed

- the package is now published as unbundled ESM behind an `exports` map. the legacy `types`, `main`, and `module` fields are gone.
- minimum node version is now 22.

## [10.2.0] - 2026-07-05

### Added

- entries returned by `listItems` now include `createdTime`.

### Changed

- `putEntries` now takes `readonly RawEntry[]`.
- `pruneCache` now clears properly.
- `constants` is now optional in template content.
- a subtle race condition with rootHash and schemaVersion.

### Removed

- the `syncHost` option, which was unused.

## [10.1.1] - 2026-06-16

### Changed

- `sizeInBytes` is now optional in document content, since the reMarkable cloud omits it for some documents, which previously made `getContent` (and therefore `listItems`) throw.

## [10.1.0] - 2026-06-12

### Changed

- the high-level api now always writes the root index as schema 4, since reMarkable rejects newly written schema 3 root indexes with a 400 "Software must be updated" error.

## [10.0.0] - 2026-05-18

### Changed

- methods now take an id or filename that's necessary for rm header validation, this is a breaking change, but also one that is broken already.

## [9.0.0] - 2025-12-07

### Added

- support for schema 4!!

## [8.5.0] - 2025-11-01

### Added

- new `auth` helper to exchange device tokens for session tokens
- `session` synchronous factory for constructing clients from cached session tokens

## [8.4.0] - 2025-08-17

### Changed

- add `raw.uploadFile` that uses the rm extension api to upload epubs and pdfs
- made `listItems` tolerant of missing `contents`
- due to switching back to the simple api, there's a small breaking change,
  here parent is no longer accepted with the upload api. I chose to break the
  api rather than silently ignore. If this does break, switch to the `put` api
  as its just more powerful, and you were still on version 3.

## [8.3.0] - 2025-06-01

### Changed

- `formatVersion` is now optional on documents and templates

## [8.2.0] - 2025-05-04

### Added

- Convenience high level apis for `pinned`, `updateDocument`, `updateCollection`, and `updateTemplate`.

## [8.1.1] - 2025-05-01

### Changed

- Updated margin fields to be optional

## [8.1.0] - 2025-02-11

### Added

- Support for template files. Thanks @developit!

### Changed

- Errors related to invalid content files will have more detail for the union
  type.

## [8.0.1] - 2025-02-02

### Added

- `main` entry in `package.json` which may help with resolution in node

## [8.0.0] - 2025-01-17

### Modified

- all of the high level api methods are now backed by the low level api methods,
  this now means that they can throw GenerationErrors

## [7.0.0] - 2025-01-09

### Added

- `.raw` namespaced apis for low level access to the remarkable file structure
- new high level apis that wrap these and expose them

### Removed

- the `verify` option as it violated typescript purity, instead users who want
  to bypass verification should either use a lower level api that doesn't verify,
  or use an `Unchecked` method if such a method exists.

### Modified

- changed `UploadEntry` to `SimpleEntry` and changed `docID` in it to just `id`
  to be more consistent with the rest of the api.
- changed `listFiles` to `listItems` to be semantically consistent.

## [6.0.0] - 2024-09-22

### Added

- new high level apis for renaming and moving entries

### Removed

- old broken apis that allowed more fine grained access

## [4.0.0] - 2024-04-03

### Added

- `verify` option to some calls to disable verifying that requests follow the
  expected format. Note that disabling verification will break typescripts
  guarantees, and so it's only recommend if you know what you're doing.

### Modified

- `lastModified` is now optional. This might break some code that replied on it
  to be present.

## [3.1.0] - 2023-12-05

### Added

- `createdTime` to `DocumentType` metadata, and permissive parsing of metadata
  going forward.

## [3.0.0] - 2023-01-03

### Added

- The ability to call `getEntries` without a hash to implicitely fetch the root
  hash.
- `getJson` and `putJson` methods that use stable hashing.

### Changed

- Caching behavior: You can no longer customize the caching behavior with a
  custom `CacheLike` object, but instead specify the maximum size of objects to
  cache. This both cleans up the caching code, and makes it easier to remove
  most redundant calls from higher level interfaces.
- Changed `FetchLike` interfaces to be promises instead of awaitable.

### Removed

- Removed deprecated versions of `create` and `move`.

## [2.3.0] - 2022-12-31

### Added

- the root hash is now cached, with the default option of using the cached
  value instead of making a request for it.

## [2.2.0] - 2022-12-30

### Added

- `create` and `move` apis added for a simple high level interface for adding
  and moving documents.

## [2.1.0] - 2022-12-30

### Added

- `putMetadata` created for adding metadata and to parallel `getMetadata`. It's
  just a thin wrapper around `putText`.
- `putCollection` add to simplify folder creation.

## [2.0.0] - 2022-12-26

### Added

- New default URLs to work with the new api.
- `syncComplete` was readded and working.
- `putPdf` added for uploading pdfs.
- `uploadPdf` and `uploadEpub` added to expose a different upload api.

## [1.1.0] - 2022-10-07

### Removed

- `syncComplete` api was removed as it seems to be no longer supported by
  reMarkable, in favor of auto syncing.

## [1.0.0] - 2022-08-07

### Added

- Initial release

[Unreleased]: https://github.com/erikbrinkman/rmapi-js/compare/v11.0.0...HEAD
[11.0.0]: https://github.com/erikbrinkman/rmapi-js/compare/v10.2.0...v11.0.0
[10.2.0]: https://github.com/erikbrinkman/rmapi-js/compare/v10.1.1...v10.2.0
[10.1.1]: https://github.com/erikbrinkman/rmapi-js/compare/v10.1.0...v10.1.1
[10.1.0]: https://github.com/erikbrinkman/rmapi-js/compare/v10.0.0...v10.1.0
[10.0.0]: https://github.com/erikbrinkman/rmapi-js/compare/v9.0.0...v10.0.0
[9.0.0]: https://github.com/erikbrinkman/rmapi-js/compare/v8.5.0...v9.0.0
[8.5.0]: https://github.com/erikbrinkman/rmapi-js/compare/v8.4.0...v8.5.0
[8.4.0]: https://github.com/erikbrinkman/rmapi-js/compare/v8.3.0...v8.4.0
[8.3.0]: https://github.com/erikbrinkman/rmapi-js/compare/v8.2.0...v8.3.0
[8.2.0]: https://github.com/erikbrinkman/rmapi-js/compare/v8.1.1...v8.2.0
[8.1.1]: https://github.com/erikbrinkman/rmapi-js/compare/v8.1.0...v8.1.1
[8.1.0]: https://github.com/erikbrinkman/rmapi-js/compare/v8.0.1...v8.1.0
[8.0.1]: https://github.com/erikbrinkman/rmapi-js/compare/v8.0.0...v8.0.1
[8.0.0]: https://github.com/erikbrinkman/rmapi-js/compare/v7.0.0...v8.0.0
[7.0.0]: https://github.com/erikbrinkman/rmapi-js/compare/v6.0.0...v7.0.0
[6.0.0]: https://github.com/erikbrinkman/rmapi-js/compare/v4.0.0...v6.0.0
[4.0.0]: https://github.com/erikbrinkman/rmapi-js/compare/v3.1.0...v4.0.0
[3.1.0]: https://github.com/erikbrinkman/rmapi-js/compare/v3.0.0...v3.1.0
[3.0.0]: https://github.com/erikbrinkman/rmapi-js/compare/v2.3.0...v3.0.0
[2.3.0]: https://github.com/erikbrinkman/rmapi-js/compare/v2.2.0...v2.3.0
[2.2.0]: https://github.com/erikbrinkman/rmapi-js/compare/v2.1.0...v2.2.0
[2.1.0]: https://github.com/erikbrinkman/rmapi-js/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/erikbrinkman/rmapi-js/compare/v1.1.0...v2.0.0
[1.1.0]: https://github.com/erikbrinkman/rmapi-js/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/erikbrinkman/rmapi-js/releases/tag/v1.0.0
