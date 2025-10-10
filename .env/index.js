import dotenv from 'dotenv';

if (process.env.CI !== 'true') {
  dotenv.config({
    override: true,
    path: '.env/.env',
    quiet: true,
  });
}
