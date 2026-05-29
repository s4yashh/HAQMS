const express = require('express');
const { PrismaClient } = require('@prisma/client');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
const prisma = new PrismaClient();

// GET /api/reports/doctor-stats
// Highly inefficient nested loop aggregate reporting for admin/receptionists dashboard
// PERFORMANCE BUG: Performs multiple nested DB queries inside a loop for every doctor.
// Runs sequentially, blocking/scaling terrible with doctors count.
router.get('/doctor-stats', authenticate, async (req, res) => {
  try {
    const start = Date.now();

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [doctors, appointmentGroups, queueGroups] = await Promise.all([
      prisma.doctor.findMany(),
      prisma.appointment.groupBy({
        by: ['doctorId', 'status'],
        _count: { _all: true },
      }),
      prisma.queueToken.groupBy({
        by: ['doctorId'],
        where: { queueDate: today },
        _count: { _all: true },
      }),
    ]);

    const appointmentCounts = new Map();
    appointmentGroups.forEach((group) => {
      if (!appointmentCounts.has(group.doctorId)) {
        appointmentCounts.set(group.doctorId, { total: 0, completed: 0, cancelled: 0 });
      }
      const current = appointmentCounts.get(group.doctorId);
      current.total += group._count._all;
      if (group.status === 'COMPLETED') current.completed += group._count._all;
      if (group.status === 'CANCELLED') current.cancelled += group._count._all;
    });

    const queueCounts = new Map();
    queueGroups.forEach((group) => {
      queueCounts.set(group.doctorId, group._count._all);
    });

    const reportData = doctors.map((doc) => {
      const counts = appointmentCounts.get(doc.id) || { total: 0, completed: 0, cancelled: 0 };
      const todayQueueSize = queueCounts.get(doc.id) || 0;
      const revenue = counts.completed * doc.consultationFee;

      return {
        id: doc.id,
        name: doc.name,
        specialization: doc.specialization,
        department: doc.department,
        totalAppointments: counts.total,
        completedAppointments: counts.completed,
        cancelledAppointments: counts.cancelled,
        todayQueueSize,
        revenue,
      };
    });

    const durationMs = Date.now() - start;

    res.json({
      success: true,
      timeTakenMs: durationMs,
      data: reportData,
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate report', details: error.message });
  }
});

module.exports = router;
