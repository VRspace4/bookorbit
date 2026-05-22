export class ZlibLimitReachedException extends Error {
  constructor() {
    super('Z-Library daily download limit reached');
    this.name = 'ZlibLimitReachedException';
  }
}
