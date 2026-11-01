import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { randomToken } from './crypto.js';
import { HttpError } from '../middleware/errorHandler.js';

export const UPLOAD_ROOT = path.resolve('uploads');
const MAX_SIZE = 5 * 1024 * 1024;

// extension -> allowed mime types. Both must agree, and the file header is checked after upload.
const ALLOWED = {
  '.png': ['image/png'], '.jpg': ['image/jpeg'], '.jpeg': ['image/jpeg'], '.gif': ['image/gif'], '.webp': ['image/webp'],
  '.pdf': ['application/pdf'], '.txt': ['text/plain'], '.md': ['text/markdown', 'text/plain'], '.csv': ['text/csv', 'application/vnd.ms-excel', 'text/plain'], '.json': ['application/json'],
};

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const dir = path.join(UPLOAD_ROOT, String(req.userId)); // userId comes from the session, never from the client
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => cb(null, randomToken(16) + path.extname(file.originalname).toLowerCase()),
});

export const upload = multer({
  storage,
  limits: { fileSize: MAX_SIZE, files: 5 },
  fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED[ext] || !ALLOWED[ext].includes(file.mimetype)) return cb(new HttpError(415, `File type not allowed: ${ext || 'unknown'}`, 'unsupported_type'));
    cb(null, true);
  },
});

const MAGIC = { '.png': [0x89, 0x50, 0x4e, 0x47], '.jpg': [0xff, 0xd8, 0xff], '.jpeg': [0xff, 0xd8, 0xff], '.gif': [0x47, 0x49, 0x46, 0x38], '.pdf': [0x25, 0x50, 0x44, 0x46] };

/** Confirms the real content matches the claimed type. Returns true when the file is acceptable. */
export function contentLooksValid(filePath, ext) {
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(16);
  const n = fs.readSync(fd, buf, 0, 16, 0);
  fs.closeSync(fd);
  if (MAGIC[ext]) return MAGIC[ext].every((b, i) => buf[i] === b);
  if (ext === '.webp') return buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';
  const head = fs.readFileSync(filePath).subarray(0, 2048);
  return n >= 0 && !head.includes(0); // text-like files must not contain NUL bytes
}

export const removeFile = (p) => fs.promises.unlink(p).catch(() => {});
