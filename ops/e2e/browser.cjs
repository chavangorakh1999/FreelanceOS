// Shared by the end-to-end suites: one browser launcher and one database helper, configured from the environment.
const path = require('path');
const { execFileSync } = require('child_process');
const { chromium } = require(require.resolve('playwright-core', { paths: [path.join(__dirname, '../../apps/api')] }));
exports.launch = () => chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
exports.psql = (sql) => execFileSync('psql', [process.env.E2E_DATABASE_URL, '-Atc', sql]).toString().trim();
exports.WEB = process.env.WEB_URL ?? 'http://localhost:3000';
exports.API = process.env.API_URL ?? 'http://localhost:4000';
