import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  await prisma.facility.deleteMany();
  console.log('Cleared all inventory data.');
}
main().finally(() => prisma.$disconnect());
