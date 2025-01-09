# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
