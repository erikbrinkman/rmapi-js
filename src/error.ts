/** an error that results from a failed request */
export class ValidationError extends Error {
  /** the response status number */
  readonly field: string;
  /** the response status text */
  readonly regex: RegExp;

  constructor(field: string, regex: RegExp, message: string) {
    super(message);
    this.field = field;
    this.regex = regex;
  }
}

/** an error that results while supplying a hash not found in the entries of the root hash */
export class HashNotFoundError extends Error {
  /** the hash that couldn't be found */
  readonly hash: string;

  constructor(hash: string) {
    super(`'${hash}' not found in the root hash`);
    this.hash = hash;
  }
}
