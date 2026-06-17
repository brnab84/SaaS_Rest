export class AppError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export const notFound = (msg = 'No encontrado') => new AppError(404, msg, 'NOT_FOUND');
export const badRequest = (msg = 'Solicitud inválida') => new AppError(400, msg, 'BAD_REQUEST');
export const unauthorized = (msg = 'No autorizado') => new AppError(401, msg, 'UNAUTHORIZED');
export const forbidden = (msg = 'Sin permisos') => new AppError(403, msg, 'FORBIDDEN');
