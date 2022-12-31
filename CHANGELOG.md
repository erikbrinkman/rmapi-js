Changelog
=========

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.3.0] - 2022-12-31

### Added

- the root hash is now cached, with the default option of using the cached
  value instead of making a request for it.

### Changed

- Caching behavior: You can no longer customize the caching behavior with a
  custom `CacheLike` object, but instead specify the maximum size of objects to
  cache. This both cleans up the caching code, and makes it easier to remove
  most redundant calls from higher level interfaces.

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
