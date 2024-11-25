const express = require('express');
const authRoutes = require('./authRoutes');
const adminRoutes = require('./adminRoutes');
const managerRoutes = require('./managerRoutes');
const workerRoutes = require('./workerRoutes');

const router = express.Router();

router.use('/', authRoutes);
router.use('/admin', adminRoutes);
router.use('/manager', managerRoutes);
router.use('/worker', workerRoutes);

module.exports = router;
