export class HttpError extends Error {
  public readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.statusCode = statusCode;
  }
}

export class AuthError extends HttpError {
  constructor(message = 'No autorizado') {
    super(401, message);
    this.name = 'AuthError';
  }
}
