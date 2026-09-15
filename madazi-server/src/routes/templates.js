import { Router } from 'express';
import { listTemplates } from '../services/template.js';

const router = Router();

router.get('/', (req, res) => {
  res.json(listTemplates());
});

export default router;
