export class AppError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (msg, details) => new AppError(400, msg, details);
export const unauthorized = (msg = 'Please sign in') => new AppError(401, msg);
export const forbidden = (msg = 'You do not have access to this') => new AppError(403, msg);
export const notFound = (what = 'Record') => new AppError(404, `${what} not found`);
export const conflict = (msg) => new AppError(409, msg);
