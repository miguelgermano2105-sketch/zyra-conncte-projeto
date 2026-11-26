import { Router } from 'express';
import { ah } from '../lib/http.js';
import { authRequired } from '../lib/auth.js';
import { badgeCatalog, badgesOf } from '../lib/badges.js';

const router = Router();
router.use(authRequired);

/** Coleção oficial de insígnias ZYRA + insígnias do usuário autenticado. */
router.get('/badges', ah(async (req, res) => {
  res.json({ badges: badgeCatalog(), mine: badgesOf(req.user.id) });
}));

export default router;
