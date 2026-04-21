// PM2 — rode o backend como serviço gerenciado na VPS
module.exports = {
  apps: [{
    name: 'nfe-api',
    script: 'dist/index.js',
    cwd: '/var/www/nfe-api',
    env: {
      NODE_ENV: 'production',
      PORT: 3001,
    },
    instances: 1,
    exec_mode: 'fork',
    autorestart: true,
    max_memory_restart: '400M',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: '/var/log/nfe-api/error.log',
    out_file: '/var/log/nfe-api/out.log',
  }],
}
