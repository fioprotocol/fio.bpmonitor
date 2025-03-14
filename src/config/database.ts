import { PrismaClient } from '@prisma/client';
import { logger_error } from '../utils/logger';

const prisma = new PrismaClient({
    log: [
        { level: 'error', emit: 'event' },
    ],
});

prisma.$on('error', (e) => {
    logger_error('DATABASE', 'Prisma client error', e);
});

process.on('SIGINT', async () => {
    await prisma.$disconnect();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    await prisma.$disconnect();
    process.exit(0);
});

export { prisma };