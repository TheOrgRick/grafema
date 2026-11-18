'use strict';
class AppError extends Error {
  constructor(code, message, field) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    if (field) this.field = field;
  }
}
module.exports = { AppError };
