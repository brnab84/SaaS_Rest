import { Router } from 'express';
import multer from 'multer';
import mongoose from 'mongoose';
import { requireAuth } from '../middleware/auth.js';
import { env } from '../config/env.js';
import { badRequest, notFound } from '../utils/errors.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// Imágenes guardadas en la propia base (GridFS) — sin depender de un storage externo.
function bucket() {
  return new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: 'uploads' });
}

// Subir una imagen (solo usuarios autenticados). Devuelve la URL pública absoluta.
router.post('/', requireAuth, upload.single('file'), (req, res, next) => {
  if (!req.file) return next(badRequest('Falta el archivo'));
  if (!req.file.mimetype?.startsWith('image/')) return next(badRequest('Solo se permiten imágenes'));
  const stream = bucket().openUploadStream(req.file.originalname || 'img', {
    contentType: req.file.mimetype,
    metadata: { tenantId: req.auth.tenantId },
  });
  stream.on('error', next);
  stream.on('finish', () => res.status(201).json({ url: `${env.appBaseUrl}/api/files/${stream.id}` }));
  stream.end(req.file.buffer);
});

// Servir una imagen (público: la usan landing y panel).
router.get('/:id', async (req, res, next) => {
  let oid;
  try { oid = new mongoose.Types.ObjectId(req.params.id); } catch { return next(notFound('Archivo no encontrado')); }
  try {
    const files = await bucket().find({ _id: oid }).limit(1).toArray();
    if (!files.length) return next(notFound('Archivo no encontrado'));
    res.set('Content-Type', files[0].contentType || 'application/octet-stream');
    res.set('Cache-Control', 'public, max-age=31536000, immutable');
    bucket().openDownloadStream(oid).on('error', () => res.end()).pipe(res);
  } catch (e) { next(e); }
});

export default router;
